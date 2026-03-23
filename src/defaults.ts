import type { Tab } from "./shortcuts"

export type SyncSettings = {
  bgColor: "red" | "green" | "blue";
  searchEngine: "google" | "bing" | "yahoo" | "duckduckgo" | "ecosia" | "qwant" | "startpage";
  debounceSearch: boolean;
};

export type LocalSettings = {
  shortcuts: Tab[]
}

export const syncDefaults: SyncSettings = {
  bgColor: "blue",
  searchEngine: "google",
  debounceSearch: false,
}

export const localDefaults: LocalSettings = {
  shortcuts: [],
}
