import crypto from "crypto";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { User } from "../src/models/user.model.js";
import { Auction } from "../src/models/auction.model.js";
import { Bid } from "../src/models/bid.model.js";
import { Payment } from "../src/models/payment.model.js";
import { Review } from "../src/models/review.model.js";
import { AuctionEvent } from "../src/models/auctionEvent.model.js";
import { WebhookEvent } from "../src/models/webhookEvent.model.js";
import { users as userSpecs, images as imageSpecs, buildListings, DEMO_PASSWORD } from "./data.js";

const ALL_MODELS = [User, Auction, Bid, Payment, Review, AuctionEvent, WebhookEvent];

/**
 * Same ids on every run: re-seeding keeps logged-in sessions valid (the JWT
 * holds the user id) and keeps auction URLs working, so a demo only needs a
 * page refresh after a re-seed.
 */
const stableId = (name) =>
  new mongoose.Types.ObjectId(crypto.createHash("sha1").update(`farmeasy-seed:${name}`).digest("hex").slice(0, 24));

const unsplashUrl = (id) => `https://images.unsplash.com/photo-${id}?w=1600&q=80&auto=format&fit=crop`;

/**
 * Builds a document through the Mongoose model (so schema defaults and type
 * casting apply), then returns it as a plain object with explicit timestamps.
 * Inserting through `Model.collection` keeps those timestamps exactly, so
 * seeded history (bids two days ago, a deal last month) looks real.
 */
const doc = (Model, data, createdAt, updatedAt = createdAt) => {
  const obj = new Model(data).toObject({ depopulate: true });
  return { ...obj, createdAt, updatedAt };
};

/** Fails loudly if seed data breaks a rule the real API enforces. */
const assertBidsFollowRules = (listing) => {
  let previous = 0;
  listing.bids.forEach((bid, i) => {
    const min = i === 0 ? listing.minPrice : previous + listing.minBidHop;
    if (bid.amount < min) {
      throw new Error(`Seed data error in "${listing.key}": bid ${bid.amount} is below the minimum ${min}`);
    }
    previous = bid.amount;
  });
};

/**
 * Upload each product photo to Cloudinary once (Cloudinary fetches it from
 * Unsplash itself), so seeded listings use the same image hosting as real
 * ones. Re-running the seed reuses the uploaded copies. If Cloudinary is not
 * configured or an upload fails, the listing uses the Unsplash URL directly.
 */
const resolveImages = async ({ useCloudinary, log }) => {
  const resolved = {};
  let cloudinary = null;
  if (useCloudinary) {
    ({ default: cloudinary } = await import("../src/config/cloudinary.js"));
  }

  for (const [key, spec] of Object.entries(imageSpecs)) {
    const source = unsplashUrl(spec.unsplashId);
    if (!cloudinary) {
      resolved[key] = { url: source, publicId: null };
      continue;
    }
    try {
      const result = await cloudinary.uploader.upload(source, {
        public_id: `farmeasy/seed/${key}`,
        overwrite: false,
        resource_type: "image"
      });
      resolved[key] = { url: result.secure_url, publicId: result.public_id };
    } catch (err) {
      // Cloudinary rejects with a plain object ({ error: { message } }), not an Error.
      const reason = err?.message ?? err?.error?.message ?? JSON.stringify(err);
      log(`  ! Cloudinary upload failed (${reason}); using Unsplash image URLs for the remaining photos`);
      cloudinary = null; // don't retry (and wait on) every remaining photo
      resolved[key] = { url: source, publicId: null };
    }
  }
  return resolved;
};

/**
 * Wipe every FarmEasy collection and insert the demo data.
 * Returns a summary used by the CLI and the tests.
 */
