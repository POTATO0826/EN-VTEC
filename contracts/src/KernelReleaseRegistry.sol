// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/**
 * @title KernelReleaseRegistry
 * @notice The shared release history for agent-optimized GPU kernels.
 *
 * Implements section 8 of the GPU VTEC build plan. The point of this contract
 * is not to prove a benchmark. It cannot: a digest says nothing about
 * floating-point correctness or timing. What it does is make publication
 * require three separate authorities, so the agent that wrote the code cannot
 * be the thing that ships it:
 *
 *   1. evaluator attestation  - a named evaluator says this exact candidate
 *                               passed the exact frozen policy
 *   2. owner authorization    - the project owner signs one exact action
 *   3. human-verification     - the identity bridge attests that the World IDP
 *      permit                   journey and explicit consent completed for that
 *                               same action
 *
 * All three are checked here. Only the first two are cryptographically bound to
 * a party this contract knows; the third is the bridge's assertion that an
 * off-chain identity journey happened. That is a real trust assumption and it
 * is stated in the docs rather than hidden: a compromised bridge could assert
 * falsely, and the owner signature would still be required.
 *
 * Non-upgradeable. Signers are frozen for the MVP - there is deliberately no
 * rotation function, because rotation would have to invalidate every
 * outstanding permit and that is more machinery than the first deployment
 * needs.
 */
