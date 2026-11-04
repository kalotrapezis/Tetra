import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Address, Card, Login, OtpCode, PasswordsList, PasswordsStatus } from './drive'
import { Confirm, errorText, Modal } from './Dialogs'
import { Icon, type IconName } from './Icon'
import { t } from './i18n'

// Passwords and 2FA (the user, 4 Nov 2026: "sync across devices phone tablet and PC"): the phone's Passwords applet
// (Tetra-mobile PasswordsScreen.kt) on this computer, its vault read and written by main (passwords.js). Laid out as the
// Clock: the list in the middle, the tabs in the island at the bottom, the round actions beside it; purple, the applet's colour.

type Tab = 'logins' | 'cards' | 'addresses' | '2fa' | 'create'
const TABS: [Tab, IconName, string][] = [['logins', 'key', 'app.passwords'], ['cards', 'storage', 'passwords.cards'], ['addresses', 'place', 'passwords.addresses'], ['2fa', 'dialpad', 'passwords.tab2fa'], ['create', 'sparkle', 'passwords.tabCreate']]
const ADDRESS_FIELDS: [string, string][] = [['name', 'common.name'], ['email', 'passwords.email'], ['tel', 'passwords.phone'], ['organization', 'passwords.organization'], ['street-address', 'passwords.street'],
  ['postal-code', 'passwords.postcode'], ['address-level2', 'passwords.city'], ['address-level1', 'passwords.region'], ['country-name', 'passwords.country']]
const fieldName = (k: string) => t(ADDRESS_FIELDS.find(([f]) => f === k)?.[1] ?? '') || k
/** As the phone names an address: its name, else given and family names, else the email or street. */
const addressLabel = (a: Address['fields']) => a.name || [a['given-name'], a['family-name']].filter(Boolean).join(' ') || a.email || a['street-address'] || Object.values(a)[0] || ''
const has = (q: string, ...s: (string | undefined)[]) => !q || s.some(x => x?.toLowerCase().includes(q))
const byPin = <T extends { pinned?: boolean }>(name: (x: T) => string) => (a: T, b: T) => Number(!!b.pinned) - Number(!!a.pinned) || name(a).localeCompare(name(b))
/** "123 456" / "1234 5678": read in halves, as every authenticator shows them. */
const grouped = (c: string) => c.length < 6 ? c : c.slice(0, c.length >> 1) + ' ' + c.slice(c.length >> 1)

