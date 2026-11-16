import crypto from "crypto";
import { StatusCodes } from "http-status-codes";
import { razorpayInstance } from "../config/razorpay.js";
import { Auction } from "../models/auction.model.js";
import { Payment } from "../models/payment.model.js";
import { WebhookEvent } from "../models/webhookEvent.model.js";
import { env } from "../config/env.js";
import {
  hmacSha256Hex,
  safeEqual,
  markPaymentCaptured,
  markPaymentFailed
} from "../services/payment.service.js";

export const createPaymentOrder = async (req, res, next) => {
  try {
    const auction = await Auction.findById(req.params.auctionId);

    if (!auction) {
      return res.status(StatusCodes.NOT_FOUND).json({ success: false, message: "Auction not found" });
    }
    if (!auction.lockedDeal?.isLocked) {
      return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: "Deal not locked yet" });
    }
    if (String(auction.lockedDeal.buyer) !== String(req.user._id)) {
      return res.status(StatusCodes.FORBIDDEN).json({ success: false, message: "Only the winning buyer can pay" });
    }
    if (auction.lockedDeal.isPaid) {
      return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: "Already paid" });
    }

    // Reuse an open order instead of creating a second one for the same deal.
    const existingPayment = await Payment.findOne({
      auction: auction._id,
      buyer: req.user._id,
      status: "PENDING"
    });

    if (existingPayment) {
      return res.json({
        success: true,
        orderId: existingPayment.razorpayOrderId,
        amount: existingPayment.amount,
        currency: "INR",
        keyId: env.razorpay.keyId
      });
    }

    const amount = Math.round(auction.lockedDeal.amount * 100); // paise

    // Razorpay receipts are limited to 40 characters.
    const receipt = `rcpt_${auction._id.toString().slice(-8)}_${Date.now().toString().slice(-8)}`;

    const order = await razorpayInstance.orders.create({
      amount,
      currency: "INR",
      receipt,
      notes: { auctionId: auction._id.toString() }
    });

    await Payment.create({
      auction: auction._id,
      buyer: req.user._id,
      farmer: auction.farmer,
      amount: auction.lockedDeal.amount,
      razorpayOrderId: order.id,
      status: "PENDING"
    });

    return res.json({
      success: true,
      orderId: order.id,
      amount: auction.lockedDeal.amount,
      currency: "INR",
      keyId: env.razorpay.keyId
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Browser-side confirmation. After checkout, Razorpay gives the browser
 * (order_id, payment_id, signature) where signature =
 * HMAC_SHA256(key_secret, "order_id|payment_id"). Only someone with our key
 * secret can produce it, so a valid signature proves Razorpay issued it.
 *
 * This path alone is not enough (the buyer can close the tab before it runs),
 * which is why the webhook below exists. Both call the same idempotent service.
 */
export const verifyPayment = async (req, res, next) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body ?? {};

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: "Missing payment details" });
    }

    const expected = hmacSha256Hex(env.razorpay.keySecret, `${razorpayOrderId}|${razorpayPaymentId}`);
    if (!safeEqual(expected, razorpaySignature)) {
      return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: "Invalid payment signature" });
    }

    const payment = await Payment.findOne({ razorpayOrderId });
    if (!payment) {
      return res.status(StatusCodes.NOT_FOUND).json({ success: false, message: "Payment record not found" });
    }
    if (String(payment.buyer) !== String(req.user._id)) {
      return res.status(StatusCodes.FORBIDDEN).json({ success: false, message: "This payment belongs to another user" });
    }

    const result = await markPaymentCaptured({
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      source: "checkout"
    });

    return res.json({
      success: true,
      message: result.outcome === "already_captured" ? "Already verified" : "Payment verified successfully",
      payment: result.payment
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Razorpay webhook (server-to-server). Registered in app.js with a raw body
 * parser, BEFORE express.json(), because the signature is an HMAC over the
 * exact bytes Razorpay sent: re-serialising parsed JSON can change spacing or
 * key order and break verification.
 *
 * Response codes matter: Razorpay retries anything that is not 2xx.
 *  - 400 for a bad signature (not from Razorpay; retrying will not help)
 *  - 2xx once the event is handled or deliberately ignored
 *  - 500 only for a real processing error, so Razorpay retries it later
 */
export const razorpayWebhook = async (req, res, next) => {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    const signature = req.get("x-razorpay-signature");

    if (!env.razorpay.webhookSecret) {
      console.error("[webhook] RAZORPAY_WEBHOOK_SECRET is not configured");
      return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ success: false, message: "Webhook not configured" });
    }

    const expected = hmacSha256Hex(env.razorpay.webhookSecret, rawBody);
    if (!signature || !safeEqual(expected, signature)) {
      return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: "Invalid webhook signature" });
    }

    let body;
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: "Malformed JSON" });
    }

    const event = body?.event ?? "unknown";
    const paymentEntity = body?.payload?.payment?.entity;
    const orderEntity = body?.payload?.order?.entity;
    const razorpayOrderId = paymentEntity?.order_id ?? orderEntity?.id;

    // Razorpay sends a unique id per event in this header. Fall back to a hash
    // of the body so dedupe still works if the header is ever missing.
    const eventId =
      req.get("x-razorpay-event-id") || crypto.createHash("sha256").update(rawBody).digest("hex");

    // Dedupe is an optimisation, not what keeps data correct: the handlers are
    // idempotent anyway. A previous delivery that crashed half-way has no
    // processedAt, so it is processed again rather than skipped.
    let record;
    try {
      record = await WebhookEvent.create({ eventId, event, razorpayOrderId });
    } catch (err) {
      if (err?.code !== 11000) throw err;
      record = await WebhookEvent.findOne({ eventId });
      if (record?.processedAt) {
        return res.json({ success: true, duplicate: true });
      }
    }

    let outcome = "ignored";
    if ((event === "payment.captured" || event === "order.paid") && paymentEntity?.id && razorpayOrderId) {
      const result = await markPaymentCaptured({
        razorpayOrderId,
        razorpayPaymentId: paymentEntity.id,
        amountPaise: paymentEntity.amount,
        source: "webhook"
      });
      outcome = result.outcome;
    } else if (event === "payment.failed" && razorpayOrderId) {
      const result = await markPaymentFailed({
        razorpayOrderId,
        razorpayPaymentId: paymentEntity?.id,
        reason: paymentEntity?.error_description
      });
      outcome = result.outcome;
    }

    await WebhookEvent.updateOne({ _id: record._id }, { $set: { processedAt: new Date(), outcome } });

    return res.json({ success: true, outcome });
  } catch (err) {
    next(err);
  }
};

export const getPaymentStatus = async (req, res, next) => {
  try {
    const auction = await Auction.findById(req.params.auctionId);

    if (!auction) {
      return res.status(StatusCodes.NOT_FOUND).json({ success: false, message: "Auction not found" });
    }

    // Latest attempt first, so a successful retry is shown over an old failure.
    const payment = await Payment.findOne({ auction: auction._id })
      .sort({ createdAt: -1 })
      .populate("buyer", "name email")
      .populate("farmer", "name");

    if (!payment) {
      return res.status(StatusCodes.NOT_FOUND).json({ success: false, message: "No payment found" });
    }

    const userId = String(req.user._id);
    if (userId !== String(payment.buyer._id) && userId !== String(payment.farmer._id) && req.user.role !== "admin") {
      return res.status(StatusCodes.FORBIDDEN).json({ success: false, message: "Access denied" });
    }

    return res.json({ success: true, payment });
  } catch (err) {
    next(err);
  }
};
