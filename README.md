# QueueOS

A multi-tenant virtual queue management platform: one hosted engine, every
business's queue shape expressed as data instead of hardcoded per industry.
See [`queue-flow-design.md`](queue-flow-design.md) for the "stages, not
industries" architecture, and [`decision.md`](decision.md) for the full
build history and rationale.

## Stack

- **`apps/api`** — NestJS on Fastify, Prisma + PostgreSQL, JWT auth, Socket.IO for realtime fan-out.
- **`apps/web`** — Next.js 15 (App Router), talks to the API over REST + a websocket.
- **`packages/core`** — framework-free domain logic (enums, verticals, flow templates, ETA math, event contracts) shared by both apps as `@queueos/core`.

## Prerequisites

- Node.js 22+
- A running PostgreSQL instance (local or hosted) and its connection string

## Setup

1. Install dependencies and build the shared package:

   ```bash
   npm install
   ```

2. Configure the API's environment. Copy the example and fill in your own database:

   ```bash
   cp apps/api/.env.example apps/api/.env
   ```

   | Variable | Description |
   |---|---|
   | `DATABASE_URL` | Postgres connection string |
   | `PORT` | API port (default `4000`) |
   | `WEB_ORIGIN` | Origin allowed for CORS/websocket (default `http://localhost:3000`) |
   | `JWT_SECRET` | Signing secret for session tokens — required, no default |
   | `JWT_EXPIRES_IN` | Session lifetime (default `12h`) |

3. Make sure the database in your connection string actually exists —
   Prisma creates tables, not the database itself:

   ```bash
   createdb QueueOS   # or: psql -c 'CREATE DATABASE "QueueOS";'
   ```

   Then push the schema and seed demo data:

   ```bash
   npm run db:push
   npm run db:seed
   ```

   Or do all of the above (install, build core, push, seed) in one shot:

   ```bash
   npm run setup
   ```

## Running

```bash
npm run dev
```

Starts the API on [http://localhost:4000](http://localhost:4000) and the
web app on [http://localhost:3000](http://localhost:3000) together. Run
`npm run dev:api` / `npm run dev:web` to start either one alone.

## Trying it out

The seed script creates four demo businesses, one per vertical (hospital,
temple, restaurant, salon), each with an owner/admin/reception/counter
account. Log in at `/login` with:

- **Email**: `owner@apollo.queueos.dev` (or `admin@`, `reception@`, `counter@` — also available for `balaji`, `burger-junction`, and `glow-studio`)
- **Password**: `queueos123`

Or register a brand-new business from scratch at `/register`, picking a
vertical and a starting flow template (QSR, casual dining, apparel retail,
big-box, single-queue, ...).

## Other scripts

| Command | What it does |
|---|---|
| `npm run typecheck` | Type-checks all three workspaces |
| `npm run db:reset` | **Destructive** — drops and re-seeds the database |
| `npm run db:studio` (from `apps/api`) | Opens Prisma Studio against the configured database |
| `bash apps/api/test-flow.sh` | End-to-end smoke test against a running API (login, check-in, queue ops, RBAC) |

## Docs

- [`queue-flow-design.md`](queue-flow-design.md) — the stage/flow architecture
- [`build-plan.md`](build-plan.md) — the phased build sequence this codebase was implemented against
- [`decision.md`](decision.md) — dated log of every notable decision, why, and how it was verified
