#[test_only]
module vtec::vault_tests;

use sui::clock;
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::test_scenario::{Self as ts, Scenario};
use vtec::admin::{Self, AdminCap};
use vtec::human::{Self, HumanPass, Humans};
use vtec::market::{Self, License, Listing, Market};
use vtec::royalty::Challenge;
use vtec::vault::{Self, Vault};

const ADMIN: address = @0xA;
const TUNER: address = @0xB;
const BUYER: address = @0xF;
const ONE_SUI: u64 = 1_000_000_000;
const FEE: u64 = 10_000_000; // 0.01 SUI

fun setup(): Scenario {
    let mut s = ts::begin(ADMIN);
    admin::init_for_testing(s.ctx());
    vault::init_for_testing(s.ctx());
    human::init_for_testing(s.ctx());
    market::init_for_testing(s.ctx());
    s
}

/// Admin mints a HumanPass to `who` (what the backend does after World ID).
fun verify_human(s: &mut Scenario, who: address, nullifier: vector<u8>) {
    s.next_tx(ADMIN);
    let cap = s.take_from_sender<AdminCap>();
    let mut humans = s.take_shared<Humans>();
    human::mint(&cap, &mut humans, who, nullifier, s.ctx());
    ts::return_shared(humans);
    s.return_to_sender(cap);
}

fun take_coin(s: &mut Scenario, who: address): u64 {
    s.next_tx(who);
    let c = s.take_from_sender<Coin<SUI>>();
    let v = c.value();
    s.return_to_sender(c);
    v
}

// === HumanPass ===

#[test]
fun world_id_mints_one_pass() {
    let mut s = setup();
    verify_human(&mut s, TUNER, b"null-1");
    s.next_tx(TUNER);
    assert!(s.has_most_recent_for_sender<HumanPass>());
    s.end();
}

#[test, expected_failure(abort_code = human::EAlreadyVerified)]
fun same_human_cannot_get_a_second_pass() {
    let mut s = setup();
    verify_human(&mut s, TUNER, b"null-1");
    verify_human(&mut s, BUYER, b"null-1");
    s.end();
}

// === Process fee (needs a HumanPass) ===

fun pay_fee_as_tuner(s: &mut Scenario, key: vector<u8>, amount: u64) {
    s.next_tx(TUNER);
    let pass = s.take_from_sender<HumanPass>();
    let mut v = s.take_shared<Vault>();
    vault::pay_fee(&mut v, &pass, key, coin::mint_for_testing<SUI>(amount, s.ctx()), s.ctx());
    ts::return_shared(v);
    s.return_to_sender(pass);
}

#[test]
fun fee_is_split_between_verifiers() {
    let mut s = setup();
    verify_human(&mut s, TUNER, b"null-1");
    pay_fee_as_tuner(&mut s, b"ap-1", FEE);

    s.next_tx(ADMIN);
    let cap = s.take_from_sender<AdminCap>();
    let mut v = s.take_shared<Vault>();
    vault::distribute_fee(&cap, &mut v, b"ap-1", vector[@0xC, @0xD, @0xE], s.ctx());
    assert!(!vault::fee_paid(&v, b"ap-1"));
    ts::return_shared(v);
    s.return_to_sender(cap);

    // 10_000_000 / 3 = 3_333_333 each; the first recipient takes the remainder.
    assert!(take_coin(&mut s, @0xD) == 3_333_333);
    assert!(take_coin(&mut s, @0xC) == 3_333_334);
    s.end();
}

#[test, expected_failure(abort_code = vault::EWrongAmount)]
fun wrong_fee_is_rejected() {
    let mut s = setup();
    verify_human(&mut s, TUNER, b"null-1");
    pay_fee_as_tuner(&mut s, b"ap-1", ONE_SUI);
    s.end();
}

#[test, expected_failure(abort_code = vault::EAlreadyPaid)]
fun fee_cannot_be_paid_twice() {
    let mut s = setup();
    verify_human(&mut s, TUNER, b"null-1");
    pay_fee_as_tuner(&mut s, b"ap-1", FEE);
    pay_fee_as_tuner(&mut s, b"ap-1", FEE);
    s.end();
}

