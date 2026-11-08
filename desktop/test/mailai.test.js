'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Mail } = require('../mail')
const { Calendar } = require('../calendar')
const { Mistral, Tools, MAIL_REPORT, SCHEMA } = require('../assistant')
const { MailAi, readLines } = require('../mailai')
const { memoryServer, message } = require('./mailfake')

/** Mistral's answers in order, each a JSON object the model "wrote"; [seen] gets each request's body. */
const fakeFetch = (answers, seen) => async (url, init) => {
  seen.push(JSON.parse(init.body))
  const a = answers.shift()
  if (a.status) return { ok: false, status: a.status, text: async () => '' }
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(a) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) }
}

async function setup(answers, { allowed = true, runs = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailai-'))
  const day = n => new Date(Date.now() - n * 86_400_000)
  const folders = {
    INBOX: { validity: 7, next: 5, msgs: {
      1: message('Συνάντηση συλλόγου', 'a', { date: day(0), body: 'Συνάντηση την Τρίτη 10 Νοεμβρίου στις 13:00 στο γραφείο.', from: { name: 'Διεύθυνση', address: 'school@sch.gr' } }),
      2: message('Newsletter', 'b', { date: day(0.01), body: 'Νέα παπούτσια!', from: { name: 'Shop', address: 'news@shop.gr' } }),
      3: message('Παλιό', 'c', { date: day(10), from: { name: 'Νίκος', address: 'nikos@x.gr' } }),
      4: message('Διαβασμένο', 'd', { date: day(0), from: { name: 'Μαρία', address: 'maria@x.gr' } }) } },
    Sent: { use: '\\Sent', validity: 9, next: 4, msgs: Object.fromEntries([1, 2, 3].map(i => [i, message(`Re: ${i}`, `s${i}`, { date: day(i), body: `Καλησπέρα σας,\n\nευχαριστώ πολύ για το ${i}.\n\nΜε εκτίμηση,\nΘεολόγος`, to: [{ address: 'x@y.gr' }] })])) },
  }
  folders.INBOX.msgs[4].flags.add('\\Seen')
  const c = memoryServer(folders)
  const mail = new Mail(path.join(dir, 'Mail'), { secret: () => 'x', connect: () => c })
  const acc = { id: 'me@sch.gr', address: 'me@sch.gr', server: {} }
  mail.saveAccounts([acc])
  for (const [role, box] of [['Inbox', 'INBOX'], ['Sent', 'Sent']]) { await mail.headers(c, acc, role, box); await mail.bodies(c, acc, role, box, { stop: false }) }
  const calendar = new Calendar(path.join(dir, 'Calendar'), path.join(dir, 'Trash'))
  const seen = [], told = []
  const api = new Mistral({ key: () => 'k', fetch: fakeFetch(answers, seen) })
  const ai = new MailAi({ mail, calendar, api, allowed: () => allowed, runs: () => runs, notify: (e, score) => told.push([e.subject, score]) })
  const inbox = Object.fromEntries(mail.accountsMails().filter(e => e.folder === 'Inbox').map(e => [e.subject, e]))
  return { dir, mail, calendar, ai, seen, told, inbox, done: () => { mail.index.flush(); fs.rmSync(dir, { recursive: true, force: true }) } }
}

const SCORED = { mails: [
  { n: 1, score: 3, why: 'Συνάντηση την Τρίτη', events: [{ title: 'Σύλλογος διδασκόντων', start: '2026-11-10T13:00', end: null, allDay: false, place: 'Γραφείο' }, { title: 'bad', start: 'next week' }] },
  { n: 2, score: 9, why: 'Διαφήμιση', events: [] }] }
const STYLE = { language: 'el', greeting: 'Καλησπέρα σας,', closing: 'Με εκτίμηση,\nΘεολόγος', tone: 'ευγενικό, σύντομο', phrases: Array.from({ length: 12 }, (_, i) => `φράση ${i}`) }

test('mail AI: new unread Inbox mail scored once in one request, its dates suggested, only ≥2 notified, the style learnt from Sent', async () => {
  const s = await setup([SCORED, STYLE])
  try {
    assert.equal(s.ai.takes(s.inbox['Συνάντηση συλλόγου']), true); s.ai.takes(s.inbox.Newsletter)
    clearTimeout(s.ai.timer)
    await s.ai.run()
    assert.equal(s.seen.length, 2, 'one request for the mail, one for the style')
    assert.equal(s.seen[0].model, 'mistral-small-latest'); assert.deepEqual(s.seen[0].response_format, { type: 'json_object' })
    const asked = s.seen[0].messages[1].content
    assert.match(asked, /Συνάντηση την Τρίτη 10 Νοεμβρίου/, 'the body is sent'); assert.match(asked, /Νέα παπούτσια/)
    assert.doesNotMatch(asked, /Παλιό|Διαβασμένο/, 'old and read mail is left alone')

    const u = readLines(path.join(s.mail.root, 'ai', 'urgency.jsonl'))
    const meet = s.inbox['Συνάντηση συλλόγου'].id
    assert.deepEqual(Object.keys(u.get(meet)).sort(), ['at', 'id', 'score', 'why'])
    assert.equal(u.get(meet).score, 3); assert.equal(u.get(meet).why, 'Συνάντηση την Τρίτη')
    assert.equal(u.get(s.inbox.Newsletter.id).score, 3, 'kept within 0-3')
    assert.deepEqual(s.told, [['Συνάντηση συλλόγου', 3], ['Newsletter', 3]])

    const ev = s.ai.forMail(meet).events
    assert.equal(ev.length, 1, 'a date that is not a date is dropped')
    assert.deepEqual(ev[0], { id: `${meet}#1`, mail: meet, title: 'Σύλλογος διδασκόντων', start: '2026-11-10T13:00', end: null, allDay: false, place: 'Γραφείο', status: 'suggested', at: ev[0].at })
    assert.equal(s.calendar.occurrences(0, 9e12).length, 0, 'nothing in the calendar by itself')
    s.ai.add(ev[0].id)
    const o = s.calendar.occurrences(0, 9e12)
    assert.equal(o.length, 1); assert.equal(o[0].title, 'Σύλλογος διδασκόντων'); assert.equal(o[0].place, 'Γραφείο')
    assert.equal(s.ai.events().get(ev[0].id).status, 'added'); assert.equal(s.ai.forMail(meet).events.length, 0)
    s.ai.add(ev[0].id); assert.equal(s.calendar.occurrences(0, 9e12).length, 1, 'added once')

    const style = JSON.parse(fs.readFileSync(path.join(s.mail.root, 'ai', 'style.json'), 'utf8'))
    assert.deepEqual(Object.keys(style), ['me@sch.gr'])
    assert.equal(style['me@sch.gr'].greeting, 'Καλησπέρα σας,'); assert.equal(style['me@sch.gr'].phrases.length, 10)
    assert.match(s.seen[1].messages[1].content, /ευχαριστώ πολύ/)

    await s.ai.run()
    assert.equal(s.seen.length, 2, 'each mail once, the style weekly: nothing asked again')

    const tools = new Tools({ mail: s.mail })
    const urgent = (await tools.run('mail_urgent', {})).forModel
    assert.match(urgent, /^1\. .*Συνάντηση συλλόγου.*\{urgency 3: Συνάντηση την Τρίτη\}/)
    assert.ok(MAIL_REPORT.includes('mail_urgent') && SCHEMA.some(x => x.function.name === 'mail_urgent'))
  } finally { s.done() }
})

test('mail AI: a low score is not notified, a failure notifies as before and is not asked again, a dismissal is kept', async () => {
  const s = await setup([{ status: 500 }, STYLE, { mails: [{ n: 1, score: 1, why: 'Ενημέρωση', events: [{ title: 'Προθεσμία', start: '2026-11-15', end: '2026-11-14', allDay: true, place: null }] }, { n: 2, score: 0, why: '' }] }]) // the style is asked after the failed batch
  try {
    s.ai.takes(s.inbox.Newsletter); clearTimeout(s.ai.timer)
    await s.ai.run()
    assert.deepEqual(s.told, [['Newsletter', null]], 'not scored: said the plain way')
    assert.equal(s.ai.scores().size, 0)
    s.ai.failed.clear() // Tetra started again
    s.ai.takes(s.inbox.Newsletter); clearTimeout(s.ai.timer)
    await s.ai.run()
    assert.deepEqual(s.told, [['Newsletter', null]], 'score 0: no notification')
    const meet = s.inbox['Συνάντηση συλλόγου'].id, [x] = s.ai.forMail(meet).events
    assert.equal(x.start, '2026-11-15'); assert.equal(x.end, null, 'an end before the start is dropped'); assert.equal(x.allDay, true)
    s.ai.dismiss(x.id)
    assert.equal(s.ai.events().get(x.id).status, 'dismissed'); assert.equal(s.ai.forMail(meet).events.length, 0)
    assert.deepEqual(s.ai.tiers(), { [meet]: 1, [s.inbox.Newsletter.id]: 0 })
  } finally { s.done() }
})

test('mail AI: nothing is sent when the AI or Mail AI is off, or on a computer that is not the runner', async () => {
  for (const o of [{ allowed: false }, { runs: false }]) {
    const s = await setup([], o)
    try {
      assert.equal(s.ai.takes(s.inbox.Newsletter), false, 'mail.js notifies as before')
      await s.ai.run()
      assert.equal(s.seen.length, 0)
      assert.ok(!fs.existsSync(path.join(s.mail.root, 'ai')))
    } finally { s.done() }
  }
})
