#!/usr/bin/env bash
# End-to-end smoke test for the queue lifecycle, then the commerce lifecycle.
# Part 1 exercises: login -> check-in -> NEXT -> RECALL -> customer confirms ->
# COMPLETE, plus the recall position penalty and RBAC enforcement.
# Part 2 registers a brand-new business and exercises: auto-provisioned
# counters -> ring up a cart -> a tender that overshoots the bill gets capped
# (cash and non-cash) -> the shift and customer directory reflect the exact
# sale, not what was typed in.
# Run with the API already listening on :4000.
set -euo pipefail

API=http://localhost:4000/api

# Reads JSON from stdin into `r` and prints the given JS expression.
j() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const r=JSON.parse(d);console.log($1)})"; }

# Fails the script (and so the CI job) the moment a figure the money logic
# computed doesn't match what it should — printing alone, the style every
# section above this uses, would let a broken calculation sail through
# unnoticed since nothing reads the log on every run.
assert_eq() {
  if [ "$1" != "$2" ]; then
    echo "  ASSERTION FAILED ($3): expected '$2', got '$1'" >&2
    exit 1
  fi
  echo "  OK ($3): $1"
}

echo "=== 1. Login as branch admin ==="
TOKEN=$(curl -s -X POST "$API/auth/login" -H 'content-type: application/json' \
  -d '{"email":"admin@apollo.queueos.dev","password":"queueos123"}' | j "r.accessToken")
echo "  token acquired: ${TOKEN:0:20}..."

AUTH=(-H "authorization: Bearer $TOKEN")
BRANCH=$(curl -s "${AUTH[@]}" "$API/branches" | j "r.find(b=>b.code==='MAIN').id")
QUEUE=$(curl -s "${AUTH[@]}" "$API/branches/$BRANCH/queues" | j "r.find(q=>q.name==='Orthopedics OPD').id")
COUNTER=$(curl -s "${AUTH[@]}" "$API/branches/$BRANCH/counters" | j "r.find(c=>c.queue&&c.queue.id==='$QUEUE').id")
echo "  using Orthopedics OPD (deep queue) + its first counter"

echo
echo "=== 2. Customer self check-in (public, no auth) ==="
CODE=$(curl -s -X POST "$API/queues/$QUEUE/tokens" -H 'content-type: application/json' \
  -d '{"name":"Test Patient","phone":"+919812345678","source":"QR"}' | j "r.code")
curl -s "$API/t/$CODE" | j "'  '+r.displayCode+'  position '+r.position+'  eta '+r.eta.minutes+'min ('+Math.round(r.eta.confidence*100)+'% confidence, range '+r.eta.rangeMinutes.join('-')+')'"
curl -s "$API/t/$CODE" | j "'  message: \"'+r.eta.message+'\"'"
curl -s "$API/t/$CODE" | j "'  drivers: '+r.eta.factors.join(' | ')"

echo
echo "=== 3. Priority ordering: an emergency check-in jumps the line ==="
ECODE=$(curl -s -X POST "$API/queues/$QUEUE/tokens" -H 'content-type: application/json' \
  -d '{"name":"Emergency Case","phone":"+919800000001","priority":"EMERGENCY"}' | j "r.code")
curl -s "$API/t/$ECODE" | j "'  emergency token '+r.displayCode+' -> position '+r.position+' (joined last)'"
SCODE=$(curl -s -X POST "$API/queues/$QUEUE/tokens" -H 'content-type: application/json' \
  -d '{"name":"Senior Citizen","phone":"+919800000002","isSeniorCitizen":true}' | j "r.code")
curl -s "$API/t/$SCODE" | j "'  senior citizen auto-upgraded to '+r.priority+' -> position '+r.position"

