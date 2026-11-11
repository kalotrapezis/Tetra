import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AppNotification, PillsView, SmsMessage } from './drive'
import type { Contact } from './Contacts'
import type { Note } from './Notes'
import { sortItems } from './notesEdit'
import { Icon, type IconName } from './Icon'
import { locale, t } from './i18n'
import { errorText } from './Dialogs'
import { PillShape } from './Pills'
import { clockText, durationText, useAlarms, useTimers } from './Timer'
import { key, when } from './Phone'
import { threadsOf } from './Messages'
import { bytes, planStatus } from './Data'

type Go = (kind: 'pills' | 'timer' | 'phone' | 'messages' | 'data' | 'notes' | 'assistant') => void
const NOTICE_ICON: Record<string, IconName> = { mail: 'mail', calendar: 'calendar', timer: 'timer', pills: 'pill', maps: 'map', phone: 'call', assistant: 'sparkle', sync: 'refresh', photos: 'photos', files: 'drive' }
const hm = (ms: number) => new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
const startOfDay = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() }

/**
 * The notification centre (the user, 8 Nov: "so much empty space… the widgets can be notification cards"): the classic
 * list in time order on the left, and on the right cards that stay and keep their content current — empty when nothing waits.
 */
export function NotificationsPage({ go, say }: { go: Go; say: (text: string) => void }) {
  const [list, setList] = useState<AppNotification[] | null>(null)
  const load = () => window.drive.notifications.list().then(l => { setList(l); window.drive.notifications.read() })
  useEffect(() => { load(); return window.drive.notifications.onChange(load) }, [])
  const day = (at: number) => new Date(at).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' })
  return (
    <div className="page-scroll">
      <header className="page-head">
        <h1>{t('app.notifications')}</h1>
        {!!list?.length && <button className="text-button" onClick={() => window.drive.notifications.clear().then(load)}>{t('notifications.clearAll')}</button>}
      </header>
      <div className="center">
        <div className="notice-list">
          {list?.length === 0 && <p className="muted">{t('notifications.empty')}</p>}
          {list?.map((n, i) => <div key={n.id}>
            {(i === 0 || day(list[i - 1].at) !== day(n.at)) && <h4 className="notice-day">{day(n.at)}</h4>}
            <div className={`notice island ${n.read ? '' : 'unread'}`}>
              <Icon name={NOTICE_ICON[n.applet ?? ''] ?? 'bell'} size={20} />
              <div><strong>{n.title}</strong>{n.body && <p>{n.body}</p>}</div>
              <small>{hm(n.at)}</small>
            </div>
          </div>)}
        </div>
        <div className="center-cards">
          <BriefCard />
          <PillsCard go={go} say={say} />
          <TimerCard go={go} />
          {window.drive.platform !== 'win32' && <CallsCard go={go} say={say} />}
          <SmsCard go={go} say={say} />
          <DataCard go={go} />
          <ListsCard go={go} say={say} />
        </div>
      </div>
    </div>
  )
}

function Card({ icon, color, title, open, wide, children }: { icon: IconName; color: string; title: string; open?: () => void; wide?: boolean; children: ReactNode }) {
  return (
    <section className={`center-card island ${wide ? 'wide' : ''}`} style={{ '--c': color } as React.CSSProperties}>
      <button className="center-card-head" onClick={open} disabled={!open} title={title}>
        <span className="center-card-icon"><Icon name={icon} size={18} /></span><strong>{title}</strong>
        {open && <Icon name="arrowRight" size={18} />}
      </button>
      {children}
    </section>
  )
}
const Empty = ({ text }: { text: string }) => <p className="center-empty">{text}</p>

