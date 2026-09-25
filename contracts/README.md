# KernelReleaseRegistry

Section 8 of the build plan, implemented. This is the application + chain
workstream's first deliverable: the contract that makes publishing an optimized
kernel require three separate authorities, so **the agent that wrote the code
cannot be the thing that ships it**.

```
candidate ──> signed report ──> release proposal ──> 3 signatures ──> promote
                                                      │ evaluator
                                                      │ owner (EIP-712)
                                                      │ identity-bridge permit
                                                      ▼
                                              currentRelease[project][channel]
                                                      │
                                           revoke ──> consumer falls back
```

## Run it

```sh
cd contracts
forge test                                   # 36 tests
forge fmt --check
```

Full lifecycle against a local chain — milestone **M6's exit gate**:

```sh
anvil                                                          # terminal 1
forge script script/Lifecycle.s.sol \
  --rpc-url http://127.0.0.1:8545 --broadcast                  # terminal 2
```

That deploys, creates a project, registers a candidate, records a signed
evaluator report, promotes with owner + bridge signatures, prints what a
consumer would read, revokes, and prints again. The second read flips from
`running optimized path` to `baseline (release revoked)` — demo beats 5 and 6.

## What the tests cover

Section 12 names the cases that must fail. All of them have a test:

| Section 12 case | Test |
| --- | --- |
| Unknown candidate | `test_recordReport_unknownCandidate_reverts` |
| Wrong report signer | `test_recordReport_wrongSigner_reverts` |
| Rejected report | `test_promote_rejectedReport_reverts`, `..._inconclusiveReport_reverts` |
| Non-owner signature | `test_promote_nonOwnerSignature_reverts` |
| Wrong bridge | `test_promote_wrongBridge_reverts`, `..._ownerSigningTwiceIsNotABridgePermit` |
| Expired permit | `test_promote_expiredPermit_reverts` |
| Replayed permit | `test_promote_replayedPermit_reverts` |
| Altered artifact | `test_alteredArtifact_producesADifferentCandidateId`, `..._swappedCandidateAfterApproval_reverts` |
| Altered project | `test_promote_wrongProject_reverts` |
| Altered chain | `test_promote_signatureFromAnotherChain_reverts` |
| Stale previous release | `test_promote_stalePreviousRelease_reverts` |

Plus project/candidate validation, revocation rules, and ERC-1271 contract
owners.

## Decisions worth knowing

**Check order follows section 8 literally** — "unused nonce/permit, deadline,
current configuration, matching report, expected previous release". The permit
is consumed first. That also means an ERC-1271 owner or bridge cannot re-enter
into a second publication; a later revert rolls the consumption back, so a
refused attempt never burns a permit.

**ERC-1271 verification is a `staticcall`** in OpenZeppelin's `SignatureChecker`,
so a contract signer physically cannot write storage during verification.
`test_promote_erc1271OwnerCannotWriteStateDuringVerification` pins that. The
ordering above is defence in depth on top of it, not the only thing holding.

**Revocation preserves the record and the channel pointer.** A revoked release
stays as `currentRelease` with `status = Revoked`, so a consumer that reads the
pointer without checking status would adopt a revoked release. That is
deliberate: milestone M8 has to demonstrate the consumer *not* making that
mistake, and deleting the pointer would hide the test.

**Signers are frozen.** No rotation function. Section 8 allows rotation via
`configVersion`, but rotation has to invalidate every outstanding permit, and
that is more machinery than the first deployment needs.

**Reports are write-once.** Section 7 says independent runs produce separate
reports for the same candidate — different `observedAt` and `rawSamplesDigest`
give a different `reportHash`, so each run gets its own row and none can be
overwritten.

## Two tensions in the spec, flagged not silently resolved

1. **`candidateId` does not include `projectId`.** Section 7 gives the exact
   encoding and it omits the project, while the same section says "IDs and
   signatures must include correct project and chain context." I implemented the
   formula **as written**, because M5 requires Python, TypeScript and Solidity to
   agree byte for byte and quietly adding a field would break that. Consequence:
   candidate ids are global rather than per-project, and a second project
   registering an identical candidate reverts with `CandidateExists`. If the team
   wants project-scoped ids, change the formula in SPEC.md first and bump
   `SCHEMA_VERSION`.

2. **`registerCandidate` is owner-only.** Section 8 says "authorized author"
   without defining it. Section 9 step 10 says the candidate worker never holds
   keys, so the owner's service registers on the agent's behalf. If the team
   wants a separate author role, that is a storage change.

## Trust limits (section 8 requires these be stated)

- The contract checks the **bridge's signature**, not a World OIDC token. A
  compromised bridge could falsely assert that a human verified — the owner
  signature is still required. **Do not advertise on-chain World IDP
  verification.**
- A digest says nothing about floating-point correctness or timing. Results are
  **evaluator-attested**, never "trustlessly verified".
- The MVP evaluator is a trusted operator, not a proof that hostile native code
  cannot cheat.

## Not done yet

- **M7**: the real World IDP journey behind the bridge signature. Right now
  `Lifecycle.s.sol` uses a plain key as a stand-in, and it says so.
- **M5 cross-language vectors**: `computeCandidateId`, `computeReportHash` and
  `promotionDigest` are `public` precisely so Python and TypeScript can be tested
  against them. The shared fixture file does not exist yet.
- **M8 consumer**: section 8's "consumer on a single laptop" — a separate
  process, its own window. `_readAsConsumer` in the script is the logic sketch.
