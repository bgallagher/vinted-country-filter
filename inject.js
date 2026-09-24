// Runs in the page's own JS world (MAIN) at document_start.
// Job: learn which seller (user id) owns each listed item, and the URL of its
// main photo at full size (f800), and hand that to content.js via
// window.postMessage. It never modifies responses.
(() => {
  if (window.__vlfInjected) return;
  window.__vlfInjected = true;

  const MSG = "vlf:owners";

  // itemId -> [userId, photoUrl], kept so late listeners can catch up.
  // photoUrl is "" when the payload didn't include one.
  const known = new Map();

  function post(entries) {
    const fresh = [];
    for (const [i, u, p = ""] of entries) {
      const k = known.get(i);
      if (k && k[0] === u && (!p || k[1] === p)) continue;
      const entry = [i, u, p || (k && k[1]) || ""];
      known.set(i, [entry[1], entry[2]]);
      fresh.push(entry);
    }
    if (fresh.length) window.postMessage({ type: MSG, pairs: fresh }, location.origin);
  }

  // Full-size (f800) URL of an item's main photo, from an API item object.
  // Image URLs are signed per size, so it must come from the data, not be
  // derived from a thumbnail URL.
  function photoOf(node) {
    const p = node.photo || (Array.isArray(node.photos) && node.photos[0]);
    if (!p || typeof p !== "object") return "";
    const f800 = Array.isArray(p.thumbnails) &&
      p.thumbnails.find((t) => t && typeof t.url === "string" && t.url.includes("/f800/"));
    // f800 first: it's the size the item page lists, so the lightbox can match
    // this photo against the full list instead of loading it twice.
    return (f800 && f800.url) || p.full_size_url || p.url || "";
  }

  // Walk any JSON payload looking for objects shaped like { id, user: { id } }.
  function collect(node, out, depth = 0) {
    if (!node || typeof node !== "object" || depth > 8) return;
    if (Array.isArray(node)) {
      for (const n of node) collect(n, out, depth + 1);
      return;
    }
    if (node.id && node.user && typeof node.user === "object" && node.user.id) {
      out.push([String(node.id), String(node.user.id), photoOf(node)]);
    }
    for (const k in node) {
      const v = node[k];
      if (v && typeof v === "object") collect(v, out, depth + 1);
    }
  }

  function handleText(url, text) {
    if (!text || text.length < 20) return;
    if (!/"user"\s*:/.test(text)) return;
    try {
      const out = [];
      collect(JSON.parse(text), out);
      post(out);
    } catch (_) { /* not JSON */ }
  }

  const interesting = (url) => /svc-catalogue|\/catalog|\/items|\/feed|\/wardrobe|homepage/i.test(url || "");

  // --- fetch hook
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0] && args[0].url;
      const ct = res.headers.get("content-type") || "";
      if (interesting(url) && ct.includes("json")) {
        res.clone().text().then((t) => handleText(url, t)).catch(() => {});
      } else if (ct.includes("x-component")) {
        // Next.js client-side navigation (RSC payload) carries the same flight data
        res.clone().text().then((t) => { const out = []; scanFlightText(t, out); post(out); }).catch(() => {});
      }
    } catch (_) {}
    return res;
  };

  // --- XHR hook (Vinted's catalogue paging currently uses XHR)
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__vlfUrl = String(url);
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (interesting(this.__vlfUrl)) {
      this.addEventListener("load", () => {
        try {
          if (this.responseType === "json") {
            const out = [];
            collect(this.response, out);
            post(out);
          } else if (this.responseType === "" || this.responseType === "text") {
            handleText(this.__vlfUrl, this.responseText);
          }
        } catch (_) {}
      });
    }
    return origSend.apply(this, arguments);
  };

  // --- Server-rendered first page: item data lives in inline Next.js flight
  // scripts as escaped JSON, e.g. "productItem":{"id":123,... "ownerId":456
  function scanFlightText(t, out) {
    if (!t || !t.includes("ownerId")) return;
    const clean = t.replace(/\\"/g, '"');
    const re = /"productItem":\{"id":(\d+)/g;
    let m;
    while ((m = re.exec(clean))) {
      const tail = clean.slice(m.index, m.index + 20000);
      const next = tail.indexOf('"productItem"', 15);
      const seg = next > 0 ? tail.slice(0, next) : tail;
      const o = seg.match(/"ownerId":(\d+)/) || seg.match(/"user":\{"id":(\d+)/);
      // photos[0].url is the main photo at f800 on the search page.
      const ph = seg.match(/"photos":\[\{"url":"([^"]+)"/);
      if (o) out.push([m[1], o[1], ph ? ph[1].replace(/\\u0026/g, "&") : ""]);
    }
  }

  function scanInlineScripts() {
    const out = [];
    for (const s of document.scripts) scanFlightText(s.textContent, out);
    post(out);
  }

  // Scan once the DOM is parsed, and again on request from content.js
  // (it may load after our first post).
  document.addEventListener("DOMContentLoaded", scanInlineScripts);
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.type !== "vlf:rescan") return;
    scanInlineScripts();
    if (known.size) window.postMessage({ type: MSG, pairs: [...known].map(([i, [u, p]]) => [i, u, p]) }, location.origin);
  });
})();
