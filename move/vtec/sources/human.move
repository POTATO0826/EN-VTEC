/// World ID -> Sui. After the backend verifies a World ID proof, it mints a
/// HumanPass to the person's Sui address. One pass per human: the registry is
/// keyed by the World ID nullifier, so the same person can't get a second one
/// for another wallet.
///
/// HumanPass has `key` but not `store`. In Sui Move, an object without `store`
/// can only be transferred by its own module (`transfer::transfer` is
/// restricted to the defining module; `public_transfer` needs `store`), and
/// this module has no transfer function. So a pass can't be sold or handed on.
module vtec::human;

use sui::event;
use sui::table::{Self, Table};
use vtec::admin::AdminCap;

const EAlreadyVerified: u64 = 0;

public struct HumanPass has key {
    id: UID,
    /// World ID nullifier for VTEC's action (identifies the seat, not the person).
    nullifier: vector<u8>,
}

/// nullifier -> the address that holds its pass
public struct Humans has key {
    id: UID,
    passes: Table<vector<u8>, address>,
}

public struct HumanVerified has copy, drop { holder: address, nullifier: vector<u8> }

fun init(ctx: &mut TxContext) {
    transfer::share_object(Humans { id: object::new(ctx), passes: table::new(ctx) });
}

/// Called by the backend once World ID has verified the proof.
public fun mint(_: &AdminCap, humans: &mut Humans, holder: address, nullifier: vector<u8>, ctx: &mut TxContext) {
    assert!(!humans.passes.contains(nullifier), EAlreadyVerified);
    humans.passes.add(nullifier, holder);
    transfer::transfer(HumanPass { id: object::new(ctx), nullifier }, holder);
    event::emit(HumanVerified { holder, nullifier });
}

public fun holder_of(humans: &Humans, nullifier: vector<u8>): Option<address> {
    if (humans.passes.contains(nullifier)) option::some(humans.passes[nullifier]) else option::none()
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }
