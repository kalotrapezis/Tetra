import { type DockApp } from './Dock'
import { t } from './i18n'

/**
 * Home: the apps as a grid of their art, as the phone's Home has them (the user, 11 Nov: "make the icon clickable, add a home
 * page with a grid of the apps … the photos applet that loads first is heavy": Tetra opens here, and Photos draws its
 * thousands of pictures only when it is chosen). The dock's apps in its order, Settings last; a badge where something waits.
 */
export function HomePage({ apps, settings }: { apps: DockApp[]; settings: () => void }) {
  const all = [...apps, { key: 'settings', icon: 'settings', label: t('app.settings'), on: false, badge: 0, open: settings } as DockApp]
  return (
    <div className="home-page">
      <div className="home-head"><img src="./icon.png" alt="" /><h1>Tetra</h1></div>
      <div className="home-grid">
        {all.map(a => (
          <button key={a.key} className="home-app" onClick={a.open} title={a.label}>
            <span className="home-art"><img src={`./apps/${a.key}.png`} alt="" draggable={false} />{a.badge > 0 && <span className="home-badge">{a.badge > 99 ? '99+' : a.badge}</span>}</span>
            <span className="home-label">{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
