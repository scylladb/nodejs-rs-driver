| Workload | Rows | Scenario | C | Rate/s | Variant | Runs | ops/s | p50 µs | p99 µs | p99 range µs | CPU cores |
|---|---:|---|---:|---:|---|---:|---:|---:|---:|---:|---:|
| bridge | 1 | serial | 1 | — | baseline | 2 | 137294 | 7.0 | 9.3 | 9.1–9.4 | 1.16 |
| bridge | 1 | serial | 1 | — | selected-tests | 2 | 2254399 | 0.3 | 0.6 | 0.6–0.6 | 1.00 |
| bridge | 1 | sparse | — | 500 | baseline | 2 | 500 | 54.3 | 1039.9 | 691.2–1388.5 | 0.06 |
| bridge | 1 | sparse | — | 500 | selected-tests | 2 | 500 | 9.0 | 33.8 | 32.3–35.3 | 0.03 |
| bridge | 1 | throughput | 128 | — | baseline | 2 | 821013 | 87.0 | 169.6 | 166.3–172.9 | 1.70 |
| bridge | 1 | throughput | 128 | — | selected-tests | 2 | 2376251 | 26.5 | 52.7 | 51.9–53.5 | 1.00 |
| query | 1 | serial | 1 | — | baseline-release | 3 | 13989 | 69.9 | 148.6 | 137.2–173.1 | 0.67 |
| query | 1 | serial | 1 | — | selected | 3 | 16010 | 48.0 | 168.3 | 122.2–173.8 | 0.67 |
| query | 1 | sparse | — | 100 | baseline-release | 2 | 100 | 735.5 | 2693.1 | 2627.6–2758.7 | 0.05 |
| query | 1 | sparse | — | 100 | selected | 2 | 100 | 743.4 | 2418.2 | 2038.8–2797.6 | 0.05 |
| query | 1 | sparse | — | 500 | baseline-release | 3 | 500 | 234.0 | 2267.1 | 2179.1–2576.4 | 0.10 |
| query | 1 | sparse | — | 500 | selected | 3 | 500 | 279.3 | 2207.7 | 1870.8–2377.7 | 0.12 |
| query | 1 | sparse | — | 1000 | baseline-release | 2 | 1000 | 250.2 | 2177.0 | 2125.8–2228.2 | 0.14 |
| query | 1 | sparse | — | 1000 | selected | 2 | 1000 | 245.1 | 1920.0 | 1738.8–2101.2 | 0.18 |
| query | 1 | throughput | 128 | — | baseline-release | 3 | 58558 | 2083.8 | 8675.3 | 8478.7–8757.2 | 0.84 |
| query | 1 | throughput | 128 | — | selected | 3 | 82383 | 1134.6 | 10207.2 | 9814.0–10879.0 | 1.32 |
| query | 1 | throughput | 512 | — | baseline-release | 3 | 87138 | 4603.9 | 26460.2 | 25444.4–27131.9 | 1.27 |
| query | 1 | throughput | 512 | — | selected | 3 | 87342 | 4653.1 | 25673.7 | 24772.6–27492.4 | 1.27 |
| query | 128 | sparse | — | 500 | baseline-release | 3 | 500 | 638.0 | 1927.2 | 1537.0–2144.3 | 0.17 |
| query | 128 | sparse | — | 500 | selected | 3 | 500 | 637.4 | 2048.0 | 1706.0–2077.7 | 0.18 |
| query | 128 | throughput | 128 | — | baseline-release | 3 | 14740 | 8585.2 | 11583.5 | 10969.1–13869.1 | 0.75 |
| query | 128 | throughput | 128 | — | selected | 3 | 14893 | 8503.3 | 11370.5 | 10780.7–11640.8 | 0.78 |
