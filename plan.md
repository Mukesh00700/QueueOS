# Implementation Plan — QueueOS → Unified Customer Flow, Queue & POS OS

> **Status note (2026-09-06):** before starting Phase 0, the project owner
> asked to first finish the *pure-queue* product on its own — admin/setup UI,
> the missing queue operations (transfer/priority-override/call-specific),
> and a hardening pass — with POS/commerce still deliberately deferred. That
> work is done; see `decision.md`'s four entries from 2026-09-06 for what
> shipped. Nothing below has changed as a result — Phase 0 is still the right
> next step whenever POS work begins.

**Sources:** the target-state doc, distilled in [`requirements-summary.md`](./requirements-summary.md); the current system, described in [`flow.md`](./flow.md). This plan is the gap between them, turned into build order. Read this file top to bottom before starting Phase 0 — per the standing practice in [`decision.md`](./decision.md), each phase below gets its own decision.md entry when it starts, and a short quiz back to the project owner before the first schema change.

## The one-line gap

Today's QueueOS **is** the doc's Chapter 10 (Queue Management Module), plus a seed of Chapter 6/23 (a rule-based `InsightsService` that already does live recommendations and hour-of-week forecasting). Chapters 11–31 — POS, CRM, retention, inventory, loyalty, marketing, commerce analytics, multi-branch enterprise — are greenfield: **zero commerce entities exist in `schema.prisma` today.** No Order, no Invoice, no Payment, no Product, no Visit.

## Why this is "extend," not "rebuild"

The doc's two make-or-break architectural rules are already how this codebase thinks, which changes the size of the actual task:

- **Deterministic, explainable engines over ML.** `EtaService` and `InsightsService` are rule-based by design — the comment in `insights.service.ts` calls this out explicitly: "rules over live queue state, not a language model... the reasoning [must be] auditable." That is exactly Chapter 23's non-negotiable (every prediction scored, confidence shown, no black boxes). Extending these services with commerce inputs is most of Phase 2/3/4's "AI" work — there is no new ML infrastructure to stand up.
- **Event-sourced state changes.** `EventBusService` + the append-only `QueueEvent` table + `RealtimeGateway` already give every mutation a name, a persisted payload, and a subscriber fan-out. That is Chapter 29's Unified Event Engine, already built. Commerce events extend the same union type and the same bus — they don't replace it.
- **Vertical differences as data, never forks.** `verticals.ts` already implements Chapter 24's "one codebase, four personalities" rule. The `ROLES` enum already anticipates commerce roles (`CASHIER`, `PROVIDER`, `RECEPTION` all exist today, unused by any commerce feature yet).
- **SQLite → Postgres discipline.** The schema already stores every enum as a validated `String` for portability. Every new commerce table must hold that same discipline.

So the plan below is Chapter 5's own instruction: extend the same spine, don't build a second one beside it.

## The one non-negotiable, before any feature work

Chapter 5's rule: every commercial and operational row carries a `visit_id`. Retrofitting this after commerce tables already exist is the doc's explicitly named failure mode ("two customer tables merged on a schedule... within months the merchant has two versions of the truth"). So the very first schema change — before POS, before anything — is a `Visit` model, with `Token` hanging off it.

---

## Phase 0 — Visit backbone (prerequisite, ~1–2 weeks)

Goal: introduce the backbone entity without changing any user-facing behavior yet.

- Add `Visit` to `schema.prisma`: `id`, `organizationId`, `branchId`, `customerId?`, `status` (OPEN/CLOSED), `source`, `vertical`, timestamps. One `Visit` per `Token` for now (1:1) — don't design for multi-token visits (e.g. a party of four) until a vertical actually needs it.
- `Token` gets a required `visitId`. `TokenService.create()` opens the `Visit` in the same transaction it creates the `Token` — this is step 1 of Chapter 12's fourteen steps, and it's also the module convention "a session is opened by a queue event, not a staff action," landed a phase early because it costs nothing to do now and everything to retrofit later.
- No new UI, no new endpoints. One paragraph added to `flow.md` once done.
- **Explicitly not doing yet:** Order, Invoice, Payment, Stock — a `Visit` with nothing hanging off it is a legitimate, boring intermediate state. Building commerce tables before there's a Phase-1 feature to attach them to is exactly the kind of speculative work the doc's own 9.5/10 bar exists to keep out.

**Exit criterion:** every `Token` has a `Visit`; nothing else changed; existing test-flow.sh still passes unmodified.

---

## Phase 1 — Foundation: the POS itself (doc's months 0–4, zero dependencies)

This is the bulk of the effort and the only phase the doc treats as buildable without prior data.

