import { Auction } from "../models/auction.model.js";
import { lockHighestBid, closeWithoutBids } from "./auction.service.js";
import { recordAuctionEvent } from "./auditLog.service.js";

const BATCH_SIZE = 100;

/**
 * Close every auction whose end time has passed and that nobody closed yet:
 *  - with bids: lock the deal to the highest bidder at the highest bid;
 *  - without bids: close it with no deal.
 *
 * Safe to run on several server instances at once, and safe to re-run: every
 * close is a conditional update (see auction.service.js), so if two instances
 * pick the same auction, exactly one update matches and the other is a no-op.
 * The same guard protects against a farmer locking the deal by hand at the
 * same moment.
 *
 * Bids cannot change an expired auction (the bid filter requires
 * auctionEndsAt > now), so the values read here are final.
 *
 * Returns how many auctions this run closed, for logging and tests.
 */
export const settleExpiredAuctions = async ({ now = new Date(), io } = {}) => {
  const expired = await Auction.find({
    status: "APPROVED",
    "lockedDeal.isLocked": { $ne: true },
    auctionEndsAt: { $lte: now }
  })
    .sort({ auctionEndsAt: 1 })
    .limit(BATCH_SIZE)
    .select("_id currentHighestBidAmount currentHighestBidder");

  let settledWithDeal = 0;
  let closedWithoutBids = 0;

  for (const auction of expired) {
    if (auction.currentHighestBidder) {
      const updated = await lockHighestBid({
        auctionId: auction._id,
        expectedAmount: auction.currentHighestBidAmount,
        expectedBidder: auction.currentHighestBidder,
        lockedAt: now
      });
      if (!updated) continue; // someone else closed it first

      settledWithDeal += 1;
      await recordAuctionEvent({
        auction: updated._id,
        type: "AUTO_SETTLED",
        actorType: "system",
        data: { amount: updated.lockedDeal.amount, buyer: updated.lockedDeal.buyer }
      });
      io?.to(`auction:${updated._id}`).emit("auction-closed", {
        auctionId: updated._id,
        winner: updated.lockedDeal.buyer,
        finalAmount: updated.lockedDeal.amount,
        lockedAt: updated.lockedDeal.lockedAt
      });
    } else {
      const updated = await closeWithoutBids(auction._id);
      if (!updated) continue;

      closedWithoutBids += 1;
      await recordAuctionEvent({ auction: updated._id, type: "CLOSED_NO_BIDS", actorType: "system" });
      io?.to(`auction:${updated._id}`).emit("auction-closed", { auctionId: updated._id, winner: null });
    }
  }

  return { settledWithDeal, closedWithoutBids };
};

/**
 * Run settlement on a fixed interval. A plain setInterval is enough here:
 * runs are idempotent, so an overlapping or missed tick only delays a close by
 * one interval. The `running` flag stops a slow run from overlapping the next.
 */
export const startSettlementJob = ({ intervalMs, io }) => {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { settledWithDeal, closedWithoutBids } = await settleExpiredAuctions({ io });
      if (settledWithDeal || closedWithoutBids) {
        console.log(`[settlement] closed ${settledWithDeal} with a deal, ${closedWithoutBids} without bids`);
      }
    } catch (err) {
      console.error("[settlement] run failed:", err.message);
    } finally {
      running = false;
    }
  };

  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
};
