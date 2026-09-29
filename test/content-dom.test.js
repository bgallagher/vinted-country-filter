// Cards, badges, dim/hide, switching off, and staying out of the page's way.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeResponse, sellers } from "./helpers/env.js";
import { searchCard, feedCard, railCard, closet, setRect } from "./helpers/grid.js";
import { lookupPage, heldFetch, sellerOf } from "./helpers/lookups.js";

const badgeOf = (card) => (card.box || card).querySelector(".vlf-badge");
const settle = (page) => page.tick(5000);

describe("finding listings", () => {
  test("badges every card shape and dims or hides the right cell", async () => {
    const page = await lookupPage({ settings: { mode: "hide" }, fetch: sellers({ s1: "FR", s2: "FR", s3: "FR", 4004: "FR" }) });
    const doc = page.document;
    const search = searchCard(doc, "1");
    const feed = feedCard(doc, "2");
    const rail = railCard(doc, "similar_items", "3");
    const other = railCard(doc, "other_user_items", "5");
    const promo = closet(doc, "4004", ["41", "42"]);
    for (const el of [search.el, feed.el, rail.el, other.el, promo.el]) { setRect(el); doc.body.append(el); }
    // No owner entry for the closet's items: its testid names the seller.
    page.owners([["1", "s1", ""], ["2", "s2", ""], ["3", "s3", ""], ["5", "s3", ""]]);
    await settle(page);

    assert.equal(doc.querySelectorAll(".vlf-badge").length, 6);
    assert.ok(search.el.classList.contains("vlf-hidden"), "search: the grid-item cell");
    assert.ok(!search.box.classList.contains("vlf-hidden"));
    assert.ok(feed.box.classList.contains("vlf-hidden"), "feed: the card itself, its parent has other children");
    assert.ok(!feed.el.classList.contains("vlf-hidden"));
    assert.ok(rail.el.classList.contains("vlf-hidden"), "rail: the wrapper it's the only child of");
    assert.ok(other.el.classList.contains("vlf-hidden"));
    assert.ok(promo.el.classList.contains("vlf-hidden"), "closet: the whole box");
    assert.ok(!promo.cards[0].box.classList.contains("vlf-hidden"));
    assert.deepEqual(page.lookups().map(sellerOf).sort(), ["4004", "s1", "s2", "s3"]);
    assert.deepEqual(page.errors, []);
  });

  test("puts the badge and photo button in the image container", async () => {
    const page = await lookupPage({ n: 1 });
    const container = page.cards[0].box.querySelector('[class*="image-container"]');
    assert.ok(container.querySelector(":scope > .vlf-badge"));
    assert.ok(container.querySelector(":scope > .vlf-zoom"));
  });

  test("ignores links that aren't listing overlays", async () => {
    const page = await lookupPage();
    page.document.body.innerHTML = `
      <div data-testid="x"><a data-testid="x--overlay-link" href="/member/5">member</a></div>
      <div data-testid="y"><a data-testid="y-link" href="/items/6">not an overlay</a></div>
      <a data-testid="z--overlay-link" href="/items/7">no card</a>`;
    await settle(page);
    assert.equal(page.document.querySelectorAll(".vlf-badge").length, 0);
  });
});

describe("badges", () => {
  test("show the seller's country and where they are", async () => {
    const page = await lookupPage({
      n: 3,
      fetch: (url) => {
        if (url.endsWith("u2")) return new FakeResponse(JSON.stringify({ user: { country_iso_code: "FR", city: "Lyon", country_title: "France" } }), { headers: { "content-type": "application/json" } });
        if (url.endsWith("u3")) return new FakeResponse(JSON.stringify({ user: { country_code: "de" } }), { headers: { "content-type": "application/json" } });
        return sellers()(url);
      },
    });
    await settle(page);
    const [ie, fr, de] = page.cards.map(badgeOf);
    assert.deepEqual([ie.dataset.state, ie.textContent], ["match", "🇮🇪 IE"]);
    assert.deepEqual([fr.dataset.state, fr.textContent, fr.title], ["other", "🇫🇷 FR", "Seller in Lyon, France"]);
    assert.deepEqual([de.dataset.state, de.textContent, de.title], ["other", "🇩🇪 de", "Seller in de"]);
  });

  test("pulse while the lookup is queued", async () => {
    const page = await lookupPage({ n: 1, fetch: heldFetch() });
    const b = badgeOf(page.cards[0]);
    assert.deepEqual([b.dataset.state, b.textContent, b.title], ["loading", "…", "Looking up seller…"]);
    assert.equal((await page.stats()).pending, 1);
  });

  test("say so when the seller isn't known yet", async () => {
    const page = await lookupPage();
    const c = searchCard(page.document, "9");
    page.document.body.append(c.el);
    await settle(page);
    const b = badgeOf(c);
    assert.deepEqual([b.dataset.state, b.title], ["unknown", "Seller not known yet"]);
    assert.equal(page.lookups().length, 0);
  });

  test("match the chosen country, else the site's", async () => {
    const countries = { u1: "IE", u2: "GB", u3: "FR" };
    const states = async (opts) => {
      const page = await lookupPage({ n: 3, countries, ...opts });
      await settle(page);
      return page.cards.map((c) => badgeOf(c).dataset.state);
    };
    assert.deepEqual(await states({}), ["match", "other", "other"]);
    assert.deepEqual(await states({ url: "https://www.vinted.co.uk/catalog" }), ["other", "match", "other"]);
    assert.deepEqual(await states({ settings: { country: "FR" } }), ["other", "other", "match"]);
  });
});

