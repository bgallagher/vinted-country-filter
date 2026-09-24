// Toolbar popup and options page. Reads and writes the same "settings" object
// as the in-page panel in content.js; each side picks up the other's changes
// via storage.onChanged.
(() => {
  const $ = (id) => document.getElementById(id);
  const modeInputs = [...document.querySelectorAll('input[name="mode"]')];
  const controls = [$("country"), $("hideUnknown"), ...modeInputs];
  let settings = { ...VLF_DEFAULTS };

  // Inside chrome://extensions this page is the options dialog, which is wider.
  const isPopup = chrome.extension.getViews({ type: "popup" }).includes(window);
  document.body.classList.toggle("wide", !isPopup);

  vlfFillCountrySelect($("country"), "Same as the Vinted site I'm on");

  function show() {
    $("country").value = settings.country;
    for (const r of modeInputs) r.checked = r.value === settings.mode;
    $("hideUnknown").checked = settings.hideUnknown;
  }

  let savedT = 0;
  function save(patch) {
    settings = { ...settings, ...patch };
    chrome.storage.sync.set({ settings }).then(() => {
      $("saved").classList.add("is-visible");
      clearTimeout(savedT);
      savedT = setTimeout(() => $("saved").classList.remove("is-visible"), 1600);
    });
  }

  // Controls start disabled in the HTML so nothing can be saved on top of the
  // defaults before the stored settings have loaded.
  chrome.storage.sync.get("settings").then((r) => {
    settings = vlfSettings(r.settings);
    show();
    for (const c of controls) c.disabled = false;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.settings) { settings = vlfSettings(changes.settings.newValue); show(); }
  });

  $("country").addEventListener("change", (e) => save({ country: e.target.value }));
  for (const r of modeInputs) r.addEventListener("change", (e) => save({ mode: e.target.value }));
  $("hideUnknown").addEventListener("change", (e) => save({ hideUnknown: e.target.checked }));

  // "This page" card: ask content.js in the active tab for its counts. Any
  // failure (not a Vinted tab, or opened before the extension loaded) shows
  // the empty state.
  async function refreshStats() {
    let stats = null;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) stats = await chrome.tabs.sendMessage(tab.id, { type: "vlf:stats" });
    } catch (_) { /* no content script there */ }
    const ready = !!(stats && stats.total);
    $("stats").dataset.state = ready ? "ready" : "empty";
    if (!ready) return;
    $("statsShown").textContent = stats.shown;
    $("statsTotal").textContent = stats.total;
    $("statsLoading").hidden = !stats.pending;
    $("statsLoading").textContent = `${stats.pending} still loading`;
  }
  refreshStats();
  if (isPopup) setInterval(refreshStats, 1000); // counts change as lookups finish
})();