export function PasswordsPage({ setDialog, say }: { setDialog: (d: ReactNode) => void; say: (text: string) => void }) {
  const [status, setStatus] = useState<PasswordsStatus | null>(null)
  const [list, setList] = useState<PasswordsList | null>(null)
  const [tab, setTab] = useState<Tab>(() => { try { return (localStorage.getItem('passwordsTab') as Tab) || 'logins' } catch { return 'logins' } })
  const [query, setQuery] = useState('')
  const [edit, setEdit] = useState<{ kind: Tab; item: Login | Card | Address | OtpCode | null } | null>(null)
  const close = () => setDialog(null)
  const read = async () => {
    const s = await window.drive.passwords.status()
    setStatus(s)
    if (s.open) window.drive.passwords.list().then(setList, e => say(errorText(e)))
    else setList(null)
  }
  useEffect(() => { read(); const a = window.drive.passwords.onLocked(read), b = window.drive.passwords.onChanged(read); return () => { a(); b() } }, [])
  const choose = (x: Tab) => { setTab(x); setQuery(''); try { localStorage.setItem('passwordsTab', x) } catch {} }
  const change = (kind: 'passwords' | '2fa', old: string | null, item: Parameters<typeof window.drive.passwords.change>[2]) =>
    window.drive.passwords.change(kind, old, item).then(setList, e => { say(errorText(e)); read() })
  const copy = (text: string, said: string) => window.drive.passwords.copy(text).then(() => say(said))
  const remove = (kind: 'passwords' | '2fa', key: string, name: string) => setDialog(<Confirm title={t('passwords.deleteTitle', { name })}
    body={t(kind === '2fa' ? 'passwords.deleteCodeNote' : 'passwords.deleteNote')} action={t('common.delete')} danger onClose={close} onConfirm={() => change(kind, key, null)} />)

  if (!status) return null
  if (!status.open) return <div className="pw"><Gate status={status} done={read} /></div>
  const q = query.trim().toLowerCase()
  return (
    <div className="timer pw">
      <header className="topbar">
        {tab === 'create' ? <div className="island title-island"><Icon name="sparkle" /><h1>{t('passwords.tabCreate')}</h1></div>
          : <div className="island title-island ct-search">
            <Icon name="search" />
            <input placeholder={t(tab === '2fa' ? 'passwords.searchCodes' : 'passwords.search')} value={query} onChange={e => setQuery(e.target.value)} />
            {query && <button className="round flat" title={t('common.clear')} onClick={() => setQuery('')}><Icon name="close" /></button>}
          </div>}
        <div className="tools">
          <details className="menu">
            <summary className="round" title={t('files.more')}><Icon name="more" /></summary>
            <div className="island menu-body">
              <button className="sheet-row" onClick={() => setDialog(<Confirm title={t('passwords.forget')} body={t('passwords.forgetText')} action={t('passwords.forgetShort')} onClose={close}
                onConfirm={() => window.drive.passwords.forget().then(read)} />)}>{t('passwords.forget')}</button>
            </div>
          </details>
          <button className="round" title={t('hidden.lock')} onClick={() => window.drive.passwords.lock().then(read)}><Icon name="lock" /></button>
        </div>
      </header>
      <div className="timer-body">
        <section className="pw-list">
          {list && list.unreadable > 0 && <p className="muted">{t('passwords.otherPassphrase')}</p>}
          {list && tab === 'logins' && <Rows empty={list.logins.length ? t('passwords.noneFound') : t('passwords.empty')}>
            {list.logins.filter(l => has(q, l.host, l.user, l.note)).sort(byPin(l => l.host)).map(l =>
              <LoginRow key={l.key} l={l} copy={copy} pin={() => change('passwords', l.key!, { ...l, pinned: !l.pinned })} edit={() => setEdit({ kind: 'logins', item: l })} remove={() => remove('passwords', l.key!, l.host)} />)}
          </Rows>}
          {list && tab === 'cards' && <Rows empty={list.cards.length ? t('passwords.noneFound') : t('passwords.addCard')}>
            {list.cards.filter(c => has(q, c.name, c.number.slice(-4))).map(c =>
              <div key={c.key} className="island pw-row">
                <div className="pw-what"><b>{c.name || t('passwords.cardNumber')}</b><span className="muted">•••• {c.number.slice(-4)} · {c.month}/{c.year}</span></div>
                <button className="round flat" title={t('passwords.copyNumber')} onClick={() => copy(c.number, t('passwords.numberCopied'))}><Icon name="copy" /></button>
                <button className="round flat" title={t('common.edit')} onClick={() => setEdit({ kind: 'cards', item: c })}><Icon name="edit" /></button>
                <button className="round flat" title={t('common.delete')} onClick={() => remove('passwords', c.key!, `•••• ${c.number.slice(-4)}`)}><Icon name="trash" /></button>
              </div>)}
          </Rows>}
          {list && tab === 'addresses' && <Rows empty={list.addresses.length ? t('passwords.noneFound') : t('passwords.addAddress')}>
            {list.addresses.filter(a => has(q, ...Object.values(a.fields))).map(a =>
              <div key={a.key} className="island pw-row">
                <div className="pw-what"><b>{addressLabel(a.fields)}</b><span className="muted">{Object.entries(a.fields).filter(([k]) => k !== 'name').map(([, v]) => v).join(' · ')}</span></div>
                <button className="round flat" title={t('common.edit')} onClick={() => setEdit({ kind: 'addresses', item: a })}><Icon name="edit" /></button>
                <button className="round flat" title={t('common.delete')} onClick={() => remove('passwords', a.key, addressLabel(a.fields))}><Icon name="trash" /></button>
              </div>)}
          </Rows>}
          {list && tab === '2fa' && <Codes codes={list.codes.filter(c => has(q, c.issuer, c.account)).sort(byPin(c => c.issuer || c.account))} empty={list.codes.length ? t('passwords.noneFound') : t('passwords.codesEmpty')}
            copy={copy} pin={c => change('2fa', c.key!, { ...c, pinned: !c.pinned })} edit={c => setEdit({ kind: '2fa', item: c })} remove={c => remove('2fa', c.key!, c.issuer || c.account)} />}
          {tab === 'create' && <Generator copy={copy} />}
        </section>
      </div>
      <div className="ct-dock timer-dock">
        <nav className="notes-island island">
          {TABS.map(([x, icon, l]) => <button key={x} className={`island-item ${tab === x ? 'on' : ''}`} onClick={() => choose(x)}><Icon name={icon} size={20} /><span>{t(l)}</span></button>)}
        </nav>
        {tab !== 'create' && <button className="round island timer-action" title={t({ logins: 'passwords.addLogin', cards: 'passwords.addCard', addresses: 'passwords.addAddress', '2fa': 'passwords.addCode' }[tab])}
          onClick={() => setEdit({ kind: tab, item: null })}><Icon name="add" /></button>}
      </div>
      {edit && <Editor kind={edit.kind} item={edit.item} close={() => setEdit(null)} save={(item, old) => change(edit.kind === '2fa' ? '2fa' : 'passwords', old, item).then(() => setEdit(null))} />}
    </div>
  )
}

