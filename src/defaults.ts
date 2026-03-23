import type { Tab } from "./shortcuts"
import type { Todo } from "./todos"

export type SyncSettings = {
  bgColor: "red" | "green" | "blue";
  searchEngine: "google" | "bing" | "yahoo" | "duckduckgo" | "ecosia" | "qwant" | "startpage";
  debounceSearch: boolean;
  clockEnabled: boolean;
  clockShowSeconds: boolean;
  clock24Hour: boolean;
  clockShowAmPm: boolean;
  clockShowDate: boolean;
  clockDateFormat: "long" | "short" | "abbr" | "numeric" | "numericShort";
  clockSize: "small" | "medium" | "large";
  todoEnabled: boolean;
  todoShowBadges: boolean;
  weatherEnabled: boolean;
  weatherUnit: "f" | "c";
};

export type LocalSettings = {
  shortcuts: Tab[]
  todos: Todo[]
  weatherLat: number | null
  weatherLon: number | null
}

export const syncDefaults: SyncSettings = {
  bgColor: "blue",
  searchEngine: "google",
  debounceSearch: false,
  clockEnabled: true,
  clockShowSeconds: false,
  clock24Hour: false,
  clockShowAmPm: true,
  clockShowDate: false,
  clockDateFormat: "long",
  clockSize: "medium",
  todoEnabled: true,
  todoShowBadges: true,
  weatherEnabled: true,
  weatherUnit: "f",
}

export const localDefaults: LocalSettings = {
  shortcuts: [],
  todos: [],
  weatherLat: null,
  weatherLon: null,
}
