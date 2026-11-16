// Seed the database with demo data for showcasing FarmEasy.
//
//   npm run seed                      asks for confirmation, then wipes and seeds
//   npm run seed -- --yes             no confirmation prompt
//   npm run seed -- --no-cloudinary   use Unsplash image URLs directly
//   npm run seed -- --ending-soon=10  the "ending soon" auction ends in 10 minutes (default 20)
//
// WARNING: this deletes ALL existing FarmEasy data in the database named by
// MONGO_URI (users, auctions, bids, payments, reviews, audit events).

import readline from "node:readline/promises";
import mongoose from "mongoose";
import { env } from "../src/config/env.js";
import { seedDatabase } from "./seedDatabase.js";
import { users, DEMO_PASSWORD } from "./data.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const match = args.find((a) => a.startsWith(`--${name}=`));
  return match ? match.split("=")[1] : fallback;
};

const main = async () => {
  if (env.nodeEnv === "production" && !flag("allow-production")) {
    throw new Error("Refusing to seed with NODE_ENV=production (pass --allow-production if you really mean it).");
  }
  if (!env.mongoUri) throw new Error("MONGO_URI is not set (backend/.env).");

  const endingSoonMinutes = Number(option("ending-soon", 20));
  if (!Number.isFinite(endingSoonMinutes) || endingSoonMinutes < 1) {
    throw new Error("--ending-soon must be a number of minutes (1 or more).");
  }

  const cloudinaryConfigured = Boolean(env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret);
  const useCloudinary = cloudinaryConfigured && !flag("no-cloudinary");

  await mongoose.connect(env.mongoUri);
  const { host, name } = mongoose.connection;

  if (!flag("yes")) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      `\nThis will DELETE all FarmEasy data in database "${name}" on ${host} and replace it with demo data.\nType "yes" to continue: `
    );
    rl.close();
    if (answer.trim().toLowerCase() !== "yes") {
      console.log("Cancelled. Nothing was changed.");
      return;
    }
  }

  const summary = await seedDatabase({ useCloudinary, endingSoonMinutes, log: (m) => console.log(m) });

  const accounts = Object.values(users);
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`
Seeded "${name}": ${summary.users} users, ${summary.auctions} auctions, ${summary.bids} bids, ${summary.payments} payments, ${summary.reviews} reviews, ${summary.events} audit events.
Images: ${summary.cloudinaryImages ? `${summary.cloudinaryImages} on Cloudinary` : "served from Unsplash"}.

Demo accounts (password for all: ${DEMO_PASSWORD})
${accounts.map((u) => `  ${pad(u.role, 7)} ${pad(u.name, 20)} ${u.email}`).join("\n")}

What is where
  Live bidding ........ "Organic Shankar-6 cotton" (4 bids), onions, apples, bananas
  First bid ........... "Jalandhar Kufri Jyoti potatoes" has no bids yet
  Ending soon ......... "Fresh winter cauliflower" ends in ${endingSoonMinutes} min, then locks automatically
  Auto-settlement ..... "Byadgi green chillies" ended just now; the API closes it within a minute of starting
  Admin approval ...... wheat and turmeric are PENDING (log in as admin)
  Pay now ............. "Karnal 1121 basmati rice" is locked to Kisan Fresh Foods, unpaid
  Completed deals ..... mangoes and tomatoes: paid and reviewed (Manjunath Gowda's profile)
`);
};

main()
  .catch((err) => {
    console.error(`Seed failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
