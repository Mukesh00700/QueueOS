# Decisions Log

Every meaningful decision made while working on this codebase — feature choices,
refactors, trade-offs, things rejected and why — gets an entry here, newest on
top. "Meaningful" means: someone reading this in six months would otherwise
have to guess *why* the code looks the way it does.

Small mechanical edits (renames, formatting, typo fixes) don't need an entry.
Anything that changes behavior, data shape, an API contract, or picks one
approach over a plausible alternative, does.

## Entry format

```
## YYYY-MM-DD — Short title

**Decision:** what was done.
**Reason:** why, including what problem it solves or what it avoids.
**Alternatives considered:** (optional) what else was on the table and why it lost.
**Impact:** what this touches — files, contracts, behavior a user/operator would notice.
```

---

## 2026-09-09 — Payment stage + minimal commerce (Phase 8 of `build-plan.md`)

**Decision:** Two new models, deliberately minimal — no cart, no line
items, no tax: `Order` (`organizationId`, `branchId`, `visitId`, `amount`,
`status` OPEN/PAID, `createdAt`) and `Payment` (`orderId` unique — 1:1,
`amount`, `method` from new `PAYMENT_METHODS` in
`packages/core/src/enums.ts` — `CASH | CARD | UPI | WALLET`, `recordedBy`
as a loose actor id with no FK, same convention as `QueueEvent.actorId`).
`CounterService.complete()` now rejects with 400 when the counter's queue
has `stageType: 'PAYMENT'` — "record a payment to complete it," not the
staff button. New `CounterService.recordPayment(counterId, {amount,
method})` is the payment-stage equivalent: creates the Order+Payment pair,
then calls the *same* private `completeToken()` every other stage-closing
action already uses, passing `reason: 'PAYMENT_RECORDED'` plus an
`extraPayload` (new optional 5th param on `completeToken`, merged into the
published event's payload — `next()`/`skip()`'s existing call sites are
unaffected since they don't pass it). Because `completeToken()` is what
emits `ServiceCompleted`, and `AutoAdvanceService` from Phase 6 already
reacts to that event unconditionally, **no changes were needed to
auto-advance at all** — recording a payment advances the token into
`nextQueueId` exactly the same way finishing any other stage does. Web:
`CounterService.view()` now returns `stageType`; the counter tablet
(`apps/web/src/app/counter/[counterId]/page.tsx`) swaps the green
Complete tile for an amount field + four method buttons (Cash/Card/UPI/
Wallet, each submits immediately) when `stageType === 'PAYMENT'` — no new
screen, same tablet, same "few large buttons" constraint from the
counter's original design.

**Reason:** from `queue-flow-design.md` §5 and §9 step 5, and build-plan's
explicit framing — "deliberately the smallest slice that makes a
PAYMENT-typed stage functionally gate whatever comes after it," not the
full POS UI. Reusing `completeToken()` rather than inventing a parallel
completion path, and reusing the existing `ServiceCompleted` event with a
distinguishing `reason` rather than adding a genuinely new
`PaymentCompleted` event name (which queue-flow-design.md §8 had floated
as a possibility), is what let Phase 6's auto-advance consumer stay
completely untouched — literally "wired into the same mechanism," not a
lookalike one.

**Alternatives considered:** a new `PaymentCompleted` event name, with
`AutoAdvanceService` listening for it alongside `ServiceCompleted`.
Rejected — the `reason` field already exists on every completion event for
exactly this kind of distinction (`'COMPLETED'` vs `'AUTO_ON_NEXT'`
already coexist there), so a second event name would be a parallel
mechanism doing the same job, not a smaller one.

**Impact:** additive schema only (two new models, no column changes to
anything existing) — `prisma db push` needed no reset. `complete()`'s new
400 at a payment-stage counter is the one behavior change to an existing
endpoint, and it only fires where `stageType === 'PAYMENT'`, i.e. nowhere
before Phase 7's templates existed to create one.

**Verified:** live API — registered a QSR-template org, walked a real
token through Ordering (plain Complete) into Payment; confirmed the plain
`complete()` call on the Payment counter was rejected with the expected
message; called `record-payment` with `{amount: 249.50, method: "UPI"}`
and confirmed the Order (`status: PAID`) and Payment rows persisted
correctly linked to the visit, the activity feed showed
`reason: "PAYMENT_RECORDED"` with `amount`/`method` in the payload
(distinct from the plain `"COMPLETED"` on the Ordering stage), and a new
WAITING token appeared in Pickup — same auto-advance path as Phase 6,
now triggered by a real payment. Browser check: logged in as the
registered owner, worked a real customer through the actual counter
tablet UI — Order Counter's plain Complete button, then the Pay Counter
showing the amount field and four payment-method buttons in place of
Complete, entered ₹249.50, tapped UPI, watched the counter go IDLE and
the dashboard's Pickup line pick up the new arrival. `test-flow.sh` and
full `npm run typecheck` across all three workspaces stayed clean
throughout.

---

## 2026-09-09 — Flow-builder onboarding (Phase 7 of `build-plan.md`)

**Decision:** New `FLOW_TEMPLATES` in `packages/core/src/flow-templates.ts` —
six starting shapes (`single`, `qsr`, `token-style`, `casual-dining`,
`apparel-retail`, `big-box-retail`), each an ordered list of `{key, name,
stageType, tokenPrefix, hasVisibleQueue?, nextKey?}`. `nextKey` is a
template-local pointer, not a real id — a multi-source template like
`big-box-retail` has two stages (`Electronics`, `Customer Service`) whose
`nextKey` both point at `pay`, provisioning two independent queues that
converge on one shared Payment stage. New `apps/api/src/queues/
flow-provisioning.ts` exports `provisionFlow(tx, branchId, templateId)`:
creates every stage as a real `Queue` inside the caller's transaction, then
a second pass resolves `nextKey` to the real ids and wires `nextQueueId`.
Wired into two call sites: `AuthService.register()` (inside its existing
`$transaction`, right after the Main Branch is created — `flowTemplate`
defaults to `'single'` when omitted, so every registration provisions
*something*) and `BranchController.create()` (now itself wrapped in a
`$transaction` for the same atomicity; `flowTemplate` here is genuinely
optional — omitted entirely, a new branch gets zero queues, identical to
every branch created before this field existed). Per queue-flow-design.md
§7's "two independent choices," vertical and flow template are separate
form fields in both the register page and the Setup → Branches create
form — a new `FlowTemplatePicker` component (`apps/web/src/components/
flow-template-picker.tsx`) renders each template as a selectable card with
a live `stage → stage → stage` preview, shared by both forms. On the
branch-edit form (`BranchRow`) the picker is deliberately absent — the
edit path never gets a `flowPicker` prop — since re-provisioning a
template onto a branch that already has queues would create duplicates,
not replace anything.

**Reason:** from `queue-flow-design.md` §7 and §9 step 4 — replaces
"only picking a vertical" with the two-axis choice the design calls for,
using the shapes from §4's worked-examples tables (QSR, Udupi-style,
casual dining, Zudio-style retail, big-box multi-department) as the
starting templates, each fully editable afterward from the existing
Setup → Queues page (Phase 5). `PAYMENT`-typed stages are hardcoded
`hasVisibleQueue: false` in every template, matching §3's taxonomy table
("Payment ... Visible queue? No") rather than inferring it from the type
at provision time — simpler, and the one place a template author might
deliberately want to override it (there's no case for that yet, but the
field stays overridable per-stage either way).

