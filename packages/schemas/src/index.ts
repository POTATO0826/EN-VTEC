/**
 * The shared contract between every process in GPU VTEC.
 *
 * The Next.js app, the API, the identity bridge and the consumer all import
 * from here, so an id computed in one place is the same id everywhere. The
 * Solidity and Python halves live alongside and are checked against the same
 * vectors by `bun run check:vectors` (milestone M5's exit gate).
 */

export * from "./ids";
export * from "./canonical";
export * from "./evidence";
export * from "./scope";
