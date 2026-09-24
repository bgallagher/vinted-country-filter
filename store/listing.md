# Chrome Web Store submission text

Copy each section into the matching field in the Developer Dashboard. This folder is not part
of the extension; leave it out of the upload zip.

---

## Store listing tab

### Name

Taken from `manifest.json` (`name`), not typed in the dashboard:

```
Vinted Country Filter
```

### Summary

Taken from `manifest.json` (`description`), 132 characters max:

```
See each seller's country on Vinted and dim or hide listings from other countries, so you avoid costly international shipping.
```

### Description

```
Shipping from another country can cost several times more than shipping from a seller at home. Vinted doesn't show where a seller is based until you open each listing. This extension shows it on every listing in your search results, and can move the rest out of your way.

WHAT IT DOES
• Adds a country badge with a flag to every listing, e.g. 🇮🇪 IE or 🇫🇷 FR
• Teal badge = a seller in your country. Amber badge = a seller elsewhere.
• Choose what happens to listings from other countries: show them (badge only), dim them, or hide them.
• Hover over a badge to see the seller's city, when they've made it public.
• Optionally filter out sellers whose country can't be determined.
• An on/off switch: when it's off, all badges and filtering are removed until you turn it back on.

EASY TO USE
• Works out of the box. Your country defaults to the Vinted site you're on (vinted.ie → Ireland, vinted.fr → France, and so on).
• Shopping on another country's Vinted site? Pick your own country from the list.
• Change settings from the small panel on Vinted pages or from the toolbar button. The toolbar popup also shows how many listings on the current page are shown.
• Light and dark mode.

WORKS ON
All Vinted websites in Europe, including vinted.ie, vinted.co.uk, vinted.fr, vinted.de, vinted.es, vinted.it, vinted.nl, vinted.be, vinted.pl, vinted.pt and more.

GOOD TO KNOW
• Vinted limits how quickly seller details can be requested. On a new search, badges fill in over a minute or two, with the listings on screen first. Sellers you've seen before appear instantly.
• Hiding happens after Vinted has loaded a page, so a page of results may shrink to a handful. Using Vinted's own filters (price, size, condition) first helps.
• Vinted can change its website at any time, which may temporarily stop the extension from working.

PRIVACY
The extension runs only on Vinted websites. It sends nothing to the developer or anyone else, and has no analytics, tracking or ads. Seller countries are cached in your browser for 14 days.

This extension is independent and is not affiliated with, endorsed by, or connected to Vinted.
```

### Category

```
Shopping
```

### Language

```
English
```

### Graphic assets (you provide these)

- Store icon 128×128: `icons/icon128.png` (already in the repo)
- At least 1 screenshot, 1280×800 or 640×400, taken on real Vinted pages. Suggested shots:
  1. A search results page in Dim mode with teal and amber badges and the panel open
  2. The same search in Hide mode
  3. The toolbar popup open over a Vinted page
- Small promo tile, 440×280

---

## Privacy tab

### Single purpose description

```
Shows the country of each seller on Vinted listing pages, and lets the user dim or hide listings from sellers outside a country they choose.
```

### Permission justifications

**storage**

```
Saves the user's settings (chosen country, filter on/off, show/dim/hide choice) and a local cache of seller countries, so the same seller isn't looked up again. Cache entries expire after 14 days. Nothing is sent off the device.
```

**Host permissions** (the Vinted sites listed in the content scripts)

```
The extension only works on Vinted websites. On these sites it reads the listings on the page to get each listing's seller ID, requests that seller's public Vinted profile from the same site to read their country, and adds a country badge and dimming/hiding to the page. It runs on no other websites.
```

### Are you using remote code?

```
No, I am not using remote code.
```

All JavaScript is packaged in the extension. It loads no external scripts and uses no eval.

### Data usage

Which user data does the extension collect? Tick:

- [x] **Website content**. The extension reads listing information (listing IDs and seller IDs) from Vinted pages the user visits, and the public country/city from Vinted seller profiles. It is processed and cached only in the user's browser.

Leave everything else unticked. It collects no personally identifiable information, health, financial, authentication, personal communications, location, web history or user activity data about the user.

Tick all three certifications:

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

### Privacy policy URL

```
https://github.com/bgallagher/vinted-country-filter/blob/main/PRIVACY.md
```

(This link works once `PRIVACY.md` is pushed to `main`.)
