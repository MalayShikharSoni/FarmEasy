# FarmEasy: engineering notes

These notes explain the correctness, payment and audit work in FarmEasy: what was wrong, how it could fail, what was changed, why that approach was chosen over the alternatives, and what is still not handled. Each section ends with questions an interviewer is likely to ask.

The common theme: **the database must never hold a state that contradicts itself, no matter how requests interleave.** A marketplace with money in it cannot rely on "requests usually arrive one at a time".

---

## 1. Bidding rules enforced atomically

**Code:** `backend/src/controllers/bid.controller.js` · **Tests:** `backend/tests/bids.test.js`

### The bug

Placing a bid did two things:

1. Read the auction and check `bid >= current + minBidHop` (or `>= minPrice` for the first bid).
2. Run an atomic `findOneAndUpdate` whose filter only checked `currentHighestBidAmount < bid`.

Step 1 uses a value that can be stale by the time step 2 runs. Step 2 was atomic, but it checked a weaker rule.

**Failure, with numbers.** Current bid ₹100, increment ₹10. Buyer A bids ₹110 and buyer B bids ₹111 at the same moment.

| Time | Request A (₹110) | Request B (₹111) | Stored highest |
|---|---|---|---|
| t1 | reads ₹100, 110 ≥ 110 ✓ | | 100 |
| t2 | | reads ₹100, 111 ≥ 110 ✓ | 100 |
| t3 | update: 100 < 110 ✓ → set 110 | | 110 |
| t4 | | update: 110 < 111 ✓ → set 111 | 111 |

Both bids are accepted. B outbid A by ₹1, which breaks the ₹10 increment rule.

### The fix

The full rule now lives inside the update filter, so MongoDB evaluates it against the value that is actually stored at the moment of the write:

```js
Auction.findOneAndUpdate(
  {
    _id, status: "APPROVED", "lockedDeal.isLocked": { $ne: true },
    auctionEndsAt: { $gt: now },
    $expr: { $lte: [ { $cond: [ { $gt: ["$currentHighestBidAmount", 0] },
                                { $add: ["$currentHighestBidAmount", "$minBidHop"] },
                                "$minPrice" ] },
                     bidAmount ] }
  },
  { $set: { currentHighestBidAmount: bidAmount, currentHighestBidder: buyerId } }
)
```

At t4 the filter computes `110 + 10 = 120 <= 111`, which is false, so B's update matches nothing and B gets a `409` with the real minimum (₹120).

The early read-and-check is still there, but only to give a friendly message in the common case. It is not what keeps the data correct.

**Why this works:** MongoDB applies a single-document `findOneAndUpdate` atomically: matching the filter and applying the update happen as one step, with no other write to that document in between. This is a **compare-and-set**: "set X, but only if the document still looks like Y".

### Alternatives considered

| Option | Why not |
|---|---|
| Multi-document transaction | Needs a replica set (local development uses a standalone `mongod`), adds retry logic for write conflicts, and is not needed: all the state that decides the winner is in one document. |
| A lock (Redis `SETNX`, a mutex) | Extra infrastructure and failure modes (a lock held by a crashed process, lock expiry). An in-process mutex would also break as soon as two API instances run. |
| Optimistic concurrency with a version field (`__v`) | Works, but every concurrent bid would fail and need a client retry, even bids that are clearly valid. The conditional filter only rejects bids that truly break the rule. |
| Queue all bids per auction | Correct, but overkill for this load, and it adds latency to every bid. |

### What is still not covered

- The `Bid` history row is created **after** the auction update, not in the same transaction. If the process crashed between the two, the auction would show the right winner but the history would miss one row. The auction document is the source of truth, so the money side stays correct.
- `auctionStartsAt` is checked only in the early check, because it never changes after approval.

### Proof

`bids.test.js` fires two bids ₹1 apart at the same moment, 25 times, and asserts that exactly one is accepted each time. **The test fails on the old code** (both bids accepted) and passes on the new one. A second test fires 50 random bids at once and checks that the accepted amounts form a valid chain (each at least ₹10 above the previous) and that the stored winner is the highest accepted bid.

