'use strict'
/**
 * Pills on the computer (the phone's Pills.kt and PillsAlarms.kt, the same files and rules; PILLS_FORMAT is the contract):
 * medicines, their times, the stock in hand and the history, in ~/Tetra/.System/Pills/Shared, synced as `Pills/…` (files.js
 * SCOPES.pills). As the Timer's, every device writes only its own files, so sync never keeps two versions of one:
 *
 *   pill-<id8>.<tag>.json  a medicine; the highest `rev` among an id's files wins (equal: deleted, then the shorter name)
 *   pill-<id8>.jpg         its photo, the emblem (384×384, the centre square)
 *   log.<tag>.jsonl        one line an event, appended only; a reader merges every log*.jsonl, by `at`, identical lines once
 *
 * The stock is never stored: it is worked out from the logs (the last count, the boxes added since, the doses taken since),
 * so a dose taken on two devices counts once and nothing two devices write can disagree.
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

/** Reminded at the dose's time and again after these, unless answered; 30 min after the last it is missed. */
const AGAIN_MS = [0, 30 * 60_000, 60 * 60_000]
const MISSED_MS = AGAIN_MS[2] + 30 * 60_000
const DAY_MS = 86_400_000
const DAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
const SHAPES = ['round', 'oval', 'capsule', 'liquid']
const FOODS = ['with', 'before', 'after', 'empty']
const WHITE = '#FFF7F5F0'
/** The colours a pill is drawn in (Pills.kt COLORS): white, yellow, orange, pink, red, purple, blue, green, brown. */
const COLORS = [WHITE, '#FFF4D35E', '#FFEF9F27', '#FFE5487A', '#FFE24B4A', '#FF8E6CC9', '#FF378ADD', '#FF1D9E75', '#FF8B6B4A']
const TAKEN = 'taken', SKIPPED = 'skipped', UNDO = 'undo', STOCK = 'stock'
const ANSWERS = [TAKEN, SKIPPED, UNDO]

const pad = n => String(n).padStart(2, '0')
const tagOf = by => String(by ?? '').replace(/[^A-Za-z0-9_-]/g, '')
const halves = v => Math.round(v * 2) / 2
/** "1", "0,5", "2,5" as the user reads them (Medicine.amount). */
const amount = v => Number.isInteger(v) ? String(v) : String(v).replace('.', ',')
const iso = t => new Date(t).toISOString().replace('.000Z', 'Z') // as Kotlin's Instant prints it
const localDate = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const midnight = (t, plus = 0) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + plus).getTime() }
const clock = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
const weekday = t => DAY_CODES[(new Date(t).getDay() + 6) % 7]
const hhmm = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim()); return m && +m[1] < 24 && +m[2] < 60 ? `${pad(+m[1])}:${m[2]}` : null }
const instant = v => typeof v === 'string' && v && v !== 'null' && !Number.isNaN(Date.parse(v)) ? Date.parse(v) : null
const num = (v, d) => v != null && v !== '' && Number.isFinite(+v) ? +v : d
const str = v => typeof v === 'string' ? v : ''
const day = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
const title = m => m.strength ? `${m.name} ${m.strength}` : m.name
const newId = () => 'pill-' + crypto.randomBytes(4).toString('hex')

