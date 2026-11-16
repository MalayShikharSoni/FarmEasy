import { describe, it, expect } from "vitest";
import { app, request, useDatabase, createUser, createAuction, HOURS } from "./helpers.js";
import { Auction } from "../src/models/auction.model.js";
import { Bid } from "../src/models/bid.model.js";

useDatabase();

// Small deterministic random generator, so a failure can be reproduced.
const seeded = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 2 ** 32;
  return seed / 2 ** 32;
};

describe("placing bids", () => {
  it("keeps the minimum-increment rule when 50 bids arrive at the same time", async () => {
    const { user: farmer } = await createUser("farmer");
    const buyers = await Promise.all([1, 2, 3, 4, 5].map(() => createUser("buyer")));
    const auction = await createAuction(farmer, { minPrice: 100, minBidHop: 10 });

    const random = seeded(42);
    const attempts = Array.from({ length: 50 }, (_, i) => ({
      buyer: buyers[i % buyers.length],
      amount: 100 + Math.floor(random() * 300)
    }));

    const responses = await Promise.all(
      attempts.map(({ buyer, amount }) =>
        request(app).post(`/api/auctions/${auction._id}/bids`).set(buyer.auth).send({ amount })
      )
    );

    const accepted = attempts
      .map((attempt, i) => ({ ...attempt, status: responses[i].status }))
      .filter((a) => a.status === 201);

    // Every rejection is a clean "too low / outbid" answer, never a crash.
    for (const res of responses) expect([201, 409]).toContain(res.status);
    expect(accepted.length).toBeGreaterThan(0);

    // Accepted bids, in increasing order, must each beat the previous one by
    // at least the increment (and the first must meet the starting price).
    const amounts = accepted.map((a) => a.amount).sort((a, b) => a - b);
    expect(amounts[0]).toBeGreaterThanOrEqual(100);
    for (let i = 1; i < amounts.length; i++) {
      expect(amounts[i] - amounts[i - 1]).toBeGreaterThanOrEqual(10);
    }

    // The stored winner is the highest accepted bid, and history matches.
    const final = await Auction.findById(auction._id);
    const top = accepted.reduce((best, a) => (a.amount > best.amount ? a : best));
    expect(final.currentHighestBidAmount).toBe(top.amount);
    expect(String(final.currentHighestBidder)).toBe(String(top.buyer.user._id));
    expect(await Bid.countDocuments({ auction: auction._id })).toBe(accepted.length);
  });

  it("never accepts two bids that are closer than the increment, even when they arrive together", async () => {
    // The exact race the old code lost: current ₹100, increment ₹10. Bids of
    // ₹110 and ₹111 both pass a check made against the old ₹100; only the
    // first may be accepted, because ₹111 is not ₹10 above ₹110.
    const { user: farmer } = await createUser("farmer");
    const [buyerA, buyerB] = [await createUser("buyer"), await createUser("buyer")];

    for (let round = 0; round < 25; round++) {
      const auction = await createAuction(farmer, {
        minPrice: 50,
        minBidHop: 10,
        currentHighestBidAmount: 100,
        currentHighestBidder: farmer._id
      });

      const [a, b] = await Promise.all([
        request(app).post(`/api/auctions/${auction._id}/bids`).set(buyerA.auth).send({ amount: 110 }),
        request(app).post(`/api/auctions/${auction._id}/bids`).set(buyerB.auth).send({ amount: 111 })
      ]);

      const acceptedCount = [a, b].filter((r) => r.status === 201).length;
      expect(acceptedCount).toBe(1);
      expect(await Bid.countDocuments({ auction: auction._id })).toBe(1);
    }
  });

  it("tells the buyer the minimum when a bid is too low", async () => {
    const { user: farmer } = await createUser("farmer");
    const buyer = await createUser("buyer");
    const auction = await createAuction(farmer, { currentHighestBidAmount: 150, currentHighestBidder: farmer._id });

    const res = await request(app).post(`/api/auctions/${auction._id}/bids`).set(buyer.auth).send({ amount: 155 });
    expect(res.status).toBe(409);
    expect(res.body.minAllowed).toBe(160);
  });

  it("rejects bids from farmers, on ended auctions and before the start", async () => {
    const farmer = await createUser("farmer");
    const buyer = await createUser("buyer");
    const live = await createAuction(farmer.user);
    const ended = await createAuction(farmer.user, { auctionEndsAt: new Date(Date.now() - 1000) });
    const future = await createAuction(farmer.user, { auctionStartsAt: new Date(Date.now() + HOURS(1)) });

    const asFarmer = await request(app).post(`/api/auctions/${live._id}/bids`).set(farmer.auth).send({ amount: 500 });
    expect(asFarmer.status).toBe(403);

    const onEnded = await request(app).post(`/api/auctions/${ended._id}/bids`).set(buyer.auth).send({ amount: 500 });
    expect(onEnded.status).toBe(400);
    expect(onEnded.body.message).toMatch(/ended/i);

    const tooEarly = await request(app).post(`/api/auctions/${future._id}/bids`).set(buyer.auth).send({ amount: 500 });
    expect(tooEarly.status).toBe(400);
    expect(tooEarly.body.message).toMatch(/not started/i);
  });

  it("returns the bid history, highest first", async () => {
    const { user: farmer } = await createUser("farmer");
    const buyer = await createUser("buyer");
    const auction = await createAuction(farmer);

    for (const amount of [100, 110, 130]) {
      await request(app).post(`/api/auctions/${auction._id}/bids`).set(buyer.auth).send({ amount }).expect(201);
    }

    const res = await request(app).get(`/api/auctions/${auction._id}/bids`).expect(200);
    expect(res.body.bids.map((b) => b.amount)).toEqual([130, 110, 100]);
    expect(res.body.bids[0].bidder.name).toBe(buyer.user.name);
  });
});
