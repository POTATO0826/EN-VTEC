"use client";
import { useRef } from "react";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import {
  GPUS,
  WORKLOADS,
  shortHash,
  batchLabel,
  type Attestation,
} from "../data/mockGpuData";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";

export function AttestationModal({
  attestation,
  onClose,
}: {
  attestation: Attestation;
  onClose: () => void;
}) {
  const returnFocus = useRef(
    typeof document === "undefined"
      ? null
      : (document.activeElement as HTMLElement | null),
  );
  const gpu = GPUS.find((item) => item.id === attestation.gpu)!;
  const workload = WORKLOADS.find((item) => item.id === attestation.workload)!;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="attestation-dialog"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Attestation details</DialogTitle>
          <DialogDescription className="modal-description">
            This is a mock attestation; no transaction has been submitted.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-muted-foreground font-mono">
            {attestation.id}
          </span>
          <Badge variant="secondary">
            <ShieldCheck size={12} /> Simulated record
          </Badge>
        </div>
        <dl className="proof-details">
          <div>
            <dt>Hardware</dt>
            <dd>{gpu.fullName}</dd>
          </div>
          <div>
            <dt>Workload</dt>
            <dd>SHA-256 / {batchLabel(workload.batch)}</dd>
          </div>
          <div>
            <dt>Selected kernel</dt>
            <dd>Variant {attestation.variant}</dd>
          </div>
          <div>
            <dt>Benchmark</dt>
            <dd>{attestation.latency.toFixed(1)} ms</dd>
          </div>
          <div>
            <dt>Hardware fingerprint</dt>
            <dd>{attestation.hardwareFingerprint}</dd>
          </div>
          <div>
            <dt>Variant hash</dt>
            <dd>{attestation.variantHash}</dd>
          </div>
          <div>
            <dt>Transaction (mock)</dt>
            <dd>{attestation.transactionHash}</dd>
          </div>
          <div>
            <dt>Block (mock)</dt>
            <dd>{attestation.block}</dd>
          </div>
          <div>
            <dt>Recorded at</dt>
            <dd>{attestation.recordedAt}</dd>
          </div>
        </dl>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AttestationPanel({
  attestation,
  onView,
}: {
  attestation: Attestation;
  onView: () => void;
}) {
  return (
    <Card className="attestation-panel" aria-labelledby="proof-title">
      <CardHeader>
        <div className="flex justify-between items-center gap-4">
          <CardTitle id="proof-title">Attestation</CardTitle>
          <Badge variant="outline">Mock</Badge>
        </div>
        <CardDescription>Proof record for the selected result.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="attestation-summary">
          <div>
            <dt>Status</dt>
            <dd>
              <Badge variant="secondary">
                <span className="online-dot" /> Attested
              </Badge>
            </dd>
          </div>
          <div>
            <dt>Selected kernel</dt>
            <dd>Variant {attestation.variant}</dd>
          </div>
          <div>
            <dt>Benchmark</dt>
            <dd>{attestation.latency.toFixed(1)} ms</dd>
          </div>
          <div>
            <dt>Hardware</dt>
            <dd>{shortHash(attestation.hardwareFingerprint)}</dd>
          </div>
          <div>
            <dt>Variant hash</dt>
            <dd>{shortHash(attestation.variantHash)}</dd>
          </div>
          <div>
            <dt>Transaction</dt>
            <dd>{shortHash(attestation.transactionHash)}</dd>
          </div>
        </dl>
        <Separator className="my-6" />
        <Button
          variant="outline"
          className="secondary-button w-full"
          onClick={onView}
        >
          View attestation <ArrowUpRight size={14} />
        </Button>
        <p className="proof-disclaimer">
          Presentation only. No onchain transaction.
        </p>
      </CardContent>
    </Card>
  );
}
