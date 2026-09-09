# Build Plan — Queue Flow Architecture & Platform Rework

Everything agreed across the 2026-09-06/07 conversation, sequenced into one
build order. Supersedes `queue-flow-design.md` §9 (folded in here as
Phases 4–8) and updates the direction in `plan.md`. See `decision.md` for
the reasoning trail as each phase lands.

**Ordering principle:** infrastructure and security first (nothing should be
built on a leaking, single-tenant-confused, wrong-database foundation);
cheap/low-risk renames next, while there's still no real customer data to
migrate; then the actual flow engine, in the same dependency order as
`queue-flow-design.md` §9.

---

## Phase 0 — Move to Postgres

**Why first:** every phase after this touches the schema. Migrating once,
now, before real data exists, is nearly free. Migrating later, with live
tenants, is not.

- `apps/api/prisma/schema.prisma`: `datasource db { provider = "postgresql" }`
- `apps/api/.env`: `DATABASE_URL` → the local Postgres connection string
  (needed from you — host/port/db name/user/password, or a full
  `postgresql://` URL)
- `prisma db push` + `prisma generate` + reseed
- Enum-like columns stay validated `String`s for now (the schema's own
  comment already calls this optional — promoting them to native Postgres
  enums is a nice-to-have, not required, and adds risk for no behavior
  change)
- Verify: app boots, `apps/api/test-flow.sh` passes unmodified

**Blocked on:** your Postgres credentials.

---

## Phase 1 — Fix the tenant-isolation leak

**Why here:** this is a real, demonstrated data leak (confirmed live in this
conversation — an unauthenticated request pulled another business's customer
names). Fixing it after Phases 4–8 would mean re-auditing every new endpoint
those phases add; fixing it now means every later phase inherits a correct
default.

The root cause: `GET /branches/:id/overview` (and siblings) bundle
customer-facing data (queue list, wait times — needed by check-in, no login)
together with staff-only data (customer names, activity log, revenue-adjacent
stats, insights) in one `@Public()` response. The fix is splitting the
bundle, not just slapping `@MinRole` on the existing endpoint (that would
break check-in, which legitimately needs no login).

- New, genuinely public, minimal endpoint — e.g. `GET /branches/:id/checkin-info`:
  branch/org name, vertical, open queues with wait time and position only.
  Used by `/checkin/[branchId]`, `/display/[queueId]`.
- `GET /branches/:id/overview` becomes authenticated + org/branch-scoped
  (reuse the `requireBranchScope`/`requireManageAccess` pattern already
  built for the setup endpoints). Used only by `/dashboard/[branchId]`.
- `GET /branches` (list-all-businesses): this currently powers the root `/`
  page as a public directory of every business on the platform, which
  doesn't belong in a real multi-tenant product — no anonymous visitor
  should browse every registered business. Scope it to the caller's own
  org (auth required); the root page's job changes in Phase 3.
- Update `dashboard/[branchId]/page.tsx` to actually check auth (it
  currently doesn't at all — a real gap, distinct from the API-level leak).
- Verify: log in as one org's Owner, confirm `/dashboard/<another org's
  branch id>` and a raw `curl` with no token both fail.

---

## Phase 2 — Role rename: Owner / Admin, no cross-business role

**Why here:** cheap now (no real customer data yet), and every later phase's
permission checks should be written against the final names, not the old
`ORG_ADMIN`/`BRANCH_MANAGER` ones.

- `packages/core/src/enums.ts`: rename `ORG_ADMIN` → `OWNER`,
  `BRANCH_MANAGER` → `ADMIN` in `ROLES`/`ROLE_RANK`. `SUPER_ADMIN` stays in
  the enum as an inert, unassignable value — no capability is ever built
  around it, per the explicit decision that no role should see across
  businesses.
- Update every `@MinRole(...)` reference across the API
  (`branch.controller.ts`, `queue.controller.ts`, `counter.controller.ts`,
  `staff.controller.ts`, `staff.service.ts`'s `assertCanManage`) and every
  `ROLE_RANK.ORG_ADMIN`/`ROLE_RANK.BRANCH_MANAGER` reference on the web side
  (`/setup/*` pages, `app-shell.tsx`).
- `staff.dto.ts`'s `ASSIGNABLE_ROLES` updates to the new names (already
  excludes `SUPER_ADMIN`/`CUSTOMER` — that exclusion carries over unchanged).
- `seed.ts` role loop updates to match.
- Verify: `npm run typecheck` (a renamed enum value makes every stale
  reference a compile error — the rename is largely self-checking),
  `test-flow.sh`.

---

## Phase 3 — Self-service business registration

**Why here:** the root `/` page's job just changed in Phase 1 (no more
public business directory) — this is what replaces it, and it needs the
Phase 2 role names to create the right kind of account.

- `POST /auth/register` (public): business name, vertical, owner name/email/
  password → creates `Organization` + first `Branch` + `StaffUser` (role
  `OWNER`) in one transaction, returns a JWT (auto-login, matching the
  login flow's response shape).
- New `/register` web page.
- Root `/` page becomes the entry point: sign in, or register a new
  business — not a directory of existing ones.
- Verify: register a brand-new business end to end, confirm the new owner
  cannot see any seeded org's data (Phase 1's fix covers this, but worth
  re-confirming with a fresh account).

---

## Phase 4 — `Visit` entity

From `queue-flow-design.md` §6. Purely additive — no behavior change.

- Add `Visit` to the schema: `id`, `organizationId`, `branchId`,
  `customerId?`, `status` (OPEN/CLOSED), `source`, `vertical`, timestamps.
  One `Visit` per `Token` for now (1:1).
- `TokenService.join()` opens the `Visit` in the same transaction it
  creates the `Token`.
- Verify: every token has a visit; `test-flow.sh` unmodified and passing.

---

## Phase 5 — Stage ordering on `Queue`

From `queue-flow-design.md` §3 and §9 step 2. Still no behavior change —
this makes a flow *expressible*, not yet *enforced*.

- Add to `Queue`: `stageType` (validated string — `ENTRY`, `ORDERING`,
  `CONSULTATION`, `TRIAL`, `PAYMENT`, `PREPARATION`, `SERVICE`,
  `DEPARTMENT`, `CUSTOM`), `nextQueueId` (self-relation, nullable — "what
  stage follows this one"), `hasVisibleQueue` (boolean, default `true`).
- `/setup/branches/[id]/queues` page: set stage type + next-stage link when
  creating/editing a queue.
- Verify: can express every flow in `queue-flow-design.md` §4's tables as
  data (QSR's 3-stage chain, casual dining's 3-stage chain, a single-stage
  branch unchanged).

---

## Phase 6 — Auto-advance

From `queue-flow-design.md` §9 step 3. The first real behavior change —
and additive: a branch with no `nextQueueId` configured (every branch
today) sees no difference at all.

- On `ServiceCompleted` (or `PaymentCompleted`, once Phase 8 exists), if the
  completed queue has a `nextQueueId`, automatically create/advance the
  customer's token into that next queue for the same `Visit` — reusing the
  wait-credit-preserving `sortKey` logic already built for manual transfer.
- The existing manual transfer endpoint becomes the override for the
  exception case (skip a stage, correct a mistake), not the primary
  mechanism.
- Verify: configure a 2-stage test flow (Order → Pickup), complete stage 1,
  confirm the token appears in stage 2 automatically with wait time
  preserved.

---

## Phase 7 — Flow-builder onboarding

From `queue-flow-design.md` §7 and §9 step 4.

- Extend the registration/branch-setup flow: instead of only picking a
  vertical, walk through stage count/type/order, with starting templates
  per the shapes in `queue-flow-design.md` §4 (QSR, Udupi-style, casual
  dining, Zudio-style retail, big-box multi-department, ...). Fully
  editable after — templates are a starting point, not a lock-in.
- Vertical (wording/theme) and flow template (stage structure) become two
  independent choices, per §7's split.
- Verify: create a branch from the QSR template, confirm it provisions a
  2-stage chain with `nextQueueId` wired correctly; same for a single-stage
  template (should look identical to today's behavior).

---

## Phase 8 — Payment stage + minimal commerce

From `queue-flow-design.md` §9 step 5 — where the earlier POS discussion
actually plugs in. Deliberately the smallest slice that makes a
`PAYMENT`-typed stage functionally gate whatever comes after it — not the
full POS UI (cart, tax, receipts, inventory), which stays its own larger
follow-on effort per `plan.md`.

- Minimal `Order`/`Payment` entities, tied to `Visit`.
- A `PAYMENT`-typed stage's "complete" trigger becomes "payment recorded,"
  not a staff button — wired into the same auto-advance mechanism from
  Phase 6.
- Everything else from the original POS plan (cart UI, GST invoicing,
  inventory, loyalty) stays deferred, unaffected by this phase.

---

## What this replaces

- `plan.md`'s "Phase 0 — Visit backbone" is now Phase 4 here, with three
  necessary phases (Postgres, tenant-isolation, registration) correctly
  sequenced before it instead of assumed away.
- `queue-flow-design.md` §9's 5 steps are Phases 4–8 here, unchanged in
  substance, renumbered to show what actually has to happen first.
