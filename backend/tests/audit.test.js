import crypto from "crypto";
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/config/razorpay.js", () => ({
  razorpayInstance: { orders: { create: vi.fn(async ({ amount }) => ({ id: "order_flow_1", amount })) } }
}));

const { app, request, useDatabase, createUser, HOURS } = await import("./helpers.js");

useDatabase();

const image = { url: "https://res.cloudinary.com/testcloud/image/upload/v1/farmeasy/products/tomato.jpg", publicId: "farmeasy/products/tomato" };

describe("audit trail", () => {
  it("records every step of a full deal, in order", async () => {
    const farmer = await createUser("farmer");
    const admin = await createUser("admin");
    const [buyerA, buyerB] = [await createUser("buyer"), await createUser("buyer")];

    const created = await request(app)
      .post("/api/auctions")
      .set(farmer.auth)
      .send({
        title: "Organic cotton bales",
        category: "Fibre",
        quantity: 20,
        unit: "quintal",
        dateOfEntry: new Date().toISOString(),
        expiresAt: new Date(Date.now() + HOURS(72)).toISOString(),
        minPrice: 1000,
        minBidHop: 50,
        images: [image]
      })
      .expect(201);
    const id = created.body.auction._id;

    await request(app).post(`/api/admin/auctions/${id}/approve`).set(admin.auth).send({}).expect(200);
    await request(app).post(`/api/auctions/${id}/bids`).set(buyerA.auth).send({ amount: 1000 }).expect(201);
    await request(app).post(`/api/auctions/${id}/bids`).set(buyerB.auth).send({ amount: 1100 }).expect(201);
    await request(app).post(`/api/auctions/${id}/lock`).set(farmer.auth).send({ expectedAmount: 1100 }).expect(200);
    await request(app).post(`/api/auctions/${id}/payment/create-order`).set(buyerB.auth).expect(200);

    const raw = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_flow_1", order_id: "order_flow_1", amount: 110000 } } }
    });
    await request(app)
      .post("/api/payment/webhook")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest("hex"))
      .set("X-Razorpay-Event-Id", "evt_flow_1")
      .send(raw)
      .expect(200);

    const timeline = await request(app).get(`/api/auctions/${id}/timeline`).set(farmer.auth).expect(200);
    expect(timeline.body.events.map((e) => e.type)).toEqual([
      "CREATED",
      "APPROVED",
      "BID_ACCEPTED",
      "BID_ACCEPTED",
      "DEAL_LOCKED",
      "PAYMENT_CAPTURED"
    ]);
    expect(timeline.body.events[3].data.amount).toBe(1100);

    // The winning buyer can see it too; a losing buyer cannot.
    await request(app).get(`/api/auctions/${id}/timeline`).set(buyerB.auth).expect(200);
    await request(app).get(`/api/auctions/${id}/timeline`).set(buyerA.auth).expect(403);
  });

  it("refuses listing images that were not uploaded through FarmEasy", async () => {
    const farmer = await createUser("farmer");
    const res = await request(app)
      .post("/api/auctions")
      .set(farmer.auth)
      .send({
        title: "Wheat",
        category: "Grains",
        quantity: 10,
        unit: "quintal",
        dateOfEntry: new Date().toISOString(),
        expiresAt: new Date(Date.now() + HOURS(72)).toISOString(),
        minPrice: 1000,
        minBidHop: 50,
        images: [{ url: "https://evil.example/track.png", publicId: "x" }]
      });
    expect(res.status).toBe(400);
  });
});