**Alternatives considered:** inferring `hasVisibleQueue` from `stageType`
at provision time instead of stating it per template stage. Rejected —
it's one more layer of indirection for a value every template author
already has to think about anyway; stating it plainly in the template data
is the smaller diff.

**Impact:** no schema change. `RegisterDto` gains optional `flowTemplate`;
`CreateBranchDto` gains optional `flowTemplate`. No change to any existing
endpoint's behavior when the new field is omitted, except registration,
which now always provisions at least the single-queue template where it
previously provisioned nothing — a business owner now lands on a
dashboard with one ready-to-use queue instead of an empty one requiring a
manual first queue before check-in works at all.

**Verified:** via the live API — registering with `flowTemplate: "qsr"`
produced exactly `Ordering → Payment (invisible) → Pickup`, matching Model
B from §4; registering with no `flowTemplate` produced the single
`Main Queue` with `nextQueueId: null` (today's shape, unchanged); creating
a branch with `flowTemplate: "big-box-retail"` correctly gave both
`Electronics` and `Customer Service` a `nextQueueId` pointing at the same
`Payment` queue; creating a branch with no `flowTemplate` at all still
produced zero queues, confirming that call site's backward compatibility.
Browser check: registered a real account ("Browser QSR Co," Restaurant
vertical, Quick-service restaurant template) through the actual register
form — landed on a dashboard already showing three live queues, Ordering
/ Payment / Pickup, under "Live Order Lines." Setup → Branches' "New
branch" form shows the same picker. `test-flow.sh` and full `npm run
typecheck` across all three workspaces stayed clean throughout.

---

## 2026-09-09 — Stopping POS depth after `plan.md` 1a–1d

**Decision:** POS work stops here. `plan.md` Phase 1e (shift close/cash
reconciliation) and 1f (stock depletion — `StockMovement` has sat inert
since step 1, never gets written to) are **not built**. What exists:
`Product`/`OrderItem`/`Invoice`/`Payment` with real GST, an auto-opening
cart, and the counter tablet's POS terminal UI — but only for a branch
that deliberately configures a catalogue. Every branch that doesn't
(hospital, temple, salon, or any restaurant/retail branch that just
wants "type an amount, tap a tender button") is completely unaffected
and shows no trace of any of this.

**Reason:** talking through why the cart existed at all surfaced the
real question — this project's actual businesses span hospitals and
temples that have no payment step at all, alongside restaurants/retail
that do. The itemized-billing depth (GST, catalogue, per-line tender)
only pays for itself for the latter, and the user chose not to keep
building further into that depth (shift close, inventory) without a
concrete need for it yet.

**Impact:** the flat "type an amount, tap a tender button" path
(build-plan.md Phase 8) is the one universal payment story every
vertical gets. The itemized path is additive and fully opt-in — a
branch only sees it once it adds its first product. Resuming 1e/1f later
needs no rework of anything already built; both were designed as
additive from the start (`StockMovement` already exists and is already
correctly shaped, just unwritten-to).

---

## 2026-09-09 — Cart visibility fix + real GST calculation (`plan.md` 1d — POS foundation, step 3)

**Decision:** Two changes. First, a correction to step 2: the counter
tablet's cart section was showing on every branch's counter once someone
was being served, even branches that have never configured a single
Product — an empty "no products set up yet" card cluttering a hospital
or temple screen that has nothing to do with POS. Now gated on `products.
some(p => p.active)`: a branch with no catalogue shows zero trace of any
of this work, exactly as it looked before Phase 8 existed. Second, real
GST: `Product.gstRate` (percentage, one of the standard Indian slabs —
new `GST_RATES = [0, 5, 12, 18, 28]` in `packages/core`), snapshotted
onto `OrderItem.gstRate` at add-time (same reasoning as `unitPrice`/
`description` already being copied rather than live-joined — a later
rate change shouldn't rewrite an invoice that already went out).
`OrderService`'s existing `recomputeSubtotal` (renamed `recomputeTotals`)
now also sums `lineTotal * gstRate / 100` into a new denormalized
`Order.taxAmount`, alongside `subtotal` — same "recalculate on mutation"
shape. `CounterService.recordPayment` issues the invoice's `taxAmount`/
`total` from those real per-item rates; the ad-hoc "Payment" fallback
line (empty cart) keeps `taxAmount: 0` — a flat manually-typed amount
never gets a surprise tax added. Web: Setup → Products gained a GST-rate
select; the counter tablet's cart shows a Subtotal/GST/Total breakdown
when tax is nonzero, and the payment amount now pre-fills to the
tax-inclusive `order.total` instead of the pre-tax subtotal.

**Reason:** the cart-visibility gap came directly from the user
questioning why a queue system needs anything cart-shaped at all —
`plan.md`'s own Phase 1 exit criterion never claimed every business needs
this, only that a business *selling something* should have real
itemized billing instead of a rubber-stamped number. The gate makes that
scoping explicit in the UI, not just in the data model. On tax: `plan.md`
1d's other two asks (invoice series, tender buttons) were already
complete as of Step 1 — the invoice-series counter and four tender
buttons both predate this entry — so this step is narrowly just the GST
piece. Keeping `gstRate` a direct per-product field rather than a
category-string lookup table (`plan.md`'s literal "flat rate table by
category") is a deliberate correction: `category` is free-text today, so
keying tax off it would silently break on a typo; GST is really assigned
per product/HSN in practice, which is what a direct field gives you.

**Impact:** additive schema only (`Product.gstRate`, `OrderItem.gstRate`,
`Order.taxAmount`, all defaulting to 0) — `prisma db push` needed no
reset. No behavior change for any branch with no product carrying a
nonzero rate: subtotal, taxAmount 0, total = subtotal, identical to
before this step.

**Verified:** live API — created a Burger (₹100, 18% GST) and Fries (₹50,
5% GST) on a fresh QSR org, added both to a cart, confirmed subtotal 150
/ tax 20.5 (100×0.18 + 50×0.05, correctly mixing two different rates in
one cart) / total 170.5, and confirmed the same numbers landed on the
issued invoice unchanged. Re-ran the flat, no-catalogue payment flow from
Step 2's backward-compatibility check and confirmed `taxAmount` is still
exactly 0. Browser check: confirmed a no-catalogue hospital branch's
counter now shows no cart card at all after NEXT (previously showed an
empty one); confirmed the Products page's GST-rate select renders the
standard slabs and correctly pre-fills 18% when editing the Burger.
`test-flow.sh` and full `npm run typecheck` across all three workspaces
stayed clean throughout.

---

## 2026-09-09 — Auto-open cart + POS terminal UI (`plan.md` 1b+1c — POS foundation, step 2)

**Decision:** The cart now opens itself — Chapter 12's "no New Sale
button" rule. New `OrderSessionService` (`apps/api/src/products/
order-session.service.ts`, same `OnModuleInit`/event-subscriber shape as
`AutoAdvanceService`) reacts to `ServiceStarted` and calls new
`OrderService.openOrGetOrder(visitId, branchId, organizationId)`
(`apps/api/src/products/order.service.ts`), which is idempotent *per
visit* — the first stage's `ServiceStarted` creates the Order, every
later stage's `ServiceStarted` (Payment, Pickup, ...) just finds it
already there, so only the true first one publishes `PosSessionOpened`.
`OrderService` also owns `addItem`/`removeItem`: adding a product always
resolves its name/price server-side from the `Product` row (never trusts
a client-supplied price), and re-tapping a product already in the cart
increments its quantity rather than adding a duplicate line. New routes
`POST /counters/:id/order/items` and `DELETE /counters/:id/order/
items/:itemId` on `CounterController`, gated through the same
`requireCounter` branch-scope check every other counter action uses.
`CounterService.view()` now returns the current visit's open order
(`{id, subtotal, items}` or `null`), which is how the counter tablet's
new cart section gets live data — no separate endpoint, no separate
polling, it rides the same `useLive` subscription `current`/`upNext`
already use. `recordPayment` no longer always mints a fresh `Order`: it
calls `openOrGetOrder` and, only if that order still has zero items
(every non-catalogue vertical — hospital, salon, temple), falls back to
build-plan.md Phase 8's exact ad-hoc "Payment" line; otherwise the
invoice is issued off the cart's real subtotal. Web: the counter tablet
(`apps/web/src/app/counter/[counterId]/page.tsx`) gained a `CartSection`
— a tap-to-add product grid grouped by category (no search box, no
custom-item entry, no quantity stepper — Chapter 38's "no complicated
staff interfaces") plus a line-item list with per-line remove, shown
whenever someone's being served, at any stage. On a `PAYMENT`-stage
counter, the existing amount field now re-syncs to the cart's subtotal
via a `useEffect` keyed on `order?.subtotal`, instead of starting blank.

**Reason:** `plan.md` 1b's literal instruction — extend `ServiceStarted`'s
handler to open an order "pre-filled with the token's `serviceTypeId` as
the first line" — predates the multi-stage engine and assumes pricing
data `ServiceType` doesn't have (`{queueId, name, durationMinutes}` only,
no price). Reconciled as: open empty, idempotent per visit rather than
per stage (a QSR visit's `ServiceStarted` fires three times — Ordering,
Payment, Pickup — and only the first should open a cart), staff fills it
from the real catalogue instead of a phantom service-type line.

**Alternatives considered:** gating the cart section to only
`PAYMENT`-typed counters, matching where the tender controls already
live. Rejected — the entire premise of Chapter 12 ("a counter already is
the POS terminal") is that a sale gets rung up wherever it naturally
happens (typically Ordering in a QSR flow, not Payment), so restricting
the cart to the checkout stage would have defeated the point.

**Impact:** no schema changes. `recordPayment`'s wire contract is
unchanged (`{amount, method}`) — the web UI just pre-fills that field
now, staff can still override it. Every branch that never adds a product
(every branch before this step existed) behaves byte-for-byte as before:
empty cart, ad-hoc "Payment" line, same invoice shape.

**Verified:** live API — registered a QSR-template org with two products
(Burger ₹149, Fries ₹79); confirmed `PosSessionOpened` and an empty
`order` appeared the instant a token was called to the Ordering counter,
with no explicit action taken. Added Burger, Fries, tapped Burger again
(confirmed it incremented to qty 2 rather than duplicating), removed
Fries — subtotal tracked correctly at every step (149 → 228 → 377 → 298).
Advanced to Payment and confirmed the *same* order (same id) carried
across stages, `PosSessionOpened` fired exactly once for the whole visit,
and the resulting invoice total was the real cart subtotal (298) rather
than a re-typed number. Separately verified backward compatibility: a
plain hospital org's billing counter, cart never touched, still produces
the exact ad-hoc "Payment" line Step 1 built (`productId: null,
description: 'Payment'`) for whatever amount was typed. Browser check:
full walkthrough on the actual counter tablet — cart appeared
automatically on NEXT, tapped Burger and Fries as real tap targets,
watched the subtotal update live, advanced to the Payment counter and
confirmed the amount field pre-filled to ₹228 (matching the cart) before
recording CASH. `test-flow.sh` and full `npm run typecheck` across all
three workspaces stayed clean throughout.

---

## 2026-09-09 — Commerce data model (`plan.md` Phase 1a — POS foundation, step 1)

**Decision:** All 9 phases of `build-plan.md` are done; this starts on
`plan.md`'s deferred POS work, scoped to just 1a (`plan.md`'s Phase 1 is
itself the size of all of `build-plan.md` combined, so it's being taken
one reviewable step at a time — see the plan file this step ran from).
Extended the minimal `Order`/`Payment` placeholder from build-plan.md
Phase 8 into the real commerce model: new `Product` (org-wide catalogue —
name, category, price, optional `hsnSac`, opt-in `trackStock`),
`OrderItem` (line items with `staffUserId` attribution, `productId`
nullable so an ad-hoc line needs no catalogue entry), `Invoice` (sits
between Order and Payment, per-branch incrementing `number` series via
new `Branch.nextInvoiceNumber` — same pattern as `Queue.nextNumber`), and
`StockMovement` (append-only, inert until a later depletion step writes
to it — same "add the column, wire the behavior later" pattern
`Queue.nextQueueId` proved across Phases 5→6). `Payment.orderId` (unique,
1:1) became `Payment.invoiceId` (not unique — an invoice can carry
multiple payments for split tender later). `Order.amount` (flat total)
became `Order.subtotal`, recomputed from `items[]`. Two new events,
`InvoiceIssued`/`PaymentCompleted`, published by `CounterService.
recordPayment` *alongside* the existing `ServiceCompleted` — auto-advance
(Phase 6) still reacts to `ServiceCompleted` alone, untouched;
`PaymentCompleted` exists because `plan.md`'s own Phase 2 (loyalty
accrual) triggers off it by name. `recordPayment`'s behavior is otherwise
unchanged: staff still types one amount and taps one tender button; that
now creates a real `Order`→`OrderItem`→`Invoice`→`Payment` chain instead
of a flat pair. New org-wide Product catalogue Setup page
(`/setup/products`, alongside `/setup/staff`), copied structure from the
Staff setup page.

**Reason:** `plan.md` was written before `build-plan.md` existed and has
real drift against current reality — it assumes commerce entities don't
exist yet, references roles renamed in `build-plan.md` Phase 2
(`BRANCH_MANAGER`/`ORG_ADMIN` → `ADMIN`/`OWNER`), and names a
`PaymentCompleted` event that Phase 8 had no reason to add yet. This step
reconciles all of that rather than rebuilding from `plan.md`'s
now-outdated assumptions.

**Alternatives considered:** building the auto-open-cart trigger (1b) and
POS terminal UI (1c) in the same pass. Rejected — matches the
`build-plan.md` rhythm this whole engagement has used: land the data
model as an additive, behavior-preserving step first, then the riskier
UI/workflow change as its own reviewable step.

**Impact:** `Payment.invoiceId`/`Order.subtotal` are breaking schema
changes to a table that already had 2 rows from Phase 8/9 testing — see
Verified below for how that was migrated losslessly instead of via
`--force-reset`. No API contract change for `POST /counters/:id/
record-payment` (still `{amount, method}`); no counter tablet UI change.

**Verified:** `prisma db push` initially blocked on the required
`Payment.invoiceId` column against 2 existing rows. Rather than
`--force-reset` (which would have wiped 9 orgs / 543 tokens of
accumulated dev data over 2 rows), captured the 2 existing Order+Payment
pairs' data first, pushed with `invoiceId` temporarily nullable
(`--accept-data-loss`, scoped to only the two now-redundant columns
`Order.amount`/`Payment.orderId`), backfilled a real `Invoice` for each
from the captured data, then tightened `invoiceId` back to required and
pushed clean — zero data loss, all 9 orgs and 543 tokens intact. Live API
check: registered a QSR-template org, walked a token through Ordering
into Payment, called `record-payment`, confirmed via direct Prisma query
that `Order`→`OrderItem`→`Invoice`→`Payment` are all correctly linked,
and the activity feed shows `InvoiceIssued`, `PaymentCompleted`, and the
existing `ServiceCompleted` (with `reason: 'PAYMENT_RECORDED'`) all
firing, with auto-advance into Pickup still working unchanged. Browser
check: created a product through the new `/setup/products` page,
confirmed the list and edit-form pre-fill both work. `test-flow.sh` and
full `npm run typecheck` across all three workspaces stayed clean
throughout.

---

## 2026-09-09 — Auto-advance (Phase 6 of `build-plan.md`)

**Decision:** `Token.visitId` is no longer `@unique` — a Visit now owns one
Token per stage instead of exactly one, ever (`Visit.token Token?` →
`Visit.tokens Token[]`, plus `@@index([visitId])` since lookups are no
longer by unique key). New `AutoAdvanceService` (`apps/api/src/tokens/
auto-advance.service.ts`) subscribes to `EventBusService` in `onModuleInit`
— the second real consumer of the bus after `RealtimeGateway`, proving out
the "X emits an event, Y reacts" rule for something other than realtime
fan-out. On `ServiceCompleted`: if the completed queue has a `nextQueueId`,
it calls new `TokenService.advanceStage(completedToken, nextQueueId)`,
which mints a fresh Token in the next queue for the same visit, carrying
the completed token's `joinedAt` forward untouched and reusing the exact
`sortKeyFor(joinedAt, priority)` formula `transfer()` already uses — same
wait-credit math, now automatic instead of staff-initiated. If the queue
has no `nextQueueId`, this was the last stage: the Visit is marked `CLOSED`
(the meaning `Visit.status` was given a placeholder for back in Phase 4).
Manual transfer is unchanged and now reads as the exception-handling
override (skip a stage, correct a mistake) rather than the primary
mechanism.

**Reason:** from `queue-flow-design.md` §9 step 3 — the first phase with an
actual behavior change; every branch with no `nextQueueId` configured (i.e.
every branch today) sees zero difference. Creating a new Token row per
stage rather than mutating one row in place matches the design doc's own
framing verbatim: "a customer moving through three stages would be three
*disconnected* Token rows... the Visit is the record that fixes this" — the
Visit is what ties multiple stage-tokens together, so multiple tokens is
the point, not an accident.

**Alternatives considered:** reuse the same Token row across stages (like
`transfer()` does) instead of minting a new one. Rejected — it would make
"three stages" collapse back into one row with a changing `queueId`, which
is exactly the shape the design doc says Visit exists to avoid, and it
would leave every stage after the first with no record of the earlier
stage's own displayNumber/code/timing.

**Impact:** schema change is a dropped uniqueness constraint plus an added
index — non-destructive, no `--force-reset` needed, `prisma db push` ran
clean. No API contract changes (reuses the existing `QueueJoined` event
name for the new token). No web changes — the live queue view already
reads from `QueueService.snapshot()`, so a branch with a configured chain
just starts showing tokens appear in the next stage with no code change
there.

**Verified:** registered a fresh org via `/auth/register`, built a 2-stage
chain (Order → Pickup, `Order.nextQueueId = Pickup.id`), checked a customer
into Order, called NEXT + COMPLETE at the Order counter. Confirmed via
direct Prisma query: a new WAITING token appeared in Pickup for the same
`visitId`, `joinedAt` identical to the Order token's original check-in
time (wait credit preserved, not reset). Then completed the Pickup token
(no `nextQueueId`) and confirmed the Visit's `status` flipped to `CLOSED`
with no third token created. `test-flow.sh` (including its existing
transfer/priority/call-specific section) and full `npm run typecheck`
across all three workspaces still clean after the schema change.

---

## 2026-09-09 — Stage ordering on `Queue` (Phase 5 of `build-plan.md`)

**Decision:** `Queue` gained three fields: `stageType` (validated string —
`ENTRY | ORDERING | CONSULTATION | TRIAL | PAYMENT | PREPARATION | SERVICE |
DEPARTMENT | CUSTOM`, default `CUSTOM`; new `STAGE_TYPES`/`STAGE_TYPE_LABELS`
in `packages/core/src/enums.ts`), `nextQueueId` (nullable self-relation —
"what stage follows this one"), and `hasVisibleQueue` (boolean, default
`true`). `QueueService.create()`/`update()` validate `nextQueueId` when set:
must be a queue in the *same branch* (a flow is a per-location concept) and
can't reference itself. Deeper cycles (A→B→A) aren't checked — nothing walks
this chain yet, so a cycle is inert data today, not a live bug; that check
belongs in Phase 6 where a chain actually gets traversed.
`/setup/branches/[id]/queues` now exposes stage type, next-stage (a picker
built from sibling queues in the same branch), and the visibility toggle,
plus shows the resolved chain inline (`Ordering · → Payment`).

**Reason:** from `queue-flow-design.md` §3/§9 step 2 — makes a multi-stage
flow *expressible* as data. Still no behavior change; nothing reads
`nextQueueId` to actually move a token yet (that's Phase 6).

**Impact:** additive schema change (every new column has a default), so
`prisma db push` needed no reset this time — existing queues silently became
`stageType: CUSTOM`, `nextQueueId: null`, `hasVisibleQueue: true`, which is
exactly "unclassified, single-stage, visible" and changes nothing about how
they behave today.

**Verified:** built a real 3-stage QSR chain on Burger Junction through the
live API — `Ordering → Payment → Order Pickup`, with `Payment` correctly
marked `hasVisibleQueue: false` — matching Model B from
`queue-flow-design.md` §4 exactly. Confirmed both guards live: a queue
pointing at itself → `400`; Burger Junction's `Ordering` pointed at an
Apollo Hospital queue (cross-branch) → `400`. Browser check: the setup
page renders the full chain inline, and the edit form correctly pre-fills
"Payment" / "Order Pickup" / an unchecked visibility box when reopened.
`test-flow.sh` and full typecheck still clean.

---

## 2026-09-09 — Added the `Visit` entity (Phase 4 of `build-plan.md`)

**Decision:** New `Visit` model (`organizationId`, `branchId`, `customerId?`,
`status` OPEN/CLOSED — always `OPEN` for now, `source`, `vertical` snapshot,
timestamps). `Token` gets a required, unique `visitId` — one visit per token,
1:1, until a branch configures more than one stage (Phase 5+).
`TokenService.join()` creates the `Visit` immediately before the `Token` it
belongs to. Purely additive, per `queue-flow-design.md` §6 and
`build-plan.md`'s own scoping — no auto-advance, no visit-closing logic yet;
that's Phase 6, once there's an actual "next stage" for closing a visit to
mean something.

**Reason:** the backbone a customer's stage-tokens will hang off once
multi-stage flows exist (Phase 5+) — see `queue-flow-design.md` for why this
is one entity serving both the multi-stage-queue problem and the earlier
POS/payment-timing discussion, not two.

**Impact — irreversible schema reset required, done with explicit consent:**
adding a *required* `visitId` to `Token` isn't backfillable onto existing
rows without a value, so `prisma db push` refused to run. Prisma itself
detected the AI-invoked `--force-reset` and blocked it pending explicit user
sign-off (a built-in safety check, independent of this project's own
practices) — asked the user directly, got explicit "Yes, go ahead," then
reran with `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` set to that exact
message. Wiped the local dev Postgres database (seed + test-registration
data only, nothing of consequence) and reseeded. `seed.ts` updated to create
a `Visit` per `Token` it generates (new `createVisit()` helper), and its
reset sequence gained `visit.deleteMany()` in the correct FK order (after
`token`, before `customer`/`branch`/`organization`).

**Verified:** `token.count()` === `visit.count()` (518 = 518) after reseed;
sampled a visit record end-to-end (correct customer, vertical, source,
linked token); a *live* check-in through the running API produces a
correctly-linked `Visit` (checked directly against the database, not just
the API response). Full `test-flow.sh` passes with no observable behavior
change, confirming this phase is genuinely additive as scoped.

---

## 2026-09-08 — Self-service business registration (Phase 3 of `build-plan.md`)

**Decision:** Added `POST /auth/register` (public) — business name, business
type (vertical), owner name, email, password → creates `Organization` +
first `Branch` ("Main Branch" / code `MAIN`, renameable after) + a
`StaffUser` with role `OWNER`, all in one `$transaction`, and auto-signs-in
(same `{ accessToken, user }` shape as `/auth/login` — both now share a
private `issueSession()` helper on `AuthService` rather than duplicating the
JWT-payload construction). New `/register` web page; the root launcher's
signed-out state (from Phase 1's stopgap) now offers "Register your
business" alongside "Sign in" instead of sign-in only.

**Reason:** the last piece making this genuinely self-serve — previously an
`Organization` could only come into existence via the seed script.

**Impact:** Organization slugs are derived from the business name
(`Zudio` → `zudio`) with a random-suffix fallback on collision
(`zudio-4f2a`) rather than asking the user to pick one or failing the
sign-up — slugs aren't user-facing anywhere yet, so silently resolving the
collision is strictly better than surfacing it as an error to fix. A
duplicate *email* is a real, user-facing error, since `StaffUser.email` is
globally unique by design.

**Verified:** curl matrix — happy path returns an `OWNER` JWT scoped to a
brand-new org; that owner's `GET /branches` returns exactly their own one
branch; a duplicate email → `400`; registering the same business name twice
→ two distinct organizations via the slug fallback. Full browser walkthrough
registering "Glow Cafe" (restaurant vertical): landed directly on its
dashboard with restaurant terminology and theming already applied ("Order
Lines," "Guests," orange accent) with zero queues configured yet, then
confirmed `/setup/branches` shows exactly that one branch, ready to add
queues and counters through the setup flow built in Phases 1–2's session.
`test-flow.sh` and `npm run typecheck` both still clean.

---

## 2026-09-08 — Renamed roles: `ORG_ADMIN`→`OWNER`, `BRANCH_MANAGER`→`ADMIN` (Phase 2 of `build-plan.md`)

**Decision:** Renamed the two role identifiers throughout `ROLES`/`ROLE_RANK`
in `packages/core/src/enums.ts` and every consumer across both apps (17
source files total — every `@MinRole(...)` decorator, `ROLE_RANK.X`
comparison, and the client-side `ASSIGNABLE_ROLES` copy in `api.ts`).
`SUPER_ADMIN` stays in the `ROLES` union as a reserved, unassignable rank —
no endpoint, page, or capability is built around it anywhere, on purpose.
Seed data's login convention changed to match: `owner@<org>.queueos.dev` (was
`admin@`) and `admin@<org>.queueos.dev` (was `manager@`) — every email prefix
now matches its role name exactly instead of the old English-word mapping.

**Reason:** matches the terminology the project owner settled on — "Owner"
registers a business and sees every branch under it (never another
business's), "Admin" runs one specific branch. Doing the rename now, before
any real tenant data exists, means every later phase's permission checks get
written against the final names instead of carrying a code-says-one-thing,
UI-says-another mismatch indefinitely.

**Impact:** Since the identifiers are used as literal string values (not
just types), the rename was almost entirely self-checking — `npm run
typecheck` turned every stale reference into a compile error, which is how
the 17-file list was found with certainty rather than by grep alone. The one
place that *doesn't* type-check against `Role` is `prisma/seed.ts` (the
`role` column is a plain `String` at the DB level, by design — see the
schema's portability note) — that one needed a manual pass and would have
failed silently at runtime (`ROLE_RANK[user.role]` → `undefined`, breaking
every permission check for seeded accounts) if missed.

**Verified:** full role-rank safeguard re-tested live — a branch `ADMIN`
attempting to create an `OWNER` account → `403`; an `OWNER` creating an
`ADMIN` → `201`. Full `test-flow.sh` pass (updated to log in as `admin@...`
instead of the now-nonexistent `manager@...`). Browser check: `/setup/staff`
renders "owner", "admin", "counter staff", "reception" pills correctly,
including the account created via the curl test above, confirming it
persisted correctly under its new role name.

---

## 2026-09-08 — Closed the cross-tenant data leak (Phase 1 of `build-plan.md`)

**Decision:** Split `GET /branches/:id/overview` (and its siblings —
`/branches`, `/branches/:id/queues`, `/branches/:id/queue-config`,
`/branches/:id/activity`, `/branches/:id/counters`) from `@Public()` to
`@MinRole('BRANCH_MANAGER')` + the existing `requireBranchScope` check,
rather than bolting auth onto the endpoint as-is. A new, genuinely minimal
`GET /branches/:id/checkin-info` (public) replaces `overview` for the
check-in kiosk's actual needs — org/branch name, vertical, and open queues
with wait time only, nothing else.

**Reason:** confirmed live in conversation — an unauthenticated `curl` with
no credentials at all returned another business's real customer names from
`overview`. The endpoint bundled customer-facing data (needed by check-in,
no login) together with staff-only data (customer names, activity log,
revenue-adjacent stats) in one public response; the fix had to split the
bundle, not just gate the existing shape, or check-in would have broken.

**Impact:**
- `apps/web/src/app/checkin/[branchId]/page.tsx` now calls `checkin-info`
  instead of `overview`.
- `apps/web/src/app/dashboard/[branchId]/page.tsx` gained a real auth gate
  (it previously had none at all — a separate, distinct gap from the API-level
  leak: even with the API correctly protected, the page itself would have
  flashed a loading skeleton before an eventual API error).
- `apps/web/src/app/page.tsx` (root launcher) no longer lists every business
  on the platform — `GET /branches` is now scoped to the caller's own
  organization. An unauthenticated visitor sees a sign-in prompt instead of a
  directory. This is a stopgap; Phase 3 (self-service registration) replaces
  it properly.
- `apps/api/test-flow.sh` updated — several of its own calls to `/branches/*`
  were unauthenticated and needed the manager token attached now that those
  endpoints require it.

**Verified:** `npm run typecheck` clean; `test-flow.sh` passes in full;
manual curl matrix — unauthenticated `overview` → 401, unauthenticated
`checkin-info` → 200 (minimal shape only), Glow Studio's owner requesting
Apollo's `overview` → 404 (not 403 — doesn't confirm the id exists), Apollo's
own owner → 200 with correct data; browser check confirms the root page
shows exactly one branch when logged in as Apollo's owner (previously showed
all four demo businesses), and check-in still renders correctly, unauthenticated.

---

## 2026-09-08 — Moved from SQLite to Postgres (Phase 0 of `build-plan.md`)

**Decision:** `apps/api/prisma/schema.prisma`'s datasource provider changed
from `sqlite` to `postgresql`; `apps/api/.env`'s `DATABASE_URL` now points at
a local Postgres instance (`QueueOS` database on `localhost:5432`). Ran
`prisma db push` + `prisma generate` + reseed against it. No schema shape
changes — enum-like columns deliberately stay validated `String`s rather
than being promoted to native Postgres enums, since that promotion was
always documented as optional (application code already validates them via
`packages/core/src/enums.ts`) and adds migration risk for zero behavior
change.

**Reason:** first step of `build-plan.md` — every later phase touches the
schema, so migrating now, before any real tenant data exists, is close to
free; migrating later, with live customers, would not be.

**Impact:** Along the way, found and cleared eight orphaned Windows
processes from the *previous* session's dev servers — `preview_stop`/session
teardown had marked them stopped, but the underlying `node.exe` processes
(including the compiled `apps/api/dist/main`) were still running and had the
old SQLite-era Prisma engine DLL locked, which blocked `prisma generate`
from overwriting it. Not a code issue — worth knowing if `prisma generate`
ever fails with an `EPERM`/rename error on Windows again: check for a
lingering `dist/main` or `nest start --watch` process holding the file
before assuming something's actually broken.

Verified: `npm run typecheck` clean across all three workspaces;
`apps/api/test-flow.sh` passes in full against the new database, including
the transfer/priority-override/call-specific operations from Step 5 of the
prior session.

---

## 2026-09-06 — Hardening pass (Step 6 of `plan.md`, completing the queue-only scope)

**Decision:** Fixed the concrete gaps found while surveying the existing 7
web routes at the start of this work: (1) `apps/web/src/lib/api.ts` now
clears the stored JWT on any `401` response, so an expired/corrupted token
naturally lands the next navigation on `/login` instead of showing a raw
error forever; (2) `app-shell.tsx` gained a working sign-out control and the
active-nav-link check now reads `window.location.hash` directly, since
`usePathname()` never includes the fragment — a `#`-anchored item can only be
told apart from its siblings that way; (3) `ThemeProvider` now mounts once,
globally, in `layout.tsx`, and the six pages that used to re-wrap themselves
locally (`dashboard`, `checkin`, `counter`, `queues/[queueId]`, `display`,
`t/[code]`) now just call `setVertical()` in a `useEffect` once their data's
vertical is known; (4) the check-in flow persists the selected queue as
`?queue=<id>` via `history.replaceState`, so a refresh mid-form no longer
resets to step one; (5) the counter tablet blocks all rendering (not just a
skeleton) until the `api.me()` auth check resolves, and "No-show" now needs a
second tap ("Confirm no-show" / "Cancel") instead of firing on the first.

**Reason:** These were the concrete "harden what exists" items agreed for
this pass, found by reading the current pages/`api.ts` rather than guessed —
see the original scoping message for the full list.

**Alternatives considered:** For the nav active-state, true scroll-spy
(IntersectionObserver per section) was considered and rejected — three of the
existing hash-anchored nav items (`#appointments`, `#customers`, `#reports`)
point at sections that don't exist on the dashboard page at all yet, since
those features aren't built. Reading the URL hash directly is honest about
what's actually there today without pretending to solve a problem (scroll
tracking) this pass didn't ask for; the three dead links are a pre-existing
gap, not something this pass introduced or fixed.

**Impact:** Verified in-browser for every item: 401→logout round-trip via
localStorage inspection, sign-out button, vertical theming confirmed correct
across two different verticals (hospital blue, salon pink) after the
`ThemeProvider` refactor, check-in queue selection surviving a hard refresh,
and the no-show confirm/cancel round-trip leaving the token untouched on
cancel. `npm run typecheck` and `apps/api/test-flow.sh` both clean after
every step. This closes out all three areas scoped for "complete QueueOS
itself" (admin/setup UI, missing queue operations, hardening) — `plan.md`'s
POS/commerce phases remain deliberately untouched.

---

## 2026-09-06 — Queue operations: transfer, priority override, call-specific (Step 5 of `plan.md`)

**Decision:** Added the three missing Live-Queue actions from the target doc's
PG-100 spec: `POST /tokens/:id/transfer` (move a waiting/recalled token to a
different queue in the same branch), `POST /tokens/:id/priority` (override a
token's priority band, reason required), and `POST /counters/:id/call/:tokenId`
(call a specific waiting token out of FIFO order). Two new event names,
`TokenTransferred` and `PriorityChanged`, added to the `QUEUE_EVENTS` union in
`packages/core/src/events.ts` (required a `build:core` rebuild); call-specific
reuses the existing `CounterAssigned`/`ServiceStarted`/`QueueAdvanced` events
with a `direct: true` payload flag instead of a new event, since it's the same
domain transition as `next()`, just staff-selected. All three are gated
`@MinRole('BRANCH_MANAGER')` (call-specific at `COUNTER_STAFF`, same tier as
the other counter actions) and route through `QueueService.requireManageAccess`
/ `CounterService`'s branch-scope check, so a manager cannot act outside their
own branch.

**Reason:** These three were genuine gaps versus the doc's own action list
for the core Live Queue screen (`call specific · transfer · change priority
with reason`), confirmed by grep — nothing existed for them.

**Alternatives considered:** Transferring a token recomputes its sort key
using the token's *original* `joinedAt` rather than the transfer moment —
"wait credit travels," per the doc — so a customer who already waited twenty
minutes doesn't get sent to the back of the new line. Verified manually: a
freshly-created token transferred into a queue with several longer-waiting
customers landed at the back of *that* queue, correctly, since it had waited
zero minutes itself.

**Impact:** New UI on `/queues/[queueId]`'s "Next in line" list — a
transfer icon and a priority-flag icon per row, each opening an inline form
(no modal system exists yet, and four admin lists didn't justify building
one). Deliberately kept off the counter tablet itself, per the doc's Chapter
38 rejection of "complicated staff interfaces" growing the front-line screen.
`apps/api/test-flow.sh` extended with a new Section 11 covering all three
operations plus the reason-required validation; full script still passes.

---

## 2026-09-06 — Business-setup UI: branches, queues, counters, staff (Steps 1–4 of `plan.md`)

**Decision:** Added create/edit CRUD — previously available only via
`prisma/seed.ts` — for `Branch`, `Queue`, `ServiceType`, `Counter` and
`StaffUser`, plus a new `/setup` area in the web app (Branches, per-branch
Queues & Services, per-branch Counters, org-wide Staff). No schema changes:
every field these forms touch already existed on the models. New endpoints:
`POST/PATCH /branches`, `POST/PATCH /branches/:id/queues` and `/queues/:id`,
`POST/PATCH/DELETE` on `/queues/:id/service-types/:serviceTypeId`,
`POST/PATCH /branches/:id/counters` and `/counters/:id`, and a new
`StaffController`/`StaffService` (`GET/POST /staff`, `PATCH /staff/:id`,
`POST /staff/:id/reset-password`).

**Reason:** A merchant could not configure their own business at all —
seeding was the only way any of this data came to exist, which is fine for a
demo dataset but not for a real product. This was the first of the three
scoped areas ("Admin/setup UI", "missing queue operations", "harden what
exists") agreed for finishing the queue-only product before POS integration.

**Alternatives considered:** A full custom capability/permission-matrix
editor (the target doc's PG-022) was explicitly descoped — the existing 8
hardcoded `ROLES`/`ROLE_RANK` already cover queue-only operations, and
building a configurable matrix now would be speculative. Org/business
self-registration was also descoped — creating a branch within an existing
org is in scope, but onboarding a brand-new organization is bigger,
onboarding-flow-shaped work that belongs with the POS phase later.

**Impact:** New role-scoping rules worth knowing about: a `BRANCH_MANAGER`
can only create/edit resources in their own branch and can never create or
edit a staff account ranked at or above their own (`assertCanManage` in
`staff.service.ts`) — only `ORG_ADMIN` has full authority across branches.
Bundled in alongside counter setup: `CounterService` now takes the full
`JwtPayload` (not just an actor id) on every operational method, and
`assertBranchAccess` closes a real gap found during this work — any
authenticated staff user could previously open and operate *any* branch's
counter console, not just their own. Verified via `apps/api/test-flow.sh`
(unmodified, still passing) plus manual create/edit/login round-trips
through the new `/setup` pages.

---

## 2026-09-06 — Gap analysis against target-state doc, produced `plan.md`

**Decision:** Read the 43-chapter product strategy doc ("Unified Customer Flow, Queue
Management & POS Operating System") in full, distilled it into
`requirements-summary.md`, compared it against the current codebase (per
`flow.md` and the live schema/enums/verticals), and wrote a phased build plan
to `plan.md`. No code changed.

**Reason:** Requested by the project owner as groundwork before any commerce
(POS/CRM/retention) work begins — needed a concrete, current-codebase-grounded
build order rather than restating the doc's own phase names abstractly.

**Impact:** None on runtime behavior. Added `requirements-summary.md` (reference,
avoids re-parsing the source docx in future sessions) and `plan.md` (the
phased plan — see it for what's next). Key finding worth flagging: the current
schema has **zero** commerce entities (no Order/Invoice/Payment/Product) — the
whole of the doc's Chapters 11–31 is greenfield, gated behind a new `Visit`
backbone entity (Phase 0 in `plan.md`) that must land before any commerce table
is added, per the doc's own Chapter 5 rule.

---

## 2026-09-05 — Established decision + flow logging as standing practice

**Decision:** From this point on, every meaningful code change made in this
session is logged here with its reasoning, and `flow.md` is kept in sync with
how execution actually moves through the system. Before any major change
(new endpoint, schema change, altered state-machine behavior, new module),
the plan is explained back to the project owner as a short quiz to confirm
they understand what's about to change and why, before it's implemented.

**Reason:** The project owner asked for an auditable trail of *why* the
code changed, not just *what* changed (git diffs already show the "what").
Requiring a quiz before major changes catches misunderstandings before they're
baked into code, rather than after.

**Impact:** Process only — no code touched. Applies going forward to all three
tasks: this log, `flow.md`, and the pre-change comprehension check.

---

## 2026-09-05 — Initial project read: no code changes yet

**Decision:** Did a full read-through of the codebase (both `apps/api` and
`apps/web`, plus `packages/core`) to build `flow.md` and brief the project
owner on how the system works. No code was modified.

**Reason:** Requested as the first of three standing tasks, and required
groundwork before any future change can be explained or quizzed accurately.

**Impact:** None on runtime behavior. Produced `flow.md` as a byproduct.