### Likely questions

- *Why is `findOneAndUpdate` atomic but "read then save" is not?* The first is one operation on the server. The second is two operations with a gap in between, and other requests run in that gap.
- *Isn't Node single-threaded, so how can requests interleave?* Node runs one piece of JavaScript at a time, but every `await` on the database gives up control, and other requests run during that wait. The race happens across the `await`s, not inside the JavaScript.
- *What happens with two API servers?* Nothing changes. The guarantee comes from MongoDB, not from the Node process.

---

## 2. Locking a deal: compare-and-set on the price the farmer saw

**Code:** `controllers/auction.controller.js` → `lockDeal`, `services/auction.service.js` → `lockHighestBid` · **Tests:** `tests/lock.test.js`

### The bug

`lockDeal` read the auction, then saved `lockedDeal = { buyer: currentHighestBidder, amount: currentHighestBidAmount }` from that read. A bid accepted between the read and the save meant:

- `currentHighestBidder` = buyer B at ₹130 (the bid was accepted)
- `lockedDeal` = buyer A at ₹120 (from the stale read)

The database contradicted itself: B was told their bid was accepted, but the deal went to A at a lower price.

### The fix

1. The frontend sends `expectedAmount`: the highest bid shown on the farmer's screen when they clicked "Lock".
2. The server closes the auction with one conditional update whose filter includes `currentHighestBidAmount: expectedAmount` and `currentHighestBidder: <bidder read with it>`.
3. If a new bid arrived, the filter matches nothing. The API returns `409 "A new bid arrived (₹130). Review it and lock again."` and the page refreshes.

This also fixes a product problem, not just a data one: the farmer never ends up locked into a price they did not see.

### Why this approach

The same reasoning as section 1 applies: one document holds all the state, so a conditional update is enough. The settlement job (section 4) reuses the same `lockHighestBid` function, so manual and automatic closing cannot both succeed for one auction.

### Proof

`lock.test.js` races a lock against a higher bid 10 times. Whichever wins, the test checks that the deal and the stored highest bid agree. With the old read-then-save code (and a small delay added to make the race happen every run) this test fails with `expected 120 to be 130`.

### Likely questions

- *Why not just lock whatever is highest at that moment?* Then a farmer who clicked "Lock at ₹120" could be locked at ₹130 to a buyer they never saw. Here more money happens to be fine, but the principle matters: the user confirms what they saw.
- *What if the frontend doesn't send `expectedAmount`?* The server falls back to the value it read in the same request, so the deal still matches the stored highest bid.

---

## 3. Approval scheduling bounded by produce expiry

**Code:** `controllers/admin.controller.js` · **Tests:** `tests/admin.test.js`

### The bugs

- A missing `auctionEndsAt` became `new Date(undefined)`, an Invalid Date, and the request crashed with a 500.
- The end time was never compared to the produce's `expiresAt`. The admin screen defaulted it to "now + 15 days", so perishable produce could still be on auction after it had gone bad.
- Approve and reject worked from any status, so a paid deal could be flipped to `REJECTED`, and two admins could both approve the same listing.
- The admin form filled a `datetime-local` input with `toISOString().slice(0, 16)`, which is UTC. In India that shows 5h30m behind, and the value typed back was then sent without a timezone.

### The fix

- The end time defaults to the produce expiry; if one is given, it must be a valid date in the future, after the start, and **no later than the expiry**.
- Approve and reject are conditional updates filtered on `status: "PENDING"`, so only one of two simultaneous approvals succeeds, and nothing that is live or closed can be rejected.
- The frontend converts between local time and ISO strings explicitly (`frontend/src/utils/dateInput.js`), and limits the end-time picker to the expiry.

---

## 4. Automatic settlement of expired auctions

**Code:** `services/settlement.service.js`, started from `server.js` · **Tests:** `tests/settlement.test.js`

### The gap

Nothing happened at the end time. If the farmer never clicked "Lock", the auction stayed `APPROVED` forever: no new bids were accepted, but the top bidder never got the deal and it never left the marketplace.