/** A medicine's file, or null; `stock`/`counted` of older files are left out (the stock comes from the logs). */
function parse(text, file = null) {
  try {
    const o = JSON.parse(text)
    if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !o.id) return null
    const color = c => typeof c === 'string' && /^#[0-9a-f]{8}$/i.test(c) ? c.toUpperCase() : WHITE
    return {
      id: o.id, name: str(o.name), strength: str(o.strength), dose: num(o.dose, 1) > 0 ? Math.max(0.5, halves(num(o.dose, 1))) : 1,
      times: [...new Set((Array.isArray(o.times) ? o.times : []).map(hhmm).filter(Boolean))].sort(),
      days: DAY_CODES.filter(c => (Array.isArray(o.days) ? o.days : []).some(d => String(d).toUpperCase().slice(0, 2) === c)),
      every: Math.min(365, Math.max(1, Math.trunc(num(o.every, 1)))), until: day(o.until),
      perBox: Math.max(0, Math.trunc(num(o.perBox, 0))), refillDays: Math.trunc(num(o.refillDays, 7)), refillTimes: Math.trunc(num(o.refillTimes, 3)),
      refillAsked: Math.trunc(num(o.refillAsked, 0)), refillOn: day(o.refillOn), archived: o.archived === true, since: instant(o.since),
      shape: SHAPES.includes(o.shape) ? o.shape : 'round', color: color(o.color), color2: color(o.color2), food: FOODS.includes(o.food) ? o.food : '',
      rev: Number.isSafeInteger(o.rev) ? o.rev : 0, by: str(o.by), deleted: o.deleted === true, file,
    }
  } catch { return null }
}

/** One medicine per id: the highest rev; equal revs, deleted wins, then the longer file name ("x (2).json") loses. */
function winners(all) {
  const best = new Map()
  const len = m => m.file ? path.basename(m.file).length : 0
  const better = (a, b) => a.rev !== b.rev ? a.rev > b.rev : a.deleted !== b.deleted ? a.deleted : len(a) < len(b)
  for (const m of all) if (!best.has(m.id) || better(m, best.get(m.id))) best.set(m.id, m)
  return [...best.values()]
}

const json = m => JSON.stringify({ id: m.id, name: m.name, strength: m.strength, dose: m.dose, times: m.times, days: m.days, every: m.every, until: m.until,
  perBox: m.perBox, refillDays: m.refillDays, refillTimes: m.refillTimes, refillAsked: m.refillAsked, refillOn: m.refillOn, archived: !!m.archived,
  since: m.since == null ? null : iso(m.since), shape: m.shape, color: m.color, color2: m.color2, food: m.food, rev: m.rev, by: m.by, deleted: !!m.deleted }, null, 1) + '\n'

function parseEvent(line) {
  try {
    const o = JSON.parse(line)
    const at = instant(o?.at)
    if (at == null || typeof o.med !== 'string' || typeof o.kind !== 'string') return null
    return { at, med: o.med, kind: o.kind, due: instant(o.due), amount: num(o.amount, 0), stock: num(o.stock, 0), note: str(o.note) }
  } catch { return null }
}
const eventJson = e => JSON.stringify({ at: iso(e.at), med: e.med, kind: e.kind, due: e.due == null ? null : iso(e.due), amount: e.amount, stock: e.stock, ...(e.note ? { note: e.note } : {}) })

/** Every device's log as one, oldest first; a line two logs hold (a sync copy) once. */
function mergeLogs(texts) {
  const seen = new Map()
  for (const text of texts) for (const line of String(text).split('\n')) {
    const e = line.trim() && parseEvent(line)
    if (e) seen.set(eventJson(e), e)
  }
  return [...seen.values()].sort((a, b) => a.at - b.at)
}

/** The last answer (taken, skipped, undo) of each dose, by `${med}|${due}`. */
function answers(log) {
  const last = new Map()
  for (const e of log) if (e.due != null && ANSWERS.includes(e.kind)) last.set(`${e.med}|${e.due}`, e)
  return last
}

/** The pills in hand: the last count, plus the boxes added since, less the doses whose last answer is a take since. */
function stockOf(id, log) {
  const mine = log.filter(e => e.med === id)
  const count = mine.filter(e => e.kind === STOCK && e.note === 'count').pop()
  const from = count ? count.at : -Infinity
  let s = count ? count.stock : 0
  for (const e of mine) if (e.kind === STOCK && e.note !== 'count' && e.at > from) s += e.amount
  for (const e of answers(mine).values()) if (e.kind === TAKEN && e.at > from) s -= e.amount
  for (const e of mine) if (e.kind === TAKEN && e.due == null && e.at > from) s -= e.amount
  return { stock: halves(Math.max(0, s)), counted: mine.some(e => e.kind === STOCK) }
}

/** Pills a day, on average. */
const perDay = m => m.dose * m.times.length * (m.every > 1 ? 1 / m.every : (m.days.length || 7) / 7)

/** A medicine with what the logs say of it: stock, counted, days left, the last day, low. */
function derive(m, log, now = Date.now()) {
  const { stock, counted } = stockOf(m.id, log)
  const a = perDay(m)
  const daysLeft = counted && a > 0 ? Math.floor(stock / a + 1e-9) : null
  return { ...m, title: title(m), stock, counted, daysLeft, lastDay: daysLeft == null ? null : localDate(midnight(now, daysLeft) + 12 * 3600_000),
    low: !m.archived && daysLeft != null && daysLeft <= m.refillDays }
}

/** Whether [m] is taken on the day starting at local midnight [d]. */
function takenOn(m, d) {
  if (m.archived || m.deleted || (m.until && localDate(d) > m.until)) return false
  if (m.every > 1) {
    const s = new Date(m.since ?? d), x = new Date(d)
    const n = Math.round((Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()) - Date.UTC(s.getFullYear(), s.getMonth(), s.getDate())) / DAY_MS)
    return n >= 0 && n % m.every === 0
  }
  return !m.days.length || m.days.includes(weekday(d))
}

/** The doses due in [from, to), earliest first, with their states at [now]: { med, due, state, at }. */
function doses(meds, log, from, to, now) {
  const answered = answers(log), out = []
  for (const m of meds) {
    if (m.archived || m.deleted) continue
    for (let d = midnight(from); d <= to; d = midnight(d, 1)) {
      if (!takenOn(m, d)) continue
      for (const t of m.times) {
        const [h, mi] = t.split(':').map(Number), x = new Date(d)
        const due = new Date(x.getFullYear(), x.getMonth(), x.getDate(), h, mi).getTime()
        if (due < from || due >= to || (m.since != null && due < m.since)) continue
        const a = answered.get(`${m.id}|${due}`)
        const state = a?.kind === TAKEN ? 'taken' : a?.kind === SKIPPED ? 'skipped' : now - due > MISSED_MS ? 'missed' : 'waiting'
        out.push({ med: m, due, state, at: a && a.kind !== UNDO ? a.at : null })
      }
    }
  }
  return out.sort((a, b) => a.due - b.due || a.med.name.toLowerCase().localeCompare(b.med.name.toLowerCase()))
}

/** Today's doses, and before them any of the last 24 h still waiting or missed (yesterday's 21:00 shown at 08:00). */
function today(meds, log, now) {
  const start = midnight(now)
  return doses(meds, log, Math.min(now - DAY_MS, start), midnight(now, 1), now).filter(d => d.due >= start || d.state === 'missed' || d.state === 'waiting')
}

/** Part of the day of "HH:MM": 0 morning 04–10:59, 1 midday 11–16:59, 2 evening 17–21:59, 3 night. */
const part = t => { const h = +String(t).slice(0, 2); return h >= 4 && h <= 10 ? 0 : h >= 11 && h <= 16 ? 1 : h >= 17 && h <= 21 ? 2 : 3 }
const lateMin = d => d.at == null ? 0 : Math.max(0, Math.trunc((d.at - d.due) / 60_000))

