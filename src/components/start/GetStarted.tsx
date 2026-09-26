"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "cn";
import { CheckIcon, CopyIcon, CpuIcon, MonitorIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import SlushConnect from "@/components/sui/SlushConnect";
import { PageTitle, Step, type StepState } from "@/components/ui/step";
import WorldIdButton, { postJson } from "@/components/world/WorldIdButton";
import { TASKS } from "@/lib/catalog";
import { SUI } from "@/lib/sui-tx";
import { detectFromBrowser, type Device } from "@/lib/detect";
import { useSessionId, useSessionStatus } from "@/lib/session";

const CHOICES_KEY = "vtec.choices";

type Choices = { device: Device | null; taskId: string | null; skipWorldId?: boolean };

function useChoices() {
  const [choices, setChoices] = React.useState<Choices>({ device: null, taskId: null });
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(CHOICES_KEY);
      if (saved) setChoices(JSON.parse(saved) as Choices);
    } catch {
      /* start fresh */
    }
  }, []);
  const save = (next: Choices) => {
    setChoices(next);
    try {
      localStorage.setItem(CHOICES_KEY, JSON.stringify(next));
    } catch {
      /* not fatal */
    }
  };
  return [choices, save] as const;
}

export default function GetStarted() {
  const sessionId = useSessionId();
  const { status, refresh } = useSessionStatus(sessionId);
  const [choices, setChoices] = useChoices();
  const [editing, setEditing] = React.useState<number | null>(null);

  const done = {
    1: !!choices.device,
    2: !!choices.taskId,
    // World ID is optional: skipping it means staking SUI on each kernel instead.
    3: (!!status?.seat && !!status?.humanPass) || !!choices.skipWorldId,
    4: !!status?.agent,
  };
  const firstOpen = ([1, 2, 3, 4] as const).find((n) => !done[n]) ?? null;
  const stateOf = (n: 1 | 2 | 3 | 4): StepState =>
    editing === n || (editing === null && firstOpen === n) ? "active" : done[n] ? "done" : "locked";
  const edit = (n: number) => () => setEditing(n);

  const task = TASKS.find((t) => t.id === choices.taskId);

  return (
    <>
      <PageTitle
        title="Get started"
        subtitle="Pick your hardware and a task, prove you're human with a World ID Selfie Check, then run the Opti-om agent on your laptop."
      />

      <div className="flex flex-col gap-3">
        <Step
          n={1}
          title="Choose your hardware"
          state={stateOf(1)}
          summary={
            <EditLink onClick={edit(1)}>{choices.device?.name}</EditLink>
          }
        >
          <HardwarePicker
            agentGpus={status?.agent?.gpus ?? []}
            selected={choices.device}
            onPick={(device) => {
              setChoices({ ...choices, device });
              setEditing(null);
            }}
          />
        </Step>

        <Step
          n={2}
          title="Choose a task"
          state={stateOf(2)}
          summary={<EditLink onClick={edit(2)}>{task?.name}</EditLink>}
        >
          <TaskPicker
            selected={choices.taskId}
            onPick={(taskId) => {
              setChoices({ ...choices, taskId });
              setEditing(null);
            }}
          />
        </Step>

        <Step
          n={3}
          title="Verify you're human with World ID (optional)"
          state={stateOf(3)}
          summary={
            status?.seat ? (
              <span className="vtec-num">HumanPass · seat {status.seat.nullifier.slice(0, 10)}…</span>
            ) : choices.skipWorldId ? (
              <EditLink onClick={edit(3)}>Skipped · you stake {SUI.stakeSui} SUI per kernel instead</EditLink>
            ) : null
          }
        >
          <p className="mb-4 max-w-xl text-sm text-muted-foreground">
            Verify once here and you won&apos;t be asked again: each submission just needs the process fee. Without
            World ID you can still publish: you stake {SUI.stakeSui} SUI on each kernel, returned if it verifies (correct and clearly
            faster: at least 0.1%, beyond run-to-run noise), slashed if it doesn&apos;t.
          </p>
          {sessionId ? <HumanPassSteps sessionId={sessionId} onDone={refresh} /> : null}
          {!status?.seat ? (
            <Button
              variant="outline"
              className="mt-4 rounded-full"
              onClick={() => {
                setChoices({ ...choices, skipWorldId: true });
                setEditing(null);
              }}
            >
              Skip: stake {SUI.stakeSui} SUI per kernel instead
            </Button>
          ) : null}
        </Step>

        <Step
          n={4}
          title="Run the agent on your laptop"
          state={stateOf(4)}
          summary={status?.agent ? `${status.agent.hostname} connected` : null}
        >
          {sessionId ? <AgentPairing sessionId={sessionId} /> : null}
        </Step>
      </div>

      {firstOpen === null ? (
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[color-mix(in_oklab,var(--success)_40%,transparent)] bg-card/60 p-5">
          <div>
            <p className="font-medium">You're set up.</p>
            <p className="text-sm text-muted-foreground">
              {status?.agent?.gpus[0]?.name ?? choices.device?.name} · {task?.name} ·{" "}
              {status?.seat ? "verified human" : `no World ID, ${SUI.stakeSui} SUI stake per kernel`}
            </p>
          </div>
          <Button asChild className="rounded-full px-5">
            <Link href="/tuners">Go to Tuners</Link>
          </Button>
        </div>
      ) : null}
    </>
  );
}

