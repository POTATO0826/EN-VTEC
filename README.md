# VTEC

Tuned local agents for Web3 workloads. Real humans verify every result (World ID), stakes and royalties settle on Sui, names on ENSv2.

## Flow

1. **Get started** (`/`): hardware → task → World ID (optional) → pair the local agent
2. **Tuners** (`/tuners`): approve a submission (World ID if verified, otherwise stake SUI with Slush) → agent submits the exact code + SHA-256 → **pending**
3. **Verify** (`/verify`): 5 verifiers drawn with Sui on-chain randomness → each approves with World ID → agent checks compatibility and runs baseline vs candidate on seeded inputs → commit, then reveal → 3 of 5 agree = **verified** (stake released) or **rejected** (stake forfeited to verifiers)
4. **Ranking** (`/ranking`): Kernel Code Efficiency Ranking, verified only → subscribe with ENSv2 (preview) → pay the tuner a SUI royalty → download the verified code

## Run it

```bash
bun install
cp .env.example .env.local        # fill in World values
bun scripts/publish-sui.ts        # publishes move/vtec, writes Sui ids into .env.local
bun dev                           # http://127.0.0.1:3000
```

Agent (from the project folder):

```bash
bun agent/vtec-agent.ts pair <CODE>
bun agent/vtec-agent.ts submit <CODE> --track ens-namehash --build tracks/ens-namehash/parallel
bun agent/vtec-agent.ts verify <CODE>
```

## Pieces

| Part | Where |
|---|---|
| Move contract (stake, draw, royalty) + tests | `move/vtec` (`.tools/sui/sui.exe move test`) |
| Verification engine | `src/lib/server/verification.ts` |
| Local agent + harness | `agent/vtec-agent.ts` |
| Benchmark builds | `tracks/<track>/<build>/vtec.json` |
| World ID (seat + approvals) | `src/lib/server/world.ts` |

State is kept in `.data/` for now.
