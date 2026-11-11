/*
 * Passwords and 2FA on this computer (the user, 4 Nov 2026: "sync across devices phone tablet and PC", "Do the desktop now").
 * The phone's and tablet's vault, end to end encrypted in .System/Browser/Shared (Tetra-mobile BrowserPasswords.kt,
 * Authenticator.kt; SYNC_PLAN 6aw), read and written here in the same format:
 *
 *   Passwords/key.json             Argon2id's recipe (m KiB, t, p 1, salt) and a check box only the right key opens
 *   Passwords/<device>.enc         every login, card and address a device knows, AES-256-GCM, AAD "passwords|<device>"
 *   TwoFactor/<device>.enc         the 2FA codes, the same key, AAD "2fa|<device>"
 *
 * Each device writes only its own file; reading merges them all (newer change wins, at a tie the living one; deletions are
 * tombstones, gone after 30 days). What changed here is recorded against a base kept in the app's own storage (main.js keeps
 * it with safeStorage), never in ~/Tetra. Nothing plain is written under ~/Tetra, and no secret is logged.
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')

const CHECK = 'tetra-browser-passwords'
const DAY = 86_400_000
const KINDS = { passwords: 'Passwords', '2fa': 'TwoFactor' }

let sodium = null
const ready = async () => { if (!sodium) { const s = require('libsodium-wrappers-sumo'); await s.ready; sodium = s } return sodium }

// Android's org.json writes "/" as "\/" (JSON.stringify does not): a value made here must be the very string the phone
// makes, or the phone reads it as changed (or an address, keyed by its value, as another one)
const jstr = s => '"' + String(s).replace(/["\\/\u0000-\u001f]/g, c =>
  ({ '"': '\\"', '\\': '\\\\', '/': '\\/', '\t': '\\t', '\b': '\\b', '\n': '\\n', '\r': '\\r', '\f': '\\f' })[c] ?? '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) + '"'
const jarr = a => '[' + a.map(jstr).join(',') + ']'
const jobj = o => '{' + Object.entries(o).map(([k, v]) => jstr(k) + ':' + (typeof v === 'string' ? jstr(v) : typeof v === 'object' ? jobj(v) : String(v))).join(',') + '}'

// ---- the records (SecretSet): { key: { v, at, gone? } } ----

const better = (a, b) => a.at !== b.at ? a.at > b.at : !!a.gone !== !!b.gone ? !a.gone : a.v > b.v
function merge(a, b) {
  const out = { ...a }
  for (const [k, r] of Object.entries(b)) if (!out[k] || better(r, out[k])) out[k] = r
  return out
}
const pruned = (set, now, days = 30) => Object.fromEntries(Object.entries(set).filter(([, r]) => !r.gone || r.at >= now - days * DAY))
/** What [here] (key → value) changed since [set], stamped [now]: new or changed recorded whole, one no longer there a tombstone. */
function record(set, here, now) {
  const out = { ...set }
  for (const [k, v] of Object.entries(here)) { const r = set[k]; if (!r || r.gone || r.v !== v) out[k] = { v, at: now } }
  for (const [k, r] of Object.entries(set)) if (!r.gone && !(k in here)) out[k] = { v: r.v, at: now, gone: true }
  return out
}
/** The living values by key, oldest first (Android's order when it has none of its own). */
const live = set => Object.fromEntries(Object.entries(set).filter(([, r]) => !r.gone).sort(([ka, a], [kb, b]) => a.at - b.at || (ka < kb ? -1 : ka > kb ? 1 : 0)).map(([k, r]) => [k, r.v]))
const setJson = set => jobj(Object.fromEntries(Object.entries(set).map(([k, r]) => [k, r.gone ? { v: r.v, at: r.at, gone: true } : { v: r.v, at: r.at }])))
const sameSet = (a, b) => !!a && !!b && setJson(Object.fromEntries(Object.entries(a).sort())) === setJson(Object.fromEntries(Object.entries(b).sort()))
function parseSet(text) {
  try {
    const o = JSON.parse(text), out = {}
    for (const [k, r] of Object.entries(o)) { if (typeof r.v !== 'string' || typeof r.at !== 'number') return null; out[k] = r.gone ? { v: r.v, at: r.at, gone: true } : { v: r.v, at: r.at } }
    return out
  } catch { return null }
}

