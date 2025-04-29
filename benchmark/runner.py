from subprocess import run
from discord import SyncWebhook, File
import pandas as pd
import matplotlib.pyplot as plt
import numpy as np
import re
import os


# Function to parse the output from the time function.
def parse_time(s):
    log = s.stderr
    elapsed_match = re.search(r"Elapsed .*?: ([0-9:]+\.?[0-9]*)", log)
    if elapsed_match:
        elapsed_time = elapsed_match.group(1)
        parts = list(map(float, elapsed_time.split(':')))
        if len(parts) == 3:  # Format h:mm:ss.xx
            hours, minutes, seconds = parts
            total_seconds = hours * 3600 + minutes * 60 + seconds
        elif len(parts) == 2:  # Format m:ss.xx
            minutes, seconds = parts
            total_seconds = minutes * 60 + seconds
        else:  # Unexpected format
            total_seconds = parts[0]
    else:
        total_seconds = None

    # Extract max resident set size
    max_rss_match = re.search(r"Maximum resident set size \(kbytes\): (\d+)",
                              log)
    max_rss = int(max_rss_match.group(1)) if max_rss_match else None
    return total_seconds, max_rss / 1024


# Function to parse build time from cargo run output. Cargo run always prints
# build time to output. We must subtract this from execution time.
def extract_build_time(output):
    match = re.search(
        r'\[optimized\] target\(s\) in ([\d.]+)s',
        output)
    if match:
        return float(match.group(1))
    else:
        raise ValueError("Build time not found in the provided output.",
                         output)


def run_process(command):
    return run(command, capture_output=True, shell=True, text=True,
               executable='/bin/bash')


# --------- parameters ------------

repeat = 3
n_min = {}

n_min["concurrent_insert.js"] = 4_000_000 / 64
n_min["concurrent_select.js"] = 400_000 / 64
n_min["insert.js"] = 400_000 / 64
n_min["select.js"] = 100_000 / 64
n_min["deser.js"] = 2_000 / 64
n_min["concurrent_deser.js"] = 2_000 / 64
n_min["batch.js"] = 3_000_000 / 64
n_min["paging.js"] = 4_000 / 64
n_min["concurrent_paging.js"] = 1280 / 64
n_min["large_select.js"] = 4_000 / 64

steps = {}

step = 4

# --------- libs and rust benchmark names ----------
libs = ["scylladb-driver-alpha", "cassandra-driver"]
benchmarks = ["concurrent_insert.js", "insert.js", "select.js",
             "concurrent_select.js", "batch.js", "paging.js",
             "concurrent_paging.js", "large_select.js", "deser.js", 
             "concurrent_deser.js"]

name_rust = {}
name_rust["concurrent_insert.js"] = "concurrent_insert_benchmark"
name_rust["insert.js"] = "insert_benchmark"
name_rust["select.js"] = "select_benchmark"
name_rust["concurrent_select.js"] = "concurrent_select_benchmark"
name_rust["deser.js"] = "deser_benchmark"
name_rust["concurrent_deser.js"] = "concurrent_deser_benchmark"
name_rust["batch.js"] = "batch_benchmark"
name_rust["paging.js"] = "paging_benchmark"
name_rust["concurrent_paging.js"] = "concurrent_paging_benchmark"
name_rust["large_select.js"] = "large_select_benchmark"


