import { useEffect, useState, type CSSProperties } from 'react'
import type { MemoryFact } from './drive'
import { Icon, type IconName } from './Icon'
import { locale, t } from './i18n'
import { errorText } from './Dialogs'
import { ScheduleList } from './Schedules'

/*
 * AI Assist's places beside the chat (the user, 1 Nov 2026): Scheduled, History, Skills, Memory — a sidebar when the window is
 * wide, inside the input's island (its handle) when it is narrow. A pill bar as Contacts' island: the icon always, the label
 * on the chosen one only. And the empty chat's word cloud of what the assistant can do.
 */

export type Section = 'scheduled' | 'history' | 'skills' | 'memory'
const SECTIONS: [Section, IconName, string][] = [['scheduled', 'timer', 'assist.tabSchedules'], ['history', 'history', 'assist.tabHistory'], ['skills', 'sparkle', 'assist.skills'], ['memory', 'person', 'assistant.memory']]

export function SectionBar({ section, pick }: { section: Section; pick: (s: Section) => void }) {
  return <div className="assist-pills" role="tablist">{SECTIONS.map(([id, icon, label]) =>
    <button key={id} role="tab" aria-selected={section === id} title={t(label)} className={section === id ? 'on' : ''} onClick={() => pick(id)}>
      <Icon name={icon} size={20} />{section === id && <span>{t(label)}</span>}
    </button>)}</div>
}

/** Tetra's applet colours. */
export const APP = { photos: '#95DF6B', calendar: '#F41879', mail: '#FD0DA4', notes: '#FED00A', timer: '#04D5CC', assistant: '#FD6A04', files: '#177BFC', maps: '#25C4FE', phone: '#2E8B97' }

/** What the assistant can do here, from its own tools (assistant.js); one whose app the AI switch keeps out is not shown. No alarms: they are the phone's. */
const CAPS: [string, string, string, string | null][] = [
  ['cap.call', 'cap.callPrompt', APP.phone, 'phone'], ['cap.email', 'cap.emailPrompt', APP.mail, 'mail'], ['cap.search', 'cap.searchPrompt', APP.maps, 'web'],
  ['cap.meeting', 'cap.meetingPrompt', APP.calendar, 'calendar'], ['chip.timer', 'chip.timer', APP.timer, 'timer'], ['cap.remind', 'cap.remindPrompt', APP.calendar, 'calendar'],
  ['cap.note', 'cap.notePrompt', APP.notes, 'notes'], ['chip.notes', 'chip.notes', APP.notes, 'notes'], ['chip.image', 'chip.imagePrompt', APP.photos, 'web'],
  ['chip.research', 'chip.researchPrompt', APP.assistant, 'web'], ['chip.brief', 'chip.briefPrompt', APP.calendar, null], ['chip.repeat', 'chip.repeatPrompt', APP.mail, null],
  ['chip.mail', 'chip.mail', APP.mail, 'mail'], ['chip.calendar', 'chip.calendar', APP.calendar, 'calendar'], ['cap.file', 'cap.filePrompt', APP.files, 'files'],
  ['cap.go', 'cap.goPrompt', APP.maps, 'maps'], ['cap.remember', 'cap.rememberPrompt', APP.assistant, null],
  ['cap.fileShow', 'cap.fileShowPrompt', APP.assistant, null],
]
function useCaps() {
  const [apps, setApps] = useState<Record<string, boolean>>({})
  useEffect(() => { const read = () => window.drive.ai.get().then(a => setApps(a.apps)); read(); return window.drive.ai.onChange(read) }, [])
  return CAPS.filter(c => !c[3] || apps[c[3]] !== false)
}

export const AppChip = ({ label, color, size = 1, go }: { label: string; color: string; size?: number; go: () => void }) =>
  <button className="chip app-chip" style={{ '--app': color, fontSize: `${13 * size}px` } as CSSProperties} onClick={go}>{label}</button>

