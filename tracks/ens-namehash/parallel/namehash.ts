/**
 * ENS names — parallel build (worker threads).
 *
 * Same output as the baseline: namehash + SHA-256 for 1,000,000 names, folded
 * into one SHA-256 root in order. The per-name hashing is split across CPU
 * cores; only the final fold runs on the main thread.
 */
import { sha256 } from "@noble/hashes/sha2";
import os from "node:os";

const COUNT = 1_000_000;
const SEED = process.env.VTEC_SEED ?? "0";
const WORKERS = Math.max(1, Math.min(os.cpus().length - 1, 16));
const chunk = Math.ceil(COUNT / WORKERS);

const parts = await Promise.all(
  Array.from({ length: WORKERS }, (_, w) => {
    const from = w * chunk;
    const to = Math.min(COUNT, from + chunk);
    return new Promise<Uint8Array>((resolve, reject) => {
      const worker = new Worker(new URL("./worker.ts", import.meta.url));
      worker.onmessage = (e) => {
        resolve(e.data as Uint8Array);
        worker.terminate();
      };
      worker.onerror = reject;
      worker.postMessage({ from, to, seed: SEED });
    });
  }),
);

const root = sha256.create();
for (const digests of parts) root.update(digests);
console.log(Buffer.from(root.digest()).toString("hex"));
