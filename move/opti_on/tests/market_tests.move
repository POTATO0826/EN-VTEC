#[test_only]
module opti_on::market_tests;

use opti_on::market::{Self, AdminCap, Challenge};
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::test_scenario as ts;

const BACKEND: address = @0xB;
const TUNER: address = @0x7;
const NEW_WALLET: address = @0x8;
const BUYER: address = @0xC;
const V1: address = @0x11;
const V2: address = @0x12;
const V3: address = @0x13;

const PRICE: u64 = 1_000_000_000; // 1 SUI
const STAKE: u64 = 100_000_000; // 0.1 SUI

fun setup(): (ts::Scenario, ID) {
    let mut s = ts::begin(BACKEND);
    market::init_for_testing(s.ctx());
    s.next_tx(BACKEND);
    {
        let cap = s.take_from_sender<AdminCap>();
        market::create_challenge(&cap, b"RMSNorm".to_string(), b"RTX 4090".to_string(), PRICE, 250, STAKE, s.ctx());
        s.return_to_sender(cap);
    };
    s.next_tx(TUNER);
    let sub = {
        let mut ch = s.take_shared<Challenge>();
        let stake = coin::mint_for_testing<SUI>(STAKE, s.ctx());
        let id = market::submit(&mut ch, b"sha256:abc", stake, s.ctx());
        ts::return_shared(ch);
        id
    };
    (s, sub)
}

#[test]
fun full_flow() {
    let (mut s, sub) = setup();

    // Backend settles: refund stake, pay 3 verifiers, set #1.
    s.next_tx(BACKEND);
    {
        let cap = s.take_from_sender<AdminCap>();
        let mut ch = s.take_shared<Challenge>();
        market::refund_stake(&cap, &mut ch, sub, s.ctx());
        let pay = coin::mint_for_testing<SUI>(30, s.ctx());
        market::pay_verifiers(&cap, pay, vector[V1, V2, V3], s.ctx());
        market::set_leader(&cap, &mut ch, sub);
        assert!(market::leader(&ch) == option::some(sub));
        ts::return_shared(ch);
        s.return_to_sender(cap);
    };

    // Tuner got the stake back, each verifier got 10.
    s.next_tx(TUNER);
    {
        let c = s.take_from_address<Coin<SUI>>(TUNER);
        assert!(c.value() == STAKE);
        ts::return_to_address(TUNER, c);
        let v = s.take_from_address<Coin<SUI>>(V1);
        assert!(v.value() == 10);
        ts::return_to_address(V1, v);
    };

    // Buyer buys: tuner credited 97.5%, fee 2.5%.
    s.next_tx(BUYER);
    {
        let mut ch = s.take_shared<Challenge>();
        let pay = coin::mint_for_testing<SUI>(PRICE, s.ctx());
        market::buy(&mut ch, pay, s.ctx());
        assert!(market::royalties_of(&ch, TUNER) == PRICE * 9750 / 10_000);
        ts::return_shared(ch);
    };

    // Tuner lost their key: backend pays royalties to a new wallet after World ID check.
    s.next_tx(BACKEND);
    {
        let cap = s.take_from_sender<AdminCap>();
        let mut ch = s.take_shared<Challenge>();
        market::claim_to(&cap, &mut ch, TUNER, NEW_WALLET, s.ctx());
        assert!(market::royalties_of(&ch, TUNER) == 0);
        ts::return_shared(ch);
        s.return_to_sender(cap);
    };
    s.next_tx(NEW_WALLET);
    {
        let c = s.take_from_address<Coin<SUI>>(NEW_WALLET);
        assert!(c.value() == PRICE * 9750 / 10_000);
        ts::return_to_address(NEW_WALLET, c);
    };
    s.end();
}

/// Only 2 verifiers -> pay_verifiers aborts. In a real PTB this cancels the
/// refund and set_leader too.
#[test, expected_failure(abort_code = market::ETooFewVerifiers)]
fun too_few_verifiers_aborts() {
    let (mut s, sub) = setup();
    s.next_tx(BACKEND);
    let cap = s.take_from_sender<AdminCap>();
    let mut ch = s.take_shared<Challenge>();
    market::refund_stake(&cap, &mut ch, sub, s.ctx());
    let pay = coin::mint_for_testing<SUI>(30, s.ctx());
    market::pay_verifiers(&cap, pay, vector[V1, V2], s.ctx());
    market::set_leader(&cap, &mut ch, sub);
    ts::return_shared(ch);
    s.return_to_sender(cap);
    s.end();
}

/// Nobody can buy before a kernel has been verified and set as #1.
#[test, expected_failure(abort_code = market::ENoLeader)]
fun cannot_buy_without_leader() {
    let (mut s, _sub) = setup();
    s.next_tx(BUYER);
    let mut ch = s.take_shared<Challenge>();
    let pay = coin::mint_for_testing<SUI>(PRICE, s.ctx());
    market::buy(&mut ch, pay, s.ctx());
    ts::return_shared(ch);
    s.end();
}
