# Vinted Country Filter

Chrome/Edge/Brave extension that adds a country badge (e.g. `🇮🇪 IE`, `🇫🇷 FR`) to every
Vinted listing and lets you dim or hide items from sellers outside your country.

## Install (unpacked)
1. Open `chrome://extensions`, turn on **Developer mode**.
2. **Load unpacked** → select this folder.
3. Open any Vinted search. A "Seller location" panel appears bottom-right; pick your country there.

## Using it
- **On/off switch** (in the panel header and the popup): turn the filter off to stop checking
  sellers and remove all badges and dimming. Turn it back on and everything returns, with sellers
  already looked up restored instantly from the cache.
- **My country**: the country whose sellers you want to keep. Defaults to the country of the
  Vinted site you're on (so `vinted.ie` → Ireland). Set it explicitly if you shop on another
  country's site, e.g. you live in Ireland but browse `vinted.fr`.
- **Other countries**: `Show (badge only)`, `Dim`, or `Hide` listings from sellers elsewhere.
- **Also filter unknown**: treat sellers whose country couldn't be read as "other".
- Hover a badge to see the seller's city (when they've made it public).

The same settings open in a popup when you click the extension's toolbar button (pin it from
Chrome's puzzle-piece menu to keep it visible). On a Vinted search, the popup also shows how many
listings on the page are shown and how many are still loading. Changes apply to open Vinted tabs
right away.

Badges: teal = your country, amber = another country, pulsing `…` = still looking up the seller,
`? –` = the seller's country isn't available.

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
