'use strict'
/**
 * Tetra's Timer on the computer (Drive-Android Plan.md § Timer; Timer.kt is the phone's twin, the same rules). A timer is
 * one small JSON file in ~/Tetra/.System/Timer/Shared, synced as files are, at once (files.js SCOPES.timer). Every device counts
 * down by itself from the end time in it; only Start, Pause, Resume, Stop and OK write the file:
 *
 *   {"id":"k3f9a2","seconds":300,"label":"","state":"running","ends":"2026-10-18T16:05:00Z","left":0,"rev":1,"by":"Tablet","pinned":false}
 *
 * `pinned`: the card stays when stopped or done, ready to start again; the trash takes it away (on every device).
 * state: running (to `ends`), paused (`left` seconds remain), stopped. `rev` goes up by one each change; the highest wins,
 * equal ones stopped first, so clocks a few seconds apart decide nothing. Claude starts one by writing such a file.
 */
const fs = require('node:fs')
const i18n = require('./i18n')
const path = require('node:path')
const crypto = require('node:crypto')

const RUNNING = 'running', PAUSED = 'paused', STOPPED = 'stopped'
const ORDER = [RUNNING, PAUSED, STOPPED]
const UNANSWERED_MS = 10 * 60_000 // a timer nobody answered rings ten minutes at most
const MAX = 9 // the screen holds nine (the user, 18 Oct)

function parse(text, file = null) {
  try {
    const o = JSON.parse(text)
    if (!o || typeof o !== 'object') return null
    if ((o.kind ?? 'timer') !== 'timer') return null // an alarm or the stopwatch (below)
    const state = String(o.state ?? RUNNING).toLowerCase()
    if (!ORDER.includes(state)) return null
    const ends = typeof o.ends === 'string' && o.ends ? Date.parse(o.ends) : null
    if (Number.isNaN(ends)) return null
    const id = typeof o.id === 'string' && o.id ? o.id : file ? path.basename(file, '.json') : null
    if (!id) return null
    return { id, seconds: Math.max(0, Math.trunc(+o.seconds || 0)), label: typeof o.label === 'string' ? o.label : '', state, ends,
      left: Number.isFinite(+o.left) ? +o.left : 0, rev: Number.isSafeInteger(o.rev) ? o.rev : 0, by: typeof o.by === 'string' ? o.by : '', file, pinned: o.pinned === true }
  } catch { return null }
}

const leftMs = (r, now) => r.state === RUNNING ? Math.max(0, (r.ends ?? 0) - now) : r.state === PAUSED ? Math.round(r.left * 1000) : 0
const over = (r, now) => r.state === STOPPED || (r.state === RUNNING && (r.ends == null || now > r.ends + UNANSWERED_MS))
const card = (r, now) => !over(r, now) || r.pinned
const ringing = (r, now) => r.state === RUNNING && r.ends != null && now >= r.ends && !over(r, now)

/** One record per id: a timer changed on two devices between syncs comes as "x (2).json" beside "x.json". */
function winners(all) {
  const best = new Map()
  const rank = r => [r.rev, ORDER.indexOf(r.state), -(r.file ? path.basename(r.file).length : 0)]
  const better = (a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false }
  for (const r of all) if (!best.has(r.id) || better(r, best.get(r.id))) best.set(r.id, r)
  return [...best.values()]
}

/**
 * Each device writes only its own file of a timer, `<id>.<device>.json`, and the highest rev among them is the timer: two
 * devices never change one file, so sync never keeps two versions side by side ("x (3) (3).json", 18 Oct). A record with no
 * device (written by hand) keeps "<id>.json". As the phone's TimerFiles.fileName.
 */
const fileName = (id, by) => { const tag = String(by ?? '').replace(/[^A-Za-z0-9_-]/g, ''); return tag ? `${id}.${tag}.json` : `${id}.json` }

const json = r => JSON.stringify({ id: r.id, seconds: r.seconds, label: r.label, state: r.state, ends: r.ends == null ? null : new Date(r.ends).toISOString(),
  left: r.left, rev: r.rev, by: r.by, pinned: !!r.pinned }, null, 1) + '\n'

class Timers {
  constructor(root, by = 'Computer') { this.root = root; this.by = by }