// ---- the key ----

class WrongPassphrase extends Error { constructor() { super('Wrong passphrase'); this.code = 'wrong' } }

function parseRecipe(text) {
  try {
    const o = JSON.parse(text)
    if (o.v !== 1 || o.kdf !== 'argon2id') return null
    return { salt: o.salt, m: o.m, t: o.t, p: o.p, made: o.made, check: o.check }
  } catch { return null }
}
const recipeJson = r => JSON.stringify({ v: 1, kdf: 'argon2id', m: r.m, t: r.t, p: r.p, salt: r.salt, made: r.made, check: r.check }, null, 1) + '\n'

/** The recipe in force: of key.json and any copy sync left beside it ("key (2).json"), the one made last. */
function recipe(root) {
  const dir = path.join(root, KINDS.passwords)
  let names = []
  try { names = fs.readdirSync(dir) } catch {}
  return names.filter(n => n.startsWith('key') && n.endsWith('.json')).map(n => { try { return parseRecipe(fs.readFileSync(path.join(dir, n), 'utf8')) } catch { return null } })
    .filter(Boolean).reduce((a, b) => !a || b.made > a.made || (b.made === a.made && b.salt > a.salt) ? b : a, null)
}

/** Argon2id (v1.3) of the passphrase with the recipe's salt: libsodium's, which takes one lane only, as Tetra's recipes have. */
async function derive(passphrase, r) {
  const s = await ready()
  const salt = Buffer.from(r.salt, 'base64')
  if (r.p !== 1 || salt.length !== s.crypto_pwhash_SALTBYTES) throw new Error('Unsupported key recipe')
  return Buffer.from(s.crypto_pwhash(32, Buffer.from(String(passphrase), 'utf8'), salt, r.t, r.m * 1024, s.crypto_pwhash_ALG_ARGON2ID13))
}

function seal(key, plain, aad) {
  const nonce = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key, nonce)
  c.setAAD(Buffer.from(aad))
  const data = Buffer.concat([c.update(plain), c.final(), c.getAuthTag()])
  return [nonce.toString('base64'), data.toString('base64')]
}
/** The plain bytes; throws on a wrong key or changed bytes. */
function open(key, nonce, data, aad) {
  const d = Buffer.from(data, 'base64')
  if (d.length < 16) throw new Error('short')
  const c = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64'))
  c.setAAD(Buffer.from(aad))
  c.setAuthTag(d.subarray(d.length - 16))
  return Buffer.concat([c.update(d.subarray(0, d.length - 16)), c.final()])
}

/** A new recipe and its key (no device has one yet, or "forgot it"): OWASP's Argon2id setting, 46 MiB once through. */
async function create(passphrase, now = Date.now(), m = 47104, t = 1) {
  const r = { salt: crypto.randomBytes(16).toString('base64'), m, t, p: 1, made: now, check: '' }
  const key = await derive(passphrase, r)
  r.check = seal(key, Buffer.from(CHECK), 'check').join('.')
  return { recipe: r, key }
}

/** The key [passphrase] makes with [r], or WrongPassphrase when the check box does not open with it. */
async function unlock(passphrase, r) {
  const key = await derive(passphrase, r)
  const [n, d] = String(r.check).split('.')
  let ok = false
  try { ok = open(key, n, d, 'check').toString() === CHECK } catch {}
  if (!ok) throw new WrongPassphrase()
  return key
}

/** A file with nothing half-written seen: a dot file first (sync and the watcher skip those), then renamed. */
function save(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const part = path.join(path.dirname(file), `.${path.basename(file)}.part`)
  fs.writeFileSync(part, text)
  fs.renameSync(part, file)
}

