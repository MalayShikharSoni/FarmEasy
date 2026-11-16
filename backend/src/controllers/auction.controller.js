import { StatusCodes } from "http-status-codes";
import { validationResult } from "express-validator";
import { Auction } from "../models/auction.model.js";
import { AuctionEvent } from "../models/auctionEvent.model.js";
import { env } from "../config/env.js";
import { lockHighestBid } from "../services/auction.service.js";
import { recordAuctionEvent } from "../services/auditLog.service.js";

const MAX_IMAGES = 5;
const PUBLIC_STATUSES = ["APPROVED", "CLOSED"];

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Only accept images that our own /upload endpoint put on our Cloudinary
// account, so a listing cannot point at an arbitrary third-party URL.
const isOwnCloudinaryImage = (img) =>
  img &&
  typeof img.url === "string" &&
  typeof img.publicId === "string" &&
  img.url.startsWith(`https://res.cloudinary.com/${env.cloudinary.cloudName}/`);

const isOwnerOrAdmin = (user, auction) =>
  Boolean(user) &&
  (user.role === "admin" || String(auction.farmer?._id ?? auction.farmer) === String(user._id));

export const createAuctionRequest = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .json({ success: false, message: errors.array()[0].msg, errors: errors.array() });
    }

    if (req.user.role !== "farmer") {
      return res.status(StatusCodes.FORBIDDEN).json({ success: false, message: "Only farmers can create listings" });
    }

    let images = [];
    if (req.body.images) {
      try {
        images = typeof req.body.images === "string" ? JSON.parse(req.body.images) : req.body.images;
      } catch {
        return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: "Invalid images payload" });
      }
    }
    if (!Array.isArray(images) || images.length > MAX_IMAGES || !images.every(isOwnCloudinaryImage)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: `Images must be uploaded through FarmEasy (max ${MAX_IMAGES})`
      });
    }

    if (new Date(req.body.expiresAt) <= new Date()) {
      return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: "Expiry date must be in the future" });
    }

    const auction = await Auction.create({
      farmer: req.user._id,
      title: req.body.title,
      description: req.body.description,
      category: req.body.category,
      quantity: req.body.quantity,
      unit: req.body.unit,
      location: req.body.location,
      dateOfEntry: req.body.dateOfEntry,
      expiresAt: req.body.expiresAt,
      minPrice: req.body.minPrice,
      minBidHop: req.body.minBidHop,
      images: images.map(({ url, publicId }) => ({ url, publicId })),
      status: "PENDING"
    });

    await recordAuctionEvent({
      auction: auction._id,
      type: "CREATED",
      actor: req.user._id,
      actorType: "farmer",
      data: { minPrice: auction.minPrice, minBidHop: auction.minBidHop, expiresAt: auction.expiresAt }
    });

    return res.status(StatusCodes.CREATED).json({ success: true, auction });
  } catch (err) {
    next(err);
  }
};

export const listMarketAuctions = async (req, res, next) => {
  try {
    const { q, category, minPrice, maxPrice, state } = req.query;

    // The public marketplace only ever shows moderated listings.
    const status = PUBLIC_STATUSES.includes(req.query.status) ? req.query.status : "APPROVED";
    const filter = { status };

    if (typeof category === "string" && category) filter.category = category;
    if (typeof state === "string" && state) filter["location.state"] = state;

    // Price filter uses the current highest bid if there is one, otherwise the starting price.
    if (minPrice || maxPrice) {
      filter.$expr = { $and: [] };
      const currentPrice = {
        $cond: {
          if: { $gt: ["$currentHighestBidAmount", 0] },
          then: "$currentHighestBidAmount",
          else: "$minPrice"
        }
      };
      if (minPrice) filter.$expr.$and.push({ $gte: [currentPrice, Number(minPrice)] });
      if (maxPrice) filter.$expr.$and.push({ $lte: [currentPrice, Number(maxPrice)] });
    }

    // Escape user text before using it as a regex, and cap its length, so a
    // crafted query cannot make the database do expensive backtracking.
    if (typeof q === "string" && q.trim()) {
      const pattern = escapeRegex(q.trim().slice(0, 100));
      filter.$or = [
        { title: { $regex: pattern, $options: "i" } },
        { category: { $regex: pattern, $options: "i" } }
      ];
    }

    const auctions = await Auction.find(filter)
      .populate("farmer", "name role")
      .sort({ createdAt: -1 })
      .limit(50);

    return res.json({ success: true, auctions });
  } catch (err) {
    next(err);
  }
};