contract KernelReleaseRegistry is EIP712 {
    /* ---------------------------------------------------------------------- */
    /* Types                                                                   */
    /* ---------------------------------------------------------------------- */

    /// @dev Bumped if the encoding of any hashed object changes. Part of every id.
    uint256 public constant SCHEMA_VERSION = 1;

    enum Verdict {
        None,
        Accepted,
        Rejected,
        Inconclusive
    }

    enum ReleaseStatus {
        None,
        Active,
        Revoked
    }

    struct Project {
        address owner;
        address evaluatorSigner;
        address identityBridgeSigner;
        uint64 configVersion;
        bytes32 policyHash;
    }

    struct Candidate {
        bytes32 projectId;
        bytes32 parentId;
        bytes32 workloadHash;
        bytes32 environmentScopeHash;
        bytes32 sourceDigest;
        bytes32 binaryDigest;
        bytes32 manifestHash;
        address author;
        uint64 registeredAt;
    }

    struct Report {
        bytes32 candidateId;
        bytes32 policyHash;
        /// @dev Digest of the raw timing samples. Kept off-chain; this pins them.
        bytes32 rawSamplesDigest;
        /// @dev GPU model, VRAM, power limit, driver, CUDA - build plan section 6a.
        bytes32 environmentDigest;
        Verdict verdict;
        uint64 observedAt;
    }

    struct StoredReport {
        bytes32 candidateId;
        address evaluator;
        bytes32 policyHash;
        Verdict verdict;
        uint64 observedAt;
    }

    struct Release {
        bytes32 projectId;
        bytes32 channelHash;
        bytes32 candidateId;
        bytes32 reportHash;
        bytes32 previousReleaseId;
        /// @dev The typed-data digest the owner and the bridge both signed.
        bytes32 authorityDigest;
        ReleaseStatus status;
    }

    /**
     * @notice One exact publication, signed identically by the owner and the bridge.
     * @dev Every field is load-bearing. `expectedPreviousReleaseId` is what stops
     *      an old approval overwriting a newer release; `configVersion` is what
     *      stops an approval surviving a configuration change; `nonce` and
     *      `deadline` are what stop replay and stale retries. The EIP-712 domain
     *      supplies chain and contract binding, so an approval cannot be lifted
     *      onto another chain or another deployment.
     */
    struct PromotionAction {
        bytes32 projectId;
        uint64 configVersion;
        address owner;
        bytes32 channelHash;
        bytes32 candidateId;
        bytes32 reportHash;
        bytes32 policyHash;
        bytes32 expectedPreviousReleaseId;
        uint256 nonce;
        uint256 deadline;
    }

    bytes32 public constant REPORT_TYPEHASH = keccak256(
        "Report(bytes32 candidateId,bytes32 policyHash,bytes32 rawSamplesDigest,bytes32 environmentDigest,uint8 verdict,uint64 observedAt)"
    );

    bytes32 public constant PROMOTION_ACTION_TYPEHASH = keccak256(
        "PromotionAction(bytes32 projectId,uint64 configVersion,address owner,bytes32 channelHash,bytes32 candidateId,bytes32 reportHash,bytes32 policyHash,bytes32 expectedPreviousReleaseId,uint256 nonce,uint256 deadline)"
    );

    /* ---------------------------------------------------------------------- */
    /* Storage                                                                 */
    /* ---------------------------------------------------------------------- */

    mapping(bytes32 projectId => Project) private _projects;
    mapping(bytes32 candidateId => Candidate) private _candidates;
    mapping(bytes32 reportHash => StoredReport) private _reports;
    mapping(bytes32 releaseId => Release) private _releases;
    mapping(bytes32 projectId => mapping(bytes32 channelHash => bytes32 releaseId)) private
        _currentRelease;
    /// @dev Consumed atomically with promotion. Keyed by the signed action digest.
    mapping(bytes32 permitDigest => bool) private _usedPermits;

    /* ---------------------------------------------------------------------- */
    /* Events                                                                  */
    /* ---------------------------------------------------------------------- */

    event ProjectCreated(
        bytes32 indexed projectId,
        address indexed owner,
        address evaluatorSigner,
        address identityBridgeSigner,
        bytes32 policyHash,
        uint64 configVersion
    );

    event CandidateRegistered(
        bytes32 indexed candidateId,
        bytes32 indexed projectId,
        bytes32 indexed parentId,
        address author,
        bytes32 sourceDigest,
        bytes32 binaryDigest
    );

    event ReportRecorded(
        bytes32 indexed reportHash,
        bytes32 indexed candidateId,
        address indexed evaluator,
        Verdict verdict,
        bytes32 policyHash
    );

    event ReleasePromoted(
        bytes32 indexed releaseId,
        bytes32 indexed projectId,
        bytes32 indexed channelHash,
        bytes32 candidateId,
        bytes32 reportHash,
        bytes32 previousReleaseId,
        bytes32 authorityDigest
    );

    event ReleaseRevoked(
        bytes32 indexed releaseId,
        bytes32 indexed projectId,
        bytes32 indexed channelHash,
        bytes32 reasonHash
    );

    /* ---------------------------------------------------------------------- */
    /* Errors                                                                  */
    /* ---------------------------------------------------------------------- */

    error ZeroAddress();
    error ZeroId();
    error ProjectExists();
    error UnknownProject();
    error UnknownCandidate();
    error UnknownReport();
    error UnknownRelease();
    error ReportExists();
    error CandidateExists();
    error UnknownParent();
    error ParentProjectMismatch();
    error NotProjectOwner();
    error BadEvaluatorSignature();
    error BadOwnerSignature();
    error BadBridgeSignature();
    error InvalidVerdict();
    error ReportNotAccepted();
    error ReportCandidateMismatch();
    error PolicyMismatch();
    error ConfigVersionMismatch();
    error OwnerMismatch();
    error StalePreviousRelease();
    error PermitAlreadyUsed();
    error PermitExpired();
    error AlreadyRevoked();

    /* ---------------------------------------------------------------------- */
    /* Construction                                                            */
    /* ---------------------------------------------------------------------- */

    /// @dev Name and version are part of the EIP-712 domain, so changing either
    ///      invalidates every signature made against a previous deployment.
    constructor() EIP712("GPUVTEC.KernelReleaseRegistry", "1") {}

    /* ---------------------------------------------------------------------- */
    /* Id derivation                                                           */
    /* ---------------------------------------------------------------------- */

    /**
     * @notice The canonical candidate id.
     * @dev Exactly the encoding fixed in build plan section 7. Python, TypeScript
     *      and Solidity have to agree on this byte for byte (milestone M5), which
     *      is why it is a pure function callable off-chain rather than something
     *      the caller supplies.
     *
     *      Note the id deliberately does NOT include projectId, per the spec's
     *      formula. Candidate ids are therefore global rather than per-project,
     *      and a second project registering an identical candidate reverts with
     *      CandidateExists. Flagged to the team as a spec tension: the same
     *      section also asks ids to carry project context.
     */
    function computeCandidateId(
        bytes32 parentId,
        bytes32 workloadHash,
        bytes32 environmentScopeHash,
        bytes32 sourceDigest,
        bytes32 binaryDigest,
        bytes32 hypothesisHash
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SCHEMA_VERSION,
                parentId,
                workloadHash,
                environmentScopeHash,
                sourceDigest,
                binaryDigest,
                hypothesisHash
            )
        );
    }

    /// @notice The report's canonical hash: its EIP-712 struct hash.
    /// @dev Chain and contract binding come from the domain at signature time,
    ///      so this value stays stable and reproducible off-chain.
    function computeReportHash(Report calldata report) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                REPORT_TYPEHASH,
                report.candidateId,
                report.policyHash,
                report.rawSamplesDigest,
                report.environmentDigest,
                uint8(report.verdict),
                report.observedAt
            )
        );
    }

    /// @notice The digest the owner and the bridge each sign for one promotion.
    function promotionDigest(PromotionAction calldata action) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    PROMOTION_ACTION_TYPEHASH,
                    action.projectId,
                    action.configVersion,
                    action.owner,
                    action.channelHash,
                    action.candidateId,
                    action.reportHash,
                    action.policyHash,
                    action.expectedPreviousReleaseId,
                    action.nonce,
                    action.deadline
                )
            )
        );
    }

    /// @notice Stable identity for a release, independent of what authorized it.
    function computeReleaseId(
        bytes32 projectId,
        bytes32 channelHash,
        bytes32 candidateId,
        bytes32 reportHash,
        bytes32 previousReleaseId
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SCHEMA_VERSION, projectId, channelHash, candidateId, reportHash, previousReleaseId
            )
        );
    }

    /* ---------------------------------------------------------------------- */
    /* Projects                                                                */
    /* ---------------------------------------------------------------------- */

    function createProject(
        bytes32 projectId,
        address owner,
        address evaluatorSigner,
        address identityBridgeSigner,
        bytes32 policyHash
    ) external {
        if (projectId == bytes32(0)) revert ZeroId();
        if (
            owner == address(0) || evaluatorSigner == address(0)
                || identityBridgeSigner == address(0)
        ) {
            revert ZeroAddress();
        }
        if (_projects[projectId].owner != address(0)) revert ProjectExists();

        _projects[projectId] = Project({
            owner: owner,
            evaluatorSigner: evaluatorSigner,
            identityBridgeSigner: identityBridgeSigner,
            configVersion: 1,
            policyHash: policyHash
        });

        emit ProjectCreated(projectId, owner, evaluatorSigner, identityBridgeSigner, policyHash, 1);
    }

    /* ---------------------------------------------------------------------- */
    /* Candidates                                                              */
    /* ---------------------------------------------------------------------- */

    /**
     * @notice Record an immutable candidate identity.
     * @dev Owner-only for the MVP. The agent proposes candidates but never holds
     *      a key: the owner's service registers on its behalf. A non-root
     *      candidate must name a parent that already exists in the same project,
     *      which is what makes the experiment tree a tree rather than a claim.
     */
    function registerCandidate(
        bytes32 projectId,
        bytes32 parentId,
        bytes32 workloadHash,
        bytes32 environmentScopeHash,
        bytes32 sourceDigest,
        bytes32 binaryDigest,
        bytes32 hypothesisHash,
        bytes32 manifestHash
    ) external returns (bytes32 candidateId) {
        Project storage project = _projects[projectId];
        if (project.owner == address(0)) revert UnknownProject();
        if (msg.sender != project.owner) revert NotProjectOwner();

        if (parentId != bytes32(0)) {
            Candidate storage parent = _candidates[parentId];
            if (parent.projectId == bytes32(0)) revert UnknownParent();
            if (parent.projectId != projectId) revert ParentProjectMismatch();
        }

        candidateId = computeCandidateId(
            parentId, workloadHash, environmentScopeHash, sourceDigest, binaryDigest, hypothesisHash
        );
        if (_candidates[candidateId].projectId != bytes32(0)) revert CandidateExists();

        _candidates[candidateId] = Candidate({
            projectId: projectId,
            parentId: parentId,
            workloadHash: workloadHash,
            environmentScopeHash: environmentScopeHash,
            sourceDigest: sourceDigest,
            binaryDigest: binaryDigest,
            manifestHash: manifestHash,
            author: msg.sender,
            // Safe until well past any plausible life of this deployment.
            registeredAt: uint64(block.timestamp)
        });

        emit CandidateRegistered(
            candidateId, projectId, parentId, msg.sender, sourceDigest, binaryDigest
        );
    }

    /* ---------------------------------------------------------------------- */
    /* Reports                                                                 */
    /* ---------------------------------------------------------------------- */

    /**
     * @notice Record a measurement report signed by the project's named evaluator.
     * @dev A rejected or inconclusive verdict is recorded exactly like an accepted
     *      one. That is the point: the failures have to stay visible, and only
     *      promotion checks the verdict.
     */
    function recordReport(Report calldata report, bytes calldata signature)
        external
        returns (bytes32 reportHash)
    {
        if (report.verdict == Verdict.None) revert InvalidVerdict();

        Candidate storage candidate = _candidates[report.candidateId];
        if (candidate.projectId == bytes32(0)) revert UnknownCandidate();

        Project storage project = _projects[candidate.projectId];

        reportHash = computeReportHash(report);
        if (_reports[reportHash].candidateId != bytes32(0)) revert ReportExists();

        // Effects before the signature check, which can be an external call when
        // the evaluator is an ERC-1271 contract. Writing first means a re-entrant
        // call hits ReportExists and reverts instead of recording the same report
        // twice and emitting a duplicate event that off-chain consumers would
        // read as two independent attestations. A bad signature reverts the whole
        // transaction, so the early write is never observable on its own.
        _reports[reportHash] = StoredReport({
            candidateId: report.candidateId,
            evaluator: project.evaluatorSigner,
            policyHash: report.policyHash,
            verdict: report.verdict,
            observedAt: report.observedAt
        });

        bytes32 digest = _hashTypedDataV4(reportHash);
        if (!SignatureChecker.isValidSignatureNow(project.evaluatorSigner, digest, signature)) {
            revert BadEvaluatorSignature();
        }

        emit ReportRecorded(
            reportHash,
            report.candidateId,
            project.evaluatorSigner,
            report.verdict,
            report.policyHash
        );
    }

    /* ---------------------------------------------------------------------- */
    /* Releases                                                                */
    /* ---------------------------------------------------------------------- */

    /**
     * @notice Promote a candidate to a channel. Requires all three authorities.
     * @dev The permit is consumed in the same transaction that promotes, so a
     *      replay cannot succeed even if the same action is submitted twice in
     *      the same block.
     */
    function promoteRelease(
        PromotionAction calldata action,
        bytes calldata ownerSignature,
        bytes calldata bridgeSignature
    ) external returns (bytes32 releaseId) {
        Project storage project = _projects[action.projectId];
        if (project.owner == address(0)) revert UnknownProject();

        // -- the permit, first, in the order section 8 states: "unused nonce/
        //    permit, deadline, current configuration, matching report, expected
        //    previous release". Consuming here also means an ERC-1271 owner or
        //    bridge cannot re-enter into a second publication; a later revert
        //    rolls the consumption back, so a refused attempt never burns it.
        bytes32 digest = promotionDigest(action);
        if (_usedPermits[digest]) revert PermitAlreadyUsed();
        _usedPermits[digest] = true;

        // -- the action still describes the world it was approved against
        if (block.timestamp > action.deadline) revert PermitExpired();
        if (action.configVersion != project.configVersion) revert ConfigVersionMismatch();
        if (action.owner != project.owner) revert OwnerMismatch();
        if (action.policyHash != project.policyHash) revert PolicyMismatch();

        // -- the report is real, accepted, for this candidate, under this policy
        StoredReport storage report = _reports[action.reportHash];
        if (report.candidateId == bytes32(0)) revert UnknownReport();
        if (report.candidateId != action.candidateId) revert ReportCandidateMismatch();
        if (report.verdict != Verdict.Accepted) revert ReportNotAccepted();
        if (report.policyHash != action.policyHash) revert PolicyMismatch();

        Candidate storage candidate = _candidates[action.candidateId];
        if (candidate.projectId != action.projectId) revert UnknownCandidate();

        // -- nobody is overwriting a release the approver had not seen
        if (
            _currentRelease[action.projectId][action.channelHash]
                != action.expectedPreviousReleaseId
        ) {
            revert StalePreviousRelease();
        }

        // -- the two signatures this contract can actually verify
        if (!SignatureChecker.isValidSignatureNow(project.owner, digest, ownerSignature)) {
            revert BadOwnerSignature();
        }
        if (!SignatureChecker.isValidSignatureNow(
                project.identityBridgeSigner, digest, bridgeSignature
            )) {
            revert BadBridgeSignature();
        }

        releaseId = computeReleaseId(
            action.projectId,
            action.channelHash,
            action.candidateId,
            action.reportHash,
            action.expectedPreviousReleaseId
        );

        _releases[releaseId] = Release({
            projectId: action.projectId,
            channelHash: action.channelHash,
            candidateId: action.candidateId,
            reportHash: action.reportHash,
            previousReleaseId: action.expectedPreviousReleaseId,
            authorityDigest: digest,
            status: ReleaseStatus.Active
        });
        _currentRelease[action.projectId][action.channelHash] = releaseId;

        emit ReleasePromoted(
            releaseId,
            action.projectId,
            action.channelHash,
            action.candidateId,
            action.reportHash,
            action.expectedPreviousReleaseId,
            digest
        );
    }

    /**
     * @notice Disable a release immediately. Owner only, no delay, no signatures.
     * @dev The record is preserved rather than deleted, and the channel pointer is
     *      left in place pointing at a revoked release. A consumer that reads the
     *      pointer must check status, which is exactly the behaviour milestone M8
     *      has to demonstrate. A revoked release can never become active again:
     *      promoting the same candidate would produce the same releaseId and hit
     *      AlreadyRevoked, so recovery means a new report or a new candidate.
     */
    function revokeRelease(bytes32 releaseId, bytes32 reasonHash) external {
        Release storage release = _releases[releaseId];
        if (release.projectId == bytes32(0)) revert UnknownRelease();
        if (release.status == ReleaseStatus.Revoked) revert AlreadyRevoked();
        if (msg.sender != _projects[release.projectId].owner) revert NotProjectOwner();

        release.status = ReleaseStatus.Revoked;

        emit ReleaseRevoked(releaseId, release.projectId, release.channelHash, reasonHash);
    }

    /* ---------------------------------------------------------------------- */
    /* Views                                                                   */
    /* ---------------------------------------------------------------------- */

    /// @notice What a consumer reads. Returns the record including its status,
    ///         so a revoked release is visible rather than absent.
    function getCurrentRelease(bytes32 projectId, bytes32 channelHash)
        external
        view
        returns (bytes32 releaseId, Release memory release)
    {
        releaseId = _currentRelease[projectId][channelHash];
        release = _releases[releaseId];
    }

    function getProject(bytes32 projectId) external view returns (Project memory) {
        return _projects[projectId];
    }

    function getCandidate(bytes32 candidateId) external view returns (Candidate memory) {
        return _candidates[candidateId];
    }

    function getReport(bytes32 reportHash) external view returns (StoredReport memory) {
        return _reports[reportHash];
    }

    function getRelease(bytes32 releaseId) external view returns (Release memory) {
        return _releases[releaseId];
    }

    function isPermitUsed(bytes32 permitDigest) external view returns (bool) {
        return _usedPermits[permitDigest];
    }

    /// @notice Exposed so off-chain signers can verify they built the same domain.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
