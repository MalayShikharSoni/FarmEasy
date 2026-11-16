import { MongoMemoryServer } from "mongodb-memory-server";

// Starts one throwaway MongoDB for the whole test run (no install needed:
// mongodb-memory-server downloads a mongod binary the first time).
let mongod;

export async function setup({ provide }) {
  mongod = await MongoMemoryServer.create();
  provide("mongoUri", mongod.getUri());
}

export async function teardown() {
  await mongod?.stop();
}
