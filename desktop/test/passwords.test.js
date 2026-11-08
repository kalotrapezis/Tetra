const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const pw = require('../passwords')

// fixtures/passwords: the phone's files, made by Make.java as Tetra-mobile's BrowserPasswords.kt makes them (invented data)
const FIX = path.join(__dirname, 'fixtures', 'passwords')
const PHRASE = 'correct horse battery staple ✓'
const expected = JSON.parse(fs.readFileSync(path.join(FIX, 'expected.json'), 'utf8'))

function copy() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tetra-pw-'))
  fs.cpSync(FIX, root, { recursive: true })
  return root
}
const keepIn = (m = new Map()) => ({ get: k => m.get(k) ?? null, set: (k, v) => v == null ? m.delete(k) : m.set(k, v), m })

test('Argon2id: libsodium makes the key BouncyCastle (checked against RFC 9106) makes', async () => {
  const v = JSON.parse(fs.readFileSync(path.join(FIX, 'vector.json'), 'utf8'))
  const key = await pw.derive(v.passphrase, { salt: v.salt, m: v.m, t: v.t, p: 1 })
  assert.equal(key.toString('hex'), v.key)
  await assert.rejects(pw.derive(v.passphrase, { salt: v.salt, m: v.m, t: v.t, p: 4 })) // one lane only, as Tetra's recipes
})

test("the phone's key.json opens with its passphrase only", async () => {
  const r = pw.recipe(FIX)
  assert.equal(r.m, 1024)
  await pw.unlock(PHRASE, r)
  await assert.rejects(pw.unlock('not the passphrase', r), pw.WrongPassphrase)
  // a recipe made later wins (forgot it: a new key.json; a sync copy beside it)
  const root = copy()
  const { recipe: r2 } = await pw.create('another passphrase', 5000, 1024)
  fs.writeFileSync(path.join(root, 'Passwords', 'key (2).json'), pw.recipeJson(r2))
  assert.equal(pw.recipe(root).salt, r2.salt)
})

test("the phone's and tablet's files merged: newer wins, a tie the living one, mine written", async () => {
  const root = copy(), r = pw.recipe(root), key = await pw.unlock(PHRASE, r)
  const m = pw.merged(root, 'passwords', 'PC-000000', key, r, null, 10_000)
  assert.equal(m.others, 2); assert.equal(m.unreadable, 0)
  const v = pw.vault(pw.live(m.all))
  assert.deepEqual(v.logins.map(l => `${l.host}|${l.user}|${l.password}`).sort(),
    ['example.org|maria|Pa/ss"w0rd\\x', 'https://shop.example.com/login|ana@example.org|second-pw', 'old.example.net|x|y'])
  const shop = v.logins.find(l => l.user === 'ana@example.org')
  assert.equal(shop.note, 'for the shop'); assert.equal(shop.pinned, true)
  assert.equal(v.cards.length, 0) // deleted later on the tablet
  assert.deepEqual(v.addresses[0].fields, { email: 'ana@example.org', name: 'Ana Example', 'street-address': '12/3 Example Street\nFlat 4' })
  // this computer's own file, which the phone opens with its device name bound in
  const mine = fs.readFileSync(path.join(root, 'Passwords', 'PC-000000.enc'), 'utf8')
  assert.ok(pw.sameSet(pw.decrypt(key, r, 'PC-000000', mine), m.all))
  assert.equal(pw.decrypt(key, r, 'Pixel 9-abc123', mine), null)
  assert.equal(pw.decrypt(key, r, 'PC-000000', mine, '2fa'), null) // a passwords file does not open as 2FA
  for (const plain of ['Pa/ss', 'maria', 'example.org', '4111', 'Example Street', 'second-pw', PHRASE]) assert.ok(!mine.includes(plain), plain)
  // nothing to change: not written again
  const at = fs.statSync(path.join(root, 'Passwords', 'PC-000000.enc')).mtimeMs
  pw.merged(root, 'passwords', 'PC-000000', key, r, m.all, 11_000)
  assert.equal(fs.statSync(path.join(root, 'Passwords', 'PC-000000.enc')).mtimeMs, at)
})

