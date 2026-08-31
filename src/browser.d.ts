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

  interface GetAuthTokenResult {
    token: string;
    grantedScopes?: string[];
  }

  interface BrowserIdentity {
    launchWebAuthFlow(details: { url: string; interactive: boolean }): Promise<string>;
    getRedirectURL(): string;
    getAuthToken(details: { interactive: boolean }): Promise<GetAuthTokenResult>;
    removeCachedAuthToken(details: { token: string }): Promise<void>;
  }

  interface HistoryItem {
    id: string;
    url?: string;
    title?: string;
    lastVisitTime?: number;
    visitCount?: number;
    typedCount?: number;
  }

  interface VisitItem {
    id: string;
    visitId: string;
    visitTime?: number;
    referringVisitId: string;
    transition: string;
  }

  /**
   * Both shapes: Chrome passes results to the callback and returns nothing,
   * Firefox ignores the callback and returns a promise. See `history-api.ts`.
   */
  interface BrowserHistory {
    search(
      query: { text: string; startTime?: number; endTime?: number; maxResults?: number },
      callback?: (results: HistoryItem[]) => void
    ): Promise<HistoryItem[]> | void;
    getVisits(
      details: { url: string },
      callback?: (results: VisitItem[]) => void
    ): Promise<VisitItem[]> | void;
  }

  interface BrowserAPI {
    storage: BrowserStorage;
    identity: BrowserIdentity;
    history: BrowserHistory;
  }

  var browser: BrowserAPI | undefined;
  var chrome: BrowserAPI | undefined;
}
