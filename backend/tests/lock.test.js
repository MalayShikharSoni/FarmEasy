import { describe, it, expect } from "vitest";
import { app, request, useDatabase, createUser, createAuction } from "./helpers.js";
import { Auction } from "../src/models/auction.model.js";

useDatabase();

const bid = (auction, buyer, amount) =>
  request(app).post(`/api/auctions/${auction._id}/bids`).set(buyer.auth).send({ amount });

describe("locking a deal", () => {
  it("refuses to lock a stale price when a newer bid has arrived", async () => {
    const farmer = await createUser("farmer");
    const [buyerA, buyerB] = [await createUser("buyer"), await createUser("buyer")];
    const auction = await createAuction(farmer.user);

    await bid(auction, buyerA, 120).expect(201);
    // The farmer is looking at ₹120 on screen when buyer B bids ₹130.
    await bid(auction, buyerB, 130).expect(201);

    const res = await request(app)
      .post(`/api/auctions/${auction._id}/lock`)
      .set(farmer.auth)
      .send({ expectedAmount: 120 });

    expect(res.status).toBe(409);
    expect(res.body.currentHighestBidAmount).toBe(130);
    const after = await Auction.findById(auction._id);
    expect(after.status).toBe("APPROVED");
    expect(after.lockedDeal.isLocked).toBe(false);
  });

  it("locks the deal to the highest bidder at the price the farmer saw", async () => {
    const farmer = await createUser("farmer");
    const buyer = await createUser("buyer");
    const auction = await createAuction(farmer.user);
    await bid(auction, buyer, 150).expect(201);

    const res = await request(app)
      .post(`/api/auctions/${auction._id}/lock`)
      .set(farmer.auth)
      .send({ expectedAmount: 150 })
      .expect(200);

    expect(res.body.auction.status).toBe("CLOSED");
    expect(res.body.auction.lockedDeal).toMatchObject({ isLocked: true, amount: 150 });
    expect(String(res.body.auction.lockedDeal.buyer)).toBe(String(buyer.user._id));

    // Once locked: no second lock, and no more bids.
    await request(app).post(`/api/auctions/${auction._id}/lock`).set(farmer.auth).send({}).expect(400);
    await bid(auction, buyer, 500).expect(400);
  });

  it("never locks to a different winner when a lock and a bid race", async () => {
    const farmer = await createUser("farmer");
    const [buyerA, buyerB] = [await createUser("buyer"), await createUser("buyer")];

    for (let round = 0; round < 10; round++) {
      const auction = await createAuction(farmer.user);
      await bid(auction, buyerA, 120).expect(201);

      const [lockRes] = await Promise.all([
        request(app).post(`/api/auctions/${auction._id}/lock`).set(farmer.auth).send({ expectedAmount: 120 }),
        bid(auction, buyerB, 130)
      ]);

      const final = await Auction.findById(auction._id);
      if (lockRes.status === 200) {
        // Lock won the race: the deal and the stored highest bid must agree.
        expect(final.lockedDeal.amount).toBe(final.currentHighestBidAmount);
        expect(String(final.lockedDeal.buyer)).toBe(String(final.currentHighestBidder));
      } else {
        // Bid won the race: the lock was refused and the auction is still open.
        expect(lockRes.status).toBe(409);
        expect(final.status).toBe("APPROVED");
        expect(final.currentHighestBidAmount).toBe(130);
      }
    }
  });

  it("only the owner farmer can lock", async () => {
    const owner = await createUser("farmer");
    const other = await createUser("farmer");
    const buyer = await createUser("buyer");
    const auction = await createAuction(owner.user);
    await bid(auction, buyer, 100).expect(201);

    await request(app).post(`/api/auctions/${auction._id}/lock`).set(other.auth).send({}).expect(403);
  });
});
