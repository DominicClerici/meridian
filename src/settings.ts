import { store } from "./store";
import type { SyncSettings } from "./defaults";

// Full string literals so Tailwind scanner finds them
const BG_CLASSES: Record<SyncSettings["bgColor"], string> = {
  red: "bg-red-500",
  green: "bg-green-500",
  blue: "bg-blue-500",
};

export function applyBgColor(color: SyncSettings["bgColor"]): void {
  document.body.classList.remove("bg-red-500", "bg-green-500", "bg-blue-500");
  document.body.classList.add(BG_CLASSES[color]);
}

export function initSettings(): void {
  const dialog = document.getElementById(
    "settings-dialog"
  ) as HTMLDialogElement;
  const openBtn = document.getElementById(
    "settings-open"
  ) as HTMLButtonElement;
  const closeBtn = document.getElementById(
    "settings-close"
  ) as HTMLButtonElement;
  const colorBtns =
    dialog.querySelectorAll<HTMLButtonElement>("[data-color]");

  openBtn.addEventListener("click", () => dialog.showModal());
  closeBtn.addEventListener("click", () => dialog.close());

  // Color button clicks
  colorBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const color = btn.dataset.color as SyncSettings["bgColor"];
      store.sync.set("bgColor", color);
    });
  });

  // Active button state
  function updateActiveButton(color: SyncSettings["bgColor"]): void {
    colorBtns.forEach((btn) => {
      const isActive = btn.dataset.color === color;
      btn.setAttribute("aria-pressed", String(isActive));
    });
  }

  updateActiveButton(store.sync.get("bgColor"));
  store.sync.subscribe("bgColor", updateActiveButton);
}
