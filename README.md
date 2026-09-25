# GPU VTEC

GPU VTEC finds which version of a GPU program runs fastest on each specific graphics card at each job size, proves the measurement was not faked, and applies the winner automatically.

Next.js App Router, TypeScript, shadcn/ui, Tailwind CSS, Recharts, React Flow and Lucide on Bun; Solidity and Foundry for the registry; Bun + SQLite for the services.

The dashboard alone still runs with nothing else:

```sh
bun install
bun run dev
```

Open **http://127.0.0.1:3000**. No environment variables, accounts, GPU or network services are needed — the pages render typed fixtures and the System panel says so out loud.

For the full stack (chain, API, identity bridge, consumer) see **[services/README.md](services/README.md)**:

```sh
anvil                                            # terminal 1
cd contracts && forge script script/Lifecycle.s.sol   --rpc-url http://127.0.0.1:8545 --broadcast    # deploy the registry
cp .env.example .env                             # set GPUVTEC_REGISTRY
bun run bridge && bun run api && bun run dev && bun run consumer
```

## Layout

| Directory | What it is |
| --- | --- |
| `src/` | the Next.js dashboard |
| `contracts/` | `KernelReleaseRegistry` — three authorities to publish, plus revocation |
| `packages/schemas/` | the ids, canonical JSON and hardware scope every process shares, in TypeScript **and** Python, checked against Solidity |
| `services/api/` | jobs, candidates, reports, release proposals, SSE progress |
| `services/identity-bridge/` | the permit key, and nothing else |
| `runtime/consumer/` | the separate process that adopts a release or falls back |
| `artifacts/spike/` | where the crossover spike's measurements go |

## Vocabulary

- **task** — the workload being benchmarked (`sha256`)
- **variant** — one implementation of that task, always named in full: "variant D — full unroll"
- **baseline** — the reference variant everything is compared against
- **job size** — how many messages are processed in one call, always written as a real number
- **noise band** — how much the same code's timing varies run to run, measured per machine
- **registry** — which variant won, per job size, scoped to the exact machine it was measured on
- **dispatcher** — the runtime piece that reads the registry and picks a variant per job
- **plan** — the test rules, hashed and committed onchain before any test runs

GPU VTEC is not a marketplace. It never supplies or routes work; jobs arrive from the operator's own prover.

## Routes

| Route | What it is |
| --- | --- |
| `/` | Registry dashboard — summary strip, recent results, GPU registry, local projects. Fully usable with no wallet, no GPU and no account. |
| `/projects/new` | The registration saga: nine stages, one screen each, resumable after a refresh. |
| `/results/[id]?tab=overview` | Result dashboard: committed plan strip, KPIs, latency chart, dispatcher, candidates, network registry. |
| `/results/[id]?tab=pipeline` | The pipeline canvas — an infinite node network that is the live run monitor and the permanent audit trail, same component. Pan, zoom, drag modules, and watch an agent travel the wires. |
| `/results/[id]?tab=plan` | The committed plan, its hashes, and browser-side verification. |

`/performance` and `/registry` still serve the previous dashboard. They are no longer linked from the shell nav and can be removed.

## Walkthrough

1. **`/`** — four summary tiles, then the completed sweep. Note that the winner changes with the job size; that is the whole argument for having a registry, a dispatcher and verification at all. This is a single-laptop build (RTX 4060 Laptop, 8 GB), so there is no cross-hardware claim anywhere: a release is scoped to the machine it was measured on, and other machines contribute their own.
2. **RTX 5070 Ti result** — the overview opens with the test plan that produced the numbers. The latency chart shows variant B winning at 65,536 messages and variant D winning at 2,097,152: a real crossover, not a ranking.
3. **Candidates on that run** — variant C failed correctness and was never timed; variant B was correct but gained 1.2% against a 3.1% noise band; variant E was slower. The rejections are why the accepted 2.20× is believable.
4. **RTX 3050 Laptop result** — ends with **no winner**. Nothing cleared the 6.4% band, the baseline stays in use, and the record says so. This is a designed outcome, not an error.
5. **Pipeline tab** — a node canvas, not a diagram. Drag the background to pan, scroll to zoom, drag a module anywhere and it stays there. Press **Run proof**: an agent travels the wires, tries the baseline, probes each candidate and backs out of the ones that fail, then commits to the winner and carries it to the registry, the reveal transaction and ENS. The camera follows and lets go the moment you touch the canvas; **Follow agent** turns it back on. Hover any module to isolate its path — the other branches dim. Click one to pin it in the inspector, which otherwise narrates the run as it happens. **Reset** puts dragged modules back and refits the view.
6. **Plan and proof tab** — press **Verify in your browser**. It re-hashes the plan with the browser's own SHA-256 and compares it to the committed value. Flip **simulate a tampered plan** to watch the check fail.
7. **`/projects/new`** — the saga. The agent proposes and explains; it never confirms. Identity precedes sealing because sealing needs a signature; sealing precedes running because the rules have to be locked before anyone knows the result. Close the tab mid-way and reopen it: the saga resumes where you left it. Append `?agent=none` to see the no-agent state.