export const seedDatabase = async ({
  now = new Date(),
  useCloudinary = false,
  endingSoonMinutes = 20,
  log = () => {}
} = {}) => {
  const at = (msAgo) => new Date(now.getTime() - msAgo);
  const inFuture = (ms) => new Date(now.getTime() + ms);

  const listings = buildListings({ endingSoonMinutes });
  listings.forEach((l) => l.bids && assertBidsFollowRules(l));

  log("Clearing existing data...");
  await Promise.all(ALL_MODELS.map((Model) => Model.deleteMany({})));
  await Promise.all(ALL_MODELS.map((Model) => Model.syncIndexes()));

  log(useCloudinary ? "Uploading product photos to Cloudinary..." : "Using product photos from Unsplash...");
  const imageByKey = await resolveImages({ useCloudinary, log });

  // ----- users -----
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const userDocs = {};
  for (const [key, spec] of Object.entries(userSpecs)) {
    userDocs[key] = doc(
      User,
      { _id: stableId(`user:${key}`), ...spec, password: "placeholder", isEmailVerified: true },
      at(45 * 24 * 3600 * 1000)
    );
    // Store the bcrypt hash directly (inserting via the collection skips the
    // model's pre-save hashing hook).
    userDocs[key].password = passwordHash;
  }
  const userId = (key) => userDocs[key]._id;
  const adminId = userId("admin");

  const auctions = [];
  const bids = [];
  const payments = [];
  const reviews = [];
  const events = [];
  const event = (auction, type, when, actor, actorType, data = {}) =>
    events.push(doc(AuctionEvent, { auction, type, actor, actorType, data }, when));

  for (const listing of listings) {
    const farmerId = userId(listing.farmer);
    const createdAt = at(listing.createdAgo);
    const expiresAt = inFuture(listing.expiresIn);

    const auction = {
      _id: stableId(`auction:${listing.key}`),
      farmer: farmerId,
      title: listing.title,
      description: listing.description,
      category: listing.category,
      quantity: listing.quantity,
      unit: listing.unit,
      location: listing.location,
      images: [imageByKey[listing.key]],
      dateOfEntry: createdAt,
      expiresAt,
      minPrice: listing.minPrice,
      minBidHop: listing.minBidHop,
      status: "PENDING",
      currentHighestBidAmount: 0,
      lockedDeal: { isLocked: false, isPaid: false }
    };
    const auctionDoc = doc(Auction, auction, createdAt);
    const auctionId = auctionDoc._id;

    event(auctionId, "CREATED", createdAt, farmerId, "farmer", {
      minPrice: listing.minPrice,
      minBidHop: listing.minBidHop,
      expiresAt
    });

    if (!listing.pending) {
      const approvedAt = at(listing.approvedAgo);
      const endsAt = inFuture(listing.endsIn);
      Object.assign(auctionDoc, {
        status: "APPROVED",
        approvedBy: adminId,
        approvedAt,
        auctionStartsAt: approvedAt,
        auctionEndsAt: endsAt
      });
      event(auctionId, "APPROVED", approvedAt, adminId, "admin", { auctionStartsAt: approvedAt, auctionEndsAt: endsAt });

      for (const bid of listing.bids) {
        const bidAt = at(bid.ago);
        bids.push(doc(Bid, { auction: auctionId, bidder: userId(bid.buyer), amount: bid.amount }, bidAt));
        event(auctionId, "BID_ACCEPTED", bidAt, userId(bid.buyer), "buyer", { amount: bid.amount });
      }

      const top = listing.bids.at(-1);
      if (top) {
        auctionDoc.currentHighestBidAmount = top.amount;
        auctionDoc.currentHighestBidder = userId(top.buyer);
      }

      if (listing.lock) {
        const lockedAt = at(listing.lock.ago);
        auctionDoc.status = "CLOSED";
        auctionDoc.lockedDeal = { isLocked: true, lockedAt, buyer: userId(top.buyer), amount: top.amount, isPaid: false, paidAt: null };
        if (listing.lock.by === "farmer") {
          event(auctionId, "DEAL_LOCKED", lockedAt, farmerId, "farmer", { amount: top.amount, buyer: userId(top.buyer) });
        } else {
          event(auctionId, "AUTO_SETTLED", lockedAt, null, "system", { amount: top.amount, buyer: userId(top.buyer) });
        }
      }

      if (listing.payment) {
        const paidAt = at(listing.payment.ago);
        const razorpayOrderId = `order_seed_${listing.key}`;
        const razorpayPaymentId = `pay_seed_${listing.key}`;
        auctionDoc.lockedDeal.isPaid = true;
        auctionDoc.lockedDeal.paidAt = paidAt;
        payments.push(
          doc(
            Payment,
            {
              auction: auctionId,
              buyer: userId(top.buyer),
              farmer: farmerId,
              amount: top.amount,
              razorpayOrderId,
              razorpayPaymentId,
              status: "SUCCESS",
              paidAt,
              capturedVia: listing.payment.via
            },
            paidAt
          )
        );
        const viaCheckout = listing.payment.via === "checkout";
        event(auctionId, "PAYMENT_CAPTURED", paidAt, viaCheckout ? userId(top.buyer) : null, viaCheckout ? "buyer" : "razorpay", {
          amount: top.amount,
          razorpayOrderId,
          razorpayPaymentId,
          via: listing.payment.via
        });
      }

      if (listing.review) {
        reviews.push(
          doc(
            Review,
            {
              auction: auctionId,
              farmer: farmerId,
              buyer: userId(top.buyer),
              rating: listing.review.rating,
              comment: listing.review.comment
            },
            at(listing.review.ago)
          )
        );
      }
    }

    auctions.push(auctionDoc);
  }

  // Farmer rating aggregates, computed the same way the review endpoint does.
  for (const [key, user] of Object.entries(userDocs)) {
    const mine = reviews.filter((r) => String(r.farmer) === String(user._id));
    if (mine.length) {
      user.totalReviews = mine.length;
      user.averageRating = mine.reduce((sum, r) => sum + r.rating, 0) / mine.length;
    }
    userDocs[key] = user;
  }

  log("Inserting demo data...");
  await User.collection.insertMany(Object.values(userDocs));
  await Auction.collection.insertMany(auctions);
  if (bids.length) await Bid.collection.insertMany(bids);
  if (payments.length) await Payment.collection.insertMany(payments);
  if (reviews.length) await Review.collection.insertMany(reviews);
  if (events.length) await AuctionEvent.collection.insertMany(events);

  return {
    users: Object.keys(userDocs).length,
    auctions: auctions.length,
    bids: bids.length,
    payments: payments.length,
    reviews: reviews.length,
    events: events.length,
    cloudinaryImages: Object.values(imageByKey).filter((img) => img.publicId).length
  };
};
