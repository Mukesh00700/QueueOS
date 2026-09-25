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

## 2026-09-24 — Thermal receipt print styling (sixth and last of the post-POS-list follow-ups)

**Decision:** Scoped this to what's actually checkable in this
environment. The receipt page (`/invoices/[invoiceId]`) already had a
Print button calling `window.print()`, styled generically for Letter/A4
(`print:hidden`/`print:border-none`/`print:shadow-none` only — no page
size, no receipt-width constraint). Added: an inline `@page { size: 80mm
auto; margin: 0; }` rule (the standard thermal-roll width — auto height,
since a receipt roll isn't page-broken the way Letter/A4 is) and
`print:max-w-[72mm] print:font-mono print:text-[11px]` on the receipt
container, so the printed output is actually shaped like a receipt
instead of a scaled-down A4 page.

**Deliberately not built:** raw ESC-POS byte generation for direct
USB/serial/network printer control. That's the other half of "receipt
printing" in a real POS, but it needs an actual printer (or at least a
printer-agent) to target and verify against — building it here would be
unreachable code with no way to confirm it's even correct, the kind of
half-finished implementation this session has otherwise avoided
throughout. Flagged explicitly rather than silently skipped.

**Reason:** Sixth and last of the post-POS-list follow-ups. Most thermal
receipt printers ship with a driver that makes them appear as an ordinary
system printer, so `window.print()` reaching a correctly-shaped 80mm page
already gets most of the real-world value without needing raw protocol
work — the CSS is what was actually missing, and it's the only half of
this gap that's honest to build without hardware.

**Impact:** `apps/web/src/app/invoices/[invoiceId]/page.tsx` (the `@page`
style tag, the print-scoped width/font classes). Verified as far as this
environment allows: confirmed the page still renders correctly with no
runtime error from the inline `<style>` tag; confirmed via direct CSSOM
inspection in the live browser (`document.styleSheets`) that Tailwind
actually compiled the arbitrary-value print utilities rather than
silently dropping them (a real risk with bracket-notation values) —
`@media print { .print\:max-w-\[72mm\] { max-width: 72mm; } ...
.print\:font-mono { font-family: "JetBrains Mono", ... } ...
.print\:text-\[11px\] { font-size: 11px; } }` all present and correctly
scoped. Could not verify actual printed output (hardcopy or even a
browser print-preview) — no printer, real or virtual, and no print-media
emulation available through the tools in this environment; noted
explicitly as the boundary of what this session could confirm.
`npm run typecheck` and `test-flow.sh` clean.

**This closes the six-item post-POS-list follow-up set** (CI pipeline,
staff performance, cross-branch reporting, loyalty/rewards, supplier/PO
tracking, receipt printing) — everything from that list that was free to
build without a paid third-party account is now done.

---

## 2026-09-24 — Supplier / purchase-order tracking (fifth of the post-POS-list follow-ups)

**Decision:** New `Supplier`, `PurchaseOrder`, `PurchaseOrderItem` models.
A PO's line items snapshot `description`/`unitCost` at creation time —
same reasoning as `OrderItem`: a product renamed or repriced later must
not rewrite a PO already placed. Receiving a PO (`status: OPEN →
RECEIVED`) pushes each line's quantity into the *same* `StockMovement`
ledger a sale already depletes — one more producer into an existing
table, not a parallel stock concept — skipping lines for products with
`trackStock` off, same as a sale already does. The existing manual
"Restock" button on the Products page is untouched and still there for a
quick count with no formal paperwork; POs are the structured path for a
real, trackable supplier delivery — the two coexist rather than one
replacing the other.

New `apps/api/src/procurement/` module (`ProcurementService` +
`ProcurementController`, both ADMIN-gated) handles Supplier CRUD and PO
create/receive; the branch-scoped PO *list* lives on `BranchController`
instead, matching the same split every other branch-scoped resource in
this codebase already uses (list on `BranchController`, mutations on
their own resource controller). New Setup tab `/setup/suppliers` —
Suppliers and Purchase Orders share one page rather than two, since
splitting a domain this small into separate tabs would just be extra
navigation with no real separation of concerns.

**Reason:** Fifth of the post-POS-list follow-ups. The catalogue could
already track stock depleting on a sale but had no way to record where
new stock actually came from, at what cost, or whether an order placed
with a supplier had even arrived yet.

**Impact:** `apps/api/prisma/schema.prisma` (three new models, back-relations
on `Organization`/`Branch`/`Product`), `apps/api/src/procurement/{procurement.dto,
procurement.service,procurement.controller}.ts` (new files),
`apps/api/src/branches/branch.controller.ts` (`GET branches/:id/purchase-orders`),
`apps/api/src/app.module.ts` (registers the new service/controller),
`apps/web/src/lib/api.ts` (`SupplierRow`/`PurchaseOrder*` types and
endpoints), `apps/web/src/app/setup/suppliers/page.tsx` (new page),
`apps/web/src/components/setup-shell.tsx` (new "Suppliers" tab). Verified
live against the running dev server: created a real supplier, placed a
20-unit PO against Connaught Place's actual Classic Cheeseburger stock
(7 on hand at the time), confirmed receiving it correctly pushed stock to
27 and correctly rejected being received a second time (`HTTP 400`,
"already been received"). Then, through the browser UI itself: the
Suppliers/Orders list rendered the just-created supplier and PO
correctly; placed a second 5-unit PO through the real create form and
confirmed it showed "Open" with a "Mark received" button; clicked it and
confirmed the status flipped to "Received" live; navigated to the
Products page and confirmed stock read exactly 32 (7 + 20 + 5),
closing the loop from PO to ledger to catalogue display.

**Incident during this item:** the long-running API dev server (`nest
start --watch`) was found dead partway through this item's verification
(`HTTP 000` on port 4000) — unrelated to this session's code, since a
fresh `nest start --watch` run immediately after booted every route,
including the new Procurement ones, with zero compile errors. Restarted
it in the background and confirmed recovery before continuing
verification; flagging this since it's now the second dev-server outage
this session (see the `.next` corruption entry above) — this project's
dev servers are proving fragile to interruption in this environment and
may be worth a `.claude/launch.json`-managed restart path if it keeps
recurring.

**Impact (typecheck/tests):** `npm run typecheck` (both workspaces) and
`test-flow.sh` clean throughout; `prisma generate`'s binary copy hit the
known dev-server file lock, stale binary confirmed working against the
three new models at runtime.

---

## 2026-09-24 — Loyalty / rewards (fourth of the post-POS-list follow-ups)

**Decision:** `Customer.loyaltyPoints` — one running balance, no separate
ledger table. Earning happens inside `recordPayment`'s existing
transaction: `floor(invoice.total / LOYALTY_EARN_RATE)` (₹10 per point)
points credited to the token's customer, only when one exists, snapshotted
onto the new `Invoice.loyaltyPointsEarned` for the receipt. Redeeming
reuses the discount mechanism built earlier this engagement rather than a
new pathway — a redemption **is** a FLAT discount worth `points *
LOYALTY_POINT_VALUE` (₹1 per point), applied through the exact same
`discountType`/`discountValue`/`discountReason` slot a manual discount
uses, capped at both the customer's balance and what the bill can absorb.

**Two real bugs found and fixed during this item's own live verification,
before it was considered done:**
1. **Repeated redemption calls silently burned points.** Redeem 20, then
   redeem 5 more on the same order — the discount slot's "replace, don't
   stack" rule (correct for a manual discount, which costs nothing to
   reapply) overwrote the first ₹20 discount with a plain ₹5 one, even
   though the first 20 points had already been irreversibly decremented.
   Customer down 25 points, bill only down ₹5. Fixed: `redeemLoyaltyPoints`
   now detects an already-active loyalty redemption (via the reason
   string's `Loyalty redemption` prefix — the only writer of that exact
   text) and **adds** to it instead of replacing it.
