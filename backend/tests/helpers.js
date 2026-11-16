import mongoose from "mongoose";
import request from "supertest";
import { vi, beforeAll, afterAll, beforeEach } from "vitest";
import app from "../src/app.js";
import { User } from "../src/models/user.model.js";
import { Auction } from "../src/models/auction.model.js";
import { generateAccessToken } from "../src/utils/jwt.js";

export { app, request };

/** Connect once per test file and start every test from an empty database. */
export const useDatabase = () => {
  beforeAll(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    // Unique indexes (e.g. webhook event ids) must exist before tests rely on them.
    await Promise.all(Object.values(mongoose.models).map((model) => model.syncIndexes()));
  });
  beforeEach(async () => {
    const collections = await mongoose.connection.db.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
  });
  afterAll(async () => {
    await mongoose.disconnect();
  });
};

let userCounter = 0;

/** Create a verified user and return it with a ready Authorization header. */
export const createUser = async (role, name = `${role}${++userCounter}`) => {
  const user = await User.create({
    name,
    email: `${name.toLowerCase()}-${Date.now()}-${userCounter}@test.dev`,
    password: "secret123",
    role,
    isEmailVerified: true
  });
  return { user, auth: { Authorization: `Bearer ${generateAccessToken(user)}` } };
};

const HOUR = 60 * 60 * 1000;

/** Insert an auction directly in the database (bypassing the HTTP flow). */
export const createAuction = (farmer, overrides = {}) =>
  Auction.create({
    farmer: farmer._id,
    title: "Fresh tomatoes",
    category: "Vegetables",
    quantity: 100,
    unit: "kg",
    dateOfEntry: new Date(),
    expiresAt: new Date(Date.now() + 48 * HOUR),
    minPrice: 100,
    minBidHop: 10,
    status: "APPROVED",
    auctionStartsAt: new Date(Date.now() - HOUR),
    auctionEndsAt: new Date(Date.now() + 24 * HOUR),
    ...overrides
  });

export const HOURS = (n) => n * HOUR;