  read() {
    let names = []
    try { names = fs.readdirSync(this.root) } catch { return [] }
    return winners(names.filter(n => !n.startsWith('.') && n.toLowerCase().endsWith('.json')).map(n => {
      const f = path.join(this.root, n)
      try { return fs.statSync(f).isFile() ? parse(fs.readFileSync(f, 'utf8'), f) : null } catch { return null }
    }).filter(Boolean))
  }

  /** The timers to show, the one ending first on top, each with its time left by this computer's clock. */
  active(now = Date.now()) {
    return this.read().filter(r => !over(r, now)).map(r => ({ ...r, leftMs: leftMs(r, now), ringing: ringing(r, now) })).sort((a, b) => a.leftMs - b.leftMs)
  }

  /** The cards on the screen: the active ones, then the pinned ones ready to start again (`ready`), nine at most. */
  cards(now = Date.now()) {
    return this.read().filter(r => card(r, now)).map(r => ({ ...r, leftMs: leftMs(r, now), ringing: ringing(r, now), ready: over(r, now) }))
      .sort((a, b) => a.ready - b.ready || a.leftMs - b.leftMs || a.seconds - b.seconds).slice(0, MAX)
  }

  write(r) { return { ...r, file: this.writeText(r.id, r.by, json(r)) } }

  /** A new timer, in the file of one that is over if there is one (its id on, a higher rev): files = timers at once. */
  start(seconds, now = Date.now(), label = '') {
    seconds = Math.trunc(+seconds)
    if (!(seconds > 0 && seconds < 100 * 3600)) throw new Error(i18n.t('timer.tooLong'))
    const all = this.read()
    if (all.filter(r => card(r, now)).length >= MAX) throw new Error(i18n.t('timer.tooMany'))
    const free = all.filter(r => over(r, now) && !r.pinned).sort((a, b) => String(a.file).localeCompare(String(b.file)))[0]
    return this.write({ id: free?.id ?? crypto.randomBytes(3).toString('hex'), seconds, label, state: RUNNING, ends: now + seconds * 1000, left: 0,
      rev: (free?.rev ?? 0) + 1, by: this.by, file: null })
  }

  /** Pause, resume, stop, ok, restart, pin, unpin or trash on [id], as its file is now; answers whether anything changed. */
  change(id, action, now = Date.now()) {
    const r = this.read().find(t => t.id === id)
    if (!r) return false
    let next = null
    if (action === 'pause' && r.state === RUNNING) next = { ...r, state: PAUSED, left: leftMs(r, now) / 1000, ends: null }
    else if (action === 'resume' && r.state === PAUSED) next = { ...r, state: RUNNING, ends: now + Math.round(r.left * 1000), left: 0 }
    else if ((action === 'stop' || action === 'ok') && r.state !== STOPPED) next = { ...r, state: STOPPED, ends: null, left: 0 }
    else if (action === 'restart') next = { ...r, state: RUNNING, ends: now + r.seconds * 1000, left: 0 }
    else if (action === 'pin' || action === 'unpin') { if (r.pinned !== (action === 'pin')) next = { ...r, pinned: action === 'pin' } }
    else if (action === 'trash') next = { ...r, state: STOPPED, ends: null, left: 0, pinned: false }
    if (!next) return false
    this.write({ ...next, rev: r.rev + 1, by: this.by })
    return true
  }

  /**
   * The waste (the user, 21 Oct: "the timer app creates a lot of duplicat files"): sync's "x (2).json" copies from before each
   * device wrote only its own file. Every timer's copies go; when the files that stay would not hold the timer as it is (its
   * newest state, pin and all, was in a copy), this computer first writes it into its own file. Sync never deletes, so the
   * phone does the same (TimerFiles.clean). Answers how many went.
   */
  clean() {
    let names = []
    try { names = fs.readdirSync(this.root) } catch { return 0 }
    const all = names.filter(n => !n.startsWith('.') && n.toLowerCase().endsWith('.json')).map(n => {
      const f = path.join(this.root, n)
      try { return fs.statSync(f).isFile() ? parse(fs.readFileSync(f, 'utf8'), f) : null } catch { return null }
    }).filter(Boolean)
    const copy = r => / \(\d+\)\.json$/i.test(path.basename(r.file))
    let removed = 0
    for (const id of new Set(all.map(r => r.id))) {
      const group = all.filter(r => r.id === id)
      const [w] = winners(group)
      const copies = group.filter(copy)
      if (!copies.length) continue
      const [rest] = winners(group.filter(r => !copy(r)))
      if (!rest || rest.rev < w.rev || rest.state !== w.state || rest.pinned !== w.pinned || rest.ends !== w.ends || rest.left !== w.left) this.write({ ...w, by: this.by })
      for (const r of copies) { try { fs.unlinkSync(r.file); removed++ } catch {} }
    }
    return removed
  }

