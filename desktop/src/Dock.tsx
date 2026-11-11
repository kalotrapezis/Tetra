import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react'
import { type IconName } from './Icon'
import { changeDock, DEFAULT_DOCK, DOCK_CHANGED, DOCK_SIZES, DRAG_APP, DRAG_DOCK, loadDock, ordered, setDock, type DockPrefs } from './dock'
import { t } from './i18n'

export type DockApp = { key: string; icon: IconName; label: string; on: boolean; badge: number; open: () => void }

/**
 * The side dock, a normal dock (the user, 11 Nov): on Home always there, so it is seen; in an app hidden until the mouse
 * reaches the window's edge. What it holds is dragged: an app from Home's grid onto it, one of its own up or down, or back
 * onto Home's grid to take it off. Everything is on Home, so there is no ⋯; more than fit make the rows lower. As tall as its
 * apps, in the middle; its art's size, labels and showing in Settings › Dock.
 */
export function Dock({ apps, home, head, bottom, foot }: { apps: DockApp[]; home: boolean; head: ReactNode; bottom: ReactNode; foot: ReactNode }) {
  const [prefs, setPrefs] = useState<DockPrefs>(loadDock)
  const [open, setOpen] = useState(false) // shown, in an app
  // a drag (the user, 11 Nov: "animations … pushing the others when I drag one over, so I can see where it will land"): [drag] the
  // dock's own app being moved (null: one from Home), [at] the place it would take among the others; the others slide to make room
  const [drag, setDrag] = useState<string | null>(null)
  const [at, setAt] = useState<number | null>(null)
  const nav = useRef<HTMLElement>(null), box = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState(0) // the apps' height: more apps than fit make their rows lower, as a dock's icons shrink
  const hide = useRef<number>(undefined)
  // in an app: at the window's edge (or always there, Settings › Dock); on Home always there, so it is seen
  const floating = !home && prefs.mode !== 'pinned'
  const later = () => { clearTimeout(hide.current); hide.current = window.setTimeout(() => setOpen(false), 350) }

  useEffect(() => {
    const changed = () => setPrefs(loadDock())
    window.addEventListener(DOCK_CHANGED, changed)
    return () => window.removeEventListener(DOCK_CHANGED, changed)
  }, [])
  useEffect(() => { if (home) setOpen(false) }, [home])

  const shown = ordered(apps, prefs.order).filter(a => !prefs.out.includes(a.key))
  // the dock is as tall as its apps (a Mac's, the user, 11 Nov): the room for them is the window's height less the dock's other parts
  useLayoutEffect(() => {
    const el = box.current, dock = nav.current
    if (!el || !dock) return
    const measure = () => setRoom((dock.parentElement?.clientHeight ?? innerHeight) - 24 - (dock.offsetHeight - el.offsetHeight))
    const ro = new ResizeObserver(measure)
    if (dock.parentElement) ro.observe(dock.parentElement)
    measure()
    return () => ro.disconnect()
  }, [prefs.size, prefs.labels])
  // a row is its padding twice, the art (Home's, at the size chosen) and the 4px gap: the padding shrinks (to 3px) until they all fit
  const pad = room ? Math.max(3, Math.min(10, Math.floor((room / Math.max(1, shown.length) - 4 - prefs.size) / 2))) : 10
  const keys = apps.map(a => a.key)
  const pick = (a: DockApp) => { a.open(); if (floating) setOpen(false) }
  const dragged = (e: DragEvent) => e.dataTransfer.types.includes(DRAG_APP) || e.dataTransfer.types.includes(DRAG_DOCK)
  const others = drag ? shown.filter(a => a.key !== drag) : shown
  // the place under the pointer, from the rows' places as laid out (not as they slide), so it does not flicker
  const placeAt = (y: number) => {
    const el = box.current
    if (!el) return others.length
    const top = y - el.getBoundingClientRect().top + el.scrollTop
    const rows = [...el.querySelectorAll<HTMLElement>('[data-key]')].filter(r => r.dataset.key !== drag)
    const i = rows.findIndex(r => top < r.offsetTop + r.offsetHeight / 2)
    return i < 0 ? rows.length : i
  }
  const end = () => { setDrag(null); setAt(null) }
  const drop = (e: DragEvent) => {
    if (!dragged(e)) return
    e.preventDefault(); e.stopPropagation()
    const key = e.dataTransfer.getData(DRAG_APP) || e.dataTransfer.getData(DRAG_DOCK)
    const before = others.filter(a => a.key !== key)[at ?? placeAt(e.clientY)]?.key ?? null
    end()
    if (key) changeDock(keys, key, true, before)
  }
  // where each row slides while a drag is over the dock: to its place once the dragged app lands at [at]
  const row = (box.current?.querySelector<HTMLElement>('[data-key]')?.offsetHeight ?? 46) + 4
  const shift = (key: string, i: number) => {
    if (at === null) return 0
    if (key === drag) return at - i
    const j = drag ? others.findIndex(a => a.key === key) : i // its place among the others
    return (j < at ? j : j + 1) - i
  }
  const item = (a: DockApp, i: number) => (
    <button key={a.key} data-key={a.key} className={`nav-item ${a.on ? 'active' : ''} ${a.key === drag ? 'dragging' : ''}`} title={a.label} onClick={() => pick(a)}
      style={at !== null ? { transform: `translateY(${shift(a.key, i) * row}px)` } : undefined}
      draggable onDragStart={e => { e.dataTransfer.setData(DRAG_DOCK, a.key); e.dataTransfer.effectAllowed = 'move'; setDrag(a.key) }}
      onDragEnd={end}>
      <img className="dock-art" src={`./apps/${a.key}.png`} alt="" draggable={false} /><span>{a.label}</span>{!a.on && a.badge > 0 && <span className="badge-count">{a.badge}</span>}</button>
  )

  return <>
    {floating && <div className="dock-edge" onMouseEnter={() => { clearTimeout(hide.current); setOpen(true) }} />}
    <nav ref={nav} style={{ '--art': `${prefs.size}px` } as CSSProperties} className={`rail island ${prefs.labels ? '' : 'icons'} ${floating ? 'floating' : ''} ${floating && !open ? 'away' : ''} ${at !== null ? 'drop-on' : ''} ${at !== null && !drag ? 'adding' : ''}`}
      onMouseEnter={() => clearTimeout(hide.current)}
      onMouseLeave={() => { if (floating) later() }}
      onDragOver={e => { if (!dragged(e)) return; e.preventDefault(); const i = placeAt(e.clientY); if (i !== at) setAt(i) }}
      onDragLeave={e => { if (!nav.current?.contains(e.relatedTarget as Node)) setAt(null) }}
      onDrop={drop}>
      {head}
      <div className="rail-apps" ref={box} style={{ '--item-pad': `${pad}px`, '--row': `${row}px` } as CSSProperties}>
        {shown.map(item)}
      </div>
      {bottom}
      {foot}
    </nav>
  </>
}