function BriefCard() {
  const [last, setLast] = useState<{ file: string; title: string; at: number } | null>(null)
  useEffect(() => {
    const read = () => window.drive.schedules.results().then(r => setLast(r.slice().sort((a, b) => b.at - a.at)[0] ?? null), () => {})
    read(); return window.drive.schedules.onChange(read)
  }, [])
  return (
    <Card icon="sparkle" color="var(--cat-assistant)" title={t('brief.title')} wide>
      {!last ? <Empty text={t('brief.none')} /> :
        <button className="center-row center-brief" onClick={() => window.drive.schedules.open(last.file)}>
          <span>{last.title === t('brief.title') ? <strong>{when(new Date(last.at).toISOString())}</strong> : <><strong>{last.title}</strong><small>{when(new Date(last.at).toISOString())}</small></>}</span>
          <span className="chip">{t('common.open')}</span>
        </button>}
    </Card>
  )
}

function PillsCard({ go, say }: { go: Go; say: (text: string) => void }) {
  const [v, setV] = useState<PillsView | null>(null)
  const read = () => window.drive.pills.read(startOfDay()).then(setV, () => {})
  useEffect(() => { read(); const t = setInterval(read, 60_000); const off = window.drive.onPillsChanged(read); return () => { clearInterval(t); off() } }, [])
  const doses = (v?.doses ?? []).slice().sort((a, b) => a.due - b.due)
  const med = (id: string) => v?.meds.find(m => m.id === id)
  const next = doses.find(d => d.state === 'waiting' || d.state === 'missed')
  return (
    <Card icon="pill" color="var(--cat-pills)" title={t('app.pills')} open={() => go('pills')}>
      {!doses.length ? <Empty text={t('center.noDoses')} /> : <>
        <div className="center-doses">
          {doses.map(d => { const m = med(d.med); return (
            <span key={d.med + d.due} className={`center-dose ${d.state}`} title={`${m?.title ?? ''} ${hm(d.due)}`}>
              {m && <PillShape shape={m.shape} color={m.color} color2={m.color2} size={22} />}<small>{hm(d.due)}</small>
            </span>) })}
        </div>
        {next ? <div className="center-row">
          <span><strong>{med(next.med)?.title}</strong><small>{hm(next.due)}</small></span>
          <button className="filled-button" onClick={() => window.drive.pills.answer(next.med, next.due, 'take').then(read, e => say(errorText(e)))}>{t('pills.taken')}</button>
        </div> : <Empty text={t('center.allTaken')} />}
      </>}
    </Card>
  )
}

function TimerCard({ go }: { go: Go }) {
  const timers = useTimers().filter(x => x.ringing || (!x.ready && x.state !== 'stopped'))
  const alarm = useAlarms(30_000).filter(a => a.on && a.next).sort((a, b) => a.next! - b.next!)[0]
  const act = (id: string, a: Parameters<typeof window.drive.timer.change>[1]) => window.drive.timer.change(id, a)
  return (
    <Card icon="timer" color="var(--timer-teal)" title={t('app.timer')} open={() => go('timer')}>
      {!timers.length && <Empty text={t('center.noTimers')} />}
      {timers.map(x => (
        <div key={x.id} className="center-row">
          <span><strong className="center-big">{x.ringing ? t('timer.timesUp') : clockText(x.leftMs)}</strong><small>{x.label || durationText(x.seconds)}</small></span>
          {x.ringing ? <button className="filled-button" onClick={() => act(x.id, 'ok')}>{t('common.ok')}</button> : <span className="center-buttons">
            <button className="round" title={t(x.state === 'paused' ? 'common.resume' : 'common.pause')} onClick={() => act(x.id, x.state === 'paused' ? 'resume' : 'pause')}><Icon name={x.state === 'paused' ? 'play' : 'pause'} size={20} /></button>
            <button className="round" title={t('common.stop')} onClick={() => act(x.id, 'stop')}><Icon name="close" size={20} /></button>
          </span>}
        </div>
      ))}
      <div className="center-row center-sub">
        {alarm ? <>
          <span><strong>{t('center.nextAlarm', { time: alarm.time })}</strong><small>{alarm.label || new Date(alarm.next!).toLocaleDateString(locale(), { weekday: 'long' })}</small></span>
          <button className="text-button" onClick={() => window.drive.timer.alarmChange(alarm.id, 'skip')}>{t('alarm.skipNext')}</button>
        </> : <small>{t('center.noAlarm')}</small>}
      </div>
    </Card>
  )
}

