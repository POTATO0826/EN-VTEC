#[test_only]
module vtec::royalty_tests;

use sui::clock;
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::test_scenario::{Self as ts, Scenario};
use vtec::admin::{Self, AdminCap};
use vtec::market::{Self, Market, Listing};
use vtec::royalty::{Self, Challenge, RoyaltyBadge};

const ADMIN: address = @0xA;
const OLD: address = @0xB;
const NEW: address = @0xC;

fun setup(): Scenario {
    let mut s = ts::begin(ADMIN);
    admin::init_for_testing(s.ctx());
    market::init_for_testing(s.ctx());
    s.next_tx(ADMIN);
    let cap = s.take_from_sender<AdminCap>();
    market::list(&cap, b"track", b"kernel", b"sha", OLD, @0xD, OLD, @0xD, 1_000_000, s.ctx());
    s.return_to_sender(cap);
    s
}

fun recover(s: &mut Scenario, generation: u64, destination: address) {
    s.next_tx(ADMIN);
    let cap = s.take_from_sender<AdminCap>();
    let mut c = s.take_shared<Challenge>();
    royalty::recover(&cap, &mut c, OLD, generation, destination, b"verified-request", s.ctx());
    ts::return_shared(c);
    s.return_to_sender(cap);
}

#[test]
fun recovery_revokes_old_badge_and_redirects_next_sale() {
    let mut s = setup();
    s.next_tx(OLD);
    let old = s.take_from_sender<RoyaltyBadge>();
    let c = s.take_shared<Challenge>();
    assert!(royalty::badge_valid(&c, &old));
    ts::return_shared(c);
    s.return_to_sender(old);

    // The old wallet never signs or supplies its badge to this transaction.
    recover(&mut s, 0, NEW);
    s.next_tx(OLD);
    let old = s.take_from_sender<RoyaltyBadge>();
    let c = s.take_shared<Challenge>();
    assert!(!royalty::badge_valid(&c, &old));
    assert!(royalty::payout(&c, OLD) == NEW);
    ts::return_shared(c);
    s.return_to_sender(old);

    s.next_tx(NEW);
    let badge = s.take_from_sender<RoyaltyBadge>();
    let c = s.take_shared<Challenge>();
    assert!(royalty::badge_valid(&c, &badge));
    ts::return_shared(c);
    s.return_to_sender(badge);

    s.next_tx(@0xF);
    let listing = s.take_shared<Listing>();
    let m = s.take_shared<Market>();
    let c = s.take_shared<Challenge>();
    let clk = clock::create_for_testing(s.ctx());
    market::buy(&listing, &m, &c, coin::mint_for_testing<SUI>(1_000_000, s.ctx()), &clk, s.ctx());
    clk.destroy_for_testing();
    ts::return_shared(listing);
    ts::return_shared(m);
    ts::return_shared(c);

    s.next_tx(NEW);
    let payment = s.take_from_sender<Coin<SUI>>();
    assert!(payment.value() == 700_000);
    s.return_to_sender(payment);
    s.next_tx(OLD);
    assert!(!s.has_most_recent_for_sender<Coin<SUI>>());
    s.end();
}

#[test, expected_failure(abort_code = royalty::EStaleRecovery)]
fun stale_recovery_cannot_undo_a_newer_one() {
    let mut s = setup();
    recover(&mut s, 0, NEW);
    recover(&mut s, 0, @0xE);
    s.end();
}

#[test, expected_failure(abort_code = royalty::EInvalidAddress)]
fun zero_destination_is_rejected() {
    let mut s = setup();
    recover(&mut s, 0, @0x0);
    s.end();
}

#[test, expected_failure(abort_code = royalty::EUnknownTuner)]
fun cannot_recover_another_identity() {
    let mut s = setup();
    s.next_tx(ADMIN);
    let cap = s.take_from_sender<AdminCap>();
    let mut c = s.take_shared<Challenge>();
    royalty::recover(&cap, &mut c, @0xBAD, 0, NEW, b"request", s.ctx());
    ts::return_shared(c);
    s.return_to_sender(cap);
    s.end();
}

#[test]
fun repeated_recovery_requires_current_generation() {
    let mut s = setup();
    recover(&mut s, 0, NEW);
    recover(&mut s, 1, @0xE);
    s.next_tx(@0xE);
    let c = s.take_shared<Challenge>();
    let badge = s.take_from_sender<RoyaltyBadge>();
    assert!(royalty::badge_valid(&c, &badge));
    assert!(royalty::payout(&c, OLD) == @0xE);
    ts::return_shared(c);
    s.return_to_sender(badge);
    s.end();
}

#[test]
fun recover_multiple_allocations_in_one_transaction() {
    let mut s = setup();
    s.next_tx(ADMIN);
    let c = s.take_shared<Challenge>();
    let first = object::id(&c);
    ts::return_shared(c);
    let second = royalty::create(b"track-2", b"kernel-2", OLD, OLD, @0xD, @0xD, s.ctx());
    s.next_tx(ADMIN);
    let cap = s.take_from_sender<AdminCap>();
    let mut a = s.take_shared_by_id<Challenge>(first);
    let mut b = s.take_shared_by_id<Challenge>(second);
    royalty::recover(&cap, &mut a, OLD, 0, NEW, b"one-request", s.ctx());
    royalty::recover(&cap, &mut b, OLD, 0, NEW, b"one-request", s.ctx());
    assert!(royalty::payout(&a, OLD) == NEW);
    assert!(royalty::payout(&b, OLD) == NEW);
    ts::return_shared(a);
    ts::return_shared(b);
    s.return_to_sender(cap);
    s.end();
}

#[test, expected_failure(abort_code = market::EWrongChallenge)]
fun buyer_cannot_substitute_a_different_royalty_split() {
    let mut s = setup();
    s.next_tx(ADMIN);
    royalty::create(b"other", b"other", @0xF, @0xF, @0xF, @0xF, s.ctx());
    s.next_tx(@0xF);
    let listing = s.take_shared<Listing>();
    let market = s.take_shared<Market>();
    let wrong = s.take_shared<Challenge>();
    let clk = clock::create_for_testing(s.ctx());
    market::buy(&listing, &market, &wrong, coin::mint_for_testing<SUI>(1_000_000, s.ctx()), &clk, s.ctx());
    clk.destroy_for_testing();
    ts::return_shared(listing);
    ts::return_shared(market);
    ts::return_shared(wrong);
    s.end();
}
