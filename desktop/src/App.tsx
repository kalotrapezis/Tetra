import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { isScreenshot, matches, type Level, type Media } from './timeline'
import type { Analysis, Collection, DeviceFolder, MailCompose, MergeUndo, Person, VaultStatus } from './drive'
import { Icon, type IconName } from './Icon'
import { Timeline } from './Timeline'
import { Viewer } from './Viewer'
import { Collections } from './Collections'
import { CollectionPicker, Confirm, FolderPicker, NewCollection, errorText } from './Dialogs'
import type { FilesMode } from './Files'
import { AnalysisBar, ChooseCover, CombinePicker, MergeHistory, PeopleHistory, PeoplePage, RenamePerson, ReviewPage } from './People'
import { HiddenPage, VaultGate } from './Hidden'
import type { Hide } from './Editor'
import { OffloadDialog, SyncPage } from './Sync'
import { TimerBell, TimerPage } from './Timer'
import { PillsChime, PillsPage } from './Pills'
import { ContactsPage, preloadContacts } from './Contacts'
import { ImportDialog } from './Import'
import { GuidePanel, guideFirstTime, type GuideGo } from './Guide'
import { Dock, type DockApp } from './Dock'
import { HomePage } from './Home'
import { Expose, LayoutButton, loadSplit, saveSplit, WEIGHTS, type Layout } from './Split'
import { shownName } from './People'
import { t, tr } from './i18n'

// Pages are fetched when first opened, not at start: Mail, Maps (maplibre), Settings… cost nothing until used
const later = <T extends Record<string, any>, K extends keyof T>(load: () => Promise<T>, name: K) => lazy(() => load().then(m => ({ default: m[name] })))
const Files = later(() => import('./Files'), 'Files')
const TrashPage = later(() => import('./TrashPage'), 'TrashPage')
const MapView = later(() => import('./MapView'), 'MapView')
const Editor = later(() => import('./Editor'), 'Editor')
const NotesPage = later(() => import('./Notes'), 'NotesPage')
const CalendarPage = later(() => import('./Calendar'), 'CalendarPage')
const MailPage = later(() => import('./Mail'), 'MailPage')
const MapsPage = later(() => import('./Maps'), 'MapsPage')
const PhonePage = later(() => import('./Phone'), 'PhonePage')
const PasswordsPage = later(() => import('./Passwords'), 'PasswordsPage')
const MessagesPage = later(() => import('./Messages'), 'MessagesPage')
const DataPage = later(() => import('./Data'), 'DataPage')
const NotificationsPage = later(() => import('./Center'), 'NotificationsPage')
const SettingsPage = later(() => import('./Settings'), 'SettingsPage')
const AssistantPage = later(() => import('./Assistant'), 'AssistantPage')

type Page = { kind: 'home' } | { kind: 'photos' } | { kind: 'collections' } | { kind: 'collection'; id: string; name: string } | { kind: 'files'; mode: FilesMode; folder: string } | { kind: 'photoTrash' }
  | { kind: 'people' } | { kind: 'person'; id: string; name: string } | { kind: 'review' } | { kind: 'map'; focus?: string } | { kind: 'hidden' } | { kind: 'sync' } | { kind: 'notes'; open?: string } | { kind: 'calendar' } | { kind: 'mail' } | { kind: 'timer' } | { kind: 'pills' } | { kind: 'maps'; query?: string; at?: number } | { kind: 'assistant' } | { kind: 'contacts' } | { kind: 'phone' } | { kind: 'passwords' } | { kind: 'messages' } | { kind: 'data' } | { kind: 'notifications' } | { kind: 'settings'; start?: string; at?: number }

const SYSTEM: { id: string; key: string; icon: IconName; test: (m: Media) => boolean }[] = [
  { id: 'favorites', key: 'files.favorites', icon: 'heart', test: m => !!m.favorite },
  { id: 'videos', key: 'sync.kindVideos', icon: 'video', test: m => !!m.is_video },
  { id: 'screenshots', key: 'photos.screenshots', icon: 'screenshot', test: m => isScreenshot(m.path) },
  { id: 'documents', key: 'files.typeDocuments', icon: 'document', test: m => !!m.document },
]

const stored = (key: string, where: Storage = localStorage) => { try { return where.getItem(key) } catch { return null } }
const store = (key: string, value: string, where: Storage = localStorage) => { try { where.setItem(key, value) } catch {} }

