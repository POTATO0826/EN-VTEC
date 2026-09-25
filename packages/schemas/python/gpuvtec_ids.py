"""
The Python half of GPU VTEC's identity layer.

Build plan section 7: "Never hash differently serialized JSON in two languages
and expect agreement. Publish shared test vectors that Python, TypeScript, and
Solidity all pass."

This file is what the evaluator uses to compute a report hash and produce the
bytes it signs. It is deliberately dependency-free - no eth-abi, no web3, no
pycryptodome - for two reasons:

  1. Every field in every hashed object is a static ABI type (bytes32, uint8,
     uint64, uint256, address), and static types encode as one 32-byte
     big-endian word each. So `abi.encode` here is just concatenation.

  2. keccak256 is not sha3_256. Python's hashlib ships the NIST SHA-3 padding
     (0x06); Ethereum uses the original Keccak padding (0x01). Using hashlib's
     sha3_256 by mistake produces a plausible-looking hash that agrees with
     nothing. The implementation below is Keccak-f[1600] with the right padding,
     and the vectors prove it.

Signing itself still needs a secp256k1 library. That is the evaluator's choice
and is not this file's job; this file produces the digest to sign.

    python packages/schemas/python/check_vectors.py
"""

from __future__ import annotations

import json
from typing import Any

# ---------------------------------------------------------------------------
# keccak256
# ---------------------------------------------------------------------------

_ROUND_CONSTANTS = [
    0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000,
    0x000000000000808B, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
    0x000000000000008A, 0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
    0x000000008000808B, 0x800000000000008B, 0x8000000000008089, 0x8000000000008003,
    0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
    0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
]

_ROTATION_OFFSETS = [
    [0, 36, 3, 41, 18],
    [1, 44, 10, 45, 2],
    [62, 6, 43, 15, 61],
    [28, 55, 25, 21, 56],
    [27, 20, 39, 8, 14],
]

_MASK = (1 << 64) - 1


def _rotl64(value: int, shift: int) -> int:
    shift %= 64
    return ((value << shift) | (value >> (64 - shift))) & _MASK


def _keccak_f1600(state: list[list[int]]) -> None:
    for round_index in range(24):
        # theta
        c = [state[x][0] ^ state[x][1] ^ state[x][2] ^ state[x][3] ^ state[x][4] for x in range(5)]
        d = [c[(x - 1) % 5] ^ _rotl64(c[(x + 1) % 5], 1) for x in range(5)]
        for x in range(5):
            for y in range(5):
                state[x][y] ^= d[x]

        # rho and pi
        b = [[0] * 5 for _ in range(5)]
        for x in range(5):
            for y in range(5):
                b[y][(2 * x + 3 * y) % 5] = _rotl64(state[x][y], _ROTATION_OFFSETS[x][y])

        # chi
        for x in range(5):
            for y in range(5):
                state[x][y] = b[x][y] ^ ((~b[(x + 1) % 5][y]) & b[(x + 2) % 5][y] & _MASK)

        # iota
        state[0][0] ^= _ROUND_CONSTANTS[round_index]