/** Settings › Dock: the art's size, labels or icons only, how it shows in an app, and the dock as it was at first. */
export function DockSettings() {
  const [p, setP] = useState<DockPrefs>(loadDock)
  useEffect(() => {
    const changed = () => setP(loadDock())
    window.addEventListener(DOCK_CHANGED, changed)
    return () => window.removeEventListener(DOCK_CHANGED, changed)
  }, [])
  const change = (next: DockPrefs) => { setP(next); setDock(next) }
  return (
    <section className="settings-card island dock-settings">
      <h3>{t('dock.title')}</h3>
      <p className="hint">{t('home.dockHint')}</p>
      <span className="menu-head">{t('dock.size')}</span>
      <div className="dock-size">
        <img src="./apps/photos.png" alt="" style={{ width: DOCK_SIZES.min, height: DOCK_SIZES.min }} />
        <input type="range" min={DOCK_SIZES.min} max={DOCK_SIZES.max} step={2} value={p.size} onChange={e => change({ ...p, size: Number(e.target.value) })} />
        <img src="./apps/photos.png" alt="" style={{ width: DOCK_SIZES.max, height: DOCK_SIZES.max }} />
      </div>
      <span className="menu-head">{t('dock.look')}</span>
      <label><input type="checkbox" checked={!p.labels} onChange={e => change({ ...p, labels: !e.target.checked })} /> {t('dock.iconsOnly')}</label>
      <span className="menu-head">{t('dock.showing')}</span>
      <label><input type="radio" name="dock-mode" checked={p.mode !== 'pinned'} onChange={() => change({ ...p, mode: 'autohide' })} /> {t('dock.mode.autohide')}</label>
      <label><input type="radio" name="dock-mode" checked={p.mode === 'pinned'} onChange={() => change({ ...p, mode: 'pinned' })} /> {t('dock.mode.pinned')}</label>
      <div className="dialog-actions"><button className="text-button" onClick={() => change({ ...DEFAULT_DOCK })}>{t('dock.reset')}</button></div>
    </section>
  )
}
