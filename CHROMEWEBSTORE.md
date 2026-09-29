# Chrome Web Store Listing — Vinted Country Filter

> Last Updated: 2026-09-29

Everything the Chrome Developer Dashboard asks for, ready to copy. Text in code blocks goes
into the dashboard as-is; the Web Store strips markdown, so it's written as plain text. This
file isn't part of the extension, and `scripts/build.sh` only packs `src/`.

## Store Listing

**Extension Name** [REQUIRED]

Taken from `src/manifest.json` (`name`), not typed in the dashboard (21/75 characters):

```
Vinted Country Filter
```

**Short Description** [REQUIRED]

Taken from `src/manifest.json` (`description`) (126/132 characters):

```
See each seller's country on Vinted and dim or hide listings from other countries, so you avoid costly international shipping.
```

**Detailed Description** [REQUIRED]

Don't list Vinted domains (vinted.ie, vinted.fr, …) in the description. The first submission
was rejected for "keyword spam" over exactly that.

```
Avoid expensive international shipping on Vinted. This extension adds a flag badge showing each seller's country to the listings you browse: search results, the home feed, seller promotions and a listing's similar items.

• Teal badge: the seller is in your country. Amber badge: they're somewhere else.
• Show, dim or hide listings from other countries.
• See all of a listing's photos full size in a viewer, without leaving the results.
• Your country defaults to the Vinted site you're on, or pick it yourself.
• Settings are in a small on-page panel and the toolbar button, with an on/off switch.

How to use it: open Vinted and search as usual. Badges appear on the listings, and the panel in the corner of the page lets you choose your country and whether other countries' listings are shown, dimmed or hidden. Click the magnifier on a listing's photo to see all its photos. The toolbar button has the same settings, and can hide the on-page panel.

On a new search, badges on screen appear within seconds. The rest of the page takes a minute or two, because Vinted limits how fast seller details can be requested. If Vinted asks it to slow down, the panel shows a countdown until it resumes.

Runs only on Vinted. Sends no data anywhere, and has no tracking or ads.

Questions or problems: https://github.com/bgallagher/vinted-country-filter/issues

Not affiliated with Vinted.
```

