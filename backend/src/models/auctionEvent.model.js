import mongoose from "mongoose";

const { Schema } = mongoose;

export const AUCTION_EVENT_TYPES = [
  "CREATED",
  "APPROVED",
  "REJECTED",
  "BID_ACCEPTED",
  "DEAL_LOCKED",
  "AUTO_SETTLED",
  "CLOSED_NO_BIDS",
  "PAYMENT_CAPTURED",
  "PAYMENT_FAILED"
];

export const ACTOR_TYPES = ["farmer", "buyer", "admin", "system", "razorpay"];

// Append-only audit trail: one document per state change of an auction.
// The application only ever inserts into this collection; there is no code path
// that updates or deletes an event, so the history of any auction can be replayed.
const auctionEventSchema = new Schema(
  {
    auction: { type: Schema.Types.ObjectId, ref: "Auction", required: true, index: true },
    type: { type: String, enum: AUCTION_EVENT_TYPES, required: true },
    actor: { type: Schema.Types.ObjectId, ref: "User", default: null },
    actorType: { type: String, enum: ACTOR_TYPES, required: true },
    data: { type: Schema.Types.Mixed, default: {} }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auctionEventSchema.index({ auction: 1, createdAt: 1 });

export const AuctionEvent = mongoose.model("AuctionEvent", auctionEventSchema);
