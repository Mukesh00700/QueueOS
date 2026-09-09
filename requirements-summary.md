# Target Product — Structured Summary

**Source:** "Unified Customer Flow, Queue Management & POS Operating System.docx" (43 chapters, 35 figures) — the product strategy document defining what QueueOS should become. This is a dense distillation, kept here so future work doesn't require re-parsing the original 43-chapter docx. See `plan.md` for the gap analysis and phased implementation plan built from this summary against the current codebase (`flow.md`).

---

## 1. Core Thesis & Positioning (Chapters 1–4)

**Single-sentence thesis:** Do not build a POS beside the queue-management system — build one Customer Flow Commerce OS in which the queue is the *trigger* for commercial intelligence, not a turnstile in front of a till. The queue knows demand before it's expressed; a POS knows value after it's realised; held together on one record they answer what neither can alone: *what did waiting cost us in revenue this month, and which specific customers did it cost us?*

**Five conclusions of the Executive Summary:**
1. Position as a "Customer Flow + Commerce Operating System," never as "queue management plus POS" — the category name determines buyer, price point, and competitive set.
2. Make the **visit** — not the transaction, not the token — the backbone entity. One `visit_id` carries identity, wait, service, basket, payment, feedback, and predicted next visit.
3. Treat the queue as the trigger for POS intelligence: joining a queue must open a customer session, expose history, forecast basket value, score abandonment risk, and pre-fill the cart.
4. Build retention as an engine, not a report — a health score, four risk bands, one automated/measured play per band, closed-loop (plays that don't work are down-weighted).
5. Earn stickiness through accumulated intelligence, never through contract lock-in. Full export must always be available.

**What already exists (current QueueOS):** Organization, Branch, Queue, ServiceType, Counter, StaffUser, Customer, Token, Feedback, and a durable QueueEvent log, with a deterministic/explainable ETA model. These facts (arrival time, service wanted, wait duration, estimate honesty, who served, service duration vs. historical distribution, early departure) are "commercially inert" until a basket is attached to the same record — that attachment is the whole thesis.

**The "visit" backbone concept:** Customer → Visit → Queue Token → Service → Staff → Order → Items → Inventory → Invoice → Payment → Feedback → Loyalty → Future Visit — one chain, one set of identifiers, no reconciliation. Most platforms that claim unification actually run two customer tables merged on a schedule (usually by mobile number), which fails quietly. The fix: visit is the backbone, every operational/commercial row carries its identifier.

**The trigger model per vertical (4.1):**
- **Restaurant:** create customer/session, recover party size & seating preference, recall previous orders/avg spend, forecast table turnover.
- **Salon/spa:** expose preferred services, preferred stylist, package balance, purchase history, rebooking interval.
- **Hospital/clinic:** move patient through service+billing stages together (registration → department queue → diagnostics → pharmacy → billing) without clinical detail entering a commercial model.
- **Temple:** attach visitor to slot/category/crowd-safety management; connect to donation/prasadam/merchandise only where appropriate, never inside the darshan queue.
- **Government/retail counter:** identify applicant/shopper, retrieve case/basket in progress, route to the counter with the right competence rather than the shortest line.

**Design-rule constraint:** No commercial screen may ask for information the queue already holds — if staff must retype a name or reselect a service already captured at check-in, the architecture (not the UI) is broken.

**The ten questions the system must continuously answer (4.2):** Who is waiting? / Why are they waiting? / What do they want? / Who will serve them? / How long will it take? / What is the probable transaction value? / What can be cross-sold? / What is the probability of abandonment? / What should happen after service? / When should this customer return? — each mapped to a data source and a consumer (staff console, routing engine, ETA model, forecast, POS session, retention engine, marketing automation, etc.).

**The quality bar (Chapter 2):** Only ideas scoring **≥9.5/10** across fifteen weighted criteria enter the roadmap; everything else is DEFER or DO NOT BUILD NOW. Rationale: the platform's failure mode is dilution (a roadmap padded with parity features), not omission.

**The fifteen criteria:** (1) Customer retention, (2) Revenue generation, (3) Operational efficiency, (4) Customer experience, (5) Ease of implementation, (6) Cross-selling potential, (7) Recurring revenue, (8) Data/network effects, (9) Competitive differentiation ("could a standalone POS or queue tool do this? if yes, scores low"), (10) Scalability, (11) Multi-location capability, (12) AI readiness, (13) ROI for the merchant, (14) Switching cost, (15) Cross-vertical fit. A commodity feature (e.g., split billing) is admitted only when wired to queue intelligence (e.g., split billing that knows which party member is the returning customer).

---

## 2. Unified Data Model (Chapter 5)

**Backbone entities and purpose:**

| Entity | Purpose | Why it's on the spine |
|---|---|---|
| Customer | One resolved identity per real person per org | Every history/preference/balance/prediction hangs off it |
| **Visit** (new backbone) | One occasion of engagement with a branch | Binds wait to basket, staff to satisfaction, cost-of-service to revenue |
| Queue Token | Place in line, priority, ETA | Carries `waited_minutes` — the variable making wait commercially measurable |
| Order & Order Item | What was sold, at what price/cost, by whom | Line-level staff attribution makes productivity/commission honest |
| Invoice & Payment | Legal document + money movement (deliberately separated) | One invoice may carry several tenders/payers |
| Stock Ledger | Append-only movement of every SKU | Depletion by order items; replenishment by forecast footfall |
| Loyalty Account | Points, tier, expiry per customer | Accrual triggered by payment events, not a nightly job |
| Feedback & Interaction | What customer said / what we said to them | Tied to `visit_id` — attributes dissatisfaction to waiting vs. service |

**Already exists in current QueueOS schema** (per Figure 17 caption and Ch 1.1): Organization, Branch, Queue, ServiceType, Counter, StaffUser, Customer, Token, Feedback, QueueEvent (durable event log), deterministic ETA model.

**New/extension entities:** Visit (the new backbone), Order/Order Item, Invoice/Payment, Stock Ledger, Loyalty Account, plus the commerce/intelligence entities generally — these "extend the same spine rather than sitting beside it."

**The one governing rule:** *Every commercial row carries `visit_id`. Every operational row carries `visit_id`.* No join key to negotiate, no nightly merge. A PR introducing a commercial table without `visit_id` should be rejected on that basis alone.

**What one customer identity must connect (acceptance test for Customer 360):** queue history & waiting times, appointment history & honour rate, no-shows/abandonments, preferred branch/time — plus purchase history by line item, membership/package balances, payment history/modes, product purchases/repeat rate, average ticket & trend — plus loyalty points/tier, offers received/redeemed, feedback/complaints, staff interactions/preferred provider, satisfaction score, visit frequency/cycle length, lifetime value, churn probability/health band.

**Portability/migration path:** current dev DB is SQLite (no Docker/Postgres on target machine); schema avoids provider-specific features, enum-like columns stored as validated strings, JSON as text. Commerce extension must hold that discipline. Move to PostgreSQL = datasource change + promoting string columns to native enums, nothing else. Multi-tenancy is by organisation scope on every row, so per-tenant partitioning/separate DB remains available later without rewrite.

---

## 3. Full Page/Module Inventory (Chapters 6–26)

> Full specs (all 18 fields) exist for pages carrying core differentiation; everything else appears in condensed module "register" tables (Objective · Users · Queue link · POS link · AI · Permissions). Both forms are condensed here to one line each except where a page is singled out as most important.

### Chapter 6 — Master Dashboard (Command Centre)
**PG-001 Master Dashboard (Command Centre) — 9.8/10.** Objective: give owner/manager real-time state, ranked actions, and evidence of whether prior actions worked, on one screen. Users: org admin/owner, branch manager (read-only for regional). Queue link: primary source — waiting counts, ETA, abandonment, counter utilisation, crowd density stream live. POS link: open sessions, running cart values, pending payments, settled revenue stream from the same visit records. Three zones: (1) Live operations — 12 real-time metrics (customers waiting/served, avg/predicted wait, abandonment, crowd density, service capacity, available staff, busy counters, current orders, pending payments, current revenue), each with threshold behaviour (amber/red rules). (2) Business intelligence — comparative by default (revenue/customers/mix/operations groups, each vs. yesterday/same-weekday/4-week mean). (3) AI recommendations — max 5 items, ranked by expected value not confidence, each scored afterward on whether it was taken (self-scoring discipline against becoming "wallpaper").

### Chapter 7 — Page Specification Standard
Not a page itself — defines the 18-field standard every page spec follows (Page name, Objective, Primary users, Information displayed, Actions available, Queue integration, POS integration, AI intelligence, Notifications, Reports generated, Customer-retention impact, Revenue impact, Suggested UI layout, Empty states, Error states, Permissions, Mobile version, Desktop version). Queue/POS integration fields matter most — "a page that answers 'none' to both is almost certainly a page we should not build." Conventions: empty states teach (never show zeros where "not yet learning" is the truth); errors preserve work (no >5-second action lost to a dropped connection); stale data is labelled, never silently frozen; destructive actions require a reason code + audit log; every list is filterable/sortable/exportable/URL-addressable.

### Chapter 8 — Authentication & Onboarding
- **PG-010 Login — 9.6/10.** Get a returning user into correct branch context fastest. Users: all internal roles (customers never authenticate). Queue link: success routes staff straight to their assigned queue. POS link: bound-terminal sign-in opens shift context + cash-float prompt.
- **PG-011 OTP Login — 9.6/10.** Reliable sign-in on shared devices for staff. Same landing/shift behaviour as password login.
- **PG-012 Business Registration & Verification — 9.5/10.** Take a new merchant from nothing to verified org + branch + queue + till in one sitting. Queue link: vertical selection sets terminology/journey stages/default queue templates. POS link: captures tax identity, invoice series, payment methods so first sale doesn't stall.
- **PG-013 POS Terminal & Device Setup — 9.5/10.** Bind a device to branch/counter/printer once. Queue link: bound counter means "call next" always draws the right queue. POS link: determines invoice series, till, cash-drawer rights.
- Register: **Business Verification** — confirm real business before live payments; blocks queue publication & live tender until verified; document classification assists review. **Branch Setup** — create location w/ hours/capacity/address; defines queues/counters & invoice series/tax context. **Role Setup** — map people to Ch 32 capability model; controls priority overrides & discount/refund thresholds. **Device Setup** — register kiosks/screens/handsets; binds displays to queues, tills to counters.

### Chapter 9 — Business Setup
- **PG-020 Branch Management — 9.6/10.** One place to see/configure every location. Queue link: branch capacity/hours bound the queue engine (no admission beyond capacity without logged override). POS link: holds invoice series, tax registration, payment methods; cloning a branch clones commercial config too.
- **PG-021 Counters, Service Stations & Tables — 9.7/10.** Model physical service points so routing/capacity/revenue attribution compute against reality. Queue link: capacity denominator in the ETA model — "an idle counter beside a long queue is the single most expensive operational state." POS link: a counter may hold a till/invoice series; tables carry open orders in restaurant mode.
- **PG-022 Roles & Permissions — 9.7/10.** Owner expresses who may do what in business language. Queue link: controls who may pause a queue/override priority/force no-show/transfer. POS link: controls discount ceilings, refund/void authority, cash-drawer access.
- **PG-023 Tax, Invoice & Receipt Configuration — 9.5/10.** Legally correct in India on first sale without exposing tax complexity to counter staff. POS link: foundational — every bill/tax split/invoice number derives from here.
- Register: **Business Profile** (legal identity/brand; branding on tracking pages, legal name on invoices), **Departments** (group services/staff; department queues & revenue attribution), **Service Stations** (non-counter points e.g. diagnostics; secondary queues, consumables), **Tables** (restaurant seating; waitlist/turnover clock, open-order container), **Staff** (people/skills/scope; skill-based routing, commission attribution), **Working Hours** (bounds token admission/ETA and tender/day-close), **Holidays** (suppresses queues/drives surge planning; drives stock/staffing pre-orders), **Payment Methods** (determines tender buttons at till), **Notification Configuration** (turn-is-near/recall messages; receipts/dues/payment confirmations).

### Chapter 10 — Queue Management Module ("the module we already win on")
Module conventions: every page reads/writes the same token & visit records (no private state); every state change emits a named event; ETA always shown with confidence; priority is explainable (strict FIFO within a band).
- **PG-100 Live Queue — 9.9/10.** Single floor screen: every waiting customer, wait so far, ETA, priority, **customer value context** (returning/new, LTV band, forecast basket — the differentiating column). Queue link: core surface, emits QueueJoined/QueueAdvanced/CounterAssigned/ServiceStarted/ServiceCompleted/RecallInitiated/CustomerNoShow. POS link: starting a service opens the POS session pre-filled; shows which waiting customers already have an open basket.
- **PG-101 QR Check-In (customer-facing) — 9.9/10.** Join correct queue in <20 seconds from own phone, no install/account. Queue link: creates visit + token, starts ETA clock. POS link: creates the session the POS later attaches a basket to — selected service is the first cart line before meeting staff.
- **PG-102 Customer Live Tracking Page — 9.8/10.** Let a waiting customer leave premises confidently. Queue link: reads same token record, recomputes countdown locally. POS link: becomes the live bill view, then payment surface, then receipt once service begins.
- **PG-103 Queue Routing & Staff Assignment — 9.7/10.** Send customer to best person/place, not shortest line. Queue link: the assignment engine itself (emits CounterAssigned with reason). POS link: assignment determines revenue attribution/commission.
- **PG-104 No-Show, Recall & Recovery — 9.6/10.** Handle absence fairly, recover the customer. Queue link: recall-pending tokens counted at a fraction of full service in ETA model. POS link: no-show on prepaid/package booking has configured commercial consequence.
- **PG-105 Queue Display Screen — 9.5/10.** Non-interactive, tells the room who's serving/next. Queue link: driven entirely by events, never polls. POS link: **none, deliberately** — not an advertising surface (offers here explicitly rejected in Ch 38).
- **PG-106 Crowd Prediction & Queue Forecast — 9.7/10.** Show manager the next 2 hours while there's time to act. Queue link: consumes arrival history/load curve/service-time distributions. POS link: converts predicted footfall into predicted revenue/stock consumption.
- **PG-107 Queue & Service Time Analytics — 9.6/10.** Explain *why* waits happened and what they cost. Queue link: reads full event history, drillable to individual visits. POS link: every wait figure carries associated revenue.
- Register (module conventions apply): **Queue Dashboard** (branch-level queue health — all live metrics; open baskets per queue), **Queue Creation** (define queue/services/capacity/hours — creates entity; binds default services/prices), **Service Selection** (choose what customer came for — sets duration/skill; becomes first cart line), **Token Generation** (issue token w/ priority/channel — creates token; opens session), **Walk-In Customer** (reception-assisted check-in — same token/session path as QR), **Appointment Queue** (booked customers merged fairly w/ walk-ins — slot honoured within priority rules; prepaid/package context loaded), **Virtual Queue** (join remotely, arrive at right time — token without physical presence; session opens on arrival), **Priority Queue** (VIP/senior/differently-abled/emergency bands — weighted ordering, FIFO within band; tier context at till), **Multiple Queue Management** (several queues, one view — cross-queue load balancing; consolidated open baskets), **Counter Management** (open/close/assign/monitor — capacity denominator for ETA; till binding/attribution), **Queue Transfer** (move customer between queues/counters — context & wait credit travel; open basket travels intact), **Queue Pause/Resume** (stop/restart admission safely — ETA flagged unknowable while paused; prevents orphaned baskets), **Customer Recall** (call absent customer back fairly — grace window before lapse; session held open), **Emergency/Priority Handling** (clinical/safety override — highest band, fully logged, never model-driven; billing follows clinical path), **Estimated Waiting Time** (ETA surface shared by staff/customer — model output with confidence; drives basket-value forecasting).

### Chapter 11 — POS Module (native, not "a till in the same app")
Core idea: a sale usually begins *before* anyone touches the POS — by the time counter sees the screen, customer is identified, service is on cart, price applied, loyalty loaded, basket value forecast. Conventions: session opened by queue event not staff action; every line carries delivering staff; prices/taxes/offers resolved server-side; ≤1 recommendation per visit, never repeated once declined; every void/over-policy-discount/refund/override carries reason code + named approver.
- **PG-200 POS Home & New Transaction — 9.8/10.** Complete a sale in fewest actions w/ queue context applied. Queue link: session list *is* the queue; selecting a customer = selecting a token. POS link: core surface — emits order/invoice/payment events.
- **PG-201 Customer Selection & Identity Resolution — 9.7/10.** Attach sale to right person without typing or duplicating. Queue link: identity normally already resolved at check-in (usually a confirmation, not a task). POS link: determines pricing tier, loyalty accrual, package balances, credit terms.
- **PG-202 Cart, Bundles & Add-ons — 9.7/10.** Record what actually happened during service quickly. Queue link: service selected at check-in already present; adding a station-requiring service can raise a follow-on queue entry. POS link: core cart behaviour, tax computation, offer stacking.
- **PG-203 Discounts, Coupons, Loyalty & Membership — 9.6/10.** Bound, attributable, measurable price reductions. Queue link: offers issued as service recovery after a long wait appear here automatically. POS link: full offer engine w/ stacking rules, exclusions, margin floors.
- **PG-204 Payment — Split, Partial & Multi-Method — 9.7/10.** Take money in any combination fast. Queue link: completing payment completes the visit, releases the station, advances the queue. POS link: one invoice, many tenders/payers, each recorded separately.
- **PG-205 Refund, Exchange & Void — 9.5/10.** Reverse transactions correctly/traceably. Queue link: a refund from service failure links back to visit/wait record. POS link: reverses ledger, restores stock, adjusts loyalty/commission, issues credit note.
- **PG-206 Shift Closing, Cash Drawer & Reconciliation — 9.6/10.** Close a shift in <5 minutes with named exceptions. Queue link: shift cannot close with a service in progress on that counter. POS link: three-way reconciliation (bills, tenders, gateway settlement).
- Register: **Product Search** (find product fast — no queue link; adds stocked line), **Service Search** (find correct service variant — may raise follow-on queue entry; adds service line), **Add Item** (qty/variant/delivering staff — line staff attribution; price/tax resolution), **Service+Product Bundles** (priced combos — bundle may span stations; margin floor), **Gift Cards** (issue/load/redeem stored value — liability tracked to redemption), **Membership** (recurring plans — priority band/preferred slots; recurring billing/entitlement draw), **Loyalty Points** (earn/burn — accrual on payment event; redemption as tender), **UPI/Card/Cash/Wallet** (tender surfaces — completion releases station; ledger/settlement), **Payment Pending/Success** (unambiguous end-states — blocks premature completion; reconciles against gateway), **Credit/Due Management** (balances owed — due visible at next check-in; ageing/collection workflow), **Invoice** (GST-compliant legal doc — carries visit reference; series/tax split/HSN-SAC), **Receipt** (customer's digital copy — delivered to consented check-in contact), **Transaction History** (every sale, searchable — links sale to visit & wait), **POS Reconciliation** (three-way match to bank — excludes in-progress visits).

### Chapter 12 — see Section 4 below (the single most important chapter)

### Chapter 13 — Customer 360
**PG-300 Customer 360 — 9.9/10.** One page holding everything known about a person, ending in a single recommended action. Users: owner, manager, staff (restricted), support. Queue link: full queue history including waits/abandonments/no-shows/wait experienced per visit. POS link: full purchase history at line level, package/membership balances, dues, payment behaviour. Six info groups: Identity, Visit behaviour, Commercial, Relationship, Derived (LTV, cycle length, churn probability, health band, revenue at risk), Recommended (next service/product/offer/contact date, each with reason). The "what should we do with this customer?" panel gives one plain-language instruction per situation (7 situations tabled: on-cycle-healthy→silence; spend-rising-tier-close→mention tier progress; upgrade-pattern→offer once at the chair; overdue→send invitation; long-wait-last-visit→offer recovery + protected slot; declining-spend→flag for human conversation; lost→one final honest message then stop).

### Chapter 14 — CRM & Retention Engine (segmentation layer, distinct from Ch 27's health-score engine)
Segments computed continuously from behaviour (not manually assigned), each with a default treatment: **New** (invite once), **Returning** (recognise at check-in, no incentive), **Frequent** (protect slot/provider), **High-value** (priority band, named relationship owner), **VIP** (explicit commitments), **At-risk** (one specific intervention, see Ch 27), **Lost** (one honest reactivation, then stop), **Price-sensitive** (no further discount, test value bundles), **Product-loyal** (replenishment reminders timed to consumption), **Service-loyal** (protect service relationship, don't push retail). Engine must auto-detect: churn risk ranked by revenue-at-risk (not probability alone); imminent repurchasers (to *withhold* contact — reaching out wastes margin/trains discount expectation); upgrade/add-on acceptance candidates (from own acceptance history); unusually-absent-vs-own-cycle customers; declining-spend-while-still-attending (earliest recoverable signal); degrading wait experience (a fixable churn cause). Failure mode to avoid: a retention engine that contacts everyone becomes a discount engine, then spam, then uninstalled — default action for a healthy customer must be silence.

### Chapter 15 — AI Recommendation Engine
Ten inputs (live queue state, customer history, purchase history, service history, inventory, staff availability/skill, time/day/season, stated preference/consent) → outputs (service upgrade offered once; relevant add-on; consumption-timed product; money-saving bundle; membership where frequency justifies it; preference-honouring staff assignment; wait-minimizing routing; most-keepable appointment slot; cycle-derived revisit date; discount last, margin-bounded). Two objectives in tension: **"sell more"** (maximises current basket, easy to over-fire, erodes trust) vs. **"serve better"** (maximises return probability, compounds slowly) — engine optimises serve-better *subject to* a sell-more constraint, never the reverse. Design decisions: ≤1 suggestion/visit; declined item never resuggested to that customer; suggestions suppressed when queue is long; never suggest out-of-stock/unavailable; measured on acceptance & return rate, never impressions; off entirely in temple deployments and clinical contexts.

### Chapter 16 — Inventory Management
Register (no full-spec pages): **Inventory Dashboard** (stock health/cover/exceptions — cover measured against forecast footfall; live valuation/margin), **Product Catalogue** (every SKU — links products to consuming services; pricing/margin source of truth), **Categories** (grouping for reporting/tax — category demand by service mix; HSN/SAC mapping), **Stock Levels** (on-hand by branch/batch — availability gates recommendations; blocks sale of unavailable stock), **Stock Movement** (append-only ledger — service consumption as movement; sale depletion at line level), **Purchase Orders** (raise/approve/track — quantities from forecast demand; landed cost feeds valuation), **Suppliers** (terms/lead times/performance — lead time shapes reorder timing), **Goods Received** (GRN vs order — updates cost/stock), **Transfers** (move stock between branches — balances against branch-level forecast demand), **Wastage & Damaged Stock** (record loss w/ reason — writes down valuation), **Expiry Tracking** (batch-level rotation — prevents sale of expired stock), **Low Stock Alerts** (threshold+forecast warnings — thresholds scale with forecast footfall), **Reorder Suggestions** (what/how much/when — primary consumer of demand forecast; core intelligence of module), **Inventory Valuation** (moving-average cost — feeds margin/P&L), **Product Profitability** (margin by product/service — attach rate by service; true margin after discount/cost). Queue-to-stock link: predicted footfall × historical service mix × per-service consumption profile = tomorrow's stock requirement, ordered ahead of demand.

### Chapter 17 — Staff Management
Register: **Staff Dashboard** (roster/load/live performance), **Staff Profile** (skills/history/scores/development), **Shift Management** (plan capacity vs forecast), **Attendance** (clock-in/breaks/actual capacity), **Service Assignment** (who may perform what), **Queue Performance** (speed/idle/handover quality), **Sales Performance** (revenue/attach/upsell), **Customer Satisfaction** (ratings attributable to person, wait excluded), **Incentives & Commission** (transparent pre-published rules), **Performance Score** (composite, components visible), **Staff Leaderboard** (opt-in, de-emphasised), **Leave Management**. Productivity score = 8 components (customers served, avg service time, revenue, CSAT, repeat customers, queue efficiency, upsell acceptance, no-show handling). Three safeguards: wait time staff didn't cause excluded from satisfaction; score visible to individual before management; score may not be sole basis for disciplinary action. Explicitly rejected: idle-time surveillance, keystroke/location monitoring, default-published rankings, speed-only incentives.

### Chapter 18 — Loyalty Engine
Register: **Loyalty Dashboard**, **Points Rules**, **Membership Plans**, **Tier System** (by behaviour not spend alone), **Rewards**, **Coupons**, **Referral Programme**, **Cashback** (store credit not cash), **Birthday/Anniversary Offers**, **Visit/Spend/Service-Based Rewards**. Intelligent loyalty principle: reward *relevance* over discount — a protected slot costs nothing and is highly valued; a percentage discount costs margin and trains price sensitivity. **Rejected:** complex multi-condition loyalty rule builders (7.1/10, deferred indefinitely).

### Chapter 19 — Marketing Automation
Trigger catalogue (event class → trigger → message → timing): Queue (waited materially longer than estimate → acknowledgement+remedy, within the hour); Visit (service completed → feedback request, same day once); Purchase (consumable bought → replenishment reminder, at observed consumption interval); Time (normally returns every N days → invitation, ~day N-3); Churn (beyond cycle, no response → one honest reactivation, once then stop); Milestone (tier/anniversary → recognition, on the day); Capacity (off-peak spare capacity → optional invitation, flexible customers only). Register: **Campaign Dashboard**, **Customer Segments**, **Campaign Builder**, **Offer Builder** (margin floor enforced), **WhatsApp/SMS/Email/Push** (shares notification fabric with queue alerts), **Automated Triggers**, **Campaign Analytics** (holdout comparison by default). Three constraints: holdout group on by default; contact frequency capped per customer across all campaigns combined; marketing consent separate from service messaging.

### Chapter 20 — Feedback & Experience Management
Core mechanism: because rating + wait + service are on one visit record, the platform distinguishes a slow business from a poor one. Register: **Feedback Dashboard**, **Rating/CSAT/NPS** (wait rated separately from service), **Service Feedback**, **Staff Feedback** (wait excluded from their component), **Wait-Time Feedback** (was the estimate honest — calibrates ETA model), **Complaint Management**, **Recovery Workflow** (triggered by wait breach automatically), **Review Request** (suppressed after long wait or refund). Rejected: manufacturing/filtering reviews after they're written.

### Chapter 21 — see Section 8 below (Payments & Finance)

### Chapter 22 — Analytics Command Centre
Four analytic domains on one dataset. Queue analytics: avg waiting time (distribution not mean), max waiting time, service time (vs peer median), queue length (vs capacity), abandonment (+ estimated lost basket value), no-show rate, peak hours/days, staff capacity, counter utilisation (idle time priced). POS/customer/ops analytics: revenue/transactions/avg ticket/discount leakage/gross margin/payment mix; new/repeat/retention/churn/LTV/visit frequency/avg spend; staff productivity/inventory turnover/branch performance/forecast accuracy. Cross-domain questions that justify the platform: revenue difference between <10min vs >30min waiters; which staff hold CSAT under long queues; which services generate repeat vs one-off customers; value of opening one more counter 5:30–7:00.

### Chapter 23 — Predictive AI Dashboard
Horizons: next 30 min, next 2 hours, today, tomorrow, next 7 days — each with a recommendation, its basis, and expected value. Three non-negotiables: every prediction carries a confidence band and is scored the next day; page shows model's recent accuracy beside current prediction; no recommendation appears unless the operator can still act within its window.

### Chapter 24 — see Section 13 below (Vertical Workflows)

### Chapter 25 — Multi-Branch Management
Central-at-HQ vs local-at-branch split: catalogue/pricing-band/customer-DB/roles-permissions/tax-invoice-policy/benchmarks are central; queue ops-today/local offers/stock-on-hand/roster/day-open-close/local service-recovery are local. Register: **Enterprise Dashboard**, **Branch Comparison** (normalised for footfall/mix), **Branch Revenue**, **Branch Queue Performance**, **Branch Customer Retention**, **Branch Staff Performance**, **Branch Inventory**, **Central Product Catalogue**, **Central Pricing** (+ local override band), **Central Customer Database** (one identity across every location). Key differentiator: most POS deployments are per-location with nightly roll-up (a customer visiting two branches = two customers); here one record lets a chain see a customer moved from Branch 3 to Branch 7.

### Chapter 26 — Customer-Facing Experience
No-app rule: every capability reachable via browser/QR/link, nothing exclusive to an app. The seventeen customer surfaces (each with a "must do"/"must never do" pair): (1) QR landing page, (2) Select service, (3) Join queue, (4) Confirm details, (5) Token generated, (6) Live queue, (7) Estimated waiting time, (8) Notification, (9) "Your turn is near", (10) Service started, (11) Order summary, (12) Bill, (13) Payment, (14) Receipt, (15) Feedback, (16) Loyalty balance, (17) Next visit.

---

## 4. Chapter 12 — The Queue → POS Connection (the single most important chapter)

Framing: "If we build only what is in this chapter, we still have a differentiated product; if we build everything else and not this, we have a POS with a waiting-room feature." It is a data pipeline experienced as a visit, not a user journey.

**The fourteen steps and what each must produce:**
1. **Customer joins queue** → visit record (source, timestamp, branch, vertical).
2. **Customer profile identified** → resolved `customer_id` or light profile.
3. **Service selected** → intent (service, expected duration, skill required, list price).
4. **Estimated service time** → ETA with confidence + the feature vector that produced it.
5. **Customer intent score** → probability of purchase-beyond-booked-service + probability of abandonment.
6. **Staff assigned** → provider + reason for assignment.
7. **Service starts** → start timestamp + station.
8. **POS session created** → order bound to visit, pre-filled with selected service.
9. **Services/products added** → line items (delivering staff, price, cost).
10. **Cross-sell recommendation** → the suggestion made + accepted/declined.
11. **Bill generated** → compliant invoice (tax split, applied offers).
12. **Payment** → tenders, settlement references, completed visit.
13. **Feedback** → rating split into wait vs. service, tied to visit.
14. **Loyalty and next-visit** → accrual, tier movement, predicted return date with reason.

**What breaks if the connection is not built:** priced abandonment becomes a meaningless count; staff performance becomes a league table that punishes the slow counter; cross-sell becomes generic prompts staff dismiss; stock replenishment is extrapolated from past sales only; churn detection becomes a recency report; service recovery depends on the customer complaining.

**Implementation notes:** the session must be created *by the queue event*, not a POS action; pre-fill must be reversible in one action; basket forecasting must degrade gracefully (first-time customer → falls back to list price, never invents a number); declined recommendations are permanent for that customer+item.

---

## 5. Chapter 27 — Customer Retention Engine

Framed as "the most strategically important system in the platform."

**The customer health score** — eight weighted signals, calibrated per vertical, recomputed on every visit/payment/feedback event: (1) Recency vs. own cycle, (2) Visit frequency + trend, (3) Spending trend (declining while still attending = earliest recoverable signal), (4) Service mix movement between tiers, (5) Feedback, (6) Waiting experience vs. estimates, (7) Engagement (messages/tracking/rebooking), (8) Loyalty activity.

**The four bands and their plays:**

| Band | Definition | Automated action | What we deliberately do NOT do |
|---|---|---|---|
| **Healthy** | Within own cycle, stable/rising spend | Recognise by name/preference; protect usual slot | Contact them — silence is correct |
| **At risk** | ~25% past own cycle, or mild negative signal | One invitation referencing preferred service/provider | Lead with a discount |
| **High risk** | Well past cycle, falling spend, or unresolved poor experience | Service recovery addressing actual cause, from a named person | Send a generic "we miss you" |
| **Lost** | Beyond twice their cycle, no response | One honest, time-boxed reason to return, then stop | Continue contacting indefinitely |

**Why the loop must be closed:** every play is measured on whether the customer actually returned, at what ticket, at what incentive cost — plays that don't work are down-weighted. Success metrics: proportion of at-risk customers who return, and net revenue recovered after incentive cost (never messages sent/campaigns run).

**Retention plays, in strict order of preference:** (1) Fix the cause, (2) Offer relevance, (3) Offer access, (4) Offer recognition, (5) Offer value, (6) Offer discount (last resort, bounded, measured against a holdout).

---

## 6. Chapter 29 — Unified Event Engine

Premise: every important state change is an event with named consumers. Current platform already emits a durable, tenant-scoped event stream for queue state changes, persisted alongside an in-process emitter with serialisable payloads (transport-replaceable). Commerce events extend the same contract rather than a second bus.

**Event catalogue (event → automatic downstream consequence):**
- **QUEUE_JOINED** → identity resolved · visit opened · ETA computed · intent scored · basket forecast
- **SERVICE_STARTED** → staff clock starts · station occupied · POS session opened and pre-filled
- **SERVICE_COMPLETED** → duration banked into service-time distribution · station released · ETA recalculated
- **PAYMENT_COMPLETED** → ledger posted · loyalty accrued · receipt dispatched · visit closed
- **PURCHASE_COMPLETED** → stock depleted at line level · margin booked · reorder point re-evaluated
- **VISIT_COMPLETED** → customer profile updated · health score recomputed · next-visit date predicted
- **FEEDBACK_RECEIVED** → satisfaction updated · cause attributed · recovery workflow started if below threshold
- **CUSTOMER_ABSENT** → health score decays · retention play queued · revenue at risk updated
- **STOCK_LOW** → reorder suggestion raised against forecast demand
- **CROWD_SPIKE_PREDICTED** → staffing recommendation issued

**Properties the bus must have:** ordered per tenant; durable and replayable; schema-versioned; tenant-scoped end to end; idempotent on the consumer side.

**Architectural discipline:** no module calls another module's internals to trigger a side effect — e.g. POS emits PAYMENT_COMPLETED and the loyalty engine reacts, rather than POS calling the loyalty engine directly.

---

## 7. Chapter 32 — Actor Capability Model

**The five actor classes:**

| Actor | Who | Scope of authority | Primary surface |
|---|---|---|---|
| **Super admin** | The platform operator | Every tenant, metadata/config only — not merchant customer data | Control plane |
| **Org admin / owner** | The merchant's principal/delegate | Everything within own organisation, all branches | Command centre |
| **Branch manager** | Runs one location | Operational authority, bounded by owner policy, often shift-bounded | Live queue + branch dashboard |
| **Staff / operator** | Counter/chair/table/till | The customer in front of them, own till/performance | Live queue + POS |
| **End customer** | Visitor/patient/guest/client | Own visit, own bill, own data | Browser page via QR/link |

**Role hierarchy note:** manager authority is time-bounded — rights attach to a *shift*, not permanently to a person.

**Super admin — can/cannot:** CAN create/verify/provision/suspend tenants, define plans/entitlements, toggle feature flags, review immutable audit logs, execute export/erasure requests, impersonate with consent (time-boxed, logged). CANNOT operate a tenant's business without consent, change a merchant's prices/discounts/payouts, tune a merchant's model weights, read customer records where metadata would suffice, delete/edit an audit entry, access tenant data silently.

**Org admin/owner:** full business setup, people/roles/commission, commerce (catalogue/pricing/discount policy, sees every void/refund/discount), customer & retention (full Customer 360, segments/loyalty/membership, approve campaigns), intelligence (act on recommendations, forecasts, branch comparison), governance (audit export, vendor support access, retention/consent policy).

**Branch manager vs. staff:** Manager — open/pause/close queues, re-route/transfer, override priority w/ reason, assign staff to counters, approve discounts up to owner threshold, authorise refunds/voids, close shifts/reconcile cash, raise stock transfers. Staff — call/recall/skip/complete tokens, add items to cart, apply pre-approved offers, see one relevant suggestion, request override rather than exceed a limit, take all payment types, own till float, own performance history only.

**End customer:** join via QR/link, book a slot, track live, cancel without penalty, see bill build line by line, accept/decline a suggestion once, split a bill, pay any method, digital receipt without email, rate wait/service separately, export/delete own data. Never required to: download an app, create a password, verify email, accept marketing for a receipt.

**Permission matrix:** rows are capabilities (not screens) — enforced in the API, not only the interface.

---

## 8. Chapter 21 — Payments & Finance

**Scope:** Payment Dashboard, Payment Collection, UPI/Card/Cash/Wallet (deterministic, no AI), Split & Partial Payment, Refund & Credit, Due Collection, Settlement & Reconciliation (three-way match to bank), Daily Closing, Tax Reports, Invoice & Revenue Reports.

**India-specific requirements carried natively:**
- GST-compliant tax invoices with correct tax split and place of supply.
- HSN and SAC codes on every line, mapped from catalogue (never typed at till).
- Sequential, continuous invoice series per branch, continuity enforced, breaks flagged.
- UPI as a first-class tender with reference capture (intent + dynamic QR flows).
- Digital receipts via WhatsApp/SMS to the check-in number, no email required.
- Multiple payment modes on a single bill — normal, not exceptional, in Indian retail/service settings.

**Design constraint:** the tender screen has exactly four primary buttons; tax treatment, series management, settlement matching, and variance analysis are all computed without counter staff's involvement.

---

## 9. Chapter 31 — Security & Access

**Controls:** capability-based RBAC (not screen-based); branch-level scoping enforced at the data layer; field-level masking for staff (e.g., service history without LTV/margin); append-only audit logs, not deletable by any role; devices registered/bound/remotely revocable; short sessions on shared devices; encryption in transit universally, at rest for personal data; no card data touches internal systems; backup/recovery with stated RPO/RTO, tested restores; consent purpose-bound, service messaging separated from marketing consent; self-service export/deletion with verifiable cascading deletion; configurable data residency per tenant.

**Clinical data separation (hospital/clinic):** hard boundary — operational data (token, wait, department, billing, payment) is in scope for commercial/intelligence engines; clinical data (diagnosis, notes, prescriptions, results, images) is under separate access control, separately consented, excluded from every commercial model. Enforced in the data model and permission system, not policy alone.

**Deletion, retention and export:** retention periods configurable per tenant within statutory limits; financial records held per required period regardless of marketing-data deletion; customer deletion removes personal identifiers while preserving the anonymised operational record; export available anytime in an open format; every export/deletion is itself an audited event.

---

## 10. Chapter 38 — Do Not Build

| Do not build | Score | Why rejected |
|---|---|---|
| Vanity dashboards | 5.2 | Charts that can't change a decision consume attention and train operators to ignore the panel where useful things live |
| A large library of standard reports | 5.8 | Report count is a procurement checkbox, not a capability — 6 used reports beat 60 unused ones |
| Complicated staff interfaces | 4.9 | Any front-line task needing a menu+search+form grows the queue while being completed |
| Requiring a customer app | 4.1 | Install requirement = measurable drop-off exactly when the customer decides whether to join |
| A generic AI chatbot | 5.4 | Answers unasked questions while failing at the one thing wanted (how long is the wait) |
| Features unrelated to customer flow (payroll, full accounting, HR suites) | 3.0 | Large, competitive, low-margin adjacent markets that dilute the category claim |
| Complex loyalty rule builders | 7.1 | Nested conditional rules → merchant confusion, liability, support load |
| Excessive notification options | 6.3 | Every extra channel/toggle multiplies ways to annoy customers and misconfigure |
| Any duplicate data entry | 2.0 | Guarantees data divergence, disabling every downstream intelligence feature |
| A public app marketplace (now) | 6.8 | Requires review processes, developer support, mature 3rd-party permission model — correct eventually, wrong before Phase 5 |
| Offline-first full POS | 7.4 | Genuinely hard and fights the unified-record architecture — ship resilient degradation instead |
| Staff surveillance features | 3.5 | Idle-time monitoring, location tracking, public leaderboards → measurable short-term gain, larger loss in satisfaction/retention |

**How to use the list:** when a rejected feature is requested, the answer is never a flat no — it's: here's what you're trying to achieve, here's the capability we have that achieves it, here's what your version would cost you in the parts of the product you bought us for.

---

## 11. Chapters 39–40 — Feature Scoring Matrix & Priority Roadmap

**Scoring matrix mechanics:** every major feature scored on Customer/Business/Retention/Revenue/Operational value, Differentiation, and Implementation complexity, rolled into a weighted Overall score. Only ≥9.5 → BUILD. Notable: Queue-triggered POS session 9.9 (Phase 1), Unified visit data model 9.8 (Phase 1), Live queue w/ value context 9.8 (Phase 1), Customer 360 9.7 (Phase 2), QR check-in 9.6 (Phase 1), Explainable ETA 9.6 (Phase 1), Retention intelligence engine 9.6 (Phase 3), Abandonment priced to basket 9.6 (Phase 2), Wait-adjusted staff score 9.5 (Phase 2), Queue-driven replenishment 9.5 (Phase 4), Demand/revenue forecasting 9.5 (Phase 4), Trigger-based marketing w/ holdout 9.5 (Phase 3), GST invoicing & reconciliation 9.5 (Phase 1, "credibility gate" despite differentiation score of only 4), Split/partial payment 9.5 (Phase 1, differentiation only 5), Cross-branch single identity 9.5 (Phase 5), Capped recommendation engine 9.5 (Phase 3). Below threshold: Membership & packages 9.2 (DEFER), Kitchen display system 8.4 (DEFER), Gift cards 7.9 (DEFER), Full offline POS 7.4 / Complex loyalty rule builder 7.1 / App marketplace 6.8 (DO NOT BUILD NOW), Generic AI chatbot 5.4 / Customer app requirement 4.1 / Staff surveillance 3.5 / Duplicate data entry 2.0 (DO NOT BUILD).

**The five roadmap phases:**
- **Phase 1 — Foundation (months 0–4).** Unified visit data model · queue-triggered POS session · live queue w/ customer value context · QR check-in · explainable ETA · cart/bill/GST invoice · UPI/card/cash/split payment · shift close & reconciliation · basic inventory w/ line-level depletion. Dependencies: none. Outcome: a merchant can run an entire day — check-in to reconciliation — inside one platform.
- **Phase 2 — Intelligence (months 3–7).** Customer 360 · CRM segmentation · loyalty & points · full analytics across queue/POS/customer/ops · wait-adjusted staff productivity · abandonment priced to basket value. Dependencies: Phase 1 data flowing ≥4 weeks.
- **Phase 3 — Retention (months 6–11).** Customer health score & bands · churn detection · automated retention plays · personalisation · trigger-based marketing automation w/ holdout · capped recommendation engine. Dependencies: Phase 2 segmentation + ≥1 full visit cycle per customer.
- **Phase 4 — Prediction (months 9–14).** Demand/footfall forecasting · queue/surge prediction · revenue forecasting · queue-driven inventory replenishment · staffing recommendations w/ expected value. Dependencies: ≥12 weeks of Phase 1+2 data per branch.
- **Phase 5 — Platform (months 12–18).** Multi-branch/enterprise roll-up · central catalogue & pricing · cross-branch single identity · public API & webhooks · third-party integrations · SSO/residency/enterprise controls. Dependencies: Phases 1–4 stable in single-branch deployments.

**Dependency rule governing all phases:** no phase begins before its predecessor's data is genuinely flowing — intelligence trained on an incomplete spine produces confident wrong answers that permanently destroy operator trust once discovered.

---

## 12. Chapter 33 — Wireframe & Layout Standards

Four standard layouts cover the entire product:
- **Layout A — Management screen.** Left sidebar nav · top header (context selectors) · KPI card row · main data area · right-hand AI recommendation panel (max 5) · fixed quick-action bar. Used by command centre, analytics, customer records, inventory, staff pages.
- **Layout B — POS.** Customer strip on top · catalogue (queue/services/products tabs) on left · cart on right · fixed tender row at bottom.
- **Layout C — Queue operations.** Counter strip on top · token list as main area · prediction & next-action panel on right · fixed action bar.
- **Layout D — Customer 360.** Identity header · timeline on left · "what should we do?" panel on right, always above the fold · tabs for purchases/queue/loyalty/feedback/consent.

**Interface rules everywhere:** customer-facing surfaces use none of the four layouts — single-column, chrome-free, one-thumb design. Density is a role decision. Colour carries meaning consistently: cyan=flow, navy=commerce, violet=intelligence, green=retention, amber=caution, rose=risk. Destructive actions visually separated, state consequence before confirmation. Nothing important behind a hover.

---

## 13. Chapter 24 — Vertical Workflows

One codebase, four operating personalities, expressed through configuration/terminology/switched-off surfaces — never a fork.

**Hospital/clinic:** multi-stage visits (registration → consultation → diagnostics → pharmacy, one visit_id, one bill); clinical priority triage override is human-only, highest band, always logged; payer handling (package/insurance/self-pay splits on one invoice); follow-up scheduled on clinical grounds, treated as a service message. Hard clinical/operational data separation.

**Salon/spa:** service packages w/ prepaid sessions/visible balance/honest expiry; membership as recurring relationship; preferred stylist as routing weight *and* early-warning indicator; retail attach driven by product actually used; commission split published in advance; rebooking cadence learned per customer+service.

**Restaurant/food-service:** table management w/ best-fit seating; KOT + kitchen display w/ station routing/bump/recall; turnover clock reported alongside satisfaction; split billing by guest/item/share; takeaway/delivery on same catalogue, separate flow; menu w/ timed availability and an eighty-six list.

**Temple/religious place:** deliberately *less* commercial. Core = slot management, priority categories, crowd density, emergency holds, volunteer coordination, festival forecasting. Donation/prasadam/merchandise are separate short queues. Recommendation engine, loyalty tiering, churn campaigns switched off by configuration.

**What stays common:** identity/visit/token/event model; ETA and forecasting engines; order/invoice/tax/settlement; staff/roster/productivity model; permission and audit model; analytics and retention engines. **What's vertical-specific:** terminology/journey labels; priority-band definitions; which commercial surfaces are enabled; score component weighting; additional restrictions; which segments/plays are appropriate.

---

## 14. Chapter 41 — Final Executive Recommendation

**The product loop (7 stages, cyclical):** PREDICT → ROUTE → SERVE (and measure it) → SELL (one suggestion, capped) → PAY (four buttons, one ledger) → LEARN (scored, not assumed) → RETAIN (attributed, net of cost) → back to PREDICT. Improves with every transaction — the platform is worth more in month eighteen than month one without a single new feature shipped.

**The three things that must be true:**
1. The visit is the backbone entity, every row carries its identifier.
2. The queue triggers the commerce session — not a handover, not an integration, not a nightly sync.
3. Restraint is enforced in the product: one suggestion per visit, silence as default retention action, no surveillance, no app requirement, no lock-in.

---

## 15. Additional Notable Content (Chapters 28, 30, 35–37, 42–43)

**Chapter 28 — Switching-Cost Strategy.** Assets and rebuild time for a competitor: historical customer data (immediate raw, 12+ months as insight), queue intelligence (4–8 weeks/branch), transaction line-level attribution (cannot be reconstructed), staff performance history (6+ months), inventory consumption profiles (3–6 months), loyalty relationship history (never reproducible), segmentation (3–6 months), predictive models (4–12 weeks to be useful), campaigns w/ holdout record (6+ months), multi-branch benchmarks (12+ months). What we will not do: no contractual lock-in, no withholding data on exit, no proprietary hardware, no degraded export fidelity or exit fee.

**Chapter 30 — API & Integration Layer.** Surfaces: Payments (server-side, never browser-held credentials), Messaging (unified fabric, per-channel fallback), Accounting/tax (scheduled export + webhooks), Hardware (local device bridge, graceful degradation), Business systems (REST+webhooks), Commerce channels, Booking, Identity (OIDC/SAML SSO for staff only, never customers). Principles: every UI capability is API-available under the same permission model; webhooks mirror the Ch 29 event catalogue; versioned contracts; per-tenant rate limits; sandbox tenants.

**Chapter 35 — Product Packaging.** Five tiers: **CORE** (queue mgmt, identity, live tracking, display, basic reporting), **GROWTH** (+ full POS/payments/invoicing/basic inventory), **PRO** (+ CRM/Customer 360/loyalty/staff intelligence/full analytics), **AI** (+ predictive forecasting/retention intelligence/recommendation engine/marketing automation), **ENTERPRISE** (+ multi-branch/central catalogue/APIs/SSO/residency). Tier boundaries follow capability not volume; no tier withholds export or security; don't split the queue-to-POS connection across tiers — it *is* the product.

**Chapter 36 — Retention Metrics.** Fourteen tracked: repeat visit rate, retention (cohort), churn, LTV, visit frequency, avg ticket, revenue per customer, queue abandonment, avg wait (distribution), CSAT/NPS (split by wait/service), loyalty redemption, offer redemption (vs holdout), membership renewal, reactivation rate. Revenue-recovered attribution requires a named mechanism+customer or is reported as "uplift" not "recovery."

**Chapter 37 — Competitive Differentiation.** Traditional POS: good at selling/tax/hardware, no view of demand before the transaction. Queue tool: good at waiting/token flow, no basket so insight is financially meaningless. CRM/loyalty app: depends on other systems' stale data. ERP: not designed for the front line. Unified flow-commerce OS: whole loop on one record, risk is scope not capability.

**Chapters 42–43** are meta-chapters about the document's own construction (not implementation-relevant).
