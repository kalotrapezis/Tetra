'use strict'
/**
 * Scheduled AI actions (the user, 1 Nov 2026: "once a week, once a year… a notification like the calendar's"): a prompt, a
 * time and a repetition, run here through AI Assist's own chat and tools. One computer runs them (the "runner", the first
 * to see the file); the phone and the tablet see, change and add to the same synced file, and ask the runner to run one
 * now ("runNow"); the result reaches them as a page (Briefs/latest.json):
 *
 *   ~/Tetra/.System/Assistant/Shared/schedules.json   (synced as "AI Assist/schedules.json")
 *   { "list": [ { id, title, prompt, kind: "prompt" | "brief", time: "HH:MM", repeat: "once" | "daily" | "weekly" | "monthly" | "yearly",
 *                 days: [0-6] (weekly, 0 = Sunday), date: "YYYY-MM-DD" (once: the day; monthly: its day; yearly: its day and month),
 *                 until: "YYYY-MM-DD" (its last day, or none), result: "ok" | "held" | "failed" (its last run), paused, created, last, runNow, allow: ["calendar" | "notes" | "timers" | "files"] (done without a yes after mail or the web) } ],
 *     "runner": the computer that runs them (its host name),
 *     "brief": { sections: { calendar: bool, … }, place: { name, lat, lon } } }
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const REPEATS = ['once', 'daily', 'weekly', 'monthly', 'yearly']
/** What one may do on its own (assistant.js ALLOW): its "allow". */
const ALLOW_GROUPS = ['calendar', 'notes', 'timers', 'files']
const pad = n => String(n).padStart(2, '0')
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const daysIn = d => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()

/** Whether [s] runs on the local day [d]; a 31st runs on a short month's last day, a 29 February on the 28th. */
function on(s, d, base) {
  switch (s.repeat) {
    case 'once': return dayKey(d) === s.date
    case 'daily': return true
    case 'weekly': return (s.days ?? []).includes(d.getDay())
    case 'monthly': return d.getDate() === Math.min(base.getDate(), daysIn(d))
    case 'yearly': return d.getMonth() === base.getMonth() && d.getDate() === Math.min(base.getDate(), daysIn(d))
    default: return false
  }
}

/**
 * The first run of [s] after [after] (ms), or null. Each day's time is made in local time, so 08:00 stays 08:00 across a
 * clock change; a time the spring change skips (03:30) runs an hour later, as the clock says.
 */
function nextRun(s, after) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s.time ?? ''))
  if (!m || +m[1] > 23 || +m[2] > 59 || !REPEATS.includes(s.repeat)) return null
  const a = new Date(after), [y, mo, d] = String(s.date || dayKey(new Date(s.created ?? after))).split('-').map(Number)
  const base = new Date(y, mo - 1, d)
  for (let i = 0; i <= 400; i++) { // a year and a little: every repetition comes round in that
    const day = new Date(a.getFullYear(), a.getMonth(), a.getDate() + i)
    if (!on(s, day, base)) continue
    const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), +m[1], +m[2]).getTime()
    if (t > after) return t
  }
  return null
}

/** When [s] is due next: after its last run, else after it was made; null when paused or done (past its "until" day too). */
function due(s) {
  if (s.paused) return null
  const next = nextRun(s, s.last ?? s.created ?? 0)
  if (next == null || !s.until) return next
  const [y, m, d] = s.until.split('-').map(Number)
  return next < new Date(y, m - 1, d + 1).getTime() ? next : null
}

const BRIEF = { id: 'brief', kind: 'brief', title: 'Η ενημέρωση της ημέρας', prompt: '', time: '07:30', repeat: 'daily', days: [], date: null, paused: false }

