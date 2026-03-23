import type { Tab } from "./shortcuts"

export type SyncSettings = {
  bgColor: "red" | "green" | "blue";
};

export type LocalSettings = {
  shortcuts: Tab[]
}

export const syncDefaults: SyncSettings = {
  bgColor: "blue",
}

export const localDefaults: LocalSettings = {
  shortcuts: [],
}
