// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {KernelReleaseRegistry} from "../src/KernelReleaseRegistry.sol";

/**
 * Build plan section 12 names the negative cases this contract has to fail on:
 *
 *   "Unknown candidate, wrong report signer, rejected report, non-owner
 *    signature, wrong bridge, expired/replayed permit, altered artifact/project/
 *    chain, stale previous release - all fail"
 *
 * Every one of those has a test below. The happy path is three tests; the rest
 * of this file is the ways publication is supposed to be refused, because that
 * is the whole claim the contract makes.
 */
contract KernelReleaseRegistryTest is Test {
    KernelReleaseRegistry internal registry;

    uint256 internal ownerKey = 0xA11CE;
    uint256 internal evaluatorKey = 0xE7A1;
    uint256 internal bridgeKey = 0xB21D6E;
    uint256 internal strangerKey = 0xBAD;

    address internal owner;
    address internal evaluator;
    address internal bridge;
    address internal stranger;

    bytes32 internal constant PROJECT_ID = keccak256("gpu-vtec/sha256");
    bytes32 internal constant CHANNEL = keccak256("stable");
    bytes32 internal constant POLICY = keccak256("policy-v1");

    bytes32 internal candidateId;
    bytes32 internal reportHash;

    function setUp() public {
        owner = vm.addr(ownerKey);
        evaluator = vm.addr(evaluatorKey);
        bridge = vm.addr(bridgeKey);
        stranger = vm.addr(strangerKey);

        registry = new KernelReleaseRegistry();
        registry.createProject(PROJECT_ID, owner, evaluator, bridge, POLICY);

        candidateId = _registerCandidate(bytes32(0), keccak256("source-a"));
        reportHash =
            _recordReport(candidateId, KernelReleaseRegistry.Verdict.Accepted, evaluatorKey);
    }

    /* ---------------------------------------------------------------------- */
    /* Helpers                                                                 */
    /* ---------------------------------------------------------------------- */

    function _registerCandidate(bytes32 parentId, bytes32 sourceDigest) internal returns (bytes32) {
        vm.prank(owner);
        return registry.registerCandidate(
            PROJECT_ID,
            parentId,
            keccak256("workload"),
            keccak256("env-scope"),
            sourceDigest,
            keccak256("binary"),
            keccak256("hypothesis"),
            keccak256("manifest")
        );
    }

    function _report(bytes32 cid, KernelReleaseRegistry.Verdict verdict)
        internal
        pure
        returns (KernelReleaseRegistry.Report memory)
    {
        return KernelReleaseRegistry.Report({
            candidateId: cid,
            policyHash: POLICY,
            rawSamplesDigest: keccak256("raw-samples"),
            environmentDigest: keccak256("rtx4060-laptop-8gb-115w"),
            verdict: verdict,
            observedAt: 1_700_000_000
        });
    }

    function _signReport(KernelReleaseRegistry.Report memory report, uint256 key)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = registry.computeReportHash(report);
        bytes32 digest = MessageHashUtils.toTypedDataHash(registry.domainSeparator(), structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _recordReport(bytes32 cid, KernelReleaseRegistry.Verdict verdict, uint256 key)
        internal
        returns (bytes32)
    {
        KernelReleaseRegistry.Report memory report = _report(cid, verdict);
        return registry.recordReport(report, _signReport(report, key));
    }

    function _action(bytes32 cid, bytes32 rHash, bytes32 previous, uint256 nonce)
        internal
        view
        returns (KernelReleaseRegistry.PromotionAction memory)
    {
        return KernelReleaseRegistry.PromotionAction({
            projectId: PROJECT_ID,
            configVersion: 1,
            owner: owner,
            channelHash: CHANNEL,
            candidateId: cid,
            reportHash: rHash,
            policyHash: POLICY,
            expectedPreviousReleaseId: previous,
            nonce: nonce,
            deadline: block.timestamp + 5 minutes
        });
    }

    function _sign(KernelReleaseRegistry.PromotionAction memory action, uint256 key)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, registry.promotionDigest(action));
        return abi.encodePacked(r, s, v);
    }

    function _promote(KernelReleaseRegistry.PromotionAction memory action)
        internal
        returns (bytes32)
    {
        return registry.promoteRelease(action, _sign(action, ownerKey), _sign(action, bridgeKey));
    }

    /* ---------------------------------------------------------------------- */
    /* Happy path                                                              */
    /* ---------------------------------------------------------------------- */

    function test_promote_publishesAndBecomesCurrent() public {
        KernelReleaseRegistry.PromotionAction memory action =
            _action(candidateId, reportHash, bytes32(0), 1);
        bytes32 releaseId = _promote(action);

        (bytes32 current, KernelReleaseRegistry.Release memory release) =
            registry.getCurrentRelease(PROJECT_ID, CHANNEL);

        assertEq(current, releaseId, "channel points at the new release");
        assertEq(release.candidateId, candidateId);
        assertEq(release.reportHash, reportHash);
        assertEq(uint8(release.status), uint8(KernelReleaseRegistry.ReleaseStatus.Active), "active");
        assertEq(
            release.authorityDigest, registry.promotionDigest(action), "records what authorized it"
        );
        assertTrue(registry.isPermitUsed(release.authorityDigest), "permit consumed");
    }

    function test_revoke_leavesRecordAndFlipsStatus() public {
        bytes32 releaseId = _promote(_action(candidateId, reportHash, bytes32(0), 1));

        vm.prank(owner);
        registry.revokeRelease(releaseId, keccak256("regression on 1M messages"));

        (bytes32 current, KernelReleaseRegistry.Release memory release) =
            registry.getCurrentRelease(PROJECT_ID, CHANNEL);

        // The pointer is deliberately left in place. A consumer that reads the
        // pointer without checking status would adopt a revoked release, which is
        // exactly the mistake milestone M8 has to prove it does not make.
        assertEq(current, releaseId, "pointer preserved");
        assertEq(uint8(release.status), uint8(KernelReleaseRegistry.ReleaseStatus.Revoked));
        assertEq(release.candidateId, candidateId, "record preserved, not deleted");
    }

    function test_promote_chainsOntoPreviousRelease() public {
        bytes32 first = _promote(_action(candidateId, reportHash, bytes32(0), 1));

        bytes32 secondCandidate = _registerCandidate(candidateId, keccak256("source-b"));
        bytes32 secondReport =
            _recordReport(secondCandidate, KernelReleaseRegistry.Verdict.Accepted, evaluatorKey);

        bytes32 second = _promote(_action(secondCandidate, secondReport, first, 2));

        (bytes32 current,) = registry.getCurrentRelease(PROJECT_ID, CHANNEL);
        assertEq(current, second);
        assertEq(registry.getRelease(second).previousReleaseId, first, "lineage preserved");
    }

    /* ---------------------------------------------------------------------- */
    /* Section 12: unknown candidate                                           */
    /* ---------------------------------------------------------------------- */

    function test_recordReport_unknownCandidate_reverts() public {
        KernelReleaseRegistry.Report memory report =
            _report(keccak256("never-registered"), KernelReleaseRegistry.Verdict.Accepted);
        bytes memory sig = _signReport(report, evaluatorKey);
        vm.expectRevert(KernelReleaseRegistry.UnknownCandidate.selector);
        registry.recordReport(report, sig);
    }

    /* ---------------------------------------------------------------------- */
    /* Section 12: wrong report signer                                         */
    /* ---------------------------------------------------------------------- */

    function test_recordReport_wrongSigner_reverts() public {
        bytes32 other = _registerCandidate(bytes32(0), keccak256("source-other"));
        KernelReleaseRegistry.Report memory report =
            _report(other, KernelReleaseRegistry.Verdict.Accepted);
        bytes memory sig = _signReport(report, ownerKey);
        vm.expectRevert(KernelReleaseRegistry.BadEvaluatorSignature.selector);
        // The owner is not the evaluator. Being powerful elsewhere does not make
        // a signature valid here.
        registry.recordReport(report, sig);
    }

    function test_recordReport_recordsRejectedAndInconclusive() public {
        bytes32 rejectedCandidate = _registerCandidate(bytes32(0), keccak256("source-rejected"));
        bytes32 h =
            _recordReport(rejectedCandidate, KernelReleaseRegistry.Verdict.Rejected, evaluatorKey);

        // Failures are part of the record, not absent from it.
        assertEq(
            uint8(registry.getReport(h).verdict), uint8(KernelReleaseRegistry.Verdict.Rejected)
        );
    }

    function test_recordReport_duplicate_reverts() public {
        KernelReleaseRegistry.Report memory report =
            _report(candidateId, KernelReleaseRegistry.Verdict.Accepted);
        bytes memory sig = _signReport(report, evaluatorKey);
        vm.expectRevert(KernelReleaseRegistry.ReportExists.selector);
        registry.recordReport(report, sig);
    }

    function test_recordReport_noVerdict_reverts() public {
        KernelReleaseRegistry.Report memory report =
            _report(candidateId, KernelReleaseRegistry.Verdict.None);
        bytes memory sig = _signReport(report, evaluatorKey);
        vm.expectRevert(KernelReleaseRegistry.InvalidVerdict.selector);
        registry.recordReport(report, sig);
    }

    /* ---------------------------------------------------------------------- */
    /* Section 12: rejected report cannot be promoted                          */
    /* ---------------------------------------------------------------------- */

    function test_promote_rejectedReport_reverts() public {
        bytes32 cid = _registerCandidate(bytes32(0), keccak256("source-slow"));
        bytes32 h = _recordReport(cid, KernelReleaseRegistry.Verdict.Rejected, evaluatorKey);

        KernelReleaseRegistry.PromotionAction memory action = _action(cid, h, bytes32(0), 9);
        bytes memory ownerSig = _sign(action, ownerKey);
        bytes memory bridgeSig = _sign(action, bridgeKey);
        vm.expectRevert(KernelReleaseRegistry.ReportNotAccepted.selector);
        registry.promoteRelease(action, ownerSig, bridgeSig);
    }

    function test_promote_inconclusiveReport_reverts() public {
        bytes32 cid = _registerCandidate(bytes32(0), keccak256("source-noisy"));
        bytes32 h = _recordReport(cid, KernelReleaseRegistry.Verdict.Inconclusive, evaluatorKey);

        KernelReleaseRegistry.PromotionAction memory action = _action(cid, h, bytes32(0), 10);
        bytes memory ownerSig = _sign(action, ownerKey);
        bytes memory bridgeSig = _sign(action, bridgeKey);
        vm.expectRevert(KernelReleaseRegistry.ReportNotAccepted.selector);
        registry.promoteRelease(action, ownerSig, bridgeSig);
    }

    function test_promote_unknownReport_reverts() public {
        KernelReleaseRegistry.PromotionAction memory action =
            _action(candidateId, keccak256("no-such-report"), bytes32(0), 11);
        bytes memory ownerSig = _sign(action, ownerKey);
        bytes memory bridgeSig = _sign(action, bridgeKey);
        vm.expectRevert(KernelReleaseRegistry.UnknownReport.selector);
        registry.promoteRelease(action, ownerSig, bridgeSig);
    }

    /* ---------------------------------------------------------------------- */
    /* Section 12: non-owner signature, wrong bridge                           */
    /* ---------------------------------------------------------------------- */

    function test_promote_nonOwnerSignature_reverts() public {
        KernelReleaseRegistry.PromotionAction memory action =
            _action(candidateId, reportHash, bytes32(0), 1);
        bytes memory ownerSig = _sign(action, strangerKey);
        bytes memory bridgeSig = _sign(action, bridgeKey);
        vm.expectRevert(KernelReleaseRegistry.BadOwnerSignature.selector);
        registry.promoteRelease(action, ownerSig, bridgeSig);
    }

    function test_promote_wrongBridge_reverts() public {
        KernelReleaseRegistry.PromotionAction memory action =
            _action(candidateId, reportHash, bytes32(0), 1);
        bytes memory ownerSig = _sign(action, ownerKey);
        bytes memory bridgeSig = _sign(action, strangerKey);
        vm.expectRevert(KernelReleaseRegistry.BadBridgeSignature.selector);
        registry.promoteRelease(action, ownerSig, bridgeSig);
    }

    function test_promote_ownerSigningTwiceIsNotABridgePermit() public {
        // The whole point of three authorities: the owner cannot stand in for the
        // human-verification permit by signing the same action again.
        KernelReleaseRegistry.PromotionAction memory action =
            _action(candidateId, reportHash, bytes32(0), 1);
        bytes memory ownerSig = _sign(action, ownerKey);
        bytes memory bridgeSig = _sign(action, ownerKey);
        vm.expectRevert(KernelReleaseRegistry.BadBridgeSignature.selector);
        registry.promoteRelease(action, ownerSig, bridgeSig);
    }

    /* ---------------------------------------------------------------------- */
    /* Section 12: expired and replayed permits                                */
    /* ---------------------------------------------------------------------- */

    function test_promote_expiredPermit_reverts() public {
        KernelReleaseRegistry.PromotionAction memory action =
            _action(candidateId, reportHash, bytes32(0), 1);
        // Section 9 proposes a five-minute expiry. A stale frontend retrying
        // afterwards must not publish.
        vm.warp(action.deadline + 1);
        bytes memory ownerSig = _sign(action, ownerKey);
        bytes memory bridgeSig = _sign(action, bridgeKey);
        vm.expectRevert(KernelReleaseRegistry.PermitExpired.selector);
        registry.promoteRelease(action, ownerSig, bridgeSig);
    }

    function test_promote_replayedPermit_reverts() public {
        KernelReleaseRegistry.PromotionAction memory action =
            _action(candidateId, reportHash, bytes32(0), 1);
        _promote(action);

        // Same signatures, same action, submitted again.
        bytes memory ownerSig = _sign(action, ownerKey);
        bytes memory bridgeSig = _sign(action, bridgeKey);
        vm.expectRevert(KernelReleaseRegistry.PermitAlreadyUsed.selector);
        registry.promoteRelease(action, ownerSig, bridgeSig);
    }

    /* ---------------------------------------------------------------------- */
    /* Section 12: altered artifact, project, chain                            */
    /* ---------------------------------------------------------------------- */

    function test_alteredArtifact_producesADifferentCandidateId() public view {
        bytes32 a = registry.computeCandidateId(
            bytes32(0),
            keccak256("workload"),
            keccak256("env-scope"),
            keccak256("source-a"),
            keccak256("binary"),
            keccak256("hypothesis")
        );
        // One byte of source changed. Section 6: "Changing source, compiler
        // options, or binary after evaluation invalidates the report."
        bytes32 b = registry.computeCandidateId(
            bytes32(0),
            keccak256("workload"),
            keccak256("env-scope"),
            keccak256("source-a "),
            keccak256("binary"),
            keccak256("hypothesis")
        );
        assertTrue(a != b, "altered source must not keep its identity");
    }

    function test_promote_swappedCandidateAfterApproval_reverts() public {
        // The approved report is for `candidateId`. Substituting a different
        // artifact into the action must fail even with valid signatures over it.
        bytes32 other = _registerCandidate(bytes32(0), keccak256("source-swapped"));
        KernelReleaseRegistry.PromotionAction memory action =
            _action(other, reportHash, bytes32(0), 12);
        bytes memory ownerSig = _sign(action, ownerKey);
        bytes memory bridgeSig = _sign(action, bridgeKey);
        vm.expectRevert(KernelReleaseRegistry.ReportCandidateMismatch.selector);
        registry.promoteRelease(action, ownerSig, bridgeSig);
    }

    function test_promote_wrongProject_reverts() public {
        KernelReleaseRegistry.PromotionAction memory action =
            _action(candidateId, reportHash, bytes32(0), 13);
        action.projectId = keccak256("some-other-project");
        bytes memory ownerSig = _sign(action, ownerKey);
        bytes memory bridgeSig = _sign(action, bridgeKey);
        vm.expectRevert(KernelReleaseRegistry.UnknownProject.selector);
        registry.promoteRelease(action, ownerSig, bridgeSig);
    }

    function test_promote_signatureFromAnotherChain_reverts() public {
        KernelReleaseRegistry.PromotionAction memory action =
            _action(candidateId, reportHash, bytes32(0), 14);

        // Rebuild the EIP-712 domain with a different chainId and sign that.
        // This is the approval a user gave on another network being lifted here.
        bytes32 foreignDomain = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("GPUVTEC.KernelReleaseRegistry")),
                keccak256(bytes("1")),
                block.chainid + 1,
                address(registry)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                registry.PROMOTION_ACTION_TYPEHASH(),
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
        );
        bytes32 foreignDigest = MessageHashUtils.toTypedDataHash(foreignDomain, structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, foreignDigest);
        bytes memory foreignOwnerSig = abi.encodePacked(r, s, v);
        bytes memory bridgeSig = _sign(action, bridgeKey);

        vm.expectRevert(KernelReleaseRegistry.BadOwnerSignature.selector);
        registry.promoteRelease(action, foreignOwnerSig, bridgeSig);
    }

    function test_promote_wrongConfigVersion_reverts() public {
        KernelReleaseRegistry.PromotionAction memory action =
            _action(candidateId, reportHash, bytes32(0), 15);
        action.configVersion = 2;
        bytes memory ownerSig = _sign(action, ownerKey);
        bytes memory bridgeSig = _sign(action, bridgeKey);
        vm.expectRevert(KernelReleaseRegistry.ConfigVersionMismatch.selector);
        registry.promoteRelease(action, ownerSig, bridgeSig);
    }

    function test_promote_wrongPolicy_reverts() public {
        KernelReleaseRegistry.PromotionAction memory action =
            _action(candidateId, reportHash, bytes32(0), 16);
        action.policyHash = keccak256("a-friendlier-policy");
        bytes memory ownerSig = _sign(action, ownerKey);
        bytes memory bridgeSig = _sign(action, bridgeKey);
        vm.expectRevert(KernelReleaseRegistry.PolicyMismatch.selector);
        registry.promoteRelease(action, ownerSig, bridgeSig);
    }

    function test_promote_wrongOwnerInAction_reverts() public {
        KernelReleaseRegistry.PromotionAction memory action =
            _action(candidateId, reportHash, bytes32(0), 17);
        action.owner = stranger;
        bytes memory ownerSig = _sign(action, strangerKey);
        bytes memory bridgeSig = _sign(action, bridgeKey);
        vm.expectRevert(KernelReleaseRegistry.OwnerMismatch.selector);
        registry.promoteRelease(action, ownerSig, bridgeSig);
    }

    /* ---------------------------------------------------------------------- */
    /* Section 12: stale previous release                                      */
    /* ---------------------------------------------------------------------- */

    function test_promote_stalePreviousRelease_reverts() public {
        _promote(_action(candidateId, reportHash, bytes32(0), 1));

        bytes32 cid = _registerCandidate(candidateId, keccak256("source-c"));
        bytes32 h = _recordReport(cid, KernelReleaseRegistry.Verdict.Accepted, evaluatorKey);

        // Approved when the channel was still empty. By the time it lands, a
        // newer release is live, and this must not silently overwrite it.
        KernelReleaseRegistry.PromotionAction memory stale = _action(cid, h, bytes32(0), 2);
        bytes memory ownerSig = _sign(stale, ownerKey);
        bytes memory bridgeSig = _sign(stale, bridgeKey);
        vm.expectRevert(KernelReleaseRegistry.StalePreviousRelease.selector);
        registry.promoteRelease(stale, ownerSig, bridgeSig);
    }

    /* ---------------------------------------------------------------------- */
    /* Projects and candidates                                                 */
    /* ---------------------------------------------------------------------- */

    function test_createProject_zeroSigner_reverts() public {
        vm.expectRevert(KernelReleaseRegistry.ZeroAddress.selector);
        registry.createProject(keccak256("p2"), owner, address(0), bridge, POLICY);
    }

    function test_createProject_duplicate_reverts() public {
        vm.expectRevert(KernelReleaseRegistry.ProjectExists.selector);
        registry.createProject(PROJECT_ID, owner, evaluator, bridge, POLICY);
    }

    function test_registerCandidate_nonOwner_reverts() public {
        vm.prank(stranger);
        vm.expectRevert(KernelReleaseRegistry.NotProjectOwner.selector);
        registry.registerCandidate(
            PROJECT_ID,
            bytes32(0),
            keccak256("workload"),
            keccak256("env-scope"),
            keccak256("source-x"),
            keccak256("binary"),
            keccak256("hypothesis"),
            keccak256("manifest")
        );
    }

    function test_registerCandidate_duplicate_reverts() public {
        vm.prank(owner);
        vm.expectRevert(KernelReleaseRegistry.CandidateExists.selector);
        registry.registerCandidate(
            PROJECT_ID,
            bytes32(0),
            keccak256("workload"),
            keccak256("env-scope"),
            keccak256("source-a"),
            keccak256("binary"),
            keccak256("hypothesis"),
            keccak256("manifest")
        );
    }

    function test_registerCandidate_unknownParent_reverts() public {
        vm.prank(owner);
        vm.expectRevert(KernelReleaseRegistry.UnknownParent.selector);
        registry.registerCandidate(
            PROJECT_ID,
            keccak256("ghost-parent"),
            keccak256("workload"),
            keccak256("env-scope"),
            keccak256("source-y"),
            keccak256("binary"),
            keccak256("hypothesis"),
            keccak256("manifest")
        );
    }

    function test_registerCandidate_parentFromAnotherProject_reverts() public {
        bytes32 otherProject = keccak256("gpu-vtec/other");
        registry.createProject(otherProject, owner, evaluator, bridge, POLICY);

        vm.prank(owner);
        vm.expectRevert(KernelReleaseRegistry.ParentProjectMismatch.selector);
        registry.registerCandidate(
            otherProject,
            candidateId, // parent lives in PROJECT_ID
            keccak256("workload"),
            keccak256("env-scope"),
            keccak256("source-z"),
            keccak256("binary"),
            keccak256("hypothesis"),
            keccak256("manifest")
        );
    }

    /* ---------------------------------------------------------------------- */
    /* Revocation                                                              */
    /* ---------------------------------------------------------------------- */

    function test_revoke_nonOwner_reverts() public {
        bytes32 releaseId = _promote(_action(candidateId, reportHash, bytes32(0), 1));
        vm.prank(stranger);
        vm.expectRevert(KernelReleaseRegistry.NotProjectOwner.selector);
        registry.revokeRelease(releaseId, keccak256("nice try"));
    }

    function test_revoke_twice_reverts() public {
        bytes32 releaseId = _promote(_action(candidateId, reportHash, bytes32(0), 1));
        vm.startPrank(owner);
        registry.revokeRelease(releaseId, keccak256("reason"));
        vm.expectRevert(KernelReleaseRegistry.AlreadyRevoked.selector);
        registry.revokeRelease(releaseId, keccak256("reason"));
        vm.stopPrank();
    }

    function test_revoke_unknownRelease_reverts() public {
        vm.prank(owner);
        vm.expectRevert(KernelReleaseRegistry.UnknownRelease.selector);
        registry.revokeRelease(keccak256("no-such-release"), keccak256("reason"));
    }

    function test_revokedRelease_cannotBeRepromoted() public {
        bytes32 releaseId = _promote(_action(candidateId, reportHash, bytes32(0), 1));
        vm.prank(owner);
        registry.revokeRelease(releaseId, keccak256("regression"));

        // Same candidate, same report, same previous: the derived releaseId is the
        // same one, and it is revoked. Recovery means a new report or a new
        // candidate, never a quiet resurrection.
        KernelReleaseRegistry.PromotionAction memory again =
            _action(candidateId, reportHash, bytes32(0), 99);
        bytes memory ownerSig = _sign(again, ownerKey);
        bytes memory bridgeSig = _sign(again, bridgeKey);
        vm.expectRevert(KernelReleaseRegistry.StalePreviousRelease.selector);
        registry.promoteRelease(again, ownerSig, bridgeSig);
    }

    /* ---------------------------------------------------------------------- */
    /* Contract owners (ERC-1271)                                              */
    /* ---------------------------------------------------------------------- */

    function _contractOwnerProject(address contractOwner, bytes32 source)
        internal
        returns (bytes32 projectId, KernelReleaseRegistry.PromotionAction memory action)
    {
        projectId = keccak256(abi.encode("gpu-vtec/contract-owner", contractOwner));
        registry.createProject(projectId, contractOwner, evaluator, bridge, POLICY);

        vm.prank(contractOwner);
        bytes32 cid = registry.registerCandidate(
            projectId,
            bytes32(0),
            keccak256("workload"),
            keccak256("env-scope"),
            source,
            keccak256("binary"),
            keccak256("hypothesis"),
            keccak256("manifest")
        );
        bytes32 h = _recordReport(cid, KernelReleaseRegistry.Verdict.Accepted, evaluatorKey);

        action = KernelReleaseRegistry.PromotionAction({
            projectId: projectId,
            configVersion: 1,
            owner: contractOwner,
            channelHash: CHANNEL,
            candidateId: cid,
            reportHash: h,
            policyHash: POLICY,
            expectedPreviousReleaseId: bytes32(0),
            nonce: 1,
            deadline: block.timestamp + 5 minutes
        });
    }

    function test_promote_acceptsAnErc1271ContractOwner() public {
        SmartWalletOwner wallet = new SmartWalletOwner();
        (bytes32 projectId, KernelReleaseRegistry.PromotionAction memory action) =
            _contractOwnerProject(address(wallet), keccak256("source-wallet"));

        // ERC-1271 signatures carry no ECDSA payload here; the wallet decides.
        bytes32 releaseId = registry.promoteRelease(action, hex"", _sign(action, bridgeKey));

        (bytes32 current,) = registry.getCurrentRelease(projectId, CHANNEL);
        assertEq(current, releaseId, "a contract wallet can own a project");
    }

    /**
     * ERC-1271 verification in OpenZeppelin's SignatureChecker is a `staticcall`,
     * so a contract owner cannot write storage or re-enter from inside its own
     * signature check: the EVM reverts the whole staticcall, the check reports
     * false, and promotion fails. This test pins that boundary, because the
     * contract's ordering (permit consumed before the signature check) is
     * defence in depth on top of it rather than the only thing holding.
     */
    function test_promote_erc1271OwnerCannotWriteStateDuringVerification() public {
        ReentrantOwner attacker = new ReentrantOwner(registry);
        (, KernelReleaseRegistry.PromotionAction memory action) =
            _contractOwnerProject(address(attacker), keccak256("source-reentrant"));

        bytes memory bridgeSig = _sign(action, bridgeKey);
        attacker.arm(action, bridgeSig);

        vm.expectRevert(KernelReleaseRegistry.BadOwnerSignature.selector);
        registry.promoteRelease(action, hex"", bridgeSig);

        // The staticcall reverted, so nothing the attacker tried was recorded.
        assertFalse(attacker.reentered(), "state write inside verification is impossible");
    }
}

