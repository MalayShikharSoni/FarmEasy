import { StatusCodes } from "http-status-codes";
import { Auction } from "../models/auction.model.js";
import { Bid } from "../models/bid.model.js";
import { recordAuctionEvent } from "../services/auditLog.service.js";

// Smallest bid the auction accepts right now: the starting price for the
// first bid, otherwise the current highest bid plus the minimum increment.
const minimumNextBid = (auction) =>
  auction.currentHighestBidAmount > 0
    ? auction.currentHighestBidAmount + auction.minBidHop
    : auction.minPrice;

// Explains why an auction is not accepting a given bid right now.
// Used both for the early checks and after a failed atomic update.
const bidRejection = (auction, bidAmount, now) => {
  if (auction.status !== "APPROVED" || auction.lockedDeal?.isLocked) {
    return { status: StatusCodes.BAD_REQUEST, message: "Auction is closed for bidding" };
  }
  if (auction.auctionStartsAt && now < auction.auctionStartsAt) {
    return { status: StatusCodes.BAD_REQUEST, message: "Auction has not started yet" };
  }
  if (!auction.auctionEndsAt || now >= auction.auctionEndsAt) {
    return { status: StatusCodes.BAD_REQUEST, message: "Auction has ended" };
  }
  const minAllowed = minimumNextBid(auction);
  if (bidAmount < minAllowed) {
    return {
      status: StatusCodes.CONFLICT,
      message: `Bid too low. Minimum allowed is ${minAllowed}`,
      minAllowed
    };
  }
  return null;
};

export const placeBid = async (req, res, next) => {
  try {
    if (req.user.role !== "buyer") {
      return res.status(StatusCodes.FORBIDDEN).json({ success: false, message: "Only buyers can bid" });
    }

    const bidAmount = Number(req.body?.amount);
    if (!Number.isFinite(bidAmount) || bidAmount <= 0) {
      return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: "Invalid bid amount" });
    }

    const auction = await Auction.findById(req.params.id);
    if (!auction) {
      return res.status(StatusCodes.NOT_FOUND).json({ success: false, message: "Auction not found" });
    }

    // Early checks give a friendly message in the common case.
    // They are NOT what keeps the data correct: another bid can land between
    // this read and the write below, so the write re-checks everything itself.
    const now = new Date();
    const early = bidRejection(auction, bidAmount, now);
    if (early) {
      return res.status(early.status).json({ success: false, message: early.message, minAllowed: early.minAllowed });
    }

    // The atomic write is the single source of truth for the bidding rules.
    // MongoDB evaluates this filter and applies the update as one operation on
    // one document, so two concurrent bids can never both be accepted against
    // the same previous highest bid, and the minimum increment is checked
    // against the value that is actually stored at that moment.
    const updated = await Auction.findOneAndUpdate(
      {
        _id: auction._id,
        status: "APPROVED",
        "lockedDeal.isLocked": { $ne: true },
        auctionEndsAt: { $gt: now },
        // minimumNextBid, computed by MongoDB from the stored values:
        // (current > 0 ? current + minBidHop : minPrice) <= bidAmount
        $expr: {
          $lte: [
            {
              $cond: [
                { $gt: ["$currentHighestBidAmount", 0] },
                { $add: ["$currentHighestBidAmount", "$minBidHop"] },
                "$minPrice"
              ]
            },
            bidAmount
          ]
        }
      },
      {
        $set: {
          currentHighestBidAmount: bidAmount,
          currentHighestBidder: req.user._id
        }
      },
      { new: true }
    );

    if (!updated) {
      // Someone else changed the auction first. Re-read and report the reason
      // that is true now (outbid, closed, or ended).
      const latest = await Auction.findById(auction._id);
      const reason = latest && bidRejection(latest, bidAmount, new Date());
      return res.status(reason?.status ?? StatusCodes.CONFLICT).json({
        success: false,
        message: reason?.message ?? "You were outbid. Refresh and try again.",
        minAllowed: reason?.minAllowed,
        currentHighestBidAmount: latest?.currentHighestBidAmount
      });
    }

    // No multi-document transaction here, on purpose: the auction document is
    // the source of truth for who is winning, and the Bid collection is an
    // append-only history written after the winning update. Transactions need a
    // replica set (local dev runs a standalone mongod), and a missing history
    // row is far less harmful than a wrong highest bid.
    const bid = await Bid.create({
      auction: auction._id,
      bidder: req.user._id,
      amount: bidAmount
    });

    await recordAuctionEvent({
      auction: auction._id,
      type: "BID_ACCEPTED",
      actor: req.user._id,
      actorType: "buyer",
      data: { amount: bidAmount }
    });

    const io = req.app.get("io");
    if (io) {
      io.to(`auction:${auction._id}`).emit("new-bid", {
        auctionId: updated._id,
        currentHighestBidAmount: updated.currentHighestBidAmount,
        currentHighestBidder: updated.currentHighestBidder,
        newBid: {
          amount: bidAmount,
          bidder: req.user.name,
          timestamp: bid.createdAt
        }
      });
    }

    return res.status(StatusCodes.CREATED).json({ success: true, bid, auction: updated });
  } catch (err) {
    next(err);
  }
};

// Bid history of a public auction, newest first.
export const listBids = async (req, res, next) => {
  try {
    const auction = await Auction.findById(req.params.id).select("status");
    if (!auction || !["APPROVED", "CLOSED"].includes(auction.status)) {
      return res.status(StatusCodes.NOT_FOUND).json({ success: false, message: "Auction not found" });
    }

    const bids = await Bid.find({ auction: auction._id })
      .sort({ amount: -1, createdAt: -1 })
      .limit(100)
      .populate("bidder", "name")
      .lean();

    return res.json({ success: true, bids });
  } catch (err) {
    next(err);
  }
};