const Rows = ({ empty, children }: { empty: string; children: ReactNode[] }) => children.length ? <>{children}</> : <p className="muted pw-empty">{empty}</p>

function LoginRow({ l, copy, pin, edit, remove }: { l: Login; copy: (text: string, said: string) => void; pin: () => void; edit: () => void; remove: () => void }) {
  const [shown, setShown] = useState(false)
  return (
    <div className="island pw-row">
      <button className={`round flat pw-pin ${l.pinned ? 'on' : ''}`} title={t(l.pinned ? 'timer.unpin' : 'passwords.pin')} onClick={pin}><Icon name={l.pinned ? 'heartFill' : 'heart'} /></button>
      <div className="pw-what">
        <b>{l.host}</b>
        <span className="muted">{l.user}{l.note && ` · ${l.note}`}</span>
      </div>
      <code className="pw-secret">{shown ? l.password : '••••••••'}</code>
      <button className="round flat" title={t(shown ? 'passwords.hide' : 'mail.show')} onClick={() => setShown(!shown)}><Icon name={shown ? 'visibilityOff' : 'visibility'} /></button>
      <button className="round flat" title={t('passwords.copyUser')} onClick={() => copy(l.user, t('passwords.userCopied'))}><Icon name="person" /></button>
      <button className="round flat" title={t('passwords.copyPassword')} onClick={() => copy(l.password, t('passwords.passwordCopied'))}><Icon name="copy" /></button>
      <button className="round flat" title={t('common.edit')} onClick={edit}><Icon name="edit" /></button>
      <button className="round flat" title={t('common.delete')} onClick={remove}><Icon name="trash" /></button>
    </div>
  )
}

/** The codes of now, read each second from main (the secrets stay there); a click copies one. */
function Codes({ codes, empty, copy, pin, edit, remove }: { codes: OtpCode[]; empty: string; copy: (text: string, said: string) => void; pin: (c: OtpCode) => void; edit: (c: OtpCode) => void; remove: (c: OtpCode) => void }) {
  const [now, setNow] = useState<Record<string, { code: string; left: number }>>({})
  useEffect(() => {
    const read = () => window.drive.passwords.codes().then(l => setNow(Object.fromEntries(l.map(c => [c.key, c]))), () => {})
    read(); const i = setInterval(read, 1000); return () => clearInterval(i)
  }, [])
  if (!codes.length) return <p className="muted pw-empty">{empty}</p>
  return <>{codes.map(c => { const n = now[c.key!]; return (
    <div key={c.key} className="island pw-row">
      <button className={`round flat pw-pin ${c.pinned ? 'on' : ''}`} title={t(c.pinned ? 'timer.unpin' : 'passwords.pin')} onClick={() => pin(c)}><Icon name={c.pinned ? 'heartFill' : 'heart'} /></button>
      <div className="pw-what"><b>{c.issuer || c.account}</b>{c.issuer && <span className="muted">{c.account}</span>}</div>
      <button className="pw-code" title={t('common.copy')} onClick={() => n && copy(n.code, t('passwords.codeCopied'))}>{n ? grouped(n.code) : '··· ···'}</button>
      <span className="pw-left" style={{ ['--p' as string]: n ? n.left / c.period : 1 }}>{n?.left ?? ''}</span>
      <button className="round flat" title={t('common.edit')} onClick={() => edit(c)}><Icon name="edit" /></button>
      <button className="round flat" title={t('common.delete')} onClick={() => remove(c)}><Icon name="trash" /></button>
    </div>) })}</>
}