/** The empty chat: a handful of what it can do, mixed sizes, a new handful every few seconds (still with reduced motion). */
export function WordCloud({ offer, hidden }: { offer: (s: string) => void; hidden: boolean }) {
  const caps = useCaps()
  const [round, setRound] = useState(0)
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = setInterval(() => setRound(r => r + 1), 9000)
    return () => clearInterval(id)
  }, [])
  const shown = caps.length <= 10 ? caps : [...caps].sort((a, b) => ((hash(a[0] + round) - hash(b[0] + round)))).slice(0, 10)
  const SIZES = [1.35, 1, 1.15, 0.95, 1.5, 1.05, 1.2, 0.95, 1.1, 1]
  return <div className={`assist-cloud${hidden ? ' gone' : ''}`} key={round}>{shown.map(([l, p, c], i) => <AppChip key={l} label={t(l)} color={c} size={SIZES[i % SIZES.length]} go={() => offer(t(p))} />)}</div>
}
const hash = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)

export function Skills({ offer }: { offer: (s: string) => void }) {
  const caps = useCaps()
  return <div className="assist-chips">{caps.map(([l, p, c]) => <AppChip key={l} label={t(l)} color={c} go={() => offer(t(p))} />)}</div>
}

export function History({ offer, open, current }: { offer: (s: string) => void; open: (id: string) => void; current: string }) {
  const [chats, setChats] = useState<{ id: string; at: number; title: string }[] | null>(null)
  const load = () => window.drive.assistant.chats().then(setChats)
  useEffect(() => { load() }, [current])
  if (!chats) return null
  if (!chats.length) return <><p className="muted">{t('assist.historyHint')}</p>
    <div className="assist-chips">{(['chip.calendar', 'chip.mail'] as const).map(k => <AppChip key={k} label={t(k)} color={k === 'chip.calendar' ? APP.calendar : APP.mail} go={() => offer(t(k))} />)}</div></>
  const when = (ms: number) => new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms)
  return <div className="assist-rows">{chats.map(c => <div key={c.id} className={`assist-row${c.id === current ? ' on' : ''}`}>
    <button className="assist-row-main" onClick={() => open(c.id)}><strong>{c.title}</strong><small>{when(c.at)}</small></button>
    <button className="text-button" title={t('common.delete')} onClick={() => window.drive.assistant.deleteChat(c.id).then(load)}><Icon name="close" size={18} /></button>
  </div>)}</div>
}

const MEMORY_MAX = 20 // memory.js MAX: a few short facts, they go into every request

export function Memory() {
  const [facts, setFacts] = useState<MemoryFact[]>([])
  const [text, setText] = useState('')
  const [said, setSaid] = useState('')
  useEffect(() => { window.drive.memory.list().then(setFacts) }, [])
  const add = () => text.trim() && window.drive.memory.add(text).then(f => { setFacts(f); setText(''); setSaid('') }, e => setSaid(errorText(e)))
  const change = (id: string, to: string) => window.drive.memory.change(id, to).then(setFacts)
  return <>
    <div className="schedule-head"><p className="muted">{facts.length ? t('assistant.memoryHow') : t('assist.memEmpty')}</p><strong>{t('assist.memCount', { n: facts.length, max: MEMORY_MAX })}</strong></div>
    {facts.map(f => <div key={f.id} className="reset-actions">
      <input className="field" defaultValue={f.text} aria-label={t('assistant.memory')} onBlur={e => e.target.value.trim() !== f.text && change(f.id, e.target.value)} />
      <button className="text-button" title={t('common.remove')} onClick={() => change(f.id, '')}><Icon name="close" size={18} /></button>
    </div>)}
    {facts.length < MEMORY_MAX && <div className="reset-actions">
      <input className="field" placeholder={t('assistant.memoryHint')} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
      <button className="filled-button" disabled={!text.trim()} onClick={add}>{t('common.add')}</button>
    </div>}
    {said && <p className="muted">{said}</p>}
  </>
}

/** The chosen section's content. */
export function SectionView({ section, offer, dictate, openChat, chatId }: { section: Section; offer: (s: string) => void; dictate: () => Promise<string | null>; openChat: (id: string) => void; chatId: string }) {
  return <div className="assist-section">
    {section === 'scheduled' && <ScheduleList dictate={dictate} past offer={offer} />}
    {section === 'history' && <History offer={offer} open={openChat} current={chatId} />}
    {section === 'skills' && <Skills offer={offer} />}
    {section === 'memory' && <Memory />}
  </div>
}
