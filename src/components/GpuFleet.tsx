import { Check, Cpu } from "lucide-react";
import { GPUS, type GpuId } from "../data/mockGpuData";
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

export default function GpuFleet({
  selected,
  onSelect,
}: {
  selected: GpuId;
  onSelect: (id: GpuId) => void;
}) {
  const active = GPUS.find((item) => item.id === selected)!;
  return (
    <Card className="fleet-panel" aria-label="GPU Fleet">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>GPU fleet</CardTitle>
          <Badge variant="secondary">{GPUS.length} online</Badge>
        </div>
        <CardDescription>Select hardware to compare results.</CardDescription>
      </CardHeader>
      <CardContent className="fleet-content">
        <div className="fleet-list">
          {GPUS.map((gpu) => (
            <Button
              key={gpu.id}
              variant="ghost"
              aria-pressed={selected === gpu.id}
              onClick={() => onSelect(gpu.id)}
              className={`gpu-module ${selected === gpu.id ? "selected" : ""}`}
            >
              <span className="device-icon">
                <Cpu size={19} />
              </span>
              <span className="gpu-copy">
                <strong>{gpu.name}</strong>
                <small>
                  {gpu.vram} GB VRAM <span>·</span> {gpu.sm} SM
                </small>
              </span>
              {selected === gpu.id && <Check className="gpu-check" size={16} />}
            </Button>
          ))}
        </div>
        <Separator className="my-6" />
        <div className="fleet-telemetry">
          <div>
            <span>Architecture</span>
            <span>
              {active.architecture
                .toLowerCase()
                .replace(/\b\w/g, (c) => c.toUpperCase())}
            </span>
          </div>
          <div>
            <span>Temperature</span>
            <span>{active.temperature}°C</span>
          </div>
          <div>
            <span>Power draw</span>
            <span>{active.power} W</span>
          </div>
        </div>
        <p className="fleet-footnote">
          <span className="online-dot" /> Online{" "}
          <span>Simulated telemetry</span>
        </p>
      </CardContent>
    </Card>
  );
}
