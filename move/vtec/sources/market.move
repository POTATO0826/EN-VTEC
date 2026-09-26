/// Buying a verified kernel. One call does all of it, so it runs in a single
/// PTB and either everything happens or nothing does:
///   take the payment -> split it to tuner, lineage and platform ->
///   mint a License to the buyer (challenge, kernel version, expiry).
///
/// Prices and payees live in a Listing the platform creates once a kernel is
/// verified, so a buyer can't choose who gets paid or how much.
///
/// License has `key` but not `store`, and this module never transfers one
/// except to the buyer inside `buy`. In Sui Move that makes it
/// non-transferable: `transfer::public_transfer` needs `store`, and
/// `transfer::transfer` only works inside the defining module. No resale.
module vtec::market;

use sui::clock::Clock;
use sui::coin::Coin;
use sui::event;
use sui::sui::SUI;
use vtec::admin::AdminCap;

const EWrongPrice: u64 = 0;
const ENotListed: u64 = 1;
const EBadSplit: u64 = 2;

const BPS: u64 = 10_000;

/// Platform settings: where its share goes and how a payment splits.
public struct Market has key {
    id: UID,
    platform: address,
    tuner_bps: u64,
    lineage_bps: u64,
    /// How long a license lasts, in ms.
    license_ms: u64,
}

/// A verified kernel that can be bought.
public struct Listing has key {
    id: UID,
    /// Track / challenge id, e.g. b"rmsnorm-4096".
    challenge: vector<u8>,
    /// Submission id of the kernel.
    kernel: vector<u8>,
    /// SHA-256 of the exact verified code.
    version: vector<u8>,
    tuner: address,
    /// Whoever held the record this kernel improved on (or the tuner).
    lineage: address,
    price: u64,
    active: bool,
}

public struct License has key {
    id: UID,
    listing: ID,
    challenge: vector<u8>,
    kernel: vector<u8>,
    version: vector<u8>,
    expires_ms: u64,
}

public struct Listed has copy, drop { listing: ID, challenge: vector<u8>, kernel: vector<u8>, tuner: address, price: u64 }
public struct LicenseBought has copy, drop {
    listing: ID,
    license: ID,
    buyer: address,
    challenge: vector<u8>,
    kernel: vector<u8>,
    price: u64,
    to_tuner: u64,
    to_lineage: u64,
    to_platform: u64,
    expires_ms: u64,
}

fun init(ctx: &mut TxContext) {
    transfer::share_object(Market {
        id: object::new(ctx),
        platform: ctx.sender(),
        tuner_bps: 7_000,
        lineage_bps: 2_000,
        license_ms: 30 * 24 * 60 * 60 * 1000,
    });
}

/// The platform lists a kernel once verifiers have confirmed it.
public fun list(
    _: &AdminCap,
    challenge: vector<u8>,
    kernel: vector<u8>,
    version: vector<u8>,
    tuner: address,
    lineage: address,
    price: u64,
    ctx: &mut TxContext,
) {
    let listing = Listing { id: object::new(ctx), challenge, kernel, version, tuner, lineage, price, active: true };
    event::emit(Listed { listing: object::id(&listing), challenge, kernel, tuner, price });
    transfer::share_object(listing);
}

/// A newer record replaced it: no more sales (existing licenses stay valid).
public fun retire(_: &AdminCap, listing: &mut Listing) {
    listing.active = false;
}

public fun set_split(_: &AdminCap, market: &mut Market, tuner_bps: u64, lineage_bps: u64) {
    assert!(tuner_bps + lineage_bps <= BPS, EBadSplit);
    market.tuner_bps = tuner_bps;
    market.lineage_bps = lineage_bps;
}

/// Pay, split, and mint the license, all at once.
public fun buy(listing: &Listing, market: &Market, mut payment: Coin<SUI>, clock: &Clock, ctx: &mut TxContext) {
    assert!(listing.active, ENotListed);
    let price = payment.value();
    assert!(price == listing.price, EWrongPrice);

    let to_tuner = price * market.tuner_bps / BPS;
    let to_lineage = price * market.lineage_bps / BPS;
    let to_platform = price - to_tuner - to_lineage;

    transfer::public_transfer(payment.split(to_tuner, ctx), listing.tuner);
    transfer::public_transfer(payment.split(to_lineage, ctx), listing.lineage);
    transfer::public_transfer(payment, market.platform);

    let expires_ms = clock.timestamp_ms() + market.license_ms;
    let license = License {
        id: object::new(ctx),
        listing: object::id(listing),
        challenge: listing.challenge,
        kernel: listing.kernel,
        version: listing.version,
        expires_ms,
    };
    event::emit(LicenseBought {
        listing: object::id(listing),
        license: object::id(&license),
        buyer: ctx.sender(),
        challenge: listing.challenge,
        kernel: listing.kernel,
        price,
        to_tuner,
        to_lineage,
        to_platform,
        expires_ms,
    });
    transfer::transfer(license, ctx.sender());
}

// === Reads ===

public fun license_kernel(l: &License): vector<u8> { l.kernel }
public fun license_expires_ms(l: &License): u64 { l.expires_ms }

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }
