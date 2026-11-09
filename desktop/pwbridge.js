'use strict'
/**
 * Tetra's door for its Firefox extension (../firefox/): the Passwords applet's logins and 2FA codes in Firefox — a list
 * in the toolbar, fill on the page, and a login typed or changed on a site saved back here (and so to the phone and tablet).
 * Plain HTTP on 127.0.0.1 only, every call with a token the extension got once, when the user said yes in Tetra (pair),
 * as tbbridge.js does. Secrets only while the page is open (unlocked); locked, the extension may open it with the same
 * passwords the page takes (the computer's login password or the sync passphrase).
 *
 *   POST /pw/pair                       → { token } once the user allows it here; 403 when they do not
 *   GET  /pw/status                     → { open, need }   need: no passphrase on this computer yet (set it in Tetra)
 *   POST /pw/open   { secret }          → { open: true }, 403 when wrong
 *   POST /pw/lock                       → { open: false }
 *   GET  /pw/list                       → { logins: [{ key, host, user, password }], codes: [{ key, issuer, account, code, left }] }
 *   POST /pw/save   { host, user, password } → { saved: 'new' | 'changed' | 'same' }  same host and user: its password changed
 */
const http = require('node:http')
const crypto = require('node:crypto')
const { totp } = require('./passwords')

const PORT = 43191
const LIMIT = 64 * 1024

/** [token]() saved token or null; [save](token); [ask]() true when the user lets Firefox in; [touched]() a call came; [changed]() the vault changed. */
function start(passwords, { token, save, ask, touched = () => {}, changed = () => {}, port = PORT, host = '127.0.0.1' }) {
  let asking = null
  const reply = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
  const fail = (status, message) => Object.assign(new Error(message), { status })

  function read(req) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      req.on('data', c => { size += c.length; if (size > LIMIT) { reject(fail(413, 'Too big')); req.destroy() } else chunks.push(c) })
      req.on('end', () => { try { resolve(size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}) } catch { reject(fail(400, 'Not JSON')) } })
      req.on('error', reject)
    })
  }
  function allowed(req) {
    const want = token(), got = String(req.headers.authorization ?? '').replace(/^Bearer /, '')
    return !!want && got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))
  }
  const open = () => { if (!passwords.status().open) throw fail(423, 'Locked') }
  const str = (v, max) => { if (typeof v !== 'string' || v.length > max) throw fail(400, 'Bad field'); return v }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1'), route = `${req.method} ${url.pathname}`
    // a web page may post here too (no preflight for a bare POST): only an extension's own page may ask to pair
    if (/^https?:/i.test(String(req.headers.origin ?? ''))) return reply(res, 403, { error: 'Not from a web page' })
    if (route === 'POST /pw/pair') {
      asking ??= Promise.resolve(ask()).finally(() => { asking = null })
      if (!(await asking)) return reply(res, 403, { error: 'Not allowed in Tetra' })
      let t = token()
      if (!t) { t = crypto.randomBytes(32).toString('base64url'); save(t) }
      return reply(res, 200, { token: t })
    }
    if (!allowed(req)) return reply(res, 401, { error: 'Pair with Tetra first' })
    touched()
    if (route === 'GET /pw/status') { const s = passwords.status(); return reply(res, 200, { open: s.open, need: s.need }) }
    if (route === 'POST /pw/open') {
      const { secret } = await read(req)
      try { await passwords.open(str(secret, 1024)) } catch (e) { if (e.status) throw e; throw fail(403, 'Wrong password') }
      changed()
      return reply(res, 200, { open: true })
    }
    if (route === 'POST /pw/lock') { passwords.lock(); changed(); return reply(res, 200, { open: false }) }
    if (route === 'GET /pw/list') {
      open()
      const l = passwords.list(), now = Date.now()
      return reply(res, 200, {
        logins: l.logins.map(({ key, host, user, password }) => ({ key, host, user, password })),
        codes: l.codes.map(e => ({ key: e.key, issuer: e.issuer, account: e.account, code: totp(e, now), left: e.period - Math.floor(now / 1000) % e.period })), // the secret stays here
      })
    }
    if (route === 'POST /pw/save') {
      open()
      const b = await read(req), item = { host: str(b.host, 512).trim(), user: str(b.user ?? '', 512).trim(), password: str(b.password, 1024) }
      if (!item.host || !item.password) throw fail(400, 'Host and password')
      const was = passwords.list().logins.find(l => l.host === item.host && l.user === item.user)
      if (was?.password === item.password) return reply(res, 200, { saved: 'same' })
      passwords.change('passwords', was?.key ?? null, { ...item, note: was?.note ?? '', pinned: !!was?.pinned })
      changed()
      console.log(`[pwbridge] a login ${was ? 'changed' : 'added'} from Firefox`) // never which one
      return reply(res, 200, { saved: was ? 'changed' : 'new' })
    }
    reply(res, 404, { error: 'No such call' })
  }

  const server = http.createServer((req, res) => handle(req, res).catch(e => {
    if (!e.status) console.warn('[pwbridge]', e.message)
    if (!res.headersSent) reply(res, e.status ?? 500, { error: e.status ? e.message : 'Tetra error' })
  }))
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => resolve(server)) })
}

module.exports = { start, PORT }
