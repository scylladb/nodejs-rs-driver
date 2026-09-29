#!/usr/bin/env python3
"""Tests the "Check the reports" step of .github/workflows/coverage.yml.

The step runs in the upload job, which holds CODECOV_TOKEN and runs no
repository code, so it is written inline in the workflow. This reads it out of
the workflow file and runs it the way that job does: in a git repository of its
own, with a few tracked files standing in for the driver's, against good and
broken reports. CI runs it before the real coverage run.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

WORKFLOW = Path(__file__).resolve().parent.parent / ".github" / "workflows" / "coverage.yml"
STEP = "Check the reports"

# The tracked files of the made-up repository. The JS report must list the
# sources in main.js and lib/, but not the declaration file.
TRACKED = ["main.js", "lib/client.ts", "lib/types.js", "lib/types.d.ts", "lib/sub/index.ts",
           "src/lib.rs", "src/session.rs", "build.rs", "package.json"]
JS_SOURCES = ["main.js", "lib/client.ts", "lib/types.js", "lib/sub/index.ts"]


def read_step(workflow, name):
    """The shell and the run script of the step called NAME in WORKFLOW.

    Parsed by hand so that no YAML parser has to be installed: the step is an
    item "- name: NAME" of a steps list, its keys are indented two columns
    further, and its script is a literal block scalar ("run: |").
    """
    lines = workflow.read_text().splitlines()
    starts = [i for i, line in enumerate(lines) if line.strip() == f"- name: {name}"]
    if len(starts) != 1:
        raise AssertionError(f"{workflow} has {len(starts)} steps named {name!r}, expected one")
    indent = len(lines[starts[0]]) - len(lines[starts[0]].lstrip())
    keys = {}
    i = starts[0] + 1
    while i < len(lines):
        line = lines[i]
        depth = len(line) - len(line.lstrip())
        if line.strip() and depth <= indent:
            break
        i += 1
        if depth != indent + 2 or ":" not in line:
            continue
        key, value = (part.strip() for part in line.split(":", 1))
        if value != "|":
            keys[key] = value
            continue
        block = []
        while i < len(lines) and (not lines[i].strip() or
                                  len(lines[i]) - len(lines[i].lstrip()) > indent + 2):
            block.append(lines[i])
            i += 1
        margin = min(len(line) - len(line.lstrip()) for line in block if line.strip())
        keys[key] = "\n".join(line[margin:] for line in block).rstrip("\n") + "\n"
    return keys.get("shell"), keys.get("run")


def lcov_record(name, counts, lf=None, lh=None, tn=False):
    """An lcov record for NAME with one DA line per count. LF and LH default to
    what the DA lines add up to; cargo llvm-cov's own are larger."""
    lines = ["TN:"] if tn else []
    lines.append(f"SF:{name}")
    lines += [f"DA:{number},{count}" for number, count in enumerate(counts, 1)]
    lines.append(f"LF:{len(counts) if lf is None else lf}")
    lines.append(f"LH:{sum(count > 0 for count in counts) if lh is None else lh}")
    lines.append("end_of_record")
    return "\n".join(lines) + "\n"


class ReportCheckTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        shell, cls.script = read_step(WORKFLOW, STEP)
        if shell != "python" or not cls.script:
            raise AssertionError(f"expected a python step {STEP!r} with a run script in {WORKFLOW}")

    def setUp(self):
        self.repo = Path(tempfile.mkdtemp()).resolve()
        self.addCleanup(shutil.rmtree, self.repo, ignore_errors=True)
        for name in TRACKED + ["lib/client.js"]:  # the last is tsc's output: not tracked
            (self.repo / name).parent.mkdir(parents=True, exist_ok=True)
            (self.repo / name).write_text("")
        subprocess.run(["git", "init", "-q"], cwd=self.repo, check=True, capture_output=True)
        subprocess.run(["git", "add", "--", *TRACKED], cwd=self.repo, check=True, capture_output=True)
        (self.repo / "coverage" / "js").mkdir(parents=True)
        (self.repo / "coverage" / "rust").mkdir(parents=True)
        # What a good run leaves: the JS report names files relative to the
        # repository root, the Rust report by their absolute path in the
        # workspace, counting more lines in LF and LH than it has DA entries
        # for, and without a newline after the last record.
        self.js = {name: [1, 0, 2] for name in JS_SOURCES}
        self.rust = {self.rust_name("src/lib.rs"): ([0, 3], 3, 2),
                     self.rust_name("src/session.rs"): ([5, 0, 1], 4, 3)}
        self.summary = None

    def rust_name(self, path):
        return f"{self.repo}/{path}"

    def write(self, js=None, rust=None, summary=None):
        """Writes the reports: SELF.js and SELF.rust unless JS or RUST give the
        whole text of either, and summary.json listing SELF.rust's line counts
        unless SUMMARY gives its text."""
        if js is None:
            js = "".join(lcov_record(name, counts, tn=True) for name, counts in self.js.items())
        if rust is None:
            rust = "".join(lcov_record(name, counts, lf, lh)
                           for name, (counts, lf, lh) in self.rust.items()).rstrip("\n")
        if summary is None:
            files = [{"filename": name,
                      "summary": {"lines": {"count": lf, "covered": lh, "percent": 100 * lh / lf}}}
                     for name, (counts, lf, lh) in self.rust.items()]
            summary = json.dumps({"type": "llvm.coverage.json.export", "version": "3.0.1",
                                  "data": [{"files": files, "totals": {}}]})
        for path, text in (("coverage/js/lcov.info", js), ("coverage/rust/lcov.info", rust),
                           ("coverage/rust/summary.json", summary)):
            if text is not False:
                (self.repo / path).write_text(text)

    def check(self, **reports):
        self.write(**reports)
        return subprocess.run([sys.executable, "-c", self.script], cwd=self.repo,
                              env=dict(os.environ, GITHUB_WORKSPACE=str(self.repo)),
                              capture_output=True, text=True)

    def assertAccepted(self, result):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def assertRejected(self, result, reason):
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn(reason, result.stderr)

    def test_accepts_the_reports_of_a_good_run(self):
        result = self.check()
        self.assertAccepted(result)
        self.assertIn("coverage/js/lcov.info: 4 files, all tracked, 8 lines covered", result.stdout)
        self.assertIn("coverage/rust/lcov.info: 2 files, all tracked, 3 lines covered", result.stdout)

    def test_rejects_a_missing_js_report(self):
        self.assertRejected(self.check(js=False), "coverage/js/lcov.info is missing")

    def test_rejects_a_missing_rust_report(self):
        self.assertRejected(self.check(rust=False), "coverage/rust/lcov.info is missing")

    def test_rejects_a_report_that_names_no_files(self):
        self.assertRejected(self.check(js=""), "coverage/js/lcov.info names no source files")

    def test_rejects_a_file_that_is_not_tracked(self):
        # What c8 writes for a TypeScript module when it misses the source map.
        del self.js["lib/client.ts"]
        self.js["lib/client.js"] = [1]
        self.assertRejected(self.check(), "1 of 4 files are not tracked files")

    def test_rejects_a_file_outside_the_workspace(self):
        self.rust["/elsewhere/src/session.rs"] = self.rust.pop(self.rust_name("src/session.rs"))
        self.assertRejected(self.check(), "['/elsewhere/src/session.rs']")

    def test_rejects_a_js_report_that_leaves_out_a_source(self):
        del self.js["lib/sub/index.ts"]
        self.assertRejected(self.check(), "leaves out 1 of the 4 JS and TypeScript sources")

    def test_rejects_a_js_report_with_nothing_but_main_js(self):
        self.js = {"main.js": [1]}
        self.assertRejected(self.check(), "leaves out 3 of the 4")

    def test_rejects_a_report_cut_short_inside_a_record(self):
        js = "".join(lcov_record(name, counts, tn=True) for name, counts in self.js.items())
        cut = js[:js.rindex("DA:")]
        self.assertRejected(self.check(js=cut), "has no end_of_record: the report is cut short")

    def test_rejects_a_record_inside_another(self):
        js = "".join(lcov_record(name, counts, tn=True) for name, counts in self.js.items())
        self.assertRejected(self.check(js=js.replace("end_of_record\n", "", 1)),
                            "starts a record for lib/client.ts inside the one for main.js")

    def test_rejects_a_second_record_for_a_file(self):
        js = "".join(lcov_record(name, counts, tn=True) for name, counts in self.js.items())
        self.assertRejected(self.check(js=js + lcov_record("main.js", [1])),
                            "starts a second record for main.js")

    def test_rejects_a_malformed_line(self):
        js = "".join(lcov_record(name, counts, tn=True) for name, counts in self.js.items())
        self.assertRejected(self.check(js=js.replace("DA:2,0", "DA:2", 1)),
                            "is not DA:<line>,<count>: 'DA:2'")
        self.assertRejected(self.check(js=js.replace("LF:3", "LF:three", 1)),
                            "is not LF:<count>: 'LF:three'")

    def test_rejects_a_report_with_no_covered_lines(self):
        self.js = {name: [0, 0] for name in JS_SOURCES}
        self.assertRejected(self.check(), "coverage/js/lcov.info reports no covered lines")

    def test_rejects_a_rust_report_cut_short_at_the_end_of_a_record(self):
        # A truncated Rust report with a covered line in src/, written out from
        # the full summary.json.
        self.write()
        summary = (self.repo / "coverage/rust/summary.json").read_text()
        del self.rust[self.rust_name("src/session.rs")]
        self.assertRejected(self.check(summary=summary),
                            "it leaves out 1 of the 2 files that coverage/rust/summary.json lists")

    def test_rejects_a_rust_report_cut_short_inside_a_record(self):
        self.write()
        rust = (self.repo / "coverage/rust/lcov.info").read_text()
        self.assertRejected(self.check(rust=rust[:rust.rindex("LF:")]),
                            "coverage/rust/lcov.info: the record for")

    def test_rejects_a_rust_report_naming_a_file_the_summary_does_not_list(self):
        self.write()
        summary = (self.repo / "coverage/rust/summary.json").read_text()
        self.rust[self.rust_name("build.rs")] = ([1], 1, 1)
        self.assertRejected(self.check(summary=summary),
                            f"names 1 that it does not, ['{self.rust_name('build.rs')}']")

    def test_rejects_rust_line_counts_that_differ_from_the_summary(self):
        self.write()
        summary = (self.repo / "coverage/rust/summary.json").read_text()
        self.rust[self.rust_name("src/session.rs")] = ([5, 0, 1], 4, 2)
        self.assertRejected(self.check(summary=summary), "the LF and LH of 1 files differ")

    def test_rejects_a_missing_or_broken_summary(self):
        self.assertRejected(self.check(summary=False),
                            "coverage/rust/summary.json is missing from the coverage-report artifact")
        self.write()
        summary = (self.repo / "coverage/rust/summary.json").read_text()
        self.assertRejected(self.check(summary=summary[:len(summary) // 2]),
                            "coverage/rust/summary.json is not a cargo llvm-cov JSON summary")
        self.assertRejected(self.check(summary='{"data": []}'), "is not a cargo llvm-cov JSON summary")

    def test_rejects_a_rust_report_with_nothing_in_src(self):
        self.rust = {self.rust_name("build.rs"): ([1], 1, 1)}
        self.assertRejected(self.check(), "coverage/rust/lcov.info covers no line in src/")

    def test_rejects_a_rust_report_that_covers_only_build_rs(self):
        self.rust = {self.rust_name("src/lib.rs"): ([0, 0], 2, 0),
                     self.rust_name("build.rs"): ([1], 1, 1)}
        self.assertRejected(self.check(), "coverage/rust/lcov.info covers no line in src/")

    def test_reports_the_problems_of_both_reports(self):
        del self.js["main.js"]
        self.rust = {self.rust_name("src/lib.rs"): ([0, 0], 2, 0)}
        result = self.check()
        self.assertRejected(result, "coverage/js/lcov.info leaves out 1 of the 4")
        self.assertIn("coverage/rust/lcov.info covers no line in src/", result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