function encrypt(key, r, me, set, kind = 'passwords') {
  const [nonce, data] = seal(key, Buffer.from(setJson(set)), `${kind}|${me}`)
  return JSON.stringify({ v: 1, kdf: 'argon2id', m: r.m, t: r.t, p: r.p, salt: r.salt, nonce, data }, null, 1) + '\n'
}
/** A device's file opened with [key]; null when it is another key's (another salt) or does not open (changed, or not ours). */
function decrypt(key, r, device, text, kind = 'passwords') {
  try {
    const o = JSON.parse(text)
    if (o.v !== 1 || o.salt !== r.salt) return null
    return parseSet(open(key, o.nonce, o.data, `${kind}|${device}`).toString())
  } catch { return null }
}

/**
 * Every device's [kind] merged, with what changed here: [edit] gets this device's living values (key → value) and returns
 * them as they should be now. Mine written again when the merge differs from it. [base] is what this device last saw.
 */
function merged(root, kind, me, key, r, base, now = Date.now(), edit = null) {
  const dir = path.join(root, KINDS[kind])
  const mine = path.join(dir, `${me}.enc`)
  let shared = null
  try { shared = decrypt(key, r, me, fs.readFileSync(mine, 'utf8'), kind) } catch {}
  const own = base ?? shared ?? {}
  const here = live(own)
  const recorded = edit ? record(own, edit(here), now) : own
  let names = []
  try { names = fs.readdirSync(dir) } catch {}
  let unreadable = 0
  const others = names.filter(n => n.endsWith('.enc') && !n.startsWith('.') && n !== `${me}.enc`).map(n => {
    let s = null
    try { s = decrypt(key, r, n.slice(0, -4), fs.readFileSync(path.join(dir, n), 'utf8'), kind) } catch {}
    if (!s) unreadable++
    return s
  }).filter(Boolean)
  const all = pruned(others.reduce(merge, recorded), now)
  if (!sameSet(all, shared) && (Object.keys(all).length || shared)) save(mine, encrypt(key, r, me, all, kind))
  return { all, others: others.length, unreadable }
}

// ---- what the records hold (Android's keyed()) ----

const loginKey = l => `l|${l.host}|${l.user}`
// no note, no ♥: as before them, so older records read the same
const loginValue = l => jarr([l.host, l.user, l.password, ...(l.note || l.pinned ? [l.note ?? ''] : []), ...(l.pinned ? ['1'] : [])])
const cardKey = c => `c|${c.number}`
// the security code fifth, only when there is one (the user, 11 Nov: "ask the password a second time to show the CVV"): a card
// without one is written as before, so a phone that does not know it reads it all the same
const cardValue = c => jarr([c.name, c.number, c.month, c.year, ...(c.cvc ? [c.cvc] : [])])
const addressValue = fields => jarr(Object.keys(fields).sort().flatMap(k => [k, fields[k]]))
const clean = s => String(s).toUpperCase().replace(/[ =-]/g, '')
const codeKey = e => `${e.issuer.toLowerCase()}|${e.account.toLowerCase()}|${clean(e.secret)}`
const codeValue = e => jobj({ issuer: e.issuer, account: e.account, secret: e.secret, algorithm: e.algorithm, digits: e.digits, period: e.period, ...(e.pinned ? { pinned: true } : {}) })

