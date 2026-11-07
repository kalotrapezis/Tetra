import { useEffect, useId, useState, type ReactNode } from 'react'
import type { PillAdvice, PillDose, PillEvent, PillMed, PillsView } from './drive'
import { Confirm, errorText, Modal } from './Dialogs'
import { Icon } from './Icon'
import { locale, t } from './i18n'
import { DialDialog } from './Timer'

// Pills (pills.js; the phone's PillsScreen.kt, the same files): Today, Medicines and Progress in the island at the bottom, +
// beside it, as the Timer's; a medicine's panel and the five-step guide in dialogs; its setting in Settings › Pills.

const WHITE = '#FFF7F5F0'
/** Pills.kt COLORS: white, yellow, orange, pink, red, purple, blue, green, brown. */
const COLORS = [WHITE, '#FFF4D35E', '#FFEF9F27', '#FFE5487A', '#FFE24B4A', '#FF8E6CC9', '#FF378ADD', '#FF1D9E75', '#FF8B6B4A']
const SHAPES = ['round', 'oval', 'capsule', 'liquid'] as const
const FOODS = ['with', 'before', 'after', 'empty'] as const
const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
const HOUR = 3600_000

const pad = (n: number) => String(n).padStart(2, '0')
const hm = (ms: number) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
const startOf = (ms: number, plus = 0) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + plus).getTime() }
const dateKey = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const fromKey = (k: string) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).getTime() }
const shortDate = (ms: number) => new Date(ms).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })
/** Monday is 1 Jan 2024: the days' names in the app's language. */
const dayName = (i: number, weekday: 'narrow' | 'short' | 'long') => new Date(2024, 0, 1 + i).toLocaleDateString(locale(), { weekday })
/** "1", "0,5" (Medicine.amount); halves only. */
const amount = (v: number) => Number.isInteger(v) ? String(v) : String(v).replace('.', ',')
const halves = (v: number) => Math.round(v * 2) / 2
const number = (s: string) => { const v = parseFloat(String(s).trim().replace(',', '.')); return Number.isFinite(v) && v >= 0 ? v : null }
const int = (s: string) => { const v = parseInt(String(s).trim(), 10); return Number.isFinite(v) && v >= 0 ? v : null }
const part = (t: string) => { const h = +t.slice(0, 2); return h >= 4 && h <= 10 ? 0 : h >= 11 && h <= 16 ? 1 : h >= 17 && h <= 21 ? 2 : 3 }
const PARTS = ['pills.partMorning', 'pills.partNoon', 'pills.partEvening', 'pills.partNight']
const FOOD_KEY = { with: 'pills.foodWith', before: 'pills.foodBefore', after: 'pills.foodAfter', empty: 'pills.foodEmpty' } as const
const foodText = (f: PillMed['food']) => f ? t(FOOD_KEY[f]) : null
const css = (c: string) => '#' + c.slice(3) // "#AARRGGBB" → "#RRGGBB"
const shade = (c: string) => '#' + [3, 5, 7].map(i => Math.round(parseInt(c.slice(i, i + 2), 16) * 0.78).toString(16).padStart(2, '0')).join('')

/** "1 at 08:00, 21:00 · Mon, Wed · with food", "every 7 days", or "No time set". */
function timesText(m: PillMed) {
  if (!m.times.length) return t('pills.noTime')
  const days = m.every > 1 ? ' · ' + t('pills.everyN', { n: m.every }) : !m.days.length ? '' : ' · ' + DAYS.map((d, i) => m.days.includes(d) ? dayName(i, 'short') : '').filter(Boolean).join(', ')
  const food = foodText(m.food)
  return t('pills.times', { n: amount(m.dose), times: m.times.join(', ') }) + days + (food ? ` · ${food}` : '')
}
/** "34 left · lasts 17 days (till 24 Nov)", or "not counted". */
function stockText(m: PillMed) {
  if (!m.counted) return t('pills.notCounted')
  const s = t('pills.stock', { n: amount(m.stock) })
  return m.daysLeft == null || !m.lastDay ? s : s + ' · ' + t('pills.lasts', { days: m.daysLeft, date: shortDate(fromKey(m.lastDay)) })
}

/** A pill drawn: round with its score, oval, a capsule in two colours, a little bottle for a liquid (PillsScreen drawPill). */
export function PillShape({ shape, color, color2, size }: { shape: PillMed['shape']; color: string; color2: string; size: number }) {
  const clip = useId(), c1 = css(color), c2 = css(color2), line = { stroke: 'var(--muted)', strokeWidth: 3.5, fill: 'none' }
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      {shape === 'oval' ? <>
        <ellipse cx="50" cy="50" rx="43" ry="28" fill={c1} /><ellipse cx="50" cy="50" rx="43" ry="28" {...line} />
        <ellipse cx="35" cy="36" rx="15" ry="6" fill="#fff" opacity=".45" />
      </> : shape === 'capsule' ? <>
        <defs><clipPath id={clip}><rect x="50" y="0" width="50" height="100" /></clipPath></defs>
        <rect x="5" y="28" width="90" height="44" rx="22" fill={c1} />
        <rect x="5" y="28" width="90" height="44" rx="22" fill={c2} clipPath={`url(#${clip})`} />
        <line x1="50" y1="28" x2="50" y2="72" stroke={shade(color2)} strokeWidth="2.5" />
        <rect x="5" y="28" width="90" height="44" rx="22" {...line} />
        <rect x="14" y="34" width="26" height="8" rx="4" fill="#fff" opacity=".4" />
      </> : shape === 'liquid' ? <>
        <rect x="25" y="30" width="50" height="60" rx="10" fill={c1} />
        <rect x="25" y="55" width="50" height="20" fill={shade(color)} />
        <rect x="25" y="30" width="50" height="60" rx="10" {...line} />
        <rect x="36" y="12" width="28" height="16" rx="4" fill={c2} /><rect x="36" y="12" width="28" height="16" rx="4" {...line} />
      </> : <>
        <circle cx="50" cy="50" r="40" fill={c1} /><circle cx="50" cy="50" r="40" {...line} />
        <line x1="24" y1="50" x2="76" y2="50" stroke={shade(color)} strokeWidth="4" />
        <circle cx="38" cy="34" r="8.8" fill="#fff" opacity=".4" />
      </>}
    </svg>
  )
}

/** The pill's photo, round, or the pill drawn in its shape and colours. */
function Emblem({ m, size }: { m: Pick<PillMed, 'shape' | 'color' | 'color2' | 'photo'>; size: number }) {
  if (m.photo) return <img className="pill-emblem" src={m.photo} alt="" style={{ width: size, height: size }} />
  return <span className="pill-emblem" style={{ width: size, height: size }}><PillShape shape={m.shape} color={m.color} color2={m.color2} size={size * 0.78} /></span>
}

/** The parts of the day's icons (Tetra-mobile ic_sunrise, ic_sun, ic_sunset; ic_bedtime). */
const PART_PATHS = [
  ['M7,16A5,5 0,0 1,17 16Z', 'M2.5,19.5H21.5M12,5V8M4.6,9.6L6.6,11.6M19.4,9.6L17.4,11.6M1.8,16H3.8M20.2,16H22.2'],
  ['M12,7.5A4.5,4.5 0,1 1,12 16.5A4.5,4.5 0,1 1,12 7.5Z', 'M12,2.5V4.5M12,19.5V21.5M2.5,12H4.5M19.5,12H21.5M5.3,5.3L6.7,6.7M17.3,17.3L18.7,18.7M5.3,18.7L6.7,17.3M17.3,6.7L18.7,5.3'],
  ['M7,15A5,5 0,0 1,17 15Z', 'M2.5,18H21.5M6,21.5H18M12,4V8.5M9.8,6.5L12,8.7L14.2,6.5'],
]
function PartIcon({ p, size = 20 }: { p: number; size?: number }) {
  if (p === 3) return <Icon name="bedtime" size={size} />
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d={PART_PATHS[p][0]} fill="currentColor" />
    <path d={PART_PATHS[p][1]} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
}

const blank = (): PillMed => ({ id: 'pill-' + crypto.randomUUID().replace(/-/g, '').slice(0, 8), name: '', strength: '', title: '', dose: 1, times: ['21:00'], days: [], every: 1,
  until: null, perBox: 0, refillDays: 7, refillTimes: 3, refillAsked: 0, refillOn: null, archived: false, since: null, shape: 'round', color: WHITE, color2: WHITE, food: '',
  stock: 0, counted: false, daysLeft: null, lastDay: null, low: false, photo: null })

type Answer = (d: PillDose, a: 'take' | 'skip' | 'undo') => void

/** Pills, as the phone's (the user, 7 Nov): what to take today, the medicines and their stock, how it has gone. */
export function PillsPage({ say, openSettings }: { say: (text: string) => void; openSettings: () => void }) {
  const [v, setV] = useState<PillsView | null>(null)
  const [day, setDay] = useState(() => startOf(Date.now()))
  const [tab, setTab] = useState(() => { try { return +(localStorage.getItem('pillsTab') ?? 0) || 0 } catch { return 0 } })
  const choose = (i: number) => { setTab(i); try { localStorage.setItem('pillsTab', String(i)) } catch {} }
  const read = () => window.drive.pills.read(day).then(setV, e => say(errorText(e)))
  // read again at each change here or from a device, and every minute: a dose turns missed by itself
  useEffect(() => { read(); const off = window.drive.onPillsChanged(read); const timer = setInterval(read, 60_000); return () => { off(); clearInterval(timer) } }, [day])
  const [editing, setEditing] = useState<PillMed | null>(null)
  const [shown, setShown] = useState<string | null>(null)
  const [undo, setUndo] = useState<PillDose | null>(null)
  useEffect(() => { if (!undo) return; const x = setTimeout(() => setUndo(null), 6000); return () => clearTimeout(x) }, [undo])
  const run = (p: Promise<unknown>) => p.then(read, e => say(errorText(e)))
  const answer: Answer = (d, a) => { run(window.drive.pills.answer(d.med, d.due, a)); setUndo(a === 'undo' ? null : d) }
  const meds = new Map(v?.meds.map(m => [m.id, m]))
  const shownMed = shown ? meds.get(shown) : undefined
  return (
    <div className="timer pills">
      <header className="topbar"><div className="island title-island"><Icon name="pill" /><h1>{t('app.pills')}</h1></div></header>
      <div className="timer-body">
        {v && <div className="pills-col">
          {!v.meds.some(m => !m.archived) && tab !== 1
            ? <div className="pills-empty"><PillShape shape="capsule" color={WHITE} color2={COLORS[3]} size={96} /><p className="muted">{t('pills.empty')}</p>
                <button className="filled-button pills-go" onClick={() => setEditing(blank())}>{t('pills.new')}</button></div>
            : tab === 0 ? <TodayPane v={v} meds={meds} day={v.day} setDay={setDay} answer={answer} />
            : tab === 1 ? <MedicinesPane v={v} open={setShown} addBox={m => run(window.drive.pills.addStock(m.id, 1, 0))} settings={openSettings} />
            : <ProgressPane v={v} meds={meds} apply={(m, from, to) => run(window.drive.pills.save({ ...m, times: [...new Set(m.times.map(x => x === from ? to : x))].sort() }, 0, 0))} />}
        </div>}
      </div>
      <div className="ct-dock timer-dock">
        <nav className="notes-island island">
          {([['calendar', 'pills.today'], ['pill', 'pills.medicines'], ['barChart', 'pills.progress']] as const).map(([icon, l], i) =>
            <button key={i} className={`island-item ${tab === i ? 'on' : ''}`} onClick={() => choose(i)}><Icon name={icon} size={20} /><span>{t(l)}</span></button>)}
        </nav>
        <button className="round island timer-action" title={t('pills.new')} onClick={() => setEditing(blank())}><Icon name="add" /></button>
      </div>
      {undo && meds.get(undo.med) && <div className="island toast" role="status">{t('pills.answered', { name: meds.get(undo.med)!.name })}
        <button className="text-button" onClick={() => { answer(undo, 'undo') }}>{t('common.undo')}</button></div>}
      {shownMed && v && <MedicineDialog m={shownMed} v={v} close={() => setShown(null)} edit={() => { setShown(null); setEditing(shownMed) }} run={run} />}
      {editing && <Guide start={editing} fresh={!meds.has(editing.id)} close={() => setEditing(null)} say={say}
        save={(m, boxes, loose) => { setEditing(null); run(window.drive.pills.save(m, boxes, loose)) }} />}
    </div>
  )
}

// ——— Today ———

/** A strip of the week, then a card for each part of the day that has doses; yesterday's forgotten ones first, in red. */
function TodayPane({ v, meds, day, setDay, answer }: { v: PillsView; meds: Map<string, PillMed>; day: number; setDay: (d: number) => void; answer: Answer }) {
  const today = startOf(v.now)
  const earlier = v.doses.filter(d => d.due < day)
  const parts = [0, 1, 2, 3].map(p => v.doses.filter(d => d.due >= day && part(hm(d.due)) === p))
  return <>
    <div className="pills-week">
      {[-3, -2, -1, 0, 1, 2, 3].map(i => startOf(today, i)).map(d => (
        <button key={d} className={`${d === day ? 'on' : ''} ${d === today ? 'today' : ''}`} onClick={() => setDay(d)}>
          <small>{new Date(d).toLocaleDateString(locale(), { weekday: 'short' })}</small><b>{new Date(d).getDate()}</b></button>))}
    </div>
    {!v.doses.length && <p className="muted">{t('pills.nothingToday')}</p>}
    {earlier.length > 0 && <PartCard title={t('pills.forgotten')} p={3} doses={earlier} meds={meds} now={v.now} answer={answer} alarm />}
    <div className="pills-parts">
      {parts.map((list, p) => list.length > 0 && <PartCard key={p} title={t(PARTS[p])} p={p} doses={list} meds={meds} now={v.now} answer={answer} />)}
    </div>
  </>
}

function PartCard({ title, p, doses, meds, now, answer, alarm }: { title: string; p: number; doses: PillDose[]; meds: Map<string, PillMed>; now: number; answer: Answer; alarm?: boolean }) {
  const done = doses.filter(d => d.state === 'taken' || d.state === 'skipped').length
  return (
    <section className={`island pills-card ${alarm ? 'alarm' : ''}`}>
      <h3><PartIcon p={p} /><span className="pills-title">{title}</span>{!alarm && <small>{done}/{doses.length}</small>}</h3>
      {doses.map(d => meds.has(d.med) && <DoseLine key={`${d.med}|${d.due}`} d={d} m={meds.get(d.med)!} now={now} answer={answer} />)}
    </section>
  )
}

function DoseLine({ d, m, now, answer }: { d: PillDose; m: PillMed; now: number; answer: Answer }) {
  const open = d.state === 'waiting' || d.state === 'missed'
  const yesterday = startOf(d.due) !== startOf(now) && d.due < now
  const state = d.state === 'taken' ? t('pills.stateTaken', { time: hm(d.at ?? d.due) }) : d.state === 'skipped' ? t('pills.stateSkipped')
    : d.state === 'missed' ? t('pills.stateMissed') : t('pills.stateDose', { n: amount(m.dose) })
  const line = [(yesterday ? t('common.yesterday') + ' ' : '') + hm(d.due), state, d.state !== 'missed' ? foodText(m.food) : null].filter(Boolean).join(' · ')
  return (
    <div className={`pills-dose ${open ? 'open' : 'answered'}`} onClick={open ? () => answer(d, 'take') : undefined}>
      <Emblem m={m} size={44} />
      <div className="pills-dose-text"><strong>{m.title}</strong><small className={d.state === 'missed' ? 'pills-red' : ''}>{line}</small></div>
      {open && d.due <= now + 3 * HOUR ? <>
        <button className="round flat" title={t('pills.skip')} onClick={e => { e.stopPropagation(); answer(d, 'skip') }}><Icon name="skipNext" size={20} /></button>
        <button className="filled-button pills-go" onClick={e => { e.stopPropagation(); answer(d, 'take') }}>{t('pills.taken')}</button>
      </> : !open && <button className={`round flat ${d.state === 'taken' ? 'pills-ok' : ''}`} title={t('common.undo')} onClick={() => answer(d, 'undo')}>
        <Icon name={d.state === 'taken' ? 'checked' : 'undo'} size={20} /></button>}
    </div>
  )
}

// ——— Medicines ———

function MedicinesPane({ v, open, addBox, settings }: { v: PillsView; open: (id: string) => void; addBox: (m: PillMed) => void; settings: () => void }) {
  const live = v.meds.filter(m => !m.archived), old = v.meds.filter(m => m.archived)
  return <>
    <div className="pills-meds">
      {live.map(m => (
        <div key={m.id} className="island pills-med" role="button" tabIndex={0} onClick={() => open(m.id)} onKeyDown={e => { if (e.key === 'Enter') open(m.id) }}>
          <Emblem m={m} size={64} />
          <strong>{m.title}</strong>
          <small className={m.times.length ? '' : 'pills-red'}>{timesText(m)}</small>
          {m.counted && <div className={`pills-bar ${m.low ? 'low' : ''}`}><span style={{ width: `${Math.max(3, Math.min(100, (m.daysLeft ?? 0) / 30 * 100))}%` }} /></div>}
          <small className={m.low ? 'pills-red' : ''}>{stockText(m)}</small>
          {m.perBox > 0 && <button className="text-button" onClick={e => { e.stopPropagation(); addBox(m) }}><Icon name="add" size={18} /> {t('pills.addBox', { n: m.perBox })}</button>}
        </div>))}
    </div>
    {old.length > 0 && <>
      <h4 className="pills-head">{t('pills.archived')}</h4>
      {old.map(m => <button key={m.id} className="picker-row" onClick={() => open(m.id)}><Emblem m={m} size={36} /><span className="muted">{m.title}</span></button>)}
    </>}
    <button className="text-button pills-settings" onClick={settings}><Icon name="settings" size={18} /> {t('pills.settingsOpen')}</button>
  </>
}

/** A medicine's panel (the phone's sheet): its stock and buttons, its history with the missed doses, stop taking or delete. */
function MedicineDialog({ m, v, close, edit, run }: { m: PillMed; v: PillsView; close: () => void; edit: () => void; run: (p: Promise<unknown>) => void }) {
  const [rows, setRows] = useState<{ when: number; e: PillEvent | null }[]>([])
  useEffect(() => { window.drive.pills.history(m.id).then(setRows, () => {}) }, [m.id, v])
  const [counting, setCounting] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const what = (e: PillEvent | null) => !e ? t('pills.stateMissed')
    : e.kind === 'taken' ? (e.due == null ? t('pills.hExtra', { n: amount(e.amount) }) : e.at - e.due > 30 * 60_000 ? t('pills.hLate', { time: hm(e.at) }) : t('pills.hTaken'))
    : e.kind === 'skipped' ? t('pills.stateSkipped') : e.kind === 'undo' ? t('pills.hUndo')
    : e.note === 'count' ? t('pills.hCount', { n: amount(e.stock) }) : t('pills.hAdded', { n: amount(e.amount), stock: amount(e.stock) })
  const when = (ms: number) => new Date(ms).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return (
    <Modal onClose={close}>
      <div className="pills-panel">
        <div className="pills-panel-head">
          <Emblem m={m} size={72} />
          <div><h3>{m.title}</h3><p>{timesText(m)}</p></div>
          <button className="round flat" title={t('common.edit')} onClick={edit}><Icon name="edit" /></button>
        </div>
        <strong className={m.low ? 'pills-red' : ''}>{stockText(m)}</strong>
        {m.low && <p className="pills-red">{t('pills.orderNow')}</p>}
        <div className="pills-buttons">
          {m.perBox > 0 && <button className="chip" onClick={() => run(window.drive.pills.addStock(m.id, 1, 0))}>+ {t('pills.addBox', { n: m.perBox })}</button>}
          <button className="chip" onClick={() => setCounting(amount(m.stock))}>{t('pills.correct')}</button>
          <button className="chip" onClick={() => run(window.drive.pills.answer(m.id, null, 'take'))}>{t('pills.takeNow')}</button>
        </div>
        <h4 className="pills-head">{t('pills.history')}</h4>
        <div className="pills-history">
          {!rows.length && <p className="muted">{t('pills.historyEmpty')}</p>}
          {rows.map((r, i) => <div key={i}><small className="muted">{when(r.when)}</small><span className={r.e ? '' : 'pills-red'}>{what(r.e)}</span></div>)}
        </div>
        <div className="dialog-actions">
          <button className="text-button" onClick={() => { run(window.drive.pills.save({ ...m, archived: !m.archived }, 0, 0)) }}>
            <Icon name={m.archived ? 'unarchive' : 'archive'} size={18} /> {t(m.archived ? 'pills.unarchive' : 'pills.archive')}</button>
          <button className="text-button" onClick={() => setDeleting(true)}><Icon name="trash" size={18} /> {t('common.delete')}</button>
        </div>
      </div>
      {counting != null && <Modal onClose={() => setCounting(null)}>
        <h3>{t('pills.correctTitle')}</h3>
        <input className="field" autoFocus inputMode="decimal" value={counting} onChange={e => setCounting(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && number(counting) != null) { run(window.drive.pills.setStock(m.id, number(counting)!)); setCounting(null) } }} />
        <div className="dialog-actions">
          <button className="text-button" onClick={() => setCounting(null)}>{t('common.cancel')}</button>
          <button className="filled-button" disabled={number(counting) == null} onClick={() => { run(window.drive.pills.setStock(m.id, number(counting)!)); setCounting(null) }}>{t('common.save')}</button>
        </div>
      </Modal>}
      {deleting && <Confirm title={t('pills.deleteTitle', { name: m.title })} body={t('pills.deleteText')} action={t('common.delete')} danger
        onConfirm={() => { setDeleting(false); close(); run(window.drive.pills.remove(m.id)) }} onClose={() => setDeleting(false)} />}
    </Modal>
  )
}

// ——— Progress ———

/** The last 30 days: taken, forgotten, how late; what the numbers suggest; each dose time's days as squares. */
function ProgressPane({ v, meds, apply }: { v: PillsView; meds: Map<string, PillMed>; apply: (m: PillMed, from: string, to: string) => void }) {
  const [gone, setGone] = useState<string[]>([])
  const slots = v.slots.filter(s => meds.has(s.med))
  const due = slots.reduce((n, s) => n + s.due, 0)
  if (!due) return <p className="muted">{t('pills.progressEmpty')}</p>
  const taken = slots.reduce((n, s) => n + s.onTime + s.late, 0)
  const lateAvg = taken ? Math.trunc(slots.reduce((n, s) => n + s.lateMinutes * (s.onTime + s.late), 0) / taken) : 0
  const key = (a: PillAdvice) => `${a.med}|${a.slot}|${a.kind}`
  const text = (a: PillAdvice) => {
    const name = meds.get(a.med)!.title
    return a.kind === 'move' ? t('pills.adviceMove', { name, time: a.slot, at: a.time ?? '' })
      : a.kind === 'days' ? t('pills.adviceDays', { name, time: a.slot, days: a.days.map(d => dayName(DAYS.indexOf(d), 'long')).join(', ') })
      : a.kind === 'bedside' ? t('pills.adviceBedside', { name, time: a.slot }) : t('pills.adviceEarlier', { name, time: a.slot, at: a.time ?? '' })
  }
  return <>
    <div className="pills-metrics">
      <div className="island"><b>{Math.trunc(taken * 100 / due)}%</b><small>{t('pills.mTaken')}</small></div>
      <div className="island"><b>{slots.reduce((n, s) => n + s.missed, 0)}</b><small>{t('pills.mMissed')}</small></div>
      <div className="island"><b>{lateAvg}′</b><small>{t('pills.mLate')}</small></div>
    </div>
    {v.advice.filter(a => meds.has(a.med) && !gone.includes(key(a))).map(a => (
      <div key={key(a)} className="pills-advice">
        <Icon name="sparkle" size={20} /><p>{text(a)}</p>
        <button className="round flat" title={t('common.close')} onClick={() => setGone([...gone, key(a)])}><Icon name="close" size={18} /></button>
        {a.time && <button className="filled-button pills-go" onClick={() => { setGone([...gone, key(a)]); apply(meds.get(a.med)!, a.slot, a.time!) }}>{t('pills.adviceApply', { time: a.time })}</button>}
      </div>))}
    {slots.map(s => {
      const m = meds.get(s.med)!, last = s.doses.slice(-30)
      return (
        <section key={`${s.med}|${s.time}`} className="island pills-card">
          <h3><Emblem m={m} size={32} /><span className="pills-title">{m.title} · {s.time}</span>{s.due > 0 && <small>{Math.trunc((s.onTime + s.late) * 100 / s.due)}%</small>}</h3>
          {/* a square a day, always 30 places: dark on time, light late, red outline forgotten, grey skipped, outlined to come */}
          <div className="pills-squares">
            {Array.from({ length: 30 - last.length }, (_, i) => <span key={`e${i}`} className="none" />)}
            {last.map(d => <span key={d.due} title={`${new Date(d.due).toLocaleDateString(locale())} ${hm(d.due)}`}
              className={d.state === 'taken' ? (d.at != null && d.at - d.due > 30 * 60_000 ? 'late' : 'on') : d.state} />)}
          </div>
        </section>)
    })}
    <p className="muted">{t('pills.progressKey')}</p>
  </>
}

// ——— the guide: a new medicine (or one changed), step by step ———

/** What the guide fills in, as typed: the numbers stay text until saved. */
interface Draft { m: PillMed; dose: string; perBox: string; boxes: string; loose: string; refillDays: string; refillTimes: string; forDays: string; opened: boolean }
const STEPS = 5

/**
 * Five steps (the user, 7 Nov: "a step-by-step guide that takes you by the hand"): the name, how it looks, when, the stock,
 * the refill reminder. The actions at the bottom.
 */
function Guide({ start, fresh, close, save, say }: { start: PillMed; fresh: boolean; close: () => void; save: (m: PillMed, boxes: number, loose: number) => void; say: (text: string) => void }) {
  const [d, setD] = useState<Draft>({ m: start, dose: amount(start.dose), perBox: start.perBox > 0 ? String(start.perBox) : '', boxes: fresh ? '1' : '', loose: '',
    refillDays: String(start.refillDays), refillTimes: String(start.refillTimes), forDays: '', opened: false })
  const [step, setStep] = useState(0)
  const set = (x: Partial<PillMed>) => setD({ ...d, m: { ...d.m, ...x } })
  const full = int(d.boxes) ?? 0, left = d.opened ? number(d.loose) ?? 0 : 0 // new boxes × a box's pills, and what is left in the open one
  const size = int(d.perBox) ?? 0
  const nameOk = !!d.m.name.trim(), doseOk = halves(number(d.dose) ?? 0) > 0, boxOk = !fresh || full === 0 || size > 0
  const can = [nameOk, true, doseOk, boxOk, nameOk && doseOk][step]
  const forDays = int(d.forDays)
  const until = forDays ? dateKey(startOf(Date.now(), forDays - 1)) : d.m.until
  const finish = () => save({ ...d.m, name: d.m.name.trim(), strength: d.m.strength.trim(), dose: halves(number(d.dose) ?? 1), perBox: size,
    refillDays: Math.min(90, int(d.refillDays) ?? 7), refillTimes: Math.min(30, int(d.refillTimes) ?? 3), until }, fresh ? full : 0, fresh ? left : 0)
  const mode = d.m.every > 1 ? 2 : d.m.days.length ? 1 : 0
  // a time on the Timer's clock (the phone's DialDialog): [dial] the one changed, -1 a new one
  const [dial, setDial] = useState<number | null>(null)
  const dialed = (h: number, mi: number) => { const x = `${pad(h)}:${pad(mi)}`; set({ times: [...new Set([...d.m.times.filter((_, j) => j !== dial), x])].sort() }); setDial(null) }
  const dialAt = dial != null && dial >= 0 ? d.m.times[dial] : '21:00'
  let body: ReactNode
  if (step === 0) body = <>
    <h3>{t('pills.qName')}</h3>
    <label className="pills-label">{t('pills.name')}<input className="field" autoFocus value={d.m.name} onChange={e => set({ name: e.target.value })} /></label>
    <label className="pills-label">{t('pills.strength')}<input className="field" placeholder="120 mg" value={d.m.strength} onChange={e => set({ strength: e.target.value })} /></label>
  </>
  else if (step === 1) body = <>
    <h3>{t('pills.qLook')}</h3>
    <div className="pills-center"><Emblem m={d.m} size={120} /></div>
    <h4 className="pills-head">{t('pills.shape')}</h4>
    <div className="pills-shapes">{SHAPES.map(s => <button key={s} className={d.m.shape === s ? 'on' : ''} title={s} onClick={() => set({ shape: s })}>
      <PillShape shape={s} color={d.m.color} color2={d.m.color2} size={52} /></button>)}</div>
    <h4 className="pills-head">{t('pills.color')}</h4>
    <Swatches value={d.m.color} pick={c => set({ color: c })} />
    {(d.m.shape === 'capsule' || d.m.shape === 'liquid') && <>
      <h4 className="pills-head">{t(d.m.shape === 'capsule' ? 'pills.color2' : 'pills.colorCap')}</h4>
      <Swatches value={d.m.color2} pick={c => set({ color2: c })} />
    </>}
    <div className="pills-buttons"><button className="chip" onClick={() => window.drive.pills.pickPhoto(d.m.id).then(p => { if (p) set({ photo: p }) }, e => say(errorText(e)))}>{t('pills.photoPick')}</button></div>
  </>
  else if (step === 2) body = <>
    <h3>{t('pills.qWhen')}</h3>
    <div className="pills-times">
      {d.m.times.map((x, i) => <span key={x} className="pills-time"><PartIcon p={part(x)} size={18} />
        <button className="pills-time-text" onClick={() => setDial(i)}>{x}</button>
        <button className="round flat" title={t('common.remove')} onClick={() => set({ times: d.m.times.filter((_, j) => j !== i) })}><Icon name="close" size={16} /></button></span>)}
      <button className="chip" onClick={() => setDial(-1)}>+ {t('pills.addTime')}</button>
    </div>
    <label className="pills-label">{t('pills.dose')}<input className={`field ${doseOk ? '' : 'pills-bad'}`} inputMode="decimal" value={d.dose} onChange={e => setD({ ...d, dose: e.target.value })} /></label>
    <h4 className="pills-head">{t('pills.howOften')}</h4>
    <div className="chips wrap">
      <button className={`chip ${mode === 0 ? 'on' : ''}`} onClick={() => set({ days: [], every: 1 })}>{t('alarm.everyDay')}</button>
      <button className={`chip ${mode === 1 ? 'on' : ''}`} onClick={() => set({ every: 1, days: d.m.days.length ? d.m.days : ['MO'] })}>{t('pills.someDays')}</button>
      <button className={`chip ${mode === 2 ? 'on' : ''}`} onClick={() => set({ days: [], every: Math.max(2, d.m.every) })}>{t('pills.everyNDays')}</button>
    </div>
    {mode === 1 && <div className="alarm-days pills-days">{DAYS.map((x, i) => <button key={x} className={`round ${d.m.days.includes(x) ? 'on' : ''}`} title={dayName(i, 'short')}
      onClick={() => set({ days: DAYS.filter(y => y === x ? !d.m.days.includes(x) : d.m.days.includes(y)) })}>{dayName(i, 'narrow')}</button>)}</div>}
    {mode === 2 && <div className="pills-every">
      <button className="round flat" onClick={() => set({ every: Math.max(2, d.m.every - 1) })}>−</button><b>{t('pills.everyN', { n: d.m.every })}</b>
      <button className="round flat" onClick={() => set({ every: Math.min(60, d.m.every + 1) })}>+</button></div>}
    <h4 className="pills-head">{t('pills.food')}</h4>
    <div className="chips wrap">
      <button className={`chip ${!d.m.food ? 'on' : ''}`} onClick={() => set({ food: '' })}>{t('pills.foodAny')}</button>
      {FOODS.map(f => <button key={f} className={`chip ${d.m.food === f ? 'on' : ''}`} onClick={() => set({ food: f })}>{foodText(f)}</button>)}
    </div>
    <label className="pills-label">{t('pills.forDays')}<input className="field" inputMode="numeric" value={d.forDays} onChange={e => setD({ ...d, forDays: e.target.value.replace(/\D/g, '') })} />
      <small className="muted">{until ? t('pills.until', { date: shortDate(fromKey(until)) }) : t('pills.forGood')}</small></label>
  </>
  else if (step === 3) body = <>
    <h3>{t('pills.qStock')}</h3>
    <label className="pills-label">{t('pills.perBox')}<input className="field" inputMode="numeric" value={d.perBox} onChange={e => setD({ ...d, perBox: e.target.value.replace(/\D/g, '') })} /></label>
    {/* a new box's size apart from what is in hand (the user, 7 Nov: "I have 48, but a new one has 50") */}
    {fresh ? <>
      <label className="pills-label">{t('pills.boxesNow')}<input className="field" inputMode="numeric" value={d.boxes} onChange={e => setD({ ...d, boxes: e.target.value.replace(/\D/g, '') })} /></label>
      <label className="cal-switch pills-check"><input type="checkbox" checked={d.opened} onChange={e => setD({ ...d, opened: e.target.checked })} /><span>{t('pills.opened')}</span></label>
      {d.opened && <label className="pills-label">{t('pills.looseNow')}<input className="field" inputMode="decimal" value={d.loose} onChange={e => setD({ ...d, loose: e.target.value })} /></label>}
      {full > 0 && !size ? <p className="pills-red">{t('pills.needBoxSize')}</p>
        : (full > 0 || left > 0) && <p className="pills-total">{t('pills.total', { n: amount(halves(full * size + left)) })}</p>}
    </> : <p className="muted">{stockText(d.m)}</p>}
    <p className="muted">{t('pills.stockNote')}</p>
  </>
  else body = <>
    <h3>{t('pills.qRefill')}</h3>
    <label className="pills-label">{t('pills.refillDays')}<input className="field" inputMode="numeric" value={d.refillDays} onChange={e => setD({ ...d, refillDays: e.target.value.replace(/\D/g, '') })} /></label>
    <label className="pills-label">{t('pills.refillTimes')}<input className="field" inputMode="numeric" value={d.refillTimes} onChange={e => setD({ ...d, refillTimes: e.target.value.replace(/\D/g, '') })} /></label>
    <p className="muted">{t('pills.refillNote')}</p>
    {/* the whole of it, to look over before saving */}
    <div className="island pills-summary"><Emblem m={d.m} size={56} />
      <div><strong>{[d.m.name.trim(), d.m.strength.trim()].filter(Boolean).join(' ') || '—'}</strong><small>{timesText({ ...d.m, dose: number(d.dose) ?? 1 })}</small></div></div>
  </>
  return (<>
    <Modal onClose={close}>
      <div className="pills-guide">
        <div className="pills-guide-head">{t(fresh ? 'pills.new' : 'common.edit')} · {t('pills.step', { n: step + 1, of: STEPS })}</div>
        <div className="pills-progress"><span style={{ width: `${(step + 1) / STEPS * 100}%` }} /></div>
        {body}
        <div className="dialog-actions">
          <button className="text-button" onClick={() => step > 0 ? setStep(step - 1) : close()}>{t(step > 0 ? 'common.back' : 'common.cancel')}</button>
          <span className="pills-gap" />
          {!fresh && step < STEPS - 1 && <button className="text-button" disabled={!nameOk || !doseOk} onClick={finish}>{t('common.save')}</button>}
          <button className="filled-button pills-go" disabled={!can} onClick={() => step < STEPS - 1 ? setStep(step + 1) : finish()}>{t(step < STEPS - 1 ? 'pills.next' : 'common.save')}</button>
        </div>
      </div>
    </Modal>
    {dial != null && <DialDialog h0={+dialAt.slice(0, 2)} m0={+dialAt.slice(3)} close={() => setDial(null)} done={dialed}><span className="pills-dial-mark" /></DialDialog>}
  </>)
}

function Swatches({ value, pick }: { value: string; pick: (c: string) => void }) {
  return <div className="pills-swatches">{COLORS.map(c => <button key={c} className={c === value ? 'on' : ''} style={{ background: css(c) }} onClick={() => pick(c)} aria-label={c} />)}</div>
}

/** Settings › Pills: whether this computer reminds too (off by itself: the phone reminds, and a dose is answered once). */
export function PillsSettings() {
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => { window.drive.pills.settings().then(s => setOn(s.reminders), () => {}) }, [])
  if (on == null) return null
  return (
    <section className="settings-card island">
      <h3><Icon name="pill" size={20} />{t('app.pills')}</h3>
      <label className="cal-switch ai-master"><input type="checkbox" checked={on} onChange={e => { setOn(e.target.checked); window.drive.pills.setReminders(e.target.checked) }} />
        <span><strong>{t('calendar.remindersHere')}</strong><br />{t('pills.hereNote')}</span></label>
    </section>
  )
}

/** The phone's chime with a reminder here, whichever page is open (and with the window in the tray). */
export function PillsChime() {
  useEffect(() => window.drive.onPillsChime(() => { new Audio('./pill_chime.wav').play().catch(() => {}) }), [])
  return null
}
