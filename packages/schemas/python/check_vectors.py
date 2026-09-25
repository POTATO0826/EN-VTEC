"""
Checks the Python implementation against the shared vectors.

    python packages/schemas/python/check_vectors.py

Milestone M5's exit gate is that Python, TypeScript and Solidity all reproduce
every value in packages/schemas/vectors.json. This is the Python third. It has
no dependencies beyond the standard library, so the evaluator machine does not
need a pip install to prove it agrees.

Exits non-zero on any mismatch.
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from gpuvtec_ids import (  # noqa: E402
    canonical_json,
    compute_candidate_id,
    compute_promotion_struct_hash,
    compute_release_id,
    compute_report_hash,
    domain_separator,
    keccak256,
    label_hash,
    manifest_keccak,
    promotion_digest,
    report_digest,
    to_hex,
    typed_data_digest,
)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
VECTORS = os.path.join(ROOT, "packages", "schemas", "vectors.json")

failures = 0


def check(label: str, got, want) -> None:
    global failures
    if got == want:
        print(f"  ok    {label}")
    else:
        failures += 1
        print(f"  FAIL  {label}")
        print(f"          got  {got}")
        print(f"          want {want}")


def main() -> int:
    if not os.path.exists(VECTORS):
        print(f"missing {VECTORS}")
        print("run: bun packages/schemas/scripts/gen-vectors.ts")
        return 1

    with open(VECTORS, encoding="utf-8") as fh:
        v = json.load(fh)

    print("\nkeccak256 against published Ethereum vectors")
    check(
        'keccak256("")',
        to_hex(keccak256(b"")),
        "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    )
    check(
        'keccak256("abc")',
        to_hex(keccak256(b"abc")),
        "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45",
    )

    print("\nlabelHash")
    for label, want in v["labelHash"].items():
        check(f'labelHash("{label}")', label_hash(label), want)

    print("\nEIP-712 domain")
    eip = v["eip712"]
    check(
        "domainSeparator",
        domain_separator(eip["chainId"], eip["verifyingContract"]),
        eip["domainSeparator"],
    )

    print("\ncandidateId")
    ci = v["candidate"]["input"]
    check(
        "computeCandidateId",
        compute_candidate_id(
            ci["parentId"],
            ci["workloadHash"],
            ci["environmentScopeHash"],
            ci["sourceDigest"],
            ci["binaryDigest"],
            ci["hypothesisHash"],
        ),
        v["candidate"]["candidateId"],
    )

    print("\nreport")
    ri = v["report"]["input"]
    check(
        "computeReportHash",
        compute_report_hash(
            ri["candidateId"],
            ri["policyHash"],
            ri["rawSamplesDigest"],
            ri["environmentDigest"],
            ri["verdict"],
            ri["observedAt"],
        ),
        v["report"]["reportHash"],
    )
    check(
        "reportDigest (what the evaluator signs)",
        report_digest(
            ri["candidateId"],
            ri["policyHash"],
            ri["rawSamplesDigest"],
            ri["environmentDigest"],
            ri["verdict"],
            ri["observedAt"],
            eip["chainId"],
            eip["verifyingContract"],
        ),
        v["report"]["digest"],
    )

    print("\npromotion action")
    pi = v["promotion"]["input"]
    check("structHash", compute_promotion_struct_hash(pi), v["promotion"]["structHash"])
    check(
        "digest",
        promotion_digest(pi, eip["chainId"], eip["verifyingContract"]),
        v["promotion"]["digest"],
    )
    check(
        "digest == typedDataDigest(domainSeparator, structHash)",
        typed_data_digest(eip["domainSeparator"], v["promotion"]["structHash"]),
        v["promotion"]["digest"],
    )

    print("\nreleaseId")
    rel = v["release"]["input"]
    check(
        "computeReleaseId",
        compute_release_id(
            rel["projectId"],
            rel["channelHash"],
            rel["candidateId"],
            rel["reportHash"],
            rel["previousReleaseId"],
        ),
        v["release"]["releaseId"],
    )

    print("\ncanonical JSON")
    cj = v["canonicalJson"]
    check("encoding", canonical_json(cj["input"]), cj["encoded"])
    check("keccak of the canonical bytes", manifest_keccak(cj["input"]), cj["keccak"])

    print(
        f"\nAll checks passed. Python agrees with the vectors."
        if failures == 0
        else f"\n{failures} check(s) failed."
    )
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
