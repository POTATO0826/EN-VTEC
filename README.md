# VTEC

Tuned local agents for Web3 workloads. Verified by World ID, published with ENSv2 on Sepolia.

## Pages

- **Get started** (`/`): pick hardware → pick a task (ZK proving) → World ID (IDKit) → pair the local agent
- **Tuners** (`/tuners`): tracks → World ID for Agents approval → agent runs + SHA-256 → stake → leaderboard

## Run it

```bash
bun install
cp .env.example .env.local   # fill in the World values
bun dev                      # http://127.0.0.1:3000
```

Local agent (from the project folder):

```bash
bun agent/vtec-agent.ts pair <CODE>
bun agent/vtec-agent.ts submit <CODE> --track video-1080p-2min --build ./my-build --run "<command>"
```

## World ID

| Where | Product | How |
|---|---|---|
| Get started | IDKit `@worldcoin/idkit` 4.3 | Proof of Human, signal = session id, verified at `developer.world.org/api/v4/verify` |
| Tuners → submit | World ID for Agents | OIDC device flow against `sandbox.auth.world.org`, id_token checked against its JWKS |

State is kept in `.data/vtec.json` for now.