#[test]
fun fee_refund_returns_to_payer() {
    let mut s = setup();
    verify_human(&mut s, TUNER, b"null-1");
    pay_fee_as_tuner(&mut s, b"ap-1", FEE);

    s.next_tx(ADMIN);
    let cap = s.take_from_sender<AdminCap>();
    let mut v = s.take_shared<Vault>();
    vault::refund_fee(&cap, &mut v, b"ap-1", s.ctx());
    ts::return_shared(v);
    s.return_to_sender(cap);

    assert!(take_coin(&mut s, TUNER) == FEE);
    s.end();
}

// === Stakes (kept for the dethrone flow) ===

#[test]
fun stake_then_release_returns_funds() {
    let mut s = setup();
    s.next_tx(TUNER);
    let mut v = s.take_shared<Vault>();
    vault::stake(&mut v, b"sub-1", coin::mint_for_testing<SUI>(ONE_SUI, s.ctx()), s.ctx());
    ts::return_shared(v);

    s.next_tx(ADMIN);
    let cap = s.take_from_sender<AdminCap>();
    let mut v = s.take_shared<Vault>();
    vault::release(&cap, &mut v, b"sub-1", s.ctx());
    ts::return_shared(v);
    s.return_to_sender(cap);

    assert!(take_coin(&mut s, TUNER) == ONE_SUI);
    s.end();
}

// === Buying a kernel: pay + split + license in one call ===

fun list_kernel(s: &mut Scenario, price: u64) {
    s.next_tx(ADMIN);
    let cap = s.take_from_sender<AdminCap>();
    market::list(&cap, b"rmsnorm-4096", b"sub_1", b"sha", TUNER, @0x1E, TUNER, @0x1E, price, s.ctx());
    s.return_to_sender(cap);
}

fun buy_as(s: &mut Scenario, buyer: address, amount: u64) {
    s.next_tx(buyer);
    let listing = s.take_shared<Listing>();
    let m = s.take_shared<Market>();
    let royalties = s.take_shared<Challenge>();
    let clk = clock::create_for_testing(s.ctx());
    market::buy(&listing, &m, &royalties, coin::mint_for_testing<SUI>(amount, s.ctx()), &clk, s.ctx());
    clk.destroy_for_testing();
    ts::return_shared(listing);
    ts::return_shared(m);
    ts::return_shared(royalties);
}

#[test]
fun buy_splits_payment_and_mints_license() {
    let mut s = setup();
    list_kernel(&mut s, ONE_SUI);
    buy_as(&mut s, BUYER, ONE_SUI);

    // 70% tuner, 20% lineage, 10% platform (the publisher).
    assert!(take_coin(&mut s, TUNER) == 700_000_000);
    assert!(take_coin(&mut s, @0x1E) == 200_000_000);
    assert!(take_coin(&mut s, ADMIN) == 100_000_000);

    s.next_tx(BUYER);
    let license = s.take_from_sender<License>();
    assert!(market::license_kernel(&license) == b"sub_1");
    assert!(market::license_expires_ms(&license) == 30 * 24 * 60 * 60 * 1000);
    s.return_to_sender(license);
    s.end();
}

#[test, expected_failure(abort_code = market::EWrongPrice)]
fun buy_with_wrong_price_fails() {
    let mut s = setup();
    list_kernel(&mut s, ONE_SUI);
    buy_as(&mut s, BUYER, ONE_SUI / 2);
    s.end();
}

#[test, expected_failure(abort_code = market::ENotListed)]
fun retired_listing_cannot_be_bought() {
    let mut s = setup();
    list_kernel(&mut s, ONE_SUI);
    s.next_tx(ADMIN);
    let cap = s.take_from_sender<AdminCap>();
    let mut listing = s.take_shared<Listing>();
    market::retire(&cap, &mut listing);
    ts::return_shared(listing);
    s.return_to_sender(cap);
    buy_as(&mut s, BUYER, ONE_SUI);
    s.end();
}
