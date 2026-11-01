import { useEffect, useState } from 'react'
import type { UsageSummary } from './drive'
import { money } from './assist'
import { Icon } from './Icon'
import { locale, t } from './i18n'
import { errorText } from './Dialogs'

/*
 * Settings › AI Assist › Usage and cost (usage.js has the why): today, the month and all time; a bar a day for the last 30;
 * what it went on, by feature, model and device; the files read and the MP3s made; the prices used; the monthly budget.
 * One hue (AI Assist's orange, darkened to pass the dataviz checks in light and dark), the numbers in text colours.
 */
const BAR = '#E05A00'

export function UsageCard() {
  const [u, setU] = useState<UsageSummary | null>(null)
  const [budget, setBudget] = useState('')
  const [said, setSaid] = useState('')
  const load = () => window.drive.usage.summary().then(x => { setU(x); setBudget(x.budget.monthly != null ? String(x.budget.monthly) : '') })
  useEffect(() => { load() }, [])
  if (!u) return null
  const day = (ms: number) => new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(ms)
  const saveBudget = () => window.drive.usage.setBudget(Number(budget.replace(',', '.')) || 0).then(load, e => setSaid(errorText(e)))
  const b = u.budget.monthly
  const before = Math.max(0, u.meter - u.all) // spent before this record began (the meter's odometer is older)
  const feature = (f: string) => { const k = `usage.f.${f}`, w = t(k); return w === k ? f : w }
  return <section className="settings-card island usage">
    <h3><Icon name="dataUsage" size={20} />{t('usage.title')}</h3>
    <div className="usage-tiles">
      <div><small>{t('usage.today')}</small><strong>{money(u.today)}</strong></div>
      <div><small>{t('usage.month')}</small><strong>{money(u.month)}</strong></div>
      <div><small>{t('usage.all', { date: day(u.since) })}</small><strong>{money(u.all)}</strong></div>
    </div>
    {before > 0.00005 && <p className="muted">{t('usage.before', { usd: money(before) })}</p>}
    <Days days={u.days} />
    {b != null && <div className="usage-budget">
      <small>{t('usage.budgetUsed', { spent: money(u.month), budget: money(b) })}</small>
      <div className="usage-track"><span style={{ width: `${Math.min(100, (u.month / b) * 100)}%` }} className={u.month >= b ? 'over' : u.month >= 0.8 * b ? 'near' : ''} /></div>
    </div>}
    <div className="reset-actions">
      <label className="usage-budget-field">{t('usage.budget')}
        <input className="field" inputMode="decimal" placeholder={t('usage.budgetNone')} value={budget} onChange={e => setBudget(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveBudget()} /></label>
      <button className="filled-button" onClick={saveBudget}>{t('common.save')}</button>
    </div>
    <p className="muted">{t('usage.budgetNote')}</p>
    {said && <p className="muted">{said}</p>}
    {!u.byFeature.length ? <p className="muted">{t('usage.empty')}</p> : <>
      <Breakdown title={t('usage.byFeature')} rows={u.byFeature.map(r => ({ ...r, label: feature(r.key) }))} />
      <Breakdown title={t('usage.byModel')} rows={u.byModel.map(r => ({ ...r, label: r.key }))} />
      {u.byDevice.length > 1 && <Breakdown title={t('usage.byDevice')} rows={u.byDevice.map(r => ({ ...r, label: r.key }))} />}
      {!!u.files.length && <Breakdown title={t('usage.files')} rows={u.files.map(r => ({ ...r, label: r.key }))} />}
    </>}
    {!!u.mp3s.length && <><h4>{t('usage.mp3s')}</h4>
      <div className="clean-list">{u.mp3s.map((m, i) => <div key={i} className="clean-row">
        <span><strong>{m.title}</strong><br /><small className="muted">{day(m.at)} · {Math.floor(m.seconds / 60)}:{String(Math.round(m.seconds % 60)).padStart(2, '0')}</small></span>
        <span className="clean-size">{money(m.usd)}</span><span /></div>)}</div></>}
    <details className="usage-prices"><summary>{t('usage.prices', { date: day(new Date(u.prices.checked).getTime()) })}</summary>
      <table><tbody>{u.prices.list.map(p => <tr key={p.model}><td>{p.model}</td><td>{p.price}</td><td className="muted">{t(`usage.per.${p.per}`)}</td></tr>)}</tbody></table>
    </details>
    <p className="muted">{t('usage.note')}</p>
  </section>
}

/** A bar a day, the last 30: thin bars from the baseline, the day and its cost on hover, the highest labelled. */
function Days({ days }: { days: UsageSummary['days'] }) {
  const max = Math.max(...days.map(d => d.usd))
  if (!(max > 0)) return null
  const W = 600, H = 120, gap = 2, w = W / days.length - gap
  const top = days.reduce((a, d) => d.usd > a.usd ? d : a)
  const short = (d: string) => new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' }).format(new Date(`${d}T12:00`))
  return <figure className="usage-days">
    <figcaption>{t('usage.days')}</figcaption>
    <svg viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={t('usage.days')}>
      <line x1={0} x2={W} y1={H} y2={H} className="usage-axis" />
      {days.map((d, i) => {
        const h = d.usd > 0 ? Math.max(4, (d.usd / max) * (H - 16)) : 0, x = i * (w + gap)
        return <g key={d.day}>
          <rect x={x} y={0} width={w + gap} height={H} fill="transparent"><title>{`${short(d.day)}: ${money(d.usd)}`}</title></rect>
          {h > 0 && <path d={`M${x},${H} v${-(h - 4)} q0,-4 4,-4 h${w - 8} q4,0 4,4 v${h - 4} z`} fill={BAR} pointerEvents="none" />}
          {d === top && <text x={x + w / 2} y={H - h - 4} textAnchor="middle" className="usage-label">{money(d.usd)}</text>}
        </g>
      })}
      <text x={0} y={H + 14} className="usage-label">{short(days[0].day)}</text>
      <text x={W} y={H + 14} textAnchor="end" className="usage-label">{short(days.at(-1)!.day)}</text>
    </svg>
  </figure>
}

function Breakdown({ title, rows }: { title: string; rows: { label: string; usd: number; n: number }[] }) {
  const max = Math.max(...rows.map(r => r.usd), 1e-9)
  return <><h4>{title}</h4><div className="usage-rows">{rows.slice(0, 10).map(r => <div key={r.label} className="usage-row" title={t('usage.calls', { count: r.n })}>
    <span>{r.label}</span><span className="usage-bar"><span style={{ width: `${(r.usd / max) * 100}%`, background: BAR }} /></span><strong>{money(r.usd)}</strong>
  </div>)}</div></>
}
