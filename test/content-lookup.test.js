// Seller lookups: the cache, pacing (limit / burst / concurrency), learning
// from 429s, recovery, the cross-tab start count and lookup order. All driven
// through content.js's real code, observed from the fetches it makes.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { T0, FakeResponse, makeStorage, sellers } from "./helpers/env.js";
import { makeChrome } from "./helpers/chrome.js";
import { searchCard, setRect } from "./helpers/grid.js";
import { lookupPage, limiter, heldFetch, maxIn, startTimes, sellerOf, MIN, DAY } from "./helpers/lookups.js";

const LIMIT_START = 25, BURST_START = 6, RELAX_MS = 10 * MIN;
const rateOf = (page) => page.chrome.stores.local.rate;
const always429 = () => limiter(() => true);

describe("cache", () => {
  test("uses fresh cached countries and looks up expired or empty ones", async () => {
    const page = await lookupPage({
      n: 4,
      users: {
        u1: { c: "FR", name: "France", city: "Paris", t: T0 - DAY },
        u2: { c: "DE", t: T0 - 91 * DAY }, // older than 90 days
        u3: { c: null, city: "", t: T0 - DAY }, // saved by 0.x for a failed lookup
      },
    });
    await page.tick(1000);
    assert.deepEqual(page.lookups().map(sellerOf).sort(), ["u2", "u3", "u4"]);
    const first = page.cards[0].box.querySelector(".vlf-badge");
    assert.equal(first.dataset.state, "other");
    assert.equal(first.title, "Seller in Paris, France");
  });

  test("looks each seller up once, however many listings they have", async () => {
    const page = await lookupPage({ n: 12, gridOpts: { seller: (i) => `u${i % 3}` } });
    await page.tick(5000);
    assert.deepEqual(page.lookups().map(sellerOf).sort(), ["u0", "u1", "u2"]);
  });
});

describe("pacing", () => {
  test("never more than `burst` starts in 3s or `limit` in 30s", async () => {
    const page = await lookupPage({ n: 80 });
    await page.tick(4 * MIN);
    const t = startTimes(page);
    assert.equal(t.length, 80);
    assert.equal(maxIn(t, 3000), BURST_START);
    assert.equal(maxIn(t, 30000), LIMIT_START);
  });

  test("starts a burst for the listings on screen at once", async () => {
    const page = await lookupPage({ n: 20 });
    const t = startTimes(page);
    assert.equal(t.length, BURST_START);
    assert.ok(t.every((x) => x < 50), `first starts at ${t}`);
  });

  test("gets through a page of 96 sellers in under 2.5 minutes", async () => {
    const page = await lookupPage({ n: 96 });
    await page.tick(150 * 1000);
    assert.equal(page.lookups().length, 96);
  });

  test("runs at most 4 lookups at once", async () => {
    const held = heldFetch();
    const page = await lookupPage({ n: 20, fetch: held });
    await page.tick(10 * 1000);
    assert.equal(held.inFlight(), 4);
    held.release();
    await page.tick(10);
    assert.equal(held.inFlight(), 4);
  });
});

describe("saved rate", () => {
  test("uses a saved limit and burst", async () => {
    const page = await lookupPage({ n: 40, rate: { limit: 10, burst: 4, calm: T0, every: RELAX_MS, relaxed: 0, t: T0 } });
    await page.tick(2 * MIN);
    const t = startTimes(page);
    assert.equal(maxIn(t, 3000), 4);
    assert.equal(maxIn(t, 30000), 10);
  });

  test("ignores saved values out of range", async () => {
    const page = await lookupPage({ n: 60, rate: { limit: 100, burst: 50, calm: T0, every: 999, relaxed: 0, t: T0 } });
    await page.tick(2 * MIN);
    const t = startTimes(page);
    assert.equal(maxIn(t, 3000), BURST_START);
    assert.equal(maxIn(t, 30000), LIMIT_START);
  });

  test("caps a burst saved by 0.7.x (no `every`) at 6", async () => {
    const page = await lookupPage({ n: 60, rate: { limit: 28, burst: 28, t: T0 } });
    await page.tick(2 * MIN);
    const t = startTimes(page);
    assert.equal(maxIn(t, 3000), BURST_START);
    assert.equal(maxIn(t, 30000), 28);
  });
});

