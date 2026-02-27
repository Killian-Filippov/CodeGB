# MCP Benchmark (Latest)

- Generated at: 2026-02-27T01:25:52.254Z
- Comparison: wasm vs native

## Default Backend Decision

- Recommended default backend: `native`
- Summary: wasm P95 exceeds threshold by 3.64%.
- Primary metric: Warm Query (single client) P95
- Threshold: wasm P95 <= native P95 * 1.1 (=10%)
- native P95: 0.22 ms
- wasm P95: 0.25 ms
- wasm vs native delta: 13.64%

## Backend: wasm

- Status: success
- Indexed Java files: 121
- Graph size: 685 nodes / 764 relationships
- Index duration: 15.98 ms
- Peak memory (runner + sampled MCP process): 122.06 MiB

| Scenario | Samples | P50 (ms) | P95 (ms) | Throughput (ops/s) |
| --- | ---: | ---: | ---: | ---: |
| Cold Start (connect + first query) | 10 | 522.86 | 587.72 | 1.77 |
| Warm Query (single client) | 120 | 0.16 | 0.25 | 4988.36 |
| Concurrent Query (concurrency=5) | 120 | 0.38 | 1.02 | 8000.89 |
| Concurrent Query (concurrency=10) | 240 | 0.71 | 1.86 | 7242.15 |

## Backend: native

- Status: success
- Indexed Java files: 121
- Graph size: 685 nodes / 764 relationships
- Index duration: 7512.72 ms
- Peak memory (runner + sampled MCP process): 125.33 MiB

| Scenario | Samples | P50 (ms) | P95 (ms) | Throughput (ops/s) |
| --- | ---: | ---: | ---: | ---: |
| Cold Start (connect + first query) | 10 | 622.37 | 764.05 | 1.5 |
| Warm Query (single client) | 120 | 0.15 | 0.22 | 5357.85 |
| Concurrent Query (concurrency=5) | 120 | 0.41 | 0.97 | 7554.4 |
| Concurrent Query (concurrency=10) | 240 | 0.71 | 1.75 | 9945.04 |

## Notes

- Cold start = MCP server spawn + handshake + first query.
- Warm query and concurrent scenarios use one already connected MCP client.
- Throughput is computed as total successful query calls divided by wall-clock scenario duration.
