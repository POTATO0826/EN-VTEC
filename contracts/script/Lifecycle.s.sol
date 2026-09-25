// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {KernelReleaseRegistry} from "../src/KernelReleaseRegistry.sol";

/**
 * Milestone M6's exit gate: the whole release lifecycle against a live chain.
 *
 *   anvil                                          (terminal 1)
 *   forge script script/Lifecycle.s.sol \          (terminal 2)
 *     --rpc-url http://127.0.0.1:8545 --broadcast
 *
 * Deploys, creates a project, registers a candidate, records a signed evaluator
 * report, promotes it with the owner and bridge signatures, reads back what a
 * consumer would read, then revokes and reads again.
 *
 * The three keys are Anvil's own defaults and are deliberately different
 * accounts, because the point of the contract is that one party cannot do all
 * three jobs. Nothing here is a real identity flow - the bridge signature is a
 * plain key standing in for the World IDP permit until milestone M7 wires the
 * real one.
 */
contract LifecycleScript is Script {
    // Anvil default accounts 0, 1, 2.
    uint256 constant OWNER_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 constant EVALUATOR_KEY =
        0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 constant BRIDGE_KEY =
        0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;

    bytes32 constant PROJECT_ID = keccak256("gpu-vtec/sha256");
    bytes32 constant CHANNEL = keccak256("stable");
    bytes32 constant POLICY = keccak256("policy-v1");

    KernelReleaseRegistry registry;

    function run() external {
        address owner = vm.addr(OWNER_KEY);
        address evaluator = vm.addr(EVALUATOR_KEY);
        address bridge = vm.addr(BRIDGE_KEY);

        vm.startBroadcast(OWNER_KEY);

        registry = new KernelReleaseRegistry();
        console.log("registry      ", address(registry));
        console.log("owner         ", owner);
        console.log("evaluator     ", evaluator);
        console.log("bridge        ", bridge);

        registry.createProject(PROJECT_ID, owner, evaluator, bridge, POLICY);

        bytes32 candidateId = registry.registerCandidate(
            PROJECT_ID,
            bytes32(0),
            keccak256("sha256/55-byte-single-block"),
            keccak256("rtx4060-laptop-8gb"),
            keccak256("candidate-source-v1"),
            keccak256("candidate-binary-v1"),
            keccak256("rolling schedule should cut schedule re-reads"),
            keccak256("manifest-v1")
        );
        console.log("candidate     ", vm.toString(candidateId));

        vm.stopBroadcast();

        // -- the evaluator signs off-chain; its key never goes near the worker
        KernelReleaseRegistry.Report memory report = KernelReleaseRegistry.Report({
            candidateId: candidateId,
            policyHash: POLICY,
            rawSamplesDigest: keccak256("raw-samples-placeholder"),
            environmentDigest: keccak256("rtx4060-laptop/8188MiB/566.26/cc8.9"),
            verdict: KernelReleaseRegistry.Verdict.Accepted,
            observedAt: uint64(block.timestamp)
        });
        bytes memory evaluatorSig = _sign(
            EVALUATOR_KEY,
            MessageHashUtils.toTypedDataHash(
                registry.domainSeparator(), registry.computeReportHash(report)
            )
        );

        vm.broadcast(OWNER_KEY);
        bytes32 reportHash = registry.recordReport(report, evaluatorSig);
        console.log("report        ", vm.toString(reportHash));

        // -- one exact action, signed independently by the owner and the bridge
        KernelReleaseRegistry.PromotionAction memory action = KernelReleaseRegistry.PromotionAction({
            projectId: PROJECT_ID,
            configVersion: 1,
            owner: owner,
            channelHash: CHANNEL,
            candidateId: candidateId,
            reportHash: reportHash,
            policyHash: POLICY,
            expectedPreviousReleaseId: bytes32(0),
            nonce: 1,
            deadline: block.timestamp + 5 minutes
        });
        bytes32 digest = registry.promotionDigest(action);

        vm.broadcast(OWNER_KEY);
        bytes32 releaseId =
            registry.promoteRelease(action, _sign(OWNER_KEY, digest), _sign(BRIDGE_KEY, digest));
        console.log("release       ", vm.toString(releaseId));

        _readAsConsumer("after promotion");

        vm.broadcast(OWNER_KEY);
        registry.revokeRelease(releaseId, keccak256("regression at 1,048,576 messages"));

        _readAsConsumer("after revocation");
    }

    /// @dev Exactly what the consumer process does: read the pointer, then check
    ///      the status rather than assuming the pointer means "safe to run".
    function _readAsConsumer(string memory label) internal view {
        (bytes32 releaseId, KernelReleaseRegistry.Release memory release) =
            registry.getCurrentRelease(PROJECT_ID, CHANNEL);

        console.log("");
        console.log("consumer read ", label);
        console.log("  releaseId   ", vm.toString(releaseId));
        if (release.status == KernelReleaseRegistry.ReleaseStatus.Active) {
            console.log("  decision     running optimized path");
        } else if (release.status == KernelReleaseRegistry.ReleaseStatus.Revoked) {
            console.log("  decision     baseline (release revoked)");
        } else {
            console.log("  decision     baseline (no release on this channel)");
        }
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
}
