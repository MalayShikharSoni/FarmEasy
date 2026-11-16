import { AuctionEvent } from "../models/auctionEvent.model.js";

/**
 * Record one state change of an auction in the append-only audit trail.
 *
 * Trade-off: this write is best-effort. It runs after the state change has
 * already been committed, and a failure here is logged but never fails the
 * user's request (a buyer's accepted bid must not turn into an error because
 * the audit insert timed out). The cost is that, in a rare failure, the trail
 * can miss an event; the auction document itself stays correct.
 */
export const recordAuctionEvent = async ({ auction, type, actor = null, actorType, data = {} }) => {
  try {
    await AuctionEvent.create({
      auction,
      type,
      actor,
      actorType,
      data
    });
  } catch (err) {
    console.error(`[audit] failed to record ${type} for auction ${auction}:`, err.message);
  }
};
