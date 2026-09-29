// Helpers for tests that drive content.js's seller lookups.
import { contentPage, sellers, T0 } from "./env.js";
import { makeChrome } from "./chrome.js";
import { grid } from "./grid.js";

export const MIN = 60 * 1000;
export const DAY = 24 * 60 * MIN;

// A content.js page with `n` search cards (seller u<i> for item i) already
// posted. `rate`, `users` and `settings` preload chrome.storage.
export async function lookupPage({ n = 0, countries = {}, fetch, rate, users, settings, chrome, storage, clock, url, gridOpts } = {}) {
  chrome = chrome || makeChrome({
    sync: settings ? { settings } : {},
    local: { ...(rate && { rate }), ...(users && { users }) },
  });
  const page = await contentPage({ chrome, storage, clock, url, fetch: fetch || sellers(countries) });
  page.cards = [];
  page.addCards = (count, opts) => addCards(page, count, opts);
  if (n) page.addCards(n, gridOpts);
  await page.tick(50); // the message, then the pass on the next animation frame
  return page;
}

// Adds search cards to a page and posts their owners, as inject.js would.
export function addCards(page, n, opts) {
  const g = grid(page.document, n, opts);
  page.owners(g.pairs);
  page.cards.push(...g.cards);
  return g;
}

// The most start times that fall within any `ms` window (same test as
// content.js: a start counts while now - t < ms).
export function maxIn(times, ms) {
  let best = 0;
  for (let i = 0; i < times.length; i++) {
    let n = 0;
    for (let j = i; j < times.length && times[j] - times[i] < ms; j++) n++;
    best = Math.max(best, n);
  }
  return best;
}

export const sellerOf = (call) => call.url.replace("/api/v2/users/", "");
export const startTimes = (page) => page.lookups().map((c) => c.t - T0);

// A seller lookup handler that answers 429 when `limited(n, t)` says so, for
// the n-th request (from 1) at time t; otherwise a country from `countries`.
export function limiter(limited, { countries = {}, headers = {} } = {}) {
  let n = 0;
  const ok = sellers(countries);
  const handler = (url, init, page) => {
    n++;
    if (limited(n, page.clock.now - T0)) {
      handler.count429++;
      return { status: 429, ok: false, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => ({}) };
    }
    return ok(url);
  };
  handler.count429 = 0;
  return handler;
}

// A seller lookup that stays in flight until release() is called.
export function heldFetch() {
  const pending = [];
  const handler = (url) => new Promise((resolve) => pending.push(() => resolve(sellers()(url))));
  handler.inFlight = () => pending.length;
  handler.release = () => { for (const r of pending.splice(0)) r(); };
  return handler;
}