echo
echo "=== 4. Counter pulls NEXT until our token is being served ==="
for i in $(seq 1 60); do
  curl -s -X POST "$API/counters/$COUNTER/next" -H "authorization: Bearer $TOKEN" > /dev/null
  ST=$(curl -s "$API/t/$CODE" | j "r.status")
  if [ "$ST" = "SERVING" ]; then echo "  serving after $i NEXT presses"; break; fi
done
curl -s "$API/t/$CODE" | j "'  '+r.displayCode+' -> '+r.status+' at '+r.counterName+' with '+r.providerName"

echo
echo "=== 5. RECALL: customer did not appear ==="
curl -s -X POST "$API/counters/$COUNTER/recall" -H "authorization: Bearer $TOKEN" > /dev/null
curl -s "$API/t/$CODE" | j "'  status '+r.status+', attempt '+r.recallAttempts+', grace expires '+new Date(r.recallExpiresAt).toLocaleTimeString()"

echo
echo "=== 6. Customer answers 'still coming?' -> YES ==="
curl -s -X POST "$API/t/$CODE/confirm-recall" > /dev/null
curl -s "$API/t/$CODE" | j "'  back in line: status '+r.status+', position '+r.position+' (penalty applies, not sent to the back), eta '+r.eta.minutes+'min'"

echo
echo "=== 7. Serve properly, then COMPLETE ==="
for i in $(seq 1 60); do
  curl -s -X POST "$API/counters/$COUNTER/next" -H "authorization: Bearer $TOKEN" > /dev/null
  ST=$(curl -s "$API/t/$CODE" | j "r.status")
  if [ "$ST" = "SERVING" ]; then break; fi
done
curl -s -X POST "$API/counters/$COUNTER/complete" -H "authorization: Bearer $TOKEN" > /dev/null
curl -s "$API/t/$CODE" | j "'  '+r.displayCode+' -> '+r.status"

echo
echo "=== 8. Event log emitted for this journey ==="
curl -s "${AUTH[@]}" "$API/branches/$BRANCH/activity?limit=100" | \
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const t=JSON.parse(d).reverse().filter(x=>x.payload&&x.payload.code);const seen=new Set();t.forEach(x=>{if(!seen.has(x.name)){seen.add(x.name)}});console.log('  distinct events: '+[...seen].join(', '))})"

echo
echo "=== 9. Notifications fired at the ETA thresholds ==="
curl -s "$API/t/$CODE/notifications" | j "r.length?r.map(n=>'  '+String(n.thresholdMinutes).padStart(3)+' min -> '+n.body).join('\n'):'  (none - token was served before crossing a threshold)'"

echo
echo "=== 10. RBAC ==="
echo -n "  unauthenticated counter action -> HTTP "; curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/counters/$COUNTER/next"
LOW=$(curl -s -X POST "$API/auth/login" -H 'content-type: application/json' \
  -d '{"email":"counter@apollo.queueos.dev","password":"queueos123"}' | j "r.accessToken")
echo -n "  counter staff pausing a queue -> HTTP "
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/queues/$QUEUE/status" \
  -H "authorization: Bearer $LOW" -H 'content-type: application/json' -d '{"status":"PAUSED"}'
echo -n "  bad password -> HTTP "
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/auth/login" \
  -H 'content-type: application/json' -d '{"email":"admin@apollo.queueos.dev","password":"wrong"}'
echo -n "  invalid check-in payload -> HTTP "
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/queues/$QUEUE/tokens" \
  -H 'content-type: application/json' -d '{"name":"","phone":"1"}'

echo
echo "=== 11. Queue operations: transfer, priority change, call-specific ==="
TQUEUE=$(curl -s "${AUTH[@]}" "$API/branches/$BRANCH/queues" | j "r.find(q=>q.name==='General OPD').id")
T1=$(curl -s -X POST "$API/queues/$QUEUE/tokens" -H 'content-type: application/json' \
  -d '{"name":"Transfer Me","phone":"+919822222221","source":"QR"}' | j "r.code")