class Schedules {
  /** [file]: schedules.json; with none yet, the daily brief, on (the user wants it every day). */
  constructor(file, now = () => Date.now()) { this.file = file; this.now = now }
  read() {
    let o = null
    try { o = JSON.parse(fs.readFileSync(this.file, 'utf8')) } catch {}
    // other keys (the runner, a newer version's) are kept as they are
    return { ...o, list: Array.isArray(o?.list) ? o.list : [{ ...BRIEF, created: this.now() }], brief: { sections: {}, place: null, ...o?.brief } }
  }
  write(o) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const part = path.join(path.dirname(this.file), `.${path.basename(this.file)}.part`)
    fs.writeFileSync(part, JSON.stringify(o, null, 2)); fs.renameSync(part, this.file)
  }
  list() { return this.read().list }
  /** A checked copy of [x] over [was]: a time HH:MM, a known repetition, weekdays 0-6, a date YYYY-MM-DD. */
  clean(x, was = {}) {
    const s = { ...was }
    if (x.title != null) s.title = String(x.title).trim().slice(0, 120)
    if (x.prompt != null) s.prompt = String(x.prompt).trim().slice(0, 4000)
    if (x.time != null) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(x.time).trim()); if (!m || +m[1] > 23 || +m[2] > 59) throw new Error(`Not a time: ${x.time}`); s.time = `${pad(+m[1])}:${m[2]}` }
    if (x.repeat != null) { if (!REPEATS.includes(x.repeat)) throw new Error(`Not a repetition: ${x.repeat}`); s.repeat = x.repeat }
    if (x.days != null) s.days = [...new Set((Array.isArray(x.days) ? x.days : [x.days]).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort()
    if (x.date !== undefined) { if (x.date && !/^\d{4}-\d{2}-\d{2}$/.test(x.date)) throw new Error(`Not a date: ${x.date}`); s.date = x.date || null }
    if (x.until !== undefined) { if (x.until && !/^\d{4}-\d{2}-\d{2}$/.test(x.until)) throw new Error(`Not a date: ${x.until}`); s.until = x.until || null }
    if (x.allow != null) s.allow = [...new Set((Array.isArray(x.allow) ? x.allow : []).map(String))].filter(g => ALLOW_GROUPS.includes(g))
    if (x.paused != null) s.paused = !!x.paused
    if (x.runNow != null) s.runNow = !!x.runNow
    if (s.repeat === 'weekly' && !s.days?.length) throw new Error('Say on which weekdays.')
    if (s.repeat === 'once' && !s.date) s.date = dayKey(new Date(this.now()))
    return s
  }
  add(x) {
    const o = this.read()
    const s = this.clean({ repeat: 'daily', ...x }, { id: crypto.randomUUID(), kind: 'prompt', title: '', prompt: '', days: [], date: null, paused: false, created: this.now() })
    if (!s.prompt || !s.time) throw new Error('Say what to do and when.')
    if (!s.title) s.title = s.prompt.slice(0, 60)
    o.list.push(s); this.write(o)
    return s
  }
  /** Changes one; a new time or repetition counts from now, so a change does not run it at once for a time gone by. */
  change(id, x) {
    const o = this.read(), i = o.list.findIndex(s => s.id === id)
    if (i < 0) throw new Error('No such scheduled action.')
    const s = this.clean(x, o.list[i])
    if (['time', 'repeat', 'days', 'date'].some(k => x[k] != null) || x.paused === false) s.last = this.now()
    o.list[i] = s; this.write(o)
    return s
  }
  /** Gone, and remembered as gone ("removed": id → when), so a merge with a device's older copy does not bring it back. */
  remove(id) { const o = this.read(); o.list = o.list.filter(s => s.id !== id); o.removed = { ...o.removed, [id]: this.now() }; this.write(o) }
  /** How its last run went (the user, 14 Nov: a green, yellow or red dot): "ok", "held" (something waits for a yes) or "failed". */
  result(id, r) { const o = this.read(), s = o.list.find(s => s.id === id); if (s) { s.result = r; s.resultAt = this.now(); this.write(o) } }
  ran(id, at) { const o = this.read(), s = o.list.find(s => s.id === id); if (s) { s.last = at; this.write(o) } }
  /** Whether [me] runs them: the runner named in the file, or the first computer to ask, which becomes it. */
  runs(me) { const o = this.read(); if (!o.runner) { o.runner = me; this.write(o) } return o.runner === me }
  setBrief(x) { const o = this.read(); o.brief = { ...o.brief, ...x, sections: { ...o.brief.sections, ...x.sections } }; this.write(o); return o.brief }
}

/**
 * Two versions of schedules.json as one, when this computer and a device both changed it before a sync (8 Nov: the runner
 * writes "last" at every run, so a device's edit kept landing beside it as "schedules (2)…(8).json"). [newer] (the device's)
 * wins key by key, each schedule by its id; "last" is the later of both; one in either is kept unless "removed" (either's)
 * says it went after it was made.
 * shortcut: no common ancestor, so an edit to the same schedule on both sides keeps the device's; per-field times if that bites.
 */
function mergeSchedules(older, newer) {
  const read = t => { try { const o = JSON.parse(t); return Array.isArray(o?.list) ? o : null } catch { return null } }
  const a = read(older), b = read(newer)
  if (!a || !b) return b ? newer : older // one is not a schedules file (cut short?): keep the one that is, as before
  const removed = { ...a.removed }
  for (const [id, at] of Object.entries(b.removed ?? {})) removed[id] = Math.max(at, removed[id] ?? 0)
  const byId = new Map()
  for (const s of [...(a.list ?? []), ...(b.list ?? [])]) {
    const was = byId.get(s.id)
    const last = Math.max(was?.last ?? 0, s.last ?? 0)
    byId.set(s.id, { ...was, ...s, ...(last ? { last } : {}) })
  }
  const list = [...byId.values()].filter(s => !(removed[s.id] >= (s.created ?? 0)))
  return JSON.stringify({ ...a, ...b, list, ...(Object.keys(removed).length ? { removed } : {}) }, null, 2)
}

/** A run's chat log (assistant.js Chat.log) as its result. */
const outcome = log => log.some(e => e.kind === 'failed') ? 'failed' : log.some(e => e.kind === 'held') ? 'held' : 'ok'

module.exports = { outcome, Schedules, nextRun, due, mergeSchedules, REPEATS, ALLOW_GROUPS, BRIEF }
