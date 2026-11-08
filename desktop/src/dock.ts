// The dock's choices, kept on this computer (not the library, so not synced): the apps' order, the ones the person keeps
// in the ⋯ menu, labels or icons only, and how it shows (the user, 8 Nov: "a dock, auto-hide at the screen's edge or a nipple").
export type DockMode = 'pinned' | 'autohide' | 'handle'
export type DockPrefs = { order: string[]; out: string[]; labels: boolean; mode: DockMode }

const KEY = 'dock'
export const DEFAULT_DOCK: DockPrefs = { order: [], out: [], labels: true, mode: 'pinned' }

export function loadDock(): DockPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (!v || typeof v !== 'object') return DEFAULT_DOCK
    return {
      order: Array.isArray(v.order) ? v.order.filter((k: unknown) => typeof k === 'string') : [],
      out: Array.isArray(v.out) ? v.out.filter((k: unknown) => typeof k === 'string') : [],
      labels: v.labels !== false,
      mode: v.mode === 'autohide' || v.mode === 'handle' ? v.mode : 'pinned',
    }
  } catch { return DEFAULT_DOCK }
}
export function saveDock(p: DockPrefs) { try { localStorage.setItem(KEY, JSON.stringify(p)) } catch {} }

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
