# QueueOS — Execution Flow

How code actually runs: entry points, boot order, and what happens end-to-end
for the requests that matter. Written from a full read of the repo on
2026-09-05. Keep this in sync when execution paths change — see `decision.md`
for the log of *why* things changed.

## 1. What this project is

A multi-tenant virtual queue system ("take a ticket, get a live ETA, get
recalled if you're not there when called") that serves six different
industries — hospital, restaurant, salon, temple, government, retail — from
one codebase. Industry differences (terminology, journey stages, colors) are
data (`packages/core/src/verticals.ts`), never branches in application code.

## 2. Monorepo layout

```
queueos/
├── apps/api/     NestJS backend — REST + WebSocket, Prisma/SQLite
├── apps/web/     Next.js 15 (App Router) frontend — 7 operational screens
│                 plus a /setup area for business configuration
└── packages/core/  Shared, framework-free domain logic (enums, ETA math,
                     event contracts, vertical profiles) — imported by both
                     apps as @queueos/core
```

`packages/core` has no dependency on Prisma, Nest, or React. It's pure
TypeScript + Zod-free types and math, built independently (`npm run
build:core`) before either app starts, because both apps import its compiled
`dist/`.

## 3. Backend entry point and boot order

Entry point: `apps/api/src/main.ts`.

```
1. import 'reflect-metadata'          — required by Nest's decorator metadata
2. NestFactory.create(AppModule, FastifyAdapter)
3. app.enableCors({ origin: WEB_ORIGIN })
4. app.setGlobalPrefix('api')         — every route is under /api/*
5. app.useWebSocketAdapter(IoAdapter) — Socket.IO rides the same HTTP server/port
6. app.listen(PORT ?? 4000, '0.0.0.0')
```

Module init order, driven by `AppModule`'s `imports` array
(`apps/api/src/app.module.ts`):

```
ConfigModule (global env access)
  → ScheduleModule (enables @Cron decorators)
  → PrismaModule (global — connects to SQLite via PrismaService.onModuleInit)
  → EventsModule (global — EventBusService, the one place events are emitted)
  → EtaModule (global — EtaService, stats cache)
  → AuthModule (global — JwtModule + AuthService)
→ then AppModule's own controllers/providers wire up, including AuthGuard
  as the global APP_GUARD (runs on every request unless @Public()).
```

Everything under `Global()` (`Prisma`, `Events`, `Eta`, `Auth`) is
injectable anywhere without re-importing — that's why `QueueService`,
`CounterService`, etc. can all reach `PrismaService` and `EventBusService`
directly.

## 4. Request lifecycle (every HTTP call)

```
Fastify receives request
  → global prefix strips/matches "/api"
  → AuthGuard.canActivate()
      - reads @Public() / @MinRole() metadata off the handler
      - if not public: requires "Authorization: Bearer <jwt>", verifies via
        AuthService.verify(), attaches req.user
      - if @MinRole(x) set: compares ROLE_RANK[user.role] >= ROLE_RANK[x]
  → ZodBody pipe (where used) — validates/strips the request body against a
    Zod schema, throws 400 with field-level issues on failure
  → Controller method → Service method → PrismaService (SQLite)
  → (state-changing actions only) EventBusService.publish()
      - writes a QueueEvent row (audit trail / analytics source)
      - emits in-process to RealtimeGateway subscribers
  → (state-changing actions only) QueueService.recalculate(queueId)
      - rebuilds ETA context, re-estimates every active token's ETA
      - writes changed ETAs, publishes ETAUpdated events, fires threshold
        notifications (30/15/10/5/0 min)
  → response serialized back to the client
```

The "mutate → emit event → recalculate" sequence is the same shape in every
state-transition method (`TokenService`, `CounterService`, `QueueService`).
This is deliberate — it's what makes the customer's phone update within
about a second of a staff action, because recalculation happens inline with
the mutation rather than on a timer.

## 5. Authentication and authorization

- Login: `POST /api/auth/login` (public) — `AuthService.login()` checks
  `StaffUser` by email, verifies password with `scrypt` (Node's built-in
  crypto, chosen over bcrypt to avoid a native build toolchain — see
  `apps/api/src/auth/password.ts`), returns a JWT (12h default expiry).
- Every other endpoint is **authenticated by default**. A controller/handler
  must opt out with `@Public()` — this is inverted from the usual default so
  a newly added controller can't accidentally ship unauthenticated.
- `@MinRole(role)` gates by a role hierarchy (`ROLE_RANK` in
  `packages/core/src/enums.ts`): `CUSTOMER(0) < COUNTER_STAFF/CASHIER(10) <
  PROVIDER/RECEPTION(20) < BRANCH_MANAGER(40) < ORG_ADMIN(60) <
  SUPER_ADMIN(100)`.
- Customer-facing endpoints (`/queues/:id/tokens` join, `/t/:code/*`) are
  public by design — the unguessable 12-character token `code` (random,
  base64url) is the credential, not a login.
- `@MinRole` alone only proves rank, not scope: a `BRANCH_MANAGER` from one
  branch could otherwise act on another branch's queues/counters just by
  guessing an id. Every business-setup and queue-operation mutation adds an
  explicit scope check on top — `BranchController.requireBranchScope()`,
  `QueueService.requireManageAccess()`, `CounterService.assertBranchAccess()`,
  `StaffService`'s `requireStaffInScope()` — all following the same shape:
  `ORG_ADMIN` passes for anything in their own organization, anyone below that
  rank must also match `user.branchId`, and a mismatch reads as `NotFound`
  rather than `Forbidden` so a guessed id from another branch doesn't even
  confirm it exists.

## 6. Domain model and the one true ordering

Core entity is `Token` (`apps/api/prisma/schema.prisma`). Its place in line is
a single float, `sortKey` (`joinedAt` minus a priority time-credit — see
`packages/core`... actually `apps/api/src/queues/queue.util.ts`:
`sortKeyFor()`). Every query that walks a line orders by the same
`IN_LINE_ORDER = [{ sortKey: asc }, { id: asc }]` constant, so the customer's
phone, the staff board, and the "who's called next" query can never disagree
about who's ahead of whom.

Token status machine:
`WAITING → CALLED/SERVING → COMPLETED`, with `RECALL_PENDING` (customer didn't
answer a call, gets a grace window) and `NO_SHOW`/`CANCELLED` as exits.
`RecallScheduler` (cron, every 30s) sweeps expired `RECALL_PENDING` tokens to
`NO_SHOW` so a no-show can't block the line forever.

Two staff-initiated overrides sit outside the normal `next()`/`recall()`/
`skip()`/`complete()` flow, both audited via the event log rather than a new
column: `TokenService.transfer()` moves a `WAITING`/`RECALL_PENDING` token to
a different queue in the same branch, recomputing `sortKey` from the token's
*original* `joinedAt` so wait credit carries across the move; `TokenService.
changePriority()` overrides the priority band and requires a `reason` string,
carried in the `PriorityChanged` event payload. `CounterService.callSpecific()`
is the FIFO-order escape hatch — same assignment logic as `next()` (both go
through a shared private `assignToken()`), just pulling a named token instead
of the queue head, with a `direct: true` payload flag on the emitted events
rather than a distinct event name.

## 7. ETA computation (`packages/core/src/eta.ts` + `apps/api/src/eta/`)

Pure, deterministic function — not a learned model — so it's auditable and
identical whether computed on the server or re-run on the client between
socket pushes (for the smooth client-side countdown). Inputs: people ahead
(minus recall-pending, weighted at 35% since most resolve to no-shows),
open counters, rolling service-time mean/stddev (last 50 completions, cached
30s), and an hour-of-day load curve. `EtaService.buildContext()` computes this
once per queue per recalculation pass, not once per token.

## 8. Realtime fan-out

`EventBusService` (in-process `EventEmitter`, one path for every event) is the
single write path: every domain event is both persisted to `QueueEvent`
(audit/analytics/replay) and emitted synchronously to subscribers.
`RealtimeGateway` (Socket.IO) is the only subscriber today. On each event it
fans out to up to three rooms: `branch:<id>`, `queue:<id>`, `token:<id>` — a
client only ever receives events for rooms it explicitly subscribed to (ids
it was already handed by an endpoint it was allowed to call).

Comment in the code marks this as the seam where Kafka/RabbitMQ would go if
this needed to scale past one node — `publish()` becomes a producer call,
subscribers become consumer groups, nothing upstream changes.

## 9. Scheduled jobs

`RecallScheduler.expireRecalls()` — `@Cron(EVERY_30_SECONDS)`. Finds
`RECALL_PENDING` tokens past `recallExpiresAt`, flips them to `NO_SHOW`,
publishes `CustomerNoShow`, recalculates the affected queues. Noted in the
code as a stand-in for a BullMQ delayed job (fires once exactly on time)
until Redis is part of the stack.

## 10. Frontend entry points and execution order

Next.js App Router — `apps/web/src/app/layout.tsx` is the root shell (fonts,
metadata); every route below it is `'use client'` and fetches its own data.
There is no server-side data fetching in this app — every page is a client
component that calls the NestJS API directly.

Routes (all under `apps/web/src/app/`):

| Route | Page | Audience |
|---|---|---|
| `/` | `page.tsx` | Public — branch picker/launcher |
| `/login` | `login/page.tsx` | Staff sign-in |
| `/dashboard/[branchId]` | `dashboard/[branchId]/page.tsx` | Staff — operator mission control |
| `/queues/[queueId]` | `queues/[queueId]/page.tsx` | Staff — single queue detail + pause/resume |
| `/counter/[counterId]` | `counter/[counterId]/page.tsx` | Staff (login-gated in the component) — the 4-button tablet |
| `/checkin/[branchId]` | `checkin/[branchId]/page.tsx` | Public — kiosk/QR self check-in |
| `/display/[queueId]` | `display/[queueId]/page.tsx` | Public — lobby TV board |
| `/t/[code]` | `t/[code]/page.tsx` | Public — the customer's own status/ETA screen |
| `/setup/branches` | `setup/branches/page.tsx` | Staff (`BRANCH_MANAGER`+) — create/edit branches |
| `/setup/branches/[branchId]/queues` | `.../queues/page.tsx` | Staff — create/edit queues + their service types |
| `/setup/branches/[branchId]/counters` | `.../counters/page.tsx` | Staff — create/edit counters, assign queue/staff |
| `/setup/staff` | `setup/staff/page.tsx` | Staff (`BRANCH_MANAGER`+) — org staff directory, roles, password reset |

The `/setup/*` pages use a separate, simpler `SetupShell` (a header + two tabs)
rather than the per-branch `AppShell` — they're org-wide CRUD, not a branch
mission-control screen. `AppShell` itself only shows its "Setup" nav link once
`api.me()` resolves a role at or above `BRANCH_MANAGER`.

Every operational page follows the same pattern, built on two hooks in
`apps/web/src/lib/`:

```
mount
  → useLive(key, loadFn, subscription, options)
      → immediately calls loadFn() (one of the apps/web/src/lib/api.ts
        functions, which hits NestJS at /api/*)
      → opens/reuses ONE shared Socket.IO connection (per browser tab)
      → emits 'subscribe' with {branchId | queueIds | tokenIds}
      → on any matching realtime event (see REFRESH_EVENTS list), debounces
        150ms then re-calls loadFn() — so a single NEXT press that fires
        3 events doesn't cause 3 visible refreshes
      → also polls every 30s (15s on the customer token screen) as a
        fallback for flaky venue wifi where the socket silently drops
  → useEffect(() => setVertical(data.vertical), [data.vertical]) once data
    loads, so terminology/colors come from the branch's vertical
```

`ThemeProvider` mounts exactly once, globally, in `layout.tsx` — pages no
longer wrap themselves in a local instance; they just call `setVertical()`
from `useTheme()` once their data's vertical is known. `api.ts`'s `request()`
clears the stored JWT on any `401` response, so an expired/corrupted token
surfaces as the next navigation landing on `/login` rather than a frozen
error; `AppShell` carries the sign-out control that clears it deliberately.

`api.ts` is the single HTTP client — every function maps 1:1 to a backend
endpoint, prefixes `${API_URL}/api`, attaches the stored JWT (localStorage)
as a Bearer token when present, and normalizes API error bodies into a
readable message.

## 11. Endpoint reference

All paths are relative to `/api`. **Auth** column: `public` = no token
needed; a role name = minimum role via `@MinRole`; blank = any authenticated
staff user.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/login` | public | Staff sign-in → JWT |
| GET | `/auth/me` | any staff | Returns the decoded JWT payload |
| GET | `/verticals` | public | All 6 vertical profiles (terminology/theme/journey) |
| GET | `/branches` | public | List branches for the launcher page |
| POST | `/branches` | ORG_ADMIN | Create a branch in the caller's own organization |
| PATCH | `/branches/:id` | ORG_ADMIN | Edit a branch's name/code/vertical/hours/address |
| GET | `/branches/:id/overview` | public | Dashboard bundle: stats, queues, timeline, activity, insights, forecast, counters — one round trip |
| GET | `/branches/:id/queues` | public | Queue snapshots for a branch |
| GET | `/branches/:id/queue-config` | public | Raw queue rows (config fields, not the live snapshot) for the setup page |
| POST | `/branches/:id/queues` | BRANCH_MANAGER | Create a queue in this branch |
| GET | `/branches/:id/activity` | public | Recent event-log entries |
| GET | `/branches/:id/counters` | public | Counters for a branch (picker on the tablet, and the setup page) |
| POST | `/branches/:id/counters` | BRANCH_MANAGER | Create a counter in this branch |
| GET | `/queues/:id` | public | One queue's live snapshot |
| GET | `/queues/:id/display` | public | Snapshot + branch/vertical context, for the TV board |
| GET | `/queues/:id/service-types` | public | Service types configured on this queue |
| POST | `/queues/:id/service-types` | BRANCH_MANAGER | Add a service type to this queue |
| PATCH | `/queues/:id/service-types/:serviceTypeId` | BRANCH_MANAGER | Edit a service type |
| DELETE | `/queues/:id/service-types/:serviceTypeId` | BRANCH_MANAGER | Remove a service type |
| POST | `/queues/:id/tokens` | public | Self check-in — creates a Token, returns its status |
| POST | `/queues/:id/status` | BRANCH_MANAGER | Open/pause/close a queue |
| POST | `/queues/:id/recalculate` | RECEPTION | Force an ETA recalculation |
| PATCH | `/queues/:id` | BRANCH_MANAGER | Edit queue config (name/department/prefix/baseline/recall settings) |
| POST | `/tokens/:id/transfer` | BRANCH_MANAGER | Move a waiting/recalled token to a different queue in the same branch |
| POST | `/tokens/:id/priority` | BRANCH_MANAGER | Override a token's priority band (reason required) |
| GET | `/counters/:id` | COUNTER_STAFF | Counter view: current token, up-next list |
| POST | `/counters/:id/next` | COUNTER_STAFF | Call the next waiting token |
| POST | `/counters/:id/call/:tokenId` | COUNTER_STAFF | Call a specific waiting token out of FIFO order |
| POST | `/counters/:id/recall` | COUNTER_STAFF | Mark current token RECALL_PENDING |
| POST | `/counters/:id/skip` | COUNTER_STAFF | Mark current token NO_SHOW |
| POST | `/counters/:id/complete` | COUNTER_STAFF | Mark current token COMPLETED |
| POST | `/counters/:id/provider` | COUNTER_STAFF | Set the doctor/stylist/officer name shown on this counter |
| POST | `/counters/:id/status` | COUNTER_STAFF | Set counter to IDLE/BREAK/CLOSED |
| PATCH | `/counters/:id` | BRANCH_MANAGER | Edit counter config (name/queue/staff assignment) |
| GET | `/staff` | BRANCH_MANAGER | List staff in caller's org (own branch only, unless ORG_ADMIN) |
| POST | `/staff` | BRANCH_MANAGER | Create a staff account (rank-limited — see §5) |
| PATCH | `/staff/:id` | BRANCH_MANAGER | Edit a staff account's name/role/branch/active flag |
| POST | `/staff/:id/reset-password` | BRANCH_MANAGER | Set a new password for a staff account |
| GET | `/t/:code` | public (code is the credential) | Customer's own token status + live ETA |
| GET | `/t/:code/notifications` | public | Notification history for one token |
| POST | `/t/:code/confirm-recall` | public | "Still coming?" → YES |
| POST | `/t/:code/cancel` | public | "Still coming?" → NO / leave queue |
| POST | `/t/:code/feedback` | public | Post-visit 1–5 star rating |

Plus one WebSocket namespace (default `/socket.io`, same port as the API):
clients emit `subscribe`/`unsubscribe` with `{ branchId?, queueIds?,
tokenIds?, counterIds? }`; server emits domain events on the
`queueos:event` channel, scoped to rooms the client joined.

## 12. Local dev / data

- DB: SQLite file at `apps/api/prisma/queueos.db` (chosen because the dev
  machine has no Docker/Postgres — see the comment at the top of
  `schema.prisma` for the exact migration path to Postgres later).
- `npm run setup` (root): installs deps, builds `@queueos/core`, pushes the
  Prisma schema, seeds demo data (4 orgs across 4 verticals, realistic
  same-day history so the ETA model has something to compute from).
- `npm run dev` (root): builds core, then runs API and web concurrently.
- `apps/api/test-flow.sh`: an executable end-to-end smoke test of the exact
  lifecycle above (login → check-in → priority ordering → NEXT → RECALL →
  confirm → COMPLETE → RBAC checks → transfer/priority-override/call-specific).
  Good reference for "what does a full journey look like in practice."
