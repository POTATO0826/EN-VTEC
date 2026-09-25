"use client";
import { useEffect, useState } from "react";
import { WORKLOAD_FEED, DEMO_TIMING, batchLabel } from "../data/mockGpuData";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./ui/card";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "./ui/table";
import { Badge } from "./ui/badge";

export default function WorkloadFeed() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(
      () => setTick((value) => (value + 1) % WORKLOAD_FEED.length),
      DEMO_TIMING.feedPulse,
    );
    return () => clearInterval(timer);
  }, []);
  return (
    <Card className="workload-feed">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle>Recent workloads</CardTitle>
          <Badge variant="outline">Mock activity</Badge>
        </div>
        <CardDescription>
          Incoming jobs for the selected hardware.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job</TableHead>
              <TableHead>Workload</TableHead>
              <TableHead>Batch size</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {WORKLOAD_FEED.map((job, index) => (
              <TableRow
                key={job.id}
                className={index === tick ? "feed-active" : ""}
              >
                <TableCell className="font-mono text-muted-foreground">
                  {job.id}
                </TableCell>
                <TableCell>{job.kernel}</TableCell>
                <TableCell className="font-mono">
                  {batchLabel(job.batch)}
                </TableCell>
                <TableCell className="text-right">
                  <Badge
                    variant="secondary"
                    className={`job-status ${job.status.toLowerCase()}`}
                  >
                    {job.status === "RUNNING" && (
                      <span className="online-dot" />
                    )}
                    {job.status.charAt(0) + job.status.slice(1).toLowerCase()}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
