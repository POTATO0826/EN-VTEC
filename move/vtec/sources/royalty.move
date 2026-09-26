/// Recoverable royalty allocations. A Challenge is the immutable split for one
/// listed kernel; only payout destinations and badge generations can change.
module vtec::royalty;

use sui::coin::Coin;
use sui::event;
use sui::sui::SUI;
use vtec::admin::AdminCap;

const EInvalidAddress: u64 = 0;
const EUnknownTuner: u64 = 1;
const EStaleRecovery: u64 = 2;

public struct Share has store {
    identity: address,
    payout: address,
    bps: u64,
    generation: u64,
    badge: ID,
}

public struct Challenge has key {
    id: UID,
    track: vector<u8>,
    kernel: vector<u8>,
    lineage: vector<Share>,
}

/// Deliberately no `store`: there is no public transfer or resale operation.
/// An old badge remains in the lost wallet but is invalid against Challenge.
public struct RoyaltyBadge has key {
    id: UID,
    challenge: ID,
    identity: address,
    bps: u64,
    generation: u64,
}

public struct EarningsRecovered has copy, drop {
    challenge: ID,
    identity: address,
    old_address: address,
    new_address: address,
    old_badge: ID,
    new_badge: ID,
    generation: u64,
    request: vector<u8>,
}

fun share(challenge: ID, identity: address, payout: address, bps: u64, ctx: &mut TxContext): Share {
    assert!(payout != @0x0, EInvalidAddress);
    let badge = RoyaltyBadge { id: object::new(ctx), challenge, identity, bps, generation: 0 };
    let id = object::id(&badge);
    transfer::transfer(badge, payout);
    Share { identity, payout, bps, generation: 0, badge: id }
}

public(package) fun create(
    track: vector<u8>, kernel: vector<u8>,
    tuner_identity: address, tuner: address,
    lineage_identity: address, lineage: address,
    ctx: &mut TxContext,
): ID {
    let uid = object::new(ctx);
    let id = uid.to_inner();
    let shares = if (tuner_identity == lineage_identity) {
        assert!(tuner == lineage, EInvalidAddress);
        vector[share(id, tuner_identity, tuner, 9_000, ctx)]
    } else {
        vector[share(id, tuner_identity, tuner, 7_000, ctx), share(id, lineage_identity, lineage, 2_000, ctx)]
    };
    transfer::share_object(Challenge { id: uid, track, kernel, lineage: shares });
    id
}

/// World session verification happens in the backend. Sui trusts its AdminCap.
/// Expected generation prevents stale requests from undoing a newer recovery.
public fun recover(
    _: &AdminCap, challenge: &mut Challenge, identity: address,
    expected_generation: u64, new_address: address, request: vector<u8>, ctx: &mut TxContext,
) {
    assert!(new_address != @0x0, EInvalidAddress);
    let mut i = 0;
    while (i < challenge.lineage.length()) {
        if (challenge.lineage[i].identity == identity) break;
        i = i + 1;
    };
    assert!(i < challenge.lineage.length(), EUnknownTuner);
    let item = &mut challenge.lineage[i];
    assert!(item.generation == expected_generation, EStaleRecovery);
    assert!(item.payout != new_address, EInvalidAddress);
    let old_address = item.payout;
    let old_badge = item.badge;
    item.generation = item.generation + 1;
    let badge = RoyaltyBadge {
        id: object::new(ctx), challenge: challenge.id.to_inner(), identity,
        bps: item.bps, generation: item.generation,
    };
    item.badge = object::id(&badge);
    item.payout = new_address;
    event::emit(EarningsRecovered {
        challenge: challenge.id.to_inner(), identity, old_address, new_address,
        old_badge, new_badge: item.badge, generation: item.generation, request,
    });
    transfer::transfer(badge, new_address);
}

public fun badge_valid(challenge: &Challenge, badge: &RoyaltyBadge): bool {
    if (badge.challenge != object::id(challenge)) return false;
    let mut i = 0;
    while (i < challenge.lineage.length()) {
        let item = &challenge.lineage[i];
        if (item.identity == badge.identity) {
            return item.badge == object::id(badge) && item.generation == badge.generation && item.bps == badge.bps
        };
        i = i + 1;
    };
    false
}

public(package) fun pay(challenge: &Challenge, payment: &mut Coin<SUI>, price: u64, ctx: &mut TxContext) {
    let mut i = 0;
    while (i < challenge.lineage.length()) {
        let item = &challenge.lineage[i];
        // Preserve the original split's rounding when one identity holds both shares.
        let amount = if (item.bps == 9_000) {
            price * 7_000 / 10_000 + price * 2_000 / 10_000
        } else { price * item.bps / 10_000 };
        transfer::public_transfer(payment.split(amount, ctx), item.payout);
        i = i + 1;
    };
}

public fun payout(challenge: &Challenge, identity: address): address {
    let mut i = 0;
    while (i < challenge.lineage.length()) {
        if (challenge.lineage[i].identity == identity) return challenge.lineage[i].payout;
        i = i + 1;
    };
    abort EUnknownTuner
}
