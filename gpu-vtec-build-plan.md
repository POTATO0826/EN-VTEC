# GPU VTEC — Build Plan

**Paste this whole file into a new Claude session.** It is written as instructions for an AI coding assistant working alongside the team. Follow the milestones in order and do not skip exit gates.

---

## 0. Instructions for the assistant

You are helping a small team (two builders) implement GPU VTEC. Work milestone by milestone. At the end of each milestone, stop and confirm the exit gate passes before moving on.

Rules you must follow throughout:

1. **Never fake a result.** No mocked benchmarks, mocked identity flows, or mocked chain confirmations presented as real. Replays of recorded runs are allowed only if clearly labelled "recorded".
2. **Never weaken the evaluator to get a win.** If no candidate beats the baseline, the honest result is "no gain" or "inconclusive".
3. **Never invent SDK APIs.** For World IDP, ENSv2, and any sponsor SDK, read the official docs first. If docs are unreachable, stop and ask the team.
4. **Keep secrets server-side.** Identity tokens, signing keys, and API keys never reach the frontend, the agent workspace, or logs.
5. **Ask before adding scope.** Anything in section 9 ("Later") is out of scope unless the team explicitly asks.
6. **Prefer the smallest working version** of each milestone, then harden it.
7. **Measure before claiming.** Before M3 (choosing the kernel target), before writing any pitch or UI text about "the winner changes by job size or hardware", and before recording the demo, check that the **crossover spike (section 11a)** has been run on real hardware and its results are recorded. If it hasn't, stop and prompt the team to run it. Never write reason lines or claims about why a variant wins until they match measured numbers.

**Stop-and-prompt checkpoints.** At each of these points, pause and ask the team to do the listed action before continuing:

| When | Prompt the team to |
|---|---|
| Start of M0 | Confirm the RTX 4060 Laptop's VRAM (8 GB) and **power limit** (`nvidia-smi -q -d POWER`) |
| End of M1 | Run the crossover spike on the RTX 4060 Laptop **twice** under the laptop protocol (section 6a) and paste both outputs |
| Before M3 | Decide the workload using the spike result (section 11a decision table) |
| Before any cross-hardware claim | Stop. This build uses one GPU; cross-hardware claims are out of scope unless the optional second card (appendix A) is run |
| Before recording the demo | Re-run the spike, confirm winners are stable across two runs |

When uncertain about a hardware, driver, or SDK detail, say so and propose a way to check, rather than guessing.

---

## 1. What we are building

An AI agent that improves one supported Transformer computation on the operator's own GPU, produces reproducible evidence, and publishes an approved release that other applications can verify, adopt, and revoke.

**The flow:**

```
operator picks workload + constraints
  -> agent profiles, proposes a bounded code change
  -> evaluator checks correctness, then measures against a strong baseline
  -> failures are rejected and kept in history
  -> a named evaluator signs the report
  -> a human reviews and approves the exact release via World IDP
  -> on-chain registry records the approved artifact + evidence
  -> a second client (separate process on the same laptop) reads the registry, verifies, and adopts the release
  -> revoking the release makes the client fall back to the baseline
```

**The core idea:** the agent can propose changes but **cannot approve its own work**. A named evaluator attests to the measurement, and a verified human authorizes publication. The chain holds the shared release history that consumers actually obey.

**First customer hypothesis:** an inference operator who controls their own inference code and GPU. Their pain is the time and uncertainty of deciding whether a hardware-specific optimization is safe and worthwhile.

**What this is NOT:** a GPU marketplace, a token, a training system, a proof that CUDA ran correctly, or universal acceleration across hardware.

---

## 2. Fixed decisions

| Decision | Value |
|---|---|
| Working name | GPU VTEC |
| First user | Operator with control over a PyTorch inference backend |
| GPU | **RTX 4060 Laptop, 8 GB** — the only GPU used for development, measurement, and demo |
| Second GPU | **Not used.** An RTX 3050 Laptop exists but is omitted to reduce scope. Optional later: appendix A |
| Hardware scope | Every result is scoped to this exact machine: GPU model, VRAM, **power limit**, driver, CUDA version |
| First workload | One small inference-only pre-norm Transformer block |
| First kernel target | Fused residual addition + LayerNorm, **if profiling supports it** |
| Agent model | Hosted coding model via API, configurable provider |
| Local chain | Anvil |
| Public chain | Ethereum Sepolia (confirm RPC access) |
| Primary sponsor | World IDP |
| Secondary | ENSv2, only after the core flow works |
| Optional | IDKit, only with a real scarce-resource reason |
| Trust model | Named benchmark signer + identity bridge, **visibly centralized** in the MVP |
| Team | Two builders; solo version cuts optional work |

---

## 3. Architecture

### Repository layout

```
gpu-agent/
  SPEC.md                       # schemas, hash encodings, policies, state transitions
  README.md
  THIRD_PARTY.md                # attribution for any reference code
  .env.example
  apps/web/                     # workload, experiment tree, approval, releases
  services/api/                 # sessions, jobs, artifacts, World callbacks
  services/identity-bridge/     # permit issuer; secrets separate from worker
  services/evaluator/           # reference, correctness, timing, signed reports
  optimizer/                    # tool-limited proposal loop and digest
  workloads/transformer/        # frozen workload and strong baseline
  candidates/                   # agent-editable code ONLY
  runtime/                      # release resolution, compatibility, fallback
  packages/schemas/             # JSON schemas, typed actions, hash test vectors
  contracts/src/KernelReleaseRegistry.sol
  contracts/test/
  contracts/script/
  manifests/
  artifacts/                    # generated evidence; public-safe subset only
  tests/integration/
  docs/WORLD_INTEGRATION_DEBRIEF.md
  docs/DEMO.md
  docs/THREAT_MODEL.md
```

