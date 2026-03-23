export interface SyncSettings {
  bgColor: "red" | "green" | "blue";
}

export interface LocalSettings {
  // Future: large objects, images, etc.
}

export const syncDefaults: SyncSettings = {
  bgColor: "blue",
};

export const localDefaults: LocalSettings = {};
