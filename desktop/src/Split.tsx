import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { type DockApp } from './Dock'
import { Icon } from './Icon'
import { t } from './i18n'

/**
 * Split view, from Tetra Car (the user, 11 Nov: "the layout button … at the bottom of the dock so we can have split view or
 * expose; left click select a layout other than single pane and expose appears, right click … back to single view"). The
 * same layouts as the car's: one pane, 60/40, half and half, a half and two quarters.
 */
export type Layout = 'full' | 'wide' | 'half' | 'three'
export const WEIGHTS: Record<Layout, number[]> = { full: [1], wide: [0.6, 0.4], half: [0.5, 0.5], three: [0.5, 0.25, 0.25] }

/** The layout, the side panes' apps, kept on this computer. */
export function loadSplit(): { layout: Layout; panes: string[] } {
  try {
    const v = JSON.parse(localStorage.getItem('split') ?? 'null')
    return { layout: v?.layout in WEIGHTS ? v.layout : 'full', panes: Array.isArray(v?.panes) ? v.panes.filter((k: unknown) => typeof k === 'string') : [] }
  } catch { return { layout: 'full', panes: [] } }
}
export function saveSplit(layout: Layout, panes: string[]) { try { localStorage.setItem('split', JSON.stringify({ layout, panes })) } catch {} }

/** The layout as a little drawing of its panes. */
function Shape({ layout }: { layout: Layout }) {
  return <span className="layout-shape">{WEIGHTS[layout].map((w, i) => <i key={i} style={{ flex: w }} />)}</span>
}

/** The dock's layout button: a left click shows the layouts (choosing one opens expose), a right click goes back to one pane. */
export function LayoutButton({ layout, choose, single }: { layout: Layout; choose: (l: Layout) => void; single: () => void }) {
  const [menu, setMenu] = useState<{ left: number; bottom: number } | null>(null)
  useEffect(() => {
    if (!menu) return
    const away = (e: MouseEvent) => { if (!(e.target as Element).closest?.('.layout-menu, .layout-button')) setMenu(null) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    document.addEventListener('mousedown', away); window.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc) }
  }, [menu])
  return <>
    <button className={`nav-item layout-button ${layout !== 'full' ? 'active' : ''}`} title={t('layout.button')}
      onClick={e => { if (menu) return setMenu(null); const r = e.currentTarget.getBoundingClientRect(); setMenu({ left: r.right + 12, bottom: Math.max(12, innerHeight - r.bottom) }) }}
      onContextMenu={e => { e.preventDefault(); setMenu(null); single() }}>
      <Icon name="layout" /><span>{t('layout.name')}</span></button>
    {menu && createPortal(
      <div className="island menu-body layout-menu" style={menu}>
        {(['wide', 'half', 'three'] as Layout[]).map(l => (
          <button key={l} className={`layout-choice ${layout === l ? 'on' : ''}`} onClick={() => { setMenu(null); choose(l) }}><Shape layout={l} /></button>
        ))}
      </div>, document.body)}
  </>
}

/**
 * Expose: over each pane, the apps to choose for it (the car's: a tap in each pane puts that app there; one already in another
 * pane changes places with it). The first pane takes any app, the others the ones that stand alone; Done or Esc closes it.
 */
export function Expose({ layout, apps, current, side, choose, done }: {
  layout: Layout; apps: DockApp[]; current: string[]; side: Set<string>; choose: (pane: number, key: string) => void; done: () => void
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') done() }
    window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc)
  }, [done])
  return (
    <div className="expose">
      {WEIGHTS[layout].map((w, i) => (
        <div key={i} className="expose-pane island" style={{ flex: w }}>
          <div className="expose-grid">
            {apps.filter(a => i === 0 || side.has(a.key)).map(a => (
              <button key={a.key} className={`expose-app ${current[i] === a.key ? 'on' : ''}`} onClick={() => choose(i, a.key)} title={a.label}>
                <img src={`./apps/${a.key}.png`} alt="" draggable={false} /><span>{a.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <button className="filled-button expose-done" onClick={done}>{t('common.done')}</button>
      <p className="expose-hint">{t('layout.hint')}</p>
    </div>
  )
}