### Stack

| Layer | Choice |
|---|---|
| Compute | Python, PyTorch, Triton or CUDA |
| Web + backend | TypeScript |
| Contracts | Solidity + Foundry |
| Orchestration | SQLite + append-only job log, simple persistent queue |
| Progress to UI | Server-sent events |
| Not required | Kubernetes, Slurm |

### Planned API

| Route | Behaviour |
|---|---|
| `POST /jobs` | Validate workload/policy and budget; enqueue idempotently |
| `GET /jobs/:id/events` | Stream structured progress and attempt outcomes |
| `GET /candidates/:id` | Immutable metadata and evidence links |
| `POST /releases/propose` | Validate ownership and accepted report; create pending action |
| `POST /auth/world/start` | Begin the official World flow for that pending action |
| World callback route | Validate response; update server-side request state |
| `POST /releases/:id/submit` | Obtain required signatures; relay exact action |
| `GET /releases/:id` | Chain status and source evidence |

Authenticate job creation, bind release routes to the owner session, rate-limit resource use, validate schemas. Keep frontend state, job state, and chain confirmation state separate. Restarted services must resume or explicitly fail interrupted jobs, never silently repeat a publication.

---

## 4. Workload specification

### Semantics (write into SPEC.md and freeze)

```
x1 = x  + Attention(LayerNorm(x))
y  = x1 + MLP(LayerNorm(x1))
```

Fix and record: head count, causal/non-causal mode, mask semantics, scaling, LayerNorm epsilon, activation definition, layout, accumulation behaviour, dropout disabled, weight identifiers.

A fused residual + LayerNorm op may need to return **both** the residual sum and its normalized form. Preserve every output the block needs.

### Starter grid

- batch: 1 or 4
- sequence: 64 or 128
- hidden width: 128
- heads: 4

Expand only after checking memory. Keep roughly **20% VRAM headroom**. Add larger and irregular shapes within budget.

> **Warning:** these sizes are very small. Profiling may show too little work for a useful kernel gain, and PyTorch's compiler may already fuse this operation. If so, record that honestly and either enlarge shapes (within memory) or choose a different target that profiling justifies.
>
> **With the RTX 4060 (8 GB):** there is room to go well beyond the starter grid. Add a second grid of realistic sizes, e.g. hidden width 512–1024, sequence 512–2048, batch 1–8, keeping 20% headroom. Larger shapes give fused kernels more work and make a real gain more likely. Keep the small grid too, since the demo benefits from showing where gains appear and disappear.

### Precision

FP32 for the initial correctness smoke test. Choose the measured workload dtype **before** optimizing and freeze its numerical policy. Compare performance against the optimized baseline at the same declared precision.

### Comparators

| Comparator | Purpose |
|---|---|
| Transparent reference | Clarify semantics, inspect numerical differences |
| Strong PyTorch implementation | **Main performance comparator**; use optimized attention (SDPA) where applicable |
| Supported compiled implementation | Check whether `torch.compile` already solves the bottleneck |
| Agent candidate | Measure additional benefit of generated changes |

Record the actual SDPA backend in use. **A gain against deliberately naive attention is not a gain.**

---

## 5. Agent specification

One orchestrator. Research, coding, evaluation, and release are **roles with different permissions**, not four separate LLM agents.

### Tools

| Tool | Allowed behaviour |
|---|---|
| `inspect_environment` | Read sanitized GPU and software metadata |
| `profile_workload` | Read the development profile |
| `read_references` | Read approved docs/examples with attribution |
| `propose_patch` | Modify only files in `candidates/`, within a bounded diff |
| `evaluate_candidate` | Request evaluation; receive structured development results |
| `read_experiment_digest` | Read prior hypotheses, outcomes, failures |
| `request_release` | Create a pending release proposal; **cannot grant approval** |

The agent has **no** evaluator signing key, identity bridge key, wallet owner key, ability to edit evaluation policy, or access to final holdout answers.

### Search loop

1. Profile and name the bottleneck.
2. State a hypothesis and what would falsify it.
3. Create a candidate derived from a specific parent artifact.
4. Reject patches outside the editable boundary.
5. Compile in a disposable worker.
6. Test numerical correctness **before** timing.
7. Benchmark qualifying candidates on development/calibration cases.
8. Record every attempt: compile errors, timeouts, OOM, regressions, noise.
9. Stop on budget exhaustion or lack of promising changes.
10. Freeze one candidate and evaluate once on held-out cases.

**Budget:** five candidates or 20 minutes, whichever comes first. Cap model API spend separately. One GPU worker at a time.

### Optimization tiers

| Tier | Example | Admission rule |
|---|---|---|
| 0 | Launch parameters, backend config | Same semantics; call it tuning, not kernel generation |
| 1 | Residual/normalization or elementwise fusion | Passes unchanged numerical policy |
| 2 | Layout, tiling, buffer reuse, launch reduction | Correctness plus whole-block benefit |
| 3 | Reduced precision or approximation | Separate policy; explicit operator opt-in and quality checks |

Start at Tier 1 for a genuine kernel-writing demo. Do not write a custom matmul unless profiling gives a concrete reason. Do not chunk self-attention along the sequence and claim identical global attention.

---

## 6. Correctness, timing, anti-gaming

### Numerical gate (freeze before tuning)

For every output element:

```
abs(candidate - reference) <= atol + rtol * abs(reference)
```

