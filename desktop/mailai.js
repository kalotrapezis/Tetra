'use strict'
/**
 * Mail AI (the user, 8 Nov 2026): on the runner computer only (schedule.js's), a while after new mail comes, through
 * mistral-small, each mail once and several to a request. Nothing is sent when the AI or its Mail switch is off (ai.js).
 * Its files, in .System/Mail/Shared/ai (synced; the phone reads them, so their form is a contract):
 *
 *   urgency.jsonl  {"id": <index id>, "score": 0-3, "why": "<one line, Greek>", "at": ms}   a later line with an id replaces it
 *   events.jsonl   {"id": "<mailId>#<n>", "mail": <mailId>, "title", "start": ISO, "end": ISO | null, "allDay": bool,
 *                   "place": string | null, "status": "suggested" | "added" | "dismissed", "at": ms}   the same
 *                  start/end: "YYYY-MM-DDTHH:MM" in local time (no offset), or "YYYY-MM-DD" when allDay; an allDay end is its last day
 *   style.json     {"<address>": {"language", "greeting", "closing", "tone", "phrases": [≤10], "updated": ms}}   weekly, from Sent on disk
 *
 * Never adds to the calendar by itself: the user's «Προσθήκη στο ημερολόγιο» does (add()).
 */
const fs = require('node:fs')
const path = require('node:path')

const DAY = 86_400_000
const BATCH = 8 // mails to a request
const BACK = 3 * DAY // older unread mail is left alone (a first start would score the whole Inbox)
const WAIT = 30_000 // after the last change: the bodies come down right after the headers
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/

/** The lines of a .jsonl, by id, the later winning. */
function readLines(file) {
  const m = new Map()
  let text = ''
  try { text = fs.readFileSync(file, 'utf8') } catch {}
  for (const l of text.split('\n')) { try { const o = JSON.parse(l); if (o?.id != null) m.set(o.id, o) } catch {} }
  return m
}

/** A mail's own words: its text without the quoted mail it answers, cut short (the cost). */
async function textOf(root, e, max = 1500) {
  if (!e.file) return e.snippet || ''
  try {
    const { simpleParser } = require('mailparser')
    const p = await simpleParser(fs.readFileSync(path.join(root, e.file)))
    let t = p.text || ''
    const cut = t.search(/^(>|On .+wrote:|Στις .+έγραψε:|-----Original Message-----|-{2,} ?Forwarded)/m)
    if (cut > 0) t = t.slice(0, cut)
    return t.replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
  } catch { return e.snippet || '' }
}

const URGENCY = `You sort the user's new mail. For each numbered mail answer:
- "score": 0 nothing to do (newsletters, ads, notices), 1 low (worth reading some time), 2 needs attention (a question to answer, a task, a date coming), 3 urgent (today or tomorrow, a payment overdue, a deadline about to pass, someone waiting now);
- "why": one short line in Greek saying why;
- "events": every date the mail asks the user to keep (a meeting, an appointment, an exam, a deadline), each {"title" (short, Greek), "start", "end" or null, "allDay", "place" or null}; start and end "YYYY-MM-DDTHH:MM" in the mail's local time, or "YYYY-MM-DD" with allDay true (a deadline is allDay); none: [].
Today is {today}. Answer one JSON object: {"mails": [{"n": 1, "score": 0, "why": "...", "events": []}, …]}.`

const STYLE = `Below are mails the user wrote from one account. Describe how the user writes, for drafting replies in their voice.
Answer one JSON object: {"language": the language they write in (e.g. "el", "en"), "greeting": their usual greeting, "closing": their usual closing (with their name as they sign), "tone": a few words (e.g. "φιλικό, σύντομο"), "phrases": up to 10 phrases they often use}.`

class MailAi {
  /**
   * [api]: assistant.js's Mistral; [allowed](): the AI and its Mail switch on, and a key; [runs](): this is the runner;
   * [notify](e, score): a new mail's notification (score null: not scored, said as before).
   */
  constructor({ mail, calendar, api, allowed = () => false, runs = () => false, notify = () => {}, changed = () => {}, now = () => Date.now() }) {
    Object.assign(this, { mail, calendar, api, allowed, runs, notify, changed, now })
    this.dir = path.join(mail.root, 'ai')
    this.waiting = new Map() // new mail to notify about once scored
    this.failed = new Set() // a request that failed is not asked again until Tetra starts again (it may cost each time)
    this.timer = null; this.busy = null
  }
  file(n) { return path.join(this.dir, n) }
  append(n, lines) { if (!lines.length) return; fs.mkdirSync(this.dir, { recursive: true }); fs.appendFileSync(this.file(n), lines.map(l => JSON.stringify(l) + '\n').join('')) }
  scores() { return readLines(this.file('urgency.jsonl')) }
  events() { return readLines(this.file('events.jsonl')) }
  style() { try { return JSON.parse(fs.readFileSync(this.file('style.json'), 'utf8')) } catch { return {} } }
  active() { return !!this.allowed() && !!this.runs() }

