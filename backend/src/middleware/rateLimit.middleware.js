import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { env } from "../config/env.js";

// Rate limits are skipped in automated tests, which deliberately fire many
// requests in a burst.
const skip = () => env.nodeEnv === "test";

const tooMany = (message) => ({ success: false, message });

/**
 * Login, signup and password-reset endpoints. Login without a limit allows
 * password guessing; signup and forgot-password each send a real email, so
 * without a limit anyone could drain the SMTP quota.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip,
  message: tooMany("Too many attempts. Please try again in a few minutes.")
});

/**
 * Bids: keyed per logged-in user (falls back to IP), so one buyer cannot
 * flood an auction, while many buyers behind the same college or office IP
 * are not blocked together. Must run after requireAuth.
 */
export const bidLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip,
  keyGenerator: (req) => (req.user ? `user:${req.user._id}` : ipKeyGenerator(req.ip)),
  message: tooMany("You are bidding too fast. Please wait a moment.")
});

/** Image uploads cost Cloudinary storage, so cap them per user. */
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip,
  keyGenerator: (req) => (req.user ? `user:${req.user._id}` : ipKeyGenerator(req.ip)),
  message: tooMany("Upload limit reached. Please try again later.")
});