/** The passphrase asked once (made here when no device has one), or the page opened again after a lock. */
function Gate({ status, done }: { status: PasswordsStatus; done: () => void }) {
  const [pass, setPass] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [renew, setRenew] = useState(false) // "forgot it": a new passphrase replaces the one in force
  const making = status.need && (!status.recipe || renew)
  const [title, text] = !status.need ? ['passwords.locked', 'passwords.lockedText'] : making ? ['passwords.newTitle', renew ? 'passwords.forgotText' : 'passwords.newText'] : ['passwords.setupTitle', 'passwords.setupText']
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (making && pass !== again) return setError(t('hidden.mismatch'))
    setBusy(true)
    try { await (status.need ? window.drive.passwords.passphrase(pass, renew) : window.drive.passwords.open(pass)); done() } catch (err) { setError(errorText(err)) }
    setBusy(false)
  }
  return (
    <div className="island gate-page">
      <form onSubmit={submit} className="gate">
        <Icon name="lock" size={40} />
        <h3>{t(title)}</h3>
        <p>{t(text)}</p>
        <input className="field" type="password" autoFocus placeholder={t(status.need ? 'passwords.passphrase' : 'passwords.secret')} value={pass} onChange={e => { setPass(e.target.value); setError('') }} />
        {making && <input className="field" type="password" placeholder={t('hidden.repeat')} value={again} onChange={e => { setAgain(e.target.value); setError('') }} />}
        {error && <p className="error">{error}</p>}
        <div className="dialog-actions">
          {status.need && status.recipe && <button type="button" className="text-button" onClick={() => { setRenew(!renew); setError('') }}>{renew ? t('common.cancel') : t('passwords.forgot')}</button>}
          <button className="filled-button pw-filled" disabled={busy || !pass}>{busy ? t('hidden.working') : t('hidden.unlock')}</button>
        </div>
      </form>
    </div>
  )
}

