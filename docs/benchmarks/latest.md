# MCP Benchmark (Latest)

- Generated at: 2026-02-26T08:52:54.234Z
- Comparison: wasm vs native

## Default Backend Decision

- Recommended default backend: `wasm`
- Summary: wasm P95 is within threshold (10%).
- Primary metric: Warm Query (single client) P95
- Threshold: wasm P95 <= native P95 * 1.1 (=10%)
- native P95: 184.69 ms
- wasm P95: 11.34 ms
- wasm vs native delta: -93.86%

## Backend: wasm

- Status: success
- Indexed Java files: 121
- Graph size: 685 nodes / 764 relationships
- Index duration: 22.8 ms
- Peak memory (runner + sampled MCP process): 117.03 MiB

| Scenario | Samples | P50 (ms) | P95 (ms) | Throughput (ops/s) |
| --- | ---: | ---: | ---: | ---: |
| Cold Start (connect + first query) | 10 | 551.92 | 1273.63 | 1.48 |
| Warm Query (single client) | 120 | 3.95 | 11.34 | 194.01 |
| Concurrent Query (concurrency=5) | 120 | 12.81 | 27.88 | 228.33 |
| Concurrent Query (concurrency=10) | 240 | 26.01 | 68.02 | 193.15 |

## Backend: native

- Status: success
- Indexed Java files: 121
- Graph size: 685 nodes / 764 relationships
- Index duration: 9343.73 ms
- Peak memory (runner + sampled MCP process): 122.97 MiB

| Scenario | Samples | P50 (ms) | P95 (ms) | Throughput (ops/s) |
| --- | ---: | ---: | ---: | ---: |
| Cold Start (connect + first query) | 10 | 1070.64 | 1742.58 | 0.86 |
| Warm Query (single client) | 120 | 117.77 | 184.69 | 7.45 |
| Concurrent Query (concurrency=5) | 120 | 401.27 | 510.12 | 10.94 |
| Concurrent Query (concurrency=10) | 240 | 718.24 | 1150.52 | 11.13 |

## Notes

- Cold start = MCP server spawn + handshake + first query.
- Warm query and concurrent scenarios use one already connected MCP client.
- Throughput is computed as total successful query calls divided by wall-clock scenario duration.
