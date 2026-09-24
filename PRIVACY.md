# Privacy Policy: Vinted Country Filter

Effective: 24 September 2026

Vinted Country Filter ("the extension") is a browser extension that shows the
country of each seller on Vinted listing pages, can dim or hide listings from sellers outside
the country you choose, and can show a listing's photos in a viewer. It is not affiliated with, endorsed by, or connected to Vinted.

## Summary

- The extension does not collect, sell or share any personal data.
- It sends nothing to the developer or to any third party. It has no analytics, tracking or ads.
- All data it uses stays in your browser.

## What the extension reads

When you open a page on a Vinted website, the extension reads the listings shown on that page
to find each listing's ID, its seller's Vinted user ID, and the link to its main photo. It does
this only on Vinted domains (for example vinted.ie or vinted.fr) and on no other websites.

## Requests it makes

To find out where a seller is based, the extension asks the Vinted website you are browsing for
that seller's public profile, the same profile anyone can see on Vinted. From the reply, it keeps
only the seller's country and, if the seller has made it public, their city.

When you click a listing's "View photos" button, the extension loads that listing's page from
the Vinted website to find the links to its other photos, and shows them. This happens only when
you click the button, and nothing from the listing's page is stored.

These requests go only to the Vinted website you are on, directly from your browser, in the same
way the Vinted site itself loads data. Your browser sends its usual Vinted cookies with them, as
it does for any request to that site. The extension never reads, stores or transmits those
cookies, your Vinted account details, or your messages or purchases.

## What it stores, and where

The extension stores two things, both using your browser's built-in extension storage:

1. **Seller lookup cache (on your device only).** For each seller it has looked up, it keeps the
   Vinted user ID, country, country name, city (if public), and the time of the lookup. This
   avoids asking Vinted for the same seller twice. Entries are discarded after 90 days.
2. **Your settings.** These are your chosen country, whether the filter is on, whether other
   listings are shown, dimmed or hidden, whether sellers with an unknown country are filtered,
   and whether the on-page panel is collapsed. They are stored with your browser's "sync"
   storage. If you have turned on sync in your browser, the browser may copy these settings to
   your other devices through your browser account (for Chrome, your Google account). The
   developer has no access to them.

## What it does not do

- It does not collect your name, email address, location, browsing history or any other
  personal information.
- It does not run on any website other than Vinted's.
- It does not send data to the developer or any other server.
- It does not use data to create profiles, show ads, or determine creditworthiness.
- It does not load or run code from outside the extension.

## Removing your data

Uninstalling the extension deletes its seller lookup cache and its settings from your browser.

## Changes to this policy

If this policy changes, the updated version will be published at this page with a new effective
date.

## Contact

Questions about this policy can be raised as an issue at
https://github.com/bgallagher/vinted-country-filter/issues
