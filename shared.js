// Shared by content.js (loaded just before it) and options.html.

// Vinted domain -> the country it serves. Its values are also the countries
// offered in the "My country" picker.
const VLF_TLD_COUNTRY = {
  ie: "IE", "co.uk": "GB", fr: "FR", de: "DE", es: "ES", it: "IT", nl: "NL", be: "BE",
  pl: "PL", pt: "PT", lt: "LT", lv: "LV", ee: "EE", cz: "CZ", sk: "SK", at: "AT",
  lu: "LU", se: "SE", fi: "FI", dk: "DK", gr: "GR", hu: "HU", ro: "RO", hr: "HR", si: "SI",
  com: "US",
};
const VLF_COUNTRIES = [...new Set(Object.values(VLF_TLD_COUNTRY))];

// Stored in chrome.storage.sync under "settings".
// country: ISO code, or "" to use the country of the Vinted site being viewed.
const VLF_DEFAULTS = { country: "", mode: "dim", hideUnknown: false, collapsed: false };

// Stored settings -> complete settings object. Always read settings through this.
function vlfSettings(stored) {
  const s = { ...VLF_DEFAULTS, ...stored };
  // 0.1.0 stored a list of countries as `allowed`; keep the first as `country`.
  // (There's now only one country, so any others are dropped.)
  if (!(stored && "country" in stored) && Array.isArray(s.allowed) && s.allowed.length) {
    s.country = String(s.allowed[0]).toUpperCase();
  }
  delete s.allowed;
  // 0.1.0 accepted any two letters (e.g. "CH", "UK"). A code the picker can't
  // show would filter out everything with no visible reason, so use the site's country.
  if (s.country && !VLF_COUNTRIES.includes(s.country)) s.country = "";
  return s;
}

// "IE" -> 🇮🇪 (regional indicator letters). Windows doesn't draw these as
// flags and shows the two letters instead.
function vlfFlag(cc) {
  return cc ? String.fromCodePoint(...[...cc.toUpperCase()].map((ch) => 0x1f1a5 + ch.charCodeAt(0))) : "";
}

function vlfCountryName(cc) {
  try {
    return new Intl.DisplayNames([navigator.language, "en"], { type: "region" }).of(cc) || cc;
  } catch (_) {
    return cc;
  }
}

// Fill a <select> with a "site default" option followed by every country, sorted by name.
function vlfFillCountrySelect(select, defaultLabel) {
  const opts = [new Option(defaultLabel, "")];
  const countries = VLF_COUNTRIES
    .map((cc) => [cc, vlfCountryName(cc)])
    .sort((a, b) => a[1].localeCompare(b[1]));
  for (const [cc, name] of countries) opts.push(new Option(`${vlfFlag(cc)} ${name}`, cc));
  select.replaceChildren(...opts);
}