T1DISPLAY=$(curl -s "$API/t/$T1" | j "r.displayCode")
T1ID=$(curl -s "${AUTH[@]}" "$API/branches/$BRANCH/activity?limit=10" | j "r.find(e=>e.name==='TokenCreated'&&e.payload.code==='$T1DISPLAY').tokenId")
echo -n "  transfer -> HTTP "
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/tokens/$T1ID/transfer" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{\"targetQueueId\":\"$TQUEUE\"}"
curl -s "$API/t/$T1" | j "'  '+r.displayCode+' now in queue \"'+r.queue.name+'\"'"

echo -n "  priority change (requires a reason) -> HTTP "
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/tokens/$T1ID/priority" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"priority":"VIP","reason":"smoke test"}'
curl -s "$API/t/$T1" | j "'  '+r.displayCode+' priority now '+r.priority"

echo -n "  priority change without a reason -> HTTP "
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/tokens/$T1ID/priority" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"priority":"VIP","reason":""}'

TCOUNTER=$(curl -s "${AUTH[@]}" "$API/branches/$BRANCH/counters" | j "r.find(c=>c.queue&&c.queue.id==='$TQUEUE').id")
echo -n "  call-specific (out of FIFO order) -> HTTP "
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/counters/$TCOUNTER/call/$T1ID" -H "authorization: Bearer $TOKEN"
curl -s "$API/t/$T1" | j "'  '+r.displayCode+' -> '+r.status+' at '+r.counterName"

echo
echo "=== 12. Register a fresh QSR business: auto-provisioned counters, a product, a shift ==="
REG=$(curl -s -X POST "$API/auth/register" -H 'content-type: application/json' -d '{
  "businessName":"Test QSR Co",
  "vertical":"restaurant",
  "flowTemplate":"qsr",
  "ownerName":"Test Owner",
  "email":"owner@testqsr.queueos.dev",
  "password":"queueos123"
}')
QTOKEN=$(echo "$REG" | j "r.accessToken")
QBRANCH=$(echo "$REG" | j "r.user.branchId")
QAUTH=(-H "authorization: Bearer $QTOKEN")
ORDERQ=$(curl -s "${QAUTH[@]}" "$API/branches/$QBRANCH/queues" | j "r.find(q=>q.name==='Ordering').id")
ORDERC=$(curl -s "${QAUTH[@]}" "$API/branches/$QBRANCH/counters" | j "r.find(c=>c.queue&&c.queue.id==='$ORDERQ').id")
echo "  registered, Ordering queue + its auto-provisioned counter both exist (the Sept-29 auto-counter fix)"

PRODUCT=$(curl -s -X POST "$API/products" "${QAUTH[@]}" -H 'content-type: application/json' \
  -d '{"name":"Test Combo","category":"Mains","price":100,"gstRate":5}' | j "r.id")
echo "  product created: ₹100 + 5% GST"

curl -s -X POST "$API/branches/$QBRANCH/shifts/open" "${QAUTH[@]}" -H 'content-type: application/json' \
  -d '{"openingCash":500}' > /dev/null
echo "  shift opened with a ₹500 float"

echo
echo "=== 13. A CASH tender that overshoots the bill is capped, not recorded verbatim ==="
QCODE1=$(curl -s -X POST "$API/queues/$ORDERQ/tokens" -H 'content-type: application/json' \
  -d '{"name":"Cash Overpay","phone":"+919800050001"}' | j "r.code")
curl -s -X POST "$API/counters/$ORDERC/next" "${QAUTH[@]}" > /dev/null
curl -s -X POST "$API/counters/$ORDERC/order/items" "${QAUTH[@]}" -H 'content-type: application/json' \
  -d "{\"productId\":\"$PRODUCT\",\"quantity\":2}" > /dev/null
