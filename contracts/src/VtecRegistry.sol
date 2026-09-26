// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title VtecRegistry
/// @notice Tuner seats, the submission cooldown, and the promoted record history.
///
/// Three rules live here because they are the rules nobody should be able to
/// quietly rewrite:
///
///   1. One human = one tuner seat. Keyed on the World ID nullifier, so the
///      same human cannot claim a second seat under a second wallet.
///   2. One submission per seat per cooldown window. 48 hours in production,
///      deliberately short for a demo deployment.
///   3. A new record must beat the standing record by at least 1%.
///
/// @dev The `attester` is our backend. It is trusted in v0, and that is stated
/// openly rather than hidden: it only calls these functions after verifying a
/// World ID Proof of Human (seats), a fresh World ID for Agents approval
/// (submissions), or a paired benchmark (records). Every call it makes emits an
/// event, so the whole history is auditable by anyone even while the attester is
/// trusted. Replacing the attester with on-chain verification is Phase 4.
///
/// The 1% floor here is a *sanity check*, not the real acceptance test. The real
/// test is noise-aware and off-chain: the backend runs the candidate against the
/// standing record in interleaved pairs and requires the conservative (95% CI
/// lower bound) gain to clear 1%. A contract cannot measure a GPU, so it checks
/// the one thing it can: that the number it is being handed is actually higher.
contract VtecRegistry {
    /// @param trackId  The leaderboard this record belongs to, as
    ///                 `keccak256("<track>/<variant>")` — e.g.
    ///                 `keccak256("agent.gpu.sha256/rtx4060-8gb.msgs-1048576")`.
    ///                 One leaderboard per task x GPU x job size, because the
    ///                 build that wins at 1M messages may lose at 1K.
    /// @param score    Higher is better, scaled by 1000 so a fractional metric
    ///                 survives integer storage (e.g. 41.3 MH/s -> 41300).
    /// @param parentId The record this build improved on, 0 if it improved on
    ///                 nothing. This is what pays the 15% lineage share.
    struct Record {
        bytes32 trackId;
        address solver;
        bytes32 buildHash;
        uint256 score;
        uint256 parentId;
        uint64 timestamp;
    }

    address public immutable attester;

    /// @notice Seconds a seat must wait between submissions. 172800 (48h) in
    /// production; a demo deployment uses something small enough to show the
    /// cooldown rejection live.
    uint256 public immutable cooldown;

    /// @dev World ID nullifier => claimed. A nullifier is per-human-per-action,
    /// so this is the "one human, one seat" ledger. Stored as the uint256 the
    /// proof actually carries, never as a decimal string.
    mapping(uint256 => bool) public nullifierUsed;

    mapping(address => bool) public isSolver;
    mapping(address => uint64) public lastSubmission;

    /// @notice trackId => record id of the current champion. 0 means no record
    /// has been set on that leaderboard yet.
    mapping(bytes32 => uint256) public bestRecord;

    /// @dev Record id is index + 1, so that 0 can mean "no record" / "no parent".
    Record[] private _records;

    event SolverRegistered(address indexed solver);
    event Submitted(address indexed solver, bytes32 indexed trackId, bytes32 buildHash);
    event Promoted(
        uint256 indexed recordId,
        bytes32 indexed trackId,
        address indexed solver,
        uint256 score,
        uint256 parentId
    );

    error NotAttester();
    error HumanAlreadyRegistered();
    error WalletAlreadyRegistered();
    error NotSolver();
    error CooldownActive(uint256 readyAt);
    error GainBelowOnePercent();
    error BadParent();
    error NoRecord();
    error ZeroAddress();

    constructor(address _attester, uint256 _cooldown) {
        if (_attester == address(0)) revert ZeroAddress();
        attester = _attester;
        cooldown = _cooldown;
    }

    modifier onlyAttester() {
        if (msg.sender != attester) revert NotAttester();
        _;
    }

    /// @notice Claim a tuner seat for a human.
    /// @dev Called only after the backend has verified a World ID Proof of Human
    /// whose signal was bound to `wallet`. The uniqueness check is duplicated
    /// here on purpose: the backend checks it to give a friendly error, and the
    /// contract checks it so the rule survives a buggy or compromised backend.
    function registerSolver(address wallet, uint256 nullifier) external onlyAttester {
        if (wallet == address(0)) revert ZeroAddress();
        if (nullifierUsed[nullifier]) revert HumanAlreadyRegistered();
        if (isSolver[wallet]) revert WalletAlreadyRegistered();

        nullifierUsed[nullifier] = true;
        isSolver[wallet] = true;
        emit SolverRegistered(wallet);
    }

    /// @notice Spend the seat's submission slot.
    /// @dev Called only after the human freshly approved their agent's
    /// submission through World ID for Agents. A denied or expired approval must
    /// never reach this function, which is what makes "the slot was not consumed"
    /// a true statement rather than a UI claim.
    function logSubmission(address solver, bytes32 trackId, bytes32 buildHash) external onlyAttester {
        if (!isSolver[solver]) revert NotSolver();

        uint256 last = lastSubmission[solver];
        if (last != 0 && block.timestamp < last + cooldown) {
            revert CooldownActive(last + cooldown);
        }

        lastSubmission[solver] = uint64(block.timestamp);
        emit Submitted(solver, trackId, buildHash);
    }

    /// @notice Record a build that really beat the standing record.
    /// @dev Called only after the paired benchmark's conservative gain cleared
    /// 1%. Returns the new record id.
    function promote(bytes32 trackId, address solver, bytes32 buildHash, uint256 score, uint256 parentId)
        external
        onlyAttester
        returns (uint256 id)
    {
        if (!isSolver[solver]) revert NotSolver();

        // A parent must exist and must be on the same leaderboard — lineage
        // across leaderboards would pay royalties for an unrelated improvement.
        if (parentId > _records.length) revert BadParent();
        if (parentId != 0 && _records[parentId - 1].trackId != trackId) revert BadParent();

        uint256 best = bestRecord[trackId];
        if (best != 0 && score * 100 < _records[best - 1].score * 101) {
            revert GainBelowOnePercent();
        }

        _records.push(
            Record({
                trackId: trackId,
                solver: solver,
                buildHash: buildHash,
                score: score,
                parentId: parentId,
                timestamp: uint64(block.timestamp)
            })
        );

        id = _records.length;
        bestRecord[trackId] = id;
        emit Promoted(id, trackId, solver, score, parentId);
    }

    function getRecord(uint256 id) external view returns (Record memory) {
        if (id == 0 || id > _records.length) revert NoRecord();
        return _records[id - 1];
    }

    function recordCount() external view returns (uint256) {
        return _records.length;
    }

    /// @notice When this seat may submit again. 0 means "right now".
    /// @dev The runner and the agent read this before asking a human to approve
    /// anything, so a doomed submission never wastes a person's attention.
    function readyAt(address solver) external view returns (uint256) {
        uint256 last = lastSubmission[solver];
        if (last == 0) return 0;
        uint256 ready = last + cooldown;
        return block.timestamp >= ready ? 0 : ready;
    }
}
