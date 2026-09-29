// Static checks on manifest.json and options.html: the things that break an
// install or a Web Store upload without any script error.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SRC, makePage } from "./helpers/env.js";

const manifest = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
const [injectCs, contentCs] = manifest.content_scripts;
const tlds = Object.keys(makePage().load("shared.js").global("VLF_TLD_COUNTRY"));

test("is Manifest V3 with an x.y.z version", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.match(manifest.minimum_chrome_version, /^\d+$/);
});

test("content scripts and web-accessible resources match the same sites", () => {
  const war = manifest.web_accessible_resources[0].matches;
  assert.deepEqual(contentCs.matches, injectCs.matches);
  assert.deepEqual(war, injectCs.matches);
});

test("matches exactly the Vinted domains shared.js knows", () => {
  const matched = injectCs.matches.map((m) => {
    const r = m.match(/^\*:\/\/\*\.vinted\.(.+)\/\*$/);
    assert.ok(r, `unexpected match pattern ${m}`);
    return r[1];
  });
  assert.deepEqual([...matched].sort(), [...tlds].sort());
});

test("inject.js runs in the page's world at document_start", () => {
  assert.deepEqual(injectCs.js, ["inject.js"]);
  assert.equal(injectCs.world, "MAIN");
  assert.equal(injectCs.run_at, "document_start");
});

test("shared.js loads before content.js, in the isolated world", () => {
  assert.deepEqual(contentCs.js, ["shared.js", "content.js"]);
  assert.equal(contentCs.world, undefined);
  assert.deepEqual(contentCs.css, ["content.css"]);
});

test("the stylesheets content.js fetches are web-accessible", () => {
  const src = fs.readFileSync(path.join(SRC, "content.js"), "utf8");
  const fetched = src.match(/\["tokens\.css", "ui\.css"\]/);
  assert.ok(fetched, "content.js no longer fetches tokens.css and ui.css");
  assert.deepEqual(manifest.web_accessible_resources[0].resources, ["tokens.css", "ui.css"]);
});

test("every file the manifest references exists", () => {
  const refs = new Set([
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    manifest.action.default_popup,
    manifest.options_ui.page,
    ...manifest.content_scripts.flatMap((cs) => [...(cs.js || []), ...(cs.css || [])]),
    ...manifest.web_accessible_resources.flatMap((w) => w.resources),
  ]);
  for (const f of refs) assert.ok(fs.existsSync(path.join(SRC, f)), `${f} is missing`);
});

test("only asks for the storage permission", () => {
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.equal(manifest.host_permissions, undefined);
});

test("options.html loads shared.js before options.js", () => {
  const html = fs.readFileSync(path.join(SRC, "options.html"), "utf8");
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(scripts, ["shared.js", "options.js"]);
});
