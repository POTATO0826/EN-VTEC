# Opti-On: Sui contract + PTB demo

The money side of Opti-On, on Sui testnet:

- **Stake.** A tuner locks a small stake when submitting a kernel. Only the kernel's hash goes on-chain.
- **AdminCap.** Only the holder of the AdminCap (our backend wallet) can set which kernel is #1.
- **Settle PTB.** After 3 of 5 verifiers agree, ONE transaction does 3 things: it returns the stake, pays the verifiers, and sets the kernel as #1. If one step fails, none of them happen.
- **Buy.** The buyer pays in one transaction. The #1 tuner's share is credited to their royalties, and Opti-On keeps 2.5%.
- **Claim.** The backend sends a tuner's royalties to a payout wallet, after the World ID session check (see the TODO).

The harness, the verifiers and the World ID check run off-chain in our backend. This package is only the on-chain part.

```
move/sources/market.move      the contract
move/tests/market_tests.move  3 unit tests (full flow, PTB abort, buy before #1)
scripts/opti.ts               demo CLI (Sui TypeScript SDK v2, gRPC)
```

Tested: `sui move test` passes 3/3. Every `opti.ts` command was run end to end on a local Sui network (CLI 1.80.1).

---

## 1. Deploy to testnet (about 10 min)

You need the Sui CLI, version 1.60 or newer (`brew install sui`, or see docs.sui.io "Install Sui").

```bash
sui client switch --env testnet
sui client active-address          # this wallet becomes the backend and will own the AdminCap
sui client faucet                  # or use https://faucet.sui.io with that address

cd move
sui move test
sui client publish
```

In the publish output, copy:

- **PackageID** (under "Published Objects")
- the object ID whose type ends in `::market::AdminCap` (under "Created Objects")

## 2. Make demo wallets

```bash
sui client new-address ed25519 tuner
sui client new-address ed25519 buyer
sui client new-address ed25519 attacker
sui client new-address ed25519 v1      # verifiers only receive SUI, no funding needed
sui client new-address ed25519 v2
sui client new-address ed25519 v3

# give tuner, buyer and attacker some testnet SUI (faucet or faucet.sui.io)
sui client faucet --address tuner
sui client faucet --address buyer
sui client faucet --address attacker

sui client addresses                    # shows all the addresses
sui keytool export --key-identity <alias>   # prints suiprivkey1... for each wallet
```

## 3. Configure the script

```bash
cd scripts
npm install
cp .env.example .env      # fill in PACKAGE_ID, ADMIN_CAP_ID and the 4 private keys
npx tsx opti.ts setup     # prints CHALLENGE_ID, add it to .env
```

## 4. Demo sequence (what to show judges)

```bash
npx tsx opti.ts submit my_kernel.cu        # tuner stakes, prints Submission id
npx tsx opti.ts buy                        # FAILS: no verified #1 yet
npx tsx opti.ts hack <SUBMISSION_ID>       # REJECTED: attacker doesn't own the AdminCap
npx tsx opti.ts settle <SUBMISSION_ID> <v1>,<v2>,<v3> --fail
                                           # FAILS: only 2 verifiers, so no step happens
npx tsx opti.ts status                     # #1 is still empty
npx tsx opti.ts settle <SUBMISSION_ID> <v1>,<v2>,<v3>
                                           # OK: one PTB, stake back + verifiers paid + #1 set
npx tsx opti.ts status                     # #1 = the submission
npx tsx opti.ts buy                        # OK: tuner credited, 2.5% fee kept
npx tsx opti.ts claim <TUNER_ADDR> <NEW_WALLET_ADDR>
                                           # OK: royalties paid to a new wallet
```

Every OK prints a Suiscan link. Good things to open on screen:

- **The settle transaction:** you can see SplitCoins plus 3 Move calls (`refund_stake`, `pay_verifiers`, `set_leader`) in one transaction.
- **The AdminCap object:** its owner is the backend address. That's why the `hack` command gets rejected.

What the failures look like (real output):

```
REJECTED attacker calls set_leader using our AdminCap
       Sui: ... Object 0xe9d2... is owned by account address 0x35d9..., but given owner/signer address is 0x5789...

FAILED settle PTB: refund stake + pay 2 verifiers + set #1  (break: only 2 verifiers)
       pay_verifiers aborted: ETooFewVerifiers: fewer than 3 verifiers agreed
       Sui refused the whole transaction, so none of its steps happened.
```

## 5. Hooking it into the backend

- When the harness passes and 3 of 5 verifiers agree, run the same three calls as `settle()` in `opti.ts`, with the verifiers who agreed.
- When a kernel fails, call `slash_stake`. The stake goes to Opti-On fees.
- For withdrawals, verify the World ID session proof first (session_id matches sign-up, signal = payout address, nullifier unused). Then call `claim_to`. See the TODO in `claim()`.

## Honest limits (say these if asked)

- Today the backend decides when verification passed and holds the AdminCap. Next step: the contract checks 3-of-5 verifier signatures and the World proof itself, and the AdminCap goes away.
- The World ID check is off-chain in the backend, not in Move.
- The amounts are tiny testnet values (0.01 SUI price, 0.005 SUI stake). You can change them at the top of `opti.ts`.
