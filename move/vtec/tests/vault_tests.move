#[test_only]
module vtec::vault_tests;

use sui::coin;
use sui::sui::SUI;
use sui::test_scenario as ts;
use vtec::vault::{Self, AdminCap, Vault};

const ADMIN: address = @0xA;
const TUNER: address = @0xB;
const ONE_SUI: u64 = 1_000_000_000;

fun setup(): ts::Scenario {
    let mut s = ts::begin(ADMIN);
    vault::init_for_testing(s.ctx());
    s
}

#[test]
fun stake_then_release_returns_funds() {
    let mut s = setup();

    s.next_tx(TUNER);
    let mut v = s.take_shared<Vault>();
    vault::stake(&mut v, b"sub-1", coin::mint_for_testing<SUI>(ONE_SUI, s.ctx()), s.ctx());
    assert!(vault::is_staked(&v, b"sub-1"));
    ts::return_shared(v);

    s.next_tx(ADMIN);
    let cap = s.take_from_sender<AdminCap>();
    let mut v = s.take_shared<Vault>();
    vault::release(&cap, &mut v, b"sub-1", s.ctx());
    assert!(!vault::is_staked(&v, b"sub-1"));
    ts::return_shared(v);
    s.return_to_sender(cap);

    s.next_tx(TUNER);
    let refund = s.take_from_sender<coin::Coin<SUI>>();
    assert!(refund.value() == ONE_SUI);
    s.return_to_sender(refund);
    s.end();
}

#[test, expected_failure(abort_code = vault::EWrongAmount)]
fun wrong_amount_is_rejected() {
    let mut s = setup();
    s.next_tx(TUNER);
    let mut v = s.take_shared<Vault>();
    vault::stake(&mut v, b"sub-1", coin::mint_for_testing<SUI>(ONE_SUI / 2, s.ctx()), s.ctx());
    ts::return_shared(v);
    s.end();
}

#[test, expected_failure(abort_code = vault::EAlreadyStaked)]
fun double_stake_is_rejected() {
    let mut s = setup();
    s.next_tx(TUNER);
    let mut v = s.take_shared<Vault>();
    vault::stake(&mut v, b"sub-1", coin::mint_for_testing<SUI>(ONE_SUI, s.ctx()), s.ctx());
    vault::stake(&mut v, b"sub-1", coin::mint_for_testing<SUI>(ONE_SUI, s.ctx()), s.ctx());
    ts::return_shared(v);
    s.end();
}

#[test]
fun forfeit_moves_stake_to_rewards_then_pays_verifier() {
    let mut s = setup();
    s.next_tx(TUNER);
    let mut v = s.take_shared<Vault>();
    vault::stake(&mut v, b"sub-1", coin::mint_for_testing<SUI>(ONE_SUI, s.ctx()), s.ctx());
    ts::return_shared(v);

    s.next_tx(ADMIN);
    let cap = s.take_from_sender<AdminCap>();
    let mut v = s.take_shared<Vault>();
    vault::forfeit(&cap, &mut v, b"sub-1");
    vault::reward(&cap, &mut v, @0xC, ONE_SUI / 5, s.ctx());
    ts::return_shared(v);
    s.return_to_sender(cap);

    s.next_tx(@0xC);
    let paid = s.take_from_sender<coin::Coin<SUI>>();
    assert!(paid.value() == ONE_SUI / 5);
    s.return_to_sender(paid);
    s.end();
}
