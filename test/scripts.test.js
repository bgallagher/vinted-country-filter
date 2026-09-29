// scripts/build.sh and scripts/release.sh, run for real in a scratch repo.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { ROOT, SRC } from "./helpers/env.js";

const manifest = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
// Without git's GIT_* variables. Inside a hook (the pre-commit hook runs
// these tests), git exports GIT_INDEX_FILE and friends; with `git commit -a`
// it's an absolute path to the real repo's index, so git in the scratch repo
// would stage and unstage files in the commit being made.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, env, encoding: "utf8" });

// The extension's own files: everything the manifest references, plus the
// script options.html loads.
const extensionFiles = [...new Set([
  "manifest.json",
  ...Object.values(manifest.icons),
  manifest.action.default_popup,
  "options.js",
  ...manifest.content_scripts.flatMap((cs) => [...cs.js, ...(cs.css || [])]),
  ...manifest.web_accessible_resources.flatMap((w) => w.resources),
])].sort();

describe("build.sh", () => {
  let dir;
  const build = () => spawnSync("sh", ["scripts/build.sh"], { cwd: dir, env, encoding: "utf8" });
  const zipList = (zip) => execFileSync("python3", ["-c", "import sys, zipfile; print('\\n'.join(sorted(zipfile.ZipFile(sys.argv[1]).namelist())))", zip], { encoding: "utf8" })
    .trim().split("\n").filter((f) => !f.endsWith("/"));

  // A scratch repo holding the working tree as one commit (build.sh packs HEAD).
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "vlf-build-"));
    const files = git(ROOT, "ls-files", "--cached", "--others", "--exclude-standard").trim().split("\n")
      .filter((f) => fs.lstatSync(path.join(ROOT, f), { throwIfNoEntry: false })?.isFile());
    for (const f of files) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
    }
    git(dir, "init", "-q");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "snapshot");
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("packs exactly the extension's files", () => {
    const r = build();
    assert.equal(r.status, 0, r.stderr);
    const zip = r.stdout.trim();
    assert.equal(zip, `dist/vinted-country-filter-${manifest.version}.zip`);
    assert.deepEqual(zipList(path.join(dir, zip)), extensionFiles);
  });

  test("fails when the manifest references a file that isn't committed", () => {
    git(dir, "rm", "-q", "--cached", "src/ui.css");
    git(dir, "commit", "-q", "-m", "drop ui.css");
    const r = build();
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /manifest references files missing from the zip.*ui\.css/);
  });
});

describe("release.sh", () => {
  // These all stop before any git or network step.
  const release = (...args) => spawnSync("sh", [path.join(ROOT, "scripts/release.sh"), ...args], { cwd: ROOT, env, encoding: "utf8" });

  for (const [args, message] of [
    [[], /usage: scripts\/release\.sh <version>/],
    [["1.2"], /version must look like 1\.2\.3/],
    [["v1.2.3"], /version must look like 1\.2\.3/],
    [["1.2.3", "--bogus"], /unknown option --bogus/],
    [["1.2.3", "1.2.4"], /give one version only/],
  ]) {
    test(`rejects ${JSON.stringify(args)}`, () => {
      const r = release(...args);
      assert.equal(r.status, 1);
      assert.match(r.stderr, message);
    });
  }
});
