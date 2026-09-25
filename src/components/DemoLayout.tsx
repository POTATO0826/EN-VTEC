"use client";
import { DemoProvider } from "./DemoProvider";
import ExistingShell from "./ExistingShell";

export default function DemoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DemoProvider>
      <ExistingShell>{children}</ExistingShell>
    </DemoProvider>
  );
}