  /** What the open mail shows: its score and its dates still suggested. */
  forMail(id) {
    return { urgency: this.scores().get(id) ?? null, events: [...this.events().values()].filter(x => x.mail === id && x.status === 'suggested') }
  }
  /** Each scored mail's score, for the list's dots. */
  tiers() { return Object.fromEntries([...this.scores()].map(([id, u]) => [id, u.score])) }

  /** A new mail (mail.js's "new"): true when its notification waits for its score here. */
  takes(e) {
    if (!this.active()) return false
    this.waiting.set(e.id, e); this.kick()
    return true
  }
  /** Mail changed: a run a while after the last change. */
  kick() {
    if (this.timer && this.now() - this.first > 4 * WAIT) return // a long download: it runs anyway, not put off for ever
    if (!this.timer) this.first = this.now()
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = null; this.run().catch(e => console.warn('[mailai]', e.message)) }, WAIT)
    this.timer.unref?.()
  }

  async run() {
    if (this.busy) return this.busy
    this.busy = (async () => {
      if (!this.active()) { for (const e of this.waiting.values()) this.notify(e, null); this.waiting.clear(); return }
      const done = this.scores(), since = this.now() - BACK
      const todo = this.mail.accountsMails().filter(e => e.folder === 'Inbox' && !e.seen && e.date >= since && !done.has(e.id) && !this.failed.has(e.id))
        .sort((a, b) => b.date - a.date).slice(0, 5 * BATCH)
      for (let i = 0; i < todo.length; i += BATCH) await this.batch(todo.slice(i, i + BATCH))
      for (const [id, e] of this.waiting) {
        if (done.has(id)) { this.waiting.delete(id); if (done.get(id).score >= 2) this.notify(e, done.get(id).score) } // scored before
        else if (!todo.some(x => x.id === id)) this.waiting.delete(id) // read meanwhile, or old: no notification
      }
      await this.styles().catch(e => console.warn('[mailai] style', e.message))
    })().finally(() => { this.busy = null })
    return this.busy
  }

  async batch(list) {
    const texts = await Promise.all(list.map(e => textOf(this.mail.root, e)))
    const body = list.map((e, i) => `#${i + 1}\nFrom: ${e.from} <${e.fromAddress}>\nDate: ${new Date(e.date).toISOString()}\nSubject: ${e.subject}\n\n${texts[i]}`).join('\n\n———\n\n')
    let got
    try {
      const today = new Date(this.now()).toISOString().slice(0, 10)
      got = JSON.parse(await this.api.as('mail_ai').complete([{ role: 'system', content: URGENCY.replace('{today}', today) }, { role: 'user', content: body }], { json: true }))
    } catch (err) {
      console.warn('[mailai] scoring failed', err.message)
      for (const e of list) { this.failed.add(e.id); const w = this.waiting.get(e.id); if (w) { this.waiting.delete(e.id); this.notify(w, null) } }
      return
    }
    const at = this.now(), scores = [], events = []
    list.forEach((e, i) => {
      const r = (Array.isArray(got?.mails) ? got.mails : []).find(x => Number(x?.n) === i + 1) ?? {}
      const score = Math.max(0, Math.min(3, Math.round(Number(r.score)) || 0))
      scores.push({ id: e.id, score, why: String(r.why ?? '').replace(/\s+/g, ' ').trim().slice(0, 200), at })
      let n = 0
      for (const x of Array.isArray(r.events) ? r.events : []) {
        const title = String(x?.title ?? '').trim().slice(0, 120), allDay = !!x?.allDay
        let start = String(x?.start ?? ''), end = x?.end ? String(x.end) : null
        if (!title || !ISO.test(start)) continue
        if (allDay) { start = start.slice(0, 10); end = end && ISO.test(end) ? end.slice(0, 10) : null }
        else if (start.length === 10) start += 'T09:00'
        if (end && (!ISO.test(end) || end < start)) end = null
        events.push({ id: `${e.id}#${++n}`, mail: e.id, title, start, end, allDay, place: x?.place ? String(x.place).trim().slice(0, 200) || null : null, status: 'suggested', at })
      }
    })
    this.append('urgency.jsonl', scores); this.append('events.jsonl', events)
    for (const s of scores) { const w = this.waiting.get(s.id); if (w) { this.waiting.delete(s.id); if (s.score >= 2) this.notify(w, s.score) } }
    this.changed()
  }

  /** A suggested date, into the first calendar (as AI Assist's calendar_add), with the mail's subject as its note. */
  add(id) {
    const x = this.events().get(id)
    if (!x) throw new Error('No such suggestion.')
    if (x.status === 'added') return x
    let cal = this.calendar.calendars()[0]
    if (!cal) { this.calendar.newCalendar('Calendar'); cal = this.calendar.calendars()[0] }
    const part = s => ({ date: s.slice(0, 10), time: x.allDay ? null : s.slice(11, 16) })
    const start = part(x.start), end = x.end ? part(x.end) : x.allDay ? { date: start.date, time: null } : start // a timed one with no end: an hour (calendar.js)
    const m = this.mail.entry?.(x.mail)
    const alarms = [x.allDay ? { days: -1, seconds: 9 * 3600, repeat: 0, every: 0 } : { days: 0, seconds: -1800 }]
    this.calendar.save(null, cal.id, { title: x.title, place: x.place ?? '', notes: m ? `${m.from || m.fromAddress}: ${m.subject}` : '', allDay: x.allDay, start, end, rrule: null, alarms })
    return this.mark(x, 'added')
  }
  dismiss(id) { const x = this.events().get(id); if (!x) throw new Error('No such suggestion.'); return this.mark(x, 'dismissed') }
  mark(x, status) { const y = { ...x, status, at: this.now() }; this.append('events.jsonl', [y]); this.changed(); return y }

  /** Each account's writing style, from its own Sent mail on this computer, once a week. */
  async styles() {
    const style = this.style(), week = 7 * DAY
    for (const acc of this.mail.accounts()) {
      const key = String(acc.address || acc.id).toLowerCase()
      if (style[key] && this.now() - style[key].updated < week) continue
      if (this.failed.has('style:' + key)) continue
      const sent = this.mail.accountsMails().filter(e => e.account === acc.id && e.folder === 'Sent' && e.file).sort((a, b) => b.date - a.date).slice(0, 20)
      if (sent.length < 3) continue // too few to say how they write
      const texts = (await Promise.all(sent.map(e => textOf(this.mail.root, e, 800)))).filter(Boolean)
      let got
      try { got = JSON.parse(await this.api.as('mail_style').complete([{ role: 'system', content: STYLE }, { role: 'user', content: texts.join('\n\n———\n\n') }], { json: true })) } catch (e) { this.failed.add('style:' + key); console.warn('[mailai] style', e.message); continue }
      const s = v => String(v ?? '').trim().slice(0, 200)
      style[key] = { language: s(got.language), greeting: s(got.greeting), closing: s(got.closing), tone: s(got.tone),
        phrases: (Array.isArray(got.phrases) ? got.phrases : []).map(s).filter(Boolean).slice(0, 10), updated: this.now() }
      // read again just before writing: a phone may have changed another address's meanwhile (unlikely; it only reads)
      const now = { ...this.style(), [key]: style[key] }
      fs.mkdirSync(this.dir, { recursive: true })
      const part = this.file('.style.json.part')
      fs.writeFileSync(part, JSON.stringify(now, null, 2)); fs.renameSync(part, this.file('style.json'))
    }
  }

  /** For AI Assist's mail report: unread Inbox mail of the last [days] scored ≥ [min], most urgent first. */
  urgent(days = 3, min = 2) {
    const scores = this.scores(), since = this.now() - days * DAY
    return this.mail.accountsMails().filter(e => e.folder === 'Inbox' && !e.seen && e.date >= since && (scores.get(e.id)?.score ?? -1) >= min)
      .map(e => ({ e, u: scores.get(e.id) })).sort((a, b) => b.u.score - a.u.score || b.e.date - a.e.date)
  }
}

module.exports = { MailAi, readLines, textOf }
