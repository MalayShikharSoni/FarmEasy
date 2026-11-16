import { describe, it, expect } from "vitest";
import { app, request, useDatabase, createUser, createAuction, HOURS } from "./helpers.js";

useDatabase();

const pending = (farmer, overrides = {}) =>
  createAuction(farmer, { status: "PENDING", auctionStartsAt: undefined, auctionEndsAt: undefined, ...overrides });

describe("admin moderation", () => {
  it("rejects an end time after the produce expires", async () => {
    const { user: farmer } = await createUser("farmer");
    const admin = await createUser("admin");
    const auction = await pending(farmer, { expiresAt: new Date(Date.now() + HOURS(24)) });

    const res = await request(app)
      .post(`/api/admin/auctions/${auction._id}/approve`)
      .set(admin.auth)
      .send({ auctionEndsAt: new Date(Date.now() + HOURS(72)).toISOString() });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/expiry/i);
  });

  it("defaults the end time to the produce expiry", async () => {
    const { user: farmer } = await createUser("farmer");
    const admin = await createUser("admin");
    const expiresAt = new Date(Date.now() + HOURS(30));
    const auction = await pending(farmer, { expiresAt });

    const res = await request(app).post(`/api/admin/auctions/${auction._id}/approve`).set(admin.auth).send({}).expect(200);
    expect(new Date(res.body.auction.auctionEndsAt).getTime()).toBe(expiresAt.getTime());
  });

  it("rejects invalid or past end times", async () => {
    const { user: farmer } = await createUser("farmer");
    const admin = await createUser("admin");
    const auction = await pending(farmer);

    await request(app).post(`/api/admin/auctions/${auction._id}/approve`).set(admin.auth).send({ auctionEndsAt: "not-a-date" }).expect(400);
    await request(app)
      .post(`/api/admin/auctions/${auction._id}/approve`)
      .set(admin.auth)
      .send({ auctionEndsAt: new Date(Date.now() - 1000).toISOString() })
      .expect(400);
  });

  it("approves only once even if two admins click together", async () => {
    const { user: farmer } = await createUser("farmer");
    const admin = await createUser("admin");
    const auction = await pending(farmer);

    const results = await Promise.all([
      request(app).post(`/api/admin/auctions/${auction._id}/approve`).set(admin.auth).send({}),
      request(app).post(`/api/admin/auctions/${auction._id}/approve`).set(admin.auth).send({})
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
  });

  it("can only reject pending listings", async () => {
    const { user: farmer } = await createUser("farmer");
    const admin = await createUser("admin");
    const live = await createAuction(farmer);
    const waiting = await pending(farmer);

    await request(app).post(`/api/admin/auctions/${live._id}/reject`).set(admin.auth).expect(400);
    const res = await request(app).post(`/api/admin/auctions/${waiting._id}/reject`).set(admin.auth).expect(200);
    expect(res.body.auction.status).toBe("REJECTED");
  });

  it("is admin-only", async () => {
    const farmer = await createUser("farmer");
    const auction = await pending(farmer.user);
    await request(app).post(`/api/admin/auctions/${auction._id}/approve`).set(farmer.auth).send({}).expect(403);
  });
});
