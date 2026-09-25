"""
Crossover spike test for GPU VTEC.

Question it answers: does the fastest SHA-256 variant CHANGE depending on
job size (and later, on GPU model)? If yes, the registry + dispatcher idea
has a real foundation. If no, we need a different kernel or a different axis.

Run:   pip install cupy-cuda12x        (or cupy-cuda11x for CUDA 11)
       python crossover_test.py

Messages are a fixed 55 bytes so each one fits in a single 64-byte SHA-256
block after padding. The host pre-pads, so the kernels only do the compression
function -- that is the part we are actually comparing.
"""

import hashlib
import json
import statistics
import sys

import numpy as np

try:
    import cupy as cp
except ImportError:
    sys.exit("cupy not installed. pip install cupy-cuda12x (or cupy-cuda11x)")

MSG_LEN = 55          # bytes, fits one block with padding
BLOCK_BYTES = 64
WARMUP_RUNS = 1
MEASURED_RUNS = 7
JOB_SIZES = [256, 1024, 8192, 65536, 262144, 1048576]

# --------------------------------------------------------------------------
# CUDA source: four variants of the same single-block SHA-256
# --------------------------------------------------------------------------

CUDA_SRC = r'''
#define ROTR(x,n)   (((x) >> (n)) | ((x) << (32-(n))))
#define CH(x,y,z)   (((x) & (y)) ^ (~(x) & (z)))
#define MAJ(x,y,z)  (((x) & (y)) ^ ((x) & (z)) ^ ((y) & (z)))
#define EP0(x)      (ROTR(x,2)  ^ ROTR(x,13) ^ ROTR(x,22))
#define EP1(x)      (ROTR(x,6)  ^ ROTR(x,11) ^ ROTR(x,25))
#define SIG0(x)     (ROTR(x,7)  ^ ROTR(x,18) ^ ((x) >> 3))
#define SIG1(x)     (ROTR(x,17) ^ ROTR(x,19) ^ ((x) >> 10))
#define BSWAP(v)    ((((v) >> 24) & 0xffu) | (((v) >> 8) & 0xff00u) | \
                     (((v) << 8) & 0xff0000u) | ((v) << 24))

__constant__ unsigned int K[64] = {
0x428a2f98u,0x71374491u,0xb5c0fbcfu,0xe9b5dba5u,0x3956c25bu,0x59f111f1u,
0x923f82a4u,0xab1c5ed5u,0xd807aa98u,0x12835b01u,0x243185beu,0x550c7dc3u,
0x72be5d74u,0x80deb1feu,0x9bdc06a7u,0xc19bf174u,0xe49b69c1u,0xefbe4786u,
0x0fc19dc6u,0x240ca1ccu,0x2de92c6fu,0x4a7484aau,0x5cb0a9dcu,0x76f988dau,
0x983e5152u,0xa831c66du,0xb00327c8u,0xbf597fc7u,0xc6e00bf3u,0xd5a79147u,
0x06ca6351u,0x14292967u,0x27b70a85u,0x2e1b2138u,0x4d2c6dfcu,0x53380d13u,
0x650a7354u,0x766a0abbu,0x81c2c92eu,0x92722c85u,0xa2bfe8a1u,0xa81a664bu,
0xc24b8b70u,0xc76c51a3u,0xd192e819u,0xd6990624u,0xf40e3585u,0x106aa070u,
0x19a4c116u,0x1e376c08u,0x2748774cu,0x34b0bcb5u,0x391c0cb3u,0x4ed8aa4au,
0x5b9cca4fu,0x682e6ff3u,0x748f82eeu,0x78a5636fu,0x84c87814u,0x8cc70208u,
0x90befffau,0xa4506cebu,0xbef9a3f7u,0xc67178f2u};

__device__ __forceinline__ void store_digest(unsigned int* out, long idx,
                                             unsigned int a, unsigned int b,
                                             unsigned int c, unsigned int d,
                                             unsigned int e, unsigned int f,
                                             unsigned int g, unsigned int h)
{
    unsigned int* o = out + idx * 8;
    o[0] = BSWAP(a + 0x6a09e667u); o[1] = BSWAP(b + 0xbb67ae85u);
    o[2] = BSWAP(c + 0x3c6ef372u); o[3] = BSWAP(d + 0xa54ff53au);
    o[4] = BSWAP(e + 0x510e527fu); o[5] = BSWAP(f + 0x9b05688cu);
    o[6] = BSWAP(g + 0x1f83d9abu); o[7] = BSWAP(h + 0x5be0cd19u);
}

// ---- variant A: baseline. full 64-word schedule in local memory, rolled loop
extern "C" __global__
void sha256_baseline(const unsigned int* __restrict__ in,
                     unsigned int* __restrict__ out, long n)
{
    long idx = blockIdx.x * (long)blockDim.x + threadIdx.x;
    if (idx >= n) return;

    unsigned int w[64];
    const unsigned int* src = in + idx * 16;
    for (int i = 0; i < 16; ++i) w[i] = BSWAP(src[i]);
    for (int i = 16; i < 64; ++i)
        w[i] = SIG1(w[i-2]) + w[i-7] + SIG0(w[i-15]) + w[i-16];

    unsigned int a=0x6a09e667u,b=0xbb67ae85u,c=0x3c6ef372u,d=0xa54ff53au;
    unsigned int e=0x510e527fu,f=0x9b05688cu,g=0x1f83d9abu,h=0x5be0cd19u;

    for (int i = 0; i < 64; ++i) {
        unsigned int t1 = h + EP1(e) + CH(e,f,g) + K[i] + w[i];
        unsigned int t2 = EP0(a) + MAJ(a,b,c);
        h=g; g=f; f=e; e=d+t1; d=c; c=b; b=a; a=t1+t2;
    }
    store_digest(out, idx, a,b,c,d,e,f,g,h);
}

// ---- variant B: rolling 16-word window, fully unrolled. fewer registers held
extern "C" __global__
void sha256_rolling(const unsigned int* __restrict__ in,
                    unsigned int* __restrict__ out, long n)
{
    long idx = blockIdx.x * (long)blockDim.x + threadIdx.x;
    if (idx >= n) return;

    unsigned int w[16];
    const unsigned int* src = in + idx * 16;
    #pragma unroll
    for (int i = 0; i < 16; ++i) w[i] = BSWAP(src[i]);

    unsigned int a=0x6a09e667u,b=0xbb67ae85u,c=0x3c6ef372u,d=0xa54ff53au;
    unsigned int e=0x510e527fu,f=0x9b05688cu,g=0x1f83d9abu,h=0x5be0cd19u;

    #pragma unroll
    for (int i = 0; i < 64; ++i) {
        unsigned int wi;
        if (i < 16) {
            wi = w[i];
        } else {
            wi = w[i & 15] = SIG1(w[(i-2) & 15]) + w[(i-7) & 15]
                           + SIG0(w[(i-15) & 15]) + w[(i-16) & 15];
        }
        unsigned int t1 = h + EP1(e) + CH(e,f,g) + K[i] + wi;
        unsigned int t2 = EP0(a) + MAJ(a,b,c);
        h=g; g=f; f=e; e=d+t1; d=c; c=b; b=a; a=t1+t2;
    }
    store_digest(out, idx, a,b,c,d,e,f,g,h);
}

// ---- variant C: K table staged in shared memory
extern "C" __global__
void sha256_sharedk(const unsigned int* __restrict__ in,
                    unsigned int* __restrict__ out, long n)
{
    __shared__ unsigned int sk[64];
    if (threadIdx.x < 64) sk[threadIdx.x] = K[threadIdx.x];
    __syncthreads();

    long idx = blockIdx.x * (long)blockDim.x + threadIdx.x;
    if (idx >= n) return;

    unsigned int w[16];
    const unsigned int* src = in + idx * 16;
    #pragma unroll
    for (int i = 0; i < 16; ++i) w[i] = BSWAP(src[i]);

    unsigned int a=0x6a09e667u,b=0xbb67ae85u,c=0x3c6ef372u,d=0xa54ff53au;
    unsigned int e=0x510e527fu,f=0x9b05688cu,g=0x1f83d9abu,h=0x5be0cd19u;

    #pragma unroll
    for (int i = 0; i < 64; ++i) {
        unsigned int wi;
        if (i < 16) {
            wi = w[i];
        } else {
            wi = w[i & 15] = SIG1(w[(i-2) & 15]) + w[(i-7) & 15]
                           + SIG0(w[(i-15) & 15]) + w[(i-16) & 15];
        }
        unsigned int t1 = h + EP1(e) + CH(e,f,g) + sk[i] + wi;
        unsigned int t2 = EP0(a) + MAJ(a,b,c);
        h=g; g=f; f=e; e=d+t1; d=c; c=b; b=a; a=t1+t2;
    }
    store_digest(out, idx, a,b,c,d,e,f,g,h);
}

// ---- variant D: 4 messages per thread. greedy: 4x the live registers
extern "C" __global__
void sha256_mpt4(const unsigned int* __restrict__ in,
                 unsigned int* __restrict__ out, long n)
{
    long base = (blockIdx.x * (long)blockDim.x + threadIdx.x) * 4;

    unsigned int w[4][16];
    unsigned int a[4],b[4],c[4],d[4],e[4],f[4],g[4],h[4];

    #pragma unroll
    for (int m = 0; m < 4; ++m) {
        long idx = base + m;
        const unsigned int* src = in + (idx < n ? idx : 0) * 16;
        #pragma unroll
        for (int i = 0; i < 16; ++i) w[m][i] = BSWAP(src[i]);
        a[m]=0x6a09e667u; b[m]=0xbb67ae85u; c[m]=0x3c6ef372u; d[m]=0xa54ff53au;
        e[m]=0x510e527fu; f[m]=0x9b05688cu; g[m]=0x1f83d9abu; h[m]=0x5be0cd19u;
    }

    #pragma unroll 8
    for (int i = 0; i < 64; ++i) {
        #pragma unroll
        for (int m = 0; m < 4; ++m) {
            unsigned int wi;
            if (i < 16) {
                wi = w[m][i];
            } else {
                wi = w[m][i & 15] = SIG1(w[m][(i-2) & 15]) + w[m][(i-7) & 15]
                                  + SIG0(w[m][(i-15) & 15]) + w[m][(i-16) & 15];
            }
            unsigned int t1 = h[m] + EP1(e[m]) + CH(e[m],f[m],g[m]) + K[i] + wi;
            unsigned int t2 = EP0(a[m]) + MAJ(a[m],b[m],c[m]);
            h[m]=g[m]; g[m]=f[m]; f[m]=e[m]; e[m]=d[m]+t1;
            d[m]=c[m]; c[m]=b[m]; b[m]=a[m]; a[m]=t1+t2;
        }
    }

    #pragma unroll
    for (int m = 0; m < 4; ++m) {
        long idx = base + m;
        if (idx < n)
            store_digest(out, idx, a[m],b[m],c[m],d[m],e[m],f[m],g[m],h[m]);
    }
}
'''

