import { inject } from "vitest";

// env.js reads process.env when it is first imported, so these must be set
// before any test imports the app.
process.env.NODE_ENV = "test";
process.env.MONGO_URI = inject("mongoUri");
process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
process.env.RAZORPAY_KEY_ID = "rzp_test_key";
process.env.RAZORPAY_KEY_SECRET = "test-razorpay-key-secret";
process.env.RAZORPAY_WEBHOOK_SECRET = "test-webhook-secret";
process.env.CLOUDINARY_CLOUD_NAME = "testcloud";
