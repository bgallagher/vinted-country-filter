// The photo button and lightbox: opening, parsing the listing page's photos,
// caching, navigation and closing.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeResponse, sellers } from "./helpers/env.js";
import { lookupPage } from "./helpers/lookups.js";
import { f800, itemPage, flightScript } from "./helpers/fixtures.js";

// A page whose item pages come from `pages`: itemId -> html, a status, or a
// function returning the response.
async function photoPage({ pages = {}, ...opts } = {}) {
  const lookups = sellers();
  const page = await lookupPage({
    n: 2,
    ...opts,
    fetch: (url) => {
      const m = url.match(/\/items\/(\d+)/);
      if (!m) return lookups(url);
      const p = pages[m[1]];
      if (typeof p === "function") return p();
      return typeof p === "number" ? new FakeResponse("", { status: p }) : new FakeResponse(p ?? itemPage(m[1]));
    },
  });
  await page.tick(1000);
  return page;
}

const zoom = (page, i = 0) => page.cards[i].box.querySelector(".vlf-zoom");
const box = (page) => page.shadow().querySelector("dialog.lightbox");
const img = (page) => box(page).querySelector(".lb-img");
const count = (page) => box(page).querySelector(".lb-count").textContent;
const itemFetches = (page) => page.fetchCalls.filter((c) => c.url.includes("/items/"));
const key = (page, k) => box(page).dispatchEvent(new page.window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

async function open(page, i = 0) {
  const ev = new page.window.MouseEvent("click", { bubbles: true, cancelable: true });
  const notCancelled = zoom(page, i).dispatchEvent(ev);
  await page.tick(0);
  return { cancelled: !notCancelled };
}

describe("opening", () => {
  test("the photo button opens the lightbox instead of the listing", async () => {
    const page = await photoPage();
    let reachedCard = false;
    page.cards[0].el.addEventListener("click", () => { reachedCard = true; });
    const { cancelled } = await open(page);
    assert.ok(cancelled, "default prevented");
    assert.ok(!reachedCard, "the card's handlers never see the click");
    assert.ok(box(page).open);
    assert.equal(page.document.documentElement.style.overflow, "hidden");
  });

  test("starts with inject.js's f800 photo, else the card's image", async () => {
    const page = await photoPage({ pages: { 1: 404, 2: 404 } });
    page.owners([["1", "u1", f800("from-inject")]]);
    await page.tick(50);
    await open(page, 0);
    assert.equal(img(page).getAttribute("src"), f800("from-inject"));
    box(page).close();
    await open(page, 1);
    assert.equal(img(page).getAttribute("src"), page.cards[1].box.querySelector("img").src);
  });

  test("loads the rest from the listing's own page", async () => {
    let release;
    const page = await photoPage({ pages: { 1: () => new Promise((r) => { release = () => r(new FakeResponse(itemPage(1))); }) } });
    await open(page);
    assert.equal(count(page), "Loading more photos…");
    release();
    await page.tick(10);
    assert.deepEqual(itemFetches(page).map((c) => c.url), ["https://www.vinted.ie/items/1-some-item"]);
    assert.equal(count(page), "1 / 3");
    assert.equal(img(page).getAttribute("src"), f800("1-0"));
    assert.equal(img(page).alt, "Photo 1 of 3");
  });

  test("stays on the photo already showing", async () => {
    const page = await photoPage();
    page.owners([["1", "u1", f800("1-2")]]); // inject.js had the third one
    await page.tick(50);
    await open(page);
    await page.tick(10);
    assert.equal(count(page), "3 / 3");
  });
});

describe("parsing the listing page", () => {
  const photosOf = async (html) => {
    const page = await photoPage({ pages: { 1: html } });
    await open(page);
    await page.tick(10);
    const shown = [];
    const n = Number(count(page).split(" / ")[1]) || 0;
    for (let i = 0; i < n; i++) { shown.push(img(page).getAttribute("src")); key(page, "ArrowRight"); }
    return shown;
  };

  test("takes each photo's f800 URL in order, skipping the seller's picture", async () => {
    assert.deepEqual(await photosOf(itemPage(1, 4)), [f800("1-0"), f800("1-1"), f800("1-2"), f800("1-3")]);
  });

  test("ignores brackets, braces and quotes in the listing's other fields", async () => {
    const tricky = itemPage(1, 2, { extra: 'tail ] } " \\" [ {' });
    assert.deepEqual(await photosOf(tricky), [f800("1-0"), f800("1-1")]);
  });

  test("skips escaped quotes, brackets and braces inside the array's strings", async () => {
    // After parsePhotos unescapes \" once, this caption reads "a \" ] } b":
    // valid JSON, but a close bracket for a scanner that ignores escapes.
    const html = String.raw`<script>"photos":[{"caption":"a \\" ] } b","thumbnails":[{"url":"${f800("x")}"}]}],"n":1</script><img src="${f800("avatar")}">`;
    assert.deepEqual(await photosOf(html), [f800("x")]);
  });

  test("falls back to full_size_url, then url, when a photo has no f800", async () => {
    const data = { photos: [{ full_size_url: "https://x/full-a.webp" }, { url: "https://x/plain-b.webp" }, { thumbnails: [] }] };
    assert.deepEqual(await photosOf(`<script>${flightScript(JSON.stringify(data))}</script>`), ["https://x/full-a.webp", "https://x/plain-b.webp"]);
  });

  test("without a photos array, uses the distinct f800 URLs on the page", async () => {
    const html = `<img src="${f800("a")}"><img src="${f800("b")}"><img src="${f800("a")}">`;
    assert.deepEqual(await photosOf(html), [f800("a"), f800("b")]);
  });

  test("a broken photos array falls back too", async () => {
    const html = `<script>${flightScript('{"photos":[{"thumbnails":[{"url":"' + f800("x") + '"')}</script>`;
    assert.deepEqual(await photosOf(html), [f800("x")]);
  });
});

describe("caching", () => {
  test("a second open uses the photos already loaded", async () => {
    const page = await photoPage();
    await open(page);
    await page.tick(10);
    box(page).close();
    await open(page);
    await page.tick(10);
    assert.equal(itemFetches(page).length, 1);
    assert.equal(count(page), "1 / 3");
  });

  test("a failed load is tried again next time", async () => {
    const pages = { 1: 500 };
    const page = await photoPage({ pages });
    await open(page);
    await page.tick(10);
    assert.equal(count(page), "1 / 1"); // just the card's image
    box(page).close();
    delete pages[1];
    await open(page);
    await page.tick(10);
    assert.equal(itemFetches(page).length, 2);
    assert.equal(count(page), "1 / 3");
  });

  test("says so when there are no photos at all", async () => {
    const page = await photoPage({ pages: { 1: 404 } });
    page.cards[0].box.querySelector("img").remove();
    await open(page);
    await page.tick(10);
    assert.equal(count(page), "No photos found");
  });
});

describe("navigating", () => {
  test("arrow keys and buttons step through the photos, wrapping around", async () => {
    const page = await photoPage();
    await open(page);
    await page.tick(10);
    const prev = box(page).querySelector(".lb-prev"), next = box(page).querySelector(".lb-next");
    assert.ok(!prev.hidden && !next.hidden);
    key(page, "ArrowLeft");
    assert.equal(count(page), "3 / 3");
    key(page, "ArrowRight");
    assert.equal(count(page), "1 / 3");
    next.click();
    next.click();
    assert.equal(count(page), "3 / 3");
    prev.click();
    assert.equal(count(page), "2 / 3");
    assert.equal(img(page).getAttribute("src"), f800("1-1"));
  });

  test("hides the arrows for a single photo", async () => {
    const page = await photoPage({ pages: { 1: itemPage(1, 1) } });
    await open(page);
    await page.tick(10);
    for (const b of box(page).querySelectorAll(".lb-nav")) assert.ok(b.hidden);
    key(page, "ArrowRight");
    assert.equal(count(page), "1 / 1");
  });

  test("links to the listing", async () => {
    const page = await photoPage();
    await open(page);
    assert.equal(box(page).querySelector(".lb-link").href, "https://www.vinted.ie/items/1-some-item");
  });
});

describe("closing", () => {
  test("restores page scrolling and focus, and removes the dialog", async () => {
    const page = await photoPage();
    page.document.documentElement.style.overflow = "scroll";
    zoom(page).focus();
    await open(page);
    box(page).querySelector(".lb-close").click();
    await page.tick(0);
    assert.equal(box(page), null);
    assert.equal(page.document.documentElement.style.overflow, "scroll");
    assert.equal(page.document.activeElement, zoom(page));
  });

  test("a late photo list for a closed lightbox is ignored", async () => {
    const page = await photoPage();
    await open(page);
    box(page).close();
    await page.tick(10);
    assert.equal(box(page), null);
    assert.deepEqual(page.errors, []);
  });

  test("closes when the filter is switched off", async () => {
    const page = await photoPage();
    await open(page);
    await page.chrome.setFromElsewhere("sync", { settings: { enabled: false } });
    await page.tick(50);
    assert.equal(box(page), null);
    assert.equal(page.document.documentElement.style.overflow, "");
  });

  test("opening another listing replaces the lightbox", async () => {
    const page = await photoPage();
    await open(page, 0);
    await open(page, 1);
    await page.tick(10);
    assert.equal(page.shadow().querySelectorAll("dialog").length, 1);
    assert.equal(img(page).getAttribute("src"), f800("2-0"));
  });
});
