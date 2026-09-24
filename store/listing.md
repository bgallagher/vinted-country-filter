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

Don't list Vinted domains (vinted.ie, vinted.fr, …) in the description. The first submission was rejected for "keyword spam" over exactly that.

```
Avoid expensive international shipping on Vinted. This extension adds a flag badge showing each seller's country to every listing in your search results.

• Teal badge: the seller is in your country. Amber badge: they're somewhere else.
• Show, dim or hide listings from other countries.
• See all of a listing's photos full size in a viewer, without leaving the results.
• Your country defaults to the Vinted site you're on, or pick it yourself.
• Settings are in a small on-page panel and the toolbar button, with an on/off switch.

On a new search, badges on screen appear within seconds. The rest of the page takes a minute or two, because Vinted limits how fast seller details can be requested.

Runs only on Vinted. Sends no data anywhere, and has no tracking or ads.

Not affiliated with Vinted.
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
Improves browsing Vinted search results: shows each seller's country, dims or hides listings from sellers outside a country the user chooses, and previews a listing's photos without leaving the results.
```

(Updated for 0.6.0, which adds the photo viewer. 0.5.0 was submitted with: "Shows the country of each seller on Vinted listing pages, and lets the user dim or hide listings from sellers outside a country they choose.")

### Permission justifications

**storage**

```
Saves the user's settings (chosen country, filter on/off, show/dim/hide choice) and a local cache of seller countries, so the same seller isn't looked up again. Cache entries expire after 90 days. Nothing is sent off the device.
```

**Host permissions** (the Vinted sites listed in the content scripts)

```
The extension only works on Vinted websites. On these sites it reads the listings on the page to get each listing's seller ID, requests that seller's public Vinted profile from the same site to read their country, and adds a country badge and dimming/hiding to the page. When the user clicks "View photos" on a listing, it loads that listing's page from the same site to show its photos. It runs on no other websites.
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


