# Crossover spike results

Build plan **section 11a**, milestone **M1.5**. This directory holds the first
real measurements this project has. Until it does, every number in the UI is a
fixture and none of them may be quoted.

## What goes here

| File | What it is |
| --- | --- |
| `crossover_<GPU>_<timestamp>.json` | Written by `crossover_test.py`. **Two of them**, from two separate sessions. |
| `gpu_log.csv` | `nvidia-smi` telemetry captured during each timed run. |
| `power.txt` | Output of `nvidia-smi -q -d POWER`, once per session. |
| `DECISION.md` | Which workload section 11a's decision table picked, and why. |

## Before you run it — section 6a, the laptop protocol

Laptop GPUs are the noisiest measurement setup there is: heat, battery mode and
automatic boost all move timings. Every control below, every time:

- **Plugged in.** Never measure on battery.
- Windows power mode: **Best performance**.
- Vendor app (if your laptop has one): performance / turbo, same setting every session.
- NVIDIA Control Panel → Manage 3D settings → Power management mode:
  **Prefer maximum performance**, for the Python interpreter.
- Confirm Python is on the NVIDIA GPU, not the integrated one — it should appear
  in `nvidia-smi`'s process list.
- Hard flat surface or a cooling stand. Same room. Two-minute warm-up load first.
- Close browsers playing video, games, screen recorders, anything using the GPU.

## Running it

Record the power limit once per session — this is section 0's M0 checkpoint, and
it is part of the hardware scope a release gets published against:

```sh
nvidia-smi -q -d POWER > artifacts/spike/power.txt
```

Start telemetry in a second terminal and leave it running:

```sh
nvidia-smi --query-gpu=timestamp,temperature.gpu,clocks.sm,power.draw \
  --format=csv -l 1 > artifacts/spike/gpu_log.csv
```

Then the spike itself, **twice, a few minutes apart**:

```sh
pip install cupy-cuda12x        # cupy-cuda11x if nvidia-smi reports CUDA 11
python crossover_test.py
```

Native Windows is fine and simpler — section 11 blesses that path, and this
machine's 566.26 driver matches the `cuda12x` wheel. WSL2 is only worth the
trouble if the Transformer workload wins, because PyTorch's CUDA path is better
trodden there.

Move both `crossover_*.json` files into this directory, then:

```sh
bun run check:spike
```

That validates both files, prints the winner per job size, and **enforces the
gate**: if the winners disagree between sessions, noise is larger than the
differences and the results are not usable yet. Fix the section 6a controls and
run it again rather than picking the nicer session.

## What the result decides

| Outcome | Meaning | Next |
| --- | --- | --- |
| Winner changes with job size, both sessions agree | The crossover is real on this card | SHA-256 becomes the workload; the demo shows the size switch |
| Same winner everywhere, both sessions agree | No crossover here | Use the Transformer workload; lead with the release lifecycle |
| Winners differ between sessions | Noise dominates | More runs, check thermals and power mode, rerun before deciding |
| A variant fails correctness | A CUDA-specific bug — the hash logic is CPU-verified | Send the failing message index over |

Write the answer into `DECISION.md` with both JSON filenames. Section 0's rule 7
blocks M3 until that exists.

## Two things to know about these numbers

**They pick a workload. They are not a result.** The spike times 7 runs per case,
unpaired, in one session. Section 6 targets 100 paired observations across three
sessions before anything is published. Nothing from here goes in the UI, the
pitch or the demo as a measured speedup.

**One card only.** This build uses the RTX 4060 Laptop and nothing else. Section
0 makes cross-hardware claims a hard stop, and section 17.6 says never to state
"different cards pick different winners" as a measured result. If a second card
is ever run, that is appendix A and it needs its own two sessions.
