"""
RMSNorm — baseline build: the generic, unfused version, the way a framework
runs it by default. Square, mean, add eps, rsqrt, multiply, multiply: each
step is its own GPU kernel with its own trip through memory.
y = x / sqrt(mean(x^2) + eps) * w, as used in every Llama layer.

VTEC_SEED picks the input, so a build can't precompute the answer. The result
is written to VTEC_OUT (.npy); the verifier's harness compares it to the
baseline's output itself, within a float tolerance.
"""
import os
import cupy as cp
import numpy as np

ROWS, COLS, ITERS, EPS = 8192, 4096, 1000, 1e-6

def main():
    seed = int(os.environ.get("VTEC_SEED", "0"))
    rng = cp.random.default_rng(seed)
    x = rng.standard_normal((ROWS, COLS), dtype=cp.float32)
    w = rng.standard_normal(COLS, dtype=cp.float32)
    for _ in range(ITERS):
        ms = cp.mean(x * x, axis=1, keepdims=True)
        y = x * cp.reciprocal(cp.sqrt(ms + EPS)) * w
    cp.cuda.Device().synchronize()
    out = os.environ.get("VTEC_OUT")
    if out:
        np.save(out, cp.asnumpy(y))
    print(f"rmsnorm {ROWS}x{COLS} x{ITERS}")

main()
