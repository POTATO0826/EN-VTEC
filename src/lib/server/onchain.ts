import "server-only";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { adminAddress, adminReady, optiOn, sui } from "./sui";

/**
 * What the Opti-On contract (move/opti_on) holds and has done, read live from
 * Sui for the On-chain page: the package, who owns the AdminCap, each
 * challenge's state, and every transaction that called it, step by step.
 */

const client = new SuiGrpcClient({ network: sui.network, baseUrl: `https://fullnode.${sui.network}.sui.io:443` });
const GRAPHQL = `https://graphql.${sui.network}.sui.io/graphql`;

export type ChainStep = { kind: string; call: string | null };
export type ChainTx = {
  digest: string;
  at: string | null;
  ok: boolean;
  sender: string;
  byPlatform: boolean;
  steps: ChainStep[];
  label: string;
  tone: "success" | "danger" | "info" | "muted";
  note: string;
};

export type ChallengeState = {
  track: string;
  id: string;
  task: string;
  gpu: string;
  priceSui: number;
  feePct: number;
  stakeSui: number;
  leader: string | null;
  leaderTuner: string | null;
  feesSui: number;
  lockedStakes: number;
  submissions: number;
};

const sui_ = (mist: unknown) => Number(mist ?? 0) / 1e9;

export async function contractState() {
  if (!optiOn.packageId) return null;
  const platform = adminReady() ? normalizeSuiAddress(adminAddress()) : null;
  const cap = optiOn.adminCapId ? await client.getObject({ objectId: optiOn.adminCapId }).catch(() => null) : null;
  const owner = (cap?.object.owner as { AddressOwner?: string } | undefined)?.AddressOwner ?? null;
  const challenges: ChallengeState[] = [];
  for (const [track, id] of Object.entries(optiOn.challenges)) {
    const res = await client.getObject({ objectId: id, include: { json: true } }).catch(() => null);
    const j = res?.object.json as Record<string, unknown> | undefined;
    if (!j) continue;
    const size = (t: unknown) => Number((t as { size?: string } | undefined)?.size ?? 0);
    challenges.push({
      track,
      id,
      task: String(j.task ?? ""),
      gpu: String(j.gpu ?? ""),
      priceSui: sui_(j.price),
      feePct: Number(j.fee_bps ?? 0) / 100,
      stakeSui: sui_(j.stake_amount),
      leader: (j.leader as string | null) ?? null,
      leaderTuner: (j.leader_tuner as string | null) ?? null,
      feesSui: sui_(j.fees),
      lockedStakes: size(j.stakes),
      submissions: size(j.tuners),
    });
  }
  return {
    network: sui.network,
    packageId: optiOn.packageId,
    adminCapId: optiOn.adminCapId,
    adminOwner: owner,
    ownerIsPlatform: !!owner && !!platform && normalizeSuiAddress(owner) === platform,
    challenges,
  };
}

/** Name a transaction by the contract functions it calls. */
function describe(calls: string[]): Pick<ChainTx, "label" | "tone" | "note"> {
  const n = calls.length;
  if (calls.includes("refund_stake")) {
    const parts = ["returns the stake", calls.includes("pay_verifiers") && "pays the verifiers", calls.includes("set_leader") && "sets #1"].filter(Boolean);
    return { label: "Settle", tone: "success", note: `One transaction ${parts.join(", ")}. ${n} contract calls, all or none.` };
  }
  if (calls.includes("slash_stake")) return { label: "Slash", tone: "danger", note: "The kernel failed verification, so its stake becomes Opti-On fees." };
  if (calls.includes("submit")) return { label: "Stake", tone: "info", note: "A tuner locks the stake with the kernel's code hash." };
  if (calls.includes("create_challenge")) return { label: "Open challenge", tone: "muted", note: "The platform opens a task for tuners." };
  if (calls.includes("buy")) return { label: "Buy", tone: "info", note: "A buyer pays for the #1 kernel; the tuner is credited, Opti-On keeps its fee." };
  if (calls.includes("claim_to")) return { label: "Claim", tone: "info", note: "Royalties paid out to the tuner's chosen wallet." };
  if (calls.includes("set_leader")) return { label: "Set #1", tone: "success", note: "A verified kernel becomes #1." };
  return { label: calls.join(" + ") || "Transaction", tone: "muted", note: "" };
}

/** Every transaction that called the contract, newest first, with its steps. */
export async function contractActivity(limit = 30): Promise<ChainTx[]> {
  if (!optiOn.packageId) return [];
  const query = `query($f: String!, $n: Int!) {
    transactions(last: $n, filter: { function: $f }) {
      nodes {
        digest
        sender { address }
        effects { status timestamp }
        kind { __typename ... on ProgrammableTransaction { commands { nodes { __typename ... on MoveCallCommand { function { name module { name } } } } } } }
      }
    }
  }`;
  const res = await fetch(GRAPHQL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { f: `${optiOn.packageId}::market`, n: limit } }),
    cache: "no-store",
  });
  const json = (await res.json()) as {
    data?: {
      transactions?: {
        nodes: {
          digest: string;
          sender?: { address: string };
          effects?: { status?: string; timestamp?: string };
          kind?: { commands?: { nodes: { __typename: string; function?: { name: string; module: { name: string } } }[] } };
        }[];
      };
    };
  };
  const platform = adminReady() ? normalizeSuiAddress(adminAddress()) : null;
  return (json.data?.transactions?.nodes ?? [])
    .map((t) => {
      const steps: ChainStep[] = (t.kind?.commands?.nodes ?? []).map((c) => ({
        kind: c.__typename.replace(/Command$/, ""),
        call: c.function ? `${c.function.module.name}::${c.function.name}` : null,
      }));
      const calls = steps.flatMap((s) => (s.call?.startsWith("market::") ? [s.call.slice(8)] : []));
      const sender = t.sender?.address ?? "";
      return {
        digest: t.digest,
        at: t.effects?.timestamp ?? null,
        ok: t.effects?.status === "SUCCESS",
        sender,
        byPlatform: !!platform && !!sender && normalizeSuiAddress(sender) === platform,
        steps,
        ...describe(calls),
      };
    })
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}
