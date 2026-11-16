import { describe, it, expect, vi } from "vitest";

vi.mock("../src/utils/mailer.js", () => ({ sendEmail: vi.fn(async () => {}) }));

const { app, request, useDatabase, createUser, createAuction } = await import("./helpers.js");
const { sendEmail } = await import("../src/utils/mailer.js");

useDatabase();

describe("general API behaviour", () => {
  it("answers 400, not 500, for a malformed id", async () => {
    await request(app).get("/api/auctions/not-an-id").expect(400);
  });

  it("never lists unmoderated auctions on the public marketplace", async () => {
    const { user: farmer } = await createUser("farmer");
    await createAuction(farmer, { status: "PENDING", title: "Hidden" });
    await createAuction(farmer, { title: "Visible" });

    const res = await request(app).get("/api/auctions?status=PENDING").expect(200);
    expect(res.body.auctions.map((a) => a.title)).toEqual(["Visible"]);
  });

  it("treats search text literally (regex characters cannot break the query)", async () => {
    const { user: farmer } = await createUser("farmer");
    await createAuction(farmer, { title: "Tomatoes (grade A+)" });

    const res = await request(app).get(`/api/auctions?q=${encodeURIComponent("(grade A+)")}`).expect(200);
    expect(res.body.auctions).toHaveLength(1);
    await request(app).get(`/api/auctions?q=${encodeURIComponent("((((a+)+)+)+$")}`).expect(200);
  });

  it("shows a pending listing only to its farmer", async () => {
    const farmer = await createUser("farmer");
    const auction = await createAuction(farmer.user, { status: "PENDING" });

    await request(app).get(`/api/auctions/${auction._id}`).expect(404);
    await request(app).get(`/api/auctions/${auction._id}`).set(farmer.auth).expect(200);
  });

  it("lets people sign up without a phone number, and escapes names in emails", async () => {
    await request(app)
      .post("/api/auth/signup")
      .send({ name: "<b>Ravi</b>", email: "ravi@test.dev", password: "secret123", role: "farmer", phone: "" })
      .expect(201);

    const html = sendEmail.mock.calls.at(-1)[0].html;
    expect(html).toContain("&lt;b&gt;Ravi&lt;/b&gt;");
    expect(html).not.toContain("<b>Ravi</b>");
  });

  it("returns the first validation message in `message`", async () => {
    const res = await request(app).post("/api/auth/signup").send({ name: "A", email: "bad", password: "1" }).expect(400);
    expect(typeof res.body.message).toBe("string");
  });
});