### 1a. Commerce data model
All new tables key through `visitId`, per Chapter 5's rule:
- `Product` — org-scoped SKU catalogue (name, price, HSN/SAC, category).
- `Order` / `OrderItem` — `OrderItem.staffUserId` on every line (the line-level attribution the doc insists makes commission/productivity honest).
- `Invoice` (series, GST split, per-line HSN/SAC) / `Payment` (tender, amount — one invoice, many payments).
- `StockMovement` — append-only ledger, no separate "current stock" table; stock-on-hand is computed by summing movements, the same pattern `QueueEvent` already uses for history.

New enums in `packages/core/src/enums.ts`: `ORDER_STATUSES`, `PAYMENT_METHODS`, `TENDER_STATUSES`. New events appended to the existing `QUEUE_EVENTS` union in `events.ts`: `PosSessionOpened`, `OrderLineAdded`, `PaymentCompleted`, `InvoiceIssued` — same bus, same envelope shape, per the doc's own "commerce events extend the same contract" instruction.

### 1b. Queue → POS trigger wiring (Chapter 12 — "the single most important chapter")
- `TokenService`'s existing `create → emit → recalculate` sequence already emits `ServiceStarted`. Extend that one handler so it also opens (or attaches to) the `Order` on the `Visit`, pre-filled with the token's `serviceTypeId` as the first line. **A "New Sale" button that a staff member has to press for a queued customer is the exact failure mode Chapter 12 names** — the session must open because the queue event fired, not because someone clicked something.
- New `apps/api/src/pos/` module (`PosService`, `PosController`) — same one-service-per-domain shape as `queues/`, `tokens/`, `counters/` already use.

### 1c. POS UI
- Fold this into the existing counter workflow rather than inventing a parallel surface: a counter already **is** the POS terminal in this data model, so extend `apps/web/src/app/counter/[counterId]/page.tsx` (or a sibling route reading the same counter/session state) rather than building a disconnected `/pos` app.
- Layout B from Chapter 33: customer strip on top, catalogue tabs (queue/services/products) left, cart right, fixed tender row at bottom. Built on the `Card`/`Pill`/`ui/index.tsx` kit already in `apps/web/src/components/ui/` — no new design system, no new component library.
- Realtime cart/session updates reuse the existing `useLive` hook — same subscribe/debounce/poll-fallback pattern every other page already uses.

### 1d. Tax, invoice, payment (deliberately minimal)
- GST calc: a flat rate table by category in `packages/core`, not an external tax service.
- Invoice series: one incrementing counter per branch (mirrors how `Queue.nextNumber` already works for token numbers).
- Four tender buttons (UPI/card/cash/split) recording the tender only — no real payment-gateway integration yet. Mark payments `SIMULATED`, the same way `Notification.status` already is until a gateway exists. Wiring an actual UPI/card gateway is real, gated work that belongs once there's a merchant to process for — building it speculatively now would be exactly the kind of premature infrastructure the doc's "ease of implementation" criterion is meant to catch.

### 1e. Shift close & reconciliation
- `POST /counters/:id/close-shift`, blocked while that counter has a token in `SERVING` — mirrors the existing rule-of-thumb already used elsewhere in this codebase (state transitions check for in-progress work before allowing the next one). Cash declared vs. expected, variance shown. No gateway-settlement reconciliation yet — there's no gateway to reconcile against until 1d grows one.

### 1f. Basic inventory
- `Product` + `StockMovement` only. No supplier/PO/GRN workflow — Chapter 16's procurement pages need a forecast to size purchase orders against, which doesn't exist until Phase 4. Depletion = one `StockMovement` row per `OrderItem` at sale time.

### Explicitly deferred out of Phase 1
Gift cards, membership, loyalty, kitchen display system, multi-way split-by-item — all Phase 2/3/DEFER in the doc's own scoring matrix. Don't build any of them now.

