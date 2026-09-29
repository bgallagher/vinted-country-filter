// A fake `chrome` for content.js and options.js: in-memory storage with
// onChanged, runtime (id, getURL, onMessage), tabs and extension.getViews.
// Every call is recorded in `calls`, so tests can check that nothing touches
// chrome.* once the script has been cut off.

const clone = (v) => (v === undefined ? undefined : structuredClone(v));

export function makeChrome({ sync = {}, local = {} } = {}) {
  const calls = [];
  const changeListeners = [];
  const messageListeners = [];
  const stores = { sync: clone(sync), local: clone(local) };

  // Once cut off (runtime.id unset), real chrome.* calls throw
  // "Extension context invalidated".
  const guard = (name) => {
    calls.push(name);
    if (!chrome.runtime.id) throw new Error("Extension context invalidated.");
  };

  const area = (name) => ({
    async get(keys) {
      guard(`storage.${name}.get`);
      const store = stores[name];
      const list = keys == null ? Object.keys(store) : [].concat(keys);
      const out = {};
      for (const k of list) if (k in store) out[k] = clone(store[k]);
      return out;
    },
    async set(obj) {
      guard(`storage.${name}.set`);
      const changes = {};
      for (const [k, v] of Object.entries(obj)) {
        changes[k] = { oldValue: clone(stores[name][k]), newValue: clone(v) };
        stores[name][k] = clone(v);
      }
      // Real onChanged fires asynchronously, in every extension context.
      await Promise.resolve();
      for (const l of [...changeListeners]) l(clone(changes), name);
    },
  });

  const chrome = {
    calls,
    stores,
    storage: {
      sync: area("sync"),
      local: area("local"),
      onChanged: { addListener: (l) => changeListeners.push(l) },
    },
    runtime: {
      id: "test-extension-id",
      getURL: (file) => `chrome-extension://test-extension-id/${file}`,
      onMessage: { addListener: (l) => messageListeners.push(l) },
    },
    tabs: {
      // Tests replace these for the popup's "this page" card.
      query: async () => [{ id: 1 }],
      sendMessage: async () => { throw new Error("Could not establish connection."); },
    },
    extension: { getViews: () => [] },

    // Test helpers (not part of the chrome API).
    // Sends a runtime message as chrome.tabs.sendMessage would; resolves
    // with the reply, or undefined if no listener replied.
    message(msg) {
      return new Promise((resolve) => {
        let replied = false;
        for (const l of messageListeners) l(msg, {}, (r) => { replied = true; resolve(r); });
        if (!replied) resolve(undefined);
      });
    },
    // Writes to storage as another tab or the popup would, firing onChanged.
    setFromElsewhere(name, obj) {
      const wasId = chrome.runtime.id;
      chrome.runtime.id = chrome.runtime.id || "elsewhere";
      const p = chrome.storage[name].set(obj);
      chrome.runtime.id = wasId;
      calls.pop();
      return p;
    },
    cutOff() { chrome.runtime.id = undefined; },
  };
  return chrome;
}
