// The dock's choices, kept on this computer (not the library, so not synced): the apps' order, the ones the person keeps
// in the ⋯ menu, labels or icons only, and how it shows (the user, 8 Nov: "a dock, auto-hide at the screen's edge or a nipple").
export type DockMode = 'pinned' | 'autohide' | 'handle'
export type DockPrefs = { order: string[]; out: string[]; labels: boolean; mode: DockMode; size: number }
/** The art's size in px (Settings › Dock, the user, 11 Nov: "make the dock resizable"). */
export const DOCK_SIZES = { min: 24, max: 48, standard: 36 } // 36 the default (the user, 11 Nov: "36 is good")

const KEY = 'dock'
// the dock holds the everyday apps at first; the rest are on Home (an app is in one of the two, as GNOME's dash and grid)
export const DEFAULT_DOCK: DockPrefs = { order: [], out: ['timer', 'pills', 'passwords', 'phone', 'messages', 'data', 'sync'], labels: true, mode: 'autohide', size: DOCK_SIZES.standard }

export function loadDock(): DockPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (!v || typeof v !== 'object') return DEFAULT_DOCK
    return {
      order: Array.isArray(v.order) ? v.order.filter((k: unknown) => typeof k === 'string') : [],
      out: Array.isArray(v.out) ? v.out.filter((k: unknown) => typeof k === 'string') : [],
      labels: v.labels !== false,
      mode: v.mode === 'pinned' ? 'pinned' : 'autohide', // in an app: always there, or at the window's edge (the old handle: the edge)
      size: Number.isFinite(v.size) ? Math.min(DOCK_SIZES.max, Math.max(DOCK_SIZES.min, Math.round(v.size))) : DOCK_SIZES.standard,
    }
  } catch { return DEFAULT_DOCK }
}
export function saveDock(p: DockPrefs) { try { localStorage.setItem(KEY, JSON.stringify(p)) } catch {} }

/** Home and the dock change the same choices (drag and drop): this event tells the other one. */
export const DOCK_CHANGED = 'tetra-dock-changed'
/** The drag's data types: an app from Home's grid, an app from the dock. */
export const DRAG_APP = 'application/x-tetra-app', DRAG_DOCK = 'application/x-tetra-dock'

/**
 * An app put on the dock (before [before], or last) or taken off it ([on] false): the whole new choice, as the dock is
 * dragged (the user, 11 Nov: "just drag and drop what apps the user wants on the dock like a normal dock").
 */
export function placed(p: DockPrefs, keys: string[], key: string, on: boolean, before?: string | null): DockPrefs {
  if (!on) return { ...p, out: p.out.includes(key) ? p.out : [...p.out, key] }
  const order = ordered(keys.map(k => ({ key: k })), p.order).map(a => a.key).filter(k => k !== key)
  const at = before ? order.indexOf(before) : -1
  order.splice(at < 0 ? order.length : at, 0, key)
  return { ...p, order, out: p.out.filter(k => k !== key) }
}
export function changeDock(keys: string[], key: string, on: boolean, before?: string | null) {
  saveDock(placed(loadDock(), keys, key, on, before))
  window.dispatchEvent(new Event(DOCK_CHANGED))
}

/** The apps in the person's order (new ones last, in their own order). */
export function ordered<T extends { key: string }>(apps: T[], order: string[]): T[] {
  const at = (k: string) => { const i = order.indexOf(k); return i < 0 ? order.length : i }
  return apps.map((a, i) => ({ a, i })).sort((x, y) => at(x.a.key) - at(y.a.key) || x.i - y.i).map(x => x.a)
}

/** Which apps sit in the dock and which in ⋯, when `fit` slots fit (⋯ takes one of them). */
export function split<T extends { key: string }>(apps: T[], prefs: DockPrefs, fit: number): { shown: T[]; more: T[] } {
  const all = ordered(apps, prefs.order)
  const inBar = all.filter(a => !prefs.out.includes(a.key)), out = all.filter(a => prefs.out.includes(a.key))
  const room = Math.max(0, fit - 1)
  return inBar.length <= room ? { shown: inBar, more: out } : { shown: inBar.slice(0, room), more: [...inBar.slice(room), ...out] }
}

/** Move one app up (-1) or down (+1); returns the whole new order. */
export function move(keys: string[], key: string, by: -1 | 1): string[] {
  const i = keys.indexOf(key), j = i + by
  if (i < 0 || j < 0 || j >= keys.length) return keys
  const next = [...keys];[next[i], next[j]] = [next[j], next[i]]
  return next
}
/** A change made in Settings › Dock: saved, and the dock and Home told. */
export function setDock(p: DockPrefs) { saveDock(p); window.dispatchEvent(new Event(DOCK_CHANGED)) }
