/**
 * Hardware scope: what a release was measured on, and what a consumer is.
 *
 * Build plan section 2 (revised): "Every result is scoped to this exact machine:
 * GPU model, VRAM, power limit, driver, CUDA version." Section 8's consumer then
 * has to check that scope "against its own machine" before adopting anything.
 *
 * Both sides compute the hash from the same canonical string, so a consumer on a
 * different driver, a different power limit, or a different card produces a
 * different hash and declines. That is the intended behaviour, not a bug: a
 * result measured at 115 W is not a result at 35 W.
 *
 * `powerLimitW: null` is deliberately NOT treated as a wildcard. An unrecorded
 * power limit hashes to the literal string "unrecorded", so a release published
 * without one only matches a consumer that also has none - and section 8 says an
 * uncertain scope means stay on the baseline.
 */

import { keccak256, type Hex } from "viem";

export type HardwareScope = {
  gpuName: string;
  vramMb: number;
  computeCapability: string;
  driverVersion: string;
  cudaVersion: string | null;
  powerLimitW: number | null;
};

/**
 * The exact bytes both sides hash. Written out rather than JSON-stringified so
 * the field order can never depend on how an object was built.
 */
export function scopeString(scope: HardwareScope): string {
  return [
    `gpu=${scope.gpuName.trim()}`,
    `vramMb=${scope.vramMb}`,
    `cc=${scope.computeCapability}`,
    `driver=${scope.driverVersion}`,
    `cuda=${scope.cudaVersion ?? "unrecorded"}`,
    `powerLimitW=${scope.powerLimitW ?? "unrecorded"}`,
  ].join("|");
}

export function environmentScopeHash(scope: HardwareScope): Hex {
  return keccak256(new TextEncoder().encode(scopeString(scope)));
}

/** Field-by-field, so a consumer can say WHY it declined rather than just that it did. */
export function describeScopeMismatch(
  release: HardwareScope,
  local: HardwareScope,
): string[] {
  const differences: string[] = [];
  const compare = (label: string, a: unknown, b: unknown) => {
    if (String(a ?? "unrecorded") !== String(b ?? "unrecorded")) {
      differences.push(`${label}: release ${a ?? "unrecorded"}, this machine ${b ?? "unrecorded"}`);
    }
  };
  compare("gpu", release.gpuName, local.gpuName);
  compare("vram MB", release.vramMb, local.vramMb);
  compare("compute capability", release.computeCapability, local.computeCapability);
  compare("driver", release.driverVersion, local.driverVersion);
  compare("cuda", release.cudaVersion, local.cudaVersion);
  compare("power limit W", release.powerLimitW, local.powerLimitW);
  return differences;
}
