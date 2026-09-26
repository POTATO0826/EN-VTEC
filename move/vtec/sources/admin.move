/// The platform backend's capability. Only its holder can settle stakes and
/// fees, mint HumanPasses and list kernels.
module vtec::admin;

public struct AdminCap has key, store { id: UID }

fun init(ctx: &mut TxContext) {
    transfer::transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }
