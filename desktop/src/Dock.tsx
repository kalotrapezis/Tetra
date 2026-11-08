import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Modal } from './Dialogs'
import { Icon, type IconName } from './Icon'
import { t } from './i18n'
import { loadDock, move, ordered, saveDock, split, type DockMode, type DockPrefs } from './dock'

export type DockApp = { key: string; icon: IconName; label: string; on: boolean; badge: number; open: () => void }

/** The side dock: apps that fit, the rest under ⋯, ✎ to choose; pinned, hidden until the mouse reaches the window's edge,
 *  or behind a small handle (the user, 8 Nov). */
export function Dock({ apps, head, bottom, foot }: { apps: DockApp[]; head: ReactNode; bottom: ReactNode; foot: ReactNode }) {
  const [prefs, setPrefs] = useState<DockPrefs>(loadDock)
  const [fit, setFit] = useState(99)
  const [open, setOpen] = useState(false) // shown, in the auto-hide and handle modes
  const [editing, setEditing] = useState(false)
  const [menu, setMenu] = useState<{ left: number; bottom: number; maxHeight: number } | null>(null) // ⋯ open: beside the dock, from its own row up
  const box = useRef<HTMLDivElement>(null), nav = useRef<HTMLElement>(null), moreBody = useRef<HTMLDivElement>(null)
  const hide = useRef<number>(undefined)
  const update = (p: DockPrefs) => { setPrefs(p); saveDock(p) }
  const floating = prefs.mode !== 'pinned'
  const later = () => { clearTimeout(hide.current); hide.current = window.setTimeout(() => setOpen(false), 350) }

  // how many apps fit in the window's height; an item's height is read from the dock itself
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      const item = el.querySelector<HTMLElement>('.nav-item')
      const h = (item?.offsetHeight ?? 48) + 4
      setFit(Math.max(1, Math.floor((el.clientHeight + 4) / h)))
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el); measure()
    return () => ro.disconnect()
  }, [prefs.labels])

  // a click outside closes ⋯, and the dock behind its handle
  useEffect(() => {
    if (!menu && !(prefs.mode === 'handle' && open)) return
    const away = (e: MouseEvent) => {
      const el = e.target as Element
      if (moreBody.current?.contains(el) || el.closest?.('.dock-more, .dock-nipple, dialog')) return
      setMenu(null)
      if (prefs.mode === 'handle' && !nav.current?.contains(el)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [menu, prefs.mode, open])

  const { shown, more: rest } = split(apps, prefs, fit)
  const pick = (a: DockApp) => { a.open(); setMenu(null); if (floating) setOpen(false) }
  const item = (a: DockApp) => (
    <button key={a.key} className={`nav-item ${a.on ? 'active' : ''}`} title={a.label} onClick={() => pick(a)}>
      <Icon name={a.icon} /><span>{a.label}</span>{!a.on && a.badge > 0 && <span className="badge-count">{a.badge}</span>}</button>
  )
  const restBadge = rest.reduce((n, a) => n + (a.on ? 0 : a.badge), 0)
  const toggleMenu = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (menu) return setMenu(null)
    const r = e.currentTarget.getBoundingClientRect()
    const bottom = Math.max(12, innerHeight - r.bottom)
    setMenu({ left: r.right + 16, bottom, maxHeight: innerHeight - bottom - 12 })
  }

  return <>
    {prefs.mode === 'autohide' && <div className="dock-edge" onMouseEnter={() => { clearTimeout(hide.current); setOpen(true) }} />}
    {prefs.mode === 'handle' && !open && <button className="dock-nipple" title={t('dock.show')} onClick={() => setOpen(true)} />}
    <nav ref={nav} className={`rail island ${prefs.labels ? '' : 'icons'} ${floating ? 'floating' : ''} ${floating && !open ? 'away' : ''}`}
      onMouseEnter={() => clearTimeout(hide.current)}
      onMouseLeave={() => { if (prefs.mode === 'autohide' && !editing && !menu) later() }}>
      {head}
      <div className="rail-apps" ref={box}>
        {shown.map(item)}
        <button className={`nav-item dock-more ${rest.some(a => a.on) ? 'active' : ''} ${menu ? 'open' : ''}`} title={t('dock.more')} onClick={toggleMenu}>
          <Icon name="more" /><span>{t('dock.more')}</span>{restBadge > 0 && <span className="badge-count">{restBadge}</span>}</button>
      </div>
      {bottom}
      {foot}
    </nav>
    {/* in <body>, not the dock: its blur would make it the frame of anything fixed inside it */}
    {menu && createPortal(
      <div ref={moreBody} className={`island menu-body dock-more-body ${prefs.labels ? '' : 'icons'}`} style={menu}
        onMouseEnter={() => clearTimeout(hide.current)} onMouseLeave={() => { if (prefs.mode === 'autohide' && !nav.current?.matches(':hover')) { setMenu(null); later() } }}>
        {rest.map(item)}
        <button className="nav-item" onClick={() => { setMenu(null); setEditing(true) }}><Icon name="edit" /><span>{t('dock.edit')}</span></button>
      </div>, document.body)}
    {editing && <DockEditor apps={apps} prefs={prefs} onChange={update} onClose={() => { setEditing(false); if (prefs.mode === 'autohide') later() }} />}
  </>
}

function DockEditor({ apps, prefs, onChange, onClose }: { apps: DockApp[]; prefs: DockPrefs; onChange: (p: DockPrefs) => void; onClose: () => void }) {
  const list = ordered(apps, prefs.order), keys = list.map(a => a.key)
  const mode = (m: DockMode) => <label><input type="radio" name="dock-mode" checked={prefs.mode === m} onChange={() => onChange({ ...prefs, mode: m })} /> {t(`dock.mode.${m}`)}</label>
  return (
    <Modal onClose={onClose}>
      <h3>{t('dock.edit')}</h3>
      <small className="hint">{t('dock.editNote')}</small>
      <div className="dock-edit-list">
        {list.map((a, i) => (
          <div key={a.key} className="dock-edit-row">
            <label><input type="checkbox" checked={!prefs.out.includes(a.key)}
              onChange={e => onChange({ ...prefs, out: e.target.checked ? prefs.out.filter(k => k !== a.key) : [...prefs.out, a.key] })} />
              <Icon name={a.icon} size={20} />{a.label}</label>
            <button className="round" title={t('dock.up')} disabled={i === 0} onClick={() => onChange({ ...prefs, order: move(keys, a.key, -1) })}><Icon name="arrowUp" size={18} /></button>
            <button className="round flip" title={t('dock.down')} disabled={i === list.length - 1} onClick={() => onChange({ ...prefs, order: move(keys, a.key, 1) })}><Icon name="arrowUp" size={18} /></button>
          </div>
        ))}
      </div>
      <div className="dock-edit-opts">
      <span className="menu-head">{t('dock.look')}</span>
      <label><input type="checkbox" checked={!prefs.labels} onChange={e => onChange({ ...prefs, labels: !e.target.checked })} /> {t('dock.iconsOnly')}</label>
      <span className="menu-head">{t('dock.showing')}</span>
      {mode('pinned')}{mode('autohide')}{mode('handle')}
      </div>
      <div className="dialog-actions"><button className="text-button" onClick={onClose}>{t('common.done')}</button></div>
    </Modal>
  )
}
