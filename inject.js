// Runs in the page's own JS world (MAIN) at document_start.
// Job: learn which seller (user id) owns each listed item, and hand that
// mapping to content.js via window.postMessage. It never modifies responses.
(() => {
  if (window.__vlfInjected) return;
  window.__vlfInjected = true;

  const MSG = "vlf:owners";

  const known = new Map(); // itemId -> userId, kept so late listeners can catch up

  function post(pairs) {
    const fresh = pairs.filter(([i, u]) => known.get(i) !== u);
    for (const [i, u] of fresh) known.set(i, u);
    if (fresh.length) window.postMessage({ type: MSG, pairs: fresh }, location.origin);
  }

  // Walk any JSON payload looking for objects shaped like { id, user: { id } }.
  function collect(node, out, depth = 0) {
    if (!node || typeof node !== "object" || depth > 8) return;
    if (Array.isArray(node)) {
      for (const n of node) collect(n, out, depth + 1);
      return;
    }
    if (node.id && node.user && typeof node.user === "object" && node.user.id) {
      out.push([String(node.id), String(node.user.id)]);
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
      if (o) out.push([m[1], o[1]]);
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
    if (known.size) window.postMessage({ type: MSG, pairs: [...known] }, location.origin);
  });
})();
