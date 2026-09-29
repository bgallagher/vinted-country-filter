// The toolbar popup / options page (options.html + options.js).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SRC, makePage } from "./helpers/env.js";
import { makeChrome } from "./helpers/chrome.js";

const html = fs.readFileSync(path.join(SRC, "options.html"), "utf8");

// `stats`: what the active tab replies to vlf:stats, or a function returning
// it; undefined means no content script there.
async function optionsPage({ settings, popup = true, stats } = {}) {
  const chrome = makeChrome({ sync: settings ? { settings } : {} });
  const page = makePage({ url: "chrome-extension://test-extension-id/options.html", html, chrome });
  chrome.extension.getViews = ({ type }) => (popup && type === "popup" ? [page.window] : []);
  page.statsRequests = 0;
  chrome.tabs.sendMessage = async (tabId, msg) => {
    assert.deepEqual({ ...msg }, { type: "vlf:stats" });
    page.statsRequests++;
    const r = typeof stats === "function" ? stats() : stats;
    if (r === undefined) throw new Error("Could not establish connection. Receiving end does not exist.");
    return r;
  };
  page.load("shared.js", "options.js");
  page.$ = (id) => page.document.getElementById(id);
  return page;
}

const settled = async (page) => { await page.tick(0); await page.tick(0); return page; };
const change = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.Event("change", { bubbles: true }));
const controls = (page) => ["enabled", "country", "hideUnknown", "showPanel", "mode-badge", "mode-dim", "mode-hide"].map(page.$);

describe("loading", () => {
  test("controls stay disabled until the stored settings are in", async () => {
    const page = await optionsPage({ settings: { country: "FR", mode: "hide", hideUnknown: true, showPanel: false } });
    assert.ok(controls(page).every((c) => c.disabled));
    await settled(page);
    assert.ok(controls(page).every((c) => !c.disabled));
    assert.equal(page.$("country").value, "FR");
    assert.ok(page.$("mode-hide").checked);
    assert.ok(page.$("hideUnknown").checked);
    assert.ok(!page.$("showPanel").checked);
    assert.ok(page.$("enabled").checked);
  });

  test("fills the country picker, site default first", async () => {
    const page = await settled(await optionsPage());
    const opts = [...page.$("country").options];
    assert.equal(opts[0].value, "");
    assert.equal(opts[0].textContent, "Same as the Vinted site I'm on");
    assert.equal(opts.length, 1 + page.global("VLF_COUNTRIES").length);
  });

  test("is wider as the options page than as the popup", async () => {
    assert.ok(!(await optionsPage()).document.body.classList.contains("wide"));
    assert.ok((await optionsPage({ popup: false })).document.body.classList.contains("wide"));
  });
});

describe("feedback link", () => {
  test("opens the feedback form in a new tab, safely", async () => {
    const page = await optionsPage();
    const link = page.document.querySelector(".foot a");
    assert.equal(link.href, "https://forms.gle/XprzA9V3wfzxu4im8");
    assert.equal(link.target, "_blank");
    assert.deepEqual(link.rel.split(" ").sort(), ["noopener", "noreferrer"]);
    assert.match(link.getAttribute("aria-label"), /^Share feedback \(opens in a new tab\)$/);
    assert.match(link.textContent, /^Share feedback/);
  });

  test("is the only link to anywhere outside the extension", async () => {
    const page = await optionsPage();
    const links = [...page.document.querySelectorAll("a[href]")];
    assert.equal(links.length, 1);
  });
});

