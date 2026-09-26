/// VTEC on Sui: process fees, stake escrow, verifier draw and tuner royalties.
///
/// - Every submission pays a fixed process fee after its World ID approval.
///   The fee waits in the Vault until verification ends, then is split evenly
///   between the verifiers who actually ran the check.
/// - Users who are not World ID verified stake SUI against a submission. The
///   stake sits in the shared Vault until verification ends; then the platform
///   either releases it back to the staker or forfeits it to the reward pool.
/// - `draw` emits an on-chain random seed per submission. The platform picks the
///   verifier pool from that seed, so anyone can re-check the pick was fair.
/// - `pay_royalty` pays a tuner directly and leaves a public receipt.
module vtec::vault;

use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::event;
use sui::random::Random;
use sui::sui::SUI;
use sui::table::{Self, Table};
use vtec::admin::AdminCap;
use vtec::human::HumanPass;

// === Errors ===

const EWrongAmount: u64 = 0;
const EAlreadyStaked: u64 = 1;
const ENoStake: u64 = 2;
const EZeroPayment: u64 = 3;
const EAlreadyPaid: u64 = 4;
const ENoFee: u64 = 5;
const ENoRecipients: u64 = 6;

// === Objects ===

public struct Vault has key {
    id: UID,
    /// Stake required per submission, in MIST (1 SUI = 1_000_000_000).
    stake_amount: u64,
    /// submission key (32-byte hash) -> stake
    stakes: Table<vector<u8>, StakeEntry>,
    /// Forfeited stakes, paid out to verifiers.
    rewards: Balance<SUI>,
    /// Process fee per submission, in MIST.
    fee_amount: u64,
    /// submission key -> fee waiting to be split between its verifiers
    fees: Table<vector<u8>, FeeEntry>,
}

public struct FeeEntry has store {
    payer: address,
    balance: Balance<SUI>,
}

public struct StakeEntry has store {
    owner: address,
    balance: Balance<SUI>,
}

// === Events ===

public struct Staked has copy, drop { submission: vector<u8>, owner: address, amount: u64 }
public struct Released has copy, drop { submission: vector<u8>, owner: address, amount: u64 }
public struct Forfeited has copy, drop { submission: vector<u8>, owner: address, amount: u64 }
public struct VerifierDraw has copy, drop { submission: vector<u8>, seed: u256 }
public struct FeePaid has copy, drop { submission: vector<u8>, payer: address, amount: u64 }
public struct FeeDistributed has copy, drop { submission: vector<u8>, recipients: vector<address>, each: u64 }
public struct FeeRefunded has copy, drop { submission: vector<u8>, payer: address, amount: u64 }
public struct RoyaltyPaid has copy, drop {
    submission: vector<u8>,
    payer: address,
    tuner: address,
    amount: u64,
}

// === Setup ===

fun init(ctx: &mut TxContext) {
    transfer::share_object(Vault {
        id: object::new(ctx),
        stake_amount: 1_000_000_000,
        stakes: table::new(ctx),
        rewards: balance::zero(),
        fee_amount: 10_000_000,
        fees: table::new(ctx),
    });
}

// === Process fees ===

/// Pay the process fee for one submission. Exactly `fee_amount`, once.
/// Needs the payer's HumanPass: owned objects can only be used by their owner,
/// so this is the chain itself checking the payer passed World ID.
public fun pay_fee(vault: &mut Vault, _pass: &HumanPass, submission: vector<u8>, payment: Coin<SUI>, ctx: &TxContext) {
    let amount = payment.value();
    assert!(amount == vault.fee_amount, EWrongAmount);
    assert!(!vault.fees.contains(submission), EAlreadyPaid);
    vault.fees.add(submission, FeeEntry { payer: ctx.sender(), balance: payment.into_balance() });
    event::emit(FeePaid { submission, payer: ctx.sender(), amount });
}