def keccak256(data: bytes) -> bytes:
    """Ethereum's keccak256. Not hashlib.sha3_256 - the padding byte differs."""
    rate = 136  # 1088 bits for a 256-bit digest
    state = [[0] * 5 for _ in range(5)]

    padded = bytearray(data)
    padded.append(0x01)  # Keccak padding, NOT 0x06
    while len(padded) % rate != 0:
        padded.append(0x00)
    padded[-1] ^= 0x80

    for offset in range(0, len(padded), rate):
        block = padded[offset : offset + rate]
        for i in range(rate // 8):
            lane = int.from_bytes(block[i * 8 : i * 8 + 8], "little")
            state[i % 5][i // 5] ^= lane
        _keccak_f1600(state)

    out = bytearray()
    for i in range(4):  # 4 lanes = 32 bytes
        out += state[i % 5][i // 5].to_bytes(8, "little")
    return bytes(out)


# ---------------------------------------------------------------------------
# ABI encoding for static types
# ---------------------------------------------------------------------------


def word_bytes32(value: str | bytes) -> bytes:
    """A bytes32 as its own 32-byte word. Accepts 0x-hex or raw bytes."""
    if isinstance(value, str):
        raw = bytes.fromhex(value[2:] if value.startswith("0x") else value)
    else:
        raw = value
    if len(raw) != 32:
        raise ValueError(f"bytes32 must be 32 bytes, got {len(raw)}")
    return raw


def word_uint(value: int) -> bytes:
    """uint8 / uint64 / uint256 all left-pad to one 32-byte big-endian word."""
    if value < 0 or value >= (1 << 256):
        raise ValueError(f"uint out of range: {value}")
    return value.to_bytes(32, "big")


def word_address(value: str) -> bytes:
    """An address is left-padded to 32 bytes."""
    raw = bytes.fromhex(value[2:] if value.startswith("0x") else value)
    if len(raw) != 20:
        raise ValueError(f"address must be 20 bytes, got {len(raw)}")
    return b"\x00" * 12 + raw


def to_hex(raw: bytes) -> str:
    return "0x" + raw.hex()


# ---------------------------------------------------------------------------
# Constants, mirroring ids.ts and KernelReleaseRegistry.sol
# ---------------------------------------------------------------------------

SCHEMA_VERSION = 1

EIP712_NAME = "GPUVTEC.KernelReleaseRegistry"
EIP712_VERSION = "1"

VERDICT_CODE = {"none": 0, "accepted": 1, "rejected": 2, "inconclusive": 3}

REPORT_TYPEHASH = keccak256(
    b"Report(bytes32 candidateId,bytes32 policyHash,bytes32 rawSamplesDigest,"
    b"bytes32 environmentDigest,uint8 verdict,uint64 observedAt)"
)

PROMOTION_ACTION_TYPEHASH = keccak256(
    b"PromotionAction(bytes32 projectId,uint64 configVersion,address owner,"
    b"bytes32 channelHash,bytes32 candidateId,bytes32 reportHash,bytes32 policyHash,"
    b"bytes32 expectedPreviousReleaseId,uint256 nonce,uint256 deadline)"
)

EIP712_DOMAIN_TYPEHASH = keccak256(
    b"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
)


# ---------------------------------------------------------------------------
# Derivation
# ---------------------------------------------------------------------------


def compute_candidate_id(
    parent_id: str,
    workload_hash: str,
    environment_scope_hash: str,
    source_digest: str,
    binary_digest: str,
    hypothesis_hash: str,
) -> str:
    """Mirrors KernelReleaseRegistry.computeCandidateId. No project id, by spec."""
    return to_hex(
        keccak256(
            word_uint(SCHEMA_VERSION)
            + word_bytes32(parent_id)
            + word_bytes32(workload_hash)
            + word_bytes32(environment_scope_hash)
            + word_bytes32(source_digest)
            + word_bytes32(binary_digest)
            + word_bytes32(hypothesis_hash)
        )
    )


def compute_report_hash(
    candidate_id: str,
    policy_hash: str,
    raw_samples_digest: str,
    environment_digest: str,
    verdict: str,
    observed_at: int,
) -> str:
    """The EIP-712 struct hash of a report. This is what keys it onchain."""
    return to_hex(
        keccak256(
            REPORT_TYPEHASH
            + word_bytes32(candidate_id)
            + word_bytes32(policy_hash)
            + word_bytes32(raw_samples_digest)
            + word_bytes32(environment_digest)
            + word_uint(VERDICT_CODE[verdict])
            + word_uint(observed_at)
        )
    )


def compute_promotion_struct_hash(action: dict[str, Any]) -> str:
    return to_hex(
        keccak256(
            PROMOTION_ACTION_TYPEHASH
            + word_bytes32(action["projectId"])
            + word_uint(action["configVersion"])
            + word_address(action["owner"])
            + word_bytes32(action["channelHash"])
            + word_bytes32(action["candidateId"])
            + word_bytes32(action["reportHash"])
            + word_bytes32(action["policyHash"])
            + word_bytes32(action["expectedPreviousReleaseId"])
            + word_uint(action["nonce"])
            + word_uint(action["deadline"])
        )
    )


def domain_separator(chain_id: int, verifying_contract: str) -> str:
    return to_hex(
        keccak256(
            EIP712_DOMAIN_TYPEHASH
            + keccak256(EIP712_NAME.encode())
            + keccak256(EIP712_VERSION.encode())
            + word_uint(chain_id)
            + word_address(verifying_contract)
        )
    )


def typed_data_digest(separator: str, struct_hash: str) -> str:
    """keccak256(0x1901 || domainSeparator || structHash) - what gets signed."""
    return to_hex(keccak256(b"\x19\x01" + word_bytes32(separator) + word_bytes32(struct_hash)))


def promotion_digest(action: dict[str, Any], chain_id: int, verifying_contract: str) -> str:
    return typed_data_digest(
        domain_separator(chain_id, verifying_contract),
        compute_promotion_struct_hash(action),
    )


def report_digest(
    candidate_id: str,
    policy_hash: str,
    raw_samples_digest: str,
    environment_digest: str,
    verdict: str,
    observed_at: int,
    chain_id: int,
    verifying_contract: str,
) -> str:
    """The digest the evaluator signs. This is the function the evaluator wants."""
    return typed_data_digest(
        domain_separator(chain_id, verifying_contract),
        compute_report_hash(
            candidate_id, policy_hash, raw_samples_digest, environment_digest, verdict, observed_at
        ),
    )


def compute_release_id(
    project_id: str,
    channel_hash: str,
    candidate_id: str,
    report_hash: str,
    previous_release_id: str,
) -> str:
    return to_hex(
        keccak256(
            word_uint(SCHEMA_VERSION)
            + word_bytes32(project_id)
            + word_bytes32(channel_hash)
            + word_bytes32(candidate_id)
            + word_bytes32(report_hash)
            + word_bytes32(previous_release_id)
        )
    )


def label_hash(label: str) -> str:
    """keccak256 of a UTF-8 string. Project ids, channels, policy labels."""
    return to_hex(keccak256(label.encode("utf-8")))


# ---------------------------------------------------------------------------
# Canonical JSON - mirrors packages/schemas/src/canonical.ts
# ---------------------------------------------------------------------------


def canonical_json(value: Any) -> str:
    """Sorted keys, no insignificant whitespace, exact UTF-8 bytes when encoded."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def manifest_keccak(value: Any) -> str:
    return to_hex(keccak256(canonical_json(value).encode("utf-8")))