/** The living records as the page shows them. */
function vault(values) {
  const out = { logins: [], cards: [], addresses: [] }
  for (const [key, v] of Object.entries(values)) {
    let a
    try { a = JSON.parse(v) } catch { continue }
    if (key.startsWith('l|')) out.logins.push({ key, host: a[0], user: a[1], password: a[2], note: a[3] ?? '', pinned: a[4] === '1' })
    else if (key.startsWith('c|')) out.cards.push({ key, name: a[0], number: a[1], month: a[2], year: a[3], hasCvc: !!a[4] }) // the code itself never in the list
    else if (key.startsWith('a|')) { const fields = {}; for (let i = 0; i + 1 < a.length; i += 2) fields[a[i]] = a[i + 1]; out.addresses.push({ key, fields }) }
  }
  return out
}
function codes(values) {
  const out = []
  for (const [key, v] of Object.entries(values)) {
    try { const o = JSON.parse(v); out.push({ key, issuer: o.issuer ?? '', account: o.account ?? '', secret: o.secret, algorithm: o.algorithm ?? 'SHA1', digits: o.digits ?? 6, period: o.period ?? 30, pinned: !!o.pinned }) } catch {}
  }
  return out
}
/** A thing of the page as its record: [key, value]. */
function keyed(kind, item) {
  if (kind === '2fa') { const e = { issuer: item.issuer.trim(), account: item.account.trim(), secret: clean(item.secret), algorithm: item.algorithm || 'SHA1', digits: +item.digits || 6, period: +item.period || 30, pinned: !!item.pinned }; return [codeKey(e), codeValue(e)] }
  if (item.fields) { const f = Object.fromEntries(Object.entries(item.fields).map(([k, v]) => [k, String(v).trim()]).filter(([, v]) => v)); const v = addressValue(f); return ['a|' + v, v] }
  if ('number' in item) { const c = { name: item.name.trim(), number: item.number.replace(/\s/g, ''), month: item.month.trim(), year: item.year.trim(), cvc: String(item.cvc ?? '').replace(/\D/g, '').slice(0, 4) }; return [cardKey(c), cardValue(c)] }
  const l = { host: item.host.trim(), user: item.user.trim(), password: item.password, note: (item.note ?? '').trim(), pinned: !!item.pinned }
  return [loginKey(l), loginValue(l)]
}

// ---- 2FA codes (RFC 6238) ----

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function base32(s) {
  const t = clean(s)
  if (!t) return null
  const out = []
  let buf = 0, bits = 0
  for (const c of t) {
    const v = B32.indexOf(c)
    if (v < 0) return null
    buf = ((buf << 5) | v) & 0xffff; bits += 5
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 0xff) }
  }
  return Buffer.from(out)
}
function hotp(key, counter, digits = 6, algorithm = 'SHA1') {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(counter))
  const h = crypto.createHmac(algorithm.toLowerCase(), key).update(c).digest()
  const o = h[h.length - 1] & 0x0f
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
  return String(bin % 10 ** digits).padStart(digits, '0')
}
/** The code at [ms]; "" when the secret is not Base32. */
function totp(e, ms = Date.now()) { const k = base32(e.secret); return k ? hotp(k, Math.floor(ms / 1000 / e.period), e.digits, e.algorithm) : '' }

/** otpauth://totp/Issuer:account?secret=…&issuer=… (Google's Key Uri Format); null for HOTP or a broken one. */
function otpauth(uri) {
  const u = String(uri).trim()
  const m = /^otpauth:\/\/totp\/([^?]*)\??(.*)$/i.exec(u)
  if (!m) return null
  const dec = s => { try { return decodeURIComponent(s.replace(/\+/g, ' ')) } catch { return s } }
  const q = Object.fromEntries(m[2].split('&').filter(p => p.includes('=')).map(p => [p.slice(0, p.indexOf('=')).toLowerCase(), dec(p.slice(p.indexOf('=') + 1))]))
  const secret = q.secret ? clean(q.secret) : ''
  if (!base32(secret)) return null
  let label
  try { label = decodeURIComponent(m[1]) } catch { label = m[1] }
  const issuer = q.issuer?.trim() || (label.includes(':') ? label.slice(0, label.indexOf(':')).trim() : '')
  const account = (label.includes(':') ? label.slice(label.indexOf(':') + 1) : label).trim()
  const algorithm = ['SHA1', 'SHA256', 'SHA512'].includes(q.algorithm?.toUpperCase()) ? q.algorithm.toUpperCase() : 'SHA1'
  const digits = +q.digits >= 6 && +q.digits <= 8 ? +q.digits : 6
  const period = +q.period >= 1 && +q.period <= 300 ? +q.period : 30
  return { issuer, account, secret, algorithm, digits, period }
}

