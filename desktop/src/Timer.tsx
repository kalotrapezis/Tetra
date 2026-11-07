import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AlarmAction, AlarmItem, StopwatchItem, TimerAction, TimerItem } from './drive'
import { ClockFace } from './Calendar'
import { errorText, Modal } from './Dialogs'
import { Icon } from './Icon'
import { locale, t as tr } from './i18n'

// The phone's Clock (Drive-Android TimerScreen.kt, TimerAlarmsScreen.kt): timers, alarms and the stopwatch, laid out as on
// the tablet. Each device counts by itself from the files (timer.js).

/** "5 min", "1 h 30 min", "45 s" (timer.js durationText). */
export function durationText(seconds: number) {
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60
  return [h && tr('timer.h', { n: h }), m && tr('timer.min', { n: m }), (s || !seconds) && tr('timer.s', { n: s })].filter(Boolean).join(' ')
}
/** "4:05", "1:02:00", rounded up so 0:00 is the end. */
export function clockText(ms: number) {
  const t = Math.ceil(ms / 1000), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

/** The running timers, read again at each change and twice a second while any runs; the time left by this clock. */
export function useTimers() {
  const [list, setList] = useState<TimerItem[]>([])
  const [, tick] = useState(0)
  const read = () => window.drive.timer.active().then(setList, () => {})
  useEffect(() => { read(); return window.drive.onTimerChanged(read) }, [])
  useEffect(() => {
    if (!list.length) { const t = setInterval(read, 30_000); return () => clearInterval(t) } // the 30 s look, idle
    const t = setInterval(() => { tick(n => n + 1); read() }, 500)
    return () => clearInterval(t)
  }, [list.length])
  return list
}

/** A timer's card: the pin (top left) keeps it when stopped or done, ready to start again; the trash (top right) takes it away. */
function TimerCard({ t, act }: { t: TimerItem; act: (id: string, a: TimerAction) => void }) {
  return (
    <div className={`timer-card island ${t.ringing ? 'ringing' : ''}`}>
      <button className={`round flat timer-pin ${t.pinned ? 'on' : ''}`} title={t.pinned ? tr('timer.unpin') : tr('timer.pinKeep')} onClick={() => act(t.id, t.pinned ? 'unpin' : 'pin')}><Icon name="pin" size={18} /></button>
      <button className="round flat timer-trash" title={tr('common.delete')} onClick={() => act(t.id, 'trash')}><Icon name="trash" size={18} /></button>
      <div className="timer-left">{t.ringing ? tr('timer.timesUp') : clockText(t.ready ? t.seconds * 1000 : t.leftMs)}</div>
      <div className="timer-name">{t.label || durationText(t.seconds)}{t.state === 'paused' ? tr('timer.pausedSuffix') : ''}</div>
      <div className="timer-buttons">
        {t.ringing ? <button className="filled-button" onClick={() => act(t.id, 'ok')}>{tr('common.ok')}</button>
          : t.ready ? <button className="filled-button" onClick={() => act(t.id, 'restart')}><Icon name="play" size={18} /> {tr('common.start')}</button> : <>
          {t.state === 'paused'
            ? <button className="filled-button" onClick={() => act(t.id, 'resume')}><Icon name="play" size={18} /> {tr('common.resume')}</button>
            : <button className="filled-button" onClick={() => act(t.id, 'pause')}><Icon name="pause" size={18} /> {tr('common.pause')}</button>}
          <button className="outline-button" onClick={() => act(t.id, 'stop')}><Icon name="close" size={18} /> {tr('common.stop')}</button>
        </>}
      </div>
    </div>
  )
}

/** The clock in a dialog, × and ✓ under it (the tablet's DialDialog): a new timer's length, an alarm's time. */
export function DialDialog({ h0, m0, close, done, children }: { h0: number; m0: number; close: () => void; done: (h: number, m: number) => void; children?: ReactNode }) {
  const [h, setH] = useState(h0)
  const [m, setM] = useState(m0)
  return (
    <Modal onClose={close}>
      <div className="cal-clock timer-clock timer-dial">
        {children}
        <ClockFace h={h} m={m} setH={setH} setM={setM} below />
        <div className="timer-crosscheck">
          <button className="round" title={tr('common.cancel')} onClick={close}><Icon name="close" /></button>
          <button className="round filled" title={tr('common.save')} onClick={() => done(h, m)}><Icon name="checked" /></button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * The Clock as on the tablet (the user, 2 Nov: "the same as the tablet"): the cards in the middle; Timers, Alarms and
 * Stopwatch in the island at the bottom, the pane's round actions beside it; the clock in a dialog.
 */
export function TimerPage({ say }: { say: (text: string) => void }) {
  const timers = useTimers()
  const [tab, setTab] = useState(() => { try { return +(localStorage.getItem('timerTab') ?? 0) } catch { return 0 } })
  const choose = (i: number) => { setTab(i); try { localStorage.setItem('timerTab', String(i)) } catch {} }
  const [adding, setAdding] = useState<number | null>(null) // a new timer: the clock opens on the length last started here
  const add = () => window.drive.timer.last().then(s => setAdding(s || 300), () => setAdding(300))
  const start = (hh: number, mm: number) => { const s = hh * 3600 + mm * 60; setAdding(null); if (s > 0) window.drive.timer.start(s).catch(e => say(tr('timer.notStarted', { error: errorText(e) }))) }
  const act = (id: string, a: TimerAction) => window.drive.timer.change(id, a).catch(e => say(errorText(e)))
  const [alarmEdit, setAlarmEdit] = useState<AlarmItem | 'new' | null>(null)
  const watch = useStopwatch()
  const watchAct = (x: 'start' | 'hold' | 'lap' | 'reset') => window.drive.timer.watch(x).then(watch.read, e => say(errorText(e)))
  return (
    <div className="timer">
      <header className="topbar">
        <div className="island title-island"><Icon name="timer" /><h1>{tr('app.timer')}</h1></div>
        {/* the user, 19 Oct: its own settings at the top right, as the Calendar's */}
        <div className="tools">
          <details className="menu">
            <summary className="round" title={tr('timer.settings')}><Icon name="tune" /></summary>
            <div className="island menu-body cal-settings">
              <h4 className="cal-share-head">{tr('calendar.shareClaude')}</h4>
              <p className="muted">{tr('timer.shareClaudeNote')}</p>
              <div className="cal-two">
                <button className="text-button" onClick={() => window.drive.skillSave('tetra-timer').then(p => p && say(tr('calendar.savedTo', { path: p })), e => say(tr('calendar.notSaved', { error: errorText(e) })))}>{tr('calendar.saveAs')}</button>
                <button className="text-button" onClick={() => window.drive.skillInstall('tetra-timer').then(p => say(tr('calendar.installedIn', { path: p })), e => say(tr('calendar.notInstalled', { error: errorText(e) })))}>{tr('calendar.copyToSkills')}</button>
              </div>
            </div>
          </details>
        </div>
      </header>
      <div className="timer-body">
        {tab === 0 && <section className="timer-cards">
          {timers.map(t => <TimerCard key={t.id} t={t} act={act} />)}
          {!timers.length && <p className="muted">{tr('timer.empty')}</p>}
        </section>}
        {tab === 1 && <AlarmsPane say={say} edit={setAlarmEdit} />}
        {tab === 2 && <StopwatchPane w={watch.w} />}
      </div>
      <div className="ct-dock timer-dock">
        <nav className="notes-island island">
          {([['timer', 'timer.tabTimers'], ['bell', 'timer.tabAlarms'], ['recent', 'stopwatch.title']] as const).map(([icon, l], i) =>
            <button key={i} className={`island-item ${tab === i ? 'on' : ''}`} onClick={() => choose(i)}><Icon name={icon} size={20} /><span>{tr(l)}</span></button>)}
        </nav>
        {tab === 0 && <button className="round island timer-action" title={tr('common.new')} onClick={add}><Icon name="add" /></button>}
        {tab === 1 && <button className="round island timer-action" title={tr('alarm.new')} onClick={() => setAlarmEdit('new')}><Icon name="add" /></button>}
        {tab === 2 && <>
          {watch.w?.state === 'counting'
            ? <button className="round island timer-action" title={tr('common.pause')} onClick={() => watchAct('hold')}><Icon name="pause" /></button>
            : <button className="round island timer-action" title={tr(watch.w?.state === 'held' ? 'common.resume' : 'common.start')} onClick={() => watchAct('start')}><Icon name="play" /></button>}
          <button className="round island timer-action" title={tr('stopwatch.lap')} disabled={watch.w?.state !== 'counting'} onClick={() => watchAct('lap')}><Icon name="tag" /></button>
          <button className="round island timer-action" title={tr('stopwatch.reset')} disabled={watch.w?.state !== 'held'} onClick={() => watchAct('reset')}><Icon name="refresh" /></button>
        </>}
      </div>
      {adding != null && <DialDialog h0={Math.min(23, Math.floor(adding / 3600))} m0={Math.floor(adding % 3600 / 60)} close={() => setAdding(null)} done={start} />}
      {alarmEdit && <AlarmDialog a={alarmEdit === 'new' ? null : alarmEdit} close={() => setAlarmEdit(null)} say={say} />}
    </div>
  )
}

/** The alarms, read again at each change and every second while the page is open (and every 30 s for the bell). */
export function useAlarms(every = 1000) {
  const [list, setList] = useState<AlarmItem[]>([])
  const read = () => window.drive.timer.alarms().then(setList, () => {})
  useEffect(() => { read(); const t = setInterval(read, every); const off = window.drive.onTimerChanged(read); return () => { clearInterval(t); off() } }, [every])
  return list
}

const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
/** Monday is 1 Jan 2024: the days' names in the app's language. */
const dayName = (i: number, weekday: 'narrow' | 'short') => new Date(2024, 0, 1 + i).toLocaleDateString(locale(), { weekday })
/** "Once", "Every day", or the days: "Mon, Wed, Fri". */
const daysText = (a: AlarmItem) => !a.days.length ? tr('alarm.once') : a.days.length === 7 ? tr('alarm.everyDay')
  : DAYS.map((d, i) => a.days.includes(d) ? dayName(i, 'short') : '').filter(Boolean).join(', ')

/** An alarm's card: its name on top, the time with the switch and the trash, its days with Skip next; Snooze and Dismiss while it rings. */
function AlarmCard({ a, edit, act }: { a: AlarmItem; edit: () => void; act: (id: string, x: AlarmAction) => void }) {
  const ringing = a.ringing != null
  return (
    <div className={`timer-card island alarm-card ${ringing ? 'ringing' : ''} ${a.on ? '' : 'off'}`} onClick={edit}>
      {!ringing && <button className="round flat timer-trash" title={tr('common.delete')} onClick={e => { e.stopPropagation(); act(a.id, 'delete') }}><Icon name="trash" size={18} /></button>}
      <div className="timer-name">{a.label || '\u00a0'}</div>
      <div className="timer-left">{a.time}</div>
      <div className="timer-name">{[daysText(a), a.skipped ? tr('alarm.skipped') : ''].filter(Boolean).join(' · ')}</div>
      <div className="timer-buttons" onClick={e => e.stopPropagation()}>
        {ringing ? <>
          <button className="outline-button" onClick={() => act(a.id, 'snooze')}>{tr('alarm.snooze')}</button>
          <button className="filled-button" onClick={() => act(a.id, 'dismiss')}>{tr('alarm.dismiss')}</button>
        </> : <>
          <label className="cal-switch"><input type="checkbox" checked={a.on} onChange={e => act(a.id, e.target.checked ? 'on' : 'off')} /></label>
          {a.days.length > 0 && a.state === 'on' && <button className="outline-button" onClick={() => act(a.id, a.skipped ? 'on' : 'skip')}>
            <Icon name="forward" size={18} /> {tr(a.skipped ? 'alarm.unskip' : 'alarm.skipNext')}</button>}
        </>}
      </div>
    </div>
  )
}

/** Alarms: one card each, the next ring above them; a card clicked opens it to edit (the tablet's AlarmsPane). */
function AlarmsPane({ say, edit }: { say: (text: string) => void; edit: (a: AlarmItem) => void }) {
  const alarms = useAlarms()
  const act = (id: string, x: AlarmAction) => window.drive.timer.alarmChange(id, x).catch(e => say(errorText(e)))
  const next = alarms.map(a => a.next).filter((t): t is number => t != null).sort((a, b) => a - b)[0]
  return (
    <section className="timer-cards">
      {next != null && <p className="muted alarm-next">{tr('alarm.in', { length: durationText(Math.ceil((next - Date.now()) / 60_000) * 60) })}</p>}
      {alarms.map(a => <AlarmCard key={a.id} a={a} edit={() => edit(a)} act={act} />)}
      {!alarms.length && <p className="muted">{tr('alarm.none')}</p>}
    </section>
  )
}

/** A new alarm or an edit: the name, the time on the clock, the days (none: once). */
function AlarmDialog({ a, close, say }: { a: AlarmItem | null; close: () => void; say: (text: string) => void }) {
  const [days, setDays] = useState<string[]>(a?.days ?? [])
  const [label, setLabel] = useState(a?.label ?? '')
  const save = (h: number, m: number) => window.drive.timer.alarmSave(a?.id ?? null, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, days, label.trim()).then(close, e => say(errorText(e)))
  return (
    <DialDialog h0={a ? +a.time.slice(0, 2) : 7} m0={a ? +a.time.slice(3) : 0} close={close} done={save}>
      <input className="field" placeholder={tr('alarm.label')} value={label} onChange={e => setLabel(e.target.value)} />
      <div className="alarm-days">
        {DAYS.map((d, i) => <button key={d} className={`round ${days.includes(d) ? 'on' : ''}`} title={dayName(i, 'short')}
          onClick={() => setDays(days.includes(d) ? days.filter(x => x !== d) : [...days, d])}>{dayName(i, 'narrow')}</button>)}
      </div>
      <p className="muted">{!days.length ? tr('alarm.once') : days.length === 7 ? tr('alarm.everyDay') : '\u00a0'}</p>
    </DialDialog>
  )
}

/** "1:02.3", "1:02:03.4": the stopwatch to a tenth (the phone's stopwatchText). */
export function stopwatchText(ms: number) {
  const t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60
  return (h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`) + '.' + Math.floor(ms % 1000 / 100)
}

/** The stopwatch's file, read at each change and every 2 s; the screen moves every tenth while it counts. */
function useStopwatch() {
  const [w, setW] = useState<StopwatchItem | null>(null)
  const [, tick] = useState(0)
  const read = () => { window.drive.timer.stopwatch().then(setW, () => {}) }
  useEffect(() => { read(); const off = window.drive.onTimerChanged(read); const t = setInterval(read, 2000); return () => { off(); clearInterval(t) } }, [])
  useEffect(() => { if (w?.state !== 'counting') return; const t = setInterval(() => tick(n => n + 1), 100); return () => clearInterval(t) }, [w?.state])
  return { w, read }
}

/** The stopwatch, the same on every device: the time to a tenth, the laps under it; its buttons beside the island. */
function StopwatchPane({ w }: { w: StopwatchItem | null }) {
  const ms = !w ? 0 : w.state === 'counting' ? Math.max(0, Date.now() - (w.started ?? Date.now())) : w.state === 'held' ? Math.round(w.elapsed * 1000) : 0
  return (
    <section className="stopwatch">
      <div className="stopwatch-time">{stopwatchText(ms)}</div>
      <div className="stopwatch-laps">
        {w?.laps.map((t, i) => ({ t, i, split: t - (w.laps[i - 1] ?? 0) })).reverse().map(({ t, i, split }) =>
          <div key={i}><span>{tr('stopwatch.lapN', { n: i + 1 })}</span><span className="muted">{stopwatchText(split * 1000)}</span><span>{stopwatchText(t * 1000)}</span></div>)}
      </div>
    </section>
  )
}

/**
 * The alarm, on whichever page is open (and with the window in the tray): a ringing timer beeps until OK here, or until
 * OK or Stop on any other device reaches this one — a push at once, or the 30 s look at the latest.
 */
export function TimerBell() {
  const timers = useTimers()
  const ringing = timers.filter(t => t.ringing)
  const alarms = useAlarms(5000).filter(a => a.ringing != null)
  const audio = useRef<AudioContext | null>(null)
  useEffect(() => {
    if (!ringing.length && !alarms.length) return
    const ctx = audio.current ??= new AudioContext()
    const beep = () => [0, 0.25, 0.5].forEach(d => {
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.frequency.value = 880; g.gain.setValueAtTime(0.25, ctx.currentTime + d); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + d + 0.2)
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + 0.2)
    })
    beep()
    const t = setInterval(beep, 1500)
    return () => clearInterval(t)
  }, [ringing.length + alarms.length])
  if (!ringing.length && !alarms.length) return null
  if (!ringing.length) return (
    <div className="timer-bell island" role="alert">
      <Icon name="bell" /><b>{alarms.map(a => a.time).join(', ')}</b><span>{alarms.map(a => a.label).filter(Boolean).join(', ') || tr('alarm.title')}</span>
      <button className="outline-button" onClick={() => alarms.forEach(a => window.drive.timer.alarmChange(a.id, 'snooze'))}>{tr('alarm.snooze')}</button>
      <button className="filled-button" onClick={() => alarms.forEach(a => window.drive.timer.alarmChange(a.id, 'dismiss'))}>{tr('alarm.dismiss')}</button>
    </div>
  )
  return (
    <div className="timer-bell island" role="alert">
      <Icon name="timer" /><b>{tr('timer.timesUp')}</b><span>{ringing.map(t => t.label || durationText(t.seconds)).join(', ')}</span>
      <button className="filled-button" onClick={() => ringing.forEach(t => window.drive.timer.change(t.id, 'ok'))}>{tr('common.ok')}</button>
    </div>
  )
}