/** A new or changed login, card, address or 2FA code, in a dialog. */
function Editor({ kind, item, close, save }: { kind: Tab; item: Login | Card | Address | OtpCode | null; close: () => void; save: (item: Login | Card | { fields: Record<string, string> } | OtpCode, old: string | null) => Promise<void> }) {
  const start: Record<string, string> = kind === 'addresses' ? { ...(item as Address | null)?.fields }
    : Object.fromEntries(Object.entries(item ?? {}).map(([k, v]) => [k, String(v)]))
  const [f, setF] = useState<Record<string, string>>(kind === '2fa' ? { algorithm: 'SHA1', digits: '6', period: '30', ...start } : start)
  const [error, setError] = useState('')
  const set = (k: string, v: string) => { setF(x => ({ ...x, [k]: v })); setError('') }
  const field = (k: string, label: string, type = 'text') => <label className="pw-field" key={k}><span>{label}</span>
    {k === 'street-address' || k === 'note' ? <textarea className="field" rows={2} value={f[k] ?? ''} onChange={e => set(k, e.target.value)} />
      : <input className="field" type={type} value={f[k] ?? ''} onChange={e => set(k, e.target.value)} />}</label>
  // a pasted otpauth:// link fills the rest
  const keyChanged = async (v: string) => {
    set('secret', v)
    if (!/^otpauth:/i.test(v.trim())) return
    const e = await window.drive.passwords.otpauth(v)
    if (e) setF(x => ({ ...x, ...Object.fromEntries(Object.entries(e).map(([k, w]) => [k, String(w)])), issuer: e.issuer || x.issuer || '', account: e.account || x.account || '' }))
    else setError(t('passwords.badKey'))
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const old = (item as { key?: string } | null)?.key ?? null
    if (kind === 'logins') { if (!f.host?.trim() || !f.password) return; return save({ host: f.host, user: f.user ?? '', password: f.password, note: f.note ?? '', pinned: f.pinned === 'true' }, old) }
    if (kind === 'cards') { if (!/^\d{12,19}$/.test((f.number ?? '').replace(/\s/g, ''))) return setError(t('passwords.cardNumber')); return save({ name: f.name ?? '', number: f.number, month: f.month ?? '', year: f.year ?? '' }, old) }
    if (kind === 'addresses') { if (!Object.values(f).some(v => v.trim())) return; return save({ fields: f }, old) }
    if (!/^[A-Z2-7]+$/.test((f.secret ?? '').toUpperCase().replace(/[ =-]/g, ''))) return setError(t('passwords.badKey'))
    return save({ issuer: f.issuer ?? '', account: f.account ?? '', secret: f.secret, algorithm: f.algorithm, digits: +f.digits, period: +f.period, pinned: f.pinned === 'true' }, old)
  }
  const title = item ? t('common.edit') : t({ logins: 'passwords.addLogin', cards: 'passwords.addCard', addresses: 'passwords.addAddress', '2fa': 'passwords.addCode', create: '' }[kind])
  return (
    <Modal onClose={close}>
      <form className="pw-form" onSubmit={e => submit(e).catch(err => setError(errorText(err)))}>
        <h3>{title}</h3>
        {kind === 'logins' && <>
          {field('host', t('passwords.site'))}
          {field('user', t('passwords.user'))}
          <div className="pw-with">{field('password', t('passwords.password'))}
            <button type="button" className="round flat" title={t('passwords.generate')} onClick={() => set('password', characters(DEFAULTS))}><Icon name="refresh" /></button></div>
          {field('note', t('passwords.note'))}
        </>}
        {kind === 'cards' && <>
          {field('name', t('passwords.cardName'))}
          {field('number', t('passwords.cardNumber'))}
          <div className="pw-two">{field('month', t('passwords.month'))}{field('year', t('passwords.year'))}</div>
          <p className="muted">{t('passwords.cardNoCvc')}</p>
        </>}
        {kind === 'addresses' && [...new Set([...ADDRESS_FIELDS.map(([k]) => k), ...Object.keys(f)])].map(k => field(k, fieldName(k)))}
        {kind === '2fa' && <>
          {field('issuer', t('passwords.issuer'))}
          {field('account', t('passwords.account'))}
          <label className="pw-field"><span>{t('passwords.key')}</span><input className="field" value={f.secret ?? ''} placeholder={t('passwords.keyHint')} onChange={e => keyChanged(e.target.value)} /></label>
          <details className="pw-advanced"><summary>{t('passwords.advanced')}</summary>
            <div className="pw-two">
              <select className="field" value={f.algorithm} onChange={e => set('algorithm', e.target.value)}>{['SHA1', 'SHA256', 'SHA512'].map(a => <option key={a}>{a}</option>)}</select>
              <select className="field" value={f.digits} onChange={e => set('digits', e.target.value)}>{[6, 7, 8].map(d => <option key={d} value={d}>{t('passwords.digits', { n: d })}</option>)}</select>
            </div>
            {field('period', t('passwords.period'), 'number')}
          </details>
        </>}
        {error && <p className="error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="text-button" onClick={close}>{t('common.cancel')}</button>
          <button className="filled-button pw-filled">{t('common.save')}</button>
        </div>
      </form>
    </Modal>
  )
}

// ---- the generator (Tetra-mobile Passwords.kt PasswordGen) ----

const SETS = { upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', lower: 'abcdefghijklmnopqrstuvwxyz', digits: '0123456789', symbols: '!@#$%^&*-_=+?.,:;~' }
const SIMILAR = 'Il1O0o|'
type Options = { length: number; upper: boolean; lower: boolean; digits: boolean; symbols: boolean; noSimilar: boolean }
const DEFAULTS: Options = { length: 20, upper: true, lower: true, digits: true, symbols: true, noSimilar: false }
/** A uniform pick below [n] (no modulo bias). */
function below(n: number) { const a = new Uint32Array(1), lim = Math.floor(2 ** 32 / n) * n; do crypto.getRandomValues(a); while (a[0] >= lim); return a[0] % n }
const sets = (o: Options) => { const s = (Object.keys(SETS) as (keyof typeof SETS)[]).filter(k => o[k]).map(k => o.noSimilar ? [...SETS[k]].filter(c => !SIMILAR.includes(c)).join('') : SETS[k]); return s.length ? s : [SETS.lower] }
/** [o.length] characters, at least one of each chosen set (sites ask that), shuffled. */
function characters(o: Options) {
  const s = sets(o), all = s.join('')
  const out = [...s.map(x => x[below(x.length)]), ...Array.from({ length: Math.max(0, o.length - s.length) }, () => all[below(all.length)])]
  for (let i = out.length - 1; i > 0; i--) { const j = below(i + 1); [out[i], out[j]] = [out[j], out[i]] }
  return out.slice(0, o.length).join('')
}

function Generator({ copy }: { copy: (text: string, said: string) => void }) {
  const [words, setWords] = useState<string[]>([])
  const [mode, setMode] = useState<'chars' | 'words'>('chars')
  const [o, setO] = useState(DEFAULTS)
  const [n, setN] = useState(5)
  const [turn, setTurn] = useState(0)
  useEffect(() => { window.drive.passwords.words().then(setWords, () => {}) }, [])
  const made = useMemo(() => mode === 'chars' ? characters(o) : words.length ? Array.from({ length: n }, () => words[below(words.length)]).join('-') : '', [mode, o, n, words, turn])
  const bits = Math.floor(mode === 'chars' ? o.length * Math.log2(sets(o).join('').length) : n * Math.log2(words.length || 1))
  const box = (k: keyof typeof SETS | 'noSimilar', label: string) => <label className="pw-check" key={k}><input type="checkbox" checked={o[k]} onChange={e => setO({ ...o, [k]: e.target.checked })} />{label}</label>
  return (
    <div className="island pw-gen">
      <div className="segmented">
        <button className={mode === 'chars' ? 'on' : ''} onClick={() => setMode('chars')}>{t('passwords.random')}</button>
        <button className={mode === 'words' ? 'on' : ''} onClick={() => setMode('words')}>{t('passwords.words')}</button>
      </div>
      <code className="pw-made">{made}</code>
      <p className="muted">{t('passwords.bits', { bits, strength: t(bits >= 80 ? 'passwords.strong' : bits >= 60 ? 'passwords.good' : 'passwords.weak') })}</p>
      {mode === 'chars' ? <>
        <label className="pw-field"><span>{t('passwords.length', { n: o.length })}</span><input type="range" min={8} max={64} value={o.length} onChange={e => setO({ ...o, length: +e.target.value })} /></label>
        <div className="pw-checks">{box('upper', 'A–Z')}{box('lower', 'a–z')}{box('digits', '0–9')}{box('symbols', '!@#…')}</div>
        <div className="pw-checks">{box('noSimilar', t('passwords.noSimilar'))}</div>
      </> : <>
        <label className="pw-field"><span>{t('passwords.wordCount', { n })}</span><input type="range" min={3} max={10} value={n} onChange={e => setN(+e.target.value)} /></label>
        <p className="muted">{t('passwords.effCredit')}</p>
      </>}
      <div className="dialog-actions">
        <button className="text-button" onClick={() => setTurn(turn + 1)}><Icon name="refresh" size={18} /> {t('passwords.generate')}</button>
        <button className="filled-button pw-filled" disabled={!made} onClick={() => copy(made, t('passwords.passwordCopied'))}><Icon name="copy" size={18} /> {t('common.copy')}</button>
      </div>
    </div>
  )
}