/**
 * Windows' check of an account's password (advapi32's LogonUser, as runas does). The name and password come on stdin, each a
 * line of base64 UTF-8, never on the command line where other programs could read them. The script itself goes encoded, as
 * Node's quoting of its double quotes is not what Windows PowerShell undoes.
 */
const WIN_LOGON = 'Add-Type -Namespace TetraLogon -Name Api -MemberDefinition \'' +
  '[DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool LogonUser(string u, string d, string p, int type, int provider, out IntPtr token); ' +
  '[DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);\'; ' +
  '$line = { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine().Trim())) }; ' +
  '$u = & $line; $p = & $line; $t = [IntPtr]::Zero; ' +
  'if ([TetraLogon.Api]::LogonUser($u, $env:USERDOMAIN, $p, 2, 0, [ref]$t)) { [void][TetraLogon.Api]::CloseHandle($t); exit 0 } else { exit 1 }'

/** The computer's own login password, checked by PAM's helper (what screen lockers use) or Windows' LogonUser; false where neither is. */
function systemPassword(user, password) {
  if (process.platform === 'win32') {
    if (!password) return Promise.resolve(false)
    return new Promise(res => {
      const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WIN_LOGON, 'utf16le').toString('base64')], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true })
      p.on('error', () => res(false))
      p.on('close', code => res(code === 0))
      p.stdin.on('error', () => {})
      p.stdin.end([user, password].map(x => Buffer.from(String(x)).toString('base64')).join('\n') + '\n')
    })
  }
  const bin = ['/usr/sbin/unix_chkpwd', '/sbin/unix_chkpwd'].find(f => fs.existsSync(f))
  if (!bin || !password) return Promise.resolve(false)
  return new Promise(res => {
    const p = spawn(bin, [user, 'nonull'], { stdio: ['pipe', 'ignore', 'ignore'] })
    p.on('error', () => res(false))
    p.on('close', code => res(code === 0))
    p.stdin.on('error', () => {})
    p.stdin.end(Buffer.concat([Buffer.from(String(password)), Buffer.alloc(1)]))
  })
}

/**
 * This computer's side: the key (kept by [keep] with safeStorage, so the passphrase is asked once), the page's lock, and the
 * merge of both kinds. [keep] = { get(name), set(name, value|null) } in the app's own storage.
 */
class Passwords {
  constructor({ root, device, keep, user }) {
    this.root = root; this.device = device; this.keep = keep; this.user = user
    this.opened = false
  }

  stored() {
    try { const o = JSON.parse(this.keep.get('key') ?? 'null'); return o && { recipe: o.recipe, key: Buffer.from(o.key, 'base64') } } catch { return null }
  }

  status() {
    const now = recipe(this.root), mine = this.stored()
    return { recipe: !!now, kept: !!mine, need: !mine || (!!now && now.salt !== mine.recipe.salt), open: this.opened && !!mine && (!now || now.salt === mine.recipe.salt) }
  }

  /** The sync passphrase: the recipe in force unlocked with it, or (no device has one yet) a new one made. Kept, and the page opened. */
  async setPassphrase(passphrase, isNew = false) {
    let r = recipe(this.root), key
    const made = !r || isNew
    if (!made) key = await unlock(passphrase, r)
    else {
      if (String(passphrase).length < 8) throw Object.assign(new Error('Too short'), { code: 'short' });
      ({ recipe: r, key } = await create(passphrase))
      save(path.join(this.root, KINDS.passwords, 'key.json'), recipeJson(r))
    }
    this.keep.set('key', JSON.stringify({ recipe: r, key: key.toString('base64') }))
    this.opened = true // a new passphrase: what this computer saw under the old one (its base) is merged again under the new
    console.log(`[passwords] ${made ? 'a new passphrase' : 'the passphrase in force'} kept on this computer`)
  }

