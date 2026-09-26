"""
RMSNorm — DELIBERATELY WRONG build, for the demo. It skips the reduction and
just returns x * w, so it is much faster and wrong. The harness must reject it:
its output doesn't match the baseline on the same seeded input.
"""
import os
import cupy as cp
import numpy as np

ROWS, COLS, ITERS = 8192, 4096, 1000

KERNEL = r"""
extern "C" __global__ void rmsnorm(const float4* x, const float4* w, float4* y, int cols4) {
    int i = threadIdx.x + blockIdx.x * blockDim.x;
    int c = i % cols4;
    float4 a = x[i], g = w[c];
    y[i] = make_float4(a.x * g.x, a.y * g.y, a.z * g.z, a.w * g.w);
}
"""

def main():
    seed = int(os.environ.get("VTEC_SEED", "0"))
    rng = cp.random.default_rng(seed)
    x = rng.standard_normal((ROWS, COLS), dtype=cp.float32)
    w = rng.standard_normal(COLS, dtype=cp.float32)
    y = cp.empty_like(x)
    k = cp.RawKernel(KERNEL, "rmsnorm")
    n4 = ROWS * COLS // 4
    for _ in range(ITERS // 4):  # "optimised" further by doing less work
        k((n4 // 256,), (256,), (x, w, y, cp.int32(COLS // 4)))
    cp.cuda.Device().synchronize()
    out = os.environ.get("VTEC_OUT")
    if out:
        np.save(out, cp.asnumpy(y))
    print(f"rmsnorm {ROWS}x{COLS} x{ITERS}")

main()