export function App() {
  const [media, setMedia] = useState<Media[] | null>(null)
  const [collections, setCollections] = useState<Collection[]>([])
  const [folders, setFolders] = useState<DeviceFolder[]>([])
  const [members, setMembers] = useState<Set<string> | null>(null)
  const [root, setRoot] = useState('')
  const [scan, setScan] = useState<string | null>(() => t('photos.looking'))
  // Settings › Language reloads the page; it opens again where it was
  const [page, setPage] = useState<Page>(() => { const back = stored('reopen', sessionStorage); store('reopen', '', sessionStorage); return back === 'settings' ? { kind: 'settings' } : { kind: 'home' } }) // Home first: Photos draws its pictures only when chosen
  const [level, setLevel] = useState<Level>(() => (stored('level') as Level) || 'month')
  const [query, setQuery] = useState('')
  // These three describe the library, not this computer, so they come from the database and sync with the phone.
  const [hideScreenshots, setHideScreenshots] = useState(false)
  const [hideDocuments, setHideDocuments] = useState(false)
  const hiddenAlbums = collections.filter(c => c.hidden).map(c => c.id)
  const [hiddenAlbumShas, setHiddenAlbumShas] = useState<Set<string>>(new Set())
  const [trashCount, setTrashCount] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [open, setOpen] = useState<number | null>(null)
  // The photos the viewer pages through when it was opened from a map group; null is every item.
  const [scope, setScope] = useState<string[] | null>(null)
  const [dialog, setDialog] = useState<ReactNode>(null)
  const [toast, setToast] = useState<{ text: string; undo?: () => void; label?: string } | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [names, setNames] = useState<Record<string, string[]>>({})
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [vault, setVault] = useState<VaultStatus | null>(null)
  const [editing, setEditing] = useState<{ item: Media; hide?: Hide } | null>(null)
  const [unread, setUnread] = useState<Record<string, number>>({}) // per applet (notify()'s first word), so each shows its own
  const [nas, setNas] = useState(false) // a NAS rings no timer: nobody sits at it (Role.tsx)
  // the pill by the name (the user, 26 Oct): Alpha when set up as a client or a NAS (not yet tried with a second computer), else Beta
  const [alpha, setAlpha] = useState(false)
  useEffect(() => { window.drive.role.get().then(r => { setNas(r.nas); setAlpha(r.role === 'client' || r.nas) }) }, [])
  const [guide, setGuide] = useState(guideFirstTime) // the guide's panel beside the page: the first time, and from Settings › Guide
  useEffect(() => { const t = setTimeout(preloadContacts, 1500); return () => clearTimeout(t) }, []) // Contacts read ahead, so the page opens full (24 Oct)
  useEffect(() => {
    const count = () => window.drive.notifications.list().then(async l => {
      const by: Record<string, number> = {}
      for (const n of l) if (!n.read) by[n.applet ?? ''] = (by[n.applet ?? ''] ?? 0) + 1
      if (by[page.kind]) { await window.drive.notifications.read(page.kind); delete by[page.kind] } // its page open: seen
      setUnread(by)
    })
    count(); return window.drive.notifications.onChange(count)
  }, [page])

  // A drive is a collection of what is on it (sync.js driveMembers), on this PC only: photos leave it only by Remove.
  // In the sidebar under Drives, with its own Screenshots and Documents (drive:<id>:screenshots), to see what to delete.
  const [, driveId = null, driveFilter = null] = page.kind === 'collection' && page.id.startsWith('drive:') ? page.id.split(':') : []
  const custom = page.kind === 'collection' && !SYSTEM.some(s => s.id === page.id) ? (driveId ? `drive:${driveId}` : page.id) : null
  const mirror = custom === 'mirror' // the server's photos on a client: shown here, kept and arranged there
  const driveName = driveId ? collections.find(c => c.id === custom)?.name ?? t('photos.theDrive') : ''
  const memberSource = custom ? () => window.drive.members(custom) : page.kind === 'person' ? () => window.drive.people.shas(page.id) : null

  async function reload() {
    const [m, c, p, n, a, v, f] = await Promise.all([window.drive.list(), window.drive.collections(), window.drive.people.list(), window.drive.people.names(), window.drive.people.status(), window.drive.vault.status(), window.drive.folders.list()])
    setMedia(m); setCollections(c); setPeople(p); setNames(n); setAnalysis(a); setVault(v); setFolders(f)
    if (memberSource) setMembers(new Set(await memberSource()))
  }

  async function rescan() {
    setScan(t('photos.looking'))
    try { await window.drive.scan() } catch (e) { say(errorText(e)) }
    await reload()
    setScan(null)
  }

  useEffect(() => {
    window.drive.info().then(i => setRoot(i.photosRoot))
    // the library's list once Home is drawn and the window is idle (the user, 11 Nov: "the photos load in the background so they
    // don't burden the main thread"): Tetra answers at once, Photos finds its pictures there when opened
    const idleOk = typeof requestIdleCallback === 'function'
    const idle = idleOk ? requestIdleCallback(() => { reload() }, { timeout: 1500 }) : setTimeout(() => { reload() }, 200) as unknown as number
    const offSync = window.drive.sync.onReceived(() => reloadRef.current())
    const off = window.drive.onScanProgress(p => setScan(p.changed ? t('photos.adding', { n: p.changed }) : t('photos.checking', { n: p.done })))
    let wasRunning = false
    const offPeople = window.drive.people.onProgress(a => {
      setAnalysis(s => ({ ...s, ...a }))
      if (a.running) window.drive.people.list().then(setPeople) // people appear while analysis runs
      if (wasRunning && !a.running) reloadRef.current()
      wasRunning = a.running
    })
    rescan()
    return () => { off(); offPeople(); offSync(); if (idleOk) cancelIdleCallback(idle); else clearTimeout(idle) }
  }, [])

  const reloadRef = useRef(reload)
  reloadRef.current = reload
  useEffect(() => { store('level', level) }, [level])
  // "Free 22 GB?" from the tray or a notification opens here, whatever page is showing (SYNC_PLAN.md D3).
  // "2 files from Xiaomi 15": its click opens Files at From phone
  useEffect(() => window.drive.files.onOpenFolder(folder => setPage({ kind: 'files', mode: 'browse', folder })), [])
  // "The map of Cyprus is over 3 months old": its click opens Settings › Maps
  useEffect(() => window.drive.onOpenDevices(() => setPage({ kind: 'sync' })), [])
  useEffect(() => window.drive.onOpenPills(() => setPage({ kind: 'pills' })), [])
  // a mailto: link (Tetra the default email app, or a link in a mail): Mail, writing a new mail with its fields
  const [compose, setCompose] = useState<(MailCompose & { at: number }) | null>(null)
  useEffect(() => window.drive.mail.onCompose(c => { setPage({ kind: 'mail' }); setCompose({ ...c, at: Date.now() }) }), [])
  useEffect(() => window.drive.onOpenSettings(start => setPage({ kind: 'settings', start, at: Date.now() })), [])
  // AI Assist from anywhere: a shortcut or `tetra --assistant` (main assistantCommand); talk and live go to the page
  const [assistCommand, setAssistCommand] = useState<{ what: string; at: number } | null>(null)
  const pageKind = useRef(page.kind)
  pageKind.current = page.kind
  // the AI switch (ai.js): off, AI Assist is not in the sidebar and nothing opens it
  const [aiOn, setAiOn] = useState(false)
  useEffect(() => { const read = () => window.drive.ai.get().then(a => setAiOn(a.enabled)); read(); return window.drive.ai.onChange(read) }, [])
  useEffect(() => { if (!aiOn && page.kind === 'assistant') setPage({ kind: 'home' }) }, [aiOn])
  useEffect(() => window.drive.assistant.onCommand(what => {
    if (what === 'toggle' && pageKind.current === 'assistant') { window.drive.assistant.hide(); return }
    setPage({ kind: 'assistant' })
    if (what === 'talk' || what === 'live') setAssistCommand({ what, at: Date.now() })
  }), [])
  useEffect(() => window.drive.sync.onOffer(id => setDialog(<OffloadDialog deviceId={id} onClose={() => setDialog(null)} />)), [])
  useEffect(() => { window.drive.viewSettings().then(v => { setHideScreenshots(v.hideScreenshots); setHideDocuments(v.hideDocuments) }) }, [])
  useEffect(() => { window.drive.trashList().then(t => setTrashCount(t.length)).catch(() => {}) }, [page])
  useEffect(() => {
    Promise.all(hiddenAlbums.map(id => window.drive.members(id).catch(() => []))).then(lists => setHiddenAlbumShas(new Set(lists.flat())))
  }, [collections])
  useEffect(() => {
    setSelected(new Set()); setOpen(null); setScope(null); setMembers(null)
    if (memberSource) memberSource().then(m => setMembers(new Set(m)))
  }, [page])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), toast.undo ? 8000 : 4000); return () => clearTimeout(t) }, [toast])

  const items = useMemo(() => {
    if (!media) return []
    if (page.kind === 'photos') return query.trim() ? media.filter(m => matches({ path: `${m.path} ${(names[m.sha256] ?? []).join(' ')} ${m.place_names ?? ''} ${m.labels ?? ''}` }, query)) : media.filter(m => !(hideScreenshots && isScreenshot(m.path)) && !(hideDocuments && m.document) && !hiddenAlbumShas.has(m.sha256))
    if (page.kind === 'collection') {
      const system = SYSTEM.find(s => s.id === page.id)
      const test = driveFilter === 'screenshots' ? (m: Media) => isScreenshot(m.path) : driveFilter === 'documents' ? (m: Media) => !!m.document : () => true
      return system ? media.filter(system.test) : members ? media.filter(m => members.has(m.sha256) && test(m)) : []
    }
    if (page.kind === 'person') return members ? media.filter(m => members.has(m.sha256)) : []
    if (page.kind === 'map') return media.filter(m => m.latitude != null && m.longitude != null)
    return []
  }, [media, page, query, hideScreenshots, hideDocuments, hiddenAlbumShas, members, names, driveFilter])

  // Keep the viewer on a valid item when the list shrinks (trash, unfavorite in Favorites, remove from collection).
  useEffect(() => { if (open !== null && open >= items.length) setOpen(items.length ? items.length - 1 : null) }, [items, open])
  // By hash, so trashing one from the viewer does not shift the rest; mapped back to indices into items.
  const scoped = useMemo(() => {
    if (!scope) return null
    const at = new Map(items.map((m, i) => [m.sha256, i]))
    return scope.map(h => at.get(h)).filter((i): i is number => i !== undefined)
  }, [scope, items])
  useEffect(() => { if (scoped?.length === 0) { setOpen(null); setScope(null) } }, [scoped])

  const picked = items.filter(m => selected.has(m.id))
  /** A line at the bottom; [undo] a button on it, «Αναίρεση» or [label] («Εμφάνιση» after an export). */
  const say = (text: string, undo?: () => void, label?: string) => setToast({ text, undo, label })
  const close = () => setDialog(null)

  async function run(fn: () => Promise<unknown>, done?: string) {
    try { await fn(); if (done) say(done) } catch (e) { say(errorText(e)) }
    await reload()
  }

  const favorite = (list: Media[]) => {
    const on = !list.every(m => m.favorite)
    return run(() => window.drive.favorite(list.map(m => m.sha256), on), list.length > 1 ? t(on ? 'photos.addedFavorites' : 'photos.removedFavorites', { count: list.length }) : undefined)
  }

  function newCollection(then?: (c: Collection) => void) {
    setDialog(<NewCollection onClose={close} onCreate={async name => {
      const c = await window.drive.createCollection(name)
      await reload()
      if (then) then(c); else say(t('photos.created', { name: c.name }))
    }} />)
  }

  function collect(list: Media[]) {
    const add = (c: Collection) => run(() => window.drive.setMembership(c.id, list.map(m => m.sha256), true), t('photos.addedTo', { count: list.length, name: c.name }))
    setDialog(<CollectionPicker collections={collections} count={list.length} onClose={close} onPick={add} onNew={() => newCollection(add)} />)
  }

  // A collection that is a folder is not a grouping: taking a photo out of it moves the file (asked 2026-09-25).
  const folderAlbum = custom && page.kind === 'collection' && collections.find(c => c.id === custom)?.folder ? page.name : null
  function moveTo(list: Media[], leaving?: string) {
    setDialog(<FolderPicker count={list.length} leaving={leaving} onClose={close} onPick={dest => run(async () => {
      const r = await window.drive.moveTo(list.map(m => m.id), dest)
      setSelected(new Set())
      say(r.failed.length ? t('photos.movedSome', { moved: r.moved, failed: r.failed.length, list: r.failed.slice(0, 2).join(', ') }) : t('photos.movedTo', { count: r.moved, dest }))
    })} />)
  }
  const uncollect = (list: Media[]) => driveId && page.kind === 'collection' ? setDialog(
    <Confirm title={t('photos.takeOffTitle', { count: list.length, drive: driveName })} action={t('photos.takeOff')} danger onClose={close}
      body={t('photos.takeOffBody', { drive: driveName })}
      onConfirm={() => run(() => window.drive.setMembership(custom!, list.map(m => m.sha256), false), t('photos.tookOff', { count: list.length, drive: driveName })).then(() => setSelected(new Set()))} />)
    : folderAlbum ? moveTo(list, folderAlbum) : custom && page.kind === 'collection' &&
    run(() => window.drive.setMembership(custom, list.map(m => m.sha256), false), t('photos.removedFrom', { count: list.length, name: page.name }))
      .then(() => setSelected(new Set()))

  function trash(list: Media[]) {
    // In a drive's collection Delete is by hand and final for the library: to the purgatory, where it waits its days.
    if (driveId) return setDialog(<Confirm title={t('photos.deleteTitle', { count: list.length })} action={t('common.delete')} danger onClose={close}
      body={t('photos.deleteDriveBody', { drive: driveName })}
      onConfirm={() => run(async () => {
        const r = await window.drive.deleteFromDrive(driveId, list.map(m => m.sha256))
        setSelected(new Set())
        say(r.failed.length ? t('photos.deletedSome', { deleted: r.deleted, failed: r.failed.length, list: r.failed.slice(0, 2).join(', ') }) : t('photos.deletedToPurgatory', { count: r.deleted }))
      })} />)
    setDialog(<Confirm title={t('photos.trashTitle', { count: list.length })} action={t('photos.moveToTrash')} danger onClose={close}
      body={t('photos.trashBody')}
      onConfirm={() => run(async () => {
        const r = await window.drive.trash(list.map(m => m.id))
        setSelected(new Set())
        say(r.failed.length ? t('photos.trashedSome', { moved: r.trashed, failed: r.failed.length, list: r.failed.slice(0, 3).join(', ') }) : t('photos.trashed', { count: r.trashed }))
      })} />)
  }

  // Hidden needs the vault open: set it up or unlock it first, then encrypt, verify and remove the originals.
  function hide(list: Media[]) {
    const go = () => setDialog(<Confirm title={t('photos.hideTitle', { count: list.length })} action={t('viewer.toHidden')} onClose={close}
      body={t('photos.hideBody')}
      onConfirm={() => run(async () => {
        const r = await window.drive.vault.hide(list.map(m => m.id))
        setSelected(new Set())
        say(r.failed.length ? t('photos.hidSome', { hidden: r.hidden, failed: r.failed.length, first: r.failed[0] }) : t('photos.hid', { count: r.hidden }))
      })} />)
    if (vault?.unlocked) go()
    else if (vault) setDialog(<VaultGate status={vault} onClose={close} onOpen={async () => { setVault(await window.drive.vault.status()); go() }} />)
  }

  function deleteCollection(c: Collection) {
    setDialog(<Confirm title={t('photos.deleteCollectionTitle', { name: c.name })} action={t('photos.deleteCollection')} danger onClose={close}
      body={t('photos.deleteCollectionBody')} onConfirm={() => run(() => window.drive.deleteCollection(c.id), t('photos.deletedNamed', { name: c.name }))} />)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open !== null || dialog || editing || (e.target as Element).closest?.('input')) return
      if (e.key === 'Escape' && selected.size) setSelected(new Set())
      else if ((e.ctrlKey || e.metaKey) && e.key === 'a' && items.length) { e.preventDefault(); setSelected(new Set(items.map(m => m.id))) }
      else if (e.key === 'Delete' && picked.length) trash(picked)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const person = page.kind === 'person' ? people.find(p => p.id === page.id) : undefined
  function renamePerson(p: Person) {
    setDialog(<RenamePerson person={p} onClose={close} onDone={name => { setPage({ kind: 'person', id: p.id, name }); reload() }} />)
  }
  function combine(p: Person) {
    // Undo takes them back in the order they went in, so a face never lands in the wrong group on the way out.
    setDialog(<CombinePicker person={p} people={people} onClose={close} onPick={others => run(async () => {
      const undos: MergeUndo[] = []
      for (const other of others) undos.push(await window.drive.people.merge(other.id, p.id))
      const what = others.length === 1 ? shownName(others[0].name) : t('photos.nPeople', { count: others.length })
      say(t('photos.combinedInto', { what, name: shownName(p.name) }), () => run(async () => {
        for (const undo of undos.reverse()) await window.drive.people.undoMerge(undo)
      }, t('photos.combineUndone')))
    })} />)
  }

  const total = Object.values(unread).reduce((a, b) => a + b, 0)
  // split view (Split.tsx): the main page in the first pane, the side panes' apps beside it
  const [split, setSplit] = useState(loadSplit)
  const [expose, setExpose] = useState(false)
  useEffect(() => saveSplit(split.layout, split.panes), [split])
  const nav = (target: Page, active: boolean, icon: IconName, label: string) => (
    <button className={`nav-item ${active ? 'active' : ''}`} title={label} onClick={() => setPage(target)}><Icon name={icon} /><span>{label}</span>{!active && unread[target.kind] > 0 && <span className="badge-count">{unread[target.kind]}</span>}</button>
  )
  const filesMode = page.kind === 'files' && !(page.mode === 'browse' && page.folder.startsWith('Trash')) ? page.mode : null
  const inFilesTrash = page.kind === 'files' && page.mode === 'browse' && page.folder.startsWith('Trash')
  const section = page.kind === 'files' ? 'files' : driveId ? 'drive' : ['photos', 'collections', 'collection', 'people', 'person', 'review', 'map', 'hidden', 'photoTrash'].includes(page.kind) ? 'photos' : null
  // the dock's apps, in their default order; the person may reorder them or keep some under ⋯ (Dock.tsx)
  const app = (key: string, target: Page, on: boolean, icon: IconName, label: string): DockApp => ({ key, icon, label, on, badge: unread[target.kind] ?? 0, open: () => setPage(target) })
  const dockApps = [
    app('photos', { kind: 'photos' }, section === 'photos', 'photos', t('app.photos')),
    app('files', { kind: 'files', mode: 'browse', folder: '' }, section === 'files', 'drive', t('app.files')),
    app('mail', { kind: 'mail' }, page.kind === 'mail', 'mail', t('app.mail')),
    app('notes', { kind: 'notes' }, page.kind === 'notes', 'notes', t('app.notes')),
    app('calendar', { kind: 'calendar' }, page.kind === 'calendar', 'calendar', t('app.calendar')),
    app('timer', { kind: 'timer' }, page.kind === 'timer', 'timer', t('app.timer')),
    app('pills', { kind: 'pills' }, page.kind === 'pills', 'pill', t('app.pills')),
    app('maps', { kind: 'maps' }, page.kind === 'maps', 'map', t('app.maps')),
    app('contacts', { kind: 'contacts' }, page.kind === 'contacts', 'person', t('app.contacts')),
    app('passwords', { kind: 'passwords' }, page.kind === 'passwords', 'lock', t('app.passwords')),
    // Windows has no phone (the user, 11 Nov: "remove it, just Contacts"): no Phone, no calls
    ...(window.drive.platform === 'win32' ? [] : [app('phone', { kind: 'phone' }, page.kind === 'phone', 'call', t('app.phone'))]),
    app('messages', { kind: 'messages' }, page.kind === 'messages', 'chat', t('app.sms')),
    ...(aiOn ? [app('assistant', { kind: 'assistant' }, page.kind === 'assistant', 'sparkle', t('app.assistant'))] : []),
    app('data', { kind: 'data' }, page.kind === 'data', 'dataUsage', t('app.data')),
    app('sync', { kind: 'sync' }, page.kind === 'sync', 'refresh', t('app.devices')),
    // Settings a dock app as the others: dragged off, it is on Home (the user, 11 Nov)
    app('settings', { kind: 'settings' }, page.kind === 'settings', 'settings', t('app.settings')),
  ]
  const item = (target: Page, on: boolean, icon: IconName, label: string) => (
    <button className={`island-item ${on ? 'on' : ''}`} onClick={() => setPage(target)}><Icon name={icon} size={20} /><span>{label}</span></button>
  )
  const dock = section && (
    <div className="notes-dock"><nav className="notes-island island">
      {section === 'photos' && <>
        {item({ kind: 'photos' }, page.kind === 'photos', 'photos', t('app.gallery'))}
        {item({ kind: 'collections' }, page.kind !== 'photos', 'collections', t('app.collections'))}
        {/* a drive's photos (T7), here since the sidebar no longer lists the drives */}
        {collections.filter(c => c.drive).map(c => <Fragment key={c.id}>{item({ kind: 'collection', id: c.id, name: c.name }, false, 'database', c.name)}</Fragment>)}
        <span className="island-gap" />
        <button className="island-item" onClick={() => setDialog(<ImportDialog kind="photos" onClose={close} onDone={reload} />)}><Icon name="add" size={20} /><span>{t('common.import')}</span></button>
      </>}
      {section === 'files' && <>
        {item({ kind: 'files', mode: 'browse', folder: '' }, filesMode === 'browse', 'drive', t('files.drive'))}
        {item({ kind: 'files', mode: 'favorites', folder: '' }, filesMode === 'favorites', 'heart', t('files.favorites'))}
        {item({ kind: 'files', mode: 'recent', folder: '' }, filesMode === 'recent', 'recent', t('files.recent'))}
        {item({ kind: 'files', mode: 'browse', folder: 'Trash' }, inFilesTrash, 'trash', t('photos.trash'))}
        <span className="island-gap" />
        <button className="island-item" onClick={() => setDialog(<ImportDialog kind="files" onClose={close} onDone={() => setPage({ kind: 'files', mode: 'browse', folder: '' })} />)}><Icon name="add" size={20} /><span>{t('common.import')}</span></button>
      </>}
      {section === 'drive' && <>
        {item({ kind: 'collection', id: `drive:${driveId}`, name: driveName }, !driveFilter, 'photos', t('app.gallery'))}
        {item({ kind: 'collection', id: `drive:${driveId}:screenshots`, name: `${driveName} · ${t('photos.screenshots')}` }, driveFilter === 'screenshots', 'screenshot', t('photos.screenshots'))}
        {item({ kind: 'collection', id: `drive:${driveId}:documents`, name: `${driveName} · ${t('files.typeDocuments')}` }, driveFilter === 'documents', 'document', t('files.typeDocuments'))}
      </>}
    </nav></div>
  )

  const loading = !media || (media.length === 0 && scan)
  const mainKey = section === 'photos' ? 'photos' : page.kind
  const sideKeys = new Set(SIDE.filter(k => k !== 'phone' || window.drive.platform !== 'win32'))
  const paneCount = WEIGHTS[split.layout].length
  const sideApps = Array.from({ length: paneCount - 1 }, (_, i) => split.panes[i] ?? null)
  /** An app chosen in expose for a pane: one already in another pane changes places with it. */
  function choosePane(pane: number, key: string) {
    const now: (string | null)[] = [mainKey, ...sideApps]
    const was = now[pane], other = now.findIndex((k, i) => i !== pane && k === key)
    const next = [...now]; next[pane] = key
    if (other >= 0) next[other] = other === 0 || (was && sideKeys.has(was)) ? was : null
    if (next[0] !== mainKey && next[0]) dockApps.find(a => a.key === next[0])?.open()
    setSplit(s => ({ ...s, panes: next.slice(1).map(k => k ?? '') }))
  }
  /** A side pane's app: the ones that stand alone (Photos needs the library's state here, so it stays in the first pane). */
  const paneContent = (k: string): ReactNode => {
    switch (k) {
      case 'files': return <SideFiles setDialog={setDialog} say={say} />
      case 'mail': return <MailPage setDialog={setDialog} say={say} />
      case 'notes': return <NotesPage setDialog={setDialog} say={say} />
      case 'calendar': return <CalendarPage setDialog={setDialog} say={say} />
      case 'timer': return <TimerPage say={say} />
      case 'pills': return <PillsPage say={say} openSettings={() => setPage({ kind: 'settings', start: 'pills', at: Date.now() })} />
      case 'maps': return <MapsPage say={say} onMakeMap={() => setPage({ kind: 'settings' })} />
      case 'phone': return <PhonePage say={say} />
      case 'messages': return <MessagesPage say={say} />
      case 'data': return <DataPage />
      case 'passwords': return <PasswordsPage setDialog={setDialog} say={say} />
      case 'contacts': return <ContactsPage setDialog={setDialog} say={say} openPerson={(id, name) => setPage({ kind: 'person', id, name })} />
      case 'assistant': return <AssistantPage command={assistCommand} go={g => setPage(g.usage ? { kind: 'settings', start: 'assistant', at: Date.now() } : g.note ? { kind: 'notes', open: g.note } : { kind: 'maps', query: g.maps, at: Date.now() })} />
      case 'sync': return <SyncPage setDialog={setDialog} />
      case 'settings': return <SettingsPage onGuide={() => setGuide(true)} />
    }
    return null
  }
  let content: ReactNode
  // Pages that do not depend on the photo library come first: an empty library must not hide Devices, Files or Hidden.
  if (page.kind === 'home') content = <HomePage apps={dockApps} unread={total} notifications={() => setPage({ kind: 'notifications' })}
    library={scan ?? t('photos.itemsTotal', { count: media?.length ?? 0 })} scanning={!!scan} rescan={rescan} />
  else if (page.kind === 'files') content = <Files mode={page.mode} folder={page.folder} go={(mode, folder) => setPage({ kind: 'files', mode, folder })} setDialog={setDialog} say={say} dock={dock} />
  else if (page.kind === 'sync') content = <SyncPage setDialog={setDialog} />
  else if (page.kind === 'notes') content = <NotesPage key={page.open} openId={page.open} setDialog={setDialog} say={say} />
  else if (page.kind === 'assistant') content = <AssistantPage command={assistCommand}
    go={g => setPage(g.usage ? { kind: 'settings', start: 'assistant', at: Date.now() } : g.note ? { kind: 'notes', open: g.note } : { kind: 'maps', query: g.maps, at: Date.now() })} />
  else if (page.kind === 'calendar') content = <CalendarPage setDialog={setDialog} say={say} />
  else if (page.kind === 'mail') content = <MailPage setDialog={setDialog} say={say} compose={compose} />
  else if (page.kind === 'timer') content = <TimerPage say={say} />
  else if (page.kind === 'pills') content = <PillsPage say={say} openSettings={() => setPage({ kind: 'settings', start: 'pills', at: Date.now() })} />
  // Maps with no map: Settings › Maps with the builder open
  else if (page.kind === 'maps') content = <MapsPage key={page.at} initial={page.query} say={say} onMakeMap={() => {
    try { localStorage.setItem('settingsTab', 'maps'); sessionStorage.setItem('openMapBuilder', '1') } catch {}
    setPage({ kind: 'settings' })
  }} />
  else if (page.kind === 'phone') content = <PhonePage say={say} />
  else if (page.kind === 'messages') content = <MessagesPage say={say} />
  else if (page.kind === 'data') content = <DataPage />
  else if (page.kind === 'passwords') content = <PasswordsPage setDialog={setDialog} say={say} />
  else if (page.kind === 'contacts') content = <ContactsPage setDialog={setDialog} say={say} openPerson={(id, name) => setPage({ kind: 'person', id, name })} />
  else if (page.kind === 'notifications') content = <NotificationsPage go={kind => setPage({ kind })} say={say} />
  else if (page.kind === 'settings') content = <SettingsPage key={page.at} start={page.start} onGuide={() => setGuide(true)} />
  else if (page.kind === 'photoTrash') content = <TrashPage onBack={() => setPage({ kind: 'collections' })} setDialog={setDialog} say={say} onChanged={reload} />
  else if (page.kind === 'hidden') content = <HiddenPage onBack={() => setPage({ kind: 'collections' })} setDialog={setDialog} say={say} onChanged={reload} />
  else if (loading) content = <div className="empty">{t('common.loading')}</div>
  else if (media.length === 0) content = <div className="empty"><p>{tr('photos.emptyLibrary', { root: <code>{root}</code>, devices: <b>{t('app.devices')}</b> })}</p></div>
  else if (page.kind === 'people') content = <PeoplePage people={people} status={analysis} onBack={() => setPage({ kind: 'collections' })}
    onOpen={p => setPage({ kind: 'person', id: p.id, name: p.name })}
    onRename={p => setDialog(<RenamePerson person={p} onClose={close} onDone={reload} />)}
    onChooseCover={p => setDialog(<ChooseCover person={p} onClose={close} onDone={reload} />)}
    onForget={p => run(() => window.drive.people.setHidden(p.id, true), t('photos.forgotten', { name: shownName(p.name) }))}
    onHistory={() => setDialog(<PeopleHistory onClose={close} onChanged={reload} />)} />
  else if (page.kind === 'map') content = <MapView items={items} focus={page.focus} onOpen={(i, group) => { setScope(group ? group.map(g => items[g].sha256) : null); setOpen(i) }} onBack={() => setPage({ kind: 'collections' })} />
  else if (page.kind === 'review') content = <ReviewPage left={analysis?.reviews ?? 0} onBack={() => setPage({ kind: 'collections' })} onChanged={reload} />
  else if (page.kind === 'collections') {
    content = <Collections mine={collections} onNew={() => newCollection()} onDelete={deleteCollection}
      system={[
        { id: 'people', name: t('people.title'), icon: 'person' as IconName, count: people.length },
        ...SYSTEM.map(s => ({ ...s, name: t(s.key), count: media.filter(s.test).length })),
        { id: 'hidden', name: t('hidden.title'), icon: 'lock' as IconName, count: vault?.count ?? 0 },
        { id: 'map', name: t('maps.photoMap'), icon: 'map' as IconName, count: media.filter(m => m.latitude != null).length },
        { id: 'review', name: t('people.helpOrganize'), icon: 'tag' as IconName, count: analysis?.reviews ?? 0 },
        { id: 'photoTrash', name: t('photos.trash'), icon: 'trash' as IconName, count: trashCount },
      ]}
      onOpen={(id, name) => setPage(id === 'people' ? { kind: 'people' } : id === 'review' ? { kind: 'review' } : id === 'map' ? { kind: 'map' } : id === 'hidden' ? { kind: 'hidden' } : id === 'photoTrash' ? { kind: 'photoTrash' } : { kind: 'collection', id, name })} />
  } else {
    const inCollection = page.kind === 'collection' || page.kind === 'person'
    content = (
      <Timeline items={items} level={level} setLevel={setLevel} selected={selected} setSelected={setSelected} onOpen={setOpen}
        title={page.kind === 'person'
          ? <><button className="round flat" title={t('photos.backToPeople')} onClick={() => setPage({ kind: 'people' })}><Icon name="back" /></button><h1>{shownName(page.name)}</h1></>
          : inCollection
          ? <>{!driveId && <button className="round flat" title={t('collections.backTo')} onClick={() => setPage({ kind: 'collections' })}><Icon name="back" /></button>}<h1>{driveId ? driveName : page.name}</h1></>
          : <h1>{t('app.photos')}</h1>}
        banner={undefined /* "Find documents" hidden for now: desktop increasingly just receives the phone's classification via sync, SYNC_PLAN.md phase 6a */}
        empty={query ? t('photos.noMatch', { query }) : inCollection ? t('photos.nothingHere') : t('photos.allHidden')}
        tools={!inCollection && <>
          <label className="island search">
            <Icon name="search" size={20} />
            <input placeholder={t('photos.searchPlaceholder')} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setQuery('') }} />
            {query && <button className="eraser" title={t('photos.clearSearch')} onClick={() => setQuery('')}><Icon name="eraser" size={20} /></button>}
          </label>
          <details className="menu">
            <summary className="round" title={t('photos.tools')}><Icon name="tune" /></summary>
            <div className="island menu-body">
              <strong>{t('photos.hideFrom')}</strong>
              <small>{t('photos.hideFromNote')}</small>
              <span className="menu-head">{t('photos.systemAlbums')}</span>
              <label><input type="checkbox" checked={hideScreenshots} onChange={e => { setHideScreenshots(e.target.checked); window.drive.setViewSetting('hideScreenshots', e.target.checked) }} /> {t('photos.screenshots')}</label>
              <label><input type="checkbox" checked={hideDocuments} onChange={e => { setHideDocuments(e.target.checked); window.drive.setViewSetting('hideDocuments', e.target.checked) }} /> {t('files.typeDocuments')}</label>
              <span className="menu-head">{t('photos.myAlbums')}</span>
              {collections.length === 0 && <small>{t('photos.noAlbums')}</small>}
              {collections.filter(c => !c.drive).map(c => (
                <label key={c.id}><input type="checkbox" checked={c.hidden}
                  onChange={e => window.drive.setCollectionHidden(c.id, e.target.checked).then(reload)} /> {c.name}<small className="count">{c.count}</small></label>
              ))}
              <span className="menu-head">{t('photos.folders')}</span>
              <small>{t('photos.foldersNote')}</small>
              {folders.filter(f => f.included !== null).map(f => (
                <label key={f.name}><input type="checkbox" checked={!!f.included}
                  onChange={e => window.drive.folders.set(f.name, e.target.checked).then(reload)} /> {f.name}<small className="count">{f.count}</small></label>
              ))}
              <span className="menu-head">{t('photos.lookAgain')}</span>
              <small>{t('photos.lookAgainNote')}</small>
              <button className="sheet-row" disabled={!!analysis?.running}
                onClick={() => run(() => window.drive.people.rescan(), t('photos.readingAgain'))}><Icon name="person" />{t('photos.rescanFaces')}</button>
              <button className="sheet-row" disabled={!!analysis?.running}
                onClick={() => run(() => window.drive.documents.rescan(), t('photos.readingAgain'))}><Icon name="fileDoc" />{t('photos.rescanDocuments')}</button>
            </div>
          </details>
        </>} />
    )
  }

  return (
    <div className="app">
      <Dock apps={dockApps} home={page.kind === 'home' || expose /* expose: the dock stays, so the panes do not move under the mouse */}
        // Home, with Tetra's own icon, as a dock item (the user, 11 Nov: a Home item in the dock, the app's icon kept)
        head={<button className={`nav-item dock-home-item ${page.kind === 'home' ? 'active' : ''}`} title={t('app.home')} onClick={() => setPage({ kind: 'home' })}>
          <img className="dock-art" src="./icon.png" alt="" draggable={false} /><span>{t('app.home')}</span></button>}
        bottom={<>
          {/* the drives are no longer listed under Devices (the user, 2 Nov: room for the apps); Devices opens them */}
          {analysis?.running && (
            <div className="rail-progress" title={t('photos.analysing', { done: analysis.done.toLocaleString(), total: analysis.total.toLocaleString() })}>
              <span>{t('photos.analysing', { done: analysis.done.toLocaleString(), total: analysis.total.toLocaleString() })}</span>
              <progress value={analysis.done} max={Math.max(analysis.total, 1)} />
            </div>
          )}
          <div className="rail-bottom">
            {/* notifications at Home's top right, as on the phone; Settings among the dock's apps (the user, 11 Nov) */}
            <LayoutButton layout={split.layout} choose={l => { setSplit(s => ({ ...s, layout: l })); setExpose(true) }}
              single={() => { setSplit(s => ({ ...s, layout: 'full' })); setExpose(false) }} />
          </div>
        </>}
        foot={null /* the library's count and its refresh are beside Home's bell (the user, 11 Nov: a Mac-like dock) */} />
      <div className="panes">
      <main className="content" data-app={page.kind} style={{ flex: WEIGHTS[split.layout][0] }}>
        <Suspense fallback={null}>{content}</Suspense>
        {section && section !== 'files' && ['photos', 'collections', 'collection'].includes(page.kind) && picked.length === 0 && dock}
        {page.kind === 'person' && person && picked.length === 0 && (
          <div className="island selection-bar person-bar">
            <button className="text-button" onClick={() => combine(person)}><Icon name="merge" size={20} />{t('people.combine')}</button>
            <button className="text-button" onClick={() => renamePerson(person)}><Icon name="rename" size={20} />{t('common.rename')}</button>
            <button className="text-button" onClick={() => setDialog(
              <MergeHistory person={person} onClose={close} onRestore={m => run(() => window.drive.people.restoreMerge(m.id), t('photos.isBack', { name: shownName(m.name) }))} />,
            )}><Icon name="undo" size={20} />{t('people.history')}</button>
          </div>
        )}
        {picked.length > 0 && (
          <div className="island selection-bar">
            <button className="round flat" title={t('photos.clearSelection')} onClick={() => setSelected(new Set())}><Icon name="close" /></button>
            <strong>{t('photos.selected', { count: picked.length })}</strong>
            <button className="round flat" title={picked.every(m => m.favorite) ? t('photos.unfavorite') : t('photos.favorite')} onClick={() => favorite(picked)}>
              <Icon name={picked.every(m => m.favorite) ? 'heartFill' : 'heart'} /></button>
            {custom && !mirror
              ? <button className="round flat" title={folderAlbum ? t('photos.moveOutOf', { folder: folderAlbum }) : t('viewer.uncollect')} onClick={() => uncollect(picked)}><Icon name="uncollect" /></button>
              : <button className="round flat" title={t('viewer.collect')} onClick={() => collect(picked)}><Icon name="collect" /></button>}
            {!driveId && <>
              <button className="round flat" title={t('viewer.moveTo')} onClick={() => moveTo(picked)}><Icon name="moveTo" /></button>
              <button className="round flat" title={t('viewer.toHidden')} onClick={() => hide(picked)}><Icon name="lock" /></button>
            </>}
            <button className="round flat" title={driveId ? t('photos.deleteToPurgatoryKey') : t('viewer.toTrash')} onClick={() => trash(picked)}><Icon name="trash" /></button>
            {page.kind === 'person' && person && (
              <button className="text-button" title={t('photos.notThisPersonHint')} onClick={() => run(async () => {
                const r = await window.drive.people.detach(person.id, picked.map(m => m.sha256))
                setSelected(new Set())
                say(t('photos.facesTakenOut', { count: r.faces, name: shownName(person.name) }))
              })}><Icon name="uncollect" size={20} />{t('photos.notThisPerson')}</button>
            )}
          </div>
        )}
      </main>
      {sideApps.map((k, i) => (
        <section key={i} className="content side-pane" data-app={k ?? ''} style={{ flex: WEIGHTS[split.layout][i + 1] }}>
          {k && sideKeys.has(k) ? <Suspense fallback={null}>{paneContent(k)}</Suspense>
            : <button className="side-pane-empty" onClick={() => setExpose(true)}><Icon name="add" size={28} /><span>{t('layout.hint')}</span></button>}
        </section>
      ))}
      {expose && split.layout !== 'full' && <Expose layout={split.layout} apps={dockApps} current={[mainKey, ...sideApps.map(k => k ?? '')]} side={sideKeys}
        choose={choosePane} done={() => setExpose(false)} />}
      </div>
      {guide && <GuidePanel onClose={() => setGuide(false)} go={(to: GuideGo) => setPage(to === 'files' ? { kind: 'files', mode: 'browse', folder: '' } : { kind: to === 'sync' ? 'sync' : 'settings' })} />}
      {open !== null && items[open] && (
        <Viewer media={scoped ? scoped.map(i => items[i]) : items} index={scoped ? Math.max(0, scoped.indexOf(open)) : open}
          setIndex={i => setOpen(scoped ? scoped[i] : i)} onClose={() => { setOpen(null); setScope(null) }} people={names[items[open].sha256] ?? []}
          onShowOnMap={m => { setOpen(null); setPage({ kind: 'map', focus: m.sha256 }) }}
          onDocument={(m, on) => run(() => window.drive.documents.set(m.sha256, on), on ? t('photos.markedDocument') : t('photos.notDocument'))}
          onFavorite={m => favorite([m])} onTrash={m => trash([m])} onHide={driveId ? undefined : m => hide([m])} onEdit={driveId ? undefined : (item, hide) => setEditing({ item, hide })}
          onCollect={custom ? undefined : m => collect([m])} onUncollect={custom && !mirror ? m => uncollect([m]) : undefined} onMove={driveId ? undefined : m => moveTo([m])}
          uncollectTitle={folderAlbum ? t('photos.moveOutOf', { folder: folderAlbum }) : undefined} />
      )}
      {editing && <Suspense fallback={null}><Editor item={editing.item} hide={editing.hide} onClose={() => setEditing(null)} onSaved={msg => { setEditing(null); say(msg); reload() }} /></Suspense>}
      {dialog}
      {!nas && <TimerBell />}
      {!nas && <PillsChime />}
      {toast && <div className="island toast" role="status">{toast.text}
        {toast.undo && <button className="text-button" onClick={() => { const u = toast.undo!; setToast(null); u() }}>{toast.label ?? t('common.undo')}</button>}</div>}
    </div>
  )
}

/** The apps a side pane can hold (paneContent). */
const SIDE = ['files', 'mail', 'notes', 'calendar', 'timer', 'pills', 'maps', 'phone', 'messages', 'data', 'passwords', 'contacts', 'assistant', 'sync', 'settings']

/** Files in a side pane: its own folder, moved within the pane. */
function SideFiles({ setDialog, say }: { setDialog: (d: ReactNode) => void; say: (s: string) => void }) {
  const [at, setAt] = useState<{ mode: FilesMode; folder: string }>({ mode: 'browse', folder: '' })
  return <Files mode={at.mode} folder={at.folder} go={(mode, folder) => setAt({ mode, folder })} setDialog={setDialog} say={say} dock={null} />
}
