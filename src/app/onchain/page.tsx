import { connection } from "next/server";
import { ArrowUpRightIcon, CrownIcon, KeyRoundIcon, LockIcon, PackageIcon } from "lucide-react";
import { PageTitle } from "@/components/ui/step";
import { contractActivity, contractState, type ChainTx } from "@/lib/server/onchain";

export const metadata = { title: "On-chain · Opti-om" };

const scan = (network: string, kind: "tx" | "object" | "account", id: string) => `https://suiscan.xyz/${network}/${kind}/${id}`;
const short = (id: string) => `${id.slice(0, 8)}…${id.slice(-6)}`;

/** Who may call each contract function (move/opti_on/sources/market.move). */
const FUNCTIONS: [string, string, string][] = [
  ["submit", "Anyone (the tuner)", "Locks the stake in the contract with the kernel's code hash."],
  ["refund_stake", "AdminCap only", "Gives the stake back to the tuner."],
  ["pay_verifiers", "AdminCap only", "Splits a payment between the verifiers who agreed. Aborts with fewer than 3."],
  ["set_leader", "AdminCap only", "Makes a verified kernel #1: every sale pays its tuner."],
  ["slash_stake", "AdminCap only", "A failed kernel's stake becomes Opti-On fees."],
  ["buy", "Anyone (the buyer)", "Pays for the #1 kernel: Opti-On keeps its fee, the rest is credited to the tuner."],
  ["claim_to", "AdminCap only", "Pays a tuner's royalties to a wallet they choose (after the World ID check)."],
];

const SETTLE_PTB = `const tx = new Transaction();
const cap = tx.object(ADMIN_CAP);   // only the platform wallet owns it
const ch  = tx.object(CHALLENGE);

// 1. give the tuner their stake back
tx.moveCall({ target: "market::refund_stake", arguments: [cap, ch, tx.pure.id(kernel)] });
// 2. pay the verifiers who agreed (the contract needs at least 3)
const [pay] = tx.splitCoins(tx.gas, [VERIFIER_PAY]);
tx.moveCall({ target: "market::pay_verifiers", arguments: [cap, pay, tx.pure.vector("address", verifiers)] });
// 3. make this kernel #1
tx.moveCall({ target: "market::set_leader", arguments: [cap, ch, tx.pure.id(kernel)] });

// One transaction: if any step aborts, Sui refuses all of them.`;

const TONES: Record<ChainTx["tone"], string> = {
  success: "border-[color-mix(in_oklab,var(--success)_50%,transparent)] text-[var(--success)]",
  danger: "border-[color-mix(in_oklab,var(--danger)_50%,transparent)] text-[var(--danger)]",
  info: "border-[color-mix(in_oklab,var(--info)_50%,transparent)] text-[var(--info)]",
  muted: "border-border text-muted-foreground",
};

