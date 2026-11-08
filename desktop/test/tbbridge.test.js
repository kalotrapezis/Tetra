'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Mail } = require('../mail')
const tbbridge = require('../tbbridge')
const { raw } = require('./mailfake')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tb-'))
const UNI = 't@nup.ac.cy'
/** The fixture's mail with a Message-ID (and any more headers), as Thunderbird hands it over. */
const tbMail = (subject, id, more = '') => Buffer.concat([Buffer.from(`Message-ID: <${id}@nup.ac.cy>\r\n${more}`), raw(subject, { attach: true })])

function bridged() {
  const mail = new Mail(tmp(), { secret: () => null, connect: () => { throw new Error('no IMAP for a Thunderbird account') } })
  const acc = mail.add({ address: UNI, name: 'NUP', auth: 'thunderbird' })
  return { mail, acc }
}

test('tbbridge: a Thunderbird account has no server of its own, nothing cleaned there, and no fetching loop', () => {
  const { mail, acc } = bridged()
  assert.equal(acc.server, null); assert.equal(acc.smtp, null); assert.equal(acc.serverClean.on, false)
  assert.equal(mail.live.size, 0)
  return assert.rejects(mail.withClient(acc, async () => {}), { reason: 'thunderbird' })
})

test('tbbridge: a mail from Thunderbird is written once, green, its attachment beside it; read and ♥ follow Thunderbird only when they changed there', async () => {
  const { mail, acc } = bridged()
  const news = []
  mail.on('new', e => news.push(e.subject))
  const first = await mail.fromThunderbird(acc, { folder: 'Inbox', raw: tbMail('Προθεσμία εργασίας', 'a1'), fresh: true })
  assert.equal(first.known, false)
  const e = mail.index.get(first.id)
  assert.equal(e.saved, true); assert.equal(e.subject, 'Προθεσμία εργασίας'); assert.equal(e.fromAddress, 'secretariat@nup.ac.cy')
  assert.ok(fs.existsSync(path.join(mail.root, e.file.slice(0, -4) + '.files', 'Guide.pdf')))
  assert.deepEqual(news, ['Προθεσμία εργασίας'])
  assert.deepEqual(mail.thunderbirdKnown(acc, 'Inbox'), ['a1@nup.ac.cy'])

  await mail.act({ op: 'read', ids: [first.id] }) // read in Tetra: kept here
  assert.equal(mail.index.get(first.id).seen, true)
  assert.equal((await mail.fromThunderbird(acc, { folder: 'Inbox', raw: tbMail('Προθεσμία εργασίας', 'a1'), seen: false })).known, true)
  assert.equal(mail.index.get(first.id).seen, true, 'a later pass does not make it unread again')
  await mail.fromThunderbird(acc, { folder: 'Inbox', raw: tbMail('Προθεσμία εργασίας', 'a1'), seen: false, flagged: true, update: true })
  assert.equal(mail.index.get(first.id).flagged, true, 'changed in Thunderbird: taken')
  await assert.rejects(mail.act({ op: 'archive', ids: [first.id] }), { reason: 'thunderbird' })
  await assert.rejects(mail.fromThunderbird(acc, { folder: 'Trash', raw: tbMail('x', 'a2') }))
})

