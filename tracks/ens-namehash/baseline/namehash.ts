/**
 * ENS names — baseline build (single thread, JS).
 *
 * For the track's fixed list of 1,000,000 names (name0.eth … name999999.eth)
 * computes the ENS namehash (EIP-137) of each name, then SHA-256 of that
 * namehash, and folds everything into one SHA-256 root. Prints the root.
 * Any correct build prints the same root; the agent times the run.
 */
import { keccak_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha2";

const COUNT = 1_000_000;
const encoder = new TextEncoder();

// namehash("eth") = keccak(0x00…00 ‖ keccak("eth")), computed once.
const ethNode = keccak_256(new Uint8Array([...new Uint8Array(32), ...keccak_256(encoder.encode("eth"))]));

const pair = new Uint8Array(64);
pair.set(ethNode, 0);
const root = sha256.create();

for (let i = 0; i < COUNT; i++) {
  pair.set(keccak_256(encoder.encode(`name${i}`)), 32);
  const node = keccak_256(pair); // namehash(`name${i}.eth`)
  root.update(sha256(node));
}

console.log(Buffer.from(root.digest()).toString("hex"));