and all required outputs are finite with correct shape and dtype.

Start with the strictest justified tolerances. `rtol=0.02, atol=0.002` is an editable starting point, not a guarantee. Record max absolute error, a defined relative-error measure, failed-element count, and comparison dtype.

Test multiple fresh inputs and weights, boundary/irregular sizes, applicable masks, and repeated calls with changed data.

### Timing protocol

- Pin hardware/software/workload conditions; stop competing GPU work.
- Warm up both paths; record compilation and startup separately.
- Use synchronized GPU events for device timing; also record end-to-end call latency.
- Run **randomized paired** baseline/candidate trials.
- Initial target: **100 paired observations per case across three sessions**. Adjust based on measured noise and timer resolution.
- For very short kernels, time batches of repeated invocations with representative data changes and report amortization.
- Report raw samples, medians, spread, memory, unsupported cases, failures.
- Separate profiling runs from final timing runs.
- Record thermal/power observations where available. Do not claim clock locking if unavailable.
- Follow the laptop measurement protocol (section 6a) for every timed run.

### Acceptance

Accept only if:
- correctness passes, **and**
- median gain ≥ 5%, **and**
- the paired improvement estimate stays above zero at a declared uncertainty level, **and**
- no required case has an unexplained material regression.

Implement the confidence calculation inside the evaluator and freeze it with the policy. If inconclusive, rerun under the predefined protocol or return **inconclusive**. Never pick the best noisy run.

Report per-shape speedups and whole-block result. If aggregating, state the workload mix and weights.

### Anti-gaming

- The supervisor owns input generation, reference computation, and timestamps.
- Candidate code receives only runtime inputs. Final seeds/answers never enter the agent workspace.
- Use fresh processes, fresh inputs, altered weights, and output-consumption checks to catch cached-answer shortcuts.
- **Include two planted fixtures:** a deliberately wrong candidate and an output-caching candidate. Both must be rejected.
- Mount evaluator files read-only. Deny candidate network access and secrets. Bound CPU/RAM/VRAM/time.
- Perform reference comparison outside the candidate process.
- Final bundles include hashes of the exact source and build artifacts tested. Changing source, compiler options, or binary after evaluation invalidates the report. Never sign a mutable file path.

State plainly in docs: the MVP evaluator is a **trusted operator**, not a cryptographic proof that hostile native code cannot cheat.

---

## 6a. Laptop measurement protocol (RTX 4060 Laptop)

Laptop GPUs are the noisiest measurement setup: heat, battery modes, and automatic boost all move timings. Apply every control below before any timed run, and record them in the environment manifest.

| Control | How |
|---|---|
| Power source | Plugged in. Never measure on battery |
| OS power mode | Windows "Best performance" |
| Vendor mode | Laptop manufacturer's app set to performance / turbo mode, same setting every session |
| GPU preference | NVIDIA Control Panel → Manage 3D settings → Power management mode: "Prefer maximum performance" for the Python interpreter |
| Display GPU switching | Plug the laptop into an external monitor, or check that Python runs on the NVIDIA GPU, not the integrated one (`nvidia-smi` shows the process) |
| Heat | Hard flat surface or cooling stand; same room; 2-minute warmup load before measuring |
| Background load | Close browsers with video, games, screen recorders, and anything else using the GPU |
| Power limit | Record once per session: `nvidia-smi -q -d POWER` (the laptop maker sets this; the same GPU name can run anywhere from roughly 35 W to 115 W) |
| Live logging | Run in a second terminal during every timed session: `nvidia-smi --query-gpu=timestamp,temperature.gpu,clocks.sm,power.draw --format=csv -l 1 > gpu_log.csv` |
| Repeat rule | Two sessions, a few minutes apart. **Winners must agree across both** or the result is marked "noisy — not usable" |
| Comparison | Only ratios against the baseline measured in the same session. Never compare raw milliseconds across sessions or machines |

If the log shows clocks dropping sharply or temperature near the throttle point partway through a run, discard that run and rerun after cooling.

---

## 7. Evidence objects

Write `SPEC.md` **before** implementation. It fixes schemas, hash encodings, signature domains, numerical policy, acceptance policy, and release transitions.

| Object | Required content |
|---|---|
| Workload manifest | Semantics, model/weights identity, shapes, dtype, mask, accuracy policy |
| Environment manifest | GPU model, VRAM, **power limit (W)**, power mode (plugged in, vendor performance mode), driver, CUDA runtime/toolkit, versions, build flags, dependency/image digest |
| Candidate | Parent ID, workload ID, source/binary hashes, hypothesis, intended scope |
| Run report | Candidate/baseline IDs, policy, environment, raw-sample digest, correctness, timings, failures, evaluator |
| Experiment log | Ordered attempted changes and outcomes, including rejected ones |
| Release proposal | Candidate, accepted report, target channel, authority, nonce, expiry |

### Hashing rules

- Exact UTF-8 bytes and **one** canonical JSON specification for off-chain manifests.
- SHA-256 for artifact file digests.
- ABI encoding + keccak256 for contract identifiers.
- Never hash differently serialized JSON in two languages and expect agreement. **Publish shared test vectors** that Python, TypeScript, and Solidity all pass.

```
candidateId = keccak256(abi.encode(
  schemaVersion, parentId, workloadHash, environmentScopeHash,
  sourceDigest, binaryDigest, hypothesisHash
))
```

The report contains `candidateId`; its own hash is computed after measurement. IDs never contain report signatures (avoids circular hashes). Independent runs produce separate reports for the same candidate.

