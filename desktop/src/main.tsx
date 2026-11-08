import { lazy, Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { FirstStart } from './Role'
import { lang } from './i18n'
import './styles.css'

// The app's code is fetched only when the window is open: closed to the tray (#tray, main.js loadPage) only the bells run
const App = lazy(() => import('./App').then(m => ({ default: m.App })))
const TimerBell = lazy(() => import('./Timer').then(m => ({ default: m.TimerBell })))
const PillsChime = lazy(() => import('./Pills').then(m => ({ default: m.PillsChime })))

document.documentElement.lang = lang()
/** The app once this computer knows whether it is the server or a client; the question before that. */
function Root() {
  const [role, setRole] = useState<string | null | undefined>(undefined)
  useEffect(() => { window.drive.role.get().then(r => setRole(r.role)) }, [])
  if (role === undefined) return null
  return role ? <Suspense fallback={null}><App /></Suspense> : <FirstStart onDone={setRole} />
}

createRoot(document.getElementById('root')!).render(location.hash === '#tray'
  ? <Suspense fallback={null}><TimerBell /><PillsChime /></Suspense>
  : <Root />)
