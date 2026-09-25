# Services

Three processes, split along the one line that matters: **who holds which key**.

| Process | Holds | Cannot |
| --- | --- | --- |
| `services/api` | a relayer key, to pay gas | sign a report, issue a permit, approve a release |
| `services/identity-bridge` | the permit key | do anything except attest that an identity journey completed |
| `runtime/consumer` | nothing | write anything at all |

The evaluator (your friend's column) holds the fourth key and signs reports. The
owner's key stays in their wallet. No process holds two of them, which is the
whole point: build plan section 8 requires three separate authorities to publish,
and an architecture where one service could produce two of those signatures would
make the third a formality.

## Running the lot

```sh
anvil                                            # terminal 1
cd contracts && forge script script/Lifecycle.s.sol \
  --rpc-url http://127.0.0.1:8545 --broadcast    # deploy once, note the address

cp .env.example .env                             # then edit GPUVTEC_REGISTRY
bun run bridge                                   # terminal 2
bun run api                                      # terminal 3
bun run dev                                      # terminal 4 - the dashboard
bun run consumer                                 # terminal 5 - its own window
```

Verify the whole vertical flow:

```sh
bun run check:e2e
```

That walks project → candidate → signed report → proposal → consent → permit →
promotion → resubmission, and checks the refusals along the way: a rejected
report cannot be proposed, an identity journey cannot start before the operator
consents, the bridge will not sign a digest it never saw, and resubmitting does
not publish twice.

## The identity bridge, stated plainly

Build plan section 9 requires the official World pilot and forbids inventing SDK
calls. **This build does not have pilot access.** The bridge therefore runs in one
of three modes, and `GET /health` always says which:

| Mode | When | Behaviour |
| --- | --- | --- |
| `world` | all four `GPUVTEC_WORLD_*` set | real journey; token validation still has to be written against the official docs |
| `dev-stub` | `GPUVTEC_BRIDGE_DEV_ATTEST=1` | signs with **no identity journey at all**; every permit stamped `kind:"dev-stub"` |
| `blocked` | neither | issues nothing, and says what is missing |

`dev-stub` exists so the release lifecycle could be built and demonstrated before
World access lands. The stamp travels: bridge response → API `proposals.permit_kind`
→ the dashboard's System panel, which renders the bridge's warning verbatim in
amber. Section 11's cut rule is why: *"do not substitute a mock for eligibility."*
A dev-stub permit demonstrates the lifecycle and is **not** a World IDP
integration. Do not submit it for the IDP track.

## Things that are deliberately strict

**Chain writes simulate first.** `writeAndConfirm` in `api/src/chain.ts` simulates,
sends, waits for the receipt and throws on revert. viem's `writeContract` does
none of that, so a reverting transaction used to be mined as a failure while the
API returned 201 — and the problem surfaced three steps later as an unrelated
`UnknownCandidate` at promotion time.

**Candidate ids are global.** Section 7's formula omits the project, so identical
source, binary, workload, environment scope and hypothesis produce the same id in
every project. `POST /candidates` detects a cross-project collision and refuses
with `candidate_belongs_to_another_project` rather than letting it become a
confusing revert later. See `contracts/README.md` for the spec tension.

**The job log is append-only.** `job_events` is never updated or deleted, because
section 7 requires the experiment log keep every attempt including the rejected
ones, and a log you can edit is a log that can be tidied.

**One proposal per digest.** `proposals.digest` is `UNIQUE`, so a restarted
service cannot produce two chances to publish one approval.

## Sleep

The laptop closing is a normal event, not an error, and each process handles it:

- **Consumer** measures real elapsed time rather than trusting its timer, says so
  when it finds a gap, retries quickly after a wake instead of waiting a full
  cycle, and — most importantly — **falls back to the baseline when its last
  confirmed read is older than `GPUVTEC_MAX_STALE_MS`**. While it cannot reach
  the chain it cannot know whether the release was revoked, and section 8 says
  uncertain state means the baseline.
- **API** sends `retry: 2000` on the SSE stream so browsers reconnect quickly,
  sends keep-alive frames so half-open sockets get noticed, replays the log from
  `?after=` so a reconnecting client sees what it missed, and cleans up listeners
  and intervals on disconnect.
- **Dashboard** polls rather than holding a stream, and re-checks immediately on
  `visibilitychange` and `online` so the first thing a returning user sees is
  current.
