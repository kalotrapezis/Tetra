'use strict'
/**
 * The daily brief (the user, 1 Nov 2026): one HTML page a day in ~/Tetra/.System/Assistant/Shared/Briefs/YYYY-MM-DD.html,
 * opened from its notification, on the computer and (synced as "AI Assist/Briefs") on the phone. Each section is one entry
 * of SECTIONS, switched on or off in Settings › AI Assist and skipped when the AI switch keeps its app out (ai.js); a new
 * section (events found in mail, next) is one more entry. A section that fails says so in its place; the others still come.
 */
const { t, locale } = require('./i18n')
const { MAIL_REPORT } = require('./assistant')

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const paragraphs = text => String(text).trim().split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')
const pad = n => String(n).padStart(2, '0')
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const midnight = (ms, plus = 0) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + plus).getTime() }
const clock = ms => new Intl.DateTimeFormat(locale('en-GB'), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms)

/** WMO weather codes (Open-Meteo's) → a word key and a sign. */
const WEATHER = [[[0], 'clear', '☀️'], [[1, 2], 'partly', '⛅'], [[3], 'cloudy', '☁️'], [[45, 48], 'fog', '🌫️'], [[51, 53, 55, 56, 57], 'drizzle', '🌦️'],
  [[61, 63, 65, 66, 67], 'rain', '🌧️'], [[71, 73, 75, 77, 85, 86], 'snow', '🌨️'], [[80, 81, 82], 'showers', '🌦️'], [[95, 96, 99], 'storm', '⛈️']]
const weatherOf = code => { const w = WEATHER.find(([codes]) => codes.includes(code)) ?? WEATHER[2]; return { word: t(`brief.w.${w[1]}`), sign: w[2] } }

const SECTIONS = [
  { id: 'calendar', app: 'calendar', title: () => t('app.calendar'), make(ctx) {
    const day = plus => ctx.calendar.occurrences(midnight(ctx.now, plus), midnight(ctx.now, plus + 1))
    const list = os => os.length ? `<ul>${os.map(o => `<li><span class="when">${o.allDay ? '—' : esc(clock(o.start))}</span> ${esc(o.title || t('common.noTitle'))}${o.place ? ` <span class="muted">· ${esc(o.place)}</span>` : ''}</li>`).join('')}</ul>`
      : `<p class="muted">${esc(t('brief.nothing'))}</p>`
    const today = day(0)
    return { html: `<h3>${esc(t('common.today'))}</h3>${list(today)}<h3>${esc(t('common.tomorrow'))}</h3>${list(day(1))}`, line: t('brief.todayCount', { n: today.length }) }
  } },
  { id: 'mail', app: 'mail', title: () => t('app.mail'), async make(ctx) { return { html: paragraphs(await ctx.ask(MAIL_REPORT)) } } },
  { id: 'weather', app: 'web', title: () => t('brief.weather'), async make(ctx) {
    const p = ctx.place
    if (!p) return { html: `<p class="muted">${esc(t('brief.placeMissing'))}</p>` }
    const r = await ctx.fetch(`https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=2`)
    if (!r.ok) throw new Error(`Open-Meteo ${r.status}`)
    const w = await r.json(), now = weatherOf(w.current.weather_code), d = w.daily
    const day = (i, name) => { const x = weatherOf(d.weather_code[i]); return `<li><span class="when">${esc(name)}</span> ${x.sign} ${esc(x.word)}, ${Math.round(d.temperature_2m_min[i])}°–${Math.round(d.temperature_2m_max[i])}°${d.precipitation_probability_max[i] ? ` <span class="muted">· ${esc(t('brief.rain', { p: d.precipitation_probability_max[i] }))}</span>` : ''}</li>` }
    return { html: `<p class="big">${now.sign} ${Math.round(w.current.temperature_2m)}° <span class="muted">${esc(now.word)} · ${esc(p.name)}</span></p><ul>${day(0, t('common.today'))}${day(1, t('common.tomorrow'))}</ul>`,
      line: `${Math.round(w.current.temperature_2m)}° ${now.word}` }
  } },
  { id: 'notes', app: 'notes', title: () => t('brief.lists'), make(ctx) {
    const lists = ctx.notes.list().filter(n => !n.trashedAt && n.noteType === 'CHECKLIST').map(n => ({ n, open: (n.checklistItems ?? []).filter(i => !i.isChecked && String(i.text).trim()) }))
      .filter(x => x.open.length).sort((a, b) => b.n.updatedAt - a.n.updatedAt).slice(0, 8)
    if (!lists.length) return { html: `<p class="muted">${esc(t('brief.noLists'))}</p>` }
    return { html: lists.map(({ n, open }) => `<h3>${esc(n.title || t('common.noTitle'))}</h3><ul class="checks">${open.slice(0, 12).map(i => `<li>${esc(i.text)}</li>`).join('')}${open.length > 12 ? `<li class="muted">+${open.length - 12}</li>` : ''}</ul>`).join('') }
  } },
]