function HumanPassSteps({ sessionId, onDone }: { sessionId: string; onDone: () => void }) {
  const account = useCurrentAccount();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">1. Wallet</span>
        <SlushConnect />
      </div>
      <div className={`flex items-start gap-3 transition-opacity ${account ? "" : "opacity-50"}`}>
        <span className="pt-2 text-sm text-muted-foreground">2. World ID</span>
        <WorldIdButton
          label="Verify with World ID"
          sessionId={sessionId}
          signal={account ? `sui:${account.address.toLowerCase()}` : undefined}
          disabled={!account}
          start={() => postJson("/api/world/rp-signature", {})}
          confirm={(proof) =>
            postJson("/api/world/claim-seat", { sessionId, address: account?.address, idkitResponse: proof })
          }
          onDone={() => {
            toast.success("You're verified", { description: "Your HumanPass is on Sui, in your Slush wallet." });
            onDone();
          }}
        />
      </div>
    </div>
  );
}

function EditLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-3">
      {children}
      <button type="button" onClick={onClick} className="text-xs text-foreground underline-offset-4 hover:underline">
        Change
      </button>
    </span>
  );
}

/* -------------------------------------------------------------------------- */

function HardwarePicker({
  agentGpus,
  selected,
  onPick,
}: {
  agentGpus: { name: string; memoryMb: number | null; driver: string | null }[];
  selected: Device | null;
  onPick: (device: Device) => void;
}) {
  const [browser, setBrowser] = React.useState<Device[]>([]);
  React.useEffect(() => setBrowser(detectFromBrowser()), []);

  // The agent's list is exact, so it wins over the browser's guess.
  const fromAgent: Device[] = agentGpus.map((gpu) => ({
    id: `agent:${gpu.name}`,
    name: gpu.name,
    kind: "gpu",
    source: "agent",
    detail: [gpu.memoryMb && `${Math.round(gpu.memoryMb / 1024)} GB`, gpu.driver && `driver ${gpu.driver}`]
      .filter(Boolean)
      .join(" · "),
  }));
  const devices = [
    ...fromAgent,
    ...browser.filter((b) => !fromAgent.some((a) => a.name === b.name)),
  ];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        We found these on this machine. Pick the one Opti-om should use.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {devices.map((device) => (
          <Choice
            key={device.id}
            selected={selected?.id === device.id}
            onClick={() => onPick(device)}
            icon={device.kind === "gpu" ? <MonitorIcon /> : <CpuIcon />}
            title={device.name}
            detail={device.detail}
            badge={device.source === "agent" ? "from agent" : "from browser"}
          />
        ))}
      </div>
    </div>
  );
}

function TaskPicker({ selected, onPick }: { selected: string | null; onPick: (id: string) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {TASKS.map((task) => (
        <Choice
          key={task.id}
          selected={selected === task.id}
          disabled={!task.available}
          onClick={() => onPick(task.id)}
          title={task.name}
          detail={task.detail}
          badge={task.available ? undefined : "later"}
        />
      ))}
    </div>
  );
}

function Choice({
  selected,
  disabled,
  onClick,
  icon,
  title,
  detail,
  badge,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  title: string;
  detail?: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex items-start gap-3 rounded-lg border p-4 text-left transition-colors",
        selected ? "border-primary bg-accent/60" : "border-border/70 hover:bg-accent/40",
        disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
      )}
    >
      {icon ? <span className="mt-0.5 text-muted-foreground [&>svg]:size-4">{icon}</span> : null}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2 text-sm font-medium">
          {title}
          {badge ? (
            <Badge variant="outline" className="font-normal text-muted-foreground">
              {badge}
            </Badge>
          ) : null}
        </span>
        {detail ? <span className="text-sm text-muted-foreground">{detail}</span> : null}
      </span>
      {selected ? <CheckIcon className="size-4 text-primary" /> : null}
    </button>
  );
}

function AgentPairing({ sessionId }: { sessionId: string }) {
  const [code, setCode] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/agent/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    })
      .then((res) => res.json())
      .then((data) => setCode(data.code ?? null))
      .catch(() => setCode(null));
  }, [sessionId]);

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const command = code ? `bun agent/vtec-agent.ts pair ${code} --url ${origin}` : "";

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-xl text-sm text-muted-foreground">
        The agent reads your exact GPU, runs benchmarks locally and hashes every result. Run this in the project folder:
      </p>
      <div className="flex items-center gap-2 overflow-x-auto rounded-lg border border-border/70 bg-black/40 px-4 py-3">
        <code className="vtec-num flex-1 text-sm whitespace-nowrap">{command || "Getting a pairing code…"}</code>
        {command ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Copy command"
            onClick={() => {
              navigator.clipboard.writeText(command).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
        ) : null}
      </div>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="inline-block size-2 animate-pulse rounded-full bg-[var(--warning)]" />
        Waiting for the agent to connect…
      </p>
    </div>
  );
}
