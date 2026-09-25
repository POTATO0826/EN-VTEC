/**
 * Canonical identity for every evidence object.
 *
 * Build plan section 7: "Never hash differently serialized JSON in two languages
 * and expect agreement. Publish shared test vectors that Python, TypeScript, and
 * Solidity all pass."
 *
 * This file is the TypeScript half of that. `KernelReleaseRegistry.sol` is the
 * Solidity half and `packages/schemas/python/gpuvtec_ids.py` is the Python half.
 * All three are checked against `vectors.json` by `bun run check:vectors`, which
 * is milestone M5's exit gate.
 *
 * Every field here is a static ABI type - bytes32, uint8, uint64, uint256,
 * address - so `abi.encode` is exactly the concatenation of 32-byte big-endian
 * words. That is why the Python side needs no ABI library at all.
 */

import { encodeAbiParameters, keccak256, parseAbiParameters, type Hex } from "viem";

/** Bumped if the encoding of any hashed object changes. Mirrors the contract. */
export const SCHEMA_VERSION = 1n;

/** Mirrors `EIP712("GPUVTEC.KernelReleaseRegistry", "1")` in the contract. */
export const EIP712_NAME = "GPUVTEC.KernelReleaseRegistry";
export const EIP712_VERSION = "1";

export type Verdict = "none" | "accepted" | "rejected" | "inconclusive";

/** The contract stores verdicts as an enum; this is that enum's ordering. */
export const VERDICT_CODE: Record<Verdict, number> = {
  none: 0,
  accepted: 1,
  rejected: 2,
  inconclusive: 3,
};

export const REPORT_TYPEHASH = keccak256(
  new TextEncoder().encode(
    "Report(bytes32 candidateId,bytes32 policyHash,bytes32 rawSamplesDigest,bytes32 environmentDigest,uint8 verdict,uint64 observedAt)",
  ),
);

export const PROMOTION_ACTION_TYPEHASH = keccak256(
  new TextEncoder().encode(
    "PromotionAction(bytes32 projectId,uint64 configVersion,address owner,bytes32 channelHash,bytes32 candidateId,bytes32 reportHash,bytes32 policyHash,bytes32 expectedPreviousReleaseId,uint256 nonce,uint256 deadline)",
  ),
);

export const EIP712_DOMAIN_TYPEHASH = keccak256(
  new TextEncoder().encode(
    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
  ),
);

/* -------------------------------------------------------------------------- */
/* Objects                                                                     */
/* -------------------------------------------------------------------------- */

export type CandidateIdInput = {
  parentId: Hex;
  workloadHash: Hex;
  environmentScopeHash: Hex;
  sourceDigest: Hex;
  binaryDigest: Hex;
  hypothesisHash: Hex;
};

export type ReportInput = {
  candidateId: Hex;
  policyHash: Hex;
  rawSamplesDigest: Hex;
  environmentDigest: Hex;
  verdict: Verdict;
  observedAt: bigint;
};

export type PromotionActionInput = {
  projectId: Hex;
  configVersion: bigint;
  owner: Hex;
  channelHash: Hex;
  candidateId: Hex;
  reportHash: Hex;
  policyHash: Hex;
  expectedPreviousReleaseId: Hex;
  nonce: bigint;
  deadline: bigint;
};

export type ReleaseIdInput = {
  projectId: Hex;
  channelHash: Hex;
  candidateId: Hex;
  reportHash: Hex;
  previousReleaseId: Hex;
};

/* -------------------------------------------------------------------------- */
/* Derivation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * @see KernelReleaseRegistry.computeCandidateId
 *
 * Note this deliberately does not include the project id. That is the formula
 * section 7 fixes, and deviating from it here would silently break the whole
 * point of the shared vectors. The tension is documented in contracts/README.md.
 */
export function computeCandidateId(input: CandidateIdInput): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("uint256, bytes32, bytes32, bytes32, bytes32, bytes32, bytes32"),
      [
        SCHEMA_VERSION,
        input.parentId,
        input.workloadHash,
        input.environmentScopeHash,
        input.sourceDigest,
        input.binaryDigest,
        input.hypothesisHash,
      ],
    ),
  );
}

/** @see KernelReleaseRegistry.computeReportHash - the EIP-712 struct hash. */
export function computeReportHash(report: ReportInput): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("bytes32, bytes32, bytes32, bytes32, bytes32, uint8, uint64"),
      [
        REPORT_TYPEHASH,
        report.candidateId,
        report.policyHash,
        report.rawSamplesDigest,
        report.environmentDigest,
        VERDICT_CODE[report.verdict],
        report.observedAt,
      ],
    ),
  );
}

export function computePromotionStructHash(action: PromotionActionInput): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "bytes32, bytes32, uint64, address, bytes32, bytes32, bytes32, bytes32, bytes32, uint256, uint256",
      ),
      [
        PROMOTION_ACTION_TYPEHASH,
        action.projectId,
        action.configVersion,
        action.owner,
        action.channelHash,
        action.candidateId,
        action.reportHash,
        action.policyHash,
        action.expectedPreviousReleaseId,
        action.nonce,
        action.deadline,
      ],
    ),
  );
}

/**
 * The EIP-712 domain separator.
 *
 * Chain id and contract address live here, which is what stops an approval given
 * on one network or one deployment being replayed on another.
 */
export function domainSeparator(chainId: bigint, verifyingContract: Hex): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32, bytes32, bytes32, uint256, address"), [
      EIP712_DOMAIN_TYPEHASH,
      keccak256(new TextEncoder().encode(EIP712_NAME)),
      keccak256(new TextEncoder().encode(EIP712_VERSION)),
      chainId,
      verifyingContract,
    ]),
  );
}

/** `keccak256(0x1901 || domainSeparator || structHash)` - what actually gets signed. */
export function typedDataDigest(separator: Hex, structHash: Hex): Hex {
  return keccak256(`0x1901${separator.slice(2)}${structHash.slice(2)}` as Hex);
}

/** @see KernelReleaseRegistry.promotionDigest */
export function promotionDigest(
  action: PromotionActionInput,
  chainId: bigint,
  verifyingContract: Hex,
): Hex {
  return typedDataDigest(
    domainSeparator(chainId, verifyingContract),
    computePromotionStructHash(action),
  );
}

/** The digest the evaluator signs over a report. */
export function reportDigest(
  report: ReportInput,
  chainId: bigint,
  verifyingContract: Hex,
): Hex {
  return typedDataDigest(domainSeparator(chainId, verifyingContract), computeReportHash(report));
}

/** @see KernelReleaseRegistry.computeReleaseId */
export function computeReleaseId(input: ReleaseIdInput): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("uint256, bytes32, bytes32, bytes32, bytes32, bytes32"),
      [
        SCHEMA_VERSION,
        input.projectId,
        input.channelHash,
        input.candidateId,
        input.reportHash,
        input.previousReleaseId,
      ],
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** keccak256 of a UTF-8 string. Used for project ids, channels, policy labels. */
export function labelHash(label: string): Hex {
  return keccak256(new TextEncoder().encode(label));
}
