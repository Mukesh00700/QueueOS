#!/usr/bin/env bash
# End-to-end smoke test for the queue lifecycle.
# Exercises: login -> check-in -> NEXT -> RECALL -> customer confirms -> COMPLETE,
# plus the recall position penalty and RBAC enforcement.
# Run with the API already listening on :4000.
set -euo pipefail

API=http://localhost:4000/api

# Reads JSON from stdin into `r` and prints the given JS expression.
j() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const r=JSON.parse(d);console.log($1)})"; }

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
echo "Done."
