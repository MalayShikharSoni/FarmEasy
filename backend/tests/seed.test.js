import { describe, it, expect } from "vitest";
import { app, request, useDatabase } from "./helpers.js";
import { seedDatabase } from "../seed/seedDatabase.js";
import { DEMO_PASSWORD } from "../seed/data.js";
import { Auction } from "../src/models/auction.model.js";
import { Bid } from "../src/models/bid.model.js";
import { User } from "../src/models/user.model.js";
import { settleExpiredAuctions } from "../src/services/settlement.service.js";

useDatabase();

const byTitle = (fragment) => Auction.findOne({ title: new RegExp(fragment, "i") });

describe("demo seed", () => {
  it("creates consistent demo data that the real API accepts", async () => {
    const summary = await seedDatabase({ useCloudinary: false, endingSoonMinutes: 20 });
    expect(summary).toMatchObject({ users: 10, auctions: 12, payments: 2, reviews: 2 });

    // Every seeded account can log in with the demo password.
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "ramesh.farmer@example.com", password: DEMO_PASSWORD })
      .expect(200);
    expect(login.body.user.role).toBe("farmer");

    // Stored highest bids match the bid history.
    for (const auction of await Auction.find({ status: { $ne: "PENDING" } })) {
      const top = await Bid.findOne({ auction: auction._id }).sort({ amount: -1 });
      expect(auction.currentHighestBidAmount).toBe(top ? top.amount : 0);
    }

    // The marketplace shows the open auctions, including the one that just
    // ended (until settlement runs), and none of the pending ones.
    const market = await request(app).get("/api/auctions").expect(200);
    expect(market.body.auctions).toHaveLength(7);

    // A buyer can place the first bid on the potatoes.
    const buyer = await request(app)
      .post("/api/auth/login")
      .send({ email: "anita.buyer@example.com", password: DEMO_PASSWORD })
      .expect(200);
    const potatoes = await byTitle("potatoes");
    await request(app)
      .post(`/api/auctions/${potatoes._id}/bids`)
      .set("Authorization", `Bearer ${buyer.body.accessToken}`)
      .send({ amount: 60000 })
      .expect(201);

    // The chillies auction is settled by the job, to its highest bidder.
    expect(await settleExpiredAuctions()).toEqual({ settledWithDeal: 1, closedWithoutBids: 0 });
    const chillies = await byTitle("chillies");
    expect(chillies.status).toBe("CLOSED");
    expect(chillies.lockedDeal.amount).toBe(32500);

    // The farmer with two reviewed deals has the right average.
    const manjunath = await User.findOne({ email: "manjunath.farmer@example.com" });
    expect(manjunath.totalReviews).toBe(2);
    expect(manjunath.averageRating).toBe(4.5);

    // The cotton auction's timeline tells its full story.
    const farmer = await request(app)
      .post("/api/auth/login")
      .send({ email: "ramesh.farmer@example.com", password: DEMO_PASSWORD })
      .expect(200);
    const cotton = await byTitle("cotton");
    const timeline = await request(app)
      .get(`/api/auctions/${cotton._id}/timeline`)
      .set("Authorization", `Bearer ${farmer.body.accessToken}`)
      .expect(200);
    expect(timeline.body.events.map((e) => e.type)).toEqual([
      "CREATED",
      "APPROVED",
      "BID_ACCEPTED",
      "BID_ACCEPTED",
      "BID_ACCEPTED",
      "BID_ACCEPTED"
    ]);
  });

  it("can be run again, keeping the same ids so sessions and URLs survive", async () => {
    await seedDatabase({ useCloudinary: false });
    const before = await byTitle("cotton");
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "anita.buyer@example.com", password: DEMO_PASSWORD })
      .expect(200);

    await seedDatabase({ useCloudinary: false });
    expect(await Auction.countDocuments()).toBe(12);
    expect(await User.countDocuments()).toBe(10);

    const after = await byTitle("cotton");
    expect(String(after._id)).toBe(String(before._id));
    // The token issued before the re-seed still works.
    await request(app).get("/api/auth/me").set("Authorization", `Bearer ${login.body.accessToken}`).expect(200);
  });
});
