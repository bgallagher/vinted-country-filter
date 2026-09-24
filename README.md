# Vinted Seller Location Filter

Chrome/Edge/Brave extension that adds a country badge (e.g. `🇮🇪 IE`, `🇫🇷 FR`) to every
Vinted listing and lets you dim or hide items from sellers outside the countries you choose.

## Install (unpacked)
1. Open `chrome://extensions`, turn on **Developer mode**.
2. **Load unpacked** → select this folder.
3. Open any Vinted search. A "Seller location" panel appears bottom-right.

## Using it
- **Countries**: comma-separated ISO codes to keep, e.g. `IE` or `IE, GB`. Defaults to the
  country of the Vinted domain you're on.
- **Others**: `Show (badge only)`, `Dim`, or `Hide` listings from other countries.
- **Also filter unknown**: treat sellers whose country couldn't be read as "other".
- Hover a badge to see the seller's city (when they've made it public).

## How it works
Vinted's search results don't include seller location, only the seller's user ID.
- `inject.js` (page context) reads item → seller IDs from the server-rendered first page and
  from the `svc-catalogue/items` responses Vinted loads for later pages. It only reads
  responses and never changes them.
- `content.js` looks up each seller via `/api/v2/users/{id}` (`country_iso_code`), caches the
  result for 14 days in `chrome.storage.local`, and badges/filters the grid.

## Limits
- Vinted rate-limits user lookups to about 30 every 30 seconds. On a fresh search, badges
  fill in over a minute or two, with on-screen items first. Cached sellers show instantly.
- Hiding happens after Vinted has loaded a page, so a page of 96 results may shrink to a
  handful. Setting Vinted's own filters first (price, condition) helps.
- It depends on Vinted's current page structure and internal endpoints, which can change
  without notice.