describe("429 responses", () => {
  test("pause 5s, doubling to 120s", async () => {
    const page = await lookupPage({ n: 1, fetch: always429() });
    await page.tick(10 * MIN);
    const t = startTimes(page);
    const gaps = t.slice(1).map((x, i) => x - t[i]);
    const expected = [5, 10, 20, 40, 80, 120, 120].map((s) => s * 1000);
    assert.deepEqual(gaps.slice(0, 7).map((g) => Math.round(g / 1000) * 1000), expected);
  });

  test("honour Retry-After", async () => {
    const page = await lookupPage({ n: 1, fetch: limiter((n) => n === 1, { headers: { "retry-after": "42" } }) });
    await page.tick(MIN);
    const t = startTimes(page);
    assert.equal(t.length, 2);
    assert.ok(t[1] >= 42000 && t[1] < 42100, `retried at ${t[1]}`);
  });

  test("several 429s from one event cause one pause, not one each", async () => {
    // 4 lookups in flight (CONCURRENCY) all come back 429.
    const page = await lookupPage({ n: 6, fetch: limiter((n) => n <= 4) });
    assert.equal(page.lookups().length, 4);
    await page.tick(10 * 1000);
    const t = startTimes(page);
    assert.ok(t[4] - t[3] >= 5000 && t[4] - t[3] < 5100, `resumed after ${t[4] - t[3]}ms`);
  });

  test("many starts in the last 3s lower the burst", async () => {
    const page = await lookupPage({ n: 10, fetch: limiter((n) => n === 6) });
    await page.tick(100);
    assert.equal(rateOf(page).burst, 4);
    assert.equal(rateOf(page).limit, LIMIT_START);
  });

  test("otherwise, many starts in the last 30s lower the limit", async () => {
    const rate = { limit: 25, burst: 4, calm: T0, every: RELAX_MS, relaxed: 0, t: T0 };
    const page = await lookupPage({ n: 30, rate, fetch: limiter((n) => n === 21) });
    await page.tick(20 * 1000);
    // The 21st start (4 per 3s) comes at 15s. Its whole batch of 4 has
    // started by the time the 429 comes back: 24 in the last 30s, 4 in 3s.
    assert.equal(rateOf(page).limit, 21);
    assert.equal(rateOf(page).burst, 4);
  });

  test("a 429 with few recent starts of ours only pauses", async () => {
    const page = await lookupPage({ n: 1, fetch: limiter((n) => n === 1) });
    await page.tick(100);
    const rate = rateOf(page);
    assert.equal(rate.limit, LIMIT_START);
    assert.equal(rate.burst, BURST_START);
    assert.ok(rate.calm < T0, "not counted as ours");
    await page.tick(6000);
    assert.equal(page.lookups().length, 2);
  });

  test("the popup and panel see the pause", async () => {
    const page = await lookupPage({ n: 2, fetch: limiter((n) => n <= 2) });
    await page.tick(1000);
    const { paused } = await page.stats();
    assert.ok(paused >= 4 && paused <= 5, `paused for ${paused}s`);
    assert.match(page.panel().querySelector(".stats").textContent, /paused/);
    await page.tick(5000);
    assert.equal((await page.stats()).paused, 0);
  });
});

