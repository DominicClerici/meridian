interface BrowserStorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

interface BrowserStorageOnChanged {
  addListener(
    callback: (
      changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
      areaName: string
    ) => void
  ): void;
}

interface BrowserStorage {
  sync: BrowserStorageArea;
  local: BrowserStorageArea;
  onChanged: BrowserStorageOnChanged;
}

interface BrowserAPI {
  storage: BrowserStorage;
}

declare global {
  var browser: BrowserAPI | undefined;
  var chrome: BrowserAPI | undefined;
}

export {};
