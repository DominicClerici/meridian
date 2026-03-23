import { store } from "./store";
import { applyBgColor, initSettings } from "./settings";

// Apply background color immediately from synchronous cache.
// The script tag is at the bottom of <body>, so document.body exists.
// This avoids a flash of unstyled background on page load.
applyBgColor(store.sync.get("bgColor"));
store.sync.subscribe("bgColor", applyBgColor);

document.addEventListener("DOMContentLoaded", async () => {
  // Reconcile with browser.storage (async) and register cross-tab listener
  await store.init();

  // Mount settings UI
  initSettings();
});
