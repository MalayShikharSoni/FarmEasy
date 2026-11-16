import dotenv from "dotenv";

dotenv.config();

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: process.env.PORT || 5000,
  mongoUri: process.env.MONGO_URI,
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET
  },
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET
  },
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  // Normalised once here so Express CORS and Socket.IO CORS always agree.
  clientUrl: (process.env.CLIENT_URL || "http://localhost:5173").replace(/\/+$/, ""),
  settlementIntervalMs: Number(process.env.SETTLEMENT_INTERVAL_MS) || 60_000
};

// Fail fast at startup instead of crashing on the first login or payment.
// RAZORPAY_WEBHOOK_SECRET is only warned about, so the app still runs locally
// without a public webhook URL.
export const assertRequiredEnv = () => {
  const required = {
    MONGO_URI: env.mongoUri,
    JWT_ACCESS_SECRET: env.jwtAccessSecret,
    JWT_REFRESH_SECRET: env.jwtRefreshSecret,
    RAZORPAY_KEY_ID: env.razorpay.keyId,
    RAZORPAY_KEY_SECRET: env.razorpay.keySecret
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  if (!env.razorpay.webhookSecret) {
    console.warn("RAZORPAY_WEBHOOK_SECRET is not set: the Razorpay webhook will reject all events.");
  }
};
