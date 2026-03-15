# Fileverse Code Walkthrough (Where + How It Is Used)

This guide shows **where Fileverse is used** in the codebase, **what each piece does**, and **which snippets** to highlight during a demo or code walkthrough.

---

## 1) Core Fileverse API wrapper

**File:** `/Users/yagnesh/Desktop/2026 HACKATHONS/plop-ai-trading-interface/engine/orders.ts`  
**What it does:** Builds signed URLs and wraps Fileverse REST endpoints with retries + sync checks.

**Key functions to show:**
- `buildUrl()` – injects `FILEVERSE_SERVER_URL` + `FILEVERSE_API_KEY`
- `createDoc()` – creates encrypted ddoc
- `getDoc()` – fetches ddoc by id
- `updateDoc()` – updates ddoc content
- `listDocs()` – paginates orderbook
- `waitForSync()` – waits until ddoc is synced

**Snippet to show (short):**
```ts
const url = buildUrl('/api/ddocs')
await fetchJson(url, { method: 'POST', body: JSON.stringify({ title, content }) })
```

**Why it matters:** This is the *only* place that touches the Fileverse API directly.

---

## 2) Order creation (encrypted payload only)

**File:** `/Users/yagnesh/Desktop/2026 HACKATHONS/plop-ai-trading-interface/engine/index.ts`  
**Where:** `POST /orders` handler  
**What it does:** Stores **encrypted** order payload in Fileverse; no plaintext order data is saved.

**Snippet to show:**
```ts
const ddocId = await createDoc('order', JSON.stringify(stored))
```

**Call path:**
- Frontend encrypts order
- Engine stores encrypted payload as Fileverse ddoc

---

## 3) Matching + order lifecycle

**File:** `/Users/yagnesh/Desktop/2026 HACKATHONS/plop-ai-trading-interface/engine/matcher.ts`  
**What it does:** Reads Fileverse ddocs, decrypts locally, matches orders, updates status, creates residual orders.

**Snippets to show:**
```ts
const { ddocs, hasNext } = await listDocs(PAGE_LIMIT, skip)
await updateDoc(order.ddocId, JSON.stringify({ ...payload, status: 'IN_SETTLEMENT' }))
```

**Why it matters:** Fileverse acts as the **private orderbook**, and all updates happen via ddocs.

---

## 4) Deposit watcher + webhook updates

**Files:**
- `/Users/yagnesh/Desktop/2026 HACKATHONS/plop-ai-trading-interface/engine/webhooks.ts`
- `/Users/yagnesh/Desktop/2026 HACKATHONS/plop-ai-trading-interface/engine/hoodi.ts`

**What they do:** On confirmed deposit, update the Fileverse order status to LIVE.

**Snippet to show:**
```ts
await updateDoc(orderId, JSON.stringify({ ...payload, status: 'LIVE' }))
```

**Why it matters:** Fileverse is the single source of truth for order state.

---

## 5) Receipts

**File:** `/Users/yagnesh/Desktop/2026 HACKATHONS/plop-ai-trading-interface/engine/receipts.ts`  
**What it does:** Writes encrypted receipts to Fileverse after settlement.

**Snippet to show:**
```ts
const ddocId = await createDoc('receipt', JSON.stringify(receiptPayload))
```

**Why it matters:** Proof of settlement is stored privately in Fileverse and indexed in ENS.

---

## 6) Frontend context (what users see)

**Files:**
- `/Users/yagnesh/Desktop/2026 HACKATHONS/plop-ai-trading-interface/src/hooks/useOrders.ts`
- `/Users/yagnesh/Desktop/2026 HACKATHONS/plop-ai-trading-interface/src/hooks/usePoolActivity.ts`

**What they do:**  
Fetch `/orders` and `/orders/all` from the engine (which itself reads Fileverse), then show:
- Active orders
- History
- Pool activity

---

# Summary for the demo

**Key message:** Fileverse stores **only encrypted data**, and PLOP uses it as the private orderbook + receipt store.  
All reads/writes are done through `engine/orders.ts`, and every other module uses that wrapper.
