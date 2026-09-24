# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Chrome MV3 extension (plain JS, no dependencies) that badges Vinted listings with the seller's country and dims/hides listings from other countries. The user is in Ireland: shipping from an Irish seller costs about €3, from France about €8.

## Development

There is no build, package manager, linter or test suite. The files load as they are.

- Syntax check: `node --check content.js && node --check inject.js`
- Run: `chrome://extensions` → Developer mode → **Load unpacked** → this folder. After an edit, click reload on the extension card and then reload the Vinted tab. Pages left open from before the reload throw "Extension context invalidated".
- Quick test without installing: paste `inject.js` and then `content.js` into DevTools on a Vinted search page. That doesn't reproduce `document_start` timing, the isolated world, or `chrome.storage`, so an installed load is the real test.
- Pacing logic can be tested in Node by extracting the queue section of `content.js` and stubbing `fetch`, `users`, `saveUsers` and `schedule`.

## Architecture

There are two content scripts, and they run in different JS worlds (see `manifest.json`):

- **`inject.js`**: `world: "MAIN"`, `document_start`. It runs in the page's own JS context so it can hook `window.fetch` and `XMLHttpRequest`. Its only job is to build an item ID → seller user ID map. It reads responses and never modifies them.
- **`content.js`**: isolated world, `document_idle`. It has access to `chrome.storage`. It looks up seller countries, draws the badges and the settings panel, and applies the filter.

They communicate only through `window.postMessage` on `location.origin`:
- `vlf:owners` `{pairs: [[itemId, userId], ...]}`: inject → content.
- `vlf:rescan`: content → inject, sent after content.js loads. inject.js replies with every pair it already knows, because its first posts happen before content.js exists.

### Where seller IDs come from (checked on live vinted.ie, 2026-09-24)

Search results never include the seller's location, only their user ID.
- **Page 1** is server-rendered. The data is in inline Next.js flight scripts as escaped JSON: `"productItem":{"id":X ... "ownerId":Y`. See `scanFlightText`. Client-side navigations deliver the same format as `text/x-component` fetch responses.
- **Pages 2+** load by XHR from `api.vinted.ie/svc-catalogue/items`. Each item has `item.user.id`, which the generic `collect` walker finds.

### Country lookup

- `GET /api/v2/users/{id}` (relative to the page origin) works without logging in. It returns `user.country_iso_code`, `country_title` and `city`.
- **Rate limit:** about 30 requests per 30s, after which it returns 429. `content.js` runs one request at a time. Every start goes through `pump()`, which holds requests until `max(pausedUntil, nextAt)`: a 0.9s gap after each request, and on a 429 the longer of a doubling backoff (15s → 120s max) or `Retry-After`. Visible listings jump the queue (`want(id, urgent)`). Keep any new code that starts lookups going through `pump()`, or the gap stops holding.
- Results are cached in `chrome.storage.local` under `users` (`{userId: {c, name, city, t}}`, 14-day TTL). Settings are in `chrome.storage.sync` under `settings`. The default allowed country comes from the Vinted domain's TLD.
- `content.js` waits for `ready` (cache and settings loaded) before rendering. The panel inputs are filled in only once, when the panel is created.

### DOM

- Cards are found with `[data-testid^="product-item-id-"]`, and the grid cell with `closest('[data-testid="grid-item"]')`. The badge goes inside `[class*="image-container"]`.
- `apply()` runs from `requestAnimationFrame` (`schedule()`), triggered by a MutationObserver, scroll, and new data. It only writes to the DOM when a value has changed, and the observer ignores the extension's own nodes, so its writes don't retrigger it.
- All CSS classes and message types use the `vlf` prefix.

Vinted's markup, its inline data format and its internal endpoints can change without notice. When something breaks, check those first.
