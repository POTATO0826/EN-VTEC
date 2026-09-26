import "server-only";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Where the app keeps its files. Locally that's .data/ in the project. On
 * Vercel the deployment is read-only except /tmp, so the data lives there,
 * seeded once per instance from the .data/ files bundled with the deploy.
 * /tmp is per instance and temporary: new writes on Vercel don't persist.
 */
const BUNDLED = path.join(process.cwd(), ".data");

export const DATA_DIR = process.env.VERCEL ? "/tmp/opti-om-data" : BUNDLED;

if (process.env.VERCEL && !existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(BUNDLED)) cpSync(BUNDLED, DATA_DIR, { recursive: true });
}

export const dataPath = (...parts: string[]) => path.join(DATA_DIR, ...parts);
