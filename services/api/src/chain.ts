/**
 * The API's read and write access to KernelReleaseRegistry.
 *
 * Build plan section 8: GPU execution, model calls, benchmarking and identity
 * tokens stay off-chain. What goes on-chain is the candidate identity, the
 * evaluator's attestation, and the authorized release - nothing else.
 *
 * The API holds a relayer key only to pay gas. It never holds the evaluator key
 * (that is the evaluator's, section 5) or the bridge key (that is the identity
 * bridge's, section 9). The owner's signature arrives from the browser wallet.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil, sepolia } from "viem/chains";

export const REGISTRY_ABI = [
  {
    type: "function",
    name: "createProject",
    stateMutability: "nonpayable",
    inputs: [
      { name: "projectId", type: "bytes32" },
      { name: "owner", type: "address" },
      { name: "evaluatorSigner", type: "address" },
      { name: "identityBridgeSigner", type: "address" },
      { name: "policyHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "registerCandidate",
    stateMutability: "nonpayable",
    inputs: [
      { name: "projectId", type: "bytes32" },
      { name: "parentId", type: "bytes32" },
      { name: "workloadHash", type: "bytes32" },
      { name: "environmentScopeHash", type: "bytes32" },
      { name: "sourceDigest", type: "bytes32" },
      { name: "binaryDigest", type: "bytes32" },
      { name: "hypothesisHash", type: "bytes32" },
      { name: "manifestHash", type: "bytes32" },
    ],
    outputs: [{ name: "candidateId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "recordReport",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "report",
        type: "tuple",
        components: [
          { name: "candidateId", type: "bytes32" },
          { name: "policyHash", type: "bytes32" },
          { name: "rawSamplesDigest", type: "bytes32" },
          { name: "environmentDigest", type: "bytes32" },
          { name: "verdict", type: "uint8" },
          { name: "observedAt", type: "uint64" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "reportHash", type: "bytes32" }],
  },
  {
    type: "function",
    name: "promoteRelease",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "action",
        type: "tuple",
        components: [
          { name: "projectId", type: "bytes32" },
          { name: "configVersion", type: "uint64" },
          { name: "owner", type: "address" },
          { name: "channelHash", type: "bytes32" },
          { name: "candidateId", type: "bytes32" },
          { name: "reportHash", type: "bytes32" },
          { name: "policyHash", type: "bytes32" },
          { name: "expectedPreviousReleaseId", type: "bytes32" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { name: "ownerSignature", type: "bytes" },
      { name: "bridgeSignature", type: "bytes" },
    ],
    outputs: [{ name: "releaseId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "revokeRelease",
    stateMutability: "nonpayable",
    inputs: [
      { name: "releaseId", type: "bytes32" },
      { name: "reasonHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getCurrentRelease",
    stateMutability: "view",
    inputs: [
      { name: "projectId", type: "bytes32" },
      { name: "channelHash", type: "bytes32" },
    ],
    outputs: [
      { name: "releaseId", type: "bytes32" },
      {
        name: "release",
        type: "tuple",
        components: [
          { name: "projectId", type: "bytes32" },
          { name: "channelHash", type: "bytes32" },
          { name: "candidateId", type: "bytes32" },
          { name: "reportHash", type: "bytes32" },
          { name: "previousReleaseId", type: "bytes32" },
          { name: "authorityDigest", type: "bytes32" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getProject",
    stateMutability: "view",
    inputs: [{ name: "projectId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "owner", type: "address" },
          { name: "evaluatorSigner", type: "address" },
          { name: "identityBridgeSigner", type: "address" },
          { name: "configVersion", type: "uint64" },
          { name: "policyHash", type: "bytes32" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getReport",
    stateMutability: "view",
    inputs: [{ name: "reportHash", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "candidateId", type: "bytes32" },
          { name: "evaluator", type: "address" },
          { name: "policyHash", type: "bytes32" },
          { name: "verdict", type: "uint8" },
          { name: "observedAt", type: "uint64" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "domainSeparator",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },

  // The custom errors, so a revert reads as "BadOwnerSignature" rather than as
  // a bare selector. Without these every refusal looks the same from the API's
  // side, and the whole point of the contract is that its refusals are specific.
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "ZeroId", inputs: [] },
  { type: "error", name: "ProjectExists", inputs: [] },
  { type: "error", name: "UnknownProject", inputs: [] },
  { type: "error", name: "UnknownCandidate", inputs: [] },
  { type: "error", name: "UnknownReport", inputs: [] },
  { type: "error", name: "UnknownRelease", inputs: [] },
  { type: "error", name: "CandidateExists", inputs: [] },
  { type: "error", name: "UnknownParent", inputs: [] },
  { type: "error", name: "ParentProjectMismatch", inputs: [] },
  { type: "error", name: "NotProjectOwner", inputs: [] },
  { type: "error", name: "BadEvaluatorSignature", inputs: [] },
  { type: "error", name: "BadOwnerSignature", inputs: [] },
  { type: "error", name: "BadBridgeSignature", inputs: [] },
  { type: "error", name: "InvalidVerdict", inputs: [] },
  { type: "error", name: "ReportNotAccepted", inputs: [] },
  { type: "error", name: "ReportCandidateMismatch", inputs: [] },
  { type: "error", name: "PolicyMismatch", inputs: [] },
  { type: "error", name: "ConfigVersionMismatch", inputs: [] },
  { type: "error", name: "OwnerMismatch", inputs: [] },
  { type: "error", name: "StalePreviousRelease", inputs: [] },
  { type: "error", name: "PermitAlreadyUsed", inputs: [] },
  { type: "error", name: "PermitExpired", inputs: [] },
  { type: "error", name: "AlreadyRevoked", inputs: [] },
  { type: "error", name: "ReportExists", inputs: [] },
] as const;

export const RELEASE_STATUS = ["none", "active", "revoked"] as const;
export type ReleaseStatusName = (typeof RELEASE_STATUS)[number];

export type ChainConfig = {
  rpcUrl: string;
  chainId: number;
  registry: Address;
  /** Pays gas only. Never an authority. */
  relayerKey: Hex | null;
};

