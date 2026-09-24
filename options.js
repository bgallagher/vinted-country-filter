// Options page. Reads and writes the same "settings" object as the in-page
// panel in content.js; each side picks up the other's changes via storage.onChanged.
(() => {
  const $ = (id) => document.getElementById(id);
  let settings = { ...VLF_DEFAULTS };

  vlfFillCountrySelect($("country"), "Same as the Vinted site I'm on");

  function show() {
    $("country").value = settings.country;
    $("mode").value = settings.mode;
    $("hideUnknown").checked = settings.hideUnknown;
  }

  let savedT = 0;
  function save(patch) {
    settings = { ...settings, ...patch };
    chrome.storage.sync.set({ settings }).then(() => {
      $("saved").classList.add("show");
      clearTimeout(savedT);
      savedT = setTimeout(() => $("saved").classList.remove("show"), 1200);
    });
  }

  // Controls start disabled in the HTML so nothing can be saved on top of the
  // defaults before the stored settings have loaded.
  chrome.storage.sync.get("settings").then((r) => {
    settings = vlfSettings(r.settings);
    show();
    for (const id of ["country", "mode", "hideUnknown"]) $(id).disabled = false;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.settings) { settings = vlfSettings(changes.settings.newValue); show(); }
  });

  $("country").addEventListener("change", (e) => save({ country: e.target.value }));
  $("mode").addEventListener("change", (e) => save({ mode: e.target.value }));
  $("hideUnknown").addEventListener("change", (e) => save({ hideUnknown: e.target.checked }));
})();