## Code map

- `src/data/vtec/` — the data replacement boundary. `types.ts` holds the contracts, `runs.ts` the typed fixtures for six GPUs, `index.ts` the derivations (registry, chart rows, pipeline graph, summary).
- `src/lib/plan.ts` — canonical plan JSON, SHA-256 hashing, and the generated English rules sheet. The bytes hashed here are the bytes the proof tab re-hashes.
- `src/lib/agent.ts`, `src/lib/identity.ts` — adapters for the local agent and the passkey provider. Both are mocked with the real states, so wiring in a real transport or Privy/Turnkey is a change to one file.
- `src/components/home/` — the registry dashboard.
- `src/components/wizard/` — the saga: `useSaga.ts` (state and localStorage), `shell.tsx` (rail, stage layout, right panel), `stages/`.
- `src/components/result/` — overview, latency chart, pipeline canvas, plan and proof.
- `src/components/graph/` — the canvas: `VtecCanvas.tsx` (React Flow host), `nodes/` (one component per module kind, over a shared `NodeShell`), `PipelineEdge.tsx` (four wire states plus the travelling pulse), `PipelineAgent.tsx` (the thing that moves), `layout.ts` (dagre layout and the path maths the agent and the wires share), `isolate.ts` (path isolation).
- `src/components/controls/` — the floating HUD and the node inspector.
- `src/hooks/usePipelineRun.ts` — the run clock. Continuous progress drives the agent, a discrete leg index drives everything React renders.
- `src/data/vtec/journey.ts` — the agent's route, derived from the same graph `buildPipeline` produces. No new fixtures.
- `src/components/ui/shdr-13.tsx` — the agent orb, with `idle`, `scanning` and `found` states.
- `src/components/wallet/bridge.ts` — a handle to the wallet connect that already exists in the shell. The saga opens that one; there is no second wallet in this app.
- `src/components/ExistingShell.tsx` — original logo shader, animated background, MetaMask artwork and wallet presentation, unchanged apart from four lines registering the bridge above.

## Validation

```sh
bun run typecheck
bun run check:vectors   # M5: Python, TypeScript and Solidity agree on the same bytes
bun run check:vtec
bun run check:canvas
bun run check:spike
bun run check:ui
bun run build

cd contracts && forge test

# M6, with anvil + bridge + api running:
bun run check:e2e
```

`check:vtec` asserts the claims the UI makes out loud: that every stored plan hash matches the bytes a browser would re-hash, that registry speedups agree with the measured curves, that every accepted candidate really cleared its card's noise band, that wrong kernels were never timed, that every terminal node carries a reason, that the run exercises the statuses the UI renders, that the registry describes exactly one card and makes no cross-hardware claim, that skip reasons quote the working set the plan implies, and that no reason line blames VRAM size for register pressure.

`check:vectors` is milestone M5's exit gate: the candidate id, report hash, promotion digest, release id and canonical JSON encoding are computed independently in TypeScript, in dependency-free Python, and in Solidity, and all three are checked against `packages/schemas/vectors.json`. A candidate id computed one way in the evaluator and another way in the API means a report signed over an artifact the contract has never heard of — a failure that is silent everywhere except here.

`check:e2e` is milestone M6's: the whole vertical flow against a live chain, including the refusals.

`check:canvas` asserts the claims the *graph* makes: that hovering a module really isolates its path and dims the other branches, that every leg the agent walks is an edge the graph actually has, that each variant branch is entered exactly once, that the route commits to the variant the fixtures say won, that a finished replay holds exactly the statuses the run recorded, and that the clock is monotonic and seeks back to where it came from.

`check:spike` validates crossover spike output (build plan section 11a) and enforces its gate: the spike must be run twice and the winners must agree across both sessions, or the result is not usable. It exits 0 with a note when no spike has been run yet, because that is the gate being open rather than a failure.

`forge test` covers the `KernelReleaseRegistry` contract — 36 tests, including every negative case section 12 names. See `contracts/README.md`.

`check:ui` covers the previous dashboard and the preserved wallet.

## What is simulated

Everything. There is no GPU detection, benchmark execution, CUDA, WebSocket, database or chain call. Telemetry, correctness outcomes, hashes, transactions and ENS records are typed fixtures — the shapes the backend will have to satisfy. Panels showing incoming work are labelled "Incoming from your prover" and tagged as simulated, because GPU VTEC never supplies work.

The plan hashes are the exception: they are real SHA-256 digests of the canonical plan JSON, so browser-side verification genuinely passes and genuinely fails when the plan is tampered with.

## Original artwork attribution

Original shader notices remain inline. [Orbkit](https://github.com/zzzzshawn/orbkit) SHDR-01 "Dispersion" is by [XorDev](https://x.com/XorDev); its supplied notice specifies non-commercial use with attribution. The "Phosphor" shader is retained from the same source and is what `Shdr13` renders.
