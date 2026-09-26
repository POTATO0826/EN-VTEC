# VTEC

**A marketplace where GPU kernels for local AI are verified on other people's hardware before anyone pays, and tuners earn every time their work is used.**

## The problem

Local AI on consumer GPUs runs slower than it could, because default GPU code is generic, not tuned for your card. People who can tune it have no way to get paid continuously, and users can't tell real speedups from fake ones. Sakana AI's claimed 100× speedup turned out to be the AI cheating the benchmark.

VTEC checks every claimed speedup on independent hardware before money moves, and pays tuners each time someone licenses their kernel.

## Why each technology

| Tech | The one problem it solves |
|---|---|
| **Harness + random verifiers** | "Is this speedup real?" Each verifier re-runs the kernel against the baseline on fresh random inputs and checks the output itself. Fake claims get caught before money moves. |
| **World ID** | "Is this one real person?" One human = one seat, and every submission and every verification is approved by a real person, so nobody can flood it with bots. |
| **Sui** | "Did everyone get paid correctly, at the same moment?" Buying a kernel is **one PTB**: payment, the 70/20/10 split and a non-transferable License happen together or not at all. |

**Why not just a database?** For the license alone, a database would work. We put it on Sui so payment and license are one atomic action, and nobody, including us, can quietly take back what you bought.

## How it works

```
Get started   connect Slush -> World ID (proof bound to that wallet) -> HumanPass minted on Sui -> pair local agent
Submit        approve with World ID -> pay 0.01 SUI process fee (needs your HumanPass) -> agent uploads exact code + SHA-256
Verify        verifiers drawn with Sui on-chain randomness -> each re-runs baseline vs candidate on seeded inputs
              -> commit, then reveal -> majority decides -> fee split on-chain between the verifiers who ran it
Buy           one PTB: pay -> 70% tuner / 20% lineage / 10% platform -> License minted to the buyer's wallet
Download      sign a message with Slush -> backend checks the signature + License ownership on Sui -> one-use link (2 min)
```

While the verifier pool is small, a **platform harness** (the same agent, run by the platform on its own GPU) stands in, and the UI says so.

### The demo that matters: RMSNorm on an RTX 4060 Laptop GPU

| Build | What it is | Harness verdict |
|---|---|---|
| `baseline` | Generic, unfused (square, mean, rsqrt, multiply as separate GPU passes) | reference, ~4.8 s |
| auto-tuned | **The agent's own run on this GPU:** random variants of a fused kernel (threads × load path), each checked against the baseline and timed; the fastest correct one is submitted. Verified at **2.48×** |
| `tuned` | One fused kernel: float4 loads + warp-shuffle reduction | **✅ 2.55× faster, same output on every seed, noise ±0.8%. Verified, listed on Sui** |
| `wrong-fast` | Skips the reduction: 4.8× "faster" | **❌ Different output on every seed. Rejected** |

## Sui (package `vtec`, testnet)

| Module | What it does |
|---|---|
| `human` | `HumanPass`: minted after a World ID proof, one per human (keyed by nullifier). `key` only, no `store`: it can't be transferred. |
| `vault` | `pay_fee` takes the payer's `&HumanPass` (owned objects can only be used by their owner, so the chain checks World ID). `distribute_fee` splits it between verifiers. `draw` emits an on-chain random seed for picking verifiers. |
| `market` | `list` (platform, once verified), `buy` (pay + split + mint `License` in one call), `retire`. |

`License` and `HumanPass` have `key` but not `store`. Confirmed with the compiler: `transfer::public_transfer` fails with *"does not have the ability 'store'"*, and `transfer::transfer` fails with *"restricted to being called in the object's module"*. There is no transfer function in the module, so there's no resale.

Tests: `.tools/sui/sui.exe move test` in `move/vtec` (10 tests: fee split, HumanPass uniqueness, buy split + license, wrong price, retired listing, …).

## World ID