/** The last [days] days by medicine and time: due (answered or missed), on time (≤ 30 min late), late, missed or skipped, minutes late. */
function slots(meds, log, now, days = 30) {
  const groups = new Map()
  for (const d of doses(meds, log, midnight(now, -(days - 1)), now, now)) {
    const k = `${d.med.id}|${clock(d.due)}`
    if (!groups.has(k)) groups.set(k, { med: d.med, time: clock(d.due), doses: [] })
    groups.get(k).doses.push(d)
  }
  return [...groups.values()].map(s => {
    const taken = s.doses.filter(d => d.state === 'taken')
    return { ...s, due: s.doses.filter(d => d.state !== 'waiting').length, onTime: taken.filter(d => lateMin(d) <= 30).length, late: taken.filter(d => lateMin(d) > 30).length,
      missed: s.doses.filter(d => d.state === 'missed' || d.state === 'skipped').length,
      lateMinutes: taken.length ? Math.trunc(taken.reduce((n, d) => n + lateMin(d), 0) / taken.length) : 0 }
  }).sort((a, b) => a.time.localeCompare(b.time))
}

const minus30 = t => { const n = (+t.slice(0, 2) * 60 + +t.slice(3) - 30 + 1440) % 1440; return `${pad(Math.floor(n / 60))}:${pad(n % 60)}` }

/** What the numbers suggest (Pills.advice), worked out here with no AI: { slot, kind: move | days | bedside | earlier, time?, days? }. */
function advice(list) {
  return list.filter(s => s.due >= 7).map(s => {
    const taken = s.doses.filter(d => d.state === 'taken' && d.at != null)
    const lateOnes = taken.filter(d => lateMin(d) > 30)
    // taken late more often than not: the reminder moved to the median time it is really taken, to 15 min
    if (lateOnes.length * 2 > taken.length && taken.length >= 4) {
      const mins = lateOnes.map(d => { const x = new Date(d.at); return x.getHours() * 60 + x.getMinutes() }).sort((a, b) => a - b)
      const r = Math.floor((mins[Math.floor(mins.length / 2)] + 7) / 15) * 15 % 1440
      return { slot: s, kind: 'move', time: `${pad(Math.floor(r / 60))}:${pad(r % 60)}` }
    }
    // forgotten on the same weekdays, when those are fewer than half its weekdays
    const count = new Map()
    for (const d of s.doses) if (d.state === 'missed') count.set(weekday(d.due), (count.get(weekday(d.due)) ?? 0) + 1)
    const often = DAY_CODES.filter(c => (count.get(c) ?? 0) >= 2)
    const scheduled = new Set(s.doses.map(d => weekday(d.due)))
    if (s.missed >= 3 && often.length && often.length * 2 < scheduled.size) return { slot: s, kind: 'days', days: often }
    if (s.missed * 5 >= s.due && part(s.time) >= 2) return { slot: s, kind: 'bedside' }
    return s.missed * 5 >= s.due ? { slot: s, kind: 'earlier', time: minus30(s.time) } : null
  }).filter(Boolean)
}

/** The reminders due now: each dose time with doses waiting, at its latest step (0, +30, +60 min) gone by. */
function rings(meds, log, now) {
  const by = new Map()
  for (const d of doses(meds, log, now - MISSED_MS, now + 1, now)) if (d.state === 'waiting') {
    if (!by.has(d.due)) by.set(d.due, [])
    by.get(d.due).push(d)
  }
  return [...by].map(([due, list]) => ({ due, step: AGAIN_MS.filter(a => due + a <= now).length - 1, doses: list }))
}

/** When the next reminder (a dose's time, or again for one not answered) is after [now], or null. */
function nextRing(meds, log, now) {
  const at = doses(meds, log, now - MISSED_MS, now + 8 * DAY_MS, now).filter(d => d.state === 'waiting').flatMap(d => AGAIN_MS.map(a => d.due + a)).filter(t => t > now)
  return at.length ? Math.min(...at) : null
}