test('tbbridge: Tetra sends through Thunderbird, once; Thunderbird\'s Sent copy takes the place of Tetra\'s', async () => {
  const { mail, acc } = bridged()
  const file = path.join(tmp(), 'Σημειώσεις.txt')
  fs.writeFileSync(file, 'notes')
  mail.picked = new Set([file]) // a file chosen here to attach, as main.js keeps them
  const sending = mail.send({ account: UNI, to: [{ name: 'Γραμματεία', address: 'secretariat@nup.ac.cy' }], subject: 'Ερώτηση', html: '<p>Καλημέρα</p>', attachments: [{ name: 'Σημειώσεις.txt', path: file, type: 'text/plain' }] })
  await new Promise(r => setImmediate(r)); await new Promise(r => setTimeout(r, 50))
  const [job, ...more] = mail.thunderbirdTake()
  assert.equal(more.length, 0)
  assert.equal(job.account, UNI); assert.equal(job.subject, 'Ερώτηση'); assert.equal(job.to[0].address, 'secretariat@nup.ac.cy')
  assert.equal(Buffer.from(job.attachments[0].data, 'base64').toString(), 'notes')
  assert.deepEqual(mail.thunderbirdTake(), [], 'handed over once')
  assert.equal(mail.thunderbirdDone(job.id), true)
  await sending
  const local = [...mail.index.all()].find(e => e.folder === 'Sent' && e.uidValidity === 'local')
  assert.ok(local && !local.gone)
  const theirs = await mail.fromThunderbird(acc, { folder: 'Sent', raw: tbMail('Ερώτηση', 'tb-own', `X-Tetra-Id: ${job.id}\r\n`), seen: true })
  assert.equal(mail.index.get(local.id).gone, true); assert.equal(mail.index.get(local.id).movedTo, theirs.id)
  assert.equal([...mail.index.all()].filter(e => e.folder === 'Sent' && !e.gone).length, 1)
})

test('tbbridge: not picked up in time (Thunderbird closed), the mail is taken back and fails; an error from Thunderbird fails it too', async () => {
  const { mail, acc } = bridged()
  await assert.rejects(mail.toThunderbird(acc, { messageId: '<m1@x>', to: [] }, { wait: 30 }), { reason: 'thunderbird' })
  assert.deepEqual(mail.thunderbirdTake(), [], 'nothing left to go out later')
  const p = mail.toThunderbird(acc, { messageId: '<m2@x>', to: [] })
  assert.equal(mail.thunderbirdTake().length, 1)
  mail.thunderbirdDone('<m2@x>', 'SMTP said no')
  await assert.rejects(p, /SMTP said no/)
})

test('tbbridge: the door — pairing asks the user, every other call needs the token, an account Tetra fetches itself is never taken over', async () => {
  const mail = new Mail(tmp(), { secret: () => 'x', connect: () => { throw new Error('offline') } })
  mail.saveAccounts([{ id: 'me@gmail.com', address: 'me@gmail.com', auth: 'password', server: { host: 'imap.gmail.com' } }])
  let saved = null, yes = false
  const server = await tbbridge.start(mail, { token: () => saved, save: t => { saved = t }, ask: async () => yes, port: 0 })
  const base = `http://127.0.0.1:${server.address().port}`
  const call = (route, { method = 'GET', body, token } = {}) => fetch(base + route, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) })
  try {
    assert.equal((await call('/tb/pair', { method: 'POST' })).status, 403)
    assert.equal(saved, null)
    yes = true
    const { token } = await (await call('/tb/pair', { method: 'POST' })).json()
    assert.equal(token, saved)
    assert.equal((await call('/tb/hello')).status, 401)
    assert.equal((await call('/tb/hello', { token: 'x'.repeat(token.length) })).status, 401)
    assert.equal((await call('/tb/account', { method: 'POST', token, body: { address: 'me@gmail.com' } })).status, 409)
    assert.equal((await call('/tb/account', { method: 'POST', token, body: { address: UNI, name: 'NUP' } })).status, 200)
    assert.deepEqual((await (await call('/tb/hello', { token })).json()).accounts, [UNI])
    const put = await call('/tb/mail', { method: 'POST', token, body: { account: UNI, folder: 'Inbox', raw: tbMail('Ανακοίνωση', 'b1').toString('base64') } })
    assert.equal((await put.json()).known, false)
    assert.deepEqual((await (await call(`/tb/known?account=${UNI}&folder=Inbox`, { token })).json()).ids, ['b1@nup.ac.cy'])
    assert.equal((await call('/tb/known?account=me@gmail.com&folder=Inbox', { token })).status, 404)
    const sending = mail.toThunderbird(mail.account(UNI), { messageId: '<s1@x>', to: [{ address: 'a@b.c' }], subject: 'Γεια' })
    const { mails } = await (await call('/tb/outbox', { token })).json()
    assert.equal(mails[0].subject, 'Γεια')
    assert.equal((await (await call('/tb/sent', { method: 'POST', token, body: { id: '<s1@x>' } })).json()).ok, true)
    await sending
  } finally { server.close() }
})
