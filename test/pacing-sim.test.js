// Half an hour of searches against fake Vinted rate limiters, on the fake
// clock: the regression test for lookup pacing (see CLAUDE.md, "Country
// lookup"). Each search shows 48 listings from new sellers, 12 of them on
// screen, and the next search replaces them 2.5 minutes later. The bounds were set from the
// numbers measured when this test was written (in the comments), with
// headroom; a change that makes pacing clearly worse should fail them.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { T0, makeStorage, sellers } from "./helpers/env.js";
import { lookupPage, MIN } from "./helpers/lookups.js";

const SEARCHES = 12, PER_SEARCH = 48, ON_SCREEN = 12, EVERY = 2.5 * MIN;

// Vinted-like limiters: `allow(t)` says whether a request at t gets through;
// a request that does is counted by `take(t)`.
const windows = (limits) => {
  const seen = [];
  return {
    allow: (t) => limits.every(([n, ms]) => seen.filter((s) => t - s < ms).length < n),
    take: (t) => seen.push(t),
  };
};
const LIMITERS = {
  // Only the 30-per-30s limit.
  loose: () => windows([[30, 30000]]),
  // As seen on vinted.ie (2026-09-26): about 5 in 3s as well.
  strict: () => windows([[5, 3000], [30, 30000]]),
  // A bucket of 5 refilling one token a second.
  bucket: () => {
    let tokens = 5, last = 0;
    return {
      allow: (t) => { tokens = Math.min(5, tokens + (t - last) / 1000); last = t; return tokens >= 1; },
      take: () => { tokens--; },
    };
  },
};

// Runs the searches in `tabs` pages sharing one limiter, clock and
// localStorage. Returns the 429 count, the median and worst time until a
// search's on-screen sellers were all looked up, and how many sellers were
// never looked up before the next search replaced them.
async function simulate({ limiter, tabs = 1, rate }) {
  const server = LIMITERS[limiter]();
  const done = new Map(); // seller -> time of its successful lookup
  let count429 = 0;
  const ok = sellers();
  const fetch = (url, init, page) => {
    const t = page.clock.now;
    if (!server.allow(t)) {
      count429++;
      return { status: 429, ok: false, headers: { get: () => null }, json: async () => ({}) };
    }
    server.take(t);
    done.set(url.replace("/api/v2/users/", ""), t);
    return ok(url);
  };

  const storage = makeStorage();
  const pages = [];
  for (let i = 0; i < tabs; i++) pages.push(await lookupPage({ fetch, storage, rate, clock: pages[0] && pages[0].clock }));
  const clock = pages[0].clock;

  const results = [];
  for (let s = 0; s < SEARCHES; s++) {
    const start = clock.now;
    const ids = pages.map((page, p) => {
      for (const c of page.cards) c.el.remove();
      page.cards.length = 0;
      const seller = (i) => `t${p}s${s}n${i}`;
      page.addCards(PER_SEARCH, { seller, first: s * 1000 + 1 });
      return Array.from({ length: PER_SEARCH }, (_, i) => seller(s * 1000 + 1 + i));
    }).flat();
    await pages[0].tick(EVERY);
    const onScreen = pages.flatMap((_, p) => ids.slice(p * PER_SEARCH, p * PER_SEARCH + ON_SCREEN));
    results.push({
      screen: Math.max(...onScreen.map((id) => (done.has(id) ? done.get(id) - start : Infinity))),
      missed: ids.filter((id) => !done.has(id)).length,
    });
  }
  const screens = results.map((r) => r.screen).sort((a, b) => a - b);
  return {
    count429,
    screen: screens[screens.length >> 1],
    worstScreen: screens[screens.length - 1],
    missed: results.reduce((n, r) => n + r.missed, 0),
  };
}

// Measured when written (2026-09-29), then the bound:
//   screen / worstScreen: ms until a search's on-screen sellers were done
//   missed: sellers never looked up before the next search replaced them
const SCENARIOS = [
  // 0 429s, screen 3.0s (6 now, 6 after the 3s burst window), 0 missed
  ["fresh start, loose limiter", { limiter: "loose" }, { count429: 0, screen: 4000, worstScreen: 4000, missed: 0 }],
  // 4 429s (one learning event per 10-minute relax step), screen 6.0s, worst 8.0s
  ["fresh start, strict limiter", { limiter: "strict" }, { count429: 8, screen: 8000, worstScreen: 12000, missed: 0 }],
  // 6 429s, screen 33s, 28 missed: 429s here are blamed on the 30s window,
  // which lowers `limit` below what a 1/s bucket allows
  ["fresh start, bucket limiter", { limiter: "bucket" }, { count429: 12, screen: 40000, worstScreen: 45000, missed: 40 }],
  // 3 429s, screen 6.0s, worst 9.0s: relaxes back from 3 within the run
  ["burst stuck at 3, strict limiter", { limiter: "strict", rate: { limit: 25, burst: 3, calm: T0, every: 10 * MIN, relaxed: 0, t: T0 } }, { count429: 6, screen: 8000, worstScreen: 12000, missed: 0 }],
  // 8 429s, screen 66s: 24 on-screen sellers across two tabs share one
  // 25-per-30s budget with each tab's off-screen ones
  ["two tabs, strict limiter", { limiter: "strict", tabs: 2 }, { count429: 14, screen: 80000, worstScreen: 80000, missed: 0 }],
];

describe("half an hour of searches", () => {
  for (const [name, opts, bound] of SCENARIOS) {
    test(name, async (t) => {
      const r = await simulate(opts);
      t.diagnostic(JSON.stringify(r));
      for (const [k, max] of Object.entries(bound)) assert.ok(r[k] <= max, `${k} ${r[k]} > ${max}`);
    });
  }
});
