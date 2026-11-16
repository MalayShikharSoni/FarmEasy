import { Router } from "express";
import { body } from "express-validator";
import { requireAuth } from "../middleware/auth.middleware.js";
import { bidLimiter } from "../middleware/rateLimit.middleware.js";
import { placeBid, listBids } from "../controllers/bid.controller.js";

const router = Router();

router.get("/auctions/:id/bids", listBids);

router.post(
  "/auctions/:id/bids",
  requireAuth,
  bidLimiter,
  [body("amount").isNumeric().withMessage("amount must be number")],
  placeBid
);

export default router;
