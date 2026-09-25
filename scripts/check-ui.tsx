import { readFileSync, existsSync } from "node:fs";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import {
  GPUS,
  WORKLOADS,
  VARIANTS,
  BENCHMARKS,
  CHART_POINTS,
  CANDIDATES,
  ATTESTATIONS,
  DEMO_TIMING,
  speedup,
  getAttestation,
} from "../src/data/mockGpuData";

for (const gpu of GPUS) {
  for (const workload of WORKLOADS) {
    const result = BENCHMARKS[gpu.id][workload.id];
    const point = CHART_POINTS[gpu.id].find(
      (item) => item.batch === workload.batch,
    )!;
    assert.equal(point[result.variant], result.latency);
    assert.equal(point.vtec, result.latency);
    assert.equal(point.baseline, result.baseline);
    assert.equal(
      point.vtec,
      Math.min(
        ...Object.keys(VARIANTS).map(
          (key) => point[key as keyof typeof VARIANTS],
        ),
      ),
    );
    assert.ok(speedup(result) > 1);
    const proof = getAttestation(gpu.id, workload.id);
    assert.equal(proof.latency, result.latency);
    assert.equal(proof.variant, result.variant);
    assert.equal(proof.hardwareFingerprint, gpu.fingerprint);
    assert.equal(proof.simulated, true);
    const candidates = CANDIDATES[gpu.id][workload.id];
    assert.ok(
      candidates.some(
        (candidate) => !candidate.correct && candidate.verdict === "REJECTED",
      ),
    );
    assert.ok(
      candidates.some(
        (candidate) =>
          candidate.correct &&
          candidate.verdict === "REJECTED" &&
          candidate.reason.includes("noise"),
      ),
    );
    assert.ok(
      candidates
        .filter((candidate) => candidate.verdict === "ACCEPTED")
        .every((candidate) => candidate.correct),
    );
  }
  const points = CHART_POINTS[gpu.id];
  assert.ok(
    points.some(
      (point, i) =>
        i > 0 && (point.B - point.C) * (points[i - 1].B - points[i - 1].C) < 0,
    ),
    "B and C must cross",
  );
}
assert.equal(new Set(ATTESTATIONS.map((item) => item.transactionHash)).size, 6);
assert.ok(
  CHART_POINTS.rtx4060.some(
    (point, i, rows) =>
      i > 0 && (point.C - point.D) * (rows[i - 1].C - rows[i - 1].D) < 0,
  ),
  "C and D must cross on 4060",
);
assert.ok(existsSync("public/assets/MetaMask_Fox.svg.webp"));
assert.ok(
  !readFileSync("src/components/Dashboard.tsx", "utf8").match(
    /fetch\(|WebSocket|ethereum|wagmi|viem/,
  ),
);

// Exercise real React events and state in a DOM without a GPU or network.
const dom = new Window({ url: "http://localhost:3000" });
// Deterministic container size lets Recharts produce SVG in a non-layout DOM.
dom.HTMLElement.prototype.getBoundingClientRect = function () {
  return new dom.DOMRect(0, 0, 800, 222);
};
Object.assign(globalThis, {
  window: dom,
  self: dom,
  document: dom.document,
  navigator: dom.navigator,
  HTMLElement: dom.HTMLElement,
  HTMLCanvasElement: dom.HTMLCanvasElement,
  Element: dom.Element,
  Node: dom.Node,
  NodeFilter: dom.NodeFilter,
  DocumentFragment: dom.DocumentFragment,
  HTMLInputElement: dom.HTMLInputElement,
  HTMLSelectElement: dom.HTMLSelectElement,
  HTMLFormElement: dom.HTMLFormElement,
  Event: dom.Event,
  CustomEvent: dom.CustomEvent,
  KeyboardEvent: dom.KeyboardEvent,
  MutationObserver: dom.MutationObserver,
  ResizeObserver: dom.ResizeObserver,
  getComputedStyle: dom.getComputedStyle.bind(dom),
  requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
  cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
  IS_REACT_ACT_ENVIRONMENT: true,
});
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: Dashboard } = await import("../src/components/Dashboard");
const { default: DemoLayout } = await import("../src/components/DemoLayout");
const { PathnameContext } =
  await import("next/dist/shared/lib/hooks-client-context.shared-runtime.js");
const { default: ExistingShell } =
  await import("../src/components/ExistingShell");
ExistingShell.prototype.startBg = async () => {};
ExistingShell.prototype.mountOrbs = () => {};
Object.assign(dom.HTMLDialogElement.prototype, {
  showModal() {
    this.setAttribute("open", "");
  },
  close() {
    this.removeAttribute("open");
  },
});
const container = document.createElement("div");
document.body.appendChild(container);
const root = createRoot(container);
const text = (selector: string) =>
  document.querySelector(selector)?.textContent ?? "";
const click = async (selector: string) => {
  const button = document.querySelector(selector) as HTMLButtonElement | null;
  assert.ok(button, `Missing ${selector}`);
  await React.act(async () => {
    button.dispatchEvent(
      new dom.MouseEvent("mousedown", { bubbles: true, button: 0 }),
    );
    button.click();
  });
};
const delay = async (ms: number) =>
  React.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