Store large bundles off-chain with content digests (local files and a static download endpoint first; IPFS optional). Test retrieval from the consumer environment. Never publish credentials, identity tokens, private prompts, or proprietary weights.

---

## 8. Blockchain: `KernelReleaseRegistry`

### Why the chain is here

The optimizer works without a blockchain. The chain serves **multiple parties** who need a shared release history and enforceable publication permissions: operator, evaluator, and adopting applications. The consumer reads this history instead of trusting a mutable dashboard. **Demonstrate second-client adoption and revocation** so the chain's role is concrete.

GPU execution, model calls, benchmarking, and identity tokens stay off-chain.

### Contract

Non-upgradeable Solidity for the first testnet deployment. Pin compiler and library versions. Use reviewed signature utilities (e.g. OpenZeppelin EIP-712 and SignatureChecker); these are building blocks, not replay protection by themselves.

**Storage:**

```
projects[projectId]      = { owner, evaluatorSigner, identityBridgeSigner, configVersion }
candidates[candidateId]  = { projectId, parentId, workloadHash, environmentScopeHash,
                             sourceDigest, binaryDigest, manifestHash, author, registeredAt }
reports[reportHash]      = { candidateId, evaluator, policyHash, verdict, observedAt }
releases[releaseId]      = { projectId, channel, candidateId, reportHash,
                             previousReleaseId, authorityDigest, status }
currentRelease[projectId][channel] = releaseId
usedPermits[permitDigest]          = bool
```

IDs and signatures must include correct project and chain context. Bound metadata length. Freeze project signers for the MVP; if rotation is added, increment `configVersion`, invalidate outstanding permits, emit a config event.

**Three separate authorities, all required to promote:**

1. **Evaluator attestation** — a named evaluator says the exact candidate passed the fixed policy.
2. **Owner authorization** — the owner approves one exact release action with an EIP-712 signature.
3. **Human-verification permit** — the identity bridge attests the World IDP journey and explicit consent completed for that action.

**Functions:**

| Function | Checks and effect |
|---|---|
| `createProject(...)` | Nonzero owner/signers; record policy and config |
| `registerCandidate(...)` | Authorized author; existing same-project parent if non-root; immutable unique identity |
| `recordReport(report, signature)` | Configured evaluator signature; known candidate; verdict accepted/rejected/inconclusive |
| `promoteRelease(action, ownerSig, bridgeSig)` | Accepted report and all bindings; verify both signatures; consume permit; update channel |
| `revokeRelease(releaseId, reasonHash)` | Owner disables immediately; record preserved; event emitted |
| `getCurrentRelease(projectId, channel)` | Current record including revocation status |

**Typed promotion action** (owner and bridge sign the same struct; domain includes name, version, chainId, verifyingContract):

```
projectId, configVersion, owner, actionType=PROMOTE,
channelHash, candidateId, reportHash, policyHash,
expectedPreviousReleaseId, nonce, deadline
```

On-chain checks: unused nonce/permit, deadline, current configuration, matching report, expected previous release. Consume the permit atomically with promotion. This prevents replay, artifact substitution, cross-chain reuse, and overwriting a newer release with an old approval.

Cancellation produces no bridge signature. Expired permits are rejected even if a stale frontend retries. A revoked release never silently becomes active again.

**Events:** `ProjectCreated`, `CandidateRegistered`, `ReportRecorded`, `ReleasePromoted`, `ReleaseRevoked`, with indexed IDs.

In the UI, label results **"evaluator-attested"**, never "trustless verification". The contract cannot infer floating-point correctness or timing from a digest.

### Consumer behaviour

The consumer checks: project owner, contract/chain, current release, revocation, report signer/policy, artifact digest, and exact hardware/software/workload scope. It downloads the package, rechecks the digest, runs a local smoke test, and loads it only through its configured trust policy.

- Do **not** query the chain on every GPU call. Check on adoption/startup and refresh periodically (declare the max stale interval; 30 seconds for the demo).
- On unavailable or uncertain state, use the trusted baseline.
- A valid digest alone never makes downloaded native code safe.

### Consumer on a single laptop

The consumer runs as a **separate process** on the RTX 4060 Laptop (its own terminal or window, its own config), not as a page inside the operator dashboard. It must never share state with the operator app; its only source of truth is the chain plus downloaded artifacts.

Minimum consumer (keep it small, roughly one page of code):

1. Read `currentRelease[projectId][channel]` from the registry
2. Check revocation status, report signer, and hardware scope against its own machine (GPU model, VRAM, power limit, driver)
3. Download the artifact, recheck the digest, run a local smoke test
4. Display: **adopted release ID, variant, and "running optimized path"**, or **"baseline (reason)"**
5. Refresh every 30 seconds; on revocation or uncertain state, switch to baseline and show why

For the demo, show the consumer window side by side with the operator dashboard so the switch on revocation is visible.

**Optional scope-mismatch demo (honest, not faked):** start a second consumer instance configured with a declared hardware scope that doesn't match this laptop (for example a different driver major version in its policy). It should refuse the release and stay on baseline, showing that releases are hardware-scoped. Label it on screen as a scope-policy test.

---

## 9. World IDP integration

**Prize context:** Best Use of World IDP — $7,500, which explicitly encourages agentic products. Use the event's official portal and documentation as the only source of truth. **Do not invent SDK calls.** If the portal or docs are unreachable, stop and tell the team.

### The trust moment

The operator sees:

> "Authorize the agent to promote this tested artifact to project X's stable channel once, before this request expires."

Before consent, display the measured outcome, changed files, artifact fingerprint, scope, and any precision trade-off.

Authentication identifies a session; it does not mean the person approved a kernel. The app must bind explicit consent to the release digest.

