import mongoose from "mongoose";

const { Schema } = mongoose;

// One document per Razorpay webhook delivery we have seen, keyed by Razorpay's
// event id. Razorpay retries deliveries (and can send the same event more than
// once), so the unique index lets us recognise a repeat cheaply.
const webhookEventSchema = new Schema(
  {
    eventId: { type: String, required: true, unique: true },
    event: { type: String, required: true },
    razorpayOrderId: String,
    receivedAt: { type: Date, default: Date.now },
    processedAt: Date,
    outcome: String
  },
  { versionKey: false }
);

export const WebhookEvent = mongoose.model("WebhookEvent", webhookEventSchema);
