import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'
import type { Contact } from './Contacts'
import type { SmsMessage } from './drive'
import { errorText } from './Dialogs'
import { Face, key, when } from './Phone'
import { t } from './i18n'

// Messages on the computer (the user, 2 Nov: "on the desktop add SMS as well"): the phone's SMS, asked from the phone at
// each look (sync.js smsOnPhone → SyncServer.kt /sms/…) and sent by it. Laid out as the phone's on a tablet (SmsScreen.kt):
// the conversations at the left, the open one beside them; New in the island at the bottom.

const SMS = '#2E9E5B'
interface Thread { id: number; address: string; last: SmsMessage; unread: number }

/** The conversations, newest first (the phone's SmsRules.threads). */
function threadsOf(list: SmsMessage[]): Thread[] {
  const by = new Map<number, SmsMessage[]>()
  for (const m of list) (by.get(m.thread) ?? by.set(m.thread, []).get(m.thread)!).push(m)
  return [...by.entries()].map(([id, ms]) => {
    const last = ms.reduce((a, b) => (b.at > a.at ? b : a))
    return { id, address: last.address, last, unread: ms.filter(m => !m.mine && !m.read).length }
  }).sort((a, b) => b.last.at - a.last.at)
}

export function MessagesPage({ say }: { say: (text: string) => void }) {
  const [messages, setMessages] = useState<SmsMessage[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [open, setOpen] = useState<string | null>(null) // the open conversation's number
  const [writing, setWriting] = useState(false) // New: a number or a contact
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const look = () => window.drive.sms.list().then(r => { if (r.error) setError(r.error); else { setError(null); setMessages(r.messages ?? []) } }, e => setError(errorText(e)))
  useEffect(() => {
    look()
    window.drive.contacts<Contact[]>('list', false).then(setContacts, () => {})
    const timer = setInterval(look, 15_000) // the phone holds them: asked again now and then
    return () => clearInterval(timer)
  }, [])
  const byKey = useMemo(() => new Map(contacts.flatMap(c => c.phones.map(p => [key(p.value), c] as const)).filter(([k]) => k.length >= 5)), [contacts])
  const who = (n: string) => byKey.get(key(n))
  const threads = useMemo(() => threadsOf(messages ?? []), [messages])
  const q = query.trim().toLowerCase(), qd = query.replace(/\D/g, '')
  const shown = threads.filter(th => !q || (who(th.address)?.name ?? '').toLowerCase().includes(q) || (qd.length > 0 && th.address.replace(/\D/g, '').includes(qd)) || th.last.body.toLowerCase().includes(q))
  const thread = open ? threads.find(th => key(th.address) === key(open)) : undefined
  const texts = useMemo(() => thread ? (messages ?? []).filter(m => m.thread === thread.id).sort((a, b) => a.at - b.at) : [], [messages, thread])
  // opened is read, on the phone too
  useEffect(() => { if (thread?.unread) window.drive.sms.read(thread.id).then(look, () => {}) }, [thread?.id])
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [texts.length, open])
  const send = () => {
    const text = draft.trim()
    if (!open || !text || sending) return
    setSending(true)
    window.drive.sms.send(open, text).then(r => {
      if (r.error) say(t('sms.notSent', { error: r.error }))
      else { setDraft(''); setTimeout(look, 1500) } // the phone writes it into Sent; then it shows here
    }, e => say(t('sms.notSent', { error: errorText(e) }))).finally(() => setSending(false))
  }
  const choose = (n: string) => { setOpen(n); setWriting(false); setQuery(''); setDraft('') }
  const people = writing ? contacts.filter(c => c.phones.length && (!q || c.name.toLowerCase().includes(q) || (qd.length > 2 && c.phones.some(p => p.value.replace(/\D/g, '').includes(qd))))).slice(0, 50) : []
  const c = open ? who(open) : undefined

  return (
    <div className="ct sms" style={{ ['--ct' as string]: SMS }}>
      <header className="topbar ct-topbar">
        <div className="island title-island ct-search">
          <Icon name="search" />
          <input placeholder={writing ? t('sms.to') : t('common.search')} value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (writing && e.key === 'Enter' && qd.length >= 3) choose(query.replace(/[^\d+]/g, '')) }} />
          {(query || writing) && <button className="round flat" title={t('common.clear')} onClick={() => { setQuery(''); setWriting(false) }}><Icon name="close" /></button>}
        </div>
      </header>
      <div className="ct-body">
        <section className="ct-list">
          {writing ? <>
            {qd.length >= 3 && <button className="ct-row" onClick={() => choose(query.replace(/[^\d+]/g, ''))}>
              <Face size={40} /><span className="ct-name">{query.trim()}</span></button>}
            {people.flatMap(p => p.phones.map(ph => <button key={p.uid + ph.value} className="ct-row" onClick={() => choose(ph.value)}>
              <Face c={p} size={40} /><span className="ct-name">{p.name}<small>{ph.value}</small></span></button>))}
          </> : <>
            {error && <p className="hint ct-hint">{error}</p>}
            {!error && messages == null && <p className="hint ct-hint">{t('common.loading')}</p>}
            {messages && !threads.length && <p className="hint ct-hint">{t('sms.none')}</p>}
            {shown.map(th => {
              const p = who(th.address)
              return <button key={th.id} className={`ct-row ${open && key(open) === key(th.address) ? 'on' : ''}`} onClick={() => choose(th.address)}>
                <Face c={p} size={44} />
                <span className="ct-name"><span style={th.unread ? { fontWeight: 700 } : undefined}>{p?.name || th.address}</span>
                  <small>{th.last.mine ? `${t('sms.you')}: ` : ''}{th.last.body}</small></span>
                <span className="sms-when"><small>{when(new Date(th.last.at).toISOString())}</small>{th.unread > 0 && <span className="sms-dot" />}</span>
              </button>
            })}
          </>}
        </section>
        <section className="sms-chat">
          {!open ? <p className="hint ct-hint">{t('sms.pick')}</p> : <>
            <div className="sms-head"><Face c={c} size={40} /><div><b>{c?.name || open}</b>{c && <small>{open}</small>}</div></div>
            <div className="sms-texts">
              {!texts.length && <p className="hint ct-hint">{t('sms.noneHere')}</p>}
              {texts.map(m => <div key={m.id} className={`sms-bubble ${m.mine ? 'mine' : ''} ${m.failed ? 'failed' : ''}`}>
                <span>{m.body}</span><small>{m.failed ? t('sms.failed') : m.sending ? t('sms.sending') : when(new Date(m.at).toISOString())}</small></div>)}
              <div ref={end} />
            </div>
            <div className="sms-compose">
              <textarea className="island" rows={1} placeholder={t('sms.write')} value={draft} onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
              <button className="round sms-send" title={t('common.send')} disabled={!draft.trim() || sending} onClick={send}><Icon name="send" /></button>
            </div>
          </>}
        </section>
      </div>
      <div className="ct-dock">
        <nav className="notes-island island">
          <button className={`island-item ${writing ? 'on' : ''}`} onClick={() => { setWriting(true); setQuery('') }}><Icon name="add" size={20} /><span>{t('common.new')}</span></button>
          <button className="island-item" onClick={look}><Icon name="refresh" size={20} /><span>{t('sms.refresh')}</span></button>
        </nav>
      </div>
    </div>
  )
}
