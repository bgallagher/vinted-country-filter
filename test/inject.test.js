import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { makePage, json, FakeResponse } from "./helpers/env.js";
import * as fx from "./helpers/fixtures.js";

// Loads inject.js into a page and records what it posts to content.js.
// `scripts` are inline flight scripts in the page. `xhr` answers XHRs by URL.
function injectPage({ scripts = [], fetch, xhr = () => null } = {}) {
  const html = `<!doctype html><html><head>${scripts.map((s) => `<script>${s}</script>`).join("")}</head><body></body></html>`;
  const page = makePage({ html, fetch });
  const { window } = page;
  class FakeXHR extends window.EventTarget {
    constructor() { super(); this.responseType = ""; }
    open(method, url) { this.url = url; }
    send() {
      const body = xhr(this.url);
      window.setTimeout(() => {
        if (this.responseType === "json") this.response = body;
        else this.responseText = typeof body === "string" ? body : JSON.stringify(body);
        this.dispatchEvent(new window.Event("load"));
      }, 0);
    }
  }
  window.XMLHttpRequest = FakeXHR;
  page.posts = [];
  window.addEventListener("message", (e) => { if (e.data && e.data.type === "vlf:owners") page.posts.push(e.data.pairs); });
  page.load("inject.js");
  // Plain arrays from the page's realm, for deepEqual.
  page.pairs = () => JSON.parse(JSON.stringify(page.posts.flat()));
  // jsdom fires DOMContentLoaded on its own, after the constructor returns,
  // just as inject.js (at document_start) would see it.
  page.domReady = () => new Promise((resolve) => {
    if (page.document.readyState !== "loading") resolve();
    else page.document.addEventListener("DOMContentLoaded", resolve);
  });
  page.xhr = (url, responseType = "") => {
    const x = new window.XMLHttpRequest();
    x.open("GET", url);
    x.responseType = responseType;
    x.send();
  };
  return page;
}

const apiFetch = (routes) => (url) => {
  for (const [re, body] of routes) if (re.test(url)) return typeof body === "function" ? body(url) : json(body);
  return new FakeResponse("", { status: 404 });
};

describe("server-rendered pages", () => {
  test("search page 1: item, owner and f800 photo from the flight data", async () => {
    const page = injectPage({ scripts: [fx.searchFlight] });
    await page.domReady();
    await page.tick(10);
    assert.deepEqual(page.pairs(), [
      ["101", "201", fx.f800(101)],
      ["102", "202", fx.f800(102)],
      ["104", "204", ""],
    ]);
  });

  test("an item without an owner doesn't take the next item's", async () => {
    const page = injectPage({ scripts: [fx.searchFlight] });
    await page.domReady();
    await page.tick(10);
    assert.ok(!page.pairs().some(([i]) => i === "103"));
  });

  test("home feed: entities with numeric or string ids, never a closet's seller", async () => {
    const page = injectPage({ scripts: [fx.homeFlight] });
    await page.domReady();
    await page.tick(10);
    assert.deepEqual(page.pairs(), [["301", "401", ""], ["302", "402", ""]]);
  });

  test("scripts without listings post nothing", async () => {
    const page = injectPage({ scripts: ["self.__next_f.push([1,\"nothing here\"])", ""] });
    await page.domReady();
    await page.tick(10);
    assert.deepEqual(page.posts, []);
  });
});

