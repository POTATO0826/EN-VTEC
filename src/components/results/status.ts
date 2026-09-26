import type { Status } from "@/lib/results";

/** Colour and word per status, shared by the orbs, the list and the panel. The app's status palette. */
export const STATUS: Record<Status, [color: string, label: string]> = {
  verified: ["#87bb9b", "verified"],
  pending: ["#d8b072", "pending"],
  verifying: ["#d8b072", "verifying"],
  rejected: ["#dc7777", "rejected"],
};