describe("recovery", () => {
  test("every 60 successes raise burst, then limit", async () => {
    const page = await lookupPage({ n: 70, rate: { limit: 25, burst: 6, calm: T0, every: RELAX_MS, relaxed: 0, t: T0 } });
    await page.tick(4 * MIN);
    assert.equal(rateOf(page).burst, 7);

    const full = await lookupPage({ n: 70, rate: { limit: 10, burst: 10, calm: T0, every: RELAX_MS, relaxed: 0, t: T0 } });
    await full.tick(10 * MIN);
    assert.equal(rateOf(full).limit, 11);
    assert.equal(rateOf(full).burst, 11);
  });

  test("the limit creeps up to 28 at most", async () => {
    const page = await lookupPage({ n: 70, rate: { limit: 28, burst: 28, calm: T0, every: RELAX_MS, relaxed: 0, t: T0 } });
    await page.tick(5 * MIN);
    assert.equal(maxIn(startTimes(page), 30000), 28);
    assert.equal(rateOf(page).limit, 28);
    assert.equal(rateOf(page).burst, 28);
  });

  test("after 10 quiet minutes, half the lost burst comes back", async () => {
    const page = await lookupPage({ rate: { limit: 25, burst: 3, calm: T0 - RELAX_MS, every: RELAX_MS, relaxed: 0, t: T0 } });
    assert.equal(rateOf(page).burst, 5);
    const later = await lookupPage({ rate: { limit: 25, burst: 3, calm: T0 - 2 * RELAX_MS, every: RELAX_MS, relaxed: 0, t: T0 } });
    assert.equal(rateOf(later).burst, BURST_START);
  });

  test("half the lost limit comes back too, while the page is open", async () => {
    const page = await lookupPage({ rate: { limit: 9, burst: 3, calm: T0, every: RELAX_MS, relaxed: 0, t: T0 } });
    await page.tick(RELAX_MS);
    page.addCards(1); // a pump() applies the relax step
    await page.tick(100);
    assert.equal(rateOf(page).limit, 17);
    assert.equal(rateOf(page).burst, 5);
  });

  test("a 429 soon after a relax step doubles the wait for the next, up to 80 min", async () => {
    // Relaxed at load (burst 3 -> 5), then the 5th start in 3s gets a 429.
    const page = await lookupPage({ n: 5, fetch: limiter((n) => n === 5), rate: { limit: 25, burst: 3, calm: T0 - RELAX_MS, every: RELAX_MS, relaxed: 0, t: T0 } });
    await page.tick(100);
    assert.equal(rateOf(page).every, 2 * RELAX_MS);
    assert.equal(rateOf(page).burst, 3);

    const capped = await lookupPage({ n: 5, fetch: limiter((n) => n === 5), rate: { limit: 25, burst: 5, calm: T0 - 1000, every: 80 * MIN, relaxed: T0 - 1000, t: T0 } });
    await capped.tick(100);
    assert.equal(rateOf(capped).every, 80 * MIN);
  });

  test("the wait resets once the full rate has held that long", async () => {
    const page = await lookupPage({ rate: { limit: 25, burst: 6, calm: T0 - 40 * MIN, every: 40 * MIN, relaxed: T0 - 50 * MIN, t: T0 } });
    assert.equal(rateOf(page).every, RELAX_MS);
  });
});

describe("start count shared across tabs", () => {
  test("recent starts from another tab delay the first lookup", async () => {
    const storage = makeStorage();
    storage.setItem("vlf:starts", JSON.stringify(Array(6).fill(T0 - 1000)));
    const page = await lookupPage({ n: 3, storage });
    await page.tick(5000);
    const t = startTimes(page);
    assert.ok(t[0] >= 2000, `first lookup at ${t[0]}`);
  });

  test("ignores a corrupt or blocked localStorage", async () => {
    const storage = makeStorage();
    storage.setItem("vlf:starts", "{not json");
    const page = await lookupPage({ n: 3, storage });
    assert.equal(page.lookups().length, 3);
    const blocked = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
    const page2 = await lookupPage({ n: 8, storage: blocked });
    await page2.tick(MIN);
    assert.equal(maxIn(startTimes(page2), 3000), BURST_START);
  });

  test("two tabs together stay within the limits", async () => {
    const storage = makeStorage();
    const a = await lookupPage({ n: 40, storage });
    const b = await lookupPage({ n: 40, storage, clock: a.clock, gridOpts: { seller: (i) => `v${i}` } });
    await a.tick(3 * MIN);
    const t = [...a.lookups(), ...b.lookups()].map((c) => c.t).sort((x, y) => x - y);
    assert.equal(t.length, 80);
    assert.equal(maxIn(t, 3000), BURST_START);
    assert.equal(maxIn(t, 30000), LIMIT_START);
  });
});

describe("lookup order", () => {
  // Cards placed around a 768px viewport.
  const layout = [
    ["far-above", { top: -900 }], // rank 3
    ["just-above", { top: -350 }], // bottom -50: within 200px above
    ["screen-right", { top: 100, left: 400 }],
    ["screen-left", { top: 101, left: 0 }], // same row despite 1px
    ["screen-row2", { top: 420, left: 0 }],
    ["just-below", { top: 900 }], // within 400px below
    ["far-below", { top: 1300 }],
    ["hidden", { width: 0, height: 0 }],
  ];

  async function laidOut() {
    const page = await lookupPage();
    const pairs = layout.map(([name, rect], i) => {
      const c = searchCard(page.document, String(i + 1));
      setRect(c.el, rect);
      page.document.body.append(c.el);
      return [String(i + 1), name, ""];
    });
    page.owners(pairs);
    return page;
  }

  test("on screen first, then below, above and the rest, each in reading order", async () => {
    const page = await laidOut();
    await page.tick(5000);
    assert.deepEqual(page.lookups().map(sellerOf), [
      "screen-left", "screen-right", "screen-row2", "just-below", "just-above", "far-above", "far-below", "hidden",
    ]);
  });

  test("drops sellers whose listings left the page, and queues them again if they come back", async () => {
    const page = await lookupPage({ n: 20 });
    assert.equal(page.lookups().length, 6);
    for (const c of page.cards) c.el.remove();
    page.addCards(2, { first: 101, seller: (i) => `new${i}` });
    await page.tick(MIN);
    assert.deepEqual(page.lookups().slice(6).map(sellerOf), ["new101", "new102"]);

    page.document.body.append(page.cards[10].el); // u11 is back
    await page.tick(MIN);
    assert.deepEqual(page.lookups().slice(8).map(sellerOf), ["u11"]);
  });

  test("an empty page (mid re-render) keeps the queue", async () => {
    const page = await lookupPage({ n: 20 });
    for (const c of page.cards) c.el.remove();
    await page.tick(MIN);
    assert.equal(page.lookups().length, 20);
  });
});