**Recoverable earnings:** `/earnings` lets tuners enroll a World Selfie Check
session while their wallet is secure, then prove that same session to redirect
future royalty payments after losing the old keys. The backend checks the saved
session, destination-bound signal and unused proof stamp before using its Sui
AdminCap. One PTB updates the affected Challenges, invalidates old non-transferable
RoyaltyBadges and mints replacements. See [setup, trust model and demo](docs/earnings-recovery.md).

This feature requires a fresh deployment of the updated Move package and new
listings; existing deployed listings do not gain recovery automatically.

- **IDKit 4.x, Proof of Human.** The seat claim's signal is the user's Sui address, so the proof binds World ID to that wallet. The server verifies it at `developer.world.org/api/v4/verify` and mints the HumanPass.
- **Human in the loop for the agent.** Every submission and every verification needs its own World ID approval, with action `vtec-submit:<track>:<id>` or `vtec-verify:<submission>:<id>`, and each can be used once.
- **Denied path.** If the user declines in World App, or has no Proof of Human, the UI says so and nothing is approved.

## Setup

```bash
bun install
cp .env.example .env.local           # World app id, rp id, signing key
bun scripts/publish-sui.ts           # publishes move/vtec, writes the Sui ids + admin key into .env.local
python -m venv .venv && .venv/Scripts/pip install "cupy-cuda12x[ctk]" numpy   # for the CUDA tracks
bun dev                              # http://127.0.0.1:3000
```

Agent (in the project folder):

```bash
bun agent/vtec-agent.ts pair <CODE>
bun agent/vtec-agent.ts submit <CODE> --track rmsnorm-4096          # agent auto-tunes a kernel on this GPU
bun agent/vtec-agent.ts submit <CODE> --track rmsnorm-4096 --build tracks/rmsnorm-4096/tuned
bun agent/vtec-agent.ts verify <CODE>
```

## Testing

- **Move:** `cd move/vtec && ../../.tools/sui/sui.exe move test`
- **Kernels:** submit `tracks/rmsnorm-4096/tuned` (verified) and `tracks/rmsnorm-4096/wrong-fast` (rejected). Click the submission to see each verifier's runs, speedup and verdict.
- **Download:** on the Ranking, buy a license, then "Sign & download". Without a License you get 403; with a signature from another wallet, 401; reusing a link gives 410.

## Repo map

| Part | Where |
|---|---|
| Local agent + harness | `agent/vtec-agent.ts` |
| Tracks and builds | `tracks/<track>/<build>/vtec.json`, `tracks/<track>/track.json` |
| Verification engine | `src/lib/server/verification.ts`, `src/lib/server/harness.ts` |
| Sui client (server) | `src/lib/server/sui.ts` |
| World ID | `src/lib/server/world.ts` |
| Move package | `move/vtec` |

## Prizes

**World.** World session continuity protects a tuner's future royalty income:
after prior enrollment, the same World session can authorize a new payout wallet
without the old key. Selfie Check, destination binding and replay protection gate
an atomic AdminCap transaction that rotates royalty destinations and badges.
The existing HumanPass registration and agent approval flows remain separate.
See [the recovery implementation and demo](docs/earnings-recovery.md).

**Sui.** Payments *and* licensing are atomic in one PTB. There is a non-transferable License and HumanPass, on-chain randomness for picking verifiers, and fees split on-chain.

**Curvegrid: Best AI Agent Project.**
- *One-sentence summary:* VTEC is a marketplace where AI-tuned GPU kernels are verified by a local agent on independent hardware before anyone pays, and tuners earn every time their work is used.
- *MultiBaas:* not used.
- *Team:* TODO: names and social handles.
- *Setup and testing:* see above.

## Honest limits

- App state (submissions, assignments) is in `.data/vtec.json`, which is fine for the demo. For production it moves to a database.
- The platform harness verifies alone while the pool is small. That's weaker than 3 independent people, and the UI labels it.
- Roadmap: dethrone PTB (retire the old listing, pay verifiers, update the leader in one transaction), more kernels (attention, matmul).