/** The phone's contacts, for names: read once for the cards that show numbers. */
function useContacts() {
  const [contacts, setContacts] = useState<Contact[]>([])
  useEffect(() => { window.drive.contacts<Contact[]>('list', false).then(setContacts, () => {}) }, [])
  return useMemo(() => new Map(contacts.flatMap(c => c.phones.map(p => [key(p.value), c] as const)).filter(([k]) => k.length >= 5)), [contacts])
}

function CallsCard({ go, say }: { go: Go; say: (text: string) => void }) {
  const [calls, setCalls] = useState<Awaited<ReturnType<typeof window.drive.phoneHistory>>>([])
  const names = useContacts()
  useEffect(() => { const read = () => window.drive.phoneHistory().then(setCalls, () => {}); read(); const t = setInterval(read, 60_000); return () => clearInterval(t) }, [])
  // cleared by hand (the user, 8 Nov: yesterday's calls stayed and could not be cleared); new ones show again
  const [cleared, setCleared] = useState(() => { try { return +(localStorage.getItem('centerCallsCleared') ?? 0) } catch { return 0 } })
  const clear = () => { const now = Date.now(); setCleared(now); try { localStorage.setItem('centerCallsCleared', String(now)) } catch {} }
  const since = Math.max(cleared, Date.now() - 2 * 86_400_000)
  const missed = calls.filter(c => c.dir === 'missed' && Date.parse(c.at) > since).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 4)
  const call = (number: string, name: string) => window.drive.contactsCall(number, name).then(r => say(r.error ? r.error : t('phone.callingOn', { device: r.device ?? '' })), e => say(errorText(e)))
  return (
    <Card icon="callMissed" color="var(--cat-phone)" title={t('phone.missed')} open={() => go('phone')}>
      {!missed.length && <Empty text={t('center.noMissed')} />}
      {missed.map(c => { const name = c.name || names.get(key(c.number))?.name || c.number; return (
        <div key={c.at + c.number} className="center-row">
          <span><strong>{name}</strong><small>{when(c.at)}</small></span>
          <button className="round" title={t('center.callBack')} onClick={() => call(c.number, name)}><Icon name="call" size={20} /></button>
        </div>) })}
      {!!missed.length && <button className="text-button center-clear" onClick={clear}>{t('common.clear')}</button>}
    </Card>
  )
}

function SmsCard({ go, say }: { go: Go; say: (text: string) => void }) {
  const [messages, setMessages] = useState<SmsMessage[] | null>(null)
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const names = useContacts()
  const read = () => window.drive.sms.list().then(r => setMessages(r.error ? null : r.messages ?? []), () => setMessages(null))
  useEffect(() => { read(); const t = setInterval(read, 30_000); return () => clearInterval(t) }, [])
  const unread = threadsOf(messages ?? []).filter(th => th.unread > 0).slice(0, 3)
  const send = (id: number, to: string) => {
    const text = (drafts[id] ?? '').trim()
    if (!text) return
    window.drive.sms.send(to, text).then(r => {
      if (r.error) return say(t('sms.notSent', { error: r.error }))
      setDrafts(d => ({ ...d, [id]: '' }))
      window.drive.sms.read(id).finally(() => setTimeout(read, 1500))
    }, e => say(t('sms.notSent', { error: errorText(e) })))
  }
  return (
    <Card icon="chat" color="var(--cat-phone)" title={t('app.sms')} open={() => go('messages')}>
      {!unread.length && <Empty text={t('center.noUnread')} />}
      {unread.map(th => (
        <div key={th.id} className="center-sms">
          <div className="center-row"><span><strong>{names.get(key(th.address))?.name ?? th.address}</strong><small>{th.last.body}</small></span><small>{hm(th.last.at)}</small></div>
          <form className="center-reply" onSubmit={e => { e.preventDefault(); send(th.id, th.address) }}>
            <input value={drafts[th.id] ?? ''} placeholder={t('center.reply')} onChange={e => setDrafts(d => ({ ...d, [th.id]: e.target.value }))} />
            <button className="round" title={t('common.send')} disabled={!(drafts[th.id] ?? '').trim()}><Icon name="send" size={18} /></button>
          </form>
        </div>
      ))}
    </Card>
  )
}

