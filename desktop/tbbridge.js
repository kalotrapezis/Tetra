'use strict'
/**
 * Tetra's door for its Thunderbird extension (../thunderbird/): an account Thunderbird can open and Tetra cannot (a
 * university's Microsoft 365, which lets only approved apps in) comes into Tetra Mail as auth 'thunderbird' (mail.js).
 * Plain HTTP on 127.0.0.1 only, every call with a token the extension got once, when the user said yes in Tetra (pair).
 *
 *   POST /tb/pair                          → { token } once the user allows it here; 403 when they do not
 *   GET  /tb/hello                         → { tetra: 1, accounts: [address…] }  the accounts bridged now
 *   POST /tb/account  { address, name }    → the account, added as auth 'thunderbird' if Tetra does not have it
 *   GET  /tb/known?account=&folder=        → { ids: [Message-ID without <>…] }  what need not be sent again
 *   POST /tb/mail     { account, folder, raw (base64), seen, flagged, fresh, update } → { id, known }
 *   GET  /tb/outbox                        → { mails: [...] }  each handed over once (mail.thunderbirdTake)
 *   POST /tb/sent     { id, error? }       → { ok }
 */
const http = require('node:http')
const crypto = require('node:crypto')

const PORT = 43190
const LIMIT = 80 * 1024 * 1024 // one mail as base64 JSON; Microsoft's own limit is 150 MB, mail that big stays in Thunderbird
const FOLDERS = ['Inbox', 'Sent']
const ADDRESS = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/

/** [token]() the saved token or null; [save](token); [ask]() resolves true when the user lets Thunderbird in. */
function start(mail, { token, save, ask, port = PORT, host = '127.0.0.1' }) {
  let asking = null // one question on screen at a time; a second pair call waits for the same answer
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
  const bridged = () => mail.accounts().filter(a => a.auth === 'thunderbird')
  function account(id) {
    const a = bridged().find(x => x.id === String(id ?? ''))
    if (!a) throw fail(404, 'Not a Thunderbird account in Tetra')
    return a
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1'), route = `${req.method} ${url.pathname}`
    if (route === 'POST /tb/pair') {
      asking ??= Promise.resolve(ask()).finally(() => { asking = null })
      if (!(await asking)) return reply(res, 403, { error: 'Not allowed in Tetra' })
      let t = token()
      if (!t) { t = crypto.randomBytes(32).toString('base64url'); save(t) }
      return reply(res, 200, { token: t })
    }
    if (!allowed(req)) return reply(res, 401, { error: 'Pair with Tetra first' })
    if (route === 'GET /tb/hello') return reply(res, 200, { tetra: 1, accounts: bridged().map(a => a.address) })
    if (route === 'POST /tb/account') {
      const { address, name } = await read(req)
      const at = String(address ?? '').trim().toLowerCase()
      if (!ADDRESS.test(at)) throw fail(400, 'Not an address')
      const was = mail.accounts().find(a => a.id === at)
      if (was && was.auth !== 'thunderbird') throw fail(409, 'Tetra fetches this account itself') // never turned into a bridged one behind the user's back
      return reply(res, 200, was ?? mail.add({ address: at, name: typeof name === 'string' ? name.slice(0, 80) : '', auth: 'thunderbird' }))
    }
    if (route === 'GET /tb/known') {
      const folder = url.searchParams.get('folder')
      if (!FOLDERS.includes(folder)) throw fail(400, 'Inbox or Sent')
      return reply(res, 200, { ids: mail.thunderbirdKnown(account(url.searchParams.get('account')), folder) })
    }
    if (route === 'POST /tb/mail') {
      const b = await read(req)
      if (!FOLDERS.includes(b.folder)) throw fail(400, 'Inbox or Sent')
      const raw = Buffer.from(String(b.raw ?? ''), 'base64')
      if (!raw.length) throw fail(400, 'No mail')
      return reply(res, 200, await mail.fromThunderbird(account(b.account), { folder: b.folder, raw, seen: !!b.seen, flagged: !!b.flagged, fresh: !!b.fresh, update: !!b.update }))
    }
    if (route === 'GET /tb/outbox') return reply(res, 200, { mails: mail.thunderbirdTake() })
    if (route === 'POST /tb/sent') {
      const { id, error } = await read(req)
      return reply(res, 200, { ok: mail.thunderbirdDone(id, error || null) })
    }
    reply(res, 404, { error: 'No such call' })
  }

  const server = http.createServer((req, res) => handle(req, res).catch(e => {
    if (!e.status) console.warn('[tbbridge]', e.message)
    if (!res.headersSent) reply(res, e.status ?? 500, { error: e.message })
  }))
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => resolve(server)) })
}

module.exports = { start, PORT }
