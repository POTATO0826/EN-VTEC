"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeftIcon, CheckIcon, ExternalLinkIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { useSessionId } from "@/lib/session";
import { explorerTx, SUI } from "@/lib/sui-tx";

type Check = { label: string; ok: boolean; detail: string };
type VerifierStory = {
  who: string;
  hardware: string;
  platform: boolean;
  source: "harness log" | "report" | "running";
  lines: string[];
  checks: Check[];
  speedup: number | null;
  pass: boolean | null;
};
type Story = {
  id: string;
  track: string;
  trackId: string;
  buildName: string;
  buildSha256: string;
  resultSha256: string;
  gpu: string;
  seconds: number;
  status: "pending" | "verifying" | "verified" | "rejected";
  speedup: number | null;
  submittedAt: string;
  settledAt: string | null;
  tuneLog: string[] | null;
  approval: { worldId: boolean; fee: { digest: string; amountSui: number } | null } | null;
  draw: { source: string } | null;
  harness: boolean;
  harnessRunning: boolean;
  quorum: number;
  verifiers: VerifierStory[];
  feeSettlement: { digest: string; recipients: number } | null;
  listing: { id: string; digest: string } | null;
  tolerance: number;
};

function useStory(id: string, sessionId: string | null) {
  const [story, setStory] = React.useState<Story | null>(null);
  const [missing, setMissing] = React.useState(false);
  React.useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    const load = async () => {
      const res = await fetch(`/api/verification/${id}?session=${sessionId}`, { cache: "no-store" });
      if (!alive) return;
      if (res.status === 404) return setMissing(true);
      if (res.ok) setStory(await res.json());
    };
    load();
    const timer = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id, sessionId]);
  return { story, missing };
}

