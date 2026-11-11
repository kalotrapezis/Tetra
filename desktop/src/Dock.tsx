import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import { changeDock, DOCK_CHANGED, DRAG_APP, DRAG_DOCK, loadDock, ordered, type DockPrefs } from './dock'

export type DockApp = { key: string; icon: IconName; label: string; on: boolean; badge: number; open: () => void }

/**
 * The side dock, a normal dock (the user, 11 Nov): on Home always there, so it is seen; in an app hidden until the mouse
 * reaches the window's edge. What it holds is dragged: an app from Home's grid onto it, one of its own up or down, or back
 * onto Home's grid to take it off. Everything is on Home, so there is no ⋯; more than fit make the rows lower.
 */
export function Dock({ apps, home, head, bottom, foot }: { apps: DockApp[]; home: boolean; head: ReactNode; bottom: ReactNode; foot: ReactNode }) {
  const [prefs, setPrefs] = useState<DockPrefs>(loadDock)
  const [open, setOpen] = useState(false) // shown, in an app
  const [over, setOver] = useState<string | null>(null) // an app dragged over the dock: the item it would go before ('' the end)
  const nav = useRef<HTMLElement>(null), box = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState(0) // the apps' height: more apps than fit make their rows lower, as a dock's icons shrink
  const hide = useRef<number>(undefined)
  const floating = !home
  const later = () => { clearTimeout(hide.current); hide.current = window.setTimeout(() => setOpen(false), 350) }

  useEffect(() => {
    const changed = () => setPrefs(loadDock())
    window.addEventListener(DOCK_CHANGED, changed)
    return () => window.removeEventListener(DOCK_CHANGED, changed)
  }, [])
  useEffect(() => { if (home) setOpen(false) }, [home])

  const shown = ordered(apps, prefs.order).filter(a => !prefs.out.includes(a.key))
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setRoom(el.clientHeight))
    ro.observe(el); setRoom(el.clientHeight)
    return () => ro.disconnect()
  }, [])
  // a row is its padding twice, the 22px icon and the 4px gap: the padding shrinks (to 4px) until they all fit
  const pad = room ? Math.max(4, Math.min(12, Math.floor((room / Math.max(1, shown.length) - 4 - 22) / 2))) : 12
  const keys = apps.map(a => a.key)
  const pick = (a: DockApp) => { a.open(); if (floating) setOpen(false) }
  const dragged = (e: DragEvent) => e.dataTransfer.types.includes(DRAG_APP) || e.dataTransfer.types.includes(DRAG_DOCK)
  const drop = (e: DragEvent, before: string | null) => {
    if (!dragged(e)) return
    e.preventDefault(); e.stopPropagation()
    const key = e.dataTransfer.getData(DRAG_APP) || e.dataTransfer.getData(DRAG_DOCK)
    setOver(null)
    if (key && key !== before) changeDock(keys, key, true, before)
  }
  const item = (a: DockApp) => (
    <button key={a.key} className={`nav-item ${a.on ? 'active' : ''} ${over === a.key ? 'drop-before' : ''}`} title={a.label} onClick={() => pick(a)}
      draggable onDragStart={e => { e.dataTransfer.setData(DRAG_DOCK, a.key); e.dataTransfer.effectAllowed = 'move' }}
      onDragOver={e => { if (dragged(e)) { e.preventDefault(); e.stopPropagation(); setOver(a.key) } }}
      onDrop={e => drop(e, a.key)}>
      <Icon name={a.icon} /><span>{a.label}</span>{!a.on && a.badge > 0 && <span className="badge-count">{a.badge}</span>}</button>
  )

  return <>
    {floating && <div className="dock-edge" onMouseEnter={() => { clearTimeout(hide.current); setOpen(true) }} />}
    <nav ref={nav} className={`rail island ${prefs.labels ? '' : 'icons'} ${floating ? 'floating' : ''} ${floating && !open ? 'away' : ''} ${over !== null ? 'drop-on' : ''}`}
      onMouseEnter={() => clearTimeout(hide.current)}
      onMouseLeave={() => { if (floating) later() }}
      onDragOver={e => { if (dragged(e)) { e.preventDefault(); setOver(o => o ?? '') } }}
      onDragLeave={e => { if (!nav.current?.contains(e.relatedTarget as Node)) setOver(null) }}
      onDrop={e => drop(e, null)}>
      {head}
      <div className="rail-apps" ref={box} style={{ '--item-pad': `${pad}px` } as CSSProperties}>
        {shown.map(item)}
        {over === '' && <div className="dock-drop-end" />}
      </div>
      {bottom}
      {foot}
    </nav>
  </>
}
