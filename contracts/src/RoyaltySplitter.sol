// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VtecRegistry} from "./VtecRegistry.sol";

/// @title RoyaltySplitter
/// @notice Pay-per-run royalties for promoted builds, with a lineage share.
///
/// A copier's runner counts the runs it performs and batch-pays for them. Each
/// payment names the record it is paying for, and the split is fixed in code:
///
///   * 15% to the tuner of the *parent* record — the build this one improved on
///   * 10% to the treasury
///   * the rest (75%, or 90% when there is no parent) to this record's tuner
///
/// @dev Two deliberate choices.
///
/// **Pull, not push.** `pay()` only moves numbers in a mapping; nobody is paid
/// by a transfer inside someone else's transaction. A tuner whose wallet is a
/// contract that reverts on receive therefore cannot brick a copier's payment,
/// and one expensive fallback cannot make every payment cost more gas.
///
/// **The split is immutable.** No owner can change it after deployment. The
/// point of putting royalties on-chain rather than in a database is that a
/// tuner does not have to trust us about the number, so a setter would give
/// back exactly what the contract was for.
contract RoyaltySplitter {
    VtecRegistry public immutable registry;

    /// @notice Where the platform's 10% accrues. Also a pull balance: the
    /// treasury withdraws like everyone else, through the same function.
    address public immutable treasury;

    uint256 public constant PARENT_BPS = 1500; // 15%
    uint256 public constant TREASURY_BPS = 1000; // 10%
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Withdrawable balance per address, in wei.
    mapping(address => uint256) public owed;

    /// @notice Runs paid for, per record. Not used by the split — kept because
    /// the leaderboard's "runs" column should come from the chain rather than
    /// from a number the backend could quietly inflate.
    mapping(uint256 => uint256) public runsPaid;

    event Paid(
        uint256 indexed recordId,
        address indexed payer,
        uint256 runs,
        uint256 amount,
        uint256 toSolver,
        uint256 toParent,
        uint256 toTreasury
    );
    event Withdrawn(address indexed to, uint256 amount);

    error ZeroAddress();
    error NoPayment();
    error NoRuns();
    error NothingOwed();
    error TransferFailed();

    constructor(VtecRegistry _registry, address _treasury) {
        if (address(_registry) == address(0) || _treasury == address(0)) revert ZeroAddress();
        registry = _registry;
        treasury = _treasury;
    }

    /// @notice Pay for a batch of runs of one record.
    /// @param recordId Which build was run. "Copy Tuner" pays the record the
    ///        copier pinned; "Follow Track Best" reads `registry.bestRecord()`
    ///        first and pays whatever is champion at run time.
    /// @param runs How many runs this payment covers. Recorded, not priced —
    ///        the price per run is a track config value, so enforcing it here
    ///        would put an off-chain number on-chain for no added trust.
    /// @dev Reverts through `getRecord` if `recordId` does not exist, so a typo
    ///      cannot strand ether in a balance nobody can claim.
    function pay(uint256 recordId, uint256 runs) external payable {
        if (msg.value == 0) revert NoPayment();
        if (runs == 0) revert NoRuns();

        VtecRegistry.Record memory record = registry.getRecord(recordId);

        uint256 toTreasury = (msg.value * TREASURY_BPS) / BPS_DENOMINATOR;
        uint256 toParent;

        if (record.parentId != 0) {
            address parentSolver = registry.getRecord(record.parentId).solver;
            // A tuner improving on their own record is not owed a lineage
            // share by themselves; paying it would just split one balance in
            // two and cost the copier nothing different.
            if (parentSolver != record.solver) {
                toParent = (msg.value * PARENT_BPS) / BPS_DENOMINATOR;
                owed[parentSolver] += toParent;
            }
        }

        // Remainder rather than a third percentage, so integer division can
        // never leave dust stuck in the contract.
        uint256 toSolver = msg.value - toTreasury - toParent;

        owed[treasury] += toTreasury;
        owed[record.solver] += toSolver;
        runsPaid[recordId] += runs;

        emit Paid(recordId, msg.sender, runs, msg.value, toSolver, toParent, toTreasury);
    }

    /// @notice Withdraw everything owed to the caller.
    function withdraw() external {
        uint256 amount = owed[msg.sender];
        if (amount == 0) revert NothingOwed();

        // Effects before interaction: the balance is zeroed before the call, so
        // a re-entrant withdraw finds nothing left to take.
        owed[msg.sender] = 0;

        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Withdrawn(msg.sender, amount);
    }
}
