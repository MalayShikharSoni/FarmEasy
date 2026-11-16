import { StatusCodes } from "http-status-codes";
import { Auction } from "../models/auction.model.js";
import { recordAuctionEvent } from "../services/auditLog.service.js";

const parseDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const badRequest = (res, message) =>
  res.status(StatusCodes.BAD_REQUEST).json({ success: false, message });

export const listPendingAuctions = async (req, res, next) => {
  try {
    const auctions = await Auction.find({ status: "PENDING" })
      .populate("farmer", "name email")
      .sort({ createdAt: -1 });

    return res.json({ success: true, auctions });
  } catch (err) {
    next(err);
  }
};

export const approveAuction = async (req, res, next) => {
  try {
    const auction = await Auction.findById(req.params.id);
    if (!auction) {
      return res.status(StatusCodes.NOT_FOUND).json({ success: false, message: "Auction not found" });
    }
    if (auction.status !== "PENDING") {
      return badRequest(res, "Auction not in PENDING state");
    }

    // Scheduling rules: the auction starts now unless a start is given, and it
    // must end before the produce expires. With no end time given, it ends
    // exactly when the produce expires.
    const now = new Date();
    const { auctionStartsAt, auctionEndsAt } = req.body ?? {};

    const startsAt = auctionStartsAt ? parseDate(auctionStartsAt) : now;
    if (!startsAt) return badRequest(res, "auctionStartsAt is not a valid date");

    const endsAt = auctionEndsAt ? parseDate(auctionEndsAt) : auction.expiresAt;
    if (!endsAt) return badRequest(res, "auctionEndsAt is not a valid date");

    if (endsAt <= now) return badRequest(res, "Auction end time must be in the future");
    if (endsAt <= startsAt) return badRequest(res, "Auction must end after it starts");
    if (endsAt > auction.expiresAt) {
      return badRequest(
        res,
        `Auction must end on or before the produce expiry (${auction.expiresAt.toISOString()})`
      );
    }

    // Conditional transition: only a PENDING auction can be approved, so two
    // admins clicking at the same time cannot both approve it.
    const updated = await Auction.findOneAndUpdate(
      { _id: auction._id, status: "PENDING" },
      {
        $set: {
          status: "APPROVED",
          approvedBy: req.user._id,
          approvedAt: now,
          auctionStartsAt: startsAt,
          auctionEndsAt: endsAt
        }
      },
      { new: true }
    );
    if (!updated) return badRequest(res, "Auction is no longer pending");

    await recordAuctionEvent({
      auction: updated._id,
      type: "APPROVED",
      actor: req.user._id,
      actorType: "admin",
      data: { auctionStartsAt: startsAt, auctionEndsAt: endsAt }
    });

    const io = req.app.get("io");
    if (io) {
      io.emit("auction-approved", {
        auctionId: updated._id,
        title: updated.title,
        category: updated.category,
        auctionEndsAt: updated.auctionEndsAt
      });
    }

    return res.json({ success: true, auction: updated });
  } catch (err) {
    next(err);
  }
};

export const rejectAuction = async (req, res, next) => {
  try {
    // Only unmoderated listings can be rejected. A live, closed or paid
    // auction must never flip to REJECTED.
    const updated = await Auction.findOneAndUpdate(
      { _id: req.params.id, status: "PENDING" },
      { $set: { status: "REJECTED" } },
      { new: true }
    );

    if (!updated) {
      const exists = await Auction.exists({ _id: req.params.id });
      return exists
        ? badRequest(res, "Only pending auctions can be rejected")
        : res.status(StatusCodes.NOT_FOUND).json({ success: false, message: "Auction not found" });
    }

    await recordAuctionEvent({
      auction: updated._id,
      type: "REJECTED",
      actor: req.user._id,
      actorType: "admin",
      data: { reason: typeof req.body?.reason === "string" ? req.body.reason.slice(0, 500) : undefined }
    });

    return res.json({ success: true, auction: updated });
  } catch (err) {
    next(err);
  }
};