### Backend flow

1. Connect the owner's wallet; prove control with a nonce-bound sign-in challenge. Verify project owner on-chain.
2. Build an immutable pending release action server-side. Store digest, session binding, expiry, one-use state.
3. Show its contents; obtain explicit consent in the app.
4. Start the official World IDP journey, bound to the pending request through server-maintained state.
5. For an OIDC authorization-code flow, validate state/nonce, exact redirect, token signature/JWKS, issuer, audience, expiry, and PKCE on the backend.
6. Enforce fresh authentication/verification using only claims and parameters the pilot actually supports. If required assurance can't be established, deny.
7. Bind the validated identity to the wallet/app session using supported subject semantics. Don't infer cross-app uniqueness from ordinary authentication.
8. Reconfirm candidate, report, owner, and current release still match the pending action. A changed action requires new consent.
9. Obtain the owner's typed signature. Issue the bridge signature for that same digest after all gates pass.
10. Submit promotion; record the receipt. The candidate worker never receives these keys or raw identity tokens.

Handle retries idempotently. Store secrets server-side only; redact tokens from logs. The chain stores the authorization digest, not the raw identity or token.

**Disclosed trust limit:** the EVM contract checks the bridge's signature, not a World OIDC token. A compromised bridge could falsely assert completion (the owner signature is still required). Do not advertise direct on-chain World IDP verification.

### Qualification checklist

- Official event pilot/staging environment, not a mock provider
- Complete request → completion → backend validation → protected action journey
- Scope: one exact release; expiry: short (proposed five minutes)
- Cancelled or denied request produces no promotion
- Expired permit and replay rejected
- Secrets and token validation on the backend
- Public repo, short video, working deployment or reproducible local demo
- Debrief: time to first success, friction, missing docs/capability, one highest-impact improvement

An offline mock is fine for development and **ineligible** as the sole prize demo. If access fails, continue the GPU/contract work and drop the IDP eligibility claim honestly.

### Optional IDKit (only if there's a real reason)

Use only for a genuine eligibility decision, e.g. claiming a limited sponsor-funded optimization run once per person per period. Use Proof of Human if uniqueness is truly required, verified server-side or via the supported on-chain flow, with nullifier/action scope. Show success, cancellation, unavailable credential, and rejection. Don't gate every kernel execution with verification. A verified human is not evidence of an honest benchmark.

---

## 10. Optional ENSv2 (only after the core flow works)

Use the event's official ENSv2 deployment and documented permissions; confirm addresses and APIs first.

Proposed use: a project name resolves to its registry address, project ID, and release metadata. The consumer resolves these dynamically, then checks the registry. Proposed record names (application conventions, not ENS standards): `gpu.registry`, `gpu.project`, `gpu.chain`.

Delegate only the permissions needed, keep ownership with the operator, and demonstrate a denied unauthorized update. The **registry** decides active release state; ENS supplies discovery. Never create two competing release authorities.

---

## 11a. Crossover spike — run before choosing the workload

**Purpose:** find out, with real measurements, whether the fastest kernel variant changes with job size on the RTX 4060 Laptop. The answer decides which workload and which pitch the project uses. Do this at the end of M1, before M3.

**Artifact:** `crossover_test.py` (provided separately). It contains four CUDA SHA-256 variants, runs a bit-exact correctness gate against `hashlib`, measures each card's noise band, sweeps job sizes from 256 to 1,048,576 messages, and writes `crossover_<GPU_NAME>_<timestamp>.json`, so repeat runs don't overwrite each other. The SHA-256 logic of all four variants has already been verified bit-exact on CPU, including job sizes that aren't a multiple of 4, so any correctness failure on GPU is a CUDA-specific issue, not broken hash logic.

| Variant | Strategy |
|---|---|
| A baseline | Full 64-word schedule in local memory, rolled loop |
| B rolling | 16-word rolling window, fully unrolled |
| C shared-K | Constant table staged in shared memory, 128-thread blocks |
| D 4-per-thread | Four messages per thread; highest register use per thread |

### Step 1 — run on the RTX 4060 Laptop

Apply the laptop protocol (section 6a) first, and start `nvidia-smi` logging in a second terminal.

```bash
pip install cupy-cuda12x        # cupy-cuda11x if on CUDA 11
python crossover_test.py
```

Before running:
- Plug in the machine; battery mode throttles the GPU
- Close anything else using the GPU
- **Run twice, a few minutes apart.** If winners change between runs, noise is larger than the differences and results aren't usable yet

Paste both outputs to the assistant.

### Step 2 — (optional, skipped in this build) second card

This build uses only the RTX 4060 Laptop. For running the spike on the RTX 3050 Laptop later, see appendix A. **Skip to step 3.**

### Step 3 — decide

| Result | What it means | What to do |
|---|---|---|
| Winner changes across job sizes on the 4060 | Size-based crossover is real; demoable on one card | Use SHA-256 as the workload inside the release lifecycle; demo the size switch |
| (Not tested in this build) Cross-card differences | Unknown | Do not claim. Say releases are hardware-scoped and other machines contribute their own |
| Same winner everywhere, both runs agree | SHA-256 doesn't show a crossover | Use the Transformer workload (section 4); pitch the release lifecycle, not the crossover |
| Winners change between repeat runs | Noise dominates | Increase measured runs, check thermals and power mode, rerun before deciding |
| A variant fails correctness on GPU | CUDA-specific bug (logic is CPU-verified) | Send the failing message index to the assistant to fix |

Record the decision and both JSON files in `artifacts/spike/`.