test('values made here are the very strings the phone makes', () => {
  assert.deepEqual(pw.keyed('passwords', { host: 'example.org', user: 'maria', password: 'Pa/ss"w0rd\\x' }), ['l|example.org|maria', expected.login1])
  assert.deepEqual(pw.keyed('passwords', { host: 'https://shop.example.com/login', user: 'ana@example.org', password: 'second-pw', note: 'for the shop', pinned: true })[1], expected.login2)
  assert.deepEqual(pw.keyed('passwords', { name: 'ANA EXAMPLE', number: '4111 1111 1111 1111', month: '01', year: '30' }), ['c|4111111111111111', expected.card])
  assert.deepEqual(pw.keyed('passwords', { fields: { name: 'Ana Example', 'street-address': '12/3 Example Street\nFlat 4', email: 'ana@example.org', tel: ' ' } }), ['a|' + expected.address, expected.address])
  assert.deepEqual(pw.keyed('2fa', { issuer: 'Example', account: 'ana@example.org', secret: 'gezd gnbv gy3t qojq gezd gnbv gy3t qojq', pinned: true }),
    ['example|ana@example.org|GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', expected.code])
  // only "/" differs from JSON.stringify
  for (const s of ['plain', 'tab\tand\u0001', 'Ελληνικά ✓', 'a"b\\c']) assert.equal(pw.jstr(s), JSON.stringify(s))
})

test('changes here: recorded against the base, deleted as a tombstone the phone reads', async () => {
  const root = copy(), keep = keepIn()
  const p = new pw.Passwords({ root, device: 'PC-000000', keep, user: 'nobody' })
  assert.deepEqual(p.status(), { recipe: true, kept: false, need: true, open: false })
  assert.throws(() => p.list(), /Locked/)
  await assert.rejects(p.setPassphrase('wrong one!'), pw.WrongPassphrase)
  await p.setPassphrase(PHRASE)
  assert.equal(p.status().open, true)
  let l = p.list()
  assert.equal(l.logins.length, 3); assert.equal(l.codes.length, 1); assert.equal(l.devices, 2)
  const maria = l.logins.find(x => x.user === 'maria')
  l = p.change('passwords', maria.key, { ...maria, password: 'new one' })
  l = p.change('passwords', l.logins.find(x => x.host === 'old.example.net').key, null)
  l = p.change('passwords', null, { name: 'MARIA', number: '5500 0000 0000 0004', month: '12', year: '31' })
  assert.equal(l.logins.find(x => x.user === 'maria').password, 'new one')
  assert.equal(l.logins.length, 2); assert.equal(l.cards[0].number, '5500000000000004')
  // the phone reads this computer's file: the change newer than its own, the deletion a tombstone
  const r = pw.recipe(root), key = await pw.unlock(PHRASE, r)
  const phone = pw.merged(root, 'passwords', 'Pixel 9-abc123', key, r, null, Date.now() + 1000)
  const v = pw.vault(pw.live(phone.all))
  assert.equal(v.logins.find(x => x.user === 'maria').password, 'new one')
  assert.ok(!v.logins.some(x => x.host === 'old.example.net'))
  assert.equal(phone.all['l|old.example.net|x'].gone, true)
  // the base and the key live in the app's storage (keep), never in the shared folder
  assert.ok(keep.m.has('base:passwords') && keep.m.has('key'))
  for (const f of fs.readdirSync(path.join(root, 'Passwords'))) assert.ok(!fs.readFileSync(path.join(root, 'Passwords', f), 'utf8').includes('new one'))
  // 2FA: edited, pinned off
  const c = l.codes[0]
  l = p.change('2fa', c.key, { ...c, pinned: false })
  assert.equal(l.codes[0].pinned, false)
  assert.match(p.codes()[0].code, /^\d{6}$/)
  // locked: nothing read; opened again with the passphrase (or the computer's password)
  p.lock()
  assert.throws(() => p.list(), /Locked/)
  assert.deepEqual(p.codes(), [])
  await assert.rejects(p.open('wrong'), pw.WrongPassphrase)
  await p.open(PHRASE)
  assert.equal(p.list().logins.length, 2)
  // forgotten: the key and bases go, the files stay
  p.forget()
  assert.equal(keep.m.size, 0)
  assert.ok(fs.existsSync(path.join(root, 'Passwords', 'PC-000000.enc')))
})

