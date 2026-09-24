// Isolated-world content script: looks up seller countries, badges each
// listing, applies the user's filter, and shows a listing's photos in a
// lightbox.
(() => {
  const USER_TTL_MS = 90 * 24 * 3600 * 1000; // a seller's country rarely changes
  const MAX_USERS = 20000;                    // cache cap (~1.5 MB)
  // Vinted rate-limits /api/v2/users at roughly 30 requests per 30s. A lookup
  // may start while fewer than `limit` started in the last 30s and fewer than
  // `burst` in the last 3s (sliding windows): a quick burst for the listings
  // on screen, then a steady rate. Both are learned from 429s and saved.
  // Up to CONCURRENCY lookups run at once.
  const CONCURRENCY = 4;
  const WINDOW_MS = 30000, BURST_MS = 3000;
  const LIMIT_START = 25, LIMIT_MIN = 8, LIMIT_MAX = 28, BURST_MIN = 3;
  let limit = LIMIT_START;
  let burst = LIMIT_START; // no tighter than `limit` until a 429 says otherwise

  // VLF_* come from shared.js.
  const siteCountry = VLF_TLD_COUNTRY[location.hostname.replace(/^.*?vinted\./, "")] || "IE";

  const itemOwner = new Map(); // itemId -> userId
  const itemPhoto = new Map(); // itemId -> main photo URL at f800, when inject.js saw one
  let users = {};              // userId -> { c: "IE", city: "Dublin", t: fetchedAt }
  let settings = { ...VLF_DEFAULTS }; // mode: "badge" | "dim" | "hide"
  const homeCountry = () => settings.country || siteCountry;

  // ---------- storage
  const ready = Promise.all([
    chrome.storage.sync.get("settings").then((r) => { settings = vlfSettings(r.settings); }),
    chrome.storage.local.get(["users", "rate"]).then((r) => {
      const now = Date.now();
      // Entries without a country (saved by 0.x for failed lookups) are
      // skipped so those sellers get looked up again.
      for (const [id, u] of Object.entries(r.users || {})) if (u && u.c && now - u.t < USER_TTL_MS) users[id] = u;
      const rate = r.rate || {};
      if (rate.limit >= LIMIT_MIN && rate.limit <= LIMIT_MAX) limit = rate.limit;
      if (rate.burst >= BURST_MIN && rate.burst <= limit) burst = rate.burst;
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
    closeLightbox();
    return false;
  }

  // Saves known countries. Merges with what's stored, so sellers another tab
  // looked up meanwhile aren't overwritten, and keeps the newest MAX_USERS.
  // Sellers without a country aren't saved, so they're retried next visit.
  let saveTimer = null;
  function saveUsers() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!alive()) return;
      chrome.storage.local.get("users").then((r) => {
        if (!alive()) return;
        const now = Date.now();
        const merged = {};
        for (const [id, u] of Object.entries({ ...r.users, ...users })) if (u && u.c && now - u.t < USER_TTL_MS) merged[id] = u;
        const ids = Object.keys(merged);
        if (ids.length > MAX_USERS) {
          ids.sort((a, b) => merged[b].t - merged[a].t);
          for (const id of ids.slice(MAX_USERS)) delete merged[id];
        }
        chrome.storage.local.set({ users: merged });
      }).catch(() => {});
    }, 1000);
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
    for (const [item, user, photo] of e.data.pairs) {
      itemOwner.set(item, user);
      if (photo) itemPhoto.set(item, photo);
    }
    // Wait for the cache and settings, or we'd re-fetch cached sellers and
    // build the panel with default settings.
    ready.then(schedule);
  });

  // ---------- country lookups (queued + throttled)
  const queue = [];
  const queued = new Set();
  let active = 0;
  let pausedUntil = 0;
  const BACKOFF_START = 5000; // short: the learned limits prevent repeats; doubles to 2 min if not
  let backoff = BACKOFF_START;
  let timer = 0;   // the single pending pump() timer, if any
  let okStreak = 0; // successes since the last 429

  // Start times of recent lookups, kept in this tab's sessionStorage so a
  // reload or the next search within 30s doesn't burst into a window Vinted
  // is still counting. Falls back to memory if storage is blocked.
  const STARTS_KEY = "vlf:starts";
  let starts = [];
  try { starts = (JSON.parse(sessionStorage.getItem(STARTS_KEY)) || []).filter((t) => typeof t === "number"); } catch (_) {}
  function recentStarts(now) {
    starts = starts.filter((t) => now - t < WINDOW_MS);
    return starts;
  }
  function recordStart(now) {
    starts.push(now);
    try { sessionStorage.setItem(STARTS_KEY, JSON.stringify(starts)); } catch (_) {}
  }

  function saveRate() {
    if (alive()) chrome.storage.local.set({ rate: { limit, burst, t: Date.now() } });
  }

  // Adds a seller to the queue. The order is set by prioritize() at the end
  // of each apply() pass, which also starts the lookups.
  function want(userId) {
    if (users[userId] || queued.has(userId)) return;
    queued.add(userId);
    queue.push(userId);
  }

  const byPosition = (a, b) => a.rank - b.rank || a.row - b.row || a.left - b.left;

  // Reorders the queue for the current page: its sellers in `ranked` order,
  // then any on the page but unranked (hidden cards). Sellers whose listings
  // are no longer on the page (after a new search, filter or page change) are
  // dropped, so they don't use up the rate limit; they're queued again if
  // their listings come back. apply() only calls this when the page has
  // listings, so a momentarily empty grid (e.g. mid re-render) keeps the queue.
  function prioritize(ranked, onPage) {
    const order = [...ranked].sort(([, a], [, b]) => byPosition(a, b)).map(([id]) => id);
    const first = new Set(order);
    const waiting = new Set(queue);
    const next = [...order.filter((id) => waiting.has(id)), ...queue.filter((id) => !first.has(id) && onPage.has(id))];
    for (const id of queue) if (!onPage.has(id)) queued.delete(id);
    queue.splice(0, queue.length, ...next);
    pump();
  }

  // Every start goes through here, so the window holds no matter who calls it.
  function pump() {
    if (!settings.enabled || active >= CONCURRENCY || !queue.length) return;
    const now = Date.now();
    const recent = recentStarts(now); // oldest first
    // A window is full: wait until enough of its oldest starts have aged out.
    const windowWait = recent.length >= limit ? recent[recent.length - limit] + WINDOW_MS - now : 0;
    const burstWait = recent.length >= burst ? recent[recent.length - burst] + BURST_MS - now : 0;
    const wait = Math.max(pausedUntil - now, windowWait, burstWait);
    if (wait > 0) {
      if (!timer) timer = setTimeout(() => { timer = 0; pump(); }, wait + 5);
      return;
    }
    const id = queue.shift();
    active++;
    recordStart(now);
    lookup(id).finally(() => { active--; pump(); });
    pump(); // start more while the window and CONCURRENCY allow
  }

  async function lookup(userId) {
    try {
      const r = await fetch(`/api/v2/users/${userId}`, { headers: { accept: "application/json" }, credentials: "include" });
      if (r.status === 429) {
        queue.unshift(userId);
        const now = Date.now();
        // Other lookups in flight often hit the same limit. One pause and one
        // lesson per event, not one per response.
        if (now < pausedUntil) return;
        const retryAfter = Number(r.headers.get("retry-after")) * 1000 || 0;
        pausedUntil = now + Math.max(backoff, retryAfter);
        backoff = Math.min(backoff * 2, 120000);
        // Learn which limit we hit from how many we'd just started: many in
        // the last 3s means the burst was too big; otherwise the 30s window
        // was. If neither count is high, the 429 was probably caused by
        // something else (another tab), so just pause.
        const in30 = recentStarts(now).length;
        const in3 = starts.filter((t) => now - t < BURST_MS).length;
        if (in3 - 2 >= BURST_MIN && in3 - 2 < burst) burst = in3 - 2;
        else if (in30 - 3 >= LIMIT_MIN && in30 - 3 < limit) limit = in30 - 3;
        burst = Math.min(burst, limit);
        saveRate();
        okStreak = 0;
        return;
      }
      backoff = BACKOFF_START;
      if (++okStreak >= 60) { // probe back up slowly
        okStreak = 0;
        if (burst < limit) burst++;
        else if (limit < LIMIT_MAX) burst = ++limit;
        saveRate();
      }
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
    if (lb && !lb.el.isConnected) closeLightbox(); // removed by the page (e.g. hydration): undo its scroll lock
    if (!settings.enabled) return applyOff();
    pump(); // resume lookups that were queued before the filter was switched off
    const home = homeCountry();
    let shown = 0, total = 0, pending = 0;

    // Lookup order: what's on screen, then just below, then just above, then
    // the rest; each in reading order (row, then left to right).
    const vh = window.innerHeight;
    const ranked = new Map(); // userId -> { rank, row, left }, best card per seller
    const onPage = new Set(); // every uncached seller with a listing on the page
    for (const { id, box, cell } of cards()) {
      total++;
      const uid = itemOwner.get(id);
      const u = uid && users[uid];
      if (uid && !u) {
        want(uid);
        onPage.add(uid);
        const r = cell.getBoundingClientRect();
        if (r.width && r.height) { // hidden cards have an empty rect; leave them unranked
          const rank = r.bottom > 0 && r.top < vh ? 0 : r.top >= vh && r.top < vh + 400 ? 1 : r.bottom <= 0 && r.bottom > -200 ? 2 : 3;
          const k = { rank, row: Math.round(r.top / 8), left: r.left }; // same row despite sub-pixel differences
          const prev = ranked.get(uid);
          if (!prev || byPosition(k, prev) < 0) ranked.set(uid, k);
        }
      }

      let badge = box.querySelector(":scope .vlf-badge");
      if (!badge) {
        badge = document.createElement("div");
        badge.className = "vlf-badge";
        (box.querySelector('[class*="image-container"]') || box).appendChild(badge);
      }
      if (!badge.parentElement.querySelector(":scope > .vlf-zoom")) badge.parentElement.appendChild(zoomButton(id));

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
    if (total) prioritize(ranked, onPage);
    else pump();
    stats = { shown, total, pending };
    renderPanel();
  }

  // Filter switched off: remove badges, photo buttons and dim/hide classes,
  // and count every listing as shown. Removing badges retriggers the observer once; the next
  // pass finds nothing left to remove.
  function applyOff() {
    closeLightbox();
    for (const el of document.querySelectorAll(".vlf-badge, .vlf-zoom")) el.remove();
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
      panel.setAttribute("aria-label", "Vinted Country Filter");
      panel.innerHTML = `
        <div class="vlf-head">
          <span class="vlf-logo" aria-hidden="true">${PIN_SVG}</span>
          <div class="vlf-titles"><span class="vlf-title">Seller location</span><span class="vlf-stats" role="status" aria-live="polite"></span></div>
          <input type="checkbox" class="vlf-switch vlf-enabled" role="switch" aria-label="Vinted Country Filter on">
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

  // ---------- photos
  // Search results only carry each listing's main photo. The rest are in the
  // listing's own page, fetched only when its lightbox is opened. These are
  // page loads on demand, not /api/v2/users lookups, so they don't go
  // through pump().
  const photoCache = new Map(); // itemId -> Promise<string[]> (f800 URLs), this page view only

  function loadPhotos(id, href) {
    if (!photoCache.has(id)) {
      const p = fetch(href, { credentials: "include" })
        .then((r) => (r.ok ? r.text() : ""))
        .then(parsePhotos)
        .catch(() => []);
      p.then((list) => { if (!list.length) photoCache.delete(id); }); // failed: allow a retry
      photoCache.set(id, p);
    }
    return photoCache.get(id);
  }

  // The item page's inline Next.js data (escaped JSON) has a "photos":[…]
  // array, main photo first. Take each photo's f800 URL. If that can't be
  // parsed, fall back to the distinct f800 URLs in page order (which can also
  // pick up the seller's profile picture from the sidebar).
  function parsePhotos(html) {
    const t = html.replace(/\\"/g, '"').replace(/\\u0026/g, "&");
    const at = t.indexOf('"photos":[');
    if (at >= 0) {
      try {
        const urls = JSON.parse(sliceJson(t, at + 9)).map((p) => {
          const f800 = (p.thumbnails || []).find((x) => x && typeof x.url === "string" && x.url.includes("/f800/"));
          return (f800 && f800.url) || p.full_size_url || p.url;
        }).filter(Boolean);
        if (urls.length) return urls;
      } catch (_) { /* fall through */ }
    }
    return [...new Set(t.match(/https:\/\/images\d*\.vinted\.net\/t\/[^"\s\\]+\/f800\/[^"\s\\]+/g) || [])];
  }

  // From the "[" or "{" at i, return the JSON text up to its matching close.
  function sliceJson(t, i) {
    let depth = 0, inStr = false;
    for (let j = i; j < t.length; j++) {
      const c = t[j];
      if (inStr) { if (c === "\\") j++; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === "[" || c === "{") depth++;
      else if ((c === "]" || c === "}") && --depth === 0) return t.slice(i, j + 1);
    }
    return "";
  }

  const ZOOM_SVG = '<svg class="vlf-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><line x1="16" y1="16" x2="20.5" y2="20.5"></line><line x1="11" y1="8.5" x2="11" y2="13.5"></line><line x1="8.5" y1="11" x2="13.5" y2="11"></line></svg>';

  function zoomButton(id) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "vlf-zoom";
    b.dataset.item = id;
    b.title = "View photos";
    b.setAttribute("aria-label", "View photos");
    b.innerHTML = ZOOM_SVG;
    return b;
  }

  // Capture phase on window, so this runs before Vinted's handlers and the
  // card's link: the click opens the lightbox instead of the listing.
  window.addEventListener("click", (e) => {
    const b = e.target instanceof Element && e.target.closest(".vlf-zoom");
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    // Read the listing from the card now: Vinted may reuse a card element for
    // another listing after the button was created.
    const card = b.closest('[data-testid^="product-item-id-"]');
    const m = card && card.dataset.testid.match(/^product-item-id-(\d+)$/);
    openLightbox(m ? m[1] : b.dataset.item, b);
  }, true);

  // ---------- lightbox
  let lb = null; // { el, img, id, urls, index, loading, opener, onKey, overflow }

  function openLightbox(id, opener) {
    if (!alive()) return;
    closeLightbox();
    const box = opener.closest('[data-testid^="product-item-id-"]');
    const cardImg = box && box.querySelector("img");
    const first = itemPhoto.get(id) || (cardImg && (cardImg.currentSrc || cardImg.src)) || "";
    const link = document.querySelector(`[data-testid="product-item-id-${id}--overlay-link"]`) ||
      (box && box.querySelector('a[href*="/items/"]'));
    const href = (link && link.href) || `/items/${id}`;

    const el = document.createElement("div");
    el.className = "vlf-lightbox";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Listing photos");
    el.innerHTML = `
      <div class="vlf-lb-stage">
        <img class="vlf-lb-img" alt="">
        <button type="button" class="vlf-lb-nav vlf-lb-prev" aria-label="Previous photo"><svg class="vlf-ico" viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 5 8 12 15 19"></polyline></svg></button>
        <button type="button" class="vlf-lb-nav vlf-lb-next" aria-label="Next photo"><svg class="vlf-ico" viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 5 16 12 9 19"></polyline></svg></button>
        <button type="button" class="vlf-lb-close" aria-label="Close"><svg class="vlf-ico" viewBox="0 0 24 24" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg></button>
      </div>
      <div class="vlf-lb-bar">
        <span class="vlf-lb-count" aria-live="polite"></span>
        <a class="vlf-lb-link"></a>
      </div>`;
    const $ = (s) => el.querySelector(s);
    $(".vlf-lb-link").href = href;
    $(".vlf-lb-link").textContent = "Open listing";
    $(".vlf-lb-prev").addEventListener("click", () => step(-1));
    $(".vlf-lb-next").addEventListener("click", () => step(1));
    $(".vlf-lb-close").addEventListener("click", closeLightbox);
    el.addEventListener("click", (e) => { if (e.target === el || e.target.classList.contains("vlf-lb-stage")) closeLightbox(); });

    // Listening only while open: Esc closes, arrows step, Tab stays inside.
    const onKey = (e) => {
      if (!el.isConnected) { closeLightbox(); return; } // removed by the page: stop handling keys
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "Tab") {
        const f = [...el.querySelectorAll("button, a")].filter((n) => !n.hidden);
        const i = f.indexOf(document.activeElement);
        const next = f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length];
        if (next) next.focus();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("keydown", onKey, true);

    lb = { el, img: $(".vlf-lb-img"), id, urls: first ? [first] : [], index: 0, loading: true, opener, onKey,
      overflow: document.documentElement.style.overflow };
    document.documentElement.style.overflow = "hidden"; // no page scrolling behind the lightbox
    document.body.appendChild(el);
    showPhoto();
    $(".vlf-lb-close").focus();

    loadPhotos(id, href).then((list) => {
      if (!lb || lb.id !== id) return; // closed or replaced meanwhile
      lb.loading = false;
      if (list.length) {
        const shown = lb.urls[lb.index];
        const at = list.indexOf(shown);
        lb.urls = list;
        lb.index = at >= 0 ? at : 0;
      }
      showPhoto();
    });
  }

  function step(d) {
    if (!lb || lb.urls.length < 2) return;
    lb.index = (lb.index + d + lb.urls.length) % lb.urls.length;
    showPhoto();
  }

  function showPhoto() {
    const { el, img, urls, index, loading } = lb;
    const n = urls.length;
    if (urls[index] && img.getAttribute("src") !== urls[index]) img.src = urls[index];
    img.alt = n ? `Photo ${index + 1} of ${n}` : "";
    for (const b of el.querySelectorAll(".vlf-lb-nav")) b.hidden = n < 2;
    el.querySelector(".vlf-lb-count").textContent =
      n > 1 ? `${index + 1} / ${n}` : loading ? "Loading more photos…" : n ? "1 / 1" : "No photos found";
  }

  function closeLightbox() {
    if (!lb) return;
    const { el, opener, onKey, overflow } = lb;
    lb = null;
    document.removeEventListener("keydown", onKey, true);
    document.documentElement.style.overflow = overflow;
    el.remove();
    if (opener && opener.isConnected) opener.focus();
  }

  // ---------- boot
  ready.then(() => {
    window.postMessage({ type: "vlf:rescan" }, location.origin);
    const ours = (n) => n.nodeType !== 1 || !!n.closest(".vlf-badge, .vlf-zoom, .vlf-lightbox") || (panel && panel.contains(n));
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
