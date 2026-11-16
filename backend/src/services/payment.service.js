import crypto from "crypto";
import { Auction } from "../models/auction.model.js";
import { Payment } from "../models/payment.model.js";
import { recordAuctionEvent } from "./auditLog.service.js";

/** HMAC-SHA256 of `payload` with `secret`, as lowercase hex (Razorpay's format). */
export const hmacSha256Hex = (secret, payload) =>
  crypto.createHmac("sha256", secret).update(payload).digest("hex");

/**
 * Constant-time string comparison. A plain `===` returns as soon as the first
 * character differs, which in principle leaks how much of a guessed signature
 * was right. timingSafeEqual always compares every byte.
 */
export const safeEqual = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
};

const toPaise = (rupees) => Math.round(rupees * 100);

/**
 * Mark a Razorpay order as paid. Called from two places that can both fire
 * for the same payment, in any order, any number of times:
 *   - the browser checkout callback (POST /payment/verify), and
 *   - Razorpay's webhook (POST /payment/webhook), which also retries.
 *
 * So it is idempotent: every write is a conditional update that only changes
 * something that is not already in its final state. Calling it twice is safe
 * and the second call reports "already_captured".
 */
export const markPaymentCaptured = async ({
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
  amountPaise,
  source
}) => {
  const payment = await Payment.findOne({ razorpayOrderId });
  if (!payment) return { outcome: "unknown_order" };

  // Never mark an order paid for a different amount than the deal.
  if (amountPaise !== undefined && amountPaise !== toPaise(payment.amount)) {
    console.error(
      `[payment] amount mismatch for order ${razorpayOrderId}: got ${amountPaise} paise, expected ${toPaise(payment.amount)}`
    );
    return { outcome: "amount_mismatch", payment };
  }

  const now = new Date();

  // FAILED -> SUCCESS is allowed: Razorpay lets a buyer retry a failed
  // attempt on the same order.
  const captured = await Payment.findOneAndUpdate(
    { _id: payment._id, status: { $ne: "SUCCESS" } },
    {
      $set: {
        status: "SUCCESS",
        razorpayPaymentId,
        ...(razorpaySignature ? { razorpaySignature } : {}),
        paidAt: now,
        capturedVia: source
      },
      $unset: { failureReason: "" }
    },
    { new: true }
  );

  // Runs on every call, not only the first: if an earlier call updated the
  // payment and then crashed before this line, a retry repairs the auction.
  await Auction.updateOne(
    { _id: payment.auction, "lockedDeal.isPaid": { $ne: true } },
    { $set: { "lockedDeal.isPaid": true, "lockedDeal.paidAt": captured?.paidAt ?? payment.paidAt ?? now } }
  );

  if (!captured) {
    return { outcome: "already_captured", payment: await Payment.findById(payment._id) };
  }

  await recordAuctionEvent({
    auction: payment.auction,
    type: "PAYMENT_CAPTURED",
    actor: source === "checkout" ? payment.buyer : null,
    actorType: source === "checkout" ? "buyer" : "razorpay",
    data: { amount: payment.amount, razorpayOrderId, razorpayPaymentId, via: source }
  });

  return { outcome: "captured", payment: captured };
};

/** Record a failed attempt, but never downgrade a payment that already succeeded. */
export const markPaymentFailed = async ({ razorpayOrderId, razorpayPaymentId, reason }) => {
  const failed = await Payment.findOneAndUpdate(
    { razorpayOrderId, status: "PENDING" },
    { $set: { status: "FAILED", razorpayPaymentId, failureReason: reason?.slice(0, 500) } },
    { new: true }
  );
  if (!failed) return { outcome: "ignored" };

  await recordAuctionEvent({
    auction: failed.auction,
    type: "PAYMENT_FAILED",
    actorType: "razorpay",
    data: { razorpayOrderId, razorpayPaymentId, reason: failed.failureReason }
  });
  return { outcome: "failed", payment: failed };
};