/** A name said or typed ("depon", "Depon 500"): the medicines it means, one if it can (Pills.find). */
function find(meds, name, strength = '') {
  const norm = s => String(s).toLowerCase().normalize('NFD').replace(/\p{Mn}+/gu, '').replace(/[^\p{L}\p{N}.]+/gu, ' ').trim()
  const digits = s => new Set([...String(s).matchAll(/\d+(?:[.,]\d+)?/g)].map(m => m[0].replace(',', '.')))
  const n = norm(name)
  if (!n) return []
  const live = meds.filter(m => !m.archived && !m.deleted)
  let byName = live.filter(m => norm(m.name) === n)
  if (!byName.length) byName = live.filter(m => norm(m.name) && (n.includes(norm(m.name)) || norm(m.name).includes(n)))
  // the strength only tells two of one name apart
  if (byName.length < 2) return byName
  const want = digits(strength).size ? digits(strength) : digits(name)
  const fit = byName.filter(m => [...digits(m.strength)].some(d => want.has(d)))
  return fit.length ? fit : byName
}

/** This computer's side of the Pills folder: reads every device's files, writes only its own. */
class Pills {
  constructor(root, by = 'Computer') { this.root = root; this.by = by; this.tag = tagOf(by) || 'Computer' }

  names() { try { return fs.readdirSync(this.root).filter(n => !n.startsWith('.')) } catch { return [] } }
  text(n) { try { return fs.readFileSync(path.join(this.root, n), 'utf8') } catch { return null } }

