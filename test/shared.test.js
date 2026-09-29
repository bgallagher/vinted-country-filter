import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { makePage } from "./helpers/env.js";

const shared = () => makePage().load("shared.js");

describe("vlfSettings", () => {
  const vlfSettings = shared().global("vlfSettings");
  const defaults = shared().global("VLF_DEFAULTS");
  // Objects come from the page's realm, so compare as plain JSON.
  const plain = (o) => JSON.parse(JSON.stringify(o));

  test("fills in defaults for missing or empty settings", () => {
    assert.deepEqual(plain(vlfSettings(undefined)), plain(defaults));
    assert.deepEqual(plain(vlfSettings({})), plain(defaults));
    assert.deepEqual(plain(vlfSettings({ mode: "hide" })), { ...plain(defaults), mode: "hide" });
  });

  test("converts 0.1.0's `allowed` list to its first country", () => {
    const s = vlfSettings({ allowed: ["fr", "ie"] });
    assert.equal(s.country, "FR");
    assert.ok(!("allowed" in s));
  });

  test("keeps an explicit country over `allowed`", () => {
    assert.equal(vlfSettings({ country: "", allowed: ["FR"] }).country, "");
    assert.equal(vlfSettings({ country: "DE", allowed: ["FR"] }).country, "DE");
  });

  test("ignores an empty `allowed` list", () => {
    const s = vlfSettings({ allowed: [] });
    assert.equal(s.country, "");
    assert.ok(!("allowed" in s));
  });

  test("resets a country the picker doesn't offer to the site's", () => {
    assert.equal(vlfSettings({ country: "CH" }).country, "");
    assert.equal(vlfSettings({ country: "UK" }).country, "");
    assert.equal(vlfSettings({ allowed: ["ch"] }).country, "");
    assert.equal(vlfSettings({ country: "GB" }).country, "GB");
  });

  test("doesn't modify the stored object", () => {
    const stored = { allowed: ["FR"] };
    vlfSettings(stored);
    assert.deepEqual(stored, { allowed: ["FR"] });
  });
});

describe("country list", () => {
  const page = shared();
  const map = page.global("VLF_TLD_COUNTRY");
  const list = page.global("VLF_COUNTRIES");

  test("VLF_COUNTRIES is the map's distinct values", () => {
    assert.deepEqual([...list].sort(), [...new Set(Object.values(map))].sort());
    assert.equal(new Set(list).size, list.length);
  });

  test("every code is two uppercase letters", () => {
    for (const cc of list) assert.match(cc, /^[A-Z]{2}$/);
  });
});

describe("vlfFlag", () => {
  const vlfFlag = shared().global("vlfFlag");

  test("turns a code into regional indicator letters", () => {
    assert.equal(vlfFlag("IE"), "🇮🇪");
    assert.equal(vlfFlag("ie"), "🇮🇪");
    assert.equal(vlfFlag("GB"), "🇬🇧");
  });

  test("is empty for no code", () => {
    assert.equal(vlfFlag(""), "");
    assert.equal(vlfFlag(null), "");
  });
});

describe("vlfCountryName", () => {
  test("names a country", () => {
    assert.equal(shared().global("vlfCountryName")("IE"), "Ireland");
  });

  test("falls back to the code when Intl.DisplayNames fails", () => {
    const page = shared();
    page.window.Intl.DisplayNames = function () { throw new RangeError("unsupported"); };
    assert.equal(page.global("vlfCountryName")("IE"), "IE");
  });
});

describe("vlfFillCountrySelect", () => {
  const page = shared();
  const select = page.document.createElement("select");
  page.global("vlfFillCountrySelect")(select, "Same as the site");
  const opts = [...select.options];

  test("starts with the site default", () => {
    assert.equal(opts[0].value, "");
    assert.equal(opts[0].textContent, "Same as the site");
  });

  test("lists every country once, sorted by name, with its flag", () => {
    const rest = opts.slice(1);
    assert.deepEqual(rest.map((o) => o.value).sort(), [...page.global("VLF_COUNTRIES")].sort());
    const names = rest.map((o) => o.textContent.replace(/^\S+ /, ""));
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
    for (const o of rest) assert.ok(o.textContent.startsWith(page.global("vlfFlag")(o.value)));
  });

  test("replaces existing options", () => {
    page.global("vlfFillCountrySelect")(select, "Again");
    assert.equal(select.options.length, opts.length);
    assert.equal(select.options[0].textContent, "Again");
  });
});
