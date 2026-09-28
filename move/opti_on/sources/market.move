/// Opti-On marketplace: the money side.
///
/// Off-chain: the harness checks a kernel on hidden inputs, then 5 random
/// verifiers with the same GPU re-run it and 3 must agree.
/// On-chain (this module): stakes, verifier pay, who is #1, sales, royalties.
///
/// Anyone can call a public function on Sui. The functions that decide who
/// earns money take `&AdminCap`. Only one AdminCap exists (made in `init`),
/// it is owned by the backend wallet, and Sui rejects any transaction that
/// uses an object the sender does not own. So only the backend can set #1.
module opti_on::market;

use std::string::String;
use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::event;
use sui::sui::SUI;
use sui::table::{Self, Table};

// === Errors ===
const EWrongStake: u64 = 0;
const ENoLeader: u64 = 1;
const EWrongPrice: u64 = 2;
const ENothingToClaim: u64 = 3;
const ETooFewVerifiers: u64 = 4;
const EPaymentTooSmall: u64 = 5;
const EBadFee: u64 = 6;

/// Kernels need at least 3 of 5 verifiers to agree before they can be ranked.
const MIN_VERIFIERS: u64 = 3;

// === Objects ===

/// The key. Created once when the package is published and sent to the
/// publisher (our backend wallet). No `store` ability, so it cannot be
/// transferred with public_transfer or wrapped by other modules.
public struct AdminCap has key { id: UID }

/// One challenge = one task on one GPU model, e.g. "RMSNorm" on "RTX 4090".
public struct Challenge has key {
    id: UID,
    task: String,
    gpu: String,
    /// Price a buyer pays for the #1 kernel, in MIST (1 SUI = 1_000_000_000 MIST).
    price: u64,
    /// Opti-On fee in basis points (250 = 2.5%).
    fee_bps: u64,
    /// Stake a tuner must lock when submitting.
    stake_amount: u64,
    /// Current #1 submission and the tuner who gets paid for it.
    leader: Option<ID>,
    leader_tuner: Option<address>,
    /// submission id -> tuner address (kept forever as a record).
    tuners: Table<ID, address>,
    /// submission id -> locked stake (removed on refund or slash).
    stakes: Table<ID, Balance<SUI>>,
    /// tuner address -> royalties waiting to be claimed.
    royalties: Table<address, Balance<SUI>>,
    /// Opti-On fees collected from sales and slashed stakes.
    fees: Balance<SUI>,
}

// === Events (show up on Suiscan) ===

public struct Submitted has copy, drop {
    challenge: ID,
    submission: ID,
    tuner: address,
    code_hash: vector<u8>,
}

public struct VerifiersPaid has copy, drop { count: u64, each: u64 }

public struct LeaderSet has copy, drop {
    challenge: ID,
    submission: ID,
    tuner: address,
}

public struct Purchased has copy, drop {
    challenge: ID,
    submission: ID,
    buyer: address,
    tuner: address,
    price: u64,
    fee: u64,
}

public struct Claimed has copy, drop {
    challenge: ID,
    tuner: address,
    payout: address,
    amount: u64,
}

// === Setup ===

fun init(ctx: &mut TxContext) {
    transfer::transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
}

/// Backend only: open a new challenge (task + GPU).
public fun create_challenge(
    _: &AdminCap,
    task: String,
    gpu: String,
    price: u64,
    fee_bps: u64,
    stake_amount: u64,
    ctx: &mut TxContext,
) {
    assert!(fee_bps <= 10_000, EBadFee);
    transfer::share_object(Challenge {
        id: object::new(ctx),
        task,
        gpu,
        price,
        fee_bps,
        stake_amount,
        leader: option::none(),
        leader_tuner: option::none(),
        tuners: table::new(ctx),
        stakes: table::new(ctx),
        royalties: table::new(ctx),
        fees: balance::zero(),
    });
}

// === Anyone ===

/// A tuner submits a kernel (only its hash goes on-chain) and locks a stake.
/// Anyone can do this. Submitting does NOT rank the kernel.
public fun submit(
    ch: &mut Challenge,
    code_hash: vector<u8>,
    stake: Coin<SUI>,
    ctx: &mut TxContext,
): ID {
    assert!(stake.value() == ch.stake_amount, EWrongStake);
    // Fresh unique id for this submission.
    let uid = object::new(ctx);
    let submission = uid.to_inner();
    uid.delete();

    ch.tuners.add(submission, ctx.sender());
    ch.stakes.add(submission, stake.into_balance());
    event::emit(Submitted {
        challenge: object::id(ch),
        submission,
        tuner: ctx.sender(),
        code_hash,
    });
    submission
}

