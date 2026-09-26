/**
 * ENS names — baseline build (single thread, JS).
 *
 * For 1,000,000 names (n<seed>-0.eth … n<seed>-999999.eth) computes the ENS
 * namehash (EIP-137) of each name, then SHA-256 of that namehash, and folds
 * everything into one SHA-256 root. Prints the root. VTEC_SEED changes the
 * names on every verification run, so a build can't hardcode the answer.
 */
import { keccak_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha2";

const COUNT = 1_000_000;
const SEED = process.env.VTEC_SEED ?? "0";
const encoder = new TextEncoder();

// namehash("eth") = keccak(0x00…00 ‖ keccak("eth")), computed once.
const ethNode = keccak_256(new Uint8Array([...new Uint8Array(32), ...keccak_256(encoder.encode("eth"))]));

const pair = new Uint8Array(64);
pair.set(ethNode, 0);
const root = sha256.create();

for (let i = 0; i < COUNT; i++) {
  pair.set(keccak_256(encoder.encode(`n${SEED}-${i}`)), 32);
  const node = keccak_256(pair); // namehash(`n${SEED}-${i}.eth`)
  root.update(sha256(node));
}

console.log(Buffer.from(root.digest()).toString("hex"));
