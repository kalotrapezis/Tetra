import { useState } from 'react'
import { type DockApp } from './Dock'
import { changeDock, DRAG_APP, DRAG_DOCK } from './dock'
import { t } from './i18n'

/**
 * Home: the apps as a grid of their art, as the phone's Home has them (the user, 11 Nov: "make the icon clickable, add a home
 * page with a grid of the apps … the photos applet that loads first is heavy": Tetra opens here, and Photos draws its
 * thousands of pictures only when it is chosen). The dock's apps in its order, Settings last; a badge where something waits.
 * A tile dragged onto the dock stays there; a dock icon dropped here comes off the dock.
 */
export function HomePage({ apps, settings }: { apps: DockApp[]; settings: () => void }) {
  const [taking, setTaking] = useState(false) // a dock icon dragged over the grid
  const all = [...apps, { key: 'settings', icon: 'settings', label: t('app.settings'), on: false, badge: 0, open: settings } as DockApp]
  const keys = apps.map(a => a.key)
  return (
    <div className="home-page">
      <div className="home-head"><img src="./icon.png" alt="" /><h1>Tetra</h1></div>
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
