import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";

import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error.middleware.js";

import authRouter from "./routes/auth.routes.js";
import auctionRouter from "./routes/auction.routes.js";
import bidRouter from "./routes/bid.routes.js";
import adminRouter from "./routes/admin.routes.js";
import profileRouter from "./routes/profile.routes.js";
import reviewRouter from "./routes/review.routes.js";
import uploadRouter from "./routes/upload.routes.js";
import paymentRouter from "./routes/payment.routes.js";
import { razorpayWebhook } from "./controllers/payment.controller.js";

const app = express();

// Behind one proxy (Render/Railway etc.), so req.ip is the real client IP.
app.set("trust proxy", 1);

app.use(helmet());
if (env.nodeEnv === "development") {
  app.use(morgan("dev"));
}

// Razorpay webhook: registered BEFORE express.json() with a raw body parser,
// because its HMAC signature is computed over the exact bytes Razorpay sent.
// It is server-to-server (no browser Origin), and is authenticated by that
// signature, not by a user session.
app.post("/api/payment/webhook", express.raw({ type: "application/json", limit: "1mb" }), razorpayWebhook);

app.use(
  cors({
    origin: (origin, callback) => {
      // Requests with no Origin header (curl, server-to-server) are allowed;
      // browsers always send one for cross-site requests.
      if (!origin) return callback(null, true);
      if (origin === env.clientUrl) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true
  })
);

// The API is JSON-only (image uploads use multipart via multer). Not parsing
// urlencoded bodies means a plain cross-site HTML <form> cannot submit to it.
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

app.use("/api/auth", authRouter);

app.use("/api/auctions", auctionRouter);
app.use("/api", bidRouter);
app.use("/api/admin", adminRouter);

app.use("/api/profile", profileRouter);
app.use("/api", reviewRouter);

app.use("/api/upload", uploadRouter);
app.use("/api", paymentRouter);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

app.use(errorHandler);

export default app;
