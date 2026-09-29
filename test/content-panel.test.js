// The in-page settings panel, in its shadow root.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { contentPage } from "./helpers/env.js";
import { lookupPage, heldFetch, limiter } from "./helpers/lookups.js";

const $ = (page, sel) => page.panel().querySelector(sel);
const statsText = (page) => $(page, ".stats").textContent;
const saved = (page) => page.chrome.stores.sync.settings;
const change = (el, value) => {
  if (value !== undefined) el.value = value;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event("change", { bubbles: true }));
};
const announced = (page) => page.shadow().querySelector('[role="status"]').textContent;

describe("appearing", () => {
  test("only once the page has listings", async () => {
    const page = await contentPage();
    await page.tick(1000);
    assert.equal(page.document.getElementById("vlf-root"), null);
    const withCards = await lookupPage({ n: 1 });
    assert.ok(withCards.panel());
  });

  test("offers the site's country first, then every country", async () => {
    const page = await lookupPage({ n: 1, url: "https://www.vinted.fr/catalog" });
    const opts = [...$(page, ".country").options];
    assert.equal(opts[0].value, "");
    assert.match(opts[0].textContent, /^This site \(🇫🇷 (France|FR)\)$/);
    assert.equal(opts.length, 1 + page.global("VLF_COUNTRIES").length);
  });

  test("shows the stored settings", async () => {
    const page = await lookupPage({ n: 1, settings: { country: "DE", mode: "hide", hideUnknown: true } });
    assert.equal($(page, ".country").value, "DE");
    assert.ok($(page, "#mode-hide").checked);
    assert.ok($(page, ".unknown").checked);
    assert.ok($(page, ".enabled").checked);
  });
});

describe("stats line", () => {
  test("counts shown listings and lookups still loading", async () => {
    const held = heldFetch();
    const page = await lookupPage({ n: 3, fetch: held });
    assert.equal(statsText(page), "3/3 · 3 loading");
    held.release();
    await page.tick(100);
    assert.equal(statsText(page), "3/3");
  });

  test("says when lookups are paused, and when the filter is off", async () => {
    const page = await lookupPage({ n: 2, fetch: limiter((n) => n === 1) });
    await page.tick(100);
    assert.match(statsText(page), /^\d\/2 · paused$/);
    await page.chrome.setFromElsewhere("sync", { settings: { enabled: false } });
    await page.tick(100);
    assert.equal(statsText(page), "Off");
    assert.ok(page.panel().classList.contains("off"));
  });
});

describe("controls", () => {
  test("each control saves its setting", async () => {
    const page = await lookupPage({ n: 1 });
    change($(page, ".country"), "FR");
    assert.equal(saved(page).country, "FR");
    $(page, "#mode-hide").click();
    assert.equal(saved(page).mode, "hide");
    $(page, ".unknown").click();
    assert.equal(saved(page).hideUnknown, true);
    $(page, ".enabled").click();
    assert.equal(saved(page).enabled, false);
    assert.deepEqual(page.errors, []);
  });

  test("flashes 'Saved' and announces it", async () => {
    const page = await lookupPage({ n: 1 });
    await page.tick(100);
    $(page, "#mode-badge").click();
    await page.tick(200);
    assert.equal(statsText(page), "Saved");
    assert.ok($(page, ".stats").classList.contains("flash"));
    assert.equal(announced(page), "Saved");
    await page.tick(2000);
    assert.equal(statsText(page), "1/1");
  });

  test("apply at once", async () => {
    const page = await lookupPage({ n: 2, countries: { u2: "FR" } });
    await page.tick(1000);
    $(page, "#mode-hide").click();
    await page.tick(50);
    assert.ok(page.cards[1].el.classList.contains("vlf-hidden"));
  });

  test("follow changes made in the popup", async () => {
    const page = await lookupPage({ n: 1 });
    await page.chrome.setFromElsewhere("sync", { settings: { country: "PL", mode: "badge", hideUnknown: true, enabled: false } });
    await page.tick(50);
    assert.equal($(page, ".country").value, "PL");
    assert.ok($(page, "#mode-badge").checked);
    assert.ok($(page, ".unknown").checked);
    assert.ok(!$(page, ".enabled").checked);
  });
});

describe("collapsing", () => {
  test("toggles the body and says so to assistive tech", async () => {
    const page = await lookupPage({ n: 1 });
    const toggle = $(page, ".toggle");
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.equal(toggle.getAttribute("aria-controls"), "body");
    toggle.click();
    await page.tick(50);
    assert.ok(page.panel().classList.contains("collapsed"));
    assert.equal($(page, ".body").inert, true);
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.equal(toggle.getAttribute("aria-label"), "Expand panel");
    assert.equal(saved(page).collapsed, true);
    toggle.click();
    await page.tick(50);
    assert.equal($(page, ".body").inert, false);
  });

  test("keeps the header after the body, in DOM order", async () => {
    const page = await lookupPage({ n: 1 });
    assert.deepEqual([...page.panel().children].map((el) => el.className), ["body", "notice", "head"]);
  });
});

describe("hiding", () => {
  test("hides the panel, saves it, and returns focus to the page", async () => {
    const page = await lookupPage({ n: 1 });
    const search = page.document.createElement("input");
    page.document.body.prepend(search);
    search.focus();
    $(page, ".hide-panel").focus();
    $(page, ".hide-panel").click();
    await page.tick(200);
    assert.equal(page.panel().hidden, true);
    assert.equal(saved(page).showPanel, false);
    assert.equal(page.document.activeElement, search);
    assert.match(announced(page), /Panel hidden/);
  });

  test("comes back when the popup turns it on", async () => {
    const page = await lookupPage({ n: 1, settings: { showPanel: false } });
    assert.equal(page.panel(), null);
    await page.chrome.setFromElsewhere("sync", { settings: { showPanel: true } });
    await page.tick(50);
    assert.equal(page.panel().hidden, false);
  });
});

describe("429 notice", () => {
  test("counts down while lookups wait, and is announced once", async () => {
    const page = await lookupPage({ n: 2, fetch: limiter((n) => n === 1) });
    await page.tick(150);
    const notice = $(page, ".notice");
    assert.equal(notice.hidden, false);
    const first = notice.querySelector(".countdown").textContent;
    assert.match(first, /^Resuming in [45]s$/);
    assert.match(announced(page), /^Vinted is limiting lookups\. Resuming in \d seconds\.$/);
    await page.tick(2000);
    assert.notEqual(notice.querySelector(".countdown").textContent, first);
    await page.tick(4000);
    assert.equal(notice.hidden, true);
  });

  test("isn't shown for normal pacing", async () => {
    const page = await lookupPage({ n: 40 });
    await page.tick(5000);
    assert.equal($(page, ".notice").hidden, true);
    assert.equal((await page.stats()).paused, 0);
  });
});