/// A buyer pays for the current #1 kernel. One transaction: the tuner's share
/// is credited to their royalties right away, Opti-On keeps the fee.
public fun buy(ch: &mut Challenge, payment: Coin<SUI>, ctx: &TxContext) {
    assert!(ch.leader.is_some(), ENoLeader);
    assert!(payment.value() == ch.price, EWrongPrice);

    let mut paid = payment.into_balance();
    let fee_amount = ch.price * ch.fee_bps / 10_000;
    ch.fees.join(paid.split(fee_amount));

    let tuner = *ch.leader_tuner.borrow();
    if (ch.royalties.contains(tuner)) {
        ch.royalties.borrow_mut(tuner).join(paid);
    } else {
        ch.royalties.add(tuner, paid);
    };

    event::emit(Purchased {
        challenge: object::id(ch),
        submission: *ch.leader.borrow(),
        buyer: ctx.sender(),
        tuner,
        price: ch.price,
        fee: fee_amount,
    });
}

// === Backend only (need the AdminCap) ===
// These three are called together in ONE programmable transaction block
// after 3 of 5 verifiers agree. If any one aborts, none of them happen.

/// Step 1: give the tuner their stake back.
public fun refund_stake(
    _: &AdminCap,
    ch: &mut Challenge,
    submission: ID,
    ctx: &mut TxContext,
) {
    let stake = ch.stakes.remove(submission); // aborts if already refunded
    let tuner = *ch.tuners.borrow(submission);
    transfer::public_transfer(coin::from_balance(stake, ctx), tuner);
}

/// Step 2: split `payment` evenly between the verifiers who agreed.
/// Aborts if fewer than 3 verifiers are listed.
public fun pay_verifiers(
    _: &AdminCap,
    mut payment: Coin<SUI>,
    verifiers: vector<address>,
    ctx: &mut TxContext,
) {
    let n = verifiers.length();
    assert!(n >= MIN_VERIFIERS, ETooFewVerifiers);
    let each = payment.value() / n;
    assert!(each > 0, EPaymentTooSmall);

    let mut i = 0;
    while (i < n - 1) {
        transfer::public_transfer(payment.split(each, ctx), verifiers[i]);
        i = i + 1;
    };
    // Last verifier also gets any rounding dust.
    transfer::public_transfer(payment, verifiers[n - 1]);
    event::emit(VerifiersPaid { count: n, each });
}

/// Step 3: make this submission #1. From now on every sale pays its tuner.
public fun set_leader(_: &AdminCap, ch: &mut Challenge, submission: ID) {
    let tuner = *ch.tuners.borrow(submission); // aborts if never submitted
    ch.leader = option::some(submission);
    ch.leader_tuner = option::some(tuner);
    event::emit(LeaderSet { challenge: object::id(ch), submission, tuner });
}

/// A kernel failed the harness or verifiers: its stake goes to Opti-On.
public fun slash_stake(_: &AdminCap, ch: &mut Challenge, submission: ID) {
    let stake = ch.stakes.remove(submission);
    ch.fees.join(stake);
}

/// Send a tuner's royalties to `payout`.
/// Today the backend calls this after checking the tuner's World ID session
/// proof off-chain (same session as sign-up, proof names `payout`).
/// So a tuner who lost their key can still be paid to a new wallet.
public fun claim_to(
    _: &AdminCap,
    ch: &mut Challenge,
    tuner: address,
    payout: address,
    ctx: &mut TxContext,
) {
    assert!(ch.royalties.contains(tuner), ENothingToClaim);
    let owed = ch.royalties.remove(tuner);
    let amount = owed.value();
    transfer::public_transfer(coin::from_balance(owed, ctx), payout);
    event::emit(Claimed { challenge: object::id(ch), tuner, payout, amount });
}

/// Opti-On withdraws its collected fees (returned so a PTB can route them,
/// e.g. straight into pay_verifiers).
public fun withdraw_fees(_: &AdminCap, ch: &mut Challenge, ctx: &mut TxContext): Coin<SUI> {
    let all = ch.fees.withdraw_all();
    coin::from_balance(all, ctx)
}

// === Read-only helpers ===

public fun leader(ch: &Challenge): Option<ID> { ch.leader }

public fun royalties_of(ch: &Challenge, tuner: address): u64 {
    if (ch.royalties.contains(tuner)) ch.royalties.borrow(tuner).value() else 0
}

// === Test-only ===

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }
