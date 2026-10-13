#!/usr/bin/env python3
"""Run variants serially in reproducibly shuffled order; retain every sample."""
import argparse
import json
import os
import pathlib
import random
import selectors
import subprocess
import time

HERE = pathlib.Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--baseline", type=pathlib.Path, required=True)
parser.add_argument("--candidate", type=pathlib.Path, required=True)
parser.add_argument("output", type=pathlib.Path)
args = parser.parse_args()
variants = {"baseline": args.baseline.resolve(), "candidate": args.candidate.resolve()}
for binary in variants.values():
    if not binary.is_file():
        parser.error(f"Native library does not exist: {binary}")
names = list(variants)
scenarios = os.environ.get("SCENARIOS", "sparse,serial,throughput").split(",")
workloads = os.environ.get("WORKLOADS", "query").split(",")
repeats = int(os.environ.get("REPEATS", "3"))
jobs = [(name, scenario, workload, repeat) for repeat in range(repeats) for name in names for scenario in scenarios for workload in workloads]
random.Random(622).shuffle(jobs)
output = args.output
with output.open("x") as results:
    for index, (name, scenario, workload, repeat) in enumerate(jobs):
        env = os.environ.copy()
        env.update(VARIANT=name, SCENARIO=scenario, WORKLOAD=workload,
                   NAPI_RS_NATIVE_LIBRARY_PATH=str(variants[name]))
        cmd = ["node", str(HERE / "run.js")]
        if env.get("BENCH_CPUS"):
            cmd = ["taskset", "-c", env["BENCH_CPUS"], *cmd]
        child = subprocess.Popen(cmd, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        affinities = {}
        if env.get("BENCH_PIN_THREADS") == "1":
            deadline = time.monotonic() + 60
            selector = selectors.DefaultSelector()
            selector.register(child.stderr, selectors.EVENT_READ)
            banner = b""
            while True:
                if not selector.select(max(0, deadline - time.monotonic())):
                    child.kill()
                    child.communicate()
                    raise TimeoutError(f"Initialization timed out: {name} {scenario} {workload}")
                chunk = os.read(child.stderr.fileno(), 65536)
                if not chunk:
                    child.wait()
                    raise RuntimeError("Child exited before affinity setup: " + banner.decode())
                banner += chunk
                if b"BENCH_READY\n" in banner:
                    remaining = banner.replace(b"BENCH_READY\n", b"").decode()
                    if remaining:
                        print(remaining, end="", flush=True)
                    break
            selector.close()
            worker = 0
            worker_cpus = env.get("BENCH_WORKER_CPUS", "2,8").split(",")
            background_cpu = env.get("BENCH_BACKGROUND_CPU", "10")
            for task in sorted(pathlib.Path(f"/proc/{child.pid}/task").iterdir()):
                comm = (task / "comm").read_text().strip()
                cpu = env.get("BENCH_JS_CPU", "0") if int(task.name) == child.pid else background_cpu
                if comm.startswith("tokio"):
                    cpu = worker_cpus[worker] if worker < len(worker_cpus) else background_cpu
                    worker += 1
                subprocess.run(["taskset", "-pc", cpu, task.name], check=True, capture_output=True)
                affinities[task.name] = {"name": comm, "cpu": cpu}
        try:
            stdout, stderr = child.communicate("go\n", timeout=120)
        except subprocess.TimeoutExpired:
            child.kill()
            child.communicate()
            raise
        if child.returncode:
            print(stderr, flush=True)
            raise RuntimeError(f"Failed {name} {scenario} {workload}")
        result = json.loads(stdout.strip().splitlines()[-1])
        result["repeat"] = repeat
        result["affinities"] = affinities
        results.write(json.dumps(result) + "\n")
        results.flush()
        print(f"{index+1}/{len(jobs)} {name} {scenario} {workload}: {result['ops_s']:.0f} ops/s p99 {result['latency']['p99_us']:.1f} us", flush=True)