export function publicClientFor(config: ChainConfig): PublicClient {
  const chain = config.chainId === sepolia.id ? sepolia : anvil;
  return createPublicClient({
    chain: { ...chain, id: config.chainId },
    transport: http(config.rpcUrl),
  }) as PublicClient;
}

export function walletClientFor(config: ChainConfig): WalletClient | null {
  if (!config.relayerKey) return null;
  const chain = config.chainId === sepolia.id ? sepolia : anvil;
  return createWalletClient({
    account: privateKeyToAccount(config.relayerKey),
    chain: { ...chain, id: config.chainId },
    transport: http(config.rpcUrl),
  });
}

/**
 * Simulate, send, wait, and throw on revert.
 *
 * viem's `writeContract` does not simulate, so a reverting transaction is mined
 * as a failure and the caller carries on believing it worked. That is exactly
 * the silent-divergence section 3 warns about: the API would hold a row the
 * chain has never heard of, and the failure would only surface later as an
 * unrelated "UnknownCandidate" three steps downstream.
 *
 * Simulating first turns that into an error at the point of the mistake, with
 * the contract's own custom error attached.
 */
export async function writeAndConfirm(
  publicClient: PublicClient,
  wallet: WalletClient,
  params: {
    address: Address;
    functionName: string;
    args: readonly unknown[];
  },
): Promise<Hex> {
  const { request } = await publicClient.simulateContract({
    address: params.address,
    abi: REGISTRY_ABI,
    functionName: params.functionName as never,
    args: params.args as never,
    account: wallet.account!,
  });

  const hash = await wallet.writeContract(request as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`${params.functionName} reverted onchain (tx ${hash})`);
  }
  return hash;
}

/** What the consumer and the dashboard both read. */
export async function readCurrentRelease(
  client: PublicClient,
  registry: Address,
  projectId: Hex,
  channelHash: Hex,
) {
  const [releaseId, release] = await client.readContract({
    address: registry,
    abi: REGISTRY_ABI,
    functionName: "getCurrentRelease",
    args: [projectId, channelHash],
  });

  return {
    releaseId,
    ...release,
    statusName: RELEASE_STATUS[release.status] ?? "none",
  };
}