**Exit criterion (the doc's own Phase-1 test):** a merchant can run check-in → queue → service → sale → GST invoice → payment → shift close, entirely inside this app, every row reachable from one `visitId`.

---

## Phase 2 — Intelligence (doc's months 3–7; don't start until Phase 1 data has been flowing ~4 weeks)

- **Customer 360** (`apps/web/src/app/customers/[customerId]/page.tsx`, Layout D) — a read/aggregation page over Token+Order+Payment+Feedback by customer. No new write paths.
- **CRM segmentation** — a nightly scheduled job (reuse `@nestjs/schedule`, already wired for `RecallScheduler`) computing the Chapter 14 segments into a `customerId → segment` cache. Nightly, not streamed — real-time segmentation isn't needed until Phase 3's retention plays require it, so don't build it early.
- **Loyalty & points** — `LoyaltyAccount` model, accrual triggered off the existing `PaymentCompleted` event (event-driven, matching Chapter 5's explicit instruction — never a nightly job).
- **Analytics extension** — extend `InsightsService` and the existing `/branches/:id/overview` bundle with `Order`/`Payment` as additional inputs, rather than standing up a parallel analytics service. It already computes rule-based, explainable, ranked recommendations over `QueueEvent`.
- **Wait-adjusted staff productivity & abandonment-priced-to-basket** — both are new fields computed from data Phase 1 already wrote (abandonment count × `Order.expectedValue`) — no new subsystem, just new queries.

---

## Phase 3 — Retention (doc's months 6–11; needs ≥1 full visit cycle of history per customer)

- Health score (8 signals, Chapter 27) recomputed on `VisitCompleted`/`PaymentCompleted`/`FeedbackSubmitted` — same event-driven pattern as loyalty accrual in Phase 2.
- Four bands + one play per band, logged with outcome (`RetentionPlay`: band, action, issuedAt, outcome). Build the closed-loop *measurement* first; hold off on the down-weighting logic itself until there's enough play history to down-weight against — building an auto-tuning loop before it has data to tune on is speculative.
- Marketing trigger catalogue reuses the existing `Notification` model and channel plumbing — new trigger types, not a new messaging stack.

---

## Phase 4 — Prediction (doc's months 9–14; needs ≥12 weeks of data)

- Extend `InsightsService.forecast()` — it already does hour-of-week load-curve arrival forecasting — to also forecast revenue and stock consumption. Same function, more outputs, not a new model class.
- This is the first phase where "do we actually need ML" becomes a fair question. Defer that decision until Phase 4 planning, informed by how well the existing heuristic forecast has tracked its own scored accuracy (ship the accuracy-scoring loop in Phase 2/3, alongside the forecasts it will later judge — the doc requires every forecast to publish its own accuracy, so the scorer has to exist before there's anything worth scoring).

---

## Phase 5 — Platform (doc's months 12–18)

Multi-branch roll-up, central catalogue/pricing, public API/webhooks. Mostly read-side aggregation across branches — every table in this schema is already scoped by `organizationId`/`branchId`, which is the multi-tenancy prerequisite Chapter 5.3 calls out. Nothing to retrofit here; it falls out of decisions already made.

---

## Customer-facing surfaces: what's already built

Chapter 26 lists 17 required customer surfaces. Mapping them against the current 7 web routes:

| # | Surface | Status |
|---|---|---|
| 1–5 | QR landing → select service → join → confirm → token generated | **Exists** — `checkin/[branchId]` |
| 6–7 | Live queue position, ETA with confidence | **Exists** — `t/[code]` |
| 8–9 | Notifications, "turn is near" | **Exists but SIMULATED** — `Notification` model has no real delivery channel wired up |
| 10 | Service started | Exists as a state on `t/[code]`'s timeline |
| 11–14 | Order summary, bill, payment, receipt | **New — gated on Phase 1 (POS)** |
| 15 | Feedback | **Exists** — `POST /t/:code/feedback` |
| 16 | Loyalty balance | **New — gated on Phase 2 (loyalty)** |
| 17 | Next visit | **New — gated on Phase 3 (retention)** |

Nine of seventeen already exist. The remaining eight are exactly the ones gated behind Phase 1–3 above — nothing extra to plan for here beyond what's already scheduled.

---

## What NOT to build, at any phase

Carried forward from Chapter 38 as a standing constraint on this whole plan, not just Phase 1: no vanity dashboards, no large report library, no complicated staff interfaces (menu+search+form on the floor), no required customer app, no generic AI chatbot, no payroll/accounting/HR suites, no complex loyalty rule builder, no excessive notification toggles, no duplicate data entry anywhere, no app marketplace before Phase 5, no full offline-first POS (ship resilient degradation instead — queue actions locally, replay in order), no staff surveillance (idle-time monitoring, location tracking, default-published rankings).

---

## Cross-cutting notes

- **Roles:** `ROLES` already has everything Phase 1–2 need (`CASHIER`, `PROVIDER`, `RECEPTION`, `BRANCH_MANAGER`, `ORG_ADMIN`). No RBAC rework needed until an accountant-only tax page (Chapter 9) is actually built — add an `ACCOUNTANT` role then, not speculatively now.
- **Postgres migration path:** unaffected by this plan as long as every new enum-like column stays a validated `String`, per the existing schema comment.
- **Per this repo's own decision.md practice:** each phase above gets a decision.md entry when it starts, and — since Phase 0 is the first schema change — a short quiz back to the project owner before it begins.

## Suggested immediate next step

Phase 0 (Visit backbone) is small, reversible, and unblocks every phase after it. Recommend starting there.
