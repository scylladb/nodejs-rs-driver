#!/usr/bin/env python3
"""Show medians across runs, retaining run ranges to expose noisy comparisons."""
import collections
import json
import statistics
import sys

groups = collections.defaultdict(list)
for filename in sys.argv[1:]:
    with open(filename) as source:
        for line in source:
            row = json.loads(line)
            groups[(row["workload"], row["rows"], row["scenario"], row["concurrency"] if row["scenario"] == "throughput" else (1 if row["scenario"] == "serial" else "—"), row["rate"] if row["scenario"] == "sparse" else "—", row["variant"])].append(row)

print("| Workload | Rows | Scenario | C | Rate/s | Variant | Runs | ops/s | p50 µs | p99 µs | p99 range µs | CPU cores |")
print("|---|---:|---|---:|---:|---|---:|---:|---:|---:|---:|---:|")
for key, rows in sorted(groups.items()):
    p99 = [r["latency"]["p99_us"] for r in rows]
    med = lambda values: statistics.median(values)
    values = [*key, len(rows), f'{med([r["ops_s"] for r in rows]):.0f}', f'{med([r["latency"]["p50_us"] for r in rows]):.1f}', f'{med(p99):.1f}', f'{min(p99):.1f}–{max(p99):.1f}', f'{med([r["cpu_cores"] for r in rows]):.2f}']
    print("| " + " | ".join(map(str, values)) + " |")
