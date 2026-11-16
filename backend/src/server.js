import http from "http";
import mongoose from "mongoose";
import { Server } from "socket.io";
import app from "./app.js";
import { env, assertRequiredEnv } from "./config/env.js";
import { connectDB } from "./config/db.js";
import { startSettlementJob } from "./services/settlement.service.js";

const start = async () => {
  assertRequiredEnv();
  await connectDB();

  const server = http.createServer(app);

  const io = new Server(server, {
    cors: {
      origin: env.clientUrl,
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  // Controllers emit events through this.
  app.set("io", io);

  io.on("connection", (socket) => {
    // Rooms are named after real auction ids only; ignore anything else.
    socket.on("join-auction", (auctionId) => {
      if (mongoose.isValidObjectId(auctionId)) socket.join(`auction:${auctionId}`);
    });

    socket.on("leave-auction", (auctionId) => {
      if (mongoose.isValidObjectId(auctionId)) socket.leave(`auction:${auctionId}`);
    });
  });

  // Close auctions whose end time has passed (see settlement.service.js).
  startSettlementJob({ intervalMs: env.settlementIntervalMs, io });

  server.listen(env.port, () => {
    console.log(`Server running on port ${env.port}`);
  });
};

start();
