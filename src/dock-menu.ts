/**
 * Editing a shortcut without leaving the page.
 *
 * The dock's right-click menu and the small editor it opens. The editor is
 * deliberately thin — name, address, icon — and hands anything beyond that to
 * the settings panel, which owns folders, moves and bulk work. Writes go
 * straight through the same pure operations `shortcut-settings.ts` uses, so the
 * two stay in step through the store rather than through shared code.
 */

import { createButton, createInput, createMenu, createPopover, showToast } from "./components"
import { icon as glyph } from "./icons/registry"
import { createIconPicker } from "./shortcut-icon-picker"
import { openSettings } from "./settings"
import { normalizeUrl } from "./url"
import {
  deleteItem,
  duplicateItem,
  editFolder,
  editShortcut,
  editShortcutInFolder,
  insertItem,
  locate,
} from "./shortcuts"
import type { IconSpec, Tab, TabItem } from "./shortcuts"

const SAVE_DEBOUNCE = 300

export type MenuHost = {
  getTabs(): Tab[]
  save(tabs: Tab[]): void
  getActiveTabId(): string | null
  navigate(url: string, newTab: boolean): void
  openFolder(anchor: HTMLElement, id: string): void
}

// ------------------------------------------------------------- inline editor

/**
 * A live editor: every keystroke lands in the store after a beat, so the tile
 * behind the popover updates as you type and there is no Save button to miss.
 * The debounce is flushed on close, which is what makes closing it safe.
 */
function openEditor(host: MenuHost, anchor: HTMLElement, itemId: string): void {
  const found = locate(host.getTabs(), itemId)
  if (!found) return

  const isFolder = found.item.type === "folder"
  let name = found.item.name
  let url = found.item.type === "shortcut" ? found.item.url : ""
  let spec: IconSpec | null = found.item.icon ?? null
  let timer = 0

  const root = document.createElement("div")
  root.className = "dock-edit"

  const heading = document.createElement("div")
  heading.className = "dock-edit-heading"
  heading.textContent = isFolder ? "Edit folder" : "Edit shortcut"
  root.appendChild(heading)

  const nameInput = createInput({
    placeholder: "Name",
    value: name,
    tone: "popover",
  }) as HTMLInputElement
  const urlInput = createInput({
    placeholder: "example.com",
    value: url,
    tone: "popover",
  }) as HTMLInputElement

  root.appendChild(field("Name", nameInput))
  if (!isFolder) root.appendChild(field("Address", urlInput))

  const picker = createIconPicker({
    target: { kind: isFolder ? "folder" : "shortcut", name, url },
    value: spec,
    onChange: (next) => {
      spec = next
      queue()
    },
  })
  root.appendChild(field("Icon", picker.el))

  const foot = document.createElement("div")
  foot.className = "dock-edit-foot"

  const more = createButton("All settings", "ghost", {
    tone: "popover",
    onClick: () => {
      flush()
      close()
      openSettings("shortcuts")
    },
  })
  const done = createButton("Done", "primary", {
    tone: "popover",
    onClick: () => {
      flush()
      close()
    },
  })
  foot.appendChild(more)
  foot.appendChild(done)
  root.appendChild(foot)

  function field(label: string, control: HTMLElement): HTMLElement {
    const wrap = document.createElement("label")
    wrap.className = "dock-edit-field"
    const cap = document.createElement("span")
    cap.className = "dock-edit-label"
    cap.textContent = label
    wrap.appendChild(cap)
    wrap.appendChild(control)
    return wrap
  }

  function queue(): void {
    clearTimeout(timer)
    timer = window.setTimeout(flush, SAVE_DEBOUNCE)
  }

  /** The only writer. Re-locates every time — the item may have moved. */
  function flush(): void {
    clearTimeout(timer)
    const tabs = host.getTabs()
    const at = locate(tabs, itemId)
    if (!at) return

    const trimmed = name.trim() || at.item.name

    if (at.item.type === "folder") {
      host.save(editFolder(tabs, at.tab.id, itemId, trimmed, spec ?? undefined))
      return
    }

    // An address that doesn't normalize is a half-typed one — keep it on screen
    // and keep the stored value as it was rather than writing junk.
    const next = normalizeUrl(url) ? url : at.item.url
    urlInput.classList.toggle("is-invalid", !normalizeUrl(url))

    const res = at.folder
      ? editShortcutInFolder(
          tabs, at.tab.id, at.folder.id, itemId, trimmed, next, spec ?? undefined
        )
      : editShortcut(tabs, at.tab.id, itemId, trimmed, next, spec ?? undefined)
    host.save(res.tabs)
  }

  nameInput.addEventListener("input", () => {
    name = nameInput.value
    picker.setTarget({ kind: isFolder ? "folder" : "shortcut", name, url })
    queue()
  })
  urlInput.addEventListener("input", () => {
    url = urlInput.value
    picker.setTarget({ kind: "shortcut", name, url })
    queue()
  })

  const { close } = createPopover(anchor, root, {
    modal: true,
    position: "above-center",
    onClose: flush,
  })

  requestAnimationFrame(() => nameInput.select())
}

// ---------------------------------------------------------------- the menu

export function openDockMenu(host: MenuHost, anchor: HTMLElement, item: TabItem): void {
  const tabId = host.getActiveTabId()
  if (!tabId) return

  const isFolder = item.type === "folder"
  const mi = (name: string) => glyph(name, { size: 14 })

  createMenu(anchor, [
    isFolder
      ? {
          label: "Open folder",
          icon: mi("folder"),
          onClick: () => host.openFolder(anchor, item.id),
        }
      : {
          label: "Open",
          icon: mi("externalLink"),
          onClick: () => host.navigate(item.url, false),
        },
    ...(isFolder
      ? []
      : [
          {
            label: "Open in new tab",
            icon: mi("tab"),
            onClick: () => host.navigate(item.url, true),
          },
        ]),
    "separator",
    {
      label: "Edit…",
      icon: mi("edit"),
      onClick: () => openEditor(host, anchor, item.id),
    },
    {
      label: "Duplicate",
      icon: mi("copy"),
      onClick: () => {
        const tabs = host.getTabs()
        const at = locate(tabs, item.id)
        if (!at || at.folder) return
        const res = insertItem(tabs, tabId, duplicateItem(item), at.index + 1)
        host.save(res.tabs)
        if (!res.ok && res.reason) showToast(res.reason, { variant: "danger" })
      },
    },
    "separator",
    {
      label: "Remove",
      icon: mi("trash"),
      danger: true,
      onClick: () => {
        const before = host.getTabs()
        host.save(deleteItem(before, tabId, item.id))
        showToast(`Removed ${item.name}`, {
          action: { label: "Undo", onClick: () => host.save(before) },
        })
      },
    },
  ])
}