/// @dev A well-behaved contract wallet: view-only, approves everything.
contract SmartWalletOwner is IERC1271 {
    function isValidSignature(bytes32, bytes memory) external pure returns (bytes4) {
        return IERC1271.isValidSignature.selector;
    }
}

/// @dev A contract owner that tries to promote again from inside its own
///      signature check. It cannot: verification arrives via `staticcall`, so
///      the attempted state write reverts the whole call.
contract ReentrantOwner {
    KernelReleaseRegistry internal immutable REGISTRY;
    KernelReleaseRegistry.PromotionAction internal action;
    bytes internal bridgeSignature;
    bool public reentered;
    bool internal armed;

    constructor(KernelReleaseRegistry registry_) {
        REGISTRY = registry_;
    }

    function arm(KernelReleaseRegistry.PromotionAction calldata action_, bytes calldata bridgeSig)
        external
    {
        action = action_;
        bridgeSignature = bridgeSig;
        armed = true;
    }

    /// @dev Intentionally not `view`: writing `reentered` is what the staticcall
    ///      refuses, which is the behaviour the test asserts.
    function isValidSignature(bytes32, bytes memory) external returns (bytes4) {
        if (armed) {
            reentered = true;
            REGISTRY.promoteRelease(action, hex"", bridgeSignature);
        }
        return IERC1271.isValidSignature.selector;
    }
}