describe("fetch hook", () => {
  const routes = [
    [/svc-catalogue/, fx.catalogue],
    [/homepage/, fx.homepage],
    [/promoted_closets/, fx.promotedClosets],
    [/item-details\/more-items/, fx.moreItems],
    [/wardrobe/, fx.wardrobe],
    [/feedback/, fx.feedback],
    [/deep\/items/, fx.deep],
    [/\/api\/v2\/users\//, { user: { id: 1, items: [{ id: 2, user: { id: 3 } }] } }],
    [/rsc/, () => new FakeResponse(fx.searchFlight, { headers: { "content-type": "text/x-component" } })],
    [/html\/items/, () => new FakeResponse('{"items":[{"id":1,"user":{"id":2}}]}', { headers: { "content-type": "text/html" } })],
    [/broken\/catalog/, () => new FakeResponse('{"user": not json', { headers: { "content-type": "application/json" } })],
  ];
  const fetched = async (url) => {
    const page = injectPage({ fetch: apiFetch(routes) });
    await page.window.fetch(url);
    await page.tick(10);
    return page.pairs();
  };

  test("catalogue pages: user.id, and the f800 photo first", async () => {
    assert.deepEqual(await fetched("https://api.vinted.ie/svc-catalogue/items?page=2"), [
      ["501", "601", fx.f800(501)],
      ["502", "602", "full-502"],
      ["503", "603", "url-503"],
      ["504", "604", ""],
    ]);
  });

  test("home 'load more': string user_id", async () => {
    assert.deepEqual(await fetched("https://api.vinted.ie/homepage/homepage"), [["511", "611", "url-511"]]);
  });

  test("promoted closets", async () => {
    assert.deepEqual(await fetched("/api/v2/promoted_closets?page=1"), [["521", "621", "url-521"]]);
  });

  test("listing page rails: user_id with an /items/ URL", async () => {
    assert.deepEqual(await fetched("https://api.vinted.ie/item-details/more-items/9"), [["531", "631", ""]]);
  });

  test("profile wardrobes", async () => {
    assert.deepEqual(await fetched("/api/v2/wardrobe/641/items"), [["541", "641", ""]]);
  });

  test("ignores user_id on objects that aren't listings", async () => {
    assert.deepEqual(await fetched("/api/v2/items/5/feedback"), []);
  });

  test("stops walking past depth 8", async () => {
    assert.deepEqual(await fetched("/api/v2/deep/items"), []);
  });

  test("ignores endpoints it has no reason to read", async () => {
    assert.deepEqual(await fetched("/api/v2/users/1"), []);
  });

  test("ignores non-JSON and malformed JSON", async () => {
    assert.deepEqual(await fetched("/html/items"), []);
    assert.deepEqual(await fetched("/broken/catalog"), []);
  });

  test("scans Next.js RSC (text/x-component) navigations", async () => {
    const pairs = await fetched("/catalog?_rsc=abc&rsc=1");
    assert.deepEqual(pairs.map(([i, u]) => [i, u]), [["101", "201"], ["102", "202"], ["104", "204"]]);
  });

  test("hands the page its own response, untouched", async () => {
    const res = json(fx.catalogue);
    const page = injectPage({ fetch: () => res });
    assert.equal(await page.window.fetch("https://api.vinted.ie/svc-catalogue/items"), res);
  });

  test("passes Request objects and fetch errors through", async () => {
    const page = injectPage({ fetch: apiFetch(routes) });
    await page.window.fetch({ url: "https://api.vinted.ie/svc-catalogue/items" });
    await page.tick(10);
    assert.equal(page.pairs().length, 4);
    const failing = injectPage();
    await assert.rejects(failing.window.fetch("/api/v2/wardrobe/1/items"), /Failed to fetch/);
  });
});

describe("XHR hook", () => {
  const xhr = (url) => (/svc-catalogue/.test(url) ? fx.catalogue : { items: [{ id: 1, user: { id: 2 } }] });

  test("reads JSON responses", async () => {
    const page = injectPage({ xhr });
    page.xhr("https://api.vinted.ie/svc-catalogue/items?page=3", "json");
    await page.tick(10);
    assert.equal(page.pairs().length, 4);
  });

  test("reads text responses", async () => {
    for (const type of ["", "text"]) {
      const page = injectPage({ xhr });
      page.xhr("https://api.vinted.ie/svc-catalogue/items?page=3", type);
      await page.tick(10);
      assert.equal(page.pairs().length, 4, `responseType "${type}"`);
    }
  });

  test("ignores endpoints it has no reason to read", async () => {
    const page = injectPage({ xhr });
    page.xhr("/api/v2/notifications", "json");
    await page.tick(10);
    assert.deepEqual(page.posts, []);
  });
});

describe("posting to content.js", () => {
  const once = (body) => apiFetch([[/wardrobe/, body]]);

  test("doesn't post a pair it has already posted", async () => {
    const page = injectPage({ fetch: once(fx.catalogue), scripts: [] });
    await page.window.fetch("/api/v2/wardrobe/1/items");
    await page.window.fetch("/api/v2/wardrobe/1/items");
    await page.tick(10);
    assert.equal(page.posts.length, 1);
  });

  test("posts again when a photo turns up later, and keeps a known photo", async () => {
    let body = { items: [{ id: 1, user: { id: 2 } }] };
    const page = injectPage({ fetch: () => json(body) });
    await page.window.fetch("/api/v2/wardrobe/1/items");
    await page.tick(10);
    body = { items: [{ id: 1, user: { id: 2 }, photo: { url: "later.webp" } }] };
    await page.window.fetch("/api/v2/wardrobe/1/items");
    await page.tick(10);
    body = { items: [{ id: 1, user: { id: 2 } }] };
    await page.window.fetch("/api/v2/wardrobe/1/items");
    await page.tick(10);
    assert.deepEqual(page.pairs(), [["1", "2", ""], ["1", "2", "later.webp"]]);
  });

  test("posts again when an item's owner changes, keeping its photo", async () => {
    let body = { items: [{ id: 1, user: { id: 2 }, photo: { url: "p.webp" } }] };
    const page = injectPage({ fetch: () => json(body) });
    await page.window.fetch("/api/v2/wardrobe/1/items");
    body = { items: [{ id: 1, user: { id: 3 } }] };
    await page.window.fetch("/api/v2/wardrobe/1/items");
    await page.tick(10);
    assert.deepEqual(page.pairs(), [["1", "2", "p.webp"], ["1", "3", "p.webp"]]);
  });

  test("vlf:rescan re-sends everything known", async () => {
    const page = injectPage({ scripts: [fx.searchFlight], fetch: once(fx.wardrobe) });
    await page.domReady();
    await page.window.fetch("/api/v2/wardrobe/1/items");
    await page.tick(10);
    page.posts.length = 0;
    page.window.postMessage({ type: "vlf:rescan" });
    await page.tick(10);
    assert.deepEqual(page.pairs().sort(), [
      ["101", "201", fx.f800(101)], ["102", "202", fx.f800(102)], ["104", "204", ""], ["541", "641", ""],
    ].sort());
  });

  test("ignores messages from other windows", async () => {
    const page = injectPage({ fetch: once(fx.wardrobe) });
    await page.window.fetch("/api/v2/wardrobe/1/items");
    await page.tick(10);
    page.posts.length = 0;
    page.window.dispatchEvent(new page.window.MessageEvent("message", { data: { type: "vlf:rescan" }, source: null }));
    await page.tick(10);
    assert.deepEqual(page.posts, []);
  });

  test("a second copy of the script does nothing", async () => {
    const page = injectPage({ fetch: once(fx.wardrobe) });
    const hooked = page.window.fetch;
    page.load("inject.js");
    assert.equal(page.window.fetch, hooked);
    await page.window.fetch("/api/v2/wardrobe/1/items");
    await page.tick(10);
    assert.equal(page.posts.length, 1);
  });

  test("posts to its own origin only", async () => {
    const page = injectPage({ fetch: once(fx.wardrobe) });
    const targets = [];
    const post = page.window.postMessage;
    page.window.postMessage = (data, origin) => { targets.push(origin); post(data, origin); };
    await page.window.fetch("/api/v2/wardrobe/1/items");
    await page.tick(10);
    assert.deepEqual(targets, ["https://www.vinted.ie"]);
  });
});