/** How one submission was verified, stage by stage, with the real logs. */
export default function VerificationView({ id }: { id: string }) {
  const sessionId = useSessionId();
  const { story, missing } = useStory(id, sessionId);

  if (missing) {
    return (
      <>
        <Back />
        <p className="mt-6 text-sm text-muted-foreground">No submission with that id.</p>
      </>
    );
  }
  if (!story) {
    return (
      <>
        <Back />
        <div className="mt-6 h-72 animate-pulse rounded-xl border border-border/60 bg-card/40" />
      </>
    );
  }

  const decided = story.status === "verified" || story.status === "rejected";
  const passed = story.verifiers.filter((v) => v.pass).length;
  const ran = story.verifiers.filter((v) => v.source !== "running").length;
  const tune =
    story.tuneLog ??
    [
      `• build  ${story.buildName}`,
      `• code   sha256 ${story.buildSha256}`,
      `• output sha256 ${story.resultSha256}`,
      `• time   ${story.seconds.toFixed(3)} s`,
    ];

  return (
    <>
      <Back />

      <header className="mt-6 mb-10 grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div>
          <span className="text-xs tracking-[0.18em] text-muted-foreground uppercase">How it was verified · {story.track}</span>
          <h1 className="mt-2 text-3xl font-medium tracking-tight md:text-4xl">{story.buildName}</h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Your agent tuned and hashed the kernel on your GPU. Verifiers drawn at random downloaded that exact code, re-ran it
            against the generic baseline on fresh random inputs, and checked both the output and the timing themselves. Every
            line below is what the machines printed.
          </p>
        </div>
        <div className="flex items-center gap-4 md:flex-col md:items-end">
          <StatusBadge status={story.status} />
          <div className="vtec-num text-4xl leading-none font-medium md:text-5xl" style={{ color: story.status === "rejected" ? "var(--danger)" : "var(--success)" }}>
            {story.status === "verified" && story.speedup ? `${story.speedup.toFixed(2)}×` : story.status === "rejected" ? "not faster" : "…"}
          </div>
        </div>
      </header>

      <ol className="relative flex flex-col gap-12 border-l border-border/60 pl-6 md:pl-10">
        <Stage n={1} title="Tuned on your laptop" state="done">
          <Explain>
            <p>
              {story.tuneLog
                ? "The agent auto-tuned the kernel on your own GPU: it generated variants of the kernel template, checked each one's output against the baseline on a random seed, timed it, and kept the fastest correct variant."
                : "This build was submitted as it was written (no auto-tune run on record), then hashed and timed on your machine."}
            </p>
            <p>It then hashed every file, so verifiers can prove they ran exactly this code, and uploaded it.</p>
            <Facts
              rows={[
                ["GPU", story.gpu],
                ["Your run", `${story.seconds.toFixed(2)} s`],
                ["Code SHA-256", <span key="h" className="vtec-num text-xs">{story.buildSha256.slice(0, 24)}…</span>],
              ]}
            />
          </Explain>
          <Terminal title={`vtec-agent submit · ${story.trackId}`} lines={tune} />
        </Stage>

        <Stage n={2} title="Approved, paid and handed to random verifiers" state={story.draw ? "done" : "current"}>
          <Explain>
            <p>
              A verified human approved this one submission with World ID, and the {SUI.feeSui} SUI process fee went into the
              vault on Sui, to pay whoever re-runs it. Verifiers were then drawn with Sui&apos;s on-chain randomness, so nobody
              could choose friendly machines.
              {story.harness ? " The pool was small, so the platform harness (the same verifier agent on the platform's machine) stood in." : ""}
            </p>
          </Explain>
          <div className="flex flex-col gap-2 self-start">
            <Row ok={!!story.approval?.worldId} label="World ID approval" detail={story.approval?.worldId ? "approved by a verified human" : "made before approvals existed"} />
            <Row
              ok={!!story.approval?.fee}
              label={`Process fee · ${story.approval?.fee?.amountSui ?? SUI.feeSui} SUI`}
              detail={story.approval?.fee ? <TxLink digest={story.approval.fee.digest} /> : "no fee on this submission"}
            />
            <Row
              ok={!!story.draw}
              label={story.draw ? `Verifiers drawn · ${story.verifiers.map((v) => v.who).join(", ")}` : "Drawing verifiers…"}
              detail={
                !story.draw ? "waiting for the pool" : story.draw.source === "server" ? "server randomness" : <TxLink digest={story.draw.source} label="on-chain randomness" />
              }
            />
          </div>
        </Stage>

        {story.verifiers.length === 0 ? (
          <Stage n={3} title="Re-run on the verifiers' machines" state="todo">
            <Explain>
              <p>Starts once verifiers are drawn.</p>
            </Explain>
            <div />
          </Stage>
        ) : (
          story.verifiers.map((v, i) => (
            <Stage
              key={v.who}
              n={3}
              sub={story.verifiers.length > 1 ? String.fromCharCode(97 + i) : undefined}
              title={`Re-run on ${v.who === "You" ? "your" : `${v.who}'s`} machine`}
              state={v.source === "running" ? "current" : v.pass ? "done" : "failed"}
            >
              <Explain>
                {i === 0 ? (
                  <>
                    <p>How a verifier checks it:</p>
                    <ul className="flex list-disc flex-col gap-1 pl-5">
                      <li>downloads the exact files and re-checks their hash;</li>
                      <li>runs a warm-up, kept out of the timing (compilation, caches);</li>
                      <li>times baseline and build in pairs on a fresh random seed each, alternating which goes first;</li>
                      <li>compares the two outputs itself, within {story.tolerance}; it never trusts what a build prints.</li>
                    </ul>
                  </>
                ) : null}
                {v.hardware ? <p className="text-xs">{v.hardware}</p> : null}
                {v.checks.length ? (
                  <div className="flex flex-col gap-1.5">
                    <p className="font-medium text-foreground">Clearly faster means all of these:</p>
                    {v.checks.map((c) => (
                      <Row key={c.label} ok={c.ok} label={c.label} detail={c.detail} />
                    ))}
                  </div>
                ) : null}
              </Explain>
              <Terminal
                title={`vtec-agent verify · ${v.who}`}
                lines={v.lines}
                note={v.source === "harness log" ? "from the platform harness log" : v.source === "report" ? "rebuilt from this verifier's report" : "running"}
                live={v.source === "running"}
              />
            </Stage>
          ))
        )}

        <Stage n={4} title="Commit, reveal, decide" state={decided ? (story.status === "verified" ? "done" : "failed") : "todo"}>
          <Explain>
            <p>
              Each verifier first commits a hash of its report, and only reveals the report once every verifier has committed,
              so nobody can copy a peer&apos;s numbers. {story.quorum} of {story.verifiers.length || "the drawn"} verifiers had to
              agree. The process fee is then split between the verifiers who ran it, and a verified kernel is listed for sale on Sui.
            </p>
          </Explain>
          <div className="flex flex-col gap-2 self-start">
            <Row
              ok={decided ? story.status === "verified" : null}
              label={
                story.status === "verified"
                  ? `Verified at ${story.speedup?.toFixed(2)}× · ${passed} of ${story.verifiers.length} passed`
                  : story.status === "rejected"
                    ? `Rejected · ${passed} of ${story.verifiers.length} passed, ${story.quorum} needed`
                    : `${ran} of ${story.verifiers.length} reported`
              }
              detail={decided ? `decided ${new Date(story.settledAt ?? story.submittedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}` : "waiting for every verifier"}
            />
            <Row
              ok={story.feeSettlement ? true : decided ? null : null}
              label="Fee paid to the verifiers"
              detail={story.feeSettlement ? <TxLink digest={story.feeSettlement.digest} label={`split between ${story.feeSettlement.recipients}`} /> : "after the decision"}
            />
            {story.status === "verified" ? (
              <Row ok={!!story.listing} label="Listed for licensing on Sui" detail={story.listing ? <TxLink digest={story.listing.digest} /> : "listing…"} />
            ) : null}
          </div>
        </Stage>
      </ol>
    </>
  );
}

/* -------------------------------------------------------------------------- */

function Back() {
  return (
    <Link href="/verify" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
      <ArrowLeftIcon className="size-3.5" /> Verify
    </Link>
  );
}

function Stage({
  n,
  sub,
  title,
  state,
  children,
}: {
  n: number;
  sub?: string;
  title: string;
  state: "done" | "current" | "todo" | "failed";
  children: [React.ReactNode, React.ReactNode];
}) {
  const color =
    state === "done" ? "var(--success)" : state === "current" ? "var(--warning)" : state === "failed" ? "var(--danger)" : "var(--muted-foreground)";
  return (
    <li className="relative">
      <span
        className="absolute top-0 -left-[37px] inline-flex size-6 items-center justify-center rounded-full border bg-background text-xs md:-left-[53px]"
        style={{ borderColor: color, color }}
      >
        {n}
        {sub}
      </span>
      <h2 className="mb-4 text-lg font-medium">{title}</h2>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {children[0]}
        {children[1]}
      </div>
    </li>
  );
}

function Explain({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-3 text-sm text-muted-foreground">{children}</div>;
}

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt>{k}</dt>
          <dd className="text-foreground [overflow-wrap:anywhere]">{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function Row({ ok, label, detail }: { ok: boolean | null; label: string; detail: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-card/60 px-3 py-2 backdrop-blur-sm">
      <span
        className={`mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border ${
          ok === null ? "border-border text-muted-foreground" : ok ? "border-[var(--success)] text-[var(--success)]" : "border-[var(--danger)] text-[var(--danger)]"
        }`}
      >
        {ok === null ? null : ok ? <CheckIcon className="size-2.5" /> : <XIcon className="size-2.5" />}
      </span>
      <span className="min-w-0 text-sm">
        <span className="block text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">{detail}</span>
      </span>
    </div>
  );
}

function TxLink({ digest, label = "view on Sui" }: { digest: string; label?: string }) {
  return (
    <a href={explorerTx(digest)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline">
      {label} <ExternalLinkIcon className="size-3" />
    </a>
  );
}

/* -------------------------------------------------------------------------- */
/* Terminal                                                                    */
/* -------------------------------------------------------------------------- */

const GOOD = /(PASS|same output|correct(?! NO)|matches|✓[^·]*|\byes\b)/;
const BAD = /(FAIL|DIFFERENT OUTPUT|WRONG, dropped|DOES NOT match|\bNO\b|⚠[^·]*)/;
const NUM = /(\d+(?:\.\d+)?×|±\d+(?:\.\d+)?%)/;

/** One line, with pass/fail words and the headline numbers picked out. */
function Colored({ line }: { line: string }) {
  const parts = line.split(new RegExp(`${GOOD.source}|${BAD.source}|${NUM.source}`, "g")).filter((p) => p !== undefined && p !== "");
  return (
    <>
      {parts.map((p, i) =>
        BAD.test(p) && new RegExp(`^${BAD.source}$`).test(p) ? (
          <span key={i} className="text-[var(--danger)]">{p}</span>
        ) : new RegExp(`^${GOOD.source}$`).test(p) ? (
          <span key={i} className="text-[var(--success)]">{p}</span>
        ) : new RegExp(`^${NUM.source}$`).test(p) ? (
          <span key={i} className="font-semibold text-foreground">{p}</span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/** A terminal that types its lines out once it scrolls into view. */
function Terminal({ title, lines, note, live }: { title: string; lines: string[]; note?: string; live?: boolean }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [shown, setShown] = React.useState(0);
  const [started, setStarted] = React.useState(false);
  const [round, setRound] = React.useState(0);
  // Once typed out, every line shows, so a live run's new lines appear as they arrive.
  const [done, setDone] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStarted(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setStarted(true), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  React.useEffect(() => {
    if (!started) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setDone(true);
    setDone(false);
    setShown(0);
    const total = lines.length;
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= total) {
        clearInterval(timer);
        setDone(true);
      }
    }, 180);
    return () => clearInterval(timer);
    // Runs when the terminal first scrolls into view, and on Replay.
  }, [started, round]);

  const visible = done ? lines.length : Math.min(lines.length, shown);

  return (
    <div ref={ref} className="min-w-0 self-start overflow-hidden rounded-xl border border-border/70 bg-[#0b0c0f] shadow-lg">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-[#dc7777]/70" />
          <span className="size-2.5 rounded-full bg-[#d8b072]/70" />
          <span className="size-2.5 rounded-full bg-[#87bb9b]/70" />
          <span className="ml-2 truncate font-mono text-xs text-muted-foreground">{title}</span>
        </div>
        <Button variant="ghost" size="icon-xs" aria-label="Replay" onClick={() => setRound((r) => r + 1)} disabled={!started}>
          <RotateCcwIcon />
        </Button>
      </div>
      <pre className="max-h-96 overflow-auto px-4 py-3 font-mono text-[12.5px] leading-relaxed text-foreground/80">
        {lines.slice(0, visible).map((l, i) => (
          <div key={i} className="whitespace-pre-wrap">
            <Colored line={l} />
          </div>
        ))}
        {visible < lines.length || live ? <span className="animate-pulse">▍</span> : null}
      </pre>
      {note ? <div className="border-t border-border/60 px-4 py-1.5 text-[11px] text-muted-foreground">{note}</div> : null}
    </div>
  );
}
