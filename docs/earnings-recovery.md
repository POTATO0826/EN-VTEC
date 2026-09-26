# Recoverable tuner earnings

VTEC uses World session continuity to recover future royalty income after a Sui
wallet is lost or stolen. This is a persistent account recovery feature, separate
from the existing World approval buttons for agent submissions.

## Enable recovery before losing the wallet

1. Register through the existing World Proof of Human flow and obtain a HumanPass.
2. Open `/earnings`, connect that wallet, and select **Enable earnings recovery**.
3. Complete a World v4 **Selfie Check session creation** and sign the enrollment
   message with the current wallet. The signature includes the verified World
   session ID and a short-lived, server-generated request.
4. The backend saves the verified `session_id` exactly as returned by World.
   Enrollment is write-once; a later wallet signature cannot replace it.

This initial wallet signature establishes which royalty account is protected by
the session. It does not retrospectively prove that a new selfie session belongs
to the person who originally registered the HumanPass. Enroll while the wallet is
secure. An already-lost, unenrolled wallet cannot use this recovery path.

## Recover without the old key

1. Enter a known previous payout address and the new destination on `/earnings`.
2. VTEC retrieves the saved World session and issues a fresh RP signature **without
   an action**, as required for World session requests.
3. `IDKitSessionWidget` proves that existing session using a `selfie` credential.
   The signal binds the destination, identity, request ID, Sui network and package.
4. The backend checks v4 session shape, saved `session_id`, nonce, environment,
   Selfie Check schema 11, integrity bundle, and the exact signal hash. It forwards
   the full result to World's verification API and requires a successful selfie
   result, matching session and matching environment.
5. The backend normalizes both elements of `session_nullifier`, rejects reused
   stamps, and durably reserves them before signing anything with its AdminCap.
6. One PTB calls `royalty::recover` for every recorded allocation of this tuner.
   Each call checks the expected generation, changes the payout address,
   invalidates the old badge and issues a replacement. All calls succeed or all
   royalty changes roll back.
7. Only after Sui reports success does VTEC update the account's current payout.
   New listings resolve the same stable royalty identity to that current address.

The exact signed transaction bytes are journaled before broadcast. **Resume saved
operation** retries those same bytes after a timeout rather than minting a second
transaction. A confirmed failed transaction consumes the proof; retry with a new
request. Completed requests return the original receipt.

## Sui objects and economic scope

- `royalty::Challenge` is shared and holds a royalty split snapshot for **one
  kernel listing**, including track, kernel, stable tuner identities, payout
  addresses, basis points, badge IDs and generations.
- `royalty::RoyaltyBadge` has `key` and no `store`. There is no transfer function.
  It certifies the share for that Challenge. The old object remains in the old
  wallet, but `badge_valid` rejects its old ID/generation after recovery.
- `admin::AdminCap` gates payout changes. Sui trusts the backend capability;
  the Move contract does not cryptographically verify World proofs itself.
- `market::buy` verifies that the supplied Challenge belongs to its Listing and
  pays the current destinations from that Challenge, never stale Listing fields.

The existing economics remain: 70% kernel tuner, 20% predecessor, 10% platform.
When tuner and predecessor are the same identity, one badge represents 90%.
Recovery updates all of that account's recorded Challenges in a single PTB. It
must fit Sui's transaction size/object limits; the backend does not silently
split an oversized recovery into partially applied transactions. It
does not introduce perpetual shares for every historical tuner on every new
kernel; it protects the allocations the marketplace actually grants. It also
does not recover past payments, coins, licenses, HumanPasses, or agent credentials.

## Setup and deployment

Use the configured World `NEXT_PUBLIC_WLD_APP_ID`, `WLD_RP_ID` and
`RP_SIGNING_KEY`, and the existing Sui package/AdminCap environment variables.
No additional secrets are required. World session IDs are kept server-side in
`.data/recovery.json`, not on-chain; only the session being proved is returned
to the requester. Back up this file securely: it is part of the recovery trust
boundary, not disposable demo state.

**This changes the Move ABI and Listing layout.** Existing deployed objects and
old listings are not automatically migrated. For the hackathon use a fresh
testnet deployment via `bun scripts/publish-sui.ts`, a separately backed-up/fresh
demo data directory, and newly registered participants/listings. Do not point old
`.data/recovery.json` records at a new package. An upgrade/migration of a live
marketplace needs its own plan. No deployment is performed by the local tests.

For live Selfie Check tests, use the World sandbox and its supported app, with
`WLD_ENVIRONMENT=sandbox`, or configure production World verification. A simulated
staging proof is not evidence of a live selfie. The UI requests Selfie Check;
camera/liveness behavior is enforced by World. Selfie Check is medium assurance,
not an Orb-strength guarantee of one person per account. The existing Proof of
Human registration handles that separate uniqueness use case.

Run **one persistent Node server process** for this demo. The recovery ledger uses
atomic file replacement plus a process-wide lock shared with listing creation.
Before multiple replicas or real funds, move accounts, stamps and the transaction
outbox into a transactional database with uniqueness constraints and cross-process
locking. Never deploy this JSON-backed recovery ledger on ephemeral serverless
storage. The AdminCap key must remain server-only; its compromise bypasses World.

## Checks and demo

```sh
bun run typecheck
bun test tests
# From move/vtec:
../../.tools/sui/sui.exe move test
bun run build
```

Backend tests cover wrong session, wrong signal, nonce/environment mismatch,
missing selfie/integrity data, replay, expired requests, failed Portal checks,
enrollment replacement, wallet signature checks, and retrying journaled bytes.
Move tests cover badge invalidation, next-sale payout, repeated/stale recovery,
unknown identities and invalid destinations alongside existing marketplace tests.
World and Sui service calls are mocked in backend orchestration tests; these do
not replace an end-to-end run with real credentials and a deployed package.

Demo: enroll wallet A; list a verified kernel; buy and observe A's royalty; use a
new browser with no A key to recover to B through the saved World session; show
the recovery transaction; buy again and show B's payout. A different World session
and a replayed proof must not trigger an AdminCap transaction.

References: [World session proofs](https://docs.world.org/world-id/idkit/session-proofs),
[Selfie Check](https://docs.world.org/world-id/credentials/11).

Implementation: [World session verification](../src/lib/server/world-session.ts),
[recovery authorization and journal](../src/lib/server/earnings-recovery.ts),
[Sui royalty objects](../move/vtec/sources/royalty.move),
[recovery UI](../src/components/earnings/EarningsRecovery.tsx).
