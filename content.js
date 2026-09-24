// Isolated-world content script: looks up seller countries, badges each
// listing, and applies the user's filter.
(() => {
  const USER_TTL_MS = 14 * 24 * 3600 * 1000;
  // Vinted rate-limits /api/v2/users at roughly 30 requests per ~30s, so go
  // slowly and back off harder each time we get a 429.
  const CONCURRENCY = 1;
  const GAP_MS = 900;

  // VLF_* come from shared.js.
  const siteCountry = VLF_TLD_COUNTRY[location.hostname.replace(/^.*?vinted\./, "")] || "IE";

  const itemOwner = new Map(); // itemId -> userId
  let users = {};              // userId -> { c: "IE", city: "Dublin", t: fetchedAt }
  let settings = { ...VLF_DEFAULTS }; // mode: "badge" | "dim" | "hide"
  const homeCountry = () => settings.country || siteCountry;

  // ---------- storage
  const ready = Promise.all([
    chrome.storage.sync.get("settings").then((r) => { settings = vlfSettings(r.settings); }),
    chrome.storage.local.get("users").then((r) => {
      const now = Date.now();
      for (const [id, u] of Object.entries(r.users || {})) if (now - u.t < USER_TTL_MS) users[id] = u;
    }),
  ]);

  // Reloading or updating the extension cuts off the copy of this script
  // already running in open tabs: every chrome.* call then throws "Extension
  // context invalidated". Check before each one, and once cut off, stop
  // quietly and remove the panel (its controls could no longer save).
  let dead = false;
  let observer = null;
  function alive() {
    if (dead) return false;
    if (chrome.runtime && chrome.runtime.id) return true;
    dead = true;
    if (observer) observer.disconnect();
    clearTimeout(saveTimer);
    if (panel) panel.remove();
    return false;
  }

  let saveTimer = null;
  function saveUsers() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { if (alive()) chrome.storage.local.set({ users }); }, 1000);
  }
  function saveSettings() { if (alive()) chrome.storage.sync.set({ settings }); }

  // Pick up changes made on the options page or in another tab.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes.settings) return;
    settings = vlfSettings(changes.settings.newValue);
    syncPanelInputs();
    schedule();
  });

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
    if (!settings.enabled || active >= CONCURRENCY || !queue.length) return;
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
  function cards() {
    const out = [];
    for (const el of document.querySelectorAll('[data-testid^="product-item-id-"]')) {
      const m = el.dataset.testid.match(/^product-item-id-(\d+)$/);
      if (m) out.push({ id: m[1], box: el, cell: el.closest('[data-testid="grid-item"]') || el });
    }
    return out;
  }

  function apply() {
    if (!settings.enabled) return applyOff();
    pump(); // resume lookups that were queued before the filter was switched off
    const home = homeCountry();
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

      // state: "match" | "other" | "loading" (lookup queued; pulses) | "unknown"
      let state, text, title;
      if (u && u.c) {
        state = u.c.toUpperCase() === home ? "match" : "other";
        text = `${vlfFlag(u.c)} ${u.c}`;
        title = `Seller in ${[u.city, u.name].filter(Boolean).join(", ") || u.c}`;
      } else if (u) {
        state = "unknown";
        text = "? –";
        title = "Seller country not available";
      } else {
        state = uid ? "loading" : "unknown";
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
        (state === "other" || (state === "unknown" && settings.hideUnknown));
      cell.classList.toggle("vlf-hidden", reject && settings.mode === "hide");
      cell.classList.toggle("vlf-dimmed", reject && settings.mode === "dim");
      if (!(reject && settings.mode === "hide")) shown++;
    }
    stats = { shown, total, pending };
    renderPanel();
  }

  // Filter switched off: remove badges and dim/hide classes, and count every
  // listing as shown. Removing badges retriggers the observer once; the next
  // pass finds nothing left to remove.
  function applyOff() {
    for (const el of document.querySelectorAll(".vlf-badge")) el.remove();
    for (const el of document.querySelectorAll(".vlf-hidden, .vlf-dimmed")) el.classList.remove("vlf-hidden", "vlf-dimmed");
    const total = cards().length;
    stats = { shown: total, total, pending: 0 };
    renderPanel();
  }

  // Counts for the toolbar popup's "this page" card.
  let stats = { shown: 0, total: 0, pending: 0 };
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg && msg.type === "vlf:stats") reply(stats);
  });

  let raf = 0;
  function schedule() {
    if (raf || !alive()) return;
    raf = requestAnimationFrame(() => { raf = 0; if (alive()) apply(); });
  }

  // ---------- panel
  let panel;
  const PIN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s-7-6.1-7-12a7 7 0 0 1 14 0c0 5.9-7 12-7 12z"></path><circle cx="12" cy="10" r="2.6"></circle></svg>';
  const MODES = [["badge", "Show"], ["dim", "Dim"], ["hide", "Hide"]];

  function renderPanel() {
    if (!stats.total && !panel) return;
    if (!panel) {
      panel = document.createElement("aside");
      panel.className = "vlf-panel";
      panel.setAttribute("aria-label", "Seller location filter");
      panel.innerHTML = `
        <div class="vlf-head">
          <span class="vlf-logo" aria-hidden="true">${PIN_SVG}</span>
          <div class="vlf-titles"><span class="vlf-title">Seller location</span><span class="vlf-stats" role="status" aria-live="polite"></span></div>
          <input type="checkbox" class="vlf-switch vlf-enabled" role="switch" aria-label="Seller location filter on">
          <button type="button" class="vlf-toggle"><svg class="vlf-ico" viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg></button>
        </div>
        <div class="vlf-body">
          <div class="vlf-field">
            <label class="vlf-label" for="vlf-country">My country</label>
            <div class="vlf-select"><select class="vlf-country" id="vlf-country"></select></div>
            <p class="vlf-hint">Listings from sellers in this country are kept.</p>
          </div>
          <div class="vlf-field">
            <span class="vlf-label" id="vlf-mode-label">Listings from other countries</span>
            <div class="vlf-mode vlf-seg" role="radiogroup" aria-labelledby="vlf-mode-label">
              ${MODES.map(([v, label]) => `<input type="radio" name="vlf-mode" id="vlf-mode-${v}" value="${v}"><label for="vlf-mode-${v}">${label}</label>`).join("")}
            </div>
          </div>
          <div class="vlf-switch-row">
            <label for="vlf-unknown">Also filter unknown sellers</label>
            <input type="checkbox" class="vlf-unknown vlf-switch" id="vlf-unknown" role="switch">
          </div>
        </div>`;

      const $ = (s) => panel.querySelector(s);
      vlfFillCountrySelect($(".vlf-country"), `This site (${vlfFlag(siteCountry)} ${vlfCountryName(siteCountry)})`);
      syncPanelInputs();

      const change = (patch) => { Object.assign(settings, patch); saveSettings(); flashSaved(); schedule(); };
      $(".vlf-country").addEventListener("change", (e) => change({ country: e.target.value }));
      $(".vlf-mode").addEventListener("change", (e) => change({ mode: e.target.value }));
      $(".vlf-unknown").addEventListener("change", (e) => change({ hideUnknown: e.target.checked }));
      $(".vlf-enabled").addEventListener("change", (e) => change({ enabled: e.target.checked }));
      $(".vlf-toggle").addEventListener("click", () => { settings.collapsed = !settings.collapsed; saveSettings(); schedule(); });
    }
    // Vinted's React hydration can re-render <body> and drop the panel; put it back.
    if (!panel.isConnected) document.body.appendChild(panel);
    const toggle = panel.querySelector(".vlf-toggle");
    panel.classList.toggle("vlf-collapsed", settings.collapsed);
    toggle.setAttribute("aria-expanded", String(!settings.collapsed));
    toggle.setAttribute("aria-label", settings.collapsed ? "Expand panel" : "Collapse panel");
    panel.classList.toggle("vlf-off", !settings.enabled);
    const flashing = Date.now() < savedUntil;
    const statsEl = panel.querySelector(".vlf-stats");
    statsEl.classList.toggle("vlf-flash", flashing);
    statsEl.textContent = flashing ? "Saved" : !settings.enabled ? "Off" :
      `${stats.shown}/${stats.total}` + (stats.pending ? ` · ${stats.pending} loading` : "");
  }

  function syncPanelInputs() {
    if (!panel) return;
    panel.querySelector(".vlf-country").value = settings.country;
    for (const r of panel.querySelectorAll(".vlf-mode input")) r.checked = r.value === settings.mode;
    panel.querySelector(".vlf-unknown").checked = settings.hideUnknown;
    panel.querySelector(".vlf-enabled").checked = settings.enabled;
  }

  // "Saved" shows in place of the stats line for a moment after a change.
  let savedUntil = 0;
  let savedT = 0;
  function flashSaved() {
    savedUntil = Date.now() + 1600;
    clearTimeout(savedT);
    savedT = setTimeout(schedule, 1650);
  }

  // ---------- boot
  ready.then(() => {
    window.postMessage({ type: "vlf:rescan" }, location.origin);
    const ours = (n) => n.nodeType !== 1 || n.classList.contains("vlf-badge") || (panel && panel.contains(n));
    observer = new MutationObserver((muts) => {
      const external = muts.some((m) =>
        // A removed element (even our panel or a badge, e.g. during React
        // hydration) means a page change. The one exception, applyOff()
        // removing badges, just costs one extra pass.
        [...m.removedNodes].some((n) => n.nodeType === 1) ||
        (!(ours(m.target) || (m.target.parentElement && ours(m.target.parentElement))) &&
          ![...m.addedNodes].every(ours)));
      if (external) schedule();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true }); // not body: it can be replaced
    let scrollT = 0;
    window.addEventListener("scroll", () => { clearTimeout(scrollT); scrollT = setTimeout(schedule, 250); }, { passive: true });
    schedule();
  });
})();