df = {}
df_mem = {}
for ben in benchmarks:
    steps[ben] = [n_min[ben] * (4 ** i) for i in range(step)]

    df[ben] = pd.DataFrame(columns=['n', libs[0], libs[1], 'rust-driver'])
    df_mem[ben] = pd.DataFrame(columns=['n', libs[0], libs[1], 'rust-driver'])

    # Build Rust benchmark
    data = run("cargo build -p benchmark --bin "+name_rust[ben]+" -r",
               capture_output=True, shell=True, text=True,
               executable='/bin/bash')

    if data.returncode != 0:
        raise Exception("Build error: " + name_rust[ben])

    print("Build rust " + name_rust[ben] + " successfully.")

    for n in steps[ben]:
        dict_time = {}
        dict_time['n'] = n
        dict_mem = {}
        dict_mem['n'] = n

        results = []
        results_mem = []
        # ------ rust -------
        for _ in range(repeat):
            data = run_process("CNT=" + str(int(n)) +
                               " /usr/bin/time -v cargo run -p benchmark --bin " +
                               name_rust[ben] + " -r ")

            if data.returncode != 0:
                raise Exception("Run error: Rust, ", data.stderr,
                                name_rust[ben])

            s, mem = parse_time(data)
            offset = extract_build_time(data.stderr)

            results.append(s - offset)
            results_mem.append(mem)

        dict_time["rust-driver"] = results
        dict_mem["rust-driver"] = results_mem
        # ------ node -----
        for lib in libs:
            results = []
            results_mem = []
            for _ in range(repeat):
                data = run_process("/usr/bin/time -v node benchmark/logic/" +
                                   ben + " " + str(lib) + " " + str(int(n)))

                if data.returncode != 0:
                    raise Exception("Run error: ", str(lib), ben, data.stderr)

                s, mem = parse_time(data)
                results.append(s)
                results_mem.append(mem)

            dict_time[lib] = results
            dict_mem[lib] = results_mem
        print(ben, dict_time, dict_mem)
        df[ben].loc[len(df[ben])] = dict_time
        df_mem[ben].loc[len(df[ben])] = dict_mem

# ---------- plots -------------

libs.append("rust-driver")

cols = 3
rows_time = (len(df) + cols - 1) // cols
rows_mem = (len(df_mem) + cols - 1) // cols
total_rows = rows_time + rows_mem

fig, axes = plt.subplots(total_rows, cols, figsize=(15, 5 * total_rows),
                         facecolor="white")
axes = axes.flatten()

# ---  Time ---
fig.text(0.5, 0.98, "Time", ha="center", fontsize=16, fontweight="bold")
for i, (test_name, data) in enumerate(df.items()):
    ax = axes[i]
    ax.set_facecolor("white")

    for lib in libs:
        data[f"{lib}_mean"] = data[lib].apply(np.mean)
        data[f"{lib}_std"] = data[lib].apply(np.std)
        ax.errorbar(data["n"], data[f"{lib}_mean"], yerr=data[f"{lib}_std"],
                    label=lib, linestyle="-", linewidth=2, capsize=5)

    ax.set_xlabel("Number of requests")
    ax.set_ylabel("Time [s]")
    ax.set_xscale('log')
    ax.set_yscale('log')
    ax.set_title(f"Benchmark - {test_name.split('.')[0]}")
    ax.legend()


for j in range(len(df), rows_time * cols):
    axes[j].axis("off")

# --- memory ---
start = rows_time * cols
memory_y = 0.47
fig.text(0.5, memory_y, "Memory", ha="center", fontsize=16, fontweight="bold")
for i, (test_name, data) in enumerate(df_mem.items()):
    ax = axes[start + i]
    ax.set_facecolor("white")

    for lib in libs:
        data[f"{lib}_mean"] = data[lib].apply(np.mean)
        data[f"{lib}_std"] = data[lib].apply(np.std)
        ax.errorbar(data["n"], data[f"{lib}_mean"], yerr=data[f"{lib}_std"],
                    label=lib, linestyle="-", linewidth=2, capsize=5)

    ax.set_xlabel("Number of requests")
    ax.set_ylabel("Memory [MB]")
    ax.set_xscale('log')
    ax.set_yscale('log')
    ax.set_title(f"Benchmark - {test_name.split('.')[0]}")
    ax.legend()

for j in range(start + len(df_mem), total_rows * cols):
    axes[j].axis("off")

plt.style.use('default')
plt.tight_layout(rect=[0, 0, 1, 0.96])
plt.subplots_adjust(hspace=0.35)
# plt.savefig("graph.svg", format="svg", dpi=300)
plt.savefig("graph.png")

# ------ github ----------

data = run("git rev-parse --abbrev-ref HEAD",
           capture_output=True, shell=True, text=True, executable='/bin/bash')
branch = data.stdout.replace('\n', '')

data = run("git rev-parse HEAD",
           capture_output=True, shell=True, text=True, executable='/bin/bash')
commit = data.stdout.replace('\n', '')

wh = SyncWebhook.from_url(os.environ['DISCORD_BENCHMARKS_WEBHOOK'])

wh.send(content="Branch: " + branch +
        " commit: https://github.com/scylladb/nodejs-rs-driver/commit/" +
        commit, file=File("graph.png"))
