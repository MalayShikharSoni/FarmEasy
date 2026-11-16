import { Auction } from "../models/auction.model.js";

/**
 * Close an auction and lock the deal to its current highest bidder, but only
 * if the highest bid is still exactly the one the caller saw (compare-and-set).
 *
 * Why: "read the auction, then save lockedDeal" has a gap. A bid accepted in
 * between would leave the deal locked to the previous bidder at the previous
 * price while currentHighestBidder names someone else. Putting the expected
 * amount and bidder in the filter makes MongoDB refuse the update if anything
 * changed, so the caller can re-read and decide again.
 *
 * Returns the updated auction, or null if the auction changed (or was already
 * closed) in the meantime.
 */
export const lockHighestBid = ({ auctionId, expectedAmount, expectedBidder, farmerId, lockedAt = new Date() }) => {
  const filter = {
    _id: auctionId,
    status: "APPROVED",
    "lockedDeal.isLocked": { $ne: true },
    currentHighestBidAmount: expectedAmount,
    currentHighestBidder: expectedBidder
  };
  if (farmerId) filter.farmer = farmerId;

  return Auction.findOneAndUpdate(
    filter,
    {
      $set: {
        status: "CLOSED",
        lockedDeal: {
          isLocked: true,
          lockedAt,
          buyer: expectedBidder,
          amount: expectedAmount,
          isPaid: false,
          paidAt: null
        }
      }
    },
    { new: true }
  );
};

/**
 * Close an auction that received no bids. The filter re-checks that there is
 * still no highest bidder, so this can never close an auction that has one.
 */
export const closeWithoutBids = (auctionId) =>
  Auction.findOneAndUpdate(
    {
      _id: auctionId,
      status: "APPROVED",
      "lockedDeal.isLocked": { $ne: true },
      currentHighestBidder: null
    },
    { $set: { status: "CLOSED" } },
    { new: true }
  );
