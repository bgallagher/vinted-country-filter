import js from "@eslint/js";
import globals from "globals";

// Top-level names shared.js defines. It's loaded before content.js (same
// content-script entry) and options.js (options.html), so they're globals there.
const shared = {
  VLF_TLD_COUNTRY: "readonly",
  VLF_COUNTRIES: "readonly",
  VLF_DEFAULTS: "readonly",
  vlfSettings: "readonly",
  vlfFlag: "readonly",
  vlfCountryName: "readonly",
  vlfFillCountrySelect: "readonly",
};

export default [
  { ignores: ["dist/", "node_modules/"] },
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2025,
      sourceType: "script",
      globals: { ...globals.browser },
    },
    rules: {
      "no-unused-vars": ["error", { args: "after-used", caughtErrors: "none" }],
      eqeqeq: ["error", "smart"],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "prefer-const": "error",
      "no-var": "error",
    },
  },
  {
    // Isolated world / extension pages: chrome.* and shared.js's globals.
    files: ["src/content.js", "src/options.js"],
    languageOptions: { globals: { ...globals.webextensions, ...shared } },
  },
  {
    // Its top-level names are used by the other scripts, not here.
    files: ["src/shared.js"],
    rules: { "no-unused-vars": ["error", { vars: "local", caughtErrors: "none" }] },
  },
  {
    // Tests run in Node and load the extension's scripts into jsdom.
    files: ["test/**/*.js"],
    languageOptions: { sourceType: "module", globals: { ...globals.node } },
  },
  {
    files: ["eslint.config.js"],
    languageOptions: { sourceType: "module", globals: { ...globals.node } },
  },
];