  /** When the next running timer ends or alarm rings (for the bell), or null. */
  nextEnd(now = Date.now()) {
    const ends = this.read().filter(r => r.state === RUNNING && r.ends != null && r.ends > now).map(r => r.ends)
      .concat(this.alarms().map(a => alarmNext(a, now)).filter(t => t != null))
    return ends.length ? Math.min(...ends) : null
  }

  texts() {
    let names = []
    try { names = fs.readdirSync(this.root) } catch { return [] }
    return names.filter(n => !n.startsWith('.') && n.toLowerCase().endsWith('.json')).map(n => {
      const f = path.join(this.root, n)
      try { return fs.statSync(f).isFile() ? [fs.readFileSync(f, 'utf8'), f] : null } catch { return null }
    }).filter(Boolean)
  }

  /** Every alarm not deleted, by the time of day (TimerAlarmFiles.alarms). */
  alarms() {
    return alarmWinners(this.texts().map(([t, f]) => parseAlarm(t, f)).filter(Boolean)).filter(a => a.state !== A_DELETED)
      .sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id))
  }

  /** The alarms with what the screen shows: ringing (since when), next, on, skipped. */
  alarmCards(now = Date.now()) {
    return this.alarms().map(a => {
      const ring = alarmRinging(a, now), next = alarmNext(a, now)
      return { ...a, ringing: ring, next, on: ring != null || next != null,
        skipped: a.days.length > 0 && a.state === A_ON && ring == null && a.snooze == null && a.answered != null && a.answered > now }
    })
  }

  /** Written beside, then renamed over: nobody reads half a file. */
  writeText(id, by, text) {
    fs.mkdirSync(this.root, { recursive: true })
    const to = path.join(this.root, fileName(id, by))
    const part = path.join(this.root, `.${path.basename(to)}.part`)
    fs.writeFileSync(part, text)
    fs.renameSync(part, to)
    return to
  }

  /** A new alarm at "HH:MM" on [days] (none: once, the next such time), in a deleted one's file if there is one. */
  alarmAdd(time, days, label = '', now = Date.now()) {
    const all = alarmWinners(this.texts().map(([t, f]) => parseAlarm(t, f)).filter(Boolean))
    const gone = all.filter(a => a.state === A_DELETED).sort((a, b) => a.id.localeCompare(b.id))[0]
    const a = { id: gone?.id ?? 'alarm-' + crypto.randomBytes(3).toString('hex'), time: hhmm(time), days: dayCodes(days), date: null, label: String(label),
      state: A_ON, answered: now, snooze: null, rev: (gone?.rev ?? 0) + 1, by: this.by }
    if (!a.days.length) a.date = localDate(occurrence(a, now))
    this.writeText(a.id, this.by, alarmJson(a))
    return a
  }

  /** An alarm's new time, days or label, switched on (TimerControl.alarmEdit). */
  alarmEdit(id, time, days, label, now = Date.now()) {
    const a = this.alarms().find(x => x.id === id)
    if (!a) return false
    this.writeText(id, this.by, alarmJson(switchOn({ ...a, time: hhmm(time), days: dayCodes(days), label: String(label) }, now, this.by)))
    return true
  }

  /** dismiss, snooze, skip (the next one), on, off or delete on the alarm [id] (TimerControl.alarmChange). */
  alarmChange(id, action, now = Date.now()) {
    const a = this.alarms().find(x => x.id === id)
    if (!a) return false
    const ring = alarmRinging(a, now), next = alarmNext(a, now), up = x => ({ ...x, rev: a.rev + 1, by: this.by })
    const dismiss = at => up({ ...a, answered: at, snooze: null, state: a.days.length ? a.state : A_OFF })
    const r = action === 'dismiss' ? ring != null && dismiss(ring)
      : action === 'snooze' ? (ring != null ? up({ ...a, answered: ring, snooze: now + SNOOZE_MS }) : next != null && up({ ...a, answered: next, snooze: next + SNOOZE_MS }))
      : action === 'skip' ? next != null && dismiss(next)
      : action === 'on' ? switchOn(a, now, this.by)
      : action === 'off' ? up({ ...a, state: A_OFF, snooze: null })
      : action === 'delete' ? up({ ...a, state: A_DELETED, snooze: null }) : null
    if (!r) return false
    this.writeText(id, this.by, alarmJson(r))
    return true
  }

  /** The one stopwatch, shared by the devices (StopwatchRecord.winner). */
  stopwatch() {
    const all = this.texts().map(([t, f]) => parseWatch(t, f)).filter(Boolean)
    return all.reduce((b, w) => !b || w.rev > b.rev || (w.rev === b.rev && W_ORDER.indexOf(w.state) > W_ORDER.indexOf(b.state)) ? w : b, null)
      ?? { state: W_RESET, started: null, elapsed: 0, laps: [], rev: 0, by: '' }
  }

  /** start, hold, lap or reset; answers whether anything changed. */
  watch(action, now = Date.now()) {
    const w = this.stopwatch(), up = x => ({ ...x, rev: w.rev + 1, by: this.by })
    const r = action === 'start' ? w.state !== W_COUNTING && up({ ...w, state: W_COUNTING, started: now - watchMs(w, now), elapsed: 0 })
      : action === 'hold' ? w.state === W_COUNTING && up({ ...w, state: W_HELD, elapsed: watchMs(w, now) / 1000, started: null })
      : action === 'lap' ? w.state === W_COUNTING && up({ ...w, laps: [...w.laps, watchMs(w, now) / 1000] })
      : action === 'reset' ? w.state !== W_RESET && up({ ...w, state: W_RESET, started: null, elapsed: 0, laps: [] }) : null
    if (!r) return false
    this.writeText(WATCH_ID, this.by, watchJson(r))
    return true
  }
}

