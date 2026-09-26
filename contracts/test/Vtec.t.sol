// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {VtecRegistry} from "../src/VtecRegistry.sol";
import {RoyaltySplitter} from "../src/RoyaltySplitter.sol";

/**
 * README section 9 names the minimum set these two contracts have to get right:
 *
 *   "Same nullifier twice -> HumanAlreadyRegistered; two submissions inside
 *    cooldown -> CooldownActive; promote with +0.5% -> GainBelowOnePercent,
 *    with +1% -> succeeds; pay() with parent -> 75/15/10 split, without parent
 *    -> 90/0/10; withdraw() zeroes balance and transfers."
 *
 * Each of those is a test below. The rest of the file is access control: every
 * attester-only function called by someone who is not the attester, because
 * "the backend is trusted in v0" is only an acceptable position if the contract
 * still refuses everybody else.
 */
contract VtecTest is Test {
    VtecRegistry internal registry;
    RoyaltySplitter internal splitter;

    address internal attester = makeAddr("attester");
    address internal treasury = makeAddr("treasury");
    address internal stranger = makeAddr("stranger");

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal copier = makeAddr("copier");

    uint256 internal constant COOLDOWN = 48 hours;

    bytes32 internal constant TRACK = keccak256("agent.coding.bugfix/rtx4060-8gb.small-suite");
    bytes32 internal constant OTHER_TRACK = keccak256("agent.gpu.sha256/rtx4060-8gb.20min");

    uint256 internal constant ALICE_NULLIFIER = 0x1111;
    uint256 internal constant BOB_NULLIFIER = 0x2222;

    function setUp() public {
        registry = new VtecRegistry(attester, COOLDOWN);
        splitter = new RoyaltySplitter(registry, treasury);

        vm.startPrank(attester);
        registry.registerSolver(alice, ALICE_NULLIFIER);
        registry.registerSolver(bob, BOB_NULLIFIER);
        vm.stopPrank();

        vm.deal(copier, 100 ether);
    }

    // ----------------------------------------------------------------- seats

    function test_registerSolver_setsSeat() public {
        address carol = makeAddr("carol");
        vm.expectEmit(true, false, false, true, address(registry));
        emit VtecRegistry.SolverRegistered(carol);

        vm.prank(attester);
        registry.registerSolver(carol, 0x3333);

        assertTrue(registry.isSolver(carol));
        assertTrue(registry.nullifierUsed(0x3333));
    }

    /// One human, one seat: the same nullifier under a fresh wallet is refused.
    function test_registerSolver_sameNullifierTwice_reverts() public {
        vm.prank(attester);
        vm.expectRevert(VtecRegistry.HumanAlreadyRegistered.selector);
        registry.registerSolver(makeAddr("alice-second-wallet"), ALICE_NULLIFIER);
    }

    function test_registerSolver_sameWalletTwice_reverts() public {
        vm.prank(attester);
        vm.expectRevert(VtecRegistry.WalletAlreadyRegistered.selector);
        registry.registerSolver(alice, 0x9999);
    }

    function test_registerSolver_notAttester_reverts() public {
        vm.prank(stranger);
        vm.expectRevert(VtecRegistry.NotAttester.selector);
        registry.registerSolver(stranger, 0x4444);
    }

    // -------------------------------------------------------------- cooldown

    function test_logSubmission_firstIsFree() public {
        vm.prank(attester);
        registry.logSubmission(alice, TRACK, keccak256("build-1"));
        assertEq(registry.lastSubmission(alice), uint64(block.timestamp));
    }

    function test_logSubmission_insideCooldown_reverts() public {
        vm.prank(attester);
        registry.logSubmission(alice, TRACK, keccak256("build-1"));

        uint256 readyAt = block.timestamp + COOLDOWN;
        skip(COOLDOWN - 1);

        vm.prank(attester);
        vm.expectRevert(abi.encodeWithSelector(VtecRegistry.CooldownActive.selector, readyAt));
        registry.logSubmission(alice, TRACK, keccak256("build-2"));
    }

    function test_logSubmission_afterCooldown_succeeds() public {
        vm.prank(attester);
        registry.logSubmission(alice, TRACK, keccak256("build-1"));

        skip(COOLDOWN);

        vm.prank(attester);
        registry.logSubmission(alice, TRACK, keccak256("build-2"));
        assertEq(registry.lastSubmission(alice), uint64(block.timestamp));
    }

    /// The cooldown is per seat, so one tuner's slot never spends another's.
    function test_logSubmission_cooldownIsPerSeat() public {
        vm.prank(attester);
        registry.logSubmission(alice, TRACK, keccak256("build-1"));

        vm.prank(attester);
        registry.logSubmission(bob, TRACK, keccak256("build-2"));
    }

    function test_logSubmission_notSolver_reverts() public {
        vm.prank(attester);
        vm.expectRevert(VtecRegistry.NotSolver.selector);
        registry.logSubmission(stranger, TRACK, keccak256("build-1"));
    }

    function test_logSubmission_notAttester_reverts() public {
        vm.prank(stranger);
        vm.expectRevert(VtecRegistry.NotAttester.selector);
        registry.logSubmission(alice, TRACK, keccak256("build-1"));
    }

    /// The runner reads this before asking a human to approve anything, so a
    /// doomed submission never costs someone their attention.
    function test_readyAt_reportsNextSlot() public {
        assertEq(registry.readyAt(alice), 0);

        vm.prank(attester);
        registry.logSubmission(alice, TRACK, keccak256("build-1"));
        assertEq(registry.readyAt(alice), block.timestamp + COOLDOWN);

        skip(COOLDOWN);
        assertEq(registry.readyAt(alice), 0);
    }

    // --------------------------------------------------------------- promote

    function test_promote_firstRecordNeedsNoGain() public {
        uint256 id = _promote(TRACK, alice, "baseline", 1000, 0);
        assertEq(id, 1);
        assertEq(registry.bestRecord(TRACK), 1);
        assertEq(registry.recordCount(), 1);

        VtecRegistry.Record memory record = registry.getRecord(1);
        assertEq(record.solver, alice);
        assertEq(record.score, 1000);
        assertEq(record.parentId, 0);
    }

    /// Exactly +1% is the boundary the README promises passes.
    function test_promote_exactlyOnePercent_succeeds() public {
        _promote(TRACK, alice, "baseline", 1000, 0);
        uint256 id = _promote(TRACK, bob, "tuned", 1010, 1);
        assertEq(id, 2);
        assertEq(registry.bestRecord(TRACK), 2);
    }

    function test_promote_halfAPercent_reverts() public {
        _promote(TRACK, alice, "baseline", 1000, 0);

        vm.prank(attester);
        vm.expectRevert(VtecRegistry.GainBelowOnePercent.selector);
        registry.promote(TRACK, bob, keccak256("barely-tuned"), 1005, 1);
    }

    function test_promote_lowerScore_reverts() public {
        _promote(TRACK, alice, "baseline", 1000, 0);

        vm.prank(attester);
        vm.expectRevert(VtecRegistry.GainBelowOnePercent.selector);
        registry.promote(TRACK, bob, keccak256("worse"), 900, 1);
    }

    /// Each leaderboard keeps its own record, so a track with no champion
    /// accepts any first score, even one far below another track's.
    function test_promote_perTrackBaseline() public {
        _promote(TRACK, alice, "fast-track-record", 100_000, 0);
        uint256 id = _promote(OTHER_TRACK, bob, "slow-track-baseline", 5, 0);
        assertEq(id, 2);
        assertEq(registry.bestRecord(OTHER_TRACK), 2);
    }

    function test_promote_parentOnAnotherTrack_reverts() public {
        _promote(OTHER_TRACK, alice, "elsewhere", 1000, 0);

        vm.prank(attester);
        vm.expectRevert(VtecRegistry.BadParent.selector);
        registry.promote(TRACK, bob, keccak256("cross-lineage"), 2000, 1);
    }

    function test_promote_parentDoesNotExist_reverts() public {
        vm.prank(attester);
        vm.expectRevert(VtecRegistry.BadParent.selector);
        registry.promote(TRACK, alice, keccak256("orphan"), 1000, 7);
    }

    function test_promote_notSolver_reverts() public {
        vm.prank(attester);
        vm.expectRevert(VtecRegistry.NotSolver.selector);
        registry.promote(TRACK, stranger, keccak256("build"), 1000, 0);
    }

    function test_promote_notAttester_reverts() public {
        vm.prank(stranger);
        vm.expectRevert(VtecRegistry.NotAttester.selector);
        registry.promote(TRACK, alice, keccak256("build"), 1000, 0);
    }

    function test_getRecord_outOfRange_reverts() public {
        vm.expectRevert(VtecRegistry.NoRecord.selector);
        registry.getRecord(0);

        vm.expectRevert(VtecRegistry.NoRecord.selector);
        registry.getRecord(1);
    }

    // ------------------------------------------------------------- royalties

    /// No parent: 90% tuner, 10% treasury.
    function test_pay_withoutParent_splits90_0_10() public {
        _promote(TRACK, alice, "baseline", 1000, 0);

        vm.prank(copier);
        splitter.pay{value: 1 ether}(1, 100);

        assertEq(splitter.owed(alice), 0.9 ether);
        assertEq(splitter.owed(treasury), 0.1 ether);
        assertEq(splitter.runsPaid(1), 100);
    }

    /// With a parent by a different tuner: 75% tuner, 15% parent, 10% treasury.
    function test_pay_withParent_splits75_15_10() public {
        _promote(TRACK, alice, "baseline", 1000, 0);
        _promote(TRACK, bob, "tuned", 1100, 1);

        vm.prank(copier);
        splitter.pay{value: 1 ether}(2, 100);

        assertEq(splitter.owed(bob), 0.75 ether);
        assertEq(splitter.owed(alice), 0.15 ether);
        assertEq(splitter.owed(treasury), 0.1 ether);
    }

    /// Improving on your own record pays no lineage share to yourself.
    function test_pay_selfParent_splits90_0_10() public {
        _promote(TRACK, alice, "baseline", 1000, 0);
        _promote(TRACK, alice, "tuned", 1100, 1);

        vm.prank(copier);
        splitter.pay{value: 1 ether}(2, 100);

        assertEq(splitter.owed(alice), 0.9 ether);
        assertEq(splitter.owed(treasury), 0.1 ether);
    }

    /// Integer division must not strand wei in the contract.
    function test_pay_leavesNoDust() public {
        _promote(TRACK, alice, "baseline", 1000, 0);
        _promote(TRACK, bob, "tuned", 1100, 1);

        uint256 amount = 7_777_778;
        vm.prank(copier);
        splitter.pay{value: amount}(2, 1);

        assertEq(splitter.owed(alice) + splitter.owed(bob) + splitter.owed(treasury), amount);
        assertEq(address(splitter).balance, amount);
    }

    function test_pay_accumulatesAcrossBatches() public {
        _promote(TRACK, alice, "baseline", 1000, 0);

        vm.startPrank(copier);
        splitter.pay{value: 1 ether}(1, 100);
        splitter.pay{value: 1 ether}(1, 100);
        vm.stopPrank();

        assertEq(splitter.owed(alice), 1.8 ether);
        assertEq(splitter.runsPaid(1), 200);
    }

    function test_pay_unknownRecord_reverts() public {
        vm.prank(copier);
        vm.expectRevert(VtecRegistry.NoRecord.selector);
        splitter.pay{value: 1 ether}(1, 100);
    }

    function test_pay_zeroValue_reverts() public {
        _promote(TRACK, alice, "baseline", 1000, 0);
        vm.prank(copier);
        vm.expectRevert(RoyaltySplitter.NoPayment.selector);
        splitter.pay{value: 0}(1, 100);
    }

    function test_pay_zeroRuns_reverts() public {
        _promote(TRACK, alice, "baseline", 1000, 0);
        vm.prank(copier);
        vm.expectRevert(RoyaltySplitter.NoRuns.selector);
        splitter.pay{value: 1 ether}(1, 0);
    }

    // -------------------------------------------------------------- withdraw

    function test_withdraw_zeroesBalanceAndTransfers() public {
        _promote(TRACK, alice, "baseline", 1000, 0);
        vm.prank(copier);
        splitter.pay{value: 1 ether}(1, 100);

        uint256 before = alice.balance;
        vm.prank(alice);
        splitter.withdraw();

        assertEq(alice.balance - before, 0.9 ether);
        assertEq(splitter.owed(alice), 0);
        assertEq(address(splitter).balance, 0.1 ether);
    }

    function test_withdraw_twice_reverts() public {
        _promote(TRACK, alice, "baseline", 1000, 0);
        vm.prank(copier);
        splitter.pay{value: 1 ether}(1, 100);

        vm.startPrank(alice);
        splitter.withdraw();
        vm.expectRevert(RoyaltySplitter.NothingOwed.selector);
        splitter.withdraw();
        vm.stopPrank();
    }

    function test_withdraw_nothingOwed_reverts() public {
        vm.prank(stranger);
        vm.expectRevert(RoyaltySplitter.NothingOwed.selector);
        splitter.withdraw();
    }

    /// A tuner whose wallet rejects ether cannot be paid, but the failure is
    /// theirs alone: every other balance is untouched and still withdrawable.
    function test_withdraw_rejectingReceiver_doesNotTrapOthers() public {
        RejectingWallet wallet = new RejectingWallet();
        vm.prank(attester);
        registry.registerSolver(address(wallet), 0x5555);
        _promote(TRACK, address(wallet), "baseline", 1000, 0);

        vm.prank(copier);
        splitter.pay{value: 1 ether}(1, 100);

        vm.prank(address(wallet));
        vm.expectRevert(RoyaltySplitter.TransferFailed.selector);
        splitter.withdraw();

        uint256 before = treasury.balance;
        vm.prank(treasury);
        splitter.withdraw();
        assertEq(treasury.balance - before, 0.1 ether);
    }

    // --------------------------------------------------------------- helpers

    function _promote(bytes32 track, address solver, string memory build, uint256 score, uint256 parentId)
        internal
        returns (uint256 id)
    {
        vm.prank(attester);
        id = registry.promote(track, solver, keccak256(bytes(build)), score, parentId);
    }
}

/// A wallet that refuses ether, to prove one bad receiver cannot block the rest.
contract RejectingWallet {
    receive() external payable {
        revert("no thanks");
    }
}