(The "How to use it" and "Questions or problems" paragraphs are new since the last submission,
following the store's recommended structure. Everything else is as submitted.)

**Category** [REQUIRED]

```
Shopping
```

**Single Purpose** [REQUIRED]

```
Improves browsing Vinted listings: shows each seller's country, dims or hides listings from sellers outside a country the user chooses, and previews a listing's photos without leaving the results.
```

(Updated for 0.6.0, which added the photo viewer. 0.5.0 was submitted with: "Shows the
country of each seller on Vinted listing pages, and lets the user dim or hide listings from
sellers outside a country they choose.")

**Primary Language** [REQUIRED]

```
English
```

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `src/icons/icon128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 or 640×400 | ⬜ Not in repo | |
| Screenshot 2 [RECOMMENDED] | 1280×800 or 640×400 | ⬜ Not in repo | |
| Screenshot 3 [RECOMMENDED] | 1280×800 or 640×400 | ⬜ Not in repo | |
| Screenshot 4 | 1280×800 or 640×400 | ⬜ Not created | |
| Screenshot 5 | 1280×800 or 640×400 | ⬜ Not created | |
| Small Promo Tile [RECOMMENDED] | 440×280 | ⬜ Not in repo | |
| Marquee Promo Tile | 1400×560 | ⬜ Not created | |

The README's screenshots in `docs/screenshots/` are the wrong sizes for the store
(`search.png` is 1600×689, the popup shots 600×888). If store screenshots were uploaded
before, they aren't in the repo: save them in `docs/store/` so they can be kept up to date.

### Screenshot Notes

Take them on real Vinted pages:

1. A search results page in Dim mode, with teal and amber badges and the panel open.
2. The same search in Hide mode.
3. The toolbar popup open over a Vinted page, showing the "this page" counts.
4. The photo viewer open over search results.

🟡 Since 0.7.0 badges also appear on the home feed, seller promotions and listing pages, and
0.8.0 changed the panel's look and added "Hide panel": check any existing screenshots still
match.

## Permissions Justification

The extension declares no `host_permissions`. Its site access comes from the content
scripts' `matches` in `src/manifest.json` (the 26 Vinted sites), which the dashboard asks
about as host permissions.

| Permission | Type | Justification |
|------------|------|---------------|
| `storage` | permissions | See below |
| Vinted sites (content script matches) | host_permissions | See below |

**storage**

```
Saves the user's settings (chosen country, filter on/off, show/dim/hide choice) and a local cache of seller countries, so the same seller isn't looked up again. Cache entries expire after 90 days. Nothing is sent off the device.
```

**Host permissions**

```
The extension only works on Vinted websites. On these sites it reads the listings on the page to get each listing's seller ID, requests that seller's public Vinted profile from the same site to read their country, and adds a country badge and dimming/hiding to the page. When the user clicks "View photos" on a listing, it loads that listing's page from the same site to show its photos. It runs on no other websites.
```

**Are you using remote code?**

```
No, I am not using remote code.
```

All JavaScript is packaged in the extension. It loads no external scripts and uses no eval.

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** Yes: website content only, kept on the device.

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | No | | | |
| Health info | No | | | |
| Financial info | No | | | |
| Authentication info | No | | | |
| Personal communications | No | | | |
| Location | No | | | |
| Web history | No | | | |
| User activity | No | | | |
| Website content | Yes | No | Listing and seller IDs read from Vinted pages, and sellers' public country and city from their Vinted profiles, to badge and filter listings. Cached in the browser only. | No |

In the dashboard, tick only **Website content**:

```
The extension reads listing information (listing IDs and seller IDs) from Vinted pages the user visits, and the public country/city from Vinted seller profiles. It is processed and cached only in the user's browser.
```

The requests for seller profiles and listing pages go to the Vinted site the user is on, as
the page's own requests would. Nothing goes to the developer or anyone else.

### Data Use Certification

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

## Privacy Policy

**Privacy Policy URL** [REQUIRED]

```
https://github.com/bgallagher/vinted-country-filter/blob/main/PRIVACY.md
```

Keep `PRIVACY.md` in step with the data use answers above.

## Distribution

**Visibility**: Public (check in the dashboard)
**Regions**: All regions. The listing is in English; the extension works on every Vinted site.

## Developer Info

**Publisher Name** [REQUIRED]
<!-- Fill in from the dashboard's Account tab. -->

**Contact Email** [REQUIRED]
<!-- Displayed publicly on the store listing. Fill in from the dashboard's Account tab. -->

**Support URL** [RECOMMENDED]

```
https://github.com/bgallagher/vinted-country-filter/issues
```

**Homepage URL** [RECOMMENDED]

```
https://github.com/bgallagher/vinted-country-filter
```

## Version History

Versions come from the git tags. The Status column records what happened in the Web Store;
fill it in from the dashboard where it says "not recorded".

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 0.8.1 | 2026-09-29 | No user-facing changes: the extension is the same as 0.8.0. Released on GitHub only, to check the release pipeline after the repo's reorganisation (tests, tooling, `src/` layout). | Not uploaded (GitHub release only) |
| 0.8.0 | 2026-09-26 | Seller lookups share one pace across all Vinted tabs and recover by themselves after Vinted slows them down; fewer "limiting lookups" pauses on a first search. The on-page panel can be hidden (bring it back from the toolbar button). Refreshed panel and photo viewer. | Not recorded |
| 0.7.0 | 2026-09-25 | Badges on the home feed, seller promotions and listing pages, not just search. Countdown when Vinted limits lookups. | Not recorded |
| 0.6.0 | 2026-09-24 | Photo viewer: all of a listing's photos, full size, without leaving the results. Faster seller lookups. Single purpose updated. | Not recorded |
| 0.5.0 | 2026-09-24 | First submission. | Rejected ("keyword spam": Vinted domains listed in the description), then fixed |

## Review Notes

### Known Issues / Limitations

- Badges below the fold can take a minute or two on a new search: Vinted rate-limits the
  public profile lookups, and the extension paces itself to stay under the limit.
- Windows doesn't draw flag emoji; badges there show the two-letter country code instead.
- Relies on Vinted's page markup and data. If Vinted changes them, badges may stop appearing
  until an update.

### Rejection History

| Date | Reason | Fix Applied | Resubmitted |
|------|--------|-------------|-------------|
| 2026-09-24 (not recorded exactly) | Keyword spam: the description listed Vinted's domains | Removed the domain list from the description | Yes |