describe("saving", () => {
  test("each control saves its setting, keeping the others", async () => {
    const page = await settled(await optionsPage({ settings: { mode: "hide", collapsed: true } }));
    page.$("country").value = "DE";
    change(page.$("country"));
    await page.tick(0);
    page.$("mode-badge").click();
    page.$("hideUnknown").click();
    page.$("showPanel").click();
    await page.tick(0);
    const s = page.chrome.stores.sync.settings;
    assert.deepEqual(
      { country: s.country, mode: s.mode, hideUnknown: s.hideUnknown, showPanel: s.showPanel, collapsed: s.collapsed, enabled: s.enabled },
      { country: "DE", mode: "badge", hideUnknown: true, showPanel: false, collapsed: true, enabled: true },
    );
  });

  test("shows 'Saved', then clears it after the fade", async () => {
    const page = await settled(await optionsPage());
    page.$("hideUnknown").click();
    await page.tick(0);
    assert.ok(page.$("saved").classList.contains("is-visible"));
    assert.equal(page.$("savedText").textContent, "Saved");
    await page.tick(1600);
    assert.ok(!page.$("saved").classList.contains("is-visible"));
    assert.equal(page.$("savedText").textContent, "Saved");
    await page.tick(250);
    assert.equal(page.$("savedText").textContent, "");
  });

  test("switching off greys the page out", async () => {
    const page = await settled(await optionsPage());
    page.$("enabled").click();
    await page.tick(0);
    assert.equal(page.chrome.stores.sync.settings.enabled, false);
    assert.ok(page.document.body.classList.contains("is-off"));
    assert.equal(page.$("stats").dataset.state, "off");
  });

  test("follows changes made in the page's panel", async () => {
    const page = await settled(await optionsPage());
    await page.chrome.setFromElsewhere("sync", { settings: { country: "PL", mode: "dim", hideUnknown: true, enabled: true, showPanel: false } });
    await page.tick(0);
    assert.equal(page.$("country").value, "PL");
    assert.ok(page.$("mode-dim").checked);
    assert.ok(page.$("hideUnknown").checked);
    assert.ok(!page.$("showPanel").checked);
  });

  test("a failed save shows no 'Saved'", async () => {
    const page = await settled(await optionsPage());
    page.chrome.storage.sync.set = async () => { throw new Error("QUOTA_BYTES_PER_ITEM quota exceeded"); };
    page.$("hideUnknown").click();
    await page.tick(0);
    assert.ok(!page.$("saved").classList.contains("is-visible"));
    assert.deepEqual(page.errors, []);
  });
});

describe("'this page' card", () => {
  const card = (page) => ({
    state: page.$("stats").dataset.state,
    shown: page.$("statsShown").textContent,
    total: page.$("statsTotal").textContent,
    loading: page.$("statsLoading").hidden ? null : page.$("statsLoading").textContent,
    paused: page.$("statsPaused").hidden ? null : page.$("statsPausedFor").textContent,
  });

  test("shows the active tab's counts", async () => {
    const page = await settled(await optionsPage({ stats: { shown: 7, total: 20, pending: 3, paused: 0 } }));
    assert.deepEqual(card(page), { state: "ready", shown: "7", total: "20", loading: "3 still loading", paused: null });
  });

  test("shows a pause instead of the loading count", async () => {
    const page = await settled(await optionsPage({ stats: { shown: 7, total: 20, pending: 3, paused: 12 } }));
    assert.deepEqual(card(page), { state: "ready", shown: "7", total: "20", loading: null, paused: "Resuming in 12s" });
  });

  test("is empty off Vinted, or on a Vinted page without listings", async () => {
    assert.equal((await settled(await optionsPage())).$("stats").dataset.state, "empty");
    assert.equal((await settled(await optionsPage({ stats: { shown: 0, total: 0, pending: 0, paused: 0 } }))).$("stats").dataset.state, "empty");
  });

  test("says the filter is off without asking the tab", async () => {
    const page = await settled(await optionsPage({ settings: { enabled: false }, stats: { shown: 1, total: 1 } }));
    assert.equal(page.$("stats").dataset.state, "off");
    assert.equal(page.statsRequests, 0);
  });

  test("the popup refreshes every second; the options page doesn't", async () => {
    let n = 0;
    const popup = await settled(await optionsPage({ stats: () => ({ shown: ++n, total: 10, pending: 0, paused: 0 }) }));
    await popup.tick(3000);
    assert.ok(popup.statsRequests >= 4);
    assert.equal(popup.$("statsShown").textContent, String(n));

    const options = await settled(await optionsPage({ popup: false, stats: { shown: 1, total: 1, pending: 0, paused: 0 } }));
    await options.tick(3000);
    assert.equal(options.statsRequests, 1);
  });
});