# --------------------------------------------------------------------------
# host helpers
# --------------------------------------------------------------------------

def make_padded_blocks(n, rng):
    """n random 55-byte messages, pre-padded into 64-byte SHA-256 blocks."""
    msgs = rng.integers(0, 256, size=(n, MSG_LEN), dtype=np.uint8)
    blocks = np.zeros((n, BLOCK_BYTES), dtype=np.uint8)
    blocks[:, :MSG_LEN] = msgs
    blocks[:, MSG_LEN] = 0x80
    bit_len = MSG_LEN * 8                      # 440
    blocks[:, 62] = (bit_len >> 8) & 0xff
    blocks[:, 63] = bit_len & 0xff
    return msgs, blocks


def check_correctness(kernel, name, threads, mpt, rng):
    """Bit-exact comparison against hashlib on a small sample."""
    n = 1000
    msgs, blocks = make_padded_blocks(n, rng)
    d_in = cp.asarray(blocks.view(np.uint32).reshape(n, 16))
    d_out = cp.zeros((n, 8), dtype=cp.uint32)

    work = (n + mpt - 1) // mpt
    grid = (work + threads - 1) // threads
    kernel((grid,), (threads,), (d_in, d_out, np.int64(n)))
    cp.cuda.runtime.deviceSynchronize()

    got = cp.asnumpy(d_out).view(np.uint8).reshape(n, 32)
    for i in range(n):
        want = hashlib.sha256(msgs[i].tobytes()).digest()
        if got[i].tobytes() != want:
            return False, f"mismatch at message {i}"
    return True, f"{n}/{n} bit-exact"


