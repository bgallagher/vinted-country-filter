// Isolated-world content script: looks up seller countries, badges each
// listing, and applies the user's filter.
(() => {
  const USER_TTL_MS = 14 * 24 * 3600 * 1000;
  // Vinted rate-limits /api/v2/users at roughly 30 requests per ~30s, so go
  // slowly and back off harder each time we get a 429.
  const CONCURRENCY = 1;
  const GAP_MS = 900;

  const TLD_COUNTRY = {
    ie: "IE", "co.uk": "GB", fr: "FR", de: "DE", es: "ES", it: "IT", nl: "NL", be: "BE",
    pl: "PL", pt: "PT", lt: "LT", lv: "LV", ee: "EE", cz: "CZ", sk: "SK", at: "AT",
    lu: "LU", se: "SE", fi: "FI", dk: "DK", gr: "GR", hu: "HU", ro: "RO", hr: "HR", si: "SI",
    com: "US",
  };
  const tld = location.hostname.replace(/^.*?vinted\./, "");

  const itemOwner = new Map(); // itemId -> userId
  let users = {};              // userId -> { c: "IE", city: "Dublin", t: fetchedAt }
  let settings = {
    mode: "dim",               // "badge" | "dim" | "hide"
    allowed: [TLD_COUNTRY[tld] || "IE"],
    hideUnknown: false,
    collapsed: false,
  };

  // ---------- storage
  const ready = Promise.all([
    chrome.storage.sync.get("settings").then((r) => { if (r.settings) settings = { ...settings, ...r.settings }; }),
    chrome.storage.local.get("users").then((r) => {
      const now = Date.now();
      for (const [id, u] of Object.entries(r.users || {})) if (now - u.t < USER_TTL_MS) users[id] = u;
    }),
  ]);

  let saveTimer = null;
  function saveUsers() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => chrome.storage.local.set({ users }), 1000);
  }
  function saveSettings() { chrome.storage.sync.set({ settings }); }

  // ---------- owner map from inject.js
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.type !== "vlf:owners") return;
    for (const [item, user] of e.data.pairs) itemOwner.set(item, user);
    // Wait for the cache and settings, or we'd re-fetch cached sellers and
    // build the panel with default settings.
    ready.then(schedule);
  });

  // ---------- country lookups (queued + throttled)
  const queue = [];
  const queued = new Set();
  let active = 0;
  let pausedUntil = 0;
  let backoff = 15000;
  let nextAt = 0;  // earliest time the next request may start
  let timer = 0;   // the single pending pump() timer, if any

  // urgent = on screen right now: jump the queue.
  function want(userId, urgent) {
    if (users[userId]) return;
    if (queued.has(userId)) {
      if (!urgent) return;
      const i = queue.indexOf(userId);
      if (i > 0) { queue.splice(i, 1); queue.unshift(userId); }
      return;
    }
    queued.add(userId);
    urgent ? queue.unshift(userId) : queue.push(userId);
    pump();
  }

  // Every start goes through here, so the gap holds no matter who calls it.
  function pump() {
    if (active >= CONCURRENCY || !queue.length) return;
    const wait = Math.max(pausedUntil, nextAt) - Date.now();
    if (wait > 0) {
      if (!timer) timer = setTimeout(() => { timer = 0; pump(); }, wait);
      return;
    }
    const id = queue.shift();
    active++;
    nextAt = Date.now() + GAP_MS;
    lookup(id).finally(() => { active--; nextAt = Date.now() + GAP_MS; pump(); });
    pump();
  }

  async function lookup(userId) {
    try {
      const r = await fetch(`/api/v2/users/${userId}`, { headers: { accept: "application/json" }, credentials: "include" });
      if (r.status === 429) {
        const retryAfter = Number(r.headers.get("retry-after")) * 1000 || 0;
        pausedUntil = Date.now() + Math.max(backoff, retryAfter);
        backoff = Math.min(backoff * 2, 120000);
        queue.unshift(userId);
        return;
      }
      backoff = 15000;
      if (!r.ok) { users[userId] = { c: null, city: "", t: Date.now() }; return; }
      const u = (await r.json()).user || {};
      users[userId] = { c: u.country_iso_code || u.country_code || null, name: u.country_title || "", city: u.city || "", t: Date.now() };
      saveUsers();
    } catch (_) {
      queued.delete(userId); // allow retry later
      return;
    } finally {
      schedule();
    }
    queued.delete(userId);
  }

  // ---------- DOM
  const flag = (cc) => cc ? String.fromCodePoint(...[...cc.toUpperCase()].map((ch) => 0x1f1a5 + ch.charCodeAt(0))) : "";

  function cards() {
    const out = [];
    for (const el of document.querySelectorAll('[data-testid^="product-item-id-"]')) {
      const m = el.dataset.testid.match(/^product-item-id-(\d+)$/);
      if (m) out.push({ id: m[1], box: el, cell: el.closest('[data-testid="grid-item"]') || el });
    }
    return out;
  }

  function apply() {
    const allowed = new Set(settings.allowed.map((s) => s.toUpperCase()));
    let shown = 0, total = 0, pending = 0;

    const vh = window.innerHeight;
    for (const { id, box, cell } of cards()) {
      total++;
      const uid = itemOwner.get(id);
      const u = uid && users[uid];
      if (uid && !u) {
        const r = cell.getBoundingClientRect();
        want(uid, r.bottom > -200 && r.top < vh + 400);
      }

      let badge = box.querySelector(":scope .vlf-badge");
      if (!badge) {
        badge = document.createElement("div");
        badge.className = "vlf-badge";
        (box.querySelector('[class*="image-container"]') || box).appendChild(badge);
      }

      let state, text, title; // state: "match" | "other" | "unknown"
      if (u && u.c) {
        state = allowed.has(u.c) ? "match" : "other";
        text = `${flag(u.c)} ${u.c}`;
        title = `Seller in ${[u.city, u.name].filter(Boolean).join(", ") || u.c}`;
      } else if (u) {
        state = "unknown";
        text = "? –";
        title = "Seller country not available";
      } else {
        state = "unknown";
        pending++;
        text = "…";
        title = uid ? "Looking up seller…" : "Seller not known yet";
      }
      // Only touch the DOM when something changed, so our own writes don't
      // retrigger the MutationObserver.
      if (badge.textContent !== text) badge.textContent = text;
      if (badge.title !== title) badge.title = title;
      if (badge.dataset.state !== state) badge.dataset.state = state;

      const reject = settings.mode !== "badge" &&
        (state === "other" || (state === "unknown" && settings.hideUnknown && !(uid && !u)));
      cell.classList.toggle("vlf-hidden", reject && settings.mode === "hide");
      cell.classList.toggle("vlf-dimmed", reject && settings.mode === "dim");
      if (!(reject && settings.mode === "hide")) shown++;
    }
    renderPanel(shown, total, pending);
  }

  let raf = 0;
  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; apply(); });
  }

  // ---------- panel
  let panel;
  function renderPanel(shown, total, pending) {
    if (!total && !panel) return;
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "vlf-panel";
      panel.innerHTML = `
        <div class="vlf-head"><strong>Seller location</strong><span class="vlf-stats"></span><button class="vlf-toggle" type="button"></button></div>
        <div class="vlf-body">
          <label>Countries <input class="vlf-countries" type="text" placeholder="IE, GB" spellcheck="false"></label>
          <label>Others
            <select class="vlf-mode">
              <option value="badge">Show (badge only)</option>
              <option value="dim">Dim</option>
              <option value="hide">Hide</option>
            </select>
          </label>
          <label class="vlf-check"><input class="vlf-unknown" type="checkbox"> Also filter unknown</label>
        </div>`;
      document.body.appendChild(panel);

      const $ = (s) => panel.querySelector(s);
      $(".vlf-countries").value = settings.allowed.join(", ");
      $(".vlf-mode").value = settings.mode;
      $(".vlf-unknown").checked = settings.hideUnknown;

      $(".vlf-countries").addEventListener("change", (e) => {
        settings.allowed = e.target.value.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s));
        e.target.value = settings.allowed.join(", ");
        saveSettings(); schedule();
      });
      $(".vlf-mode").addEventListener("change", (e) => { settings.mode = e.target.value; saveSettings(); schedule(); });
      $(".vlf-unknown").addEventListener("change", (e) => { settings.hideUnknown = e.target.checked; saveSettings(); schedule(); });
      $(".vlf-toggle").addEventListener("click", () => { settings.collapsed = !settings.collapsed; saveSettings(); schedule(); });
    }
    panel.classList.toggle("vlf-collapsed", settings.collapsed);
    panel.querySelector(".vlf-toggle").textContent = settings.collapsed ? "▴" : "▾";
    panel.querySelector(".vlf-stats").textContent =
      `${shown}/${total}` + (pending ? ` · ${pending} loading` : "");
  }

  // ---------- boot
  ready.then(() => {
    window.postMessage({ type: "vlf:rescan" }, location.origin);
    const ours = (n) => n.nodeType !== 1 || n.classList.contains("vlf-badge") || (panel && panel.contains(n));
    new MutationObserver((muts) => {
      const external = muts.some((m) =>
        !(ours(m.target) || (m.target.parentElement && ours(m.target.parentElement))) &&
        ![...m.addedNodes, ...m.removedNodes].every(ours));
      if (external) schedule();
    }).observe(document.body, { childList: true, subtree: true });
    let scrollT = 0;
    window.addEventListener("scroll", () => { clearTimeout(scrollT); scrollT = setTimeout(schedule, 250); }, { passive: true });
    schedule();
  });
})();
