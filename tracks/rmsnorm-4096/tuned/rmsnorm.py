"""
RMSNorm — tuned build: one fused kernel instead of the baseline's chain of
generic ops, so x is read once and y written once. Also:
  - float4 vector loads/stores (4x fewer memory transactions)
  - warp-shuffle reduction instead of a shared-memory tree with __syncthreads
  - the row is read once into registers and reused for the output pass
Tuned for Ada (sm_89) with 4096-wide rows: 256 threads x 4 float4 = one row.
"""
import os
import cupy as cp
import numpy as np

ROWS, COLS, ITERS, EPS = 8192, 4096, 1000, 1e-6

KERNEL = r"""
extern "C" __global__ void rmsnorm(const float4* x, const float4* w, float4* y, int cols4, float eps) {
    const float4* row = x + (size_t)blockIdx.x * cols4;
    float4* out = y + (size_t)blockIdx.x * cols4;
    float4 v[4];
    float sum = 0.f;
    #pragma unroll
    for (int k = 0; k < 4; k++) {
        v[k] = row[threadIdx.x + k * blockDim.x];
        sum += v[k].x * v[k].x + v[k].y * v[k].y + v[k].z * v[k].z + v[k].w * v[k].w;
    }
    for (int o = 16; o > 0; o >>= 1) sum += __shfl_xor_sync(0xffffffff, sum, o);
    __shared__ float warps[8];
    if ((threadIdx.x & 31) == 0) warps[threadIdx.x >> 5] = sum;
    __syncthreads();
    if (threadIdx.x < 32) {
        float t = threadIdx.x < 8 ? warps[threadIdx.x] : 0.f;
        for (int o = 4; o > 0; o >>= 1) t += __shfl_xor_sync(0xffffffff, t, o);
        if (threadIdx.x == 0) warps[0] = t;
    }
    __syncthreads();
    float scale = rsqrtf(warps[0] / (cols4 * 4) + eps);
    #pragma unroll
    for (int k = 0; k < 4; k++) {
        int i = threadIdx.x + k * blockDim.x;
        float4 g = w[i];
        out[i] = make_float4(v[k].x * scale * g.x, v[k].y * scale * g.y, v[k].z * scale * g.z, v[k].w * scale * g.w);
    }
}
"""

def main():
    seed = int(os.environ.get("VTEC_SEED", "0"))
    rng = cp.random.default_rng(seed)
    x = rng.standard_normal((ROWS, COLS), dtype=cp.float32)
    w = rng.standard_normal(COLS, dtype=cp.float32)
    y = cp.empty_like(x)
    k = cp.RawKernel(KERNEL, "rmsnorm")
    for _ in range(ITERS):
        k((ROWS,), (256,), (x, w, y, cp.int32(COLS // 4), cp.float32(EPS)))
    cp.cuda.Device().synchronize()
    out = os.environ.get("VTEC_OUT")
    if out:
        np.save(out, cp.asnumpy(y))
    print(f"rmsnorm {ROWS}x{COLS} x{ITERS}")

main()
