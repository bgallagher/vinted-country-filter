// Loads the extension's real scripts into a jsdom page with a fake clock,
// fake chrome.* and a routed fetch. Nothing in the shipped code is changed
// for tests: they drive it through postMessage, the DOM, chrome.* and fetch.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { JSDOM, VirtualConsole } from "jsdom";
import FakeTimers from "@sinonjs/fake-timers";
import { makeChrome } from "./chrome.js";

export const ROOT = path.resolve(import.meta.dirname, "..", "..");
// The extension itself: what gets loaded unpacked and zipped.
export const SRC = path.join(ROOT, "src");
// A real epoch, not 0: relaxRate() treats relaxedAt = 0 as "never".
export const T0 = Date.parse("2026-09-29T10:00:00Z");

const sources = new Map();
const source = (file) => {
  if (!sources.has(file)) sources.set(file, new vm.Script(fs.readFileSync(path.join(SRC, file), "utf8"), { filename: path.join(SRC, file) }));
  return sources.get(file);
};

// A minimal fetch Response. Node's own Response reads bodies through streams
// on the real event loop, which the fake clock can't drive.
export class FakeResponse {
  constructor(body = "", { status = 200, headers = {} } = {}) {
    this.body = typeof body === "string" ? body : JSON.stringify(body);
    this.status = status;
    this.ok = status >= 200 && status < 300;
    const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
    if (!h["content-type"]) h["content-type"] = typeof body === "string" ? "text/html" : "application/json";
    this.headers = { get: (k) => h[k.toLowerCase()] ?? null };
  }
  async text() { return this.body; }
  async json() { return JSON.parse(this.body); }
  clone() { return this; }
}

export const json = (body, init) => new FakeResponse(body, init);

// A shared localStorage stand-in, for two pages on the same Vinted site.
export function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

// Options:
//   url      page URL (the site's TLD sets content.js's home country)
//   html     starting document
//   chrome   a makeChrome() to share between pages; else a fresh one
//   storage  a makeStorage() to share between pages; else jsdom's own
//   clock    an existing fake clock to share between pages
//   fetch    (url, init, page) => response or promise. Unhandled URLs throw
//            (like a network error). Extension files are served from SRC.
export function makePage({ url = "https://www.vinted.ie/catalog", html = "<!doctype html><html><head></head><body></body></html>", chrome, storage, clock, fetch, now = T0 } = {}) {
  // Errors thrown in the page's event handlers land here, not in the test.
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => errors.push(e));
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
  const window = dom.window;
  const ctx = dom.getInternalVMContext();

  const ownClock = !clock;
  // tickAsync yields to the real event loop between fake timers with the
  // window's setImmediate, else setTimeout (about 1ms each). jsdom has no
  // setImmediate: lend it Node's, or long simulations take minutes.
  window.setImmediate = setImmediate;
  clock = clock || FakeTimers.withGlobal(window).install({
    now,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "requestAnimationFrame", "cancelAnimationFrame"],
  });
  if (!ownClock) {
    // Share the other page's clock: route this window's timers to it.
    for (const k of ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame"]) window[k] = clock[k].bind(clock);
    window.Date = clock.Date;
  }

  chrome = chrome || makeChrome();
  window.chrome = chrome;
  if (storage) Object.defineProperty(window, "localStorage", { value: storage, configurable: true });

  // jsdom gaps.
  window.CSS = window.CSS || {};
  window.CSS.escape = window.CSS.escape || ((s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`));
  const Dialog = window.HTMLDialogElement.prototype;
  if (!Dialog.showModal) {
    Dialog.showModal = function () { this.setAttribute("open", ""); };
    Dialog.close = function () {
      if (!this.hasAttribute("open")) return;
      this.removeAttribute("open");
      this.dispatchEvent(new window.Event("close"));
    };
    Object.defineProperty(Dialog, "open", { get() { return this.hasAttribute("open"); }, configurable: true });
  }
  // jsdom's postMessage doesn't set event.source to the window, which both
  // scripts check. Deliver it as a later task, as a browser does.
  window.postMessage = (data) => {
    window.setTimeout(() => window.dispatchEvent(new window.MessageEvent("message", { data, source: window })), 0);
  };

  const fetchCalls = [];
  const page = {
    dom, window, document: window.document, chrome, clock, ctx, fetchCalls, errors,
    fetch: fetch || (() => { throw new TypeError("Failed to fetch"); }),
    // Runs extension files in the page, in order (like the manifest does).
    load(...files) { for (const f of files) source(f).runInContext(ctx); return page; },
    // Reads a top-level name from the loaded scripts (e.g. shared.js's).
    global(name) { return vm.runInContext(name, ctx); },
    // Posts owner pairs as inject.js does.
    owners(pairs) { window.postMessage({ type: "vlf:owners", pairs }); },
    // Advances the fake clock, running promise callbacks in between.
    tick(ms = 0) { return clock.tickAsync(ms); },
    // The reply is from the page's realm: copy it for deepEqual.
    async stats() { const r = await chrome.message({ type: "vlf:stats" }); return r && { ...r }; },
    shadow() { const h = window.document.getElementById("vlf-root"); return h && h.shadowRoot; },
    panel() { const s = page.shadow(); return s && s.querySelector(".panel"); },
    // Lookups of /api/v2/users/<id> started so far, in order.
    lookups() { return fetchCalls.filter((c) => c.url.startsWith("/api/v2/users/")); },
  };
  window.fetch = async (input, init) => {
    const u = typeof input === "string" ? input : input.url;
    if (u.startsWith("chrome-extension://")) {
      const file = path.join(SRC, u.replace(/^chrome-extension:\/\/[^/]+\//, ""));
      return new FakeResponse(fs.readFileSync(file, "utf8"), { headers: { "content-type": "text/css" } });
    }
    fetchCalls.push({ url: u, init, t: clock.now });
    return page.fetch(u, init, page);
  };
  return page;
}

// Loads shared.js + content.js the way the manifest does, and waits for
// content.js's `ready` (storage + stylesheets) and its first pass.
export async function contentPage(opts = {}) {
  const page = makePage(opts);
  page.load("shared.js", "content.js");
  await page.tick(0);
  await page.tick(20);
  return page;
}

// A /api/v2/users/<id> response.
export const userResponse = (country, { city = "", title = "" } = {}) =>
  json({ user: { country_iso_code: country, city, country_title: title } });

// A fetch handler that answers every seller lookup from `countries`
// (userId -> ISO code, default "IE") and 404s anything else.
export function sellers(countries = {}) {
  return (url) => {
    const m = url.match(/^\/api\/v2\/users\/(\w+)/);
    if (!m) return new FakeResponse("", { status: 404 });
    return userResponse(countries[m[1]] ?? "IE");
  };
}
