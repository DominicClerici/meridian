export {};

declare global {
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

  interface BrowserIdentity {
    launchWebAuthFlow(details: { url: string; interactive: boolean }): Promise<string>;
    getRedirectURL(): string;
  }

  interface BrowserAPI {
    storage: BrowserStorage;
    identity: BrowserIdentity;
  }

  var browser: BrowserAPI | undefined;
  var chrome: BrowserAPI | undefined;
}