  /** The page opened again after a lock: the computer's login password, or the sync passphrase. */
  async open(secret) {
    const mine = this.stored()
    if (!mine) throw new WrongPassphrase()
    let ok = false
    try { const k = await derive(secret, mine.recipe); ok = crypto.timingSafeEqual(k, mine.key) } catch {}
    if (!ok) ok = await systemPassword(this.user, secret)
    if (!ok) throw new WrongPassphrase()
    this.opened = true
  }

  /** The password asked again, the page staying as it is: the computer's login password, or the sync passphrase. */
  async verify(secret) {
    const mine = this.stored()
    if (!mine || !this.status().open) throw new WrongPassphrase()
    let ok = false
    try { ok = crypto.timingSafeEqual(await derive(secret, mine.recipe), mine.key) } catch {}
    if (!ok) ok = await systemPassword(this.user, secret)
    if (!ok) throw new WrongPassphrase()
  }

  /** A card's security code, only after the password asked again (verify). */
  async cvc(key, secret) {
    await this.verify(secret)
    const v = live(this.run('passwords').all)[key]
    if (!v) throw new Error('No such card')
    return JSON.parse(v)[4] ?? ''
  }

  lock() { this.opened = false }

  /** Forgotten on this computer: the key and the bases; the files in ~/Tetra stay. */
  forget() { this.keep.set('key', null); this.keep.set('base:passwords', null); this.keep.set('base:2fa', null); this.opened = false }

  run(kind, edit = null, now = Date.now()) {
    if (!this.status().open) throw Object.assign(new Error('Locked'), { code: 'locked' })
    const { recipe: r, key } = this.stored()
    if (!recipe(this.root)) save(path.join(this.root, KINDS.passwords, 'key.json'), recipeJson(r)) // ours, not there (yet): written again
    const name = 'base:' + kind
    let base = null
    try { base = parseSet(this.keep.get(name) ?? 'null') } catch {}
    const m = merged(this.root, kind, this.device, key, r, base, now, edit)
    if (!sameSet(m.all, base)) this.keep.set(name, setJson(m.all))
    if (edit || !base) console.log(`[passwords] ${kind}: ${Object.keys(live(m.all)).length} kept, ${m.others} other devices${m.unreadable ? `, ${m.unreadable} of another passphrase left` : ''}`)
    return m
  }

  /** Everything the page shows, the others' files merged in. */
  list() {
    const p = this.run('passwords'), c = this.run('2fa')
    return { ...vault(live(p.all)), codes: codes(live(c.all)), devices: Math.max(p.others, c.others), unreadable: p.unreadable + c.unreadable }
  }

  /** [old] (a key) taken away and [item] put in its place; either may be null. */
  change(kind, old, item) {
    this.run(kind, here => {
      const out = { ...here }
      // a card changed without a new security code keeps the one it had (the page never has it)
      if (item && 'number' in item && !item.cvc && old && out[old]) { try { item = { ...item, cvc: JSON.parse(out[old])[4] ?? '' } } catch {} }
      if (old) delete out[old]
      if (item) { const [k, v] = keyed(kind, item); out[k] = v }
      return out
    })
    return this.list()
  }

  /** The codes of now, and the seconds left of them. */
  codes(now = Date.now()) {
    const s = this.stored()
    if (!this.status().open || !s) return []
    let base = null
    try { base = parseSet(this.keep.get('base:2fa') ?? 'null') } catch {}
    return codes(live(base ?? {})).map(e => ({ key: e.key, code: totp(e, now), left: e.period - Math.floor(now / 1000) % e.period }))
  }
}

module.exports = { WIN_LOGON, Passwords, WrongPassphrase, merge, pruned, record, live, setJson, parseSet, sameSet, parseRecipe, recipeJson, recipe, derive, create, unlock, encrypt, decrypt, merged, keyed, vault, codes, base32, hotp, totp, otpauth, jstr, systemPassword }