# 2 x ₹100 + 5% GST = ₹210 owed. Tendering ₹300 CASH should record exactly
# ₹210 (the ₹90 excess is change handed back, never revenue) -- this is the
# server-side cap from the 2026-10-02 cash-cap fix, independent of whatever
# the counter tablet UI already caps client-side.
curl -s -X POST "$API/counters/$ORDERC/record-payment" "${QAUTH[@]}" -H 'content-type: application/json' \
  -d '{"tenders":[{"amount":300,"method":"CASH"}]}' > /dev/null
INV1=$(curl -s "${QAUTH[@]}" "$API/branches/$QBRANCH/invoices?limit=1")
assert_eq "$(echo "$INV1" | j "r[0].total.toFixed(2)")" "210.00" "invoice capped at the bill, not the ₹300 tendered"
SHIFT1=$(curl -s "${QAUTH[@]}" "$API/branches/$QBRANCH/shifts/current")
assert_eq "$(echo "$SHIFT1" | j "r.expectedCash.toFixed(2)")" "710.00" "shift cash is float(500) + bill(210), not float + tendered(300)"

echo
echo "=== 14. A non-cash tender that overshoots is capped too, and tracked separately from cash ==="
QCODE2=$(curl -s -X POST "$API/queues/$ORDERQ/tokens" -H 'content-type: application/json' \
  -d '{"name":"Card Overpay","phone":"+919800050002"}' | j "r.code")
curl -s -X POST "$API/counters/$ORDERC/next" "${QAUTH[@]}" > /dev/null
curl -s -X POST "$API/counters/$ORDERC/order/items" "${QAUTH[@]}" -H 'content-type: application/json' \
  -d "{\"productId\":\"$PRODUCT\",\"quantity\":2}" > /dev/null
curl -s -X POST "$API/counters/$ORDERC/record-payment" "${QAUTH[@]}" -H 'content-type: application/json' \
  -d '{"tenders":[{"amount":250,"method":"CARD"}]}' > /dev/null
INV2=$(curl -s "${QAUTH[@]}" "$API/branches/$QBRANCH/invoices?limit=1")
assert_eq "$(echo "$INV2" | j "r[0].total.toFixed(2)")" "210.00" "card invoice capped at the bill too, no 'change' involved"
SHIFT2=$(curl -s "${QAUTH[@]}" "$API/branches/$QBRANCH/shifts/current")
assert_eq "$(echo "$SHIFT2" | j "r.expectedCash.toFixed(2)")" "710.00" "a card sale must not move the cash-drawer figure at all"
assert_eq "$(echo "$SHIFT2" | j "r.nonCash.CARD.toFixed(2)")" "210.00" "non-cash breakdown shows the capped card total (the 2026-10-03 tracking fix)"

echo
echo "=== 15. Close the shift: counted cash matches to the rupee ==="
CLOSE=$(curl -s -X POST "$API/branches/$QBRANCH/shifts/close" "${QAUTH[@]}" -H 'content-type: application/json' \
  -d '{"countedCash":710}')
assert_eq "$(echo "$CLOSE" | j "r.variance.toFixed(2)")" "0.00" "counted cash settles exactly against the one real cash sale"

echo
echo "=== 16. Customer directory reflects both sales correctly ==="
DIR=$(curl -s "${QAUTH[@]}" "$API/branches/$QBRANCH/customers")
assert_eq "$(echo "$DIR" | j "r.find(c=>c.phone==='+919800050001').totalSpent.toFixed(2)")" "210.00" "cash customer's total matches their capped invoice"
assert_eq "$(echo "$DIR" | j "r.find(c=>c.phone==='+919800050002').totalSpent.toFixed(2)")" "210.00" "card customer's total matches their capped invoice"
CUST1=$(echo "$DIR" | j "r.find(c=>c.phone==='+919800050001').id")
DETAIL=$(curl -s "${QAUTH[@]}" "$API/branches/$QBRANCH/customers/$CUST1")
assert_eq "$(echo "$DETAIL" | j "r.visits[0].invoices[0].total.toFixed(2)")" "210.00" "customer detail's linked invoice matches too"

echo
echo "Done."