export default async function OnchainPage() {
  // Live from Sui on every visit.
  await connection();
  const [state, activity] = await Promise.all([contractState().catch(() => null), contractActivity().catch(() => null)]);
  const network = state?.network ?? "testnet";

  return (
    <>
      <PageTitle
        title="On-chain"
        subtitle="Opti-om's money rules live in a Sui contract. Every stake, settlement and #1 is one programmable transaction block (PTB): all of its steps happen, or none do. Read live from Sui."
      />

      {!state ? (
        <p className="mb-10 text-sm text-[var(--warning)]">The Opti-On contract isn&apos;t configured (NEXT_PUBLIC_OPTI_ON_PACKAGE_ID in .env.local).</p>
      ) : (
        <div className="mb-10 grid gap-4 lg:grid-cols-2">
          <Card icon={<PackageIcon className="size-4" />} title="The contract">
            <Row label="Package" value={<Ext href={scan(network, "object", state.packageId)}>{short(state.packageId)}</Ext>} />
            <Row label="Module" value={<span className="vtec-num">opti_on::market</span>} />
            <Row
              label="AdminCap"
              value={state.adminCapId ? <Ext href={scan(network, "object", state.adminCapId)}>{short(state.adminCapId)}</Ext> : "—"}
            />
            <Row
              label="Owned by"
              value={
                state.adminOwner ? (
                  <Ext href={scan(network, "account", state.adminOwner)}>
                    {short(state.adminOwner)}
                    {state.ownerIsPlatform ? " · platform wallet" : ""}
                  </Ext>
                ) : (
                  "—"
                )
              }
            />
            <p className="mt-3 flex gap-2 text-sm text-muted-foreground">
              <KeyRoundIcon className="mt-0.5 size-4 shrink-0" />
              Only the AdminCap&apos;s owner can settle, slash or set #1. Sui itself refuses a transaction that uses an object
              the sender doesn&apos;t own.
            </p>
          </Card>

          {state.challenges.map((c) => (
            <Card key={c.id} icon={<CrownIcon className="size-4" />} title={`Challenge · ${c.task}`}>
              <Row label="Object" value={<Ext href={scan(network, "object", c.id)}>{short(c.id)}</Ext>} />
              <Row
                label="Current #1"
                value={
                  c.leader ? (
                    <span>
                      <span className="vtec-num">{short(c.leader)}</span> · tuner{" "}
                      {c.leaderTuner ? <Ext href={scan(network, "account", c.leaderTuner)}>{short(c.leaderTuner)}</Ext> : "—"}
                    </span>
                  ) : (
                    "none yet"
                  )
                }
              />
              <Row label="Stake" value={`${c.stakeSui} SUI · ${c.lockedStakes} locked right now`} />
              <Row label="Submissions" value={String(c.submissions)} />
              <Row label="Price / fee" value={`${c.priceSui} SUI · ${c.feePct}% to Opti-On`} />
              <Row label="Fees collected" value={`${c.feesSui} SUI (slashed stakes and sales)`} />
            </Card>
          ))}
        </div>
      )}

      <section className="mb-10">
        <h2 className="mb-1 text-lg font-medium">Transactions</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Every transaction that called the contract, newest first. Each numbered step is one command inside the same
          transaction.
        </p>
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card/60">
          {activity === null ? (
            <p className="px-5 py-4 text-sm text-[var(--warning)]">Couldn&apos;t reach Sui right now. Reload in a moment.</p>
          ) : activity.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">No transactions yet.</p>
          ) : (
            activity.map((t) => (
              <div key={t.digest} className="flex flex-col gap-2 border-b border-border/40 px-5 py-4 last:border-0 md:flex-row md:items-start md:gap-6">
                <div className="flex w-40 shrink-0 flex-col gap-1">
                  <span className={`w-fit rounded-full border px-2.5 py-0.5 text-xs ${TONES[t.tone]}`}>{t.label}</span>
                  <span className="vtec-num text-xs text-muted-foreground">
                    {t.at ? new Date(t.at).toISOString().replace("T", " ").slice(0, 19) + " UTC" : ""}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <ol className="flex flex-wrap items-center gap-1.5">
                    {t.steps.map((s, i) => (
                      <li key={i} className="flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/40 px-2 py-0.5 text-xs">
                          <span className="text-muted-foreground">{i + 1}</span>
                          <span className="vtec-num">{s.call ?? s.kind}</span>
                        </span>
                        {i < t.steps.length - 1 ? <span className="text-xs text-muted-foreground">→</span> : null}
                      </li>
                    ))}
                  </ol>
                  {t.note ? <p className="mt-1.5 text-sm text-muted-foreground">{t.note}</p> : null}
                </div>
                <div className="flex shrink-0 flex-col items-start gap-1 text-xs md:items-end">
                  <span className="text-muted-foreground">
                    by {t.byPlatform ? "platform wallet" : <span className="vtec-num">{short(t.sender)}</span>}
                    {t.ok ? "" : " · failed"}
                  </span>
                  <Ext href={scan(network, "tx", t.digest)}>{short(t.digest)}</Ext>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="mb-16 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div>
          <h2 className="mb-1 text-lg font-medium">The settle PTB</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Sent by the platform right after verifiers agree (src/lib/server/sui.ts, settleStakeOnChain). Step 2 is only
            included once at least 3 real people verified; step 3 only when the kernel beats the current #1.
          </p>
          <pre className="overflow-x-auto rounded-xl border border-border/60 bg-card/60 p-4 text-xs leading-relaxed">
            <code>{SETTLE_PTB}</code>
          </pre>
        </div>
        <div>
          <h2 className="mb-1 text-lg font-medium">Who can call what</h2>
          <p className="mb-3 text-sm text-muted-foreground">move/opti_on/sources/market.move</p>
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card/60">
            {FUNCTIONS.map(([fn, who, what]) => (
              <div key={fn} className="border-b border-border/40 px-4 py-3 last:border-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="vtec-num text-sm">{fn}</span>
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    {who.startsWith("AdminCap") ? <LockIcon className="size-3" /> : null}
                    {who}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{what}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/60 p-5">
      <h2 className="mb-3 flex items-center gap-2 font-medium">
        {icon}
        {title}
      </h2>
      <dl className="flex flex-col gap-1.5">{children}</dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="vtec-num inline-flex items-center gap-1 underline-offset-4 hover:underline">
      {children}
      <ArrowUpRightIcon className="size-3" />
    </a>
  );
}
