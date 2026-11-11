import { useEffect, useState } from 'react'
import { type DockApp } from './Dock'
import { changeDock, DOCK_CHANGED, DRAG_APP, DRAG_DOCK, loadDock } from './dock'
import { Icon } from './Icon'
import { t } from './i18n'

/**
 * Home: the apps as a grid of their art, as the phone's Home has them (the user, 11 Nov: "make the icon clickable, add a home
 * page with a grid of the apps … the photos applet that loads first is heavy": Tetra opens here, and Photos draws its
 * thousands of pictures only when it is chosen). The apps not on the dock, in its order; a badge where something waits;
 * the notifications at the top right. A tile dragged onto the dock goes there; a dock icon dropped here comes off the dock.
 */
export function HomePage({ apps, unread, notifications }: { apps: DockApp[]; unread: number; notifications: () => void }) {
  const [taking, setTaking] = useState(false) // a dock icon dragged over the grid
  // only the apps not on the dock (the user, 11 Nov: "like GNOME, the applets on the dock not at Home"): dragged onto the dock, an
  // app leaves Home; dragged back, it comes here again
  const [out, setOut] = useState(() => loadDock().out)
  useEffect(() => {
    const changed = () => setOut(loadDock().out)
    window.addEventListener(DOCK_CHANGED, changed)
    return () => window.removeEventListener(DOCK_CHANGED, changed)
  }, [])
  const all = apps.filter(a => out.includes(a.key))
  const keys = apps.map(a => a.key)
  return (
    <div className="home-page">
      <div className="home-head"><img src="./icon.png" alt="" /><h1>Tetra</h1>
        {/* notifications at the top right, as on the phone (the user, 11 Nov) */}
        <button className="round home-bell" title={t('app.notifications')} onClick={notifications}><Icon name="bell" size={22} />{unread > 0 && <span className="home-badge">{unread > 99 ? '99+' : unread}</span>}</button>
      </div>
      <div className={`home-grid ${taking ? 'taking' : ''}`}
        onDragOver={e => { if (e.dataTransfer.types.includes(DRAG_DOCK)) { e.preventDefault(); setTaking(true) } }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setTaking(false) }}
        onDrop={e => { const key = e.dataTransfer.getData(DRAG_DOCK); setTaking(false); if (key) { e.preventDefault(); changeDock(keys, key, false) } }}>
        {all.map(a => (
          <button key={a.key} className="home-app" onClick={a.open} title={a.label}
            draggable={a.key !== 'settings'} onDragStart={e => { e.dataTransfer.setData(DRAG_APP, a.key); e.dataTransfer.effectAllowed = 'copyMove' }}>
            <span className="home-art"><img src={`./apps/${a.key}.png`} alt="" draggable={false} />{a.badge > 0 && <span className="home-badge">{a.badge > 99 ? '99+' : a.badge}</span>}</span>
            <span className="home-label">{a.label}</span>
          </button>
        ))}
      </div>
      <p className="home-hint">{t('home.dockHint')}</p>
    </div>
  )
}