/// Verification finished: split the fee evenly between the verifiers who ran
/// it. Any remainder from rounding goes to the first recipient.
public fun distribute_fee(
    _: &AdminCap,
    vault: &mut Vault,
    submission: vector<u8>,
    recipients: vector<address>,
    ctx: &mut TxContext,
) {
    assert!(vault.fees.contains(submission), ENoFee);
    let n = recipients.length();
    assert!(n > 0, ENoRecipients);
    let FeeEntry { payer: _, mut balance } = vault.fees.remove(submission);
    let each = balance.value() / n;
    let mut i = n;
    while (i > 1) {
        i = i - 1;
        transfer::public_transfer(coin::from_balance(balance.split(each), ctx), recipients[i]);
    };
    transfer::public_transfer(coin::from_balance(balance, ctx), recipients[0]);
    event::emit(FeeDistributed { submission, recipients, each });
}

/// Nobody could verify it: give the fee back.
public fun refund_fee(_: &AdminCap, vault: &mut Vault, submission: vector<u8>, ctx: &mut TxContext) {
    assert!(vault.fees.contains(submission), ENoFee);
    let FeeEntry { payer, balance } = vault.fees.remove(submission);
    let amount = balance.value();
    transfer::public_transfer(coin::from_balance(balance, ctx), payer);
    event::emit(FeeRefunded { submission, payer, amount });
}

public fun set_fee_amount(_: &AdminCap, vault: &mut Vault, amount: u64) {
    vault.fee_amount = amount;
}

// === Staking ===

/// Lock exactly `stake_amount` against a submission.
public fun stake(vault: &mut Vault, submission: vector<u8>, payment: Coin<SUI>, ctx: &TxContext) {
    let amount = payment.value();
    assert!(amount == vault.stake_amount, EWrongAmount);
    assert!(!vault.stakes.contains(submission), EAlreadyStaked);

    vault.stakes.add(submission, StakeEntry { owner: ctx.sender(), balance: payment.into_balance() });
    event::emit(Staked { submission, owner: ctx.sender(), amount });
}

/// Verification passed (or the submission was withdrawn): give the stake back.
public fun release(_: &AdminCap, vault: &mut Vault, submission: vector<u8>, ctx: &mut TxContext) {
    assert!(vault.stakes.contains(submission), ENoStake);
    let StakeEntry { owner, balance } = vault.stakes.remove(submission);
    let amount = balance.value();
    transfer::public_transfer(coin::from_balance(balance, ctx), owner);
    event::emit(Released { submission, owner, amount });
}

/// Verification failed: the stake moves to the verifier reward pool.
public fun forfeit(_: &AdminCap, vault: &mut Vault, submission: vector<u8>) {
    assert!(vault.stakes.contains(submission), ENoStake);
    let StakeEntry { owner, balance } = vault.stakes.remove(submission);
    let amount = balance.value();
    vault.rewards.join(balance);
    event::emit(Forfeited { submission, owner, amount });
}

/// Pay a verifier out of the reward pool.
public fun reward(_: &AdminCap, vault: &mut Vault, to: address, amount: u64, ctx: &mut TxContext) {
    transfer::public_transfer(coin::take(&mut vault.rewards, amount, ctx), to);
}

public fun set_stake_amount(_: &AdminCap, vault: &mut Vault, amount: u64) {
    vault.stake_amount = amount;
}

// === Verifier draw ===

/// Emits a fresh random seed for a submission. `entry` (not `public`) so the
/// randomness can't be read and acted on by another call in the same
/// transaction.
entry fun draw(r: &Random, submission: vector<u8>, ctx: &mut TxContext) {
    let mut generator = r.new_generator(ctx);
    event::emit(VerifierDraw { submission, seed: generator.generate_u256() });
}

// === Royalties ===

/// Pay a tuner for using their verified code. Goes straight to the tuner.
public fun pay_royalty(submission: vector<u8>, tuner: address, payment: Coin<SUI>, ctx: &TxContext) {
    let amount = payment.value();
    assert!(amount > 0, EZeroPayment);
    transfer::public_transfer(payment, tuner);
    event::emit(RoyaltyPaid { submission, payer: ctx.sender(), tuner, amount });
}

// === Reads ===

public fun stake_amount(vault: &Vault): u64 { vault.stake_amount }
public fun fee_amount(vault: &Vault): u64 { vault.fee_amount }
public fun fee_paid(vault: &Vault, submission: vector<u8>): bool { vault.fees.contains(submission) }
public fun is_staked(vault: &Vault, submission: vector<u8>): bool { vault.stakes.contains(submission) }

// === Tests ===

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }
