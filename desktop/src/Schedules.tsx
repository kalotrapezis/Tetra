import { useEffect, useState, type CSSProperties } from 'react'
import type { BriefSettings, Repeat, Schedule } from './drive'
import { Icon } from './Icon'
import { locale, t } from './i18n'
import { errorText } from './Dialogs'

/**
 * Scheduled AI actions (schedule.js, brief.js), in AI Assist's own Scheduled tab and in Settings › AI Assist: each one's time
 * and repetition, paused, run now, edited, deleted; a new one by hand (the mic dictates what to do) or said in the chat; the
 * daily brief's sections and the weather's place; the pages they made, newest first.
 */
const REPEATS: Repeat[] = ['once', 'daily', 'weekly', 'monthly', 'yearly']
const BRIEF_SECTIONS: [string, string][] = [['calendar', 'app.calendar'], ['mail', 'app.mail'], ['weather', 'brief.weather'], ['notes', 'brief.lists']]
type Draft = Pick<Schedule, 'title' | 'prompt' | 'time' | 'repeat' | 'days' | 'date'> & { id?: string; kind?: Schedule['kind'] }
const fresh = (): Draft => ({ title: '', prompt: '', time: '08:00', repeat: 'daily', days: [1], date: null })

export function ScheduleList({ dictate, past = false, offer }: { dictate?: () => Promise<string | null>; past?: boolean; offer?: (prompt: string) => void }) {
  const [o, setO] = useState<{ list: Schedule[]; brief: BriefSettings; ready: boolean } | null>(null)
  const [results, setResults] = useState<{ file: string; title: string; at: number }[]>([])
  const [editing, setEditing] = useState<Draft | null>(null)
  const [busy, setBusy] = useState('')
  const [said, setSaid] = useState<{ id: string; text?: string; file?: string } | null>(null)
  const [place, setPlace] = useState('')
  const [hearing, setHearing] = useState(false)
  const load = () => { window.drive.schedules.list().then(setO); if (past) window.drive.schedules.results().then(setResults) }
  useEffect(() => { load(); return window.drive.schedules.onChange(load) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (!o) return null
  const weekday = (d: number) => new Intl.DateTimeFormat(locale(), { weekday: 'short' }).format(new Date(2026, 10, 1 + d)) // 1 Nov 2026 was a Sunday
  const when = (ms: number, time = true) => new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short', ...(time ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}) }).format(ms)
  const how = (s: Schedule) => [t(`sched.${s.repeat}`) + (s.repeat === 'weekly' ? ` (${s.days.map(weekday).join(', ')})` : s.repeat !== 'daily' && s.date ? ` (${s.date})` : ''), s.time].join(' · ')
  const fail = (id: string) => (e: unknown) => setSaid({ id, text: errorText(e) })
  const change = (id: string, x: Partial<Schedule>) => window.drive.schedules.change(id, x).then(load, fail(id))
  const save = () => {
    if (!editing) return
    const { id, title, prompt, time, repeat, days, date } = editing
    const done = () => { setEditing(null); load() }
    if (id) change(id, { title, prompt, time, repeat, days, date }).then(() => setEditing(null))
    else window.drive.schedules.add({ title, prompt, time, repeat, days, date }).then(done, fail('new'))
  }
  const run = (id: string) => { setBusy(id); setSaid(null); window.drive.schedules.run(id).then(file => setSaid({ id, file: file ?? undefined }), fail(id)).finally(() => { setBusy(''); load() }) }
  const setBrief = (x: Partial<BriefSettings>) => window.drive.schedules.setBrief(x).then(brief => setO({ ...o, brief }))
  const findPlace = () => window.drive.schedules.place(place).then(p => { if (p) { setBrief({ place: p }); setPlace('') } else setSaid({ id: 'brief', text: t('brief.placeNotFound') }) }, fail('brief'))
  const hear = () => { if (!dictate || !editing) return; setHearing(true); dictate().then(x => x && setEditing(e => e && { ...e, prompt: [e.prompt, x].filter(Boolean).join(' ') }), fail('new')).finally(() => setHearing(false)) }

  const editor = (d: Draft) => <div className="schedule-edit">
    {d.kind !== 'brief' && <>
      <div className="schedule-say">
        <textarea className="field" rows={2} value={d.prompt} placeholder={t('sched.prompt')} onChange={e => setEditing({ ...d, prompt: e.target.value })} />
        {dictate && <button className={`round assist-mic${hearing ? ' hearing' : ''}`} title={t('assistant.tapToTalk')} disabled={hearing} onClick={hear}>{hearing ? <span className="spinner" /> : <Icon name="mic" />}</button>}
      </div>
      <input className="field" value={d.title} placeholder={t('common.name')} onChange={e => setEditing({ ...d, title: e.target.value })} />
    </>}
    <div className="reset-actions">
      <input className="field" type="time" value={d.time} aria-label={t('sched.time')} onChange={e => setEditing({ ...d, time: e.target.value })} />
      <select className="field" value={d.repeat} aria-label={t('sched.repeat')} onChange={e => setEditing({ ...d, repeat: e.target.value as Repeat })}>
        {REPEATS.map(r => <option key={r} value={r}>{t(`sched.${r}`)}</option>)}</select>
      {['once', 'monthly', 'yearly'].includes(d.repeat) && <input className="field" type="date" value={d.date ?? ''} aria-label={t('sched.date')} onChange={e => setEditing({ ...d, date: e.target.value || null })} />}
    </div>
    {d.repeat === 'weekly' && <div className="chips wrap">{[1, 2, 3, 4, 5, 6, 0].map(n =>
      <button key={n} className={`chip${d.days.includes(n) ? ' on' : ''}`} onClick={() => setEditing({ ...d, days: d.days.includes(n) ? d.days.filter(x => x !== n) : [...d.days, n] })}>{weekday(n)}</button>)}</div>}
    {d.kind === 'brief' && <>
      <h4>{t('brief.sections')}</h4>
      <div className="ai-apps">{BRIEF_SECTIONS.map(([id, key]) =>
        <label key={id} className="cal-switch"><input type="checkbox" checked={o.brief.sections[id] !== false} onChange={e => setBrief({ sections: { [id]: e.target.checked } })} /><span>{t(key)}</span></label>)}</div>
      <h4>{t('brief.place')}</h4>
      <p className="muted">{o.brief.place?.name ?? t('brief.placeMissing')}</p>
      <div className="reset-actions"><input className="field" value={place} placeholder={t('brief.placeHint')} onChange={e => setPlace(e.target.value)} onKeyDown={e => e.key === 'Enter' && findPlace()} />
        <button className="text-button" disabled={!place.trim()} onClick={findPlace}>{t('common.search')}</button></div>
      {said?.id === 'brief' && <p className="muted">{said.text}</p>}
    </>}
    {said?.id === 'new' && <p className="muted">{said.text}</p>}
    <div className="reset-actions"><button className="filled-button" disabled={d.kind !== 'brief' && !d.prompt.trim()} onClick={save}>{t('common.save')}</button>
      <button className="text-button" onClick={() => setEditing(null)}>{t('common.cancel')}</button></div>
  </div>

  return <>
    <div className="schedule-head">
      <h3><Icon name="sparkle" size={20} />{t('sched.title')}</h3>
      <button className="outline-button" onClick={() => { setSaid(null); setEditing(editing && !editing.id ? null : fresh()) }}><Icon name="add" size={18} />{t('sched.new')}</button>
    </div>
    <p className="muted">{t('sched.how')}</p>
    {/* one tap to a ready prompt in the chat: the list helps make the first one, not only says there is none */}
    {offer && <div className="assist-chips">{([['sched.ex1', 'chip.briefPrompt', '#F41879'], ['sched.ex2', 'sched.ex2Prompt', '#F41879'], ['sched.ex3', 'chip.repeatPrompt', '#FD0DA4']] as const).map(([l, p, c]) =>
      <button key={l} className="chip app-chip" style={{ '--app': c } as CSSProperties} onClick={() => offer(t(p))}>{t(l)}</button>)}</div>}
    {!o.ready && <p><strong>{t('sched.noAi')}</strong></p>}
    {editing && !editing.id && editor(editing)}
    {o.list.map(s => <div key={s.id}>
      <div className="schedule-row">
        <span className="schedule-what"><strong>{s.kind === 'brief' ? t('brief.title') : s.title}</strong>
          <small>{how(s)} · {s.paused ? t('sched.paused') : s.next ? t('sched.next', { when: when(s.next) }) : t('common.done')}</small></span>
        <span className="reset-actions">
          <button className="text-button" disabled={!!busy || !o.ready} onClick={() => run(s.id)}>{busy === s.id ? t('sched.running') : t('sched.runNow')}</button>
          <button className="text-button" onClick={() => change(s.id, { paused: !s.paused })}>{s.paused ? t('common.resume') : t('common.pause')}</button>
          <button className="text-button" onClick={() => { setSaid(null); setEditing(editing?.id === s.id ? null : s) }}>{t('common.edit')}</button>
          {s.kind !== 'brief' && <button className="text-button" onClick={() => window.drive.schedules.remove(s.id).then(load)}>{t('common.delete')}</button>}
        </span>
      </div>
      {said?.id === s.id && <p className="muted">{said.text}{said.file && <button className="text-button" onClick={() => window.drive.schedules.open(said.file!)}>{t('common.open')}</button>}</p>}
      {editing?.id === s.id && editor(editing)}
    </div>)}
    {past && <>
      <h4>{t('assist.past')}</h4>
      {results.length ? <div className="schedule-past">{results.map(r =>
        <button key={r.file} className="chip" onClick={() => window.drive.schedules.open(r.file)}>{when(r.at, false)} · {r.title}</button>)}</div>
        : <p className="muted">{t('assist.noPast')}</p>}
    </>}
  </>
}