export const getAuctionById = async (req, res, next) => {
  try {
    const auction = await Auction.findById(req.params.id)
      .populate("farmer", "name role")
      .populate("currentHighestBidder", "name");

    // Unmoderated (pending or rejected) listings are visible only to their
    // farmer and to admins.
    if (!auction || (!PUBLIC_STATUSES.includes(auction.status) && !isOwnerOrAdmin(req.user, auction))) {
      return res.status(StatusCodes.NOT_FOUND).json({ success: false, message: "Auction not found" });
    }

    return res.json({ success: true, auction });
  } catch (err) {
    next(err);
  }
};

export const lockDeal = async (req, res, next) => {
  try {
    const auction = await Auction.findById(req.params.id);

    if (!auction) {
      return res.status(StatusCodes.NOT_FOUND).json({ success: false, message: "Auction not found" });
    }
    if (String(auction.farmer) !== String(req.user._id)) {
      return res.status(StatusCodes.FORBIDDEN).json({ success: false, message: "Only owner farmer can lock deal" });
    }
    if (auction.lockedDeal?.isLocked || auction.status !== "APPROVED") {
      return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: "Auction is not open, deal cannot be locked" });
    }
    if (!auction.currentHighestBidder) {
      return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: "No bids placed yet" });
    }

    // The farmer locks the price they saw on screen. If a newer bid has arrived
    // since then, refuse and let them look again instead of silently locking
    // a different price.
    const hasExpected = req.body?.expectedAmount !== undefined && req.body?.expectedAmount !== null;
    const expectedAmount = hasExpected ? Number(req.body.expectedAmount) : auction.currentHighestBidAmount;
    if (!Number.isFinite(expectedAmount)) {
      return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: "Invalid expectedAmount" });
    }

    const newBidMessage = (amount) => ({
      success: false,
      message: `A new bid arrived (₹${amount}). Review it and lock again.`,
      currentHighestBidAmount: amount
    });

    if (expectedAmount !== auction.currentHighestBidAmount) {
      return res.status(StatusCodes.CONFLICT).json(newBidMessage(auction.currentHighestBidAmount));
    }

    const updated = await lockHighestBid({
      auctionId: auction._id,
      expectedAmount,
      expectedBidder: auction.currentHighestBidder,
      farmerId: req.user._id
    });

    if (!updated) {
      const latest = await Auction.findById(auction._id);
      if (latest?.status === "APPROVED" && !latest.lockedDeal?.isLocked) {
        return res.status(StatusCodes.CONFLICT).json(newBidMessage(latest.currentHighestBidAmount));
      }
      return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: "Auction is already closed" });
    }

    await recordAuctionEvent({
      auction: updated._id,
      type: "DEAL_LOCKED",
      actor: req.user._id,
      actorType: "farmer",
      data: { amount: updated.lockedDeal.amount, buyer: updated.lockedDeal.buyer }
    });

    const io = req.app.get("io");
    if (io) {
      io.to(`auction:${updated._id}`).emit("auction-closed", {
        auctionId: updated._id,
        winner: updated.lockedDeal.buyer,
        finalAmount: updated.lockedDeal.amount,
        lockedAt: updated.lockedDeal.lockedAt
      });
    }

    return res.json({ success: true, auction: updated });
  } catch (err) {
    next(err);
  }
};

// Audit trail of one auction, oldest first. Visible to the listing's farmer,
// the winning buyer, and admins.
export const getAuctionTimeline = async (req, res, next) => {
  try {
    const auction = await Auction.findById(req.params.id).select("farmer lockedDeal");
    if (!auction) {
      return res.status(StatusCodes.NOT_FOUND).json({ success: false, message: "Auction not found" });
    }

    const userId = String(req.user._id);
    const allowed =
      req.user.role === "admin" ||
      String(auction.farmer) === userId ||
      (auction.lockedDeal?.buyer && String(auction.lockedDeal.buyer) === userId);

    if (!allowed) {
      return res.status(StatusCodes.FORBIDDEN).json({ success: false, message: "Access denied" });
    }

    const events = await AuctionEvent.find({ auction: auction._id })
      .sort({ createdAt: 1, _id: 1 })
      .populate("actor", "name role")
      .lean();

    return res.json({ success: true, events });
  } catch (err) {
    next(err);
  }
};
