import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * World ID config and the seat store. Server only: RP_SIGNING_KEY must never
 * reach the browser, which is what the "server-only" import enforces.
 */

export const world = {
  appId: process.env.NEXT_PUBLIC_WLD_APP_ID ?? "",
  rpId: process.env.WLD_RP_ID ?? "",
  signingKey: process.env.RP_SIGNING_KEY ?? "",
  action: process.env.NEXT_PUBLIC_WLD_ACTION ?? "claim-tuner-seat",
  // "staging" lets you test with the World ID simulator instead of a real Orb.
  environment: (process.env.WLD_ENVIRONMENT ?? "production") as
    | "production"
    | "staging",
};

/** Names of the env vars that are missing or malformed, empty when ready. */
export function missingWorldEnv(): string[] {
  const missing: string[] = [];
  if (!world.appId.startsWith("app_")) missing.push("NEXT_PUBLIC_WLD_APP_ID (app_…)");
  if (!world.rpId.startsWith("rp_")) missing.push("WLD_RP_ID (rp_…)");
  if (!world.signingKey) missing.push("RP_SIGNING_KEY");
  return missing;
}

// One seat per human. The nullifier is scoped to this app + action, so it is
// stable for a person but says nothing about who they are. A JSON file is
// enough for the hackathon build; the registry contract is the durable copy.
const SEATS_FILE = path.join(process.cwd(), ".data", "seats.json");

type Seat = { nullifier: string; wallet: string | null; at: string };

async function readSeats(): Promise<Seat[]> {
  try {
    return JSON.parse(await readFile(SEATS_FILE, "utf8")) as Seat[];
  } catch {
    return [];
  }
}

export async function findSeat(nullifier: string) {
  const seats = await readSeats();
  return seats.find((seat) => seat.nullifier === nullifier) ?? null;
}

export async function saveSeat(seat: Seat) {
  const seats = await readSeats();
  seats.push(seat);
  await mkdir(path.dirname(SEATS_FILE), { recursive: true });
  await writeFile(SEATS_FILE, JSON.stringify(seats, null, 2));
}
