/*
 * What AI Assist spends, call by call (the user, 1 Nov 2026: "a token dashboard… statistics and billing in the settings"; "and
 * kept, we change it fast: updates must not reset it"). Each paid call is one JSON line in .System/Assistant/Shared/usage, a
 * file a device a month ("<device>-2026-11.jsonl"): synced, so the phone's count too and a reinstall gets them back, and no
 * two devices ever write one file. Lines carry "v"; a newer Tetra reads older lines, and a migration only adds fields.
 * The costs are estimates: token counts and characters times Mistral's published prices, not Mistral's invoice.
 *
 * A line: { v, t (ms), f (feature: chat, live, brief, schedule, dictation, voice, ocr, script, verify, tts, web, image, mp3),
 *   m (model or tool), i / o (tokens in / out), c (characters read aloud), s (seconds of audio), p (pages), usd (€ in practice),
 *   file, job; an "mp3" line has title, s and cost (the job's whole cost, already counted in its other lines: usd 0) }.
 */
const fs = require('node:fs')
const path = require('node:path')

const V = 1
const DAY = 86_400_000
const pad = n => String(n).padStart(2, '0')
const dayKey = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const monthKey = ms => dayKey(ms).slice(0, 7)

/** A line as this version knows it, from any older one: fields it lacks are 0 or empty, nothing is dropped. */
function upgrade(x) {
  if (!x || typeof x !== 'object') return null
  const n = k => Number.isFinite(+x[k]) ? +x[k] : 0
  // v0 (never written, kept as the pattern): { at, feature, model, usd }
  return { ...x, v: x.v ?? 0, t: n('t') || n('at'), f: String(x.f ?? x.feature ?? 'chat'), m: String(x.m ?? x.model ?? ''), i: n('i'), o: n('o'), c: n('c'), s: n('s'), p: n('p'), usd: n('usd'), cost: n('cost') }
}

class Usage {
  /** [device]: this device's name, in its files' names; [now] the tests'. */
  constructor(dir, device, { now = () => Date.now() } = {}) {
    Object.assign(this, { dir, device: String(device).replace(/[^\p{L}\p{N}_.-]+/gu, '-') || 'computer', now })
  }

  add(entry) {
    const t = this.now(), line = { v: V, t, ...Object.fromEntries(Object.entries(entry).filter(([, x]) => x !== undefined && x !== null && x !== '' && x !== 0)) }
    if (line.usd == null) line.usd = 0
    try {
      fs.mkdirSync(this.dir, { recursive: true })
      fs.appendFileSync(path.join(this.dir, `${this.device}-${monthKey(t)}.jsonl`), JSON.stringify(line) + '\n')
    } catch (e) { console.warn('[usage] not written', e.message) }
  }

  /** Every device's lines, [months] ("2026-11") only when given; a broken line (cut by sync mid-write) skipped. */
  lines(months = null) {
    let names = []
    try { names = fs.readdirSync(this.dir).filter(n => /-\d{4}-\d{2}\.jsonl$/.test(n)) } catch {}
    if (months) names = names.filter(n => months.some(m => n.endsWith(`-${m}.jsonl`)))
    const out = []
    for (const n of names) {
      let text = ''
      try { text = fs.readFileSync(path.join(this.dir, n), 'utf8') } catch { continue }
      const device = n.replace(/-\d{4}-\d{2}\.jsonl$/, '')
      for (const l of text.split('\n')) { if (!l.trim()) continue; try { const x = upgrade(JSON.parse(l)); if (x) out.push({ ...x, device }) } catch {} }
    }
    return out
  }

  month(at = this.now()) { return this.lines([monthKey(at)]).reduce((s, x) => s + x.usd, 0) }

  // ---- The monthly budget: budget.json beside the lines, the same on every device ----
  budget() { try { return { monthly: null, warned: '', ...JSON.parse(fs.readFileSync(path.join(this.dir, 'budget.json'), 'utf8')) } } catch { return { monthly: null, warned: '' } } }
  setBudget(monthly) {
    const b = { ...this.budget(), v: V, monthly: Number(monthly) > 0 ? Math.round(Number(monthly) * 100) / 100 : null }
    fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(path.join(this.dir, 'budget.json'), JSON.stringify(b))
    return b
  }
  /** Over the month's budget: what costs by itself (scheduled actions, MP3s) does not start. */
  capped() { const b = this.budget(); return b.monthly != null && this.month() >= b.monthly }
  /** True once a month, when the month's spending first passes 80 % of the budget. */
  warnNow() {
    const b = this.budget(), m = monthKey(this.now())
    if (b.monthly == null || b.warned === m || this.month() < 0.8 * b.monthly) return false
    fs.writeFileSync(path.join(this.dir, 'budget.json'), JSON.stringify({ ...b, v: V, warned: m }))
    return true
  }

  /** The dashboard: today, this month, all time; the last 30 days; by feature and model; the files and MP3s. */
  summary() {
    const now = this.now(), all = this.lines(), today = dayKey(now), month = monthKey(now)
    const sum = xs => xs.reduce((s, x) => s + x.usd, 0)
    const group = (key, xs) => [...xs.reduce((g, x) => { const k = key(x); if (!k) return g; const o = g.get(k) ?? { key: k, usd: 0, n: 0 }; o.usd += x.usd; o.n++; return g.set(k, o) }, new Map()).values()]
      .sort((a, b) => b.usd - a.usd)
    const days = Array.from({ length: 30 }, (_, k) => dayKey(now - (29 - k) * DAY)).map(d => ({ day: d, usd: 0 }))
    const byDay = new Map(days.map(d => [d.day, d]))
    for (const x of all) { const d = byDay.get(dayKey(x.t)); if (d) d.usd += x.usd }
    const files = group(x => x.file, all.filter(x => x.f !== 'mp3')).slice(0, 10)
    const mp3s = all.filter(x => x.f === 'mp3').sort((a, b) => b.t - a.t).slice(0, 20).map(x => ({ title: x.title || x.file || '', seconds: x.s, usd: x.cost, at: x.t, device: x.device }))
    return { today: sum(all.filter(x => dayKey(x.t) === today)), month: sum(all.filter(x => monthKey(x.t) === month)), all: sum(all), since: all.reduce((m, x) => Math.min(m, x.t), now),
      days, byFeature: group(x => x.f, all.filter(x => x.f !== 'mp3')), byModel: group(x => x.m, all.filter(x => x.f !== 'mp3')), byDevice: group(x => x.device, all),
      files, mp3s, budget: this.budget() }
  }
}

module.exports = { Usage, upgrade, dayKey, monthKey, V }
