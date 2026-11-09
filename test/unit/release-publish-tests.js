"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

describe("Release package publication", function () {
    this.timeout(10000);

    const workflow = fs.readFileSync(
        path.join(__dirname, "../../.github/workflows/release.yml"),
        "utf8",
    );
    const publishStep = workflow.match(
        / {6}- name: Publish\n[\s\S]*? {8}run: \|\n((?: {10}.*\n|\n)+)/,
    );
    assert.ok(publishStep, "Release workflow must contain the Publish step");
    const script = publishStep[1].replace(/^ {10}/gm, "");
    let directory;

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), "release-publish-"));
        for (const packageDir of [
            "npm/linux-x64-gnu",
            "npm/linux-arm64-gnu",
            ".",
        ]) {
            const target = path.join(directory, packageDir);
            fs.mkdirSync(target, { recursive: true });
            fs.writeFileSync(
                path.join(target, "package.json"),
                JSON.stringify({
                    name: path.basename(target),
                    version: "1.0.0",
                }),
            );
        }
    });

    afterEach(() => {
        fs.rmSync(directory, { recursive: true, force: true });
    });

    function run(scenario, runAttempt = "1") {
        // Run the actual workflow script, replacing only npm and elapsed time.
        const mocks = `
unset SECONDS
SECONDS=0
sleep() { SECONDS=$((SECONDS + $1)); }
npm() {
  case "$1" in
    config) ;;
    pack) echo '[{"integrity":"sha512-expected"}]' ;;
    publish)
      echo "$PWD" >> "$TEST_DIRECTORY/published"
      echo "$SECONDS" > "$PWD/published-at"
      ;;
    view)
      local package_name="\${2%@*}"
      local package_dir="$TEST_DIRECTORY/npm/$package_name"
      if [[ ! -d "$package_dir" ]]; then package_dir="$TEST_DIRECTORY"; fi
      if [[ "$SCENARIO" == existing ]]; then
        echo '"sha512-expected"'
      elif [[ ! -f "$package_dir/published-at" ]]; then
        echo '{"code": "E404"}'
        return 1
      elif [[ "$SCENARIO" == auth ]]; then
        echo '{"code": "E401"}'
        return 1
      elif [[ "$SCENARIO" == mismatch ]]; then
        echo '"sha512-different"'
      elif [[ "$SCENARIO" == timeout ]] ||
           (( SECONDS - $(cat "$package_dir/published-at") < 120 )); then
        echo '{"code": "E404"}'
        return 1
      else
        echo '"sha512-expected"'
      fi
      ;;
    *) echo "Unexpected npm command: $*" >&2; return 1 ;;
  esac
}
trap 'echo "$SECONDS" > "$TEST_DIRECTORY/elapsed"' EXIT
`;
        const result = spawnSync(
            "bash",
            ["-eo", "pipefail", "-c", mocks + script],
            {
                cwd: directory,
                env: {
                    ...process.env,
                    TEST_DIRECTORY: directory,
                    SCENARIO: scenario,
                    RUN_ATTEMPT: runAttempt,
                },
                encoding: "utf8",
                timeout: 8000,
            },
        );
        assert.ifError(result.error);
        const published = path.join(directory, "published");
        return {
            ...result,
            elapsed: Number(fs.readFileSync(path.join(directory, "elapsed"))),
            publications: fs.existsSync(published)
                ? fs.readFileSync(published, "utf8").trim().split("\n")
                : [],
        };
    }

    it("waits beyond one minute and publishes each package only once", () => {
        const result = run("delayed");
        assert.strictEqual(result.status, 0, result.stdout + result.stderr);
        assert.strictEqual(result.elapsed, 360);
        assert.strictEqual(result.publications.length, 3);
        assert.strictEqual(new Set(result.publications).size, 3);
    });

    it("stops after ten minutes when a published package remains unavailable", () => {
        const result = run("timeout");
        assert.strictEqual(result.status, 1);
        assert.strictEqual(result.elapsed, 600);
        assert.strictEqual(result.publications.length, 1);
        assert.match(result.stdout, /within 10 minutes after publication/);
    });

    it("fails immediately if the published integrity differs", () => {
        const result = run("mismatch");
        assert.strictEqual(result.status, 1);
        assert.strictEqual(result.elapsed, 0);
        assert.strictEqual(result.publications.length, 1);
        assert.match(result.stdout, /unexpected package integrity/);
    });

    it("fails immediately on an authentication error", () => {
        const result = run("auth");
        assert.strictEqual(result.status, 1);
        assert.strictEqual(result.elapsed, 0);
        assert.strictEqual(result.publications.length, 1);
        assert.match(result.stderr, /E401/);
    });

    it("skips matching packages on a subsequent run attempt", () => {
        const result = run("existing", "2");
        assert.strictEqual(result.status, 0, result.stdout + result.stderr);
        assert.strictEqual(result.elapsed, 0);
        assert.deepStrictEqual(result.publications, []);
    });

    it("rejects an existing version on the first run attempt", () => {
        const result = run("existing");
        assert.strictEqual(result.status, 1);
        assert.strictEqual(result.elapsed, 0);
        assert.deepStrictEqual(result.publications, []);
        assert.match(
            result.stdout,
            /already published before this release attempt/,
        );
    });
});
