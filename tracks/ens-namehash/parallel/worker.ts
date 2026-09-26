import { keccak_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha2";

declare const self: Worker;

// Hashes names [from, to) and returns their SHA-256(namehash) digests, in order.
self.onmessage = (e: MessageEvent<{ from: number; to: number; seed: string }>) => {
  const { from, to, seed } = e.data;
  const encoder = new TextEncoder();
  const ethNode = keccak_256(new Uint8Array([...new Uint8Array(32), ...keccak_256(encoder.encode("eth"))]));
  const pair = new Uint8Array(64);
  pair.set(ethNode, 0);
  const out = new Uint8Array((to - from) * 32);
  for (let i = from; i < to; i++) {
    pair.set(keccak_256(encoder.encode(`n${seed}-${i}`)), 32);
    out.set(sha256(keccak_256(pair)), (i - from) * 32);
  }
  self.postMessage(out, [out.buffer]);
};
