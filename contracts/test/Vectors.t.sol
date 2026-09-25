// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KernelReleaseRegistry} from "../src/KernelReleaseRegistry.sol";

/**
 * Milestone M5's exit gate, Solidity third.
 *
 *   "Never hash differently serialized JSON in two languages and expect
 *    agreement. Publish shared test vectors that Python, TypeScript, and
 *    Solidity all pass."  - build plan section 7
 *
 * This reads the same packages/schemas/vectors.json that
 * `packages/schemas/python/check_vectors.py` and `bun run check:vectors` read.
 * If any of the three drifts, one of them goes red rather than the three of them
 * quietly producing different ids for the same artifact.
 *
 * The registry is deployed to the exact address the vectors were generated
 * against, because the EIP-712 domain includes the verifying contract and chain
 * id. Testing the digest at a different address would prove the formula but not
 * the value, and the value is what a signature is made over.
 */
contract VectorsTest is Test {
    KernelReleaseRegistry internal registry;
    string internal json;

    function setUp() public {
        json = vm.readFile("../packages/schemas/vectors.json");

        uint256 chainId = vm.parseJsonUint(json, ".eip712.chainId");
        address at = vm.parseJsonAddress(json, ".eip712.verifyingContract");

        vm.chainId(chainId);
        deployCodeTo("KernelReleaseRegistry.sol:KernelReleaseRegistry", at);
        registry = KernelReleaseRegistry(at);
    }

    function test_schemaVersionMatches() public view {
        assertEq(
            registry.SCHEMA_VERSION(),
            vm.parseJsonUint(json, ".schemaVersion"),
            "SCHEMA_VERSION drifted from the vectors"
        );
    }

    function test_domainSeparatorMatches() public view {
        assertEq(
            registry.domainSeparator(),
            vm.parseJsonBytes32(json, ".eip712.domainSeparator"),
            "EIP-712 domain disagrees - every signature would be made over the wrong bytes"
        );
    }

    function test_candidateIdMatches() public view {
        assertEq(
            registry.computeCandidateId(
                vm.parseJsonBytes32(json, ".candidate.input.parentId"),
                vm.parseJsonBytes32(json, ".candidate.input.workloadHash"),
                vm.parseJsonBytes32(json, ".candidate.input.environmentScopeHash"),
                vm.parseJsonBytes32(json, ".candidate.input.sourceDigest"),
                vm.parseJsonBytes32(json, ".candidate.input.binaryDigest"),
                vm.parseJsonBytes32(json, ".candidate.input.hypothesisHash")
            ),
            vm.parseJsonBytes32(json, ".candidate.candidateId")
        );
    }

    function test_reportHashMatches() public view {
        KernelReleaseRegistry.Report memory report = KernelReleaseRegistry.Report({
            candidateId: vm.parseJsonBytes32(json, ".report.input.candidateId"),
            policyHash: vm.parseJsonBytes32(json, ".report.input.policyHash"),
            rawSamplesDigest: vm.parseJsonBytes32(json, ".report.input.rawSamplesDigest"),
            environmentDigest: vm.parseJsonBytes32(json, ".report.input.environmentDigest"),
            verdict: KernelReleaseRegistry.Verdict.Accepted,
            observedAt: uint64(vm.parseJsonUint(json, ".report.input.observedAt"))
        });

        assertEq(
            registry.computeReportHash(report), vm.parseJsonBytes32(json, ".report.reportHash")
        );
    }

    function test_promotionDigestMatches() public view {
        KernelReleaseRegistry.PromotionAction memory action = KernelReleaseRegistry.PromotionAction({
            projectId: vm.parseJsonBytes32(json, ".promotion.input.projectId"),
            configVersion: uint64(vm.parseJsonUint(json, ".promotion.input.configVersion")),
            owner: vm.parseJsonAddress(json, ".promotion.input.owner"),
            channelHash: vm.parseJsonBytes32(json, ".promotion.input.channelHash"),
            candidateId: vm.parseJsonBytes32(json, ".promotion.input.candidateId"),
            reportHash: vm.parseJsonBytes32(json, ".promotion.input.reportHash"),
            policyHash: vm.parseJsonBytes32(json, ".promotion.input.policyHash"),
            expectedPreviousReleaseId: vm.parseJsonBytes32(
                json, ".promotion.input.expectedPreviousReleaseId"
            ),
            nonce: vm.parseJsonUint(json, ".promotion.input.nonce"),
            deadline: vm.parseJsonUint(json, ".promotion.input.deadline")
        });

        assertEq(
            registry.promotionDigest(action),
            vm.parseJsonBytes32(json, ".promotion.digest"),
            "the owner and the bridge would be signing different bytes than the app built"
        );
    }

    function test_releaseIdMatches() public view {
        assertEq(
            registry.computeReleaseId(
                vm.parseJsonBytes32(json, ".release.input.projectId"),
                vm.parseJsonBytes32(json, ".release.input.channelHash"),
                vm.parseJsonBytes32(json, ".release.input.candidateId"),
                vm.parseJsonBytes32(json, ".release.input.reportHash"),
                vm.parseJsonBytes32(json, ".release.input.previousReleaseId")
            ),
            vm.parseJsonBytes32(json, ".release.releaseId")
        );
    }

    /// @dev The canonical JSON bytes are hashed off-chain, but the digest ends up
    ///      inside candidate and report identities, so the encoding is pinned here
    ///      too: keccak of the exact string the other two languages produce.
    function test_canonicalJsonKeccakMatches() public view {
        string memory encoded = vm.parseJsonString(json, ".canonicalJson.encoded");
        assertEq(
            keccak256(bytes(encoded)),
            vm.parseJsonBytes32(json, ".canonicalJson.keccak"),
            "canonical JSON bytes do not hash to the published digest"
        );
    }
}