### Why a flip might or might not happen (be accurate about this)

- **Don't claim register spilling or VRAM as the reason cards disagree.** VRAM is the large memory; registers are small per-core storage, and register space per streaming multiprocessor is the same on the RTX 3050 and RTX 4060. A variant that spills on one will generally spill on the other.
- **More plausible real causes:** number of streaming multiprocessors (a small job can fill one card but not the other), L2 cache size (the 4060's is much larger), memory bandwidth, and clocks.
- **SHA-256 specifically** is compute-heavy with a tiny memory footprint, so cache and bandwidth differences matter little. The most likely difference is how quickly each card fills up at small job sizes.
- Any "reason" line shown in the UI must come from measured behaviour and profiling, not from these general explanations.

---

## 11. Milestones

Each milestone has an exit gate. Do not start the next milestone until the gate passes.

| Milestone | Work | Exit gate |
|---|---|---|
| **M0: decisions and access** | Confirm GPU, choose workload, obtain World pilot access, choose chain | Decisions resolved; a real identity request succeeds or the blocker is recorded |
| **M1: environment** | Linux or WSL2; GPU smoke tests; pin working dependencies | Reproducible environment manifest; one tensor op and one custom-kernel smoke test pass |
| **M1.5: crossover spike** | Run section 11a on the RTX 4060 Laptop, two sessions, under the laptop protocol (6a), with `nvidia-smi` logging | Both JSON files and GPU logs saved; winners agree across sessions; section 11a decision recorded; workload for M3 chosen from it |
| **M2: evaluator** | Reference, strong baseline, numerical tests, synchronized timing | Valid baseline report; planted wrong and caching candidates rejected |
| **M3: one kernel** | Profile; implement a bounded fusion candidate | Candidate evaluated against strong baseline; honest gain / no-gain result |
| **M4: agent loop** | Structured tools, patch limits, failure history, budget | One genuine autonomous proposal evaluated; agent has no evaluator access |
| **M5: evidence contract** | Canonical objects, digests, report signatures | Python / TypeScript / Solidity agree on shared fixtures |
| **M6: local registry** | Registration, report, promotion, revocation | Anvil end-to-end plus negative contract tests pass |
| **M7: protected action** | Real World validation, owner signature, bridge permit | Success publishes; cancelled/expired/replayed requests cannot publish |
| **M8: adoption UI** | Experiment graph, evidence, release status, consumer | Consumer loads compatible release and falls back after revocation |
| **M9: public evidence** | Testnet deployment, clean-machine setup, video, debrief | Another builder can reproduce the declared local flow |
| **M10: extensions** | Independent verifier, ENS, TEE, or paid task | Add individually, only after earlier gates pass |

### M1 environment notes

Use Linux or WSL2. Follow NVIDIA's CUDA-on-WSL guidance: use the Windows driver, **don't install a Linux display driver inside WSL**. Record GPU model, available VRAM, driver, CUDA runtime/toolkit, Python, PyTorch, compiler, OS, and power mode. Pin working versions in a lockfile and environment manifest.

The coding model runs via hosted API while benchmarking runs locally. **Do not load a coding model onto the same GPU during measurements**, even with the 4060's extra memory: it competes for compute and distorts timings.

Do all development and final measurements on the **RTX 4060 Laptop**. Apply the laptop protocol (section 6a) for every timed run.

### RTX 4060 Laptop setup and troubleshooting

**Install order (WSL2 path):**
1. Update the **Windows** NVIDIA driver (Game Ready or Studio). Do not install any NVIDIA driver inside WSL.
2. Install WSL2 with Ubuntu; confirm `nvidia-smi` works **inside WSL** and lists the RTX 4060 Laptop.
3. Install Python 3.10–3.12 in a virtual environment.
4. `pip install cupy-cuda12x` for the spike; install PyTorch with the CUDA 12 build from pytorch.org for the Transformer workload.
5. Smoke test: `python -c "import cupy as cp; print(cp.cuda.runtime.getDeviceProperties(0)['name'])"`

**Native Windows path** also works for the spike (same `pip install cupy-cuda12x`), and is simpler if WSL gives trouble. Pick one path and pin it.

**Common problems:**

| Symptom | Likely cause | Fix |
|---|---|---|
| `nvidia-smi` not found in WSL | Old Windows driver or WSL1 | Update Windows driver; `wsl --set-version Ubuntu 2` |
| CuPy import fails / CUDA version error | Wrong CuPy wheel | Match `cupy-cuda12x` to the CUDA version shown by `nvidia-smi` |
| `nvrtc` / compile error on first kernel | Missing NVRTC runtime | `pip install nvidia-cuda-nvrtc-cu12` |
| Python process runs on integrated GPU | Hybrid graphics switching | NVIDIA Control Panel: set Python to "High-performance NVIDIA processor"; confirm in `nvidia-smi` process list |
| Timings drift upward over a session | Thermal throttling | Cooling stand, rest between sessions, check `gpu_log.csv` clocks |
| Very different results plugged vs unplugged | Battery power limit | Always plugged in; vendor performance mode |
| Correctness failure in `crossover_test.py` | CUDA-specific bug (hash logic is CPU-verified) | Paste the failing message index to the assistant |

### Work split (two builders)

| Hours | GPU / agent workstream | Application / chain workstream | Shared checkpoint |
|---|---|---|---|
| 0–3 | **Run crossover spike (11a) on the 4060**; then freeze workload, baseline, numerical policy from its result | Confirm World access; freeze typed actions | Spike decision recorded; scope, attribution, SPEC agreed |
| 3–9 | Evaluator and first bounded kernel | Contract + real World callback skeleton | Baseline runs; real identity flow validated |
| 9–15 | Agent patch/evaluate loop | Signature bridge and registry promotion | Artifact/report IDs agree across services |
| 15–21 | Repeated measurements; anti-gaming cases | UI, evidence retrieval, negative auth paths | Full vertical flow on local chain |
| 21–27 | Held-out evaluation, reproducibility | Testnet deployment, consumer fallback | Real hashes, real receipts, no mock prize path |
| 27–31 | Fix evidence inconsistencies | Fix contract/auth bugs | **Feature freeze** |
| 31–36 | Record reproducible demo | README, debrief, submission | Rehearsal and buffer |

**Solo version:** one registry, one kernel target, one World flow, a simple results table. Remove ENS, IDKit, TEE, escrow, verifier committees, and decorative graph work first.

### Cut rules

- **World access unavailable:** mark IDP track blocked; finish optimizer/registry; do not substitute a mock for eligibility.
- **Custom compiler environment broken:** fix, or reduce the claim to configuration tuning; don't call pre-written selection "kernel generation".
- **No reliable gain:** show the rejected/inconclusive search and narrow the workload; never weaken the evaluator.
- **Single GPU (default in this build):** show local reproduction on the RTX 4060 Laptop only. Make no cross-hardware claims.
- **Public RPC outage:** preserve Anvil reproduction and previously confirmed receipts, labelled.
- **Deadline pressure:** remove optional integrations before reducing correctness or authorization checks.

---

## 12. Verification plan

| Area | Required evidence |
|---|---|
| Numerical correctness | Changed inputs/weights, irregular shapes, masks, non-finite and wrong-output rejection |
| Measurement | No-op comparison shows noise-level difference; paired repeated trials; startup separated |
| Agent isolation | Disallowed file edits and secret access blocked; timeout/OOM kept as failures |
| Hashes/signatures | Shared encoding vectors; one-byte artifact change invalidates digest; correct domain binding |
| Contracts | Unknown candidate, wrong report signer, rejected report, non-owner signature, wrong bridge, expired/replayed permit, altered artifact/project/chain, stale previous release — all fail |
| Identity | Real successful flow; cancellation; invalid state/nonce; wrong issuer/audience/signature; stale assurance denied |
| Adoption | Unsupported GPU/software falls back; tampered package rejected; revoked release not selected after refresh |
| Recovery | Worker/API restart and transaction retry don't duplicate promotion |
| Availability | Artifact downloaded and verified from the consumer environment |

Unit tests for encodings and policies; contract tests for authority/state transitions; integration tests for the real release flow. Manually test official identity success and failure in the event environment. None of this is a production security audit.

---

## 13. Demo

### Recommended demo (six beats, ~3 minutes)

The source plan lists twelve steps; judges lose the thread past about six. Compress to:

| Time | Beat | Point |
|---|---|---|
| 0:00–0:25 | Workload, actual GPU, strong baseline | A concrete optimization task |
| 0:25–1:00 | Agent proposes a diff; one attempt rejected for wrong output | The agent writes code, and the evaluator can refuse it |
| 1:00–1:30 | Valid candidate: correctness check, repeated timings vs strong baseline | Measured result against a real comparator |
| 1:30–2:15 | Agent requests release → cancel World (nothing happens) → retry, verify, approve exact action | The agent cannot grant itself publication authority |
| 2:15–2:40 | Registry receipt; the consumer app (a separate process, shown in its own window) reads the chain, verifies, and adopts | The blockchain record changes application behaviour |
| 2:40–3:00 | Revoke; client falls back to baseline; state limits | The lifecycle is complete |

**Before recording:** re-run the crossover spike and the main evaluation, and confirm winners are stable across two runs. If the demo mentions a job-size or cross-hardware switch, the numbers on screen must be the measured ones from `artifacts/spike/`.

Precompute longer benchmark sessions and label them "recorded evidence". Run a small live sanity check. Never fabricate identity or chain confirmation; show pending/finalized states honestly. Keep a documented local reproduction ready.

### Judge questions

**"Isn't this already in PyTorch or open source?"**
Existing models, kernels, and compilers are the baseline and building blocks. We automate a specific hardware/workload experiment and package the result with reproducible evidence and controlled adoption. We must show measured benefit over a strong existing path; if we only toggle a standard backend, our contribution is integration/tuning, not a kernel breakthrough.

**"Why blockchain?"**
So independent consumers share the same approved release history and publication permissions are enforced. We show a consumer rejecting an unauthorized artifact and responding to revocation. The chain doesn't accelerate arithmetic or prove a benchmark truthful. A single-user version could work without it.

**"Why World instead of a wallet signature?"**
The wallet approves the transaction; the product policy additionally requires the owner's fresh identity verification before an autonomous system changes a trusted release. We show that policy and its denial path. If ordinary signing were enough for an operator, World adds less, and we'd say so. Ordinary World IDP authentication doesn't automatically prove person uniqueness.

**"Could the agent cheat?"**
It can't edit the evaluator or final policy, and runs against fresh inputs with external checking. The demo includes cheating candidates that get rejected. A fully malicious GPU host remains trusted in the MVP; the chain records who attested, not a mathematical proof.

**"Is it decentralized?"**
The release registry is on a shared chain. Optimization, benchmark attestation, and the identity bridge are initially operated by us. Independent operators and attested infrastructure are later milestones.

**"Where's the user benefit?"**
Saved time or memory on the supported workload, plus the effort to adopt safely. Measure full request latency before claiming application acceleration: a 2× kernel gain isn't 2× faster inference if that kernel is a small share of the request.

**"How is this different from Petri?"**
The experimental object is executable GPU code. Evaluation depends on hardware/software scope, numerical tolerances, timing noise, and memory. The runtime adopts scoped kernel releases. Credit Petri's experiment-lineage pattern rather than claiming to invent it.

---

## 14. Later (out of scope unless explicitly requested)

- Independent operators with compatible GPUs rerunning reports
- Commit-reveal for independent verifier reports
- Sponsored compute credits via IDKit with a real scarce allocation
- ENSv2 discovery and permissions
- `OptimizationEscrow` for a paid optimization request
- Attested control plane (TEE) with a correctly stated hardware boundary
- Real-model integration and application-level latency

**Never in this build:** full model sharding, GPU marketplace, new token, training, multi-chain settlement, proving CUDA execution in ZK, production slashing, universal optimization across arbitrary hardware.

---

## 15. Final acceptance checklist

- [ ] GPU and dependency environment confirmed and recorded
- [ ] Workload semantics and tolerances fixed before tuning
- [ ] Strong library/compiler comparator included
- [ ] Agent genuinely creates or edits candidate code (for any kernel-generation claim)
- [ ] Invalid candidates fail and remain visible in history
- [ ] Accepted claims have repeated measurements and a frozen held-out evaluation
- [ ] Artifact hashes match the exact tested and downloaded bytes
- [ ] Contract protects promotion with evaluator, owner, and bridge checks
- [ ] Official World IDP integration passes success and meaningful failure paths
- [ ] Consumer uses the registry, checks compatibility, handles revocation
- [ ] Centralized signer, GPU-host, and identity-bridge trust assumptions documented
- [ ] Public repo credits reference code and complies with licenses
- [ ] Event pre-existing-work policy and sponsor qualification confirmed
- [ ] Reproducible local instructions, short video, deployment details, World debrief complete
- [ ] Unsupported claims removed: universal acceleration, trustless CUDA proof, consumer-GPU TEE protection, guaranteed win

---

## 16. Open items for the team to fill in

- Product name:
- Exact first user and workload:
- Confirmed GPU / VRAM / software:
- Kernel target after profiling:
- Accuracy and performance acceptance policy:
- Available team and time:
- Model API and spending cap:
- Confirmed World IDP pilot capabilities:
- Final chain and optional ENS choice:
- Features to remove:
- Features to add after the demo:
- Pilot feedback:

---

## 17. Review notes

Points raised while reviewing the source plan. The team should decide on these before M3.

1. **The gain may not exist at these sizes.** Hidden width 128 with sequence 64 is tiny, and `torch.compile` may already fuse residual + LayerNorm. Profile first. If there's no headroom, enlarge shapes within the 4 GB budget or pick a different target that profiling justifies. An honest "no gain" still demos the lifecycle, but the release step then has nothing worth promoting.
2. **The release lifecycle is the differentiator, not the optimization.** Single-GPU agent-assisted kernel optimization already exists as prior work. What's new here is: the agent can't approve itself, a verified human authorizes the exact release, and consumers adopt and revoke through the registry. Lead the pitch with that.
3. **Build weight.** Three signatures, permits, expiry, replay protection, revocation, a consumer client, and the real World flow is a lot for two builders. Get M6 (local registry end-to-end) working before touching World, so there's always a complete demo even if identity integration stalls.
4. **Workload choice comes from the spike.** The SHA-256 crossover experiment (section 11a) has CPU-verified correctness. If it shows a real crossover on the 4060, it can be the workload inside the release lifecycle, with exact (bit-for-bit) correctness instead of tolerances. If not, use the Transformer target.
5. **Single-GPU build on the RTX 4060 Laptop.** The 8 GB card removes the 4 GB memory limit and allows realistic shapes where gains are likelier, and the spike is runnable immediately. Being a laptop, it needs the section 6a protocol for trustworthy timings. Omitting the RTX 3050 removes only the measured cross-card claim; the size crossover, correctness gate, release lifecycle, World approval, registry, and revocation all work on one machine.
6. **Pitch wording for a single GPU.** If the spike shows a size flip: *"The fastest code changes with the job, so releases are scoped to the hardware and workload they were measured on. An agent finds the change, an evaluator measures it, a verified human approves it, and machines adopt only releases scoped to them."* If it doesn't: drop the first sentence and lead with the release lifecycle. Never say "different cards pick different winners" as a measured result.

---

## Appendix A — Optional second card (RTX 3050 Laptop)

Omitted from this build. Use only if the team later wants a measured cross-hardware claim.

1. Apply the same laptop protocol (section 6a) on the RTX 3050 Laptop; record its power limit too.
2. Run `crossover_test.py` twice.
3. Compare with the 4060 results:

```python
# compare.py
import json, sys
a, b = (json.load(open(f)) for f in sys.argv[1:3])
print(f"{'size':>10}  {a['gpu'][:22]:>22}  {b['gpu'][:22]:>22}")
for size in a["results"]:
    wa = a["results"][size]["_winner"]
    wb = b["results"].get(size, {}).get("_winner", "-")
    flag = "  <- DIFFERENT" if wa != wb else ""
    print(f"{int(size):>10,}  {wa:>22}  {wb:>22}{flag}")
```

4. Only rows marked **DIFFERENT** in both sessions count as a measured cross-card result.
5. Explain any difference from measurement and profiling only. Plausible causes: core (SM) count, L2 cache size, power limit, clocks. **Not** VRAM or register spilling: register space per core is the same on both cards.
6. The 3050 laptop can then also serve as a physically separate consumer client in the demo.