test('a first passphrase made here; another passphrase is asked again', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tetra-pw-'))
  const p = new pw.Passwords({ root, device: 'PC', keep: keepIn(), user: 'nobody' })
  assert.deepEqual(p.status(), { recipe: false, kept: false, need: true, open: false })
  await assert.rejects(p.setPassphrase('short'), /short/i)
  await p.setPassphrase('a long enough one')
  assert.ok(fs.existsSync(path.join(root, 'Passwords', 'key.json')))
  p.change('passwords', null, { host: 'a.example', user: 'u', password: 'p' })
  // "forgot it" on the phone: a new key.json made later; this computer is asked again
  const { recipe: r2 } = await pw.create('the new passphrase', Date.now() + 1000)
  fs.writeFileSync(path.join(root, 'Passwords', 'key (2).json'), pw.recipeJson(r2))
  assert.equal(p.status().need, true); assert.equal(p.status().open, false)
  await p.setPassphrase('the new passphrase')
  assert.equal(p.list().logins[0].host, 'a.example') // its own base merged again under the new key
})

test('a changed file is refused', async () => {
  const r = pw.recipe(FIX), key = await pw.unlock(PHRASE, r)
  const o = JSON.parse(fs.readFileSync(path.join(FIX, 'Passwords', 'Pixel 9-abc123.enc'), 'utf8'))
  assert.ok(pw.decrypt(key, r, 'Pixel 9-abc123', JSON.stringify(o)))
  const d = Buffer.from(o.data, 'base64'); d[d.length >> 1] ^= 1; o.data = d.toString('base64')
  assert.equal(pw.decrypt(key, r, 'Pixel 9-abc123', JSON.stringify(o)), null)
})

test('merge, record and prune as SecretSet', () => {
  const a = pw.record({}, { x: '1' }, 1), b = pw.record(a, {}, 2)
  assert.equal(b.x.gone, true)
  assert.deepEqual(pw.pruned(b, 2 + 31 * 86_400_000), {})
  assert.deepEqual(pw.merge({ x: { v: '1', at: 5, gone: true } }, { x: { v: '1', at: 5 } }).x, { v: '1', at: 5 })
  assert.deepEqual(pw.merge({ x: { v: 'a', at: 5 } }, { x: { v: 'b', at: 5 } }).x.v, 'b')
  assert.ok(pw.sameSet(pw.parseSet(pw.setJson(b)), b))
})

test('TOTP against RFC 6238, and otpauth:// links', () => {
  const e = (seed, algorithm) => ({ secret: seedB32(seed), algorithm, digits: 8, period: 30 })
  const seedB32 = s => { let bits = '', out = ''; for (const b of Buffer.from(s)) bits += b.toString(2).padStart(8, '0'); for (let i = 0; i < bits.length; i += 5) out += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]; return out }
  const keys = [e('12345678901234567890', 'SHA1'), e('12345678901234567890123456789012', 'SHA256'), e('1234567890123456789012345678901234567890123456789012345678901234', 'SHA512')]
  for (const [t, want] of [[59, ['94287082', '46119246', '90693936']], [1111111109, ['07081804', '68084774', '25091201']], [1234567890, ['89005924', '91819424', '93441116']], [20000000000, ['65353130', '77737706', '47863826']]])
    assert.deepEqual(keys.map(k => pw.totp(k, t * 1000)), want, String(t))
  assert.equal(pw.totp({ ...keys[0], digits: 6 }, 59_000), '287082')
  assert.equal(pw.base32('ABC1'), null)
  assert.deepEqual(pw.otpauth('otpauth://totp/ACME%20Co:jo%40example.org?secret=HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ&issuer=ACME%20Co&algorithm=SHA256&digits=8&period=60'),
    { issuer: 'ACME Co', account: 'jo@example.org', secret: 'HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ', algorithm: 'SHA256', digits: 8, period: 60 })
  assert.deepEqual(pw.otpauth('otpauth://totp/Gitea:maria?secret=jbsw%20y3dp%20ehpk%203pxp'), { issuer: 'Gitea', account: 'maria', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30 })
  assert.equal(pw.otpauth('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=1'), null)
  assert.equal(pw.otpauth('otpauth://totp/x?secret=1111'), null)
})

test("the computer's password: a wrong one refused", async () => {
  assert.equal(await pw.systemPassword(os.userInfo().username, 'certainly-not-the-password-' + Math.random()), false)
  assert.equal(await pw.systemPassword(os.userInfo().username, ''), false)
})