describe("filter modes", () => {
  const countries = { u1: "IE", u2: "FR" };
  const classes = (page) => page.cards.map((c) => [...c.el.classList].filter((k) => k.startsWith("vlf-")).join(" "));

  test("show only badges, dim or hide listings from other countries", async () => {
    for (const [mode, expected, shown] of [["badge", ["", ""], 2], ["dim", ["", "vlf-dimmed"], 2], ["hide", ["", "vlf-hidden"], 1]]) {
      const page = await lookupPage({ n: 2, countries, settings: { mode } });
      await settle(page);
      assert.deepEqual(classes(page), expected, mode);
      assert.deepEqual(await page.stats(), { shown, total: 2, pending: 0, paused: 0 }, mode);
    }
  });

  test("'filter unknown' applies to unknown sellers, never to ones still loading", async () => {
    let held = true;
    const page = await lookupPage({
      n: 3,
      settings: { mode: "hide", hideUnknown: true },
      fetch: (url) => (url.endsWith("u2") ? new FakeResponse("", { status: 500 }) : url.endsWith("u3") && held ? new Promise(() => {}) : sellers()(url)),
    });
    await settle(page);
    assert.deepEqual(classes(page), ["", "vlf-hidden", ""]);
    assert.equal(badgeOf(page.cards[2]).dataset.state, "loading");
    held = false;
  });

  test("follow settings changed in the popup or another tab", async () => {
    const page = await lookupPage({ n: 2, countries });
    await settle(page);
    assert.deepEqual(classes(page), ["", "vlf-dimmed"]);
    await page.chrome.setFromElsewhere("sync", { settings: { mode: "hide" } });
    await page.tick(50);
    assert.deepEqual(classes(page), ["", "vlf-hidden"]);
  });
});

describe("switched off", () => {
  test("removes badges, photo buttons and dim/hide, and counts everything as shown", async () => {
    const page = await lookupPage({ n: 3, countries: { u2: "FR" }, settings: { mode: "hide" } });
    await settle(page);
    assert.equal(page.document.querySelectorAll(".vlf-hidden").length, 1);
    await page.chrome.setFromElsewhere("sync", { settings: { enabled: false, mode: "hide" } });
    await page.tick(100);
    assert.equal(page.document.querySelectorAll(".vlf-badge, .vlf-zoom, .vlf-hidden, .vlf-dimmed").length, 0);
    assert.deepEqual(await page.stats(), { shown: 3, total: 3, pending: 0, paused: 0 });
  });

  test("puts everything back when switched on again", async () => {
    const page = await lookupPage({ n: 2, countries: { u2: "FR" }, settings: { enabled: false } });
    await settle(page);
    assert.equal(page.document.querySelectorAll(".vlf-badge").length, 0);
    await page.chrome.setFromElsewhere("sync", { settings: { enabled: true } });
    await settle(page);
    assert.equal(page.document.querySelectorAll(".vlf-badge").length, 2);
    assert.equal(page.document.querySelectorAll(".vlf-dimmed").length, 1);
  });
});

describe("living in Vinted's page", () => {
  test("a pass with nothing new writes nothing to the page", async () => {
    const page = await lookupPage({ n: 6, countries: { u2: "FR" } });
    await settle(page);
    const muts = [];
    new page.window.MutationObserver((m) => muts.push(...m)).observe(page.document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    page.window.dispatchEvent(new page.window.Event("scroll"));
    await page.tick(1000);
    const outside = muts.filter((m) => m.target !== page.document.getElementById("vlf-root"));
    assert.deepEqual(outside.map((m) => `${m.type} ${m.target.className || m.target.nodeName}`), []);
  });

  test("new cards added by the page are picked up", async () => {
    const page = await lookupPage({ n: 2 });
    page.addCards(2, { first: 3 });
    await settle(page);
    assert.equal(page.document.querySelectorAll(".vlf-badge").length, 4);
  });

  test("puts its panel back when the page re-renders <body>", async () => {
    const page = await lookupPage({ n: 2 });
    await settle(page);
    const doc = page.document;
    const body = doc.createElement("body");
    body.append(...[...doc.body.children].filter((el) => el.id !== "vlf-root"));
    doc.documentElement.replaceChild(body, doc.body);
    await page.tick(100);
    const host = doc.getElementById("vlf-root");
    assert.ok(host && host.isConnected && host.parentElement === doc.body);
    assert.ok(page.panel());
  });

  test("stops cleanly when the extension is reloaded", async () => {
    const page = await lookupPage({ n: 4 });
    await settle(page);
    page.chrome.cutOff();
    page.document.body.append(page.document.createElement("div")); // a page change
    await page.tick(100);
    assert.equal(page.document.getElementById("vlf-root"), null);
    const calls = page.chrome.calls.length;
    page.addCards(3, { first: 10 });
    page.window.dispatchEvent(new page.window.Event("scroll"));
    await page.tick(60 * 1000);
    assert.equal(page.chrome.calls.length, calls, "no chrome.* calls once cut off");
    assert.equal(page.document.querySelectorAll(".vlf-badge").length, 4, "new cards aren't badged");
    assert.deepEqual(page.errors, []);
  });

  test("answers the popup's stats request", async () => {
    const page = await lookupPage({ n: 5, countries: { u5: "FR" }, settings: { mode: "hide" } });
    await settle(page);
    assert.deepEqual(await page.stats(), { shown: 4, total: 5, pending: 0, paused: 0 });
    assert.equal(await page.chrome.message({ type: "other" }), undefined);
  });
});