const showPage = async (page: "overview" | "performance" | "registry") => {
  const pathname = page === "overview" ? "/" : `/${page}`;
  await React.act(async () =>
    root.render(
      <PathnameContext.Provider value={pathname}>
        <DemoLayout>
          <Dashboard key={page} page={page} />
        </DemoLayout>
      </PathnameContext.Provider>,
    ),
  );
  // The shell nav now points at the registry homepage and the project saga.
  // /performance and /registry still render, they are simply no longer linked,
  // so only the pathname the nav carries is expected to be marked current.
  const navHrefs = [...container.querySelectorAll(".console-nav a")].map((link) =>
    link.getAttribute("href"),
  );
  assert.ok(navHrefs.includes("/"), "shell nav still renders");
  assert.equal(
    container
      .querySelector('.console-nav [aria-current="page"]')
      ?.getAttribute("href"),
    navHrefs.includes(pathname) ? pathname : undefined,
  );
};
await showPage("overview");
assert.match(text(".variant-title"), /Variant B/);
assert.match(text(".dispatch-metrics"), /3.1/);
assert.match(text(".system-ribbon"), /RTX 3050/);
assert.equal(container.querySelector(".performance-panel"), null);
assert.equal(container.querySelector(".registry-panel"), null);
await click(".workload-selector button:nth-child(3)");
assert.match(text(".variant-title"), /Variant C/);
assert.match(text(".dispatch-metrics"), /10.8/);
assert.match(text(".crossover-animation"), /VTEC CROSSOVER/);
await click(".gpu-module:nth-child(2)");
assert.match(text(".system-ribbon"), /RTX 4060/);
assert.match(text('.workload-selector button[aria-selected="true"]'), /65,536/);
assert.match(text(".crossover-animation"), /Different hardware detected/);
await delay(DEMO_TIMING.scan + 20);
assert.match(text(".crossover-animation"), /VTEC CROSSOVER/);
assert.match(text(".variant-title"), /Variant D/);
assert.match(text(".dispatch-metrics"), /7.0/);
assert.match(text(".dispatch-metrics"), /3.4/);
await delay(DEMO_TIMING.crossover + 30);
assert.equal(container.querySelector(".crossover-animation"), null);
await showPage("performance");
assert.equal(container.querySelector(".dispatcher"), null);
assert.equal(container.querySelector(".registry-panel"), null);
assert.equal(container.querySelectorAll(".recharts-line-curve").length, 6);
assert.match(text(".system-ribbon"), /RTX 4060/);
assert.match(text(".system-ribbon"), /65,536/);
const pickGpuWithKeyboard = async (name: string) => {
  const trigger = document.querySelector('[aria-label="Active GPU"]') as HTMLElement;
  await React.act(async () => {
    trigger.focus();
    trigger.dispatchEvent(new dom.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  assert.ok(document.querySelector('[role="listbox"]'), 'shadcn GPU select opens');
  const option = Array.from(document.querySelectorAll('[role="option"]')).find(item => item.textContent?.includes(name));
  assert.ok(option);
  await React.act(async () => option.dispatchEvent(new dom.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
};
await pickGpuWithKeyboard('RTX 3050 Laptop');
assert.match(text('.system-ribbon'), /RTX 3050/);
await pickGpuWithKeyboard('RTX 4060');
assert.match(text('.system-ribbon'), /RTX 4060/);
await click(".discovery-toggle");
assert.equal(container.querySelectorAll(".candidate-row").length, 4);
const accordionControls = document.querySelector('.discovery-toggle')!.getAttribute('aria-controls');
assert.ok(accordionControls && document.getElementById(accordionControls), 'Accordion controls refer to the rendered content');
assert.match(text(".candidate-table"), /Output mismatch/);
assert.match(text(".candidate-table"), /noise band/);
await delay(DEMO_TIMING.pipelineStep * 7 + 50);
assert.match(text(".pipeline-status"), /Replay complete/);
await click(".discovery-content .text-button");
assert.match(text(".pipeline-status"), /Replaying/);
await showPage("registry");
assert.equal(container.querySelector(".performance-panel"), null);
assert.equal(container.querySelector(".dispatcher"), null);
await click(".attestation-panel .secondary-button");
assert.ok(document.querySelector('[role="dialog"]'));
assert.match(text(".proof-details"), /RTX 4060/);
assert.match(text(".proof-details"), /7.0 ms/);
assert.match(text(".modal-description"), /no transaction has been submitted/);
await click('[role="dialog"] [data-slot="dialog-close"]');
assert.equal(document.querySelector('[role="dialog"]'), null);
await showPage("overview");
await click(".workload-selector button:nth-child(1)");
await click(".workload-selector button:nth-child(3)");
await click(".gpu-module:nth-child(1)");
await click(".workload-selector button:nth-child(2)");
await delay(DEMO_TIMING.crossover + DEMO_TIMING.scan + 30);
assert.match(text(".variant-title"), /Variant C/);
assert.match(text(".dispatch-metrics"), /6.4/);
assert.equal(container.querySelector(".crossover-animation"), null);
await showPage("registry");
await click(".registry-table tbody tr:nth-child(2) td:nth-child(3) button");
assert.match(text(".system-ribbon"), /RTX 4060/);
await showPage("overview");
assert.match(text(".variant-title"), /Variant D/);
assert.match(text(".dispatch-metrics"), /4.2/);
await click(".console-header .hover-2");
assert.ok(container.querySelector('img[src="assets/MetaMask_Fox.svg.webp"]'));
assert.match(container.textContent ?? "", /Connect MetaMask/);
await React.act(async () => root.unmount());
await dom.happyDOM.abort();
console.log(
  "Passed: 6 consistent results, crossing curves, candidate validation, B → C → D, hardware switch, rapid selections, discovery replay, registry inspection, mock proof modal, and preserved wallet.",
);
