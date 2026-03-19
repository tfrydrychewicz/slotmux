# Benchmark baseline (§2.6 / §17.5)

- **Generate / refresh** (after intentional perf changes):

  ```bash
  pnpm test:bench:baseline
  ```

- **CI** (`.github/workflows/benchmark.yml`) runs `vitest bench --compare benchmarks/baseline.json` so runs show deltas vs this file.

- `filepath` entries inside `baseline.json` are machine-specific; Vitest matches benchmarks by internal task id. If compare ever mis-aligns on a new runner, re-run the command above and commit the updated JSON.