/*
 * Alarms and the stopwatch (the phone's TimerAlarms.kt, the same files and rules): beside the timers, one file per item per
 * device, the highest rev wins; `kind` tells them from timers, whose parse skips them.
 *
 *   {"kind":"alarm","id":"alarm-k3f9a2","time":"07:30","days":["MO","TU"],"date":null,"label":"","state":"on","answered":null,"snooze":null,"rev":1,"by":"Tablet"}
 *   {"kind":"stopwatch","id":"stopwatch","state":"counting","started":"2026-10-29T16:00:00Z","elapsed":0,"laps":[62.4],"rev":3,"by":"Tablet"}
 *
 * Each device rings an alarm in its own time zone; `answered` is the last ring stopped anywhere, `snooze` one more ring.
 */
const A_ON = 'on', A_OFF = 'off', A_DELETED = 'deleted', A_ORDER = [A_ON, A_OFF, A_DELETED] // equal rev: deleted, then off, wins
const W_COUNTING = 'counting', W_HELD = 'held', W_RESET = 'reset', W_ORDER = [W_COUNTING, W_HELD, W_RESET], WATCH_ID = 'stopwatch'
const DAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
const SNOOZE_MS = 10 * 60_000
const pad = n => String(n).padStart(2, '0')
const hhmm = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim()); if (!m || +m[1] > 23 || +m[2] > 59) throw new Error('Time as HH:MM.'); return `${pad(+m[1])}:${m[2]}` }
const dayCodes = days => DAY_CODES.filter(c => (days ?? []).some(d => String(d).toUpperCase().slice(0, 2) === c))
const localDate = t => { if (t == null) return null; const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const instant = v => typeof v === 'string' && v && v !== 'null' && !Number.isNaN(Date.parse(v)) ? Date.parse(v) : null

function parseAlarm(text, file = null) {
  try {
    const o = JSON.parse(text)
    if (o?.kind !== 'alarm') return null
    const state = String(o.state ?? A_ON).toLowerCase()
    if (!A_ORDER.includes(state)) return null
    const id = typeof o.id === 'string' && o.id ? o.id : file ? path.basename(file).split('.')[0] : null
    if (!id) return null
    return { id, time: hhmm(o.time), days: dayCodes(Array.isArray(o.days) ? o.days : []), date: /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : null,
      label: typeof o.label === 'string' ? o.label : '', state, answered: instant(o.answered), snooze: instant(o.snooze),
      rev: Number.isSafeInteger(o.rev) ? o.rev : 0, by: typeof o.by === 'string' ? o.by : '', file }
  } catch { return null }
}
function alarmWinners(all) {
  const best = new Map()
  for (const a of all) { const b = best.get(a.id); if (!b || a.rev > b.rev || (a.rev === b.rev && A_ORDER.indexOf(a.state) > A_ORDER.indexOf(b.state))) best.set(a.id, a) }
  return [...best.values()]
}
const alarmJson = a => JSON.stringify({ kind: 'alarm', id: a.id, time: a.time, days: a.days, date: a.date, label: a.label, state: a.state,
  answered: a.answered == null ? null : new Date(a.answered).toISOString(), snooze: a.snooze == null ? null : new Date(a.snooze).toISOString(), rev: a.rev, by: a.by }, null, 1) + '\n'

/** The first time it is set for after [after] by this computer's clock (snoozes aside), or null: a single one already past. */
function occurrence(a, after) {
  const [h, m] = a.time.split(':').map(Number)
  if (!a.days.length && a.date) { const [y, mo, d] = a.date.split('-').map(Number); const t = new Date(y, mo - 1, d, h, m).getTime(); return t > after ? t : null }
  const f = new Date(after)
  for (let i = 0; i <= 8; i++) {
    const d = new Date(f.getFullYear(), f.getMonth(), f.getDate() + i, h, m)
    if ((!a.days.length || a.days.includes(DAY_CODES[(d.getDay() + 6) % 7])) && d.getTime() > after) return d.getTime()
  }
  return null
}
/** The ring going on now, if one is: set for at most ten minutes ago and not answered anywhere. */
function alarmRinging(a, now) {
  if (a.state !== A_ON) return null
  const since = now - UNANSWERED_MS
  const at = [occurrence(a, Math.max(since, a.answered ?? 0)), a.snooze].filter(t => t != null && t <= now && t > since && (a.answered == null || t > a.answered))
  return at.length ? Math.min(...at) : null
}
/** When it rings next (not counting one ringing now): null when off or a single one gone by. */
function alarmNext(a, now) {
  if (a.state !== A_ON) return null
  const after = Math.max(now, a.answered ?? 0)
  const at = [occurrence(a, after), a.snooze != null && a.snooze > after ? a.snooze : null].filter(t => t != null)
  return at.length ? Math.min(...at) : null
}
/** Switched on: a single one for the next time from now, nothing from before ringing. */
const switchOn = (a, now, by) => ({ ...a, state: A_ON, answered: now, snooze: null, date: a.days.length ? null : localDate(occurrence({ ...a, date: null }, now)), rev: a.rev + 1, by })

function parseWatch(text, file = null) {
  try {
    const o = JSON.parse(text)
    if (o?.kind !== 'stopwatch') return null
    const state = String(o.state ?? W_RESET).toLowerCase()
    if (!W_ORDER.includes(state)) return null
    return { state, started: instant(o.started), elapsed: Number.isFinite(+o.elapsed) ? +o.elapsed : 0,
      laps: Array.isArray(o.laps) ? o.laps.map(Number).filter(Number.isFinite) : [], rev: Number.isSafeInteger(o.rev) ? o.rev : 0, by: typeof o.by === 'string' ? o.by : '', file }
  } catch { return null }
}
const watchMs = (w, now) => w.state === W_COUNTING ? Math.max(0, now - (w.started ?? now)) : w.state === W_HELD ? Math.round(w.elapsed * 1000) : 0
const watchJson = w => JSON.stringify({ kind: 'stopwatch', id: WATCH_ID, state: w.state, started: w.started == null ? null : new Date(w.started).toISOString(),
  elapsed: w.elapsed, laps: w.laps, rev: w.rev, by: w.by }, null, 1) + '\n'

/** "5 min", "1 h 30 min", "45 s": as the phone's durationText. */
function durationText(seconds) {
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60
  return [h && i18n.t('timer.h', { n: h }), m && i18n.t('timer.min', { n: m }), (s || !seconds) && i18n.t('timer.s', { n: s })].filter(Boolean).join(' ')
}

module.exports = { Timers, fileName, parse, winners, leftMs, over, ringing, durationText, UNANSWERED_MS, MAX, parseAlarm, occurrence, alarmRinging, alarmNext, watchMs, SNOOZE_MS }