  /** Every medicine's winning file, the deleted ones too. */
  all() { return winners(this.names().filter(n => n.startsWith('pill-') && n.toLowerCase().endsWith('.json')).map(n => parse(this.text(n) ?? '', path.join(this.root, n))).filter(Boolean)) }
  /** The medicines not deleted: the ones taken first, by their first time, then by name. */
  medicines() {
    const first = m => m.times[0] ?? '99:99'
    return this.all().filter(m => !m.deleted).sort((a, b) => a.archived - b.archived || first(a).localeCompare(first(b)) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  }
  log() { return mergeLogs(this.names().filter(n => /^log.*\.jsonl$/i.test(n)).map(n => this.text(n) ?? '')) }
  read() { return { meds: this.medicines(), log: this.log() } }
  photo(id) { return path.join(this.root, `${id}.jpg`) }

  /** Written beside, then renamed over: nobody reads half a file. */
  writeAtomic(name, data) {
    fs.mkdirSync(this.root, { recursive: true })
    const to = path.join(this.root, name), part = path.join(this.root, `.${name}.part`)
    fs.writeFileSync(part, data)
    fs.renameSync(part, to)
    return to
  }

  /** [m] in this computer's own file, one rev above the winner's. */
  save(m) {
    const won = this.all().find(x => x.id === m.id)
    const next = { ...m, rev: (won?.rev ?? 0) + 1, by: this.by, deleted: !!m.deleted }
    next.file = this.writeAtomic(`${m.id}.${this.tag}.json`, json(next))
    return next
  }
  /** Deleted on every device: a file that says so (files are never removed). */
  remove(id) { const m = this.all().find(x => x.id === id); return m ? this.save({ ...m, deleted: true }) : null }

  append(e, log = this.log()) {
    const ev = { stock: 0, note: '', due: null, amount: 0, ...e }
    if (ev.kind !== STOCK || ev.note !== 'count') ev.stock = stockOf(ev.med, [...log, ev]).stock // informational: what is left after it
    fs.mkdirSync(this.root, { recursive: true })
    fs.appendFileSync(path.join(this.root, `log.${this.tag}.jsonl`), eventJson(ev) + '\n')
    return ev
  }

  /** Taken (the dose's time [due], or null: an extra one now): once, however often it is pressed, on however many devices. */
  take(id, due, at = Date.now()) {
    const { meds, log } = this.read(), m = meds.find(x => x.id === id)
    if (!m) return null
    if (due == null || answers(log).get(`${id}|${due}`)?.kind !== TAKEN) this.append({ at, med: id, kind: TAKEN, due, amount: m.dose }, log)
    return derive(m, this.log(), at)
  }
  skip(id, due, at = Date.now()) {
    const { meds, log } = this.read(), m = meds.find(x => x.id === id)
    if (!m) return null
    if (answers(log).get(`${id}|${due}`)?.kind !== SKIPPED) this.append({ at, med: id, kind: SKIPPED, due }, log)
    return derive(m, this.log(), at)
  }
  /** Back to waiting; a taken dose's pills are back in the stock by themselves. */
  undo(id, due, at = Date.now()) {
    const { meds, log } = this.read(), m = meds.find(x => x.id === id)
    if (!m) return null
    const was = answers(log).get(`${id}|${due}`)
    if (was && was.kind !== UNDO) this.append({ at, med: id, kind: UNDO, due, amount: was.kind === TAKEN ? was.amount : 0 }, log)
    return derive(m, this.log(), at)
  }

  /** [boxes] boxes and/or [pills] pills added (a box's size learnt when given); the refill reminders start over. */
  addStock(id, boxes, pills, perBox = null, at = Date.now(), note = '') {
    let m = this.all().find(x => x.id === id && !x.deleted)
    if (!m) return null
    const size = perBox > 0 ? Math.trunc(perBox) : m.perBox
    const added = halves(Math.max(0, Math.trunc(+boxes || 0)) * size + Math.max(0, +pills || 0))
    if (size !== m.perBox || (added > 0 && (m.refillAsked || m.refillOn))) m = this.save({ ...m, perBox: size, refillAsked: added > 0 ? 0 : m.refillAsked, refillOn: added > 0 ? null : m.refillOn })
    if (added > 0) this.append({ at, med: id, kind: STOCK, amount: added, note })
    return derive(m, this.log(), at)
  }
  /** The count corrected to what is really in hand. */
  setStock(id, value, at = Date.now()) {
    let m = this.all().find(x => x.id === id && !x.deleted)
    if (!m) return null
    const log = this.log(), now = stockOf(id, log), v = halves(Math.max(0, +value || 0))
    if (v === now.stock && now.counted) return derive(m, log, at)
    if (v > now.stock && m.refillAsked) m = this.save({ ...m, refillAsked: 0 })
    this.append({ at, med: id, kind: STOCK, amount: v - now.stock, stock: v, note: 'count' }, log)
    return derive(m, this.log(), at)
  }

  /**
   * The refill lines a reminder says now (PillsAlarms.lines): each of [ids] that is low and has not been told refillTimes
   * times; the telling counted once a day in its file.
   */
  refillDue(ids, now = Date.now()) {
    const today = localDate(now), log = this.log(), out = []
    for (const m0 of this.all().filter(m => ids.includes(m.id) && !m.deleted)) {
      const m = derive(m0, log, now)
      if (!m.low || (m.refillAsked >= m.refillTimes && m.refillOn !== today)) continue
      if (m.refillOn !== today) this.save({ ...m0, refillAsked: m0.refillAsked + 1, refillOn: today })
      out.push(m)
    }
    return out
  }

  /** A medicine's history, newest first: its events, and the doses of the last 30 days that were missed (event null). */
  history(id, now = Date.now()) {
    const { meds, log } = this.read(), m = meds.find(x => x.id === id)
    if (!m) return []
    const missed = doses([m], log, now - 30 * DAY_MS, now, now).filter(d => d.state === 'missed').map(d => ({ when: d.due, e: null }))
    return [...log.filter(e => e.med === id).map(e => ({ when: e.due ?? e.at, e })), ...missed].sort((a, b) => b.when - a.when).slice(0, 80)
  }
}

module.exports = { Pills, parse, winners, mergeLogs, answers, stockOf, perDay, derive, takenOn, doses, today, part, lateMin, slots, advice, rings, nextRing, find,
  json, eventJson, newId, title, amount, halves, localDate, clock, midnight, AGAIN_MS, MISSED_MS, COLORS, SHAPES, FOODS, WHITE, DAY_CODES }