describe("filter switched off", () => {
  test("starts no lookups, and resumes when switched back on", async () => {
    const page = await lookupPage({ n: 10, settings: { enabled: false } });
    await page.tick(MIN);
    assert.equal(page.lookups().length, 0);
    await page.chrome.setFromElsewhere("sync", { settings: { enabled: true } });
    await page.tick(MIN);
    assert.equal(page.lookups().length, 10);
  });

  test("pauses a queue already running", async () => {
    const page = await lookupPage({ n: 20 });
    await page.chrome.setFromElsewhere("sync", { settings: { enabled: false } });
    await page.tick(MIN);
    assert.equal(page.lookups().length, 6);
    await page.chrome.setFromElsewhere("sync", { settings: { enabled: true } });
    await page.tick(MIN);
    assert.equal(page.lookups().length, 20);
  });
});

describe("failed lookups", () => {
  test("an error response shows the seller as unknown and isn't saved", async () => {
    const page = await lookupPage({ n: 2, fetch: (url) => (url.endsWith("u1") ? new FakeResponse("", { status: 404 }) : sellers()(url)) });
    await page.tick(2000);
    const badge = page.cards[0].box.querySelector(".vlf-badge");
    assert.equal(badge.dataset.state, "unknown");
    assert.equal(badge.textContent, "? –");
    assert.deepEqual(Object.keys(page.chrome.stores.local.users), ["u2"]);
  });

  test("a network error leaves the seller to be retried on the next pass", async () => {
    let fail = true;
    const page = await lookupPage({ n: 1, fetch: (url) => { if (fail) { fail = false; throw new TypeError("Failed to fetch"); } return sellers()(url); } });
    await page.tick(100);
    // The failed lookup schedules that pass itself.
    assert.equal(page.lookups().length, 2);
    assert.equal(page.cards[0].box.querySelector(".vlf-badge").dataset.state, "match");
  });

  test("a country missing from the response counts as unknown", async () => {
    const { json } = await import("./helpers/env.js");
    const page = await lookupPage({ n: 1, fetch: () => json({ user: { city: "Nowhere" } }) });
    await page.tick(100);
    assert.equal(page.cards[0].box.querySelector(".vlf-badge").dataset.state, "unknown");
  });
});

describe("saving the cache", () => {
  test("saves a second after the last lookup", async () => {
    const page = await lookupPage({ n: 2, countries: { u2: "FR" } });
    await page.tick(900);
    assert.equal(page.chrome.stores.local.users, undefined);
    await page.tick(200);
    const saved = page.chrome.stores.local.users;
    assert.deepEqual(Object.keys(saved).sort(), ["u1", "u2"]);
    assert.equal(saved.u2.c, "FR");
    assert.equal(saved.u2.t, page.lookups()[1].t);
  });

  test("merges with sellers another tab saved meanwhile", async () => {
    const page = await lookupPage({ n: 1 });
    await page.chrome.setFromElsewhere("local", { users: { other: { c: "DE", t: T0 } } });
    await page.tick(1500);
    assert.deepEqual(Object.keys(page.chrome.stores.local.users).sort(), ["other", "u1"]);
  });

  test("drops expired entries and keeps the newest 20,000", async () => {
    const users = { expired: { c: "FR", t: T0 - 100 * DAY } };
    for (let i = 0; i < 20000; i++) users[`old${i}`] = { c: "IE", t: T0 - DAY - i };
    const chrome = makeChrome({ local: { users } });
    const page = await lookupPage({ n: 3, chrome });
    await page.tick(1500);
    const saved = page.chrome.stores.local.users;
    assert.equal(Object.keys(saved).length, 20000);
    for (const id of ["u1", "u2", "u3", "old0", "old19996"]) assert.ok(saved[id], `${id} kept`);
    for (const id of ["expired", "old19997", "old19998", "old19999"]) assert.ok(!saved[id], `${id} dropped`);
  });
});