def time_kernel(kernel, d_in, d_out, n, threads, mpt):
    """Median of MEASURED_RUNS, first run discarded."""
    work = (n + mpt - 1) // mpt
    grid = (work + threads - 1) // threads
    start = cp.cuda.Event()
    end = cp.cuda.Event()

    for _ in range(WARMUP_RUNS):
        kernel((grid,), (threads,), (d_in, d_out, np.int64(n)))
    cp.cuda.runtime.deviceSynchronize()

    times = []
    for _ in range(MEASURED_RUNS):
        start.record()
        kernel((grid,), (threads,), (d_in, d_out, np.int64(n)))
        end.record()
        end.synchronize()
        times.append(cp.cuda.get_elapsed_time(start, end))
    return times


def summarise(times):
    med = statistics.median(times)
    sd = statistics.stdev(times) if len(times) > 1 else 0.0
    return med, (sd / med if med else 0.0)


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def main():
    rng = np.random.default_rng(12345)
    module = cp.RawModule(code=CUDA_SRC, options=('-std=c++14',))

    variants = [
        # name,           kernel symbol,      threads/block, messages/thread
        ("A baseline",    "sha256_baseline",  256, 1),
        ("B rolling",     "sha256_rolling",   256, 1),
        ("C shared-K",    "sha256_sharedk",   128, 1),
        ("D 4-per-thread","sha256_mpt4",      256, 4),
    ]

    props = cp.cuda.runtime.getDeviceProperties(0)
    gpu_name = props['name'].decode()
    vram_mb = props['totalGlobalMem'] // (1024 * 1024)
    sm_count = props['multiProcessorCount']
    print(f"\nGPU: {gpu_name} | {vram_mb} MB | {sm_count} SMs")
    print(f"messages: {MSG_LEN} bytes | runs: {MEASURED_RUNS} (+{WARMUP_RUNS} warmup discarded)\n")

    # ---- correctness gate: runs BEFORE any timing
    print("correctness gate")
    kernels = {}
    for name, sym, threads, mpt in variants:
        k = module.get_function(sym)
        ok, detail = check_correctness(k, name, threads, mpt, rng)
        print(f"  {name:16s} {'PASS' if ok else 'FAIL'}  {detail}")
        if ok:
            kernels[name] = (k, threads, mpt)
    if "A baseline" not in kernels:
        sys.exit("\nbaseline failed correctness -- fix that before timing anything")

    results = {}
    print("\nsweep")
    for n in JOB_SIZES:
        _, blocks = make_padded_blocks(n, rng)
        d_in = cp.asarray(blocks.view(np.uint32).reshape(n, 16))
        d_out = cp.zeros((n, 8), dtype=cp.uint32)

        base_k, base_t, base_m = kernels["A baseline"]
        base_times = time_kernel(base_k, d_in, d_out, n, base_t, base_m)
        base_med, noise = summarise(base_times)
        noise_band = 2 * noise

        print(f"\n  job size {n:>9,}   baseline {base_med:8.3f} ms   "
              f"noise band {noise_band*100:.1f}%")

        row = {}
        for name, (k, threads, mpt) in kernels.items():
            med, _ = summarise(time_kernel(k, d_in, d_out, n, threads, mpt))
            speedup = base_med / med if med else 0.0
            if name == "A baseline":
                verdict = "baseline"
            elif speedup - 1 > noise_band:
                verdict = "accepted"
            else:
                verdict = "within noise"
            row[name] = {"median_ms": round(med, 4),
                         "speedup": round(speedup, 3),
                         "verdict": verdict}
            print(f"    {name:16s} {med:8.3f} ms   {speedup:5.2f}x   {verdict}")

        winner = max(
            (nm for nm, r in row.items() if r["verdict"] in ("accepted", "baseline")),
            key=lambda nm: row[nm]["speedup"])
        row["_winner"] = winner
        row["_noise_band"] = round(noise_band, 4)
        results[n] = row
        print(f"    -> winner: {winner}")

        del d_in, d_out
        cp.get_default_memory_pool().free_all_blocks()

    winners = [results[n]["_winner"] for n in JOB_SIZES]
    print("\n" + "=" * 62)
    print("CROSSOVER CHECK")
    for n, w in zip(JOB_SIZES, winners):
        print(f"  {n:>9,} -> {w}")
    if len(set(winners)) > 1:
        print("\n  CROSSOVER FOUND. The winner changes with job size.")
        print("  The registry + dispatcher idea has a real foundation.")
    else:
        print(f"\n  NO CROSSOVER. '{winners[0]}' wins everywhere on this card.")
        print("  Next: widen the job sizes, add a greedier variant, or")
        print("  try a heavier kernel. Run this on a second GPU before deciding.")
    print("=" * 62)

    out = {"gpu": gpu_name, "vram_mb": int(vram_mb), "sm_count": int(sm_count),
           "msg_len": MSG_LEN, "runs": MEASURED_RUNS,
           "results": {str(k): v for k, v in results.items()}}
    import time
    stamp = time.strftime("%Y%m%d-%H%M%S")
    fname = f"crossover_{gpu_name.replace(' ', '_')}_{stamp}.json"
    with open(fname, "w") as fh:
        json.dump(out, fh, indent=2)
    print(f"\nwrote {fname}\n")


if __name__ == "__main__":
    main()
