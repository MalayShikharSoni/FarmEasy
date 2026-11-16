import { describe, it, expect } from "vitest";
import { useDatabase, createUser, createAuction, HOURS } from "./helpers.js";
import { Auction } from "../src/models/auction.model.js";
import { settleExpiredAuctions } from "../src/services/settlement.service.js";

useDatabase();

const expired = { auctionEndsAt: new Date(Date.now() - 1000) };

describe("settling expired auctions", () => {
  it("locks an expired auction to its highest bidder", async () => {
    const { user: farmer } = await createUser("farmer");
    const { user: buyer } = await createUser("buyer");
    const auction = await createAuction(farmer, { ...expired, currentHighestBidAmount: 180, currentHighestBidder: buyer._id });

    expect(await settleExpiredAuctions()).toEqual({ settledWithDeal: 1, closedWithoutBids: 0 });

    const after = await Auction.findById(auction._id);
    expect(after.status).toBe("CLOSED");
    expect(after.lockedDeal).toMatchObject({ isLocked: true, amount: 180 });
    expect(String(after.lockedDeal.buyer)).toBe(String(buyer._id));
  });

  it("closes an expired auction with no bids, without a deal", async () => {
    const { user: farmer } = await createUser("farmer");
    const auction = await createAuction(farmer, expired);

    expect(await settleExpiredAuctions()).toEqual({ settledWithDeal: 0, closedWithoutBids: 1 });
    const after = await Auction.findById(auction._id);
    expect(after.status).toBe("CLOSED");
    expect(after.lockedDeal.isLocked).toBe(false);
  });

  it("leaves running auctions alone and is safe to run again", async () => {
    const { user: farmer } = await createUser("farmer");
    const running = await createAuction(farmer, { auctionEndsAt: new Date(Date.now() + HOURS(1)) });
    await createAuction(farmer, expired);

    await settleExpiredAuctions();
    expect(await settleExpiredAuctions()).toEqual({ settledWithDeal: 0, closedWithoutBids: 0 });
    expect((await Auction.findById(running._id)).status).toBe("APPROVED");
  });

  it("settles each auction exactly once when two servers run at the same time", async () => {
    const { user: farmer } = await createUser("farmer");
    const { user: buyer } = await createUser("buyer");
    for (let i = 0; i < 5; i++) {
      await createAuction(farmer, { ...expired, currentHighestBidAmount: 100 + i, currentHighestBidder: buyer._id });
    }

    const [a, b] = await Promise.all([settleExpiredAuctions(), settleExpiredAuctions()]);
    expect(a.settledWithDeal + b.settledWithDeal).toBe(5);
  });
});