function DataCard({ go }: { go: Go }) {
  const [all, setAll] = useState<Parameters<typeof planStatus>[0] | null>(null)
  useEffect(() => { const read = () => window.drive.dataAll().then(a => setAll(a as typeof all), () => {}); read(); const t = setInterval(read, 5 * 60_000); return () => clearInterval(t) }, [])
  const s = useMemo(() => all && planStatus(all), [all])
  const part = s && s.limited && s.size > 0 ? Math.min(1, s.used / s.size) : 0
  const over = !!s && s.limited && s.projection > s.size
  const r = 34, c = 2 * Math.PI * r
  return (
    <Card icon="dataUsage" color="var(--cat-phone)" title={t('app.data')} open={() => go('data')}>
      {!s ? <Empty text={t('data.reading')} /> :
        <div className="center-data">
          {s.limited && <svg viewBox="0 0 80 80" width="80" height="80" role="img" aria-label={`${Math.round(part * 100)}%`}>
            <circle cx="40" cy="40" r={r} className="center-ring-track" />
            <circle cx="40" cy="40" r={r} className={`center-ring ${over ? 'over' : ''}`} strokeDasharray={`${part * c} ${c}`} transform="rotate(-90 40 40)" />
            <text x="40" y="45" textAnchor="middle">{Math.round(part * 100)}%</text>
          </svg>}
          <span>
            <strong>{s.limited ? t('data.usedOf', { used: bytes(s.used), size: bytes(s.size) }) : t('data.usedThisCycle', { used: bytes(s.used) })}</strong>
            <small>{t('data.today', { used: bytes(s.todayUse) })}</small>
            {s.limited && <small>{t('center.daysLeft', { days: s.daysLeft })}</small>}
            {over && <small className="center-warn">{t('center.forecast', { size: bytes(s.projection) })}</small>}
          </span>
        </div>}
    </Card>
  )
}

const callNotes = <T,>(method: string, ...args: unknown[]) => window.drive.notes<T>(method, ...args)
function ListsCard({ go, say }: { go: Go; say: (text: string) => void }) {
  const [notes, setNotes] = useState<Note[]>([])
  const read = () => callNotes<Note[]>('list').then(setNotes, () => {})
  useEffect(() => { read(); const off = window.drive.onNotesChanged(read); return off }, [])
  // the pinned checklists, else the latest one still open
  const open = notes.filter(n => n.noteType === 'CHECKLIST' && !n.archivedAt && !n.trashedAt && (n.checklistItems ?? []).some(i => !i.isChecked && i.text.trim()))
  const shown = (open.some(n => n.isPinned) ? open.filter(n => n.isPinned) : open.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 1)).slice(0, 3)
  const tick = (n: Note, id: string) => {
    const items = (n.checklistItems ?? []).map(i => i.id === id ? { ...i, isChecked: true } : i)
    setNotes(l => l.map(x => x.id === n.id ? { ...x, checklistItems: items } : x))
    callNotes('save', n.id, { checklistItems: items }).catch(e => { say(errorText(e)); read() })
  }
  return (
    <Card icon="checklist" color="var(--cat-notes)" title={t('notes.checklist')} open={() => go('notes')}>
      {!shown.length && <Empty text={t('brief.noLists')} />}
      {shown.map(n => (
        <div key={n.id} className="center-list">
          {n.title && <strong>{n.title}</strong>}
          {sortItems(n.checklistItems ?? []).filter(i => !i.isChecked && i.text.trim()).slice(0, 6).map(i => (
            <button key={i.id} className="center-check" onClick={() => tick(n, i.id)}><Icon name="checkBoxBlank" size={20} /><span>{i.text}</span></button>
          ))}
        </div>
      ))}
    </Card>
  )
}
