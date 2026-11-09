'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const pw = require('../passwords')
const pwbridge = require('../pwbridge')

// the phone's vault (fixtures/passwords, invented data) behind the bridge, on a port of its own
const FIX = path.join(__dirname, 'fixtures', 'passwords')
const PHRASE = 'correct horse battery staple ✓'

test('pwbridge: pair once, locked until opened, list without 2FA secrets, a login typed in Firefox saved or changed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tetra-pwb-'))
  fs.cpSync(FIX, root, { recursive: true })
  const m = new Map(), keep = { get: k => m.get(k) ?? null, set: (k, v) => v == null ? m.delete(k) : m.set(k, v) }
  const p = new pw.Passwords({ root, device: 'PC-000000', keep, user: 'nobody' })
  await p.setPassphrase(PHRASE)
  p.lock()

  let saved = null, allow = false, changed = 0
  const server = await pwbridge.start(p, { token: () => saved, save: v => { saved = v }, ask: () => allow, changed: () => changed++, port: 0 })
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (route, body, headers = {}) => {
    const r = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(saved && { authorization: `Bearer ${saved}` }), ...headers }, body: body && JSON.stringify(body) })
    return { status: r.status, body: await r.json() }
  }
  try {
    assert.equal((await call('/pw/status')).status, 401)
    assert.equal((await call('/pw/pair', {})).status, 403) // the user said no
    allow = true
    assert.equal((await call('/pw/pair', {}, { origin: 'https://evil.example' })).status, 403) // never from a web page
    const t = (await call('/pw/pair', {})).body.token
    assert.ok(t && saved === t)

    assert.deepEqual((await call('/pw/status')).body, { open: false, need: false })
    assert.equal((await call('/pw/list')).status, 423)
    assert.equal((await call('/pw/open', { secret: 'wrong one!' })).status, 403)
    assert.equal((await call('/pw/open', { secret: PHRASE })).status, 200)

    const list = (await call('/pw/list')).body
    assert.ok(list.logins.length > 0 && list.logins.every(l => l.host && 'password' in l))
    assert.ok(list.codes.every(c => /^\d{6,8}$/.test(c.code) && !('secret' in c)))

    const first = list.logins[0]
    assert.equal((await call('/pw/save', { host: first.host, user: first.user, password: first.password })).body.saved, 'same')
    assert.equal((await call('/pw/save', { host: first.host, user: first.user, password: 'N3w!password' })).body.saved, 'changed')
    assert.equal((await call('/pw/save', { host: 'example.org', user: 'me', password: 'x1!' })).body.saved, 'new')
    const after = p.list().logins
    assert.equal(after.length, list.logins.length + 1)
    assert.equal(after.find(l => l.host === first.host && l.user === first.user).password, 'N3w!password')
    assert.ok(changed >= 3)

    await call('/pw/lock', {})
    assert.equal(p.status().open, false)
  } finally { server.close() }
})