### The fix

Every 60 seconds (`SETTLEMENT_INTERVAL_MS`), the API finds approved, unlocked auctions whose `auctionEndsAt` has passed (in batches of 100):

- With bids: lock the deal to the highest bidder, using the same `lockHighestBid` compare-and-set as a manual lock.
- Without bids: close with no deal (the filter re-checks that there is still no bidder).

### Why it is safe

- **Idempotent and safe on many servers:** each close is a conditional update. If two API instances (or a farmer's manual lock) race on the same auction, exactly one update matches and the others do nothing. The test runs two settlement passes at the same time over five auctions and checks that exactly five deals are closed in total.
- **Frozen input:** the bid filter requires `auctionEndsAt > now`, so once an auction has expired its highest bid cannot change while it is being settled.
- **No overlapping runs:** a `running` flag skips a tick if the previous run is still going.

### Alternatives considered

| Option | Why not (for now) |
|---|---|
| `node-cron` | Same behaviour as `setInterval` here; it only adds a dependency. Cron syntax is useful for wall-clock schedules ("every day at 02:00"), not "every minute". |
| A job queue (BullMQ + Redis) with a delayed job per auction | Closes exactly on time and spreads work out, but needs Redis and has to handle rescheduling if an admin changes the end time. Worth it at larger scale. |
| MongoDB TTL index | Deletes documents; it cannot run business logic. |
| Close "lazily" when someone views the auction | Leaves expired auctions open if nobody looks at them, and spreads write logic across read paths. |

### Limitations

An auction can remain `APPROVED` for up to one interval after its end time. This is harmless, because bids are already refused at the end time.

---

## 5. Payments: a real Razorpay webhook alongside checkout verification

**Code:** `controllers/payment.controller.js`, `services/payment.service.js`, `models/webhookEvent.model.js`, `app.js` · **Tests:** `tests/payments.test.js`

### The gap

The deal was marked paid only when the **browser** called `POST /payment/verify` after checkout. If the buyer paid and then closed the tab, lost network, or the API restarted at that moment, Razorpay had the money but FarmEasy still showed "payment pending". The browser is the least reliable part of the system, so it should not be the only path that confirms money.

### How the two paths work

**Checkout verification (browser → API).** After a successful checkout, Razorpay gives the browser `order_id`, `payment_id` and `signature = HMAC_SHA256(key_secret, order_id + "|" + payment_id)`. Only someone holding `key_secret` (Razorpay and our server) can produce that signature, so a valid one proves Razorpay issued it. Now hardened:

- compared with `crypto.timingSafeEqual` instead of `!==`;
- the payment must belong to the logged-in user.

**Webhook (Razorpay → API, server to server).** Razorpay POSTs `payment.captured`, `order.paid` or `payment.failed` to `/api/payment/webhook`, with header `X-Razorpay-Signature = HMAC_SHA256(webhook_secret, raw_request_body)`.

- **Raw body:** the route is registered **before** `express.json()` with `express.raw()`. The HMAC is over the exact bytes Razorpay sent; parsing and re-serialising the JSON can change spacing or key order and break verification.
- **No user session:** authenticity comes from the signature, not from a login.
- **Amount check:** the captured amount (in paise) must equal the deal amount, or the payment is not marked paid.
- **Response codes:** Razorpay retries anything that is not 2xx. So a bad signature gets `400` (retrying won't help), a handled or deliberately ignored event gets `200`, and only a real processing error gets `500`, so that Razorpay retries it.

### Idempotency: the core idea

The same payment can be confirmed by the browser and by the webhook, in either order, and Razorpay may deliver the same webhook more than once. `markPaymentCaptured` is therefore **idempotent**: running it twice has the same effect as running it once.

- `Payment` → `SUCCESS` only `if status != SUCCESS` (conditional update).
- `Auction.lockedDeal.isPaid` → `true` only `if not already true`. This step runs on every call, so if an earlier call crashed between the two updates, a later call (for example Razorpay's retry) repairs the auction.
- The audit event is written only by the call that actually changed the payment.
- `payment.failed` only moves `PENDING → FAILED` and can never downgrade a `SUCCESS`. `FAILED → SUCCESS` is allowed, because Razorpay lets a buyer retry a failed attempt on the same order.

**Deduplication** on Razorpay's `X-Razorpay-Event-Id` (a unique index in `webhookevents`) skips repeats cheaply. It is an optimisation, not what keeps the data correct: a delivery that crashed half-way has no `processedAt`, so its retry is processed again rather than skipped as a duplicate.

### Proof

Tests: forged signature (rejected, nothing changes), `payment.captured` (paid), the same event delivered twice (processed once), a different event for the same payment (`already_captured`), an amount mismatch (not paid), a late `payment.failed` after success (stays `SUCCESS`), webhook then checkout for the same payment (exactly one `SUCCESS`), wrong checkout signature (`400`), another user's payment (`403`).

### Likely questions

- *Why do you need both paths?* The browser path gives instant feedback; the webhook guarantees eventual correctness even if the browser disappears.
- *Why HMAC and not just checking the payment id with Razorpay's API?* Calling Razorpay's API also works and is a good extra check. The HMAC needs no network call, and it is what Razorpay documents for verifying webhooks.
- *Why `timingSafeEqual`?* `===` stops at the first differing character, so the response time leaks how much of a guessed signature was right. In practice that is hard to exploit over a network, but constant-time comparison is the standard for secrets.
- *What is idempotency?* Doing an operation once or many times leaves the same final state. It matters wherever a message can be retried or duplicated (webhooks, queues, client retries).

---

## 6. Append-only audit trail

**Code:** `models/auctionEvent.model.js`, `services/auditLog.service.js`, `GET /api/auctions/:id/timeline` · **UI:** `frontend/src/components/auction/ActivityTimeline.jsx` · **Tests:** `tests/audit.test.js`

### Why

The auction document holds the **current** state. It cannot answer "how did it get here?": who approved it, which bids came in and when, whether the deal was locked by the farmer or by the system, and whether payment came from the browser or the webhook. For disputes ("I bid first!"), support and compliance you need the history, and that history must not be editable.

### What it does

- Every state change inserts one `AuctionEvent`: `CREATED`, `APPROVED`, `REJECTED`, `BID_ACCEPTED`, `DEAL_LOCKED`, `AUTO_SETTLED`, `CLOSED_NO_BIDS`, `PAYMENT_CAPTURED`, `PAYMENT_FAILED`, with who did it (`farmer`, `buyer`, `admin`, `system`, `razorpay`), when, and the relevant amounts or ids.
- **Insert-only:** the code has no path that updates or deletes an event.
- The timeline is visible to the listing's farmer, the winning buyer and admins (`403` for anyone else), and is shown on the auction page.

### Trade-off: best-effort writes

The audit insert runs **after** the state change has been committed. If it fails, the error is logged and the user's request still succeeds. An accepted bid should not turn into an error because an audit insert timed out. The cost is that in a rare failure the trail could miss an event. The stronger design is a transactional outbox (write the state change and the event in one transaction, on a replica set), or deriving events from MongoDB change streams.

### Likely questions

- *Why not just keep `updatedAt` and a status field?* That tells you the latest state, not the sequence of changes or who caused them.
- *How would you make the trail tamper-evident?* Chain the events: store a hash of each event together with the previous event's hash, so any edit breaks the chain.

---

## 7. Smaller hardening

| Change | Why |
|---|---|
| Rate limits (`express-rate-limit`): 10 per 15 min per IP on login, signup and password reset; 30 bids per minute per user; 30 uploads per hour per user | Stops password guessing and email-quota abuse (signup and forgot-password send real emails). Bid and upload limits are keyed per user so that many buyers behind one college IP are not blocked together. |
| HTML-escape user names in emails | A "name" like `<a href=…>Claim ₹5000</a>` would otherwise put a phishing link inside a genuine FarmEasy email. |
| Regex-escape marketplace search text, max 100 characters | Search text was used as a raw regex on a public endpoint; patterns like `((a+)+)+$` can make the database backtrack for a long time. |
| Listing images must be on our own Cloudinary account | Stops listings from pointing at third-party URLs that track viewers' IP addresses. |
| Pending and rejected listings visible only to their farmer and admins; the marketplace `status` filter accepts only `APPROVED` and `CLOSED` | Unmoderated content was publicly listable. |
| Reviews only after payment | A buyer who never paid could rate the farmer. |
| Error handler: malformed ids return `400`; internal error messages are hidden in production | `/api/auctions/abc` used to return a 500 with Mongoose internals in the message. |
| Startup check for required environment variables | A missing JWT secret used to show up only as a crash on the first login. |
| Logout clears cookies with the same attributes they were set with | Browsers ignore a clear-cookie whose `secure`/`sameSite` attributes don't match the original, so logout didn't clear them in production. |
| Removed verification-token debug logging | Tokens were written to the server log. |
| No `express.urlencoded`, JSON body limit 100 kB | The API is JSON-only; without urlencoded parsing, a plain cross-site HTML form can't submit to it. |
| Removed the npm `crypto` package and `express-mongo-sanitize` | `crypto` is a deprecated stub (Node's built-in is what loads); `express-mongo-sanitize` was installed but never used, and doesn't support Express 5. |
| Blank phone number no longer blocks signup | The form sends `""`, which `optional()` did not skip. |
| Bid route moved to `POST /api/auctions/:id/bids`; added `GET /api/auctions/:id/bids` | The old `/api/:id/bids` matched any `/api/<anything>/bids`, and the bid-history component called a route that didn't exist. |
| Frontend: farmer owner check uses `user.id`; hooks run before early returns; the bid response updates the page without relying on the socket; only this page's socket handlers are removed on unmount | Fixes "Login to bid" on your own auction, crashes on refreshing `/admin` and `/my-auctions`, a stale price when the socket is down, and other components losing their socket listeners. |

---

## 8. Running the tests

```bash
cd backend
npm test
```

The tests use `mongodb-memory-server`, which starts a throwaway `mongod` (downloaded the first time), and Supertest, which calls the Express app in-process. Razorpay order creation and the mailer are mocked, so the tests make no network calls. GitHub Actions runs them on every push.

---

## 9. REST endpoints (28)

| # | Method | Path |
|---|---|---|
| 1 | GET | `/api/health` |
| 2 | POST | `/api/auth/signup` |
| 3 | GET | `/api/auth/verify-email` |
| 4 | POST | `/api/auth/login` |
| 5 | POST | `/api/auth/logout` |
| 6 | POST | `/api/auth/refresh` |
| 7 | GET | `/api/auth/me` |
| 8 | POST | `/api/auth/forgot-password` |
| 9 | POST | `/api/auth/reset-password` |
| 10 | GET | `/api/auctions` |
| 11 | GET | `/api/auctions/:id` |
| 12 | GET | `/api/auctions/:id/timeline` |
| 13 | POST | `/api/auctions` |
| 14 | POST | `/api/auctions/:id/lock` |
| 15 | GET | `/api/auctions/:id/bids` |
| 16 | POST | `/api/auctions/:id/bids` |
| 17 | GET | `/api/admin/auctions/pending` |
| 18 | POST | `/api/admin/auctions/:id/approve` |
| 19 | POST | `/api/admin/auctions/:id/reject` |
| 20 | GET | `/api/profile/me` |
| 21 | GET | `/api/profile/:userId` |
| 22 | POST | `/api/auctions/:auctionId/review` |
| 23 | GET | `/api/farmers/:farmerId/reviews` |
| 24 | POST | `/api/upload` |
| 25 | POST | `/api/auctions/:auctionId/payment/create-order` |
| 26 | POST | `/api/payment/verify` |
| 27 | GET | `/api/auctions/:auctionId/payment/status` |
| 28 | POST | `/api/payment/webhook` |

Plus Socket.IO events: `join-auction`, `leave-auction`, `new-bid`, `auction-closed`, `auction-approved`.