/** The sections that run: switched on (on unless switched off) and with their app allowed by the AI switch. */
const enabled = (switches = {}, allowed = () => true) => SECTIONS.filter(s => switches[s.id] !== false && allowed(s.app))

/** A page in Tetra's look, light or dark as the system is. */
function page(title, when, parts) {
  return `<!doctype html><html lang="${esc(locale('en'))}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark">
<title>${esc(title)}</title><style>
:root { --bg: #f6f4f1; --card: #fff; --ink: #1d1f21; --muted: #6b7075; --line: #e6e2dd; --accent: #4C8DF6; }
@media (prefers-color-scheme: dark) { :root { --bg: #151719; --card: #1f2225; --ink: #eceeef; --muted: #9aa0a6; --line: #2e3236; --accent: #7aa9f8; } }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.5 system-ui, "Noto Sans", sans-serif; }
main { max-width: 720px; margin: 0 auto; padding: 24px 16px 48px; }
header h1 { margin: 0; font-size: 26px; } header p { margin: 2px 0 20px; color: var(--muted); }
section { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 14px 18px; margin: 0 0 14px; }
h2 { margin: 0 0 6px; font-size: 18px; color: var(--accent); } h3 { margin: 12px 0 4px; font-size: 15px; }
ul { margin: 0; padding: 0 0 0 4px; list-style: none; } li { padding: 3px 0; } ul.checks li::before { content: "☐ "; color: var(--muted); }
.when { display: inline-block; min-width: 4.2em; font-variant-numeric: tabular-nums; font-weight: 600; }
.muted { color: var(--muted); } .big { font-size: 22px; margin: 0 0 6px; } .failed { color: #c62f2f; } p { margin: 6px 0; }
</style></head><body><main><header><h1>${esc(title)}</h1><p>${esc(when)}</p></header>
${parts.map(x => `<section><h2>${esc(x.title)}</h2>${x.html}</section>`).join('\n')}
</main></body></html>`
}

const heading = now => new Intl.DateTimeFormat(locale('en-GB'), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now)

/**
 * The brief for [ctx.now]: { html, line } (line: a few words for the notification). [ctx]: now, calendar, notes, ask(prompt)
 * (the chat, for mail), fetch, place, switches, allowed(app).
 */
async function make(ctx, title = t('brief.title')) {
  const parts = []
  for (const s of enabled(ctx.switches, ctx.allowed)) {
    try { parts.push({ title: s.title(), ...await s.make(ctx) }) } catch (e) { parts.push({ title: s.title(), html: `<p class="failed">${esc(t('brief.failed', { error: e.message }))}</p>` }) }
  }
  return { html: page(title, heading(ctx.now), parts), line: parts.map(p => p.line).filter(Boolean).join(' · ') }
}

/** A scheduled prompt's answer as a page of its own. */
const answer = (title, now, text) => page(title, `${heading(now)} ${clock(now)}`, [{ title: t('app.assistant'), html: paragraphs(text) }])

module.exports = { SECTIONS, enabled, make, answer, page, dayKey }
