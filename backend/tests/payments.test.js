import crypto from "crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Razorpay's order API is mocked: tests never call the network.
let orderCounter = 0;
vi.mock("../src/config/razorpay.js", () => ({
  razorpayInstance: {
    orders: { create: vi.fn(async ({ amount }) => ({ id: `order_test_${++orderCounter}`, amount })) }
  }
}));

const { app, request, useDatabase, createUser, createAuction } = await import("./helpers.js");
const { Auction } = await import("../src/models/auction.model.js");
const { Payment } = await import("../src/models/payment.model.js");
const { AuctionEvent } = await import("../src/models/auctionEvent.model.js");

useDatabase();

const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const hmac = (secret, data) => crypto.createHmac("sha256", secret).update(data).digest("hex");

const capturedEvent = (orderId, amountPaise, paymentId = "pay_test_1") => ({
  event: "payment.captured",
  payload: { payment: { entity: { id: paymentId, order_id: orderId, amount: amountPaise, status: "captured" } } }
});

/** Send a webhook exactly the way Razorpay does: raw JSON bytes + signature header. */
const sendWebhook = (payload, { eventId = "evt_1", secret = WEBHOOK_SECRET } = {}) => {
  const raw = JSON.stringify(payload);
  return request(app)
    .post("/api/payment/webhook")
    .set("Content-Type", "application/json")
    .set("X-Razorpay-Signature", hmac(secret, raw))
    .set("X-Razorpay-Event-Id", eventId)
    .send(raw);
};

let farmer, buyer, auction, orderId;

beforeEach(async () => {
  farmer = await createUser("farmer");
  buyer = await createUser("buyer");
  auction = await createAuction(farmer.user, {
    status: "CLOSED",
    currentHighestBidAmount: 250,
    currentHighestBidder: buyer.user._id,
    lockedDeal: { isLocked: true, lockedAt: new Date(), buyer: buyer.user._id, amount: 250, isPaid: false }
  });
  const res = await request(app)
    .post(`/api/auctions/${auction._id}/payment/create-order`)
    .set(buyer.auth)
    .expect(200);
  orderId = res.body.orderId;
});

describe("Razorpay webhook", () => {
  it("rejects a forged signature and changes nothing", async () => {
    const res = await sendWebhook(capturedEvent(orderId, 25000), { secret: "not-the-real-secret" });
    expect(res.status).toBe(400);
    expect((await Payment.findOne({ razorpayOrderId: orderId })).status).toBe("PENDING");
    expect((await Auction.findById(auction._id)).lockedDeal.isPaid).toBe(false);
  });

  it("marks the deal paid on payment.captured", async () => {
    await sendWebhook(capturedEvent(orderId, 25000)).expect(200);

    const payment = await Payment.findOne({ razorpayOrderId: orderId });
    expect(payment.status).toBe("SUCCESS");
    expect(payment.capturedVia).toBe("webhook");
    expect((await Auction.findById(auction._id)).lockedDeal.isPaid).toBe(true);
  });

  it("processes a repeated delivery only once", async () => {
    await sendWebhook(capturedEvent(orderId, 25000), { eventId: "evt_same" }).expect(200);
    const again = await sendWebhook(capturedEvent(orderId, 25000), { eventId: "evt_same" }).expect(200);
    expect(again.body.duplicate).toBe(true);

    // A different event id for the same payment (e.g. order.paid after
    // payment.captured) is also harmless.
    const other = await sendWebhook(capturedEvent(orderId, 25000), { eventId: "evt_other" }).expect(200);
    expect(other.body.outcome).toBe("already_captured");

    expect(await AuctionEvent.countDocuments({ auction: auction._id, type: "PAYMENT_CAPTURED" })).toBe(1);
  });

  it("does not mark paid when the amount does not match the deal", async () => {
    const res = await sendWebhook(capturedEvent(orderId, 100)).expect(200);
    expect(res.body.outcome).toBe("amount_mismatch");
    expect((await Payment.findOne({ razorpayOrderId: orderId })).status).toBe("PENDING");
  });

  it("never downgrades a successful payment on a late payment.failed", async () => {
    await sendWebhook(capturedEvent(orderId, 25000), { eventId: "evt_ok" }).expect(200);
    await sendWebhook(
      { event: "payment.failed", payload: { payment: { entity: { id: "pay_x", order_id: orderId, error_description: "declined" } } } },
      { eventId: "evt_fail" }
    ).expect(200);
    expect((await Payment.findOne({ razorpayOrderId: orderId })).status).toBe("SUCCESS");
  });
});

describe("checkout verification", () => {
  const verify = (who, paymentId, signature) =>
    request(app)
      .post("/api/payment/verify")
      .set(who.auth)
      .send({ razorpayOrderId: orderId, razorpayPaymentId: paymentId, razorpaySignature: signature });

  it("rejects a wrong signature", async () => {
    await verify(buyer, "pay_1", "0".repeat(64)).expect(400);
  });

  it("rejects another user's payment", async () => {
    const stranger = await createUser("buyer");
    await verify(stranger, "pay_1", hmac(KEY_SECRET, `${orderId}|pay_1`)).expect(403);
  });

  it("agrees with the webhook when both confirm the same payment", async () => {
    await sendWebhook(capturedEvent(orderId, 25000, "pay_1")).expect(200);
    const res = await verify(buyer, "pay_1", hmac(KEY_SECRET, `${orderId}|pay_1`)).expect(200);
    expect(res.body.message).toBe("Already verified");
    expect(await Payment.countDocuments({ razorpayOrderId: orderId, status: "SUCCESS" })).toBe(1);
  });

  it("allows a review only after payment", async () => {
    const review = () =>
      request(app).post(`/api/auctions/${auction._id}/review`).set(buyer.auth).send({ rating: 5, comment: "Great" });

    await review().expect(400);
    await verify(buyer, "pay_1", hmac(KEY_SECRET, `${orderId}|pay_1`)).expect(200);
    await review().expect(201);
  });
});