2. **Removing or overwriting an active redemption didn't refund the
   points.** Tapping the discount line's × (or applying a manual discount
   over an active redemption) cleared the discount but left the spent
   points gone — value destroyed for nothing. Fixed: both `removeDiscount`
   and `applyDiscount` now check for an active loyalty redemption first
   and refund its points back to the customer before clearing/overwriting
   it.

Both fixes share one helper, `pointsBehind(order)` — no new schema column;
detecting "this discount came from loyalty" via the reason-string prefix
is enough since this app is the only writer of that exact text.

**Reason:** Fourth of the post-POS-list follow-ups. The two bugs above are
exactly the kind of thing "reuse the existing discount mechanism" risks
if the two features' invariants aren't reconciled — worth documenting
prominently since the fix pattern (check-then-refund before
overwrite/clear) is the general lesson, not just specific to loyalty.

**Impact:** `apps/api/prisma/schema.prisma` (`Customer.loyaltyPoints`,
`Invoice.loyaltyPointsEarned`), `apps/api/src/products/order.service.ts`
(`LOYALTY_POINT_VALUE`, `LOYALTY_EARN_RATE`, `pointsBehind`,
`redeemLoyaltyPoints`, and the `applyDiscount`/`removeDiscount` fixes),
`apps/api/src/counters/{counter.dto,counter.service,counter.controller}.ts`
(`POST :id/loyalty/redeem`, `view()`'s `customerLoyaltyPoints`),
`apps/web/src/lib/api.ts` (`OpenOrder.customerLoyaltyPoints`,
`InvoiceDetail.loyaltyPointsEarned`, `redeemPoints`),
`apps/web/src/app/counter/[counterId]/page.tsx` (redeem control, same
gating as the discount form), `apps/web/src/app/invoices/[invoiceId]/page.tsx`
(receipt's "Earned N loyalty pts" line). Verified live end to end against
a real customer at Khan Market (created this session for cross-branch
testing): a ₹250 ad-hoc sale correctly earned 25 points; on the
customer's next visit, redeeming 20 of those points correctly applied a
₹20 discount and dropped the balance to 5; **caught the accumulation bug**
by redeeming 100 more (capped to the remaining 5, but replaced rather than
added — bill only reflected 5 points' worth despite 25 being spent);
fixed, then reproduced the exact same sequence again and confirmed two
redemptions (3 pts, then 2 more) correctly accumulated to a single 5-point
discount; confirmed removing that discount correctly refunded all 5
points; completed a real sale with a 10-point mid-transaction redemption
and confirmed the resulting invoice correctly showed `discountAmount: 5`,
`loyaltyPointsEarned: 20`, and the receipt rendered both the discount line
and the "Earned 20 loyalty pts" line correctly; confirmed the customer's
final balance (20) matched hand-calculated expectations exactly. Also
verified the redeem control and the refund-on-remove fix directly through
the browser UI, not just via curl. `npm run typecheck` (both workspaces)
and `test-flow.sh` clean throughout; `prisma generate`'s binary copy hit
the known dev-server file lock, stale binary confirmed working against
the new columns at runtime, same as every prior schema change this
session.

---

## 2026-09-24 — Cross-branch reporting (third of the post-POS-list follow-ups)

**Decision:** `InvoiceService.orgSummary(organizationId, since)` — every
branch's revenue, discounts given, refunds, and net side by side, for a
selected window. Fetches full `Invoice` rows (with their `refunds`) for
the org and reduces in JS per branch rather than a Prisma `groupBy`,
because `Refund` has no `branchId` column of its own (only reachable via
the `invoice` relation) and `groupBy` can't group across a relation — at
this scale (a small business's branches) that's cheaper to write and
just as fast as forcing it into SQL. New route `GET /branches/summary`
(2-segment literal path — checked it can't collide with any registered
`branches/:id/...` route, all of which are 3+ segments) gated
`MinRole('OWNER')`, since an ADMIN is already confined to one branch
everywhere else in the product and this route has no `:id` to scope down
to. New standalone page `/organization` (not nested under `AppShell`,
which needs a single `branchId` to render around) with a Today/7-day/
30-day toggle and a totals footer row, linked from the launcher's
"Branches" section — only when the signed-in user is OWNER+.

**Reason:** Third of the post-POS-list follow-ups. Every other report
built this engagement (Invoices, Shifts, Staff performance) is
deliberately branch-scoped, which was correct for each of them
individually but left genuinely nothing anywhere that answers "how's the
whole business doing" for an owner running more than one branch.

**Impact:** `apps/api/src/products/invoice.service.ts` (`orgSummary`),
`apps/api/src/branches/branch.controller.ts` (`GET branches/summary`),
`apps/web/src/lib/api.ts` (`BranchSummaryRow`, `branchesSummary`),
`apps/web/src/app/organization/page.tsx` (new page),
`apps/web/src/app/page.tsx` (launcher gains an "Org summary" link,
OWNER-only). Verified live: created a real second branch ("Khan Market")
under Burger Junction as Owner, gave it its own Payment-stage queue and
counter, rang up a real ₹350 ad-hoc UPI sale there; confirmed the "Today"
window correctly showed only that fresh sale (Connaught Place's activity
was all from the prior day, correctly zeroed); confirmed "Last 7 days"
correctly rolled in Connaught Place's full history (7 invoices, ₹1216.85
revenue, ₹20 discounts, ₹350 refunded, ₹866.85 net) alongside Khan
Market's, with the totals footer correctly summing both (8 invoices,
₹1566.85 revenue, ₹1216.85 net); confirmed an ADMIN gets `HTTP 403`
("Requires OWNER or higher") on the same route. In the browser: the
Today/7-day toggle correctly re-fetched and re-rendered; the launcher's
"Org summary" link correctly appeared for the Owner account and was
correctly absent for the Admin account, which also correctly saw only
its own branch in the branches list (confirms `GET /branches` itself is
already org-scoped-but-role-filtered, not a new finding but a useful
cross-check). `npm run typecheck` and `test-flow.sh` clean throughout.

---

## 2026-09-24 — Staff performance report (second of the post-POS-list follow-ups)

**Decision:** `InvoiceService.staffPerformance(branchId, since)` — three
cleanly attributable, independently-queried facts per staff member, not a
computed commission payout: items rung up (`OrderItem.staffUserId`, scoped
to lines whose order was actually invoiced — a removed or never-paid cart
line earns nothing), payments personally recorded (`Payment.recordedBy`),
and refunds personally processed (`Refund.recordedBy`). Deliberately does
**not** net refunds against the original seller's revenue — a `Refund` has
no `OrderItem`-level link back to which line it covers (it's recorded
against the whole invoice), so there's no honest way to attribute it to a
specific earlier sale; refunds show as their own column instead. New route
`GET /branches/:id/staff-performance?since=` on `BranchController`
(existing `startOfToday()` from `queue.service.ts` as the default — same
helper `InsightsService` already reuses across module boundaries), new
page `/dashboard/[branchId]/staff-performance` with a Today / 7-day /
30-day toggle.

**Reason:** Second of the post-POS-list follow-ups (pure engineering, no
paid dependency) — `OrderItem.staffUserId` has been captured on every line
all engagement but nothing ever read it back into a report.

**Impact:** `apps/api/src/products/invoice.service.ts`
(`staffPerformance`), `apps/api/src/branches/branch.controller.ts` (new
route), `apps/web/src/lib/api.ts` (`StaffPerformanceRow`,
`staffPerformance`), `apps/web/src/app/dashboard/[branchId]/staff-performance/page.tsx`
(new page), `apps/web/src/components/app-shell.tsx` (new nav item).
Verified live: default (no `since`) correctly returned `[]` since all of
this engagement's test activity happened the prior day; an explicit
7-day window correctly returned real attributed figures matching this
session's actual testing (Admin User: 7 items, ₹1207 revenue, 9 payments,
₹1426.85 cash handled, 4 refunds totaling ₹350); an invalid `since`
correctly 400s. Confirmed in the browser: the Today/7-day toggle
correctly flips between the empty state and the populated table.

**Incident during this item's verification:** running
`npm run build --workspace @queueos/web` (a production build, done to dry-
run the new CI pipeline) while `next dev` was live corrupted the shared
`.next/` directory both processes write to — `next dev` and `next build`
are not safe to run concurrently against the same output folder. Every
page on the site started 500ing (`Cannot find module
'./vendor-chunks/motion-dom.js'`). Fixed by deleting `.next` and
restarting the web dev server (killing just `next dev`'s child
`start-server.js` process did **not** self-heal as expected — the parent
CLI process exited too, contrary to assumption; had to relaunch
`npm run dev --workspace @queueos/web` outright). Confirmed recovery by
reloading every page built this session (staff performance, shifts,
kitchen, invoices) rather than just the one that surfaced the error.
Lesson for any future CI dry-run against a live dev environment: build a
throwaway copy of the repo, or at minimum never run `next build` in the
same working directory as a live `next dev`.

---

## 2026-09-24 — CI pipeline (first of the post-POS-list follow-ups)

**Decision:** New `.github/workflows/ci.yml`, running on every push and PR
to `main`: install → build `@queueos/core` (both apps consume it as a
compiled `dist`, not live source, so everything downstream needs this
first) → typecheck both apps → **production build** of both apps (`nest
build`, `next build` — everything run locally all engagement has been dev
mode, which is more forgiving than a real build) → push the schema and
seed demo data into a throwaway Postgres service container → boot the
built API → run `test-flow.sh` against it. One job, ubuntu-latest, a
Postgres 16 service container rather than a hosted external database —
free, ephemeral, no account needed.

The API-start-and-test step deliberately backgrounds `node dist/main.js`
and runs the smoke test in the *same* shell step rather than splitting
"start" and "test" into two steps — a background process from one step
isn't reliably still alive for the next one to depend on.

**Reason:** First of the post-list follow-ups — protects every feature
built this engagement (and everything after) from a silent regression,
and directly closes part of the "hosting readiness" gap flagged earlier:
this is the first time either app's actual production build has been
verified at all, since every local run all engagement has been `nest
start --watch` / `next dev`. Picked first because it's foundational and
unaffected by any other pending decision (e.g. table/seating scope).

**Impact:** `.github/workflows/ci.yml` (new file). No application code
changed. Verified by dry-running the exact sequence locally against a
throwaway `QueueOS_CI_Test` database on a second port (4001), fully
isolated from the real dev DB and the running dev API on :4000 — schema
push, seed, a from-scratch `nest build` boot, and `test-flow.sh` all
passed end to end (exit 0) before this was trusted enough to commit;
confirmed the real dev environment was untouched afterward
(`localhost:4000/api/verticals` still healthy). Also confirmed
`npm run build --workspace @queueos/web` produces a clean production
build locally (19 routes compiled, 0 errors) as part of validating this
pipeline — the first direct evidence either app builds cleanly outside
dev mode.

---

## 2026-09-23 — Kitchen display system (sixth and last of the six remaining POS gaps)

**Decision:** `OrderItem` gains `kitchenStatus` (QUEUED | PREPARING | READY,
default QUEUED) — per-item, not per-order, since a ticket with a burger and
a shake needs the fryer station and the drinks station to report in
independently. No new `KitchenTicket`/`Order`-level status: a ticket is just
"this order's items, while at least one isn't READY yet," so it clears
itself off the board the moment the last item on it is tapped to READY —
nothing to explicitly "bump." New `/kitchen/:branchId` (board) and
`/kitchen/items/:itemId/status` (advance one item) routes on a dedicated
`KitchenController`, delegating to `OrderService` (which already owns
`OrderItem`'s lifecycle) rather than a new service — same "auth in the
controller, business logic in the service that already understands the
entity" split every other floor screen in this codebase uses. Gated at
`MinRole('COUNTER_STAFF')`, the same tier as the counter tablet — a kitchen
tablet is a floor tool, not a back-office one. Added `KitchenItemUpdated` to
`@queueos/core`'s event contract and publish it on every status change, so
a second kitchen screen (an expo station watching the same board) updates
within the socket's normal latency instead of waiting on `useLive`'s 30s
poll fallback — consistent with every other POS action in this codebase
already publishing an event for exactly this reason.

The web page (`/kitchen/[branchId]`) is standalone, not nested in
`AppShell` — same reasoning as the counter tablet: a screen meant to sit on
a mounted tablet all day doesn't want a dashboard sidebar competing for
space. Tickets are a grid, oldest first; a ticket past 10 minutes old gets
a red border and pill as a simple, un-configurable staleness cue — not a
setting, since nothing asked for one and a fixed threshold is enough to
prove the concept. Tapping an item cycles QUEUED → PREPARING → READY →
QUEUED (wraps around) rather than a forward-only action, so a misclick is
one more tap to undo instead of unrecoverable.

**Reason:** Sixth and last of six named POS gaps, deliberately saved for
last as the biggest, most structurally different item — everything else
this session extended the existing counter/invoice flow, this adds a whole
new floor screen with its own state.

**Impact:** `packages/core/src/events.ts` (`KitchenItemUpdated` added to
`QUEUE_EVENTS` — required rebuilding `@queueos/core` via `npm run build
--workspace=packages/core`, since it's consumed as a compiled `dist`, not
live TS source; `apps/api`'s typecheck failed against the stale dist until
that ran), `apps/api/prisma/schema.prisma` (`OrderItem.kitchenStatus`),
`apps/api/src/products/order.service.ts` (`kitchenBoard`,
`setItemKitchenStatus`, `requireBranchAccess`),
`apps/api/src/products/kitchen.{dto,controller}.ts` (new files),
`apps/api/src/app.module.ts` (registers `KitchenController`),
`apps/web/src/lib/api.ts` (`KitchenTicket`/`KitchenItemRow`,
`kitchenBoard`/`setKitchenItemStatus`), `apps/web/src/app/kitchen/[branchId]/page.tsx`
(new page), `apps/web/src/components/app-shell.tsx` (new "Kitchen" nav item,
visible to every staff role, not just `canManage` — matches the API's
COUNTER_STAFF gate). Verified live against the running dev server: hit the
board via curl and confirmed it returned every existing order in the branch
still holding a non-READY item (this feature landing after the fact meant
all prior test orders from this session legitimately appeared, since their
items had never been touched); advanced a real item QUEUED → PREPARING →
READY via curl and confirmed its ticket dropped out of the very next board
read; confirmed the branch-scope guard 404s on a request for a branch that
isn't the caller's own. Then checked the actual page in the browser: all
tickets rendered correctly with live item counts and per-item status
labels; tapping an item advanced its status in place with no reload and the
header's ticket count updated live; tapping a single-item ticket's only
item to READY correctly made the whole ticket vanish from the board;
confirmed visually that tickets older than 10 minutes render with the red
"late" pill/border while two fresh (7-minute) tickets correctly stayed
neutral. `npm run typecheck` (both workspaces) and `test-flow.sh` clean
throughout; `prisma generate`'s binary copy hit the known dev-server file
lock, stale binary confirmed working against the new column at runtime,
same as every prior schema change this session.

---

## 2026-09-23 — Shift close / cash reconciliation (fifth of the six remaining POS gaps)

**Decision:** New `Shift` model — one OPEN shift per branch at a time
(enforced in `ShiftService`, app-level, same as Order's one-open-cart-
per-visit rule; not a DB constraint). Opening records the float placed in
the drawer; closing records what staff physically counted. Deliberately
no `expectedCash` column: it's always derived — opening float + every CASH
`Payment` − every CASH `Refund` recorded at that branch between `openedAt`
and `closedAt` (or now, while still open) — because unlike Order's running
totals, Payment/Refund rows are never edited after creation, so there's
nothing for a stored figure to go stale against and nothing worth
denormalising. `variance` (`countedCash − expectedCash`) is likewise
computed, not stored. History re-runs the same window query per closed
shift rather than freezing a value at close time — `closedAt` is fixed
once set, so it's exactly as correct as a stored figure, one query per row
instead of one column.

Routes live on `BranchController` (`/branches/:id/shifts[/current|/open|
/close]`) rather than a dedicated controller — same pattern `invoices()`
already uses to call `InvoiceService` from there, since every shift
operation is inherently branch-scoped and `requireBranchScope` already
lives on that controller. ADMIN-gated, same tier as Invoices — cash
reconciliation is a financial control, not a floor action.

**Reason:** Fifth of six named POS gaps. Without this, a branch has no way
to answer "does the cash in the drawer match what was actually rung up
today" — the entire reason a POS tracks payment method at all.

**Impact:** `apps/api/prisma/schema.prisma` (new `Shift` model,
`Branch.shifts`/`Organization.shifts` back-relations),
`apps/api/src/shifts/{shift.dto,shift.service}.ts` (new files),
`apps/api/src/branches/branch.controller.ts` (four new routes),
`apps/api/src/app.module.ts` (registers `ShiftService`),
`apps/web/src/lib/api.ts` (`ShiftRow`, `currentShift`/`shiftHistory`/
`openShift`/`closeShift`), `apps/web/src/app/dashboard/[branchId]/shifts/page.tsx`
(new page — open/close forms plus a settled/over/short history list),
`apps/web/src/components/app-shell.tsx` (new "Shifts" nav item, same
ADMIN gate as Invoices). Verified live via curl against the running dev
server: opened a shift with a ₹500 float, confirmed opening a second one
is rejected (`HTTP 400`) while the first is still open; rang up a real
₹120 CASH sale and confirmed `expectedCash` correctly became ₹620; rang up
a ₹90 CARD sale and confirmed it correctly left `expectedCash` unchanged
at ₹620 (only CASH moves the drawer); refunded ₹50 of the CASH sale and
confirmed `expectedCash` correctly dropped to ₹570; closed with counted
₹560 and confirmed the returned `variance` was exactly `-10`; confirmed
`current` returns `null` immediately after close and `close` on a branch
with no open shift correctly 404s. Separately verified the actual page in
the browser: the live "Expected cash now" figure, the Close-shift form
submitting and correctly flipping the page to "No shift open," and the
history list rendering both a positive (+₹5.00) and negative (−₹10.00)
variance with the correct sign placement (caught and fixed a `₹-10.00`
formatting bug live — minus belongs before the ₹ symbol, matching how
refunds/discounts already render negative amounts elsewhere in the app).
`npm run typecheck` and `test-flow.sh` clean throughout; `prisma
generate`'s binary copy hit the known dev-server file lock, stale binary
confirmed working against the new model at runtime, same as every prior
model change this session.

---

## 2026-09-23 — Discounts (fourth of the six remaining POS gaps)

**Decision:** `Order` gains `discountType` (FLAT | PERCENT, nullable), `discountValue`
(the raw rupee amount or percentage staff entered), `discountReason`, and a
denormalised `discountAmount` — same "store the rule, recompute the derived
figure on every mutation" shape `subtotal`/`taxAmount` already use, so a
PERCENT discount stays correct if a line is added or removed after it's
applied rather than freezing against the cart at apply-time. Applied to the
post-tax bill (`subtotal + taxAmount`), not reworked into each line's GST —
simpler, and matches how a till coupon is normally rung up ("10% off the
bill"), not a rate change on every item. Capped at the bill total so a
discount can never push it negative (`Math.min(rawDiscount, subtotal +
taxAmount)`); re-applying a new discount replaces the old one rather than
stacking, since a cart only carries one active discount rule at a time.
`POST /counters/:id/discount` applies/replaces it, `DELETE .../discount`
clears it; a PERCENT over 100% is rejected by the DTO. `record-payment`'s
tender-sufficiency check and the invoice it issues both use the discounted
total — `Invoice` gained matching `discountAmount`/`discountReason` columns,
snapshotted at issue time for the same reason `taxAmount` already is (a
later change to the order shouldn't rewrite an invoice already out). Ignored
entirely on the ad-hoc "type an amount" fallback path (empty cart, no
discount rule) — same as tax already is there.

**Reason:** Fourth of six named POS gaps. A counter that can ring up a full
bill but never take a rupee or percent off it can't run a loyalty offer, a
manager comp, or a coupon — all routine floor asks.

**Impact:** `apps/api/prisma/schema.prisma` (`Order.discount*` fields,
`Invoice.discountAmount`/`discountReason`), `apps/api/src/products/order.service.ts`
(`applyDiscount`/`removeDiscount`, `recomputeTotals` now derives
`discountAmount`), `apps/api/src/counters/{counter.dto,counter.service,counter.controller}.ts`
(`discountSchema`, the two counter methods, `view()`'s order payload, and
`recordPayment`'s total/invoice now net of discount), `apps/web/src/lib/api.ts`
(`OpenOrder`/`InvoiceDetail` discount fields, `applyDiscount`/`removeDiscount`),
`apps/web/src/app/counter/[counterId]/page.tsx` (Flat/% form, discount line
with inline remove, gated behind `order.discountAmount === 0` so only one
rule can be active), `apps/web/src/app/invoices/[invoiceId]/page.tsx`
(receipt's Discount line). Verified live end to end via curl against the
running dev server: rang up a real ₹199 item (₹208.95 with GST), applied a
10% discount (→ ₹20.895 off), replaced it with a FLAT ₹15 discount to
confirm re-applying replaces rather than stacks, confirmed PERCENT 150 is
rejected (`HTTP 400`, "A percentage discount cannot exceed 100%"), confirmed
a FLAT ₹9999 discount correctly caps at the full bill (`discountAmount:
208.95, total: 0`) rather than going negative, then applied a real FLAT ₹20
discount and recorded payment — the resulting Invoice correctly stored
`discountAmount: 20`, `discountReason`, and `total: 188.95`, and the receipt
page correctly rendered "Discount · Coupon FLAT20 −₹20.00". Separately
verified the counter tablet's actual UI on a second live cart: opened the
"+ Add discount" form, picked % Off, applied 15% (line rendered "Discount ·
Birthday special −₹31.34", total updated to ₹177.61), then used the discount
line's × to remove it and confirmed the cart correctly reverted to its
undiscounted ₹208.95 total. `npm run typecheck` and `test-flow.sh` clean
throughout; `prisma generate`'s binary copy hit the known dev-server file
lock, stale binary confirmed working against the new columns at runtime,
same as every prior model change this session.

---

## 2026-09-23 — Refunds (third of the six remaining POS gaps)

**Decision:** New `Refund` model, kept deliberately separate from
`Payment` rather than a signed/negative row in the same table — a
refund is a different kind of fact (money going back, always with a
`reason`), and `Payment` had no place for one. `POST /invoices/:id/refund`
takes `{amount, method, reason}`, capped against what's actually left:
`invoice.total - sum(existing refunds)`, so repeated partial refunds can
never together exceed the invoice total no matter how many are made.
Refunding a `VOID` invoice is rejected outright — void already means
nothing is owed, so there's nothing left to refund. The invoice detail
page's "Refund" button only appears while `refundable > 0.01` and
disappears once an invoice is fully refunded; the receipt shows a
"Refunded"/"Net" line and a "Refunds" section listing every refund's
method and reason once any exist; the invoices list badges an invoice
"Refunded" (full) or "Partially refunded" (partial) next to the existing
"Void" badge.

**Reason:** Third of six named POS gaps. A cash-register system that can
take money but never give it back isn't usable for real service
recovery (wrong order, complaint, customer walked). Modeled as its own
table instead of extending `Payment` so "how much was refunded and why"
stays a first-class, always-reasoned fact rather than a payment method
inferred from a negative sign.

**Impact:** `apps/api/prisma/schema.prisma` (new `Refund` model +
`Invoice.refunds` back-relation), `apps/api/src/products/invoice.dto.ts`
(new file, `refundSchema`), `apps/api/src/products/invoice.service.ts`
(`refund()`, `getById`/`listForBranch` extended to include refund data),
`apps/api/src/products/invoice.controller.ts` (`POST :id/refund`),
`apps/web/src/lib/api.ts` (`refundInvoice`, `InvoiceRefundRow`,
`InvoiceDetail.refunds`, `InvoiceSummary.refunded`),
`apps/web/src/app/invoices/[invoiceId]/page.tsx` (Refund button + inline
form + receipt sections), `apps/web/src/app/dashboard/[branchId]/invoices/page.tsx`
(Refunded/Partially refunded badge). Verified live: opened a real ₹250
ad-hoc invoice, recorded a partial ₹100 refund with a reason, confirmed
the receipt correctly showed "Refunded −₹100.00 / Net ₹150.00" and the
list showed "Partially refunded"; confirmed the over-refund guard via
curl (`HTTP 400`, `"Only ₹150.00 is left to refund on this invoice"`,
since the browser's own `max` attribute blocks that case client-side
before it can reach the server); confirmed the void-invoice guard via
curl against a real void invoice (`HTTP 400`, `"This invoice is void —
nothing left to refund"`); recorded the remaining ₹150 refund and
confirmed the "Refund" button correctly disappeared, the receipt showed
"Refunded −₹250.00 / Net ₹0.00" with both refund lines listed, and the
list correctly flipped the badge from "Partially refunded" to
"Refunded". `npm run typecheck` and `test-flow.sh` clean throughout;
`prisma generate`'s binary copy failed on the known dev-server file lock
but the stale binary confirmed working correctly against the new model
at runtime, same as every prior model added this session.

---

## 2026-09-23 — Split tender (second of the six remaining POS gaps)

**Decision:** `Payment.invoiceId` was deliberately left non-unique back
when the commerce model was first built, specifically so "an invoice can
carry multiple payments for split tender" — but `recordPayment` only
ever wrote one. Changed its contract from `{amount, method}` to
`{tenders: [{amount, method}]}` (min 1, max 4): the sum across every
tender line is what's checked against the cart total (same
over/under-tender rule as before, just summed), and one `Payment` row is
written per line via `createMany` inside the same transaction as the
`Invoice`. No schema change — this was always the shape `Payment` was
built for.

The harder part was the counter tablet, since a genuinely different
interaction was needed without slowing down the common single-tender
case (still one tap, unchanged). A tap either finishes the sale or
extends an in-progress split, decided by the same rule server-side and
client-side: does this tender cover what's left? If yes, everything
collected so far (including this tap) submits in one call, exactly
today's one-tap flow when it's the first and only tender. If it falls
short, it's banked as a line, the amount field re-fills to the real
remaining balance, and the token stays in `Serving` — un-changed from a
customer's perspective, since they haven't been served yet, just not
fully paid. A small running summary (`CASH ₹100 / CARD ₹108.95 / Still
owed ₹0`) plus a "Clear and start over" escape hatch sits above the
amount field only once a split is actually in progress — nothing new to
look at for the 95% of sales that are one tender, one tap.

**Reason:** Third of six named POS gaps, picked next since the data
model already anticipated it and `test-flow.sh` doesn't exercise
`record-payment` at all (confirmed by grep before starting) — meaning
this needed real live verification, not just a clean typecheck, to
trust it actually works.

**Impact:** `apps/api/src/counters/{counter.dto,counter.service}.ts`
(breaking contract change on `POST /counters/:id/record-payment`, same
turn as the only caller), `apps/web/src/lib/api.ts`
(`recordPayment(counterId, tenders)`),
`apps/web/src/app/counter/[counterId]/page.tsx` (the tender-tracking
state and UI). `PaymentCompleted`'s event payload changed from
`{amount, method}` to `{total, tenders}` — confirmed nothing in the web
app parses that payload's fields before making the change. Verified
live end to end, deliberately including the case `test-flow.sh` can't
reach: rang up a real cart (₹208.95 with GST), split it ₹100 CASH + the
rest CARD, confirmed the token stayed `Serving` after the partial tap
and the running balance/summary rendered correctly, confirmed the final
tap completed it and issued one Invoice carrying both Payment rows,
confirmed the invoice list correctly showed "cash, card" and the
receipt correctly showed both lines summing to the real total, then
separately ran an ordinary single-tender ad-hoc sale start to finish to
confirm zero regression in the one-tap case. `npm run typecheck` and
`test-flow.sh` clean throughout.

---

## 2026-09-23 — Real inventory depletion (first of the six remaining POS gaps)

**Decision:** The "Track stock" checkbox on a product has been inert
since it was built — checked or not, nothing anywhere read or wrote it.
`StockMovement` already existed as a correctly-shaped append-only ledger
(no separate "current stock" column to drift out of sync — stock-on-hand
is just the sum of its movements, same pattern `QueueEvent` already
uses for history), just never written to. Wired it up:
`OrderService.addItem` now checks available stock and writes a negative
movement inside the same transaction as the cart upsert for a
`trackStock` product (transaction matters here specifically — two rapid
taps racing each other must never both pass the check and jointly
oversell past zero); `removeItem` deletes that line's movements rather
than writing a compensating positive one, since the line never happened
from a stock perspective once it's been taken back out of the cart.
`ProductService` gained `restock` (Setup → Products, a plain "quantity
received" input) and both product-list methods now attach a computed
`stock` field — `list()` (Setup, admin view) shows the real number even
at zero or negative so a manager knows to restock; `listForBranch` (the
counter tablet's tap grid) instead drops a tracked product entirely once
it hits zero, same as an inactive one, and shows "N left" once stock
drops to 5 or under.

**Bug found and fixed during live verification, not requested but
discovered testing the above:** depleting a branch's only tracked
product to zero made its entire cart section vanish from the counter
tablet — not just the tap grid, the *already-added, already-priced*
line items too, along with the running total. `hasCatalogue` (which
gates whether the cart section renders at all) was computed purely from
the current stock-filtered product list, which is correct for "does
this branch sell anything" but wrong the moment that list can empty out
mid-transaction from a live stock change — a real, already-committed
₹417.90 order briefly had no UI showing it existed. Confirmed via a
direct database read that the order data itself was always intact (this
was a display bug, not data loss), then fixed by also checking whether
the order already has items: `products.some(p => p.active) ||
(order?.items.length ?? 0) > 0`. Also tightened the empty-state copy
next to it — "No products set up yet" is only true in one of the two
cases that message now covers (configured-but-depleted is the other),
so it reads "Nothing available to add right now" instead, correct
either way.

**Reason:** First of six POS gaps named earlier this session
(inventory, split tender, refunds, discounts, shift close, kitchen
display), tackled in order of how self-contained each one is —
inventory needed nothing from the others to be correct and complete.

**Impact:** `apps/api/src/products/{product,order}.service.ts`,
`apps/api/src/products/{product.controller,product.dto}.ts` (new
restock endpoint), `apps/web/src/lib/api.ts` (`ProductRow.stock`,
`restockProduct`), `apps/web/src/app/setup/products/page.tsx` (stock
pill + inline restock form), `apps/web/src/app/counter/[counterId]/page.tsx`
(low-stock label, the `hasCatalogue` fix, the copy fix). No schema
change — `StockMovement` was already exactly the right shape. Verified
live rather than by inspection: enabled tracking on a real product,
restocked it to 2, sold both through the actual counter tablet
(confirmed the "N left" label ticking down live), confirmed the product
correctly disappeared from the tap grid at zero, confirmed a direct API
call to force-add a third unit was correctly rejected with a clear
message, confirmed removing a cart line correctly restored stock and
brought the product back, and confirmed Setup → Products reflected the
real count at every step. `npm run typecheck` and `test-flow.sh` clean
throughout, including after the mid-verification fix.

---

## 2026-09-23 — Invoice viewer (the other write-only data path closed)

**Decision:** Same shape of gap as the push notifications entry above —
`CounterService.recordPayment` has always issued a real, correctly
numbered `Invoice` with real GST math, nothing ever read one back. Built
the read side: `InvoiceService` (`apps/api/src/products/invoice.service.ts`)
with `listForBranch` (summary rows — number, total, status, tender
method(s), customer name, newest first), `getById` (full line items,
payments, customer, branch/org — for a real receipt), and `void` (flips
`Invoice.status` to `VOID`, one-way, idempotency-guarded against
double-voiding — the schema already had `ISSUED | VOID` sitting there
unused, same "add the column, wire the behavior later" pattern as
`Product.branches` and `Notification.status` before it). New
`InvoiceController` (`@MinRole('ADMIN')`, matches the dashboard's own
access tier — financial data, not floor-staff level) for `:id` and
`:id/void`; the branch-scoped list lives on `BranchController` alongside
`activity`, matching that existing convention. Frontend: a real
"Invoices" list page (`/dashboard/:branchId/invoices`, with its own
sidebar nav entry — learned from the counters-nav gap two entries back
not to bury a whole feature behind a scroll with no link to it) and a
standalone, printable receipt page (`/invoices/:id`, same `print:`
pattern as the QR page — no AppShell chrome, since its job is to be
printed, not navigated) with the void action on it.

**Reason:** Direct follow-on request after push notifications, framed
the same way: find what's computed correctly but never surfaced, and
surface it. Explicitly scoped to the viewer + void — shift close,
inventory depletion, split-tender UI, and a kitchen display system are
separate, larger POS gaps named earlier and deliberately left alone
here rather than folded in unasked.

**Impact:** `apps/api/src/products/{invoice.service,invoice.controller}.ts`
(new), `apps/api/src/branches/branch.controller.ts` (`branches/:id/invoices`),
`apps/api/src/app.module.ts`, `apps/web/src/lib/api.ts` (types +
`invoices`/`invoice`/`voidInvoice`), new
`apps/web/src/app/dashboard/[branchId]/invoices/page.tsx` and
`apps/web/src/app/invoices/[invoiceId]/page.tsx`,
`apps/web/src/components/app-shell.tsx` (nav entry). No schema change —
`Invoice.status` was already exactly `ISSUED | VOID`. Verified live end
to end rather than by inspection: recorded two real payments through
actual counters (one ad-hoc/no-catalogue, one itemized with real GST) to
generate real invoices, confirmed both rendered correctly in the list
and as full receipts (correct customer, correct line items, correct
subtotal/GST/total, correct tender method), exercised the two-step void
confirm live and confirmed both the detail page and the list reflected
it immediately, and confirmed a `COUNTER_STAFF`-rank account is
correctly refused (403) on both the list and detail endpoints via a
direct API call. `npm run typecheck` and `test-flow.sh` clean throughout.

---

## 2026-09-19 — Real Web Push notifications (the SIMULATED gap closed)

**Decision:** `QueueService.maybeNotify` has known exactly when and what
to tell a waiting customer since Phase 6 — it just wrote a `Notification`
row with `status: 'SIMULATED'` and logged it, nothing was ever sent. Wired
real delivery in, no paid provider: Web Push rides free through the
browser vendor's own push service, authenticated by this app's own VAPID
key pair (`npx web-push generate-vapid-keys`, stored in `apps/api/.env`)
rather than an account with a third party. New `PushSubscription` model
(one row per browser that tapped "Notify me," keyed by `endpoint` so
re-subscribing the same browser updates in place, `onDelete: Cascade`
from `Token` — a subscription only means anything for that one wait).
New `PushService` wraps the `web-push` library (real cryptographic
weight — ECDH, AES-GCM, VAPID JWT signing — not something to hand-roll)
with `subscribe()` and `send()`; `send()` returns whether *any*
subscription actually delivered, and `maybeNotify` now flips the
`Notification` row to `'SENT'` only on real success — `'SIMULATED'` still
means exactly what it always did, "computed, but nobody was listening,"
not "not built yet." A 404/410 from the push service (browser discarded
the subscription — uninstalled, expired, permission revoked) deletes it
rather than retrying forever. New `POST /t/:code/push-subscribe`
(`@Public()`, same tier as every other customer action). Frontend: a
static `public/sw.js` service worker (push receiver only — no caching, no
offline support, this isn't a PWA), a "Notify me" card on `/t/[code]`
with real per-state handling (unsupported browser → nothing shown at all,
not a dead-end; blocked permission → one clear message, no button
pretending to still work; mid-request → spinner; failure → an honest
fallback telling them to keep the page open instead). VAPID public key
shipped via `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, matching how
`NEXT_PUBLIC_API_URL` already works — no new "give me the public key"
endpoint needed for a value that never changes at runtime.

**Reason:** Talked through the options with the project owner first —
SMS/WhatsApp need a paid provider (Twilio et al.), push doesn't. Chosen
as the highest-leverage next feature precisely because the trigger logic
already existed; this closed the gap rather than building something new.

**Alternatives considered:** hand-rolling the push crypto — rejected,
real algorithmic weight matching an established library's exact job,
not a place to reinvent anything.

**Impact:** `apps/api/prisma/schema.prisma` (`PushSubscription`),
`apps/api/src/notifications/push.service.ts` (new),
`apps/api/src/queues/queue.service.ts` (`maybeNotify` now sends for
real), `apps/api/src/tokens/{token.service,token.controller,token.dto}.ts`
(subscribe endpoint), `apps/api/src/app.module.ts`, `apps/api/.env` /
`.env.example` (VAPID_*), `apps/web/public/sw.js` (new),
`apps/web/src/app/t/[code]/page.tsx` (NotifyMeCard),
`apps/web/src/lib/api.ts`, `apps/web/.env.local`
(NEXT_PUBLIC_VAPID_PUBLIC_KEY). One new dependency each side (`web-push`
api-side; nothing new web-side, the Push API is native browser
platform). Verified thoroughly given this touches real external
delivery and browser permissions: `npm run typecheck` and
`test-flow.sh` clean on both; the subscribe endpoint tested directly
against the running API with a real check-in and confirmed the
resulting `PushSubscription` row persisted correctly; the send path's
error handling verified by calling `webpush.sendNotification` directly
against that subscription and confirming a malformed-key failure is
caught cleanly, matching exactly what `PushService.send`'s try/catch
does per subscription; the frontend UI verified live end-to-end through
every reachable state (idle → enabling → denied → error), including
finding and fixing a real overlap bug (a "blocked" warning could render
next to a still-clickable "Enable" button). The one thing not
verifiable from here: an actual OS notification appearing, since this
sandboxed test browser restricts service-worker registration in a way
a real browser doesn't — flagged clearly rather than claimed as
confirmed. Also surfaced and documented for later: Web Push requires a
secure context, and browsers only exempt `localhost` from that, not a
LAN IP — so the QR/check-in flow works fine over a phone's LAN HTTP
connection once the firewall's sorted, but push specifically will not,
until there's a real HTTPS origin (a tunnel, or the eventual real
deployment).

---

## 2026-09-19 — Real check-in QR code, printable

**Decision:** Every earlier mention of "the QR code" this whole
engagement was aspirational — the "Check-in" button just linked straight
to the check-in form; nothing actually rendered a scannable code. Added
one. New public page `/checkin/:branchId/qr` (no auth, same reasoning as
`/checkin` and `/display` — whoever's pointing a phone camera at it was
never going to be logged in): fetches the branch's public check-in info,
renders a QR (via `qrcode.react`, one new zero-dependency package) that
encodes `window.location.origin + /checkin/:branchId` — computed
client-side at render time, never a hardcoded/API origin, since it has
to resolve to wherever the scanning phone can actually reach this app.
A "Print" button (`window.print()`) with Tailwind `print:` variants
hiding the nav chrome, so the printed page is just the org/branch name
and the code — meant to be taped up at the venue, not read on a
dashboard. New "QR code" button on the branch dashboard header, next to
the existing Check-in/Display buttons — deliberately not folded into
the existing Check-in button, which is a different, still-needed thing
(staff filling the form in themselves for a phone-in customer).

**Reason:** Direct request — build the thing that's been referenced
conceptually all session but never existed.

**Alternatives considered:** hand-rolling QR encoding — rejected
outright, it's real algorithmic weight (Reed-Solomon error correction,
mode selection) that a one-line library call already solves correctly;
not something to reinvent for a first pass.

**Impact:** `apps/web/package.json` (`qrcode.react` added), new
`apps/web/src/app/checkin/[branchId]/qr/page.tsx`,
`apps/web/src/app/dashboard/[branchId]/page.tsx` (new header button).
No backend changes — reuses the already-public `checkin-info` endpoint.
Verified live: loaded the page, confirmed it renders the branch's real
name and a correctly-scannable code (crisp black-on-white modules,
correct URL printed underneath for a human to double check against).
`npm run typecheck` clean.

---

## 2026-09-15 — Counters had no sidebar nav entry (Owner/Admin couldn't find them)

**Decision:** Turns out the feature requested — Owner/Admin clicking
through from the dashboard to a live queue or counter, seeing exactly
what a staff member would — already existed end to end (`QueueGrid`
cards already linked to `/queues/:id`, `CounterStrip` rows already
linked to `/counter/:id`, verified both live). The actual gap: the
counters section had zero entry in `AppShell`'s sidebar nav — unlike
queues (`vertical.terminology.queuePlural`, linking to `#queues`),
counters were only reachable by scrolling to the very bottom of a long
dashboard, past KPIs, queues, AI panel, activity feed. Its wrapper div
was also `id="settings"` — a leftover/mismatched anchor nothing actually
pointed at. Added a sidebar item (`vertical.terminology.counterPlural`
— "Pickup Points" for this vertical — with a badge count, same shape as
the queues entry) linking to `#counters`, and renamed the anchor to
match.

**Reason:** The project owner asked for this as if it didn't exist;
checking live proved the mechanism was already there, just
undiscoverable — no link anywhere led to it except scrolling.

**Impact:** `apps/web/src/components/app-shell.tsx` (new `counterCount`
prop, new nav item), `apps/web/src/app/dashboard/[branchId]/page.tsx`
(passes the count, `id="settings"` → `id="counters"`). Verified live:
the "Pickup Points" sidebar item now appears with the right badge count
and jumps straight to the section on click.

---

## 2026-09-15 — Branch-scoped products, delete for queues/counters, floor-staff transfer

**Decision:** Four related fixes, each found by using the product rather
than reading the code.

1. **Per-branch product availability.** `Product` gained an optional
   many-to-many relation to `Branch` (empty = every branch, the default —
   every existing product is unaffected). Setup → Products gained an
   "Available at" picker (only rendered once an org has 2+ branches).
   Enforced twice: the counter tablet's catalogue is now resolved
   server-side per-branch (`ProductService.listForBranch`), and
   `OrderService.addItem` independently rejects adding a product that
   isn't available at the order's branch — not just hidden in the UI.
2. **Delete for queues and counters.** Counters are safe to hard-delete —
   `Token.counterId` is `SetNull`, so history just loses its "which
   counter" pointer. Queues are not: `Token.queueId` cascades, so
   `QueueService.delete` refuses outright if a single token has ever
   passed through it, pointing the admin at Status → Closed instead.
   Verified live: deleting a used queue is correctly refused with that
   message; deleting an unused one correctly clears the dangling
   `nextQueueId` on whichever queue pointed at it (schema-level
   `SetNull`, no app code needed).
3. **`request()` silently broken on every DELETE.** Found while testing
   the above: the shared frontend fetch helper unconditionally called
   `res.json()` on success, which throws on the empty body every delete
   endpoint returns. This wasn't new — `deleteServiceType` had the exact
   same latent bug since it was written, silently swallowed because its
   caller's `catch` block masked it as "could not remove service" while
   the removal had actually already succeeded server-side. Fixed once at
   the shared function: read the body as text first, parse only if
   non-empty.
4. **Floor staff can now transfer a customer between queues.** Previously
   Admin-only. Reasoned through with the project owner: "wrong line,
   move them" is routine triage a receptionist handles constantly, not a
   decision that needs a manager — unlike priority override (jumping
   someone ahead of everyone else waiting), which stays Admin-gated on
   purpose, since that has a fairness dimension worth a manager's
   sign-off. Lowered `POST /tokens/:id/transfer` to `COUNTER_STAFF`;
   `TokenService.transfer`'s own same-branch scoping (`requireManageAccess`)
   still applies independently, so this doesn't widen reach beyond one
   branch. Also added a "Transfer" link on the counter tablet's header
   pointing at `/queues/:id` — floor staff previously had zero UI path to
   that screen even though nothing blocked them from using its actions in
   principle. That surfaced a second, coupled gate: the sibling-queue list
   the transfer dropdown depends on (`GET /branches/:id/queue-config`) was
   still `@MinRole('ADMIN')`, so the dropdown rendered empty for anyone
   below Admin even after the action itself was reachable — lowered that
   too (nothing sensitive in a raw queue-config list — no customer or
   financial data, just operational settings, still branch-scoped).

**Reason:** All four came directly from the project owner using the app
and asking "why can't I..." — not from a planned backlog.

**Impact:** `apps/api/prisma/schema.prisma` (`Product.branches` relation),
`apps/api/src/products/{product,order}.service.ts`,
`apps/api/src/counters/counter.{service,controller}.ts`,
`apps/api/src/queues/queue.{service,controller}.ts`,
`apps/api/src/branches/branch.controller.ts` (`queue-config` role),
`apps/api/src/tokens/token-admin.controller.ts` (split `@MinRole` per
action), `apps/web/src/lib/api.ts` (the `request()` fix — affects every
DELETE call in the app, not just the new ones),
`apps/web/src/app/setup/products/page.tsx`,
`apps/web/src/app/setup/branches/[branchId]/{queues,counters}/page.tsx`,
`apps/web/src/app/counter/[counterId]/page.tsx`. Verified live throughout
rather than just by type-checking: created a second branch and a
branch-restricted product and confirmed it was invisible/visible on the
right counters; deleted a counter and a queue (one blocked, one allowed)
and watched the dangling reference clear itself; signed in as an actual
`COUNTER_STAFF`-rank seeded account and performed a real transfer
end-to-end through the newly-added UI path. `npm run typecheck` (api +
web) and `apps/api/test-flow.sh` stayed clean throughout.

---

## 2026-09-10 — Counter tablet polish + dashboard reflecting live counter state

**Decision:** Three fixes, all found live rather than by inspection alone.
(1) `BranchController.overview()` (`apps/api/src/branches/branch.controller.ts`)
now includes each counter's `queue` relation and a `currentToken` (code +
customer name) resolved from whichever token is `SERVING`/`CALLED` at that
counter — one extra query for all counters, not N. (2) `CounterStrip`
(`apps/web/src/components/dashboard.tsx`) was checking
`counter.status === 'OPEN'`, a status that has never existed on `Counter`
(`COUNTER_STATUSES` is `IDLE|SERVING|BREAK|CLOSED`) — the live dot never lit
and the header count was always "0 open". Replaced with a real
status→tone/label map and now shows "N serving" plus who's being served.
(3) The counter tablet (`apps/web/src/app/counter/[counterId]/page.tsx`)
had the same status-Pill bug (only recognized SERVING), showed no positive
feedback on a successful action (errors only), and had no motion anywhere.
Added a status tone/label map, a transient success message alongside the
existing error path, and framer-motion transitions on the "Now Serving"
block, the cart lines, and the up-next list.

**Bug found and fixed during verification, not requested but discovered
live:** the first version wrapped the "Now Serving" code and customer name
in *separate* animated elements, so a fast transition could show a stale
code next to the new name for a frame — merged into one animated block so
they always transition as a unit. Then, testing that with back-to-back
Next-guest presses (an immediate `onChange()` refetch plus a
socket-debounced refetch landing moments later — see `use-live.ts`, which
has no request-sequencing guard), `AnimatePresence mode="wait"` got stuck
holding the hero blank: the key changed again before its exit animation
finished, which is a known `mode="wait"` failure mode. Dropped `mode="wait"`
in favour of a plain crossfade, which has no sequencing to get stuck in.
Confirmed fixed by repeating the same rapid-click sequence that broke it.

**Reason:** Direct user request — "the ui looks bad, the changes made
there should also reflect it dashboard as well, and make the counter page
more interactive." The dashboard piece required real backend data (no
current-token info existed anywhere before this), not just a frontend fix.

**Impact:** `apps/api/src/branches/branch.controller.ts` (`overview()`
query + response shape), `apps/web/src/lib/api.ts` (`CounterRow.currentToken`),
`apps/web/src/components/dashboard.tsx` (`CounterStrip`),
`apps/web/src/app/counter/[counterId]/page.tsx`. Verified with
`npm run typecheck` (api + web), `apps/api/test-flow.sh` (unmodified, still
passing), and live browser testing on the seeded Burger Junction org —
including deliberately hammering the Next-guest button to reproduce and
then confirm the fix for the `AnimatePresence` bug above.

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

## 2026-09-09 — Security and bug audit

**Decision:** A full pass over the codebase for bugs and security issues,
concentrated on the newest code (the POS work is the highest-risk recent
addition) with a lighter confirmation pass over the established auth/
tenant-isolation surface. Four real issues found and fixed; the rest of
the surface checked out clean.

**Fixed:**
1. **Race condition, duplicate cart lines** — `OrderService.addItem` did
   a find-then-write (check for an existing line, then create or update)
   instead of an atomic operation; two rapid taps on the same product
   could create two line rows instead of incrementing one. Fixed with a
   new `@@unique([orderId, productId])` constraint (NULL `productId` —
   ad-hoc lines — stays exempt, since Postgres treats every NULL as
   distinct) and `prisma.orderItem.upsert()` in place of the read-then-
   write. Verified by firing 5 truly concurrent adds of the same product:
   before the fix this was untested and exposed; after, it correctly
   produces one line at quantity 5.
2. **Stale data feeding the issued invoice** — `CounterService.
   recordPayment` computed the invoice from an `Order` snapshot fetched
   *before* its `$transaction` opened. A cart line added in that window
   (a staff member still ringing up items while payment is being
   recorded) would have been silently dropped from the invoice. Fixed by
   re-reading the order fresh from inside the transaction instead of
   trusting the pre-transaction snapshot.
3. **No validation that the tendered amount covers the cart** — `dto.
   amount` (what staff types/taps as the payment) was never checked
   against the actual invoice total when a real cart existed; any
   positive number was accepted and recorded as a completed payment
   regardless of what was actually owed — a real under-recording (or
   fraud) gap, not just an edge case. Fixed: reject with a clear message
   when `amount < total - 0.01` (a small epsilon for float rounding),
   while still allowing *over*-tendering, since a cash payment
   legitimately exceeding the total (change due) is normal and this
   product deliberately doesn't build change-calculation. Verified both
   the rejection and the legitimate-overpayment path.
4. **Frontend: stale tender amount after emptying the cart** — the
   payment-amount input only re-synced when `order.total > 0`, so
   removing the last cart item left the field showing the old total
   instead of clearing — a staff member could submit a payment amount
   that no longer matched the actual (now smaller or empty) cart. Fixed
   the sync effect to clear back to empty whenever the total is zero.
   Verified in the browser: added a product (field filled to match),
   removed it (field correctly went back to empty).

**Reviewed and found solid, no changes needed:** CORS restricted to the
configured `WEB_ORIGIN` (never a wildcard); the auth guard fails closed
by default (every controller requires auth and an explicit `@MinRole`
unless it opts out with `@Public()` — confirmed by auditing every
controller's decorators, not just spot-checking); password hashing is
scrypt with a random salt per password and a timing-safe comparison;
every single mutating endpoint validates its body through the `ZodBody`
pipe (confirmed via a repo-wide search for `@Body(` — zero instances
without a schema); no raw SQL anywhere in application code; no secrets
or non-`NEXT_PUBLIC_` env vars reachable from the client bundle; the
newest Product/Order endpoints resolve every tenant-scoped id (`visitId`,
`organizationId`) from already-authenticated, already-scoped server-side
context rather than trusting a client-supplied id for anything sensitive
— no IDOR found. Cross-queue token transfer and priority-change (an
older, higher-risk-looking surface — moving a token between queues) were
re-checked and correctly require manage-access on both the source and
target queue, with cross-branch transfers explicitly blocked.

**Impact:** additive schema-only change (the new unique constraint —
confirmed zero existing duplicate rows before adding it, so no data was
affected). No API contract changes. `test-flow.sh` and full `npm run
typecheck` across all three workspaces stayed clean throughout.

---

## 2026-09-09 — CORS was silently blocking every PATCH/DELETE from the browser

**Decision:** `main.ts`'s `app.enableCors(...)` now explicitly lists
`methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']`. It previously passed
only `{ origin, credentials }`, relying on `@fastify/cors`'s own default —
which turns out to be `GET, HEAD, POST`, confirmed directly (`curl -X
OPTIONS ... -H "Access-Control-Request-Method: PATCH"` came back with
`access-control-allow-methods: GET,HEAD,POST`). Every `PATCH` and
`DELETE` request made *from the browser* — editing a staff member,
branch, queue, counter, or product; removing a cart line — was being
silently blocked by the browser's own CORS preflight check before it
ever reached the server. The user saw this as a bare "Failed to fetch"
with no further detail, on the Staff "Save changes" button specifically,
though the same root cause affects every PATCH/DELETE surface in the
app.

**Reason:** every prior phase's verification in this session ran through
`curl` or direct `fetch` calls made from `node -e` scripts — neither
goes through a browser's CORS enforcement, so this had zero chance of
surfacing in any of that testing, however thorough. It only became
visible once the user exercised the real UI in a real browser. This is
also the actual explanation for a DELETE failure spotted earlier this
session (removing a cart item, Phase 2 of the POS work) that was
incorrectly attributed to "a sandbox browser-tool networking quirk" at
the time — it was this same bug, just not investigated far enough to
find the real cause.

**Impact:** no API contract change, no new endpoint — purely a
transport-layer fix. Every existing PATCH/DELETE endpoint (staff,
branches, queues, counters, products, order items, service types)
becomes reachable from the browser for the first time; nothing about
what those endpoints do changes.

**Verified:** direct `curl -X OPTIONS` before/after showing the
`Access-Control-Allow-Methods` header change from `GET,HEAD,POST` to
`GET, POST, PATCH, PUT, DELETE`. Reproduced the original failure live in
the browser (edited a staff member's name, `Failed to fetch` shown
inline, confirmed via the network log and console that the PATCH itself
was CORS-blocked after a successful OPTIONS preflight, and confirmed via
a direct API query that the edit had *not* applied server-side). After
the fix, repeated the identical edit through the same UI and confirmed
the name change persisted. `test-flow.sh` (curl-based, so it could never
have caught this) and full `npm run typecheck` stayed clean.

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
