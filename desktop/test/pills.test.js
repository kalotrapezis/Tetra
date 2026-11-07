'use strict'
// Pills (pills.js): the derivation every device does the same way (PILLS_FORMAT; the phone's PillsTest).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const P = require('../pills')

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime() // local, as the doses are
const med = (o = {}) => P.parse(JSON.stringify({ id: 'pill-aaaa1111', name: 'Lipitor', strength: '20 mg', dose: 1, times: ['21:00'], days: [], every: 1,
  since: new Date(at(2026, 11, 1, 8)).toISOString(), perBox: 30, refillDays: 7, refillTimes: 3, rev: 1, ...o }))
const ev = (kind, when, o = {}) => ({ at: when, med: 'pill-aaaa1111', kind, due: null, amount: 0, stock: 0, note: '', ...o })
const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pills-'))

test('the highest rev wins; equal revs: deleted, then the shorter file name; deleted ones are not shown', () => {
  const a = { ...med({ rev: 2, name: 'A' }), file: '/x/pill-aaaa1111.Phone.json' }
  const b = { ...med({ rev: 3, name: 'B' }), file: '/x/pill-aaaa1111.Computer.json' }
  assert.equal(P.winners([a, b])[0].name, 'B')
  const c = { ...med({ rev: 3, name: 'C', deleted: true }), file: '/x/pill-aaaa1111.Tablet.json' }
  assert.equal(P.winners([a, b, c])[0].name, 'C')
  const d = { ...med({ rev: 3, name: 'D' }), file: '/x/pill-aaaa1111.Computer (2).json' }
  assert.equal(P.winners([d, b])[0].name, 'B')
  assert.equal(med({ rev: undefined }).rev, 0) // an older file without rev
  assert.equal(med({ dose: undefined }).dose, 1)

  const dir = folder(), pc = new P.Pills(dir, 'My PC!')
  fs.writeFileSync(path.join(dir, 'pill-aaaa1111.24129PN74G.json'), JSON.stringify({ ...med({ rev: 4 }), stock: 99, counted: true }))
  const saved = pc.save({ ...pc.medicines()[0], name: 'Lipitor forte' })
  assert.equal(saved.rev, 5)
  assert.equal(path.basename(saved.file), 'pill-aaaa1111.MyPC.json')
  assert.equal(JSON.parse(fs.readFileSync(saved.file, 'utf8')).by, 'My PC!')
  assert.equal(pc.medicines()[0].name, 'Lipitor forte')
  pc.remove('pill-aaaa1111')
  assert.deepEqual(pc.medicines(), [])
  assert.equal(pc.all()[0].rev, 6)
  assert.ok(fs.existsSync(path.join(dir, 'pill-aaaa1111.24129PN74G.json'))) // never removed
})

test('the logs merged: every device\'s, by time, an identical line once', () => {
  const l1 = '{"at":"2026-11-07T19:03:11Z","med":"pill-a","kind":"taken","due":"2026-11-07T19:00:00Z","amount":1,"stock":0}\n'
  const l2 = '{"at":"2026-11-07T08:00:00Z","med":"pill-a","kind":"stock","due":null,"amount":30,"stock":30}\nnot json\n'
  const log = P.mergeLogs([l1, l2, l1])
  assert.deepEqual(log.map(e => e.kind), ['stock', 'taken'])

  const dir = folder()
  fs.writeFileSync(path.join(dir, 'log.24129PN74G.jsonl'), l1)
  fs.writeFileSync(path.join(dir, 'log.24129PN74G (2).jsonl'), l1 + l2)
  fs.writeFileSync(path.join(dir, 'notes.txt'), l2)
  assert.equal(new P.Pills(dir).log().length, 2)
})

test('the stock: boxes added, doses taken, undo and skip give back, taken on two devices once, a count after a take', () => {
  const due1 = at(2026, 11, 2, 21), due2 = at(2026, 11, 3, 21)
  const box = ev('stock', at(2026, 11, 1, 9), { amount: 30 })
  assert.equal(P.stockOf('pill-aaaa1111', []).counted, false)
  assert.deepEqual(P.stockOf('pill-aaaa1111', [box]), { stock: 30, counted: true })
  const twice = [box, ev('taken', due1 + 60_000, { due: due1, amount: 1 }), ev('taken', due1 + 120_000, { due: due1, amount: 1 })] // the phone and the computer
  assert.equal(P.stockOf('pill-aaaa1111', twice).stock, 29)
  assert.equal(P.stockOf('pill-aaaa1111', [...twice, ev('undo', due1 + 180_000, { due: due1 })]).stock, 30)
  assert.equal(P.stockOf('pill-aaaa1111', [...twice, ev('skipped', due1 + 180_000, { due: due1 })]).stock, 30)
  assert.equal(P.stockOf('pill-aaaa1111', [...twice, ev('taken', at(2026, 11, 2, 12), { amount: 0.5 })]).stock, 28.5) // an extra one
  // counted after the take: the take is in the count; one after the count comes off it
  const counted = [...twice, ev('stock', at(2026, 11, 3, 8), { note: 'count', stock: 20, amount: -9 })]
  assert.equal(P.stockOf('pill-aaaa1111', counted).stock, 20)
  assert.equal(P.stockOf('pill-aaaa1111', [...counted, ev('taken', due2, { due: due2, amount: 1 }), ev('stock', due2 + 1, { amount: 30 })]).stock, 49)
  assert.equal(P.stockOf('pill-aaaa1111', [ev('taken', due1, { due: due1, amount: 2 })]).stock, 0) // never below 0

  const m = P.derive(med({ times: ['08:00', '21:00'] }), [box], at(2026, 11, 3))
  assert.equal(m.daysLeft, 15)
  assert.equal(m.low, false)
  assert.equal(P.derive(med({ times: ['08:00', '21:00'], refillDays: 15 }), [box]).low, true)
  assert.equal(P.derive(med({ every: 3 }), [box]).daysLeft, 90)
  assert.equal(P.derive(med({ days: ['MO', 'TH'] }), [box]).daysLeft, 105)
})

test('this computer\'s actions write its own log; Taken twice counts once; Correct the count; a box', () => {
  const dir = folder(), pc = new P.Pills(dir, 'Computer')
  fs.writeFileSync(path.join(dir, 'pill-aaaa1111.Phone.json'), JSON.stringify(med()))
  const due = at(2026, 11, 2, 21)
  pc.addStock('pill-aaaa1111', 1, 0, null, at(2026, 11, 2, 8))
  pc.take('pill-aaaa1111', due, due + 60_000)
  assert.equal(pc.take('pill-aaaa1111', due, due + 90_000).stock, 29)
  assert.equal(pc.log().filter(e => e.kind === 'taken').length, 1)
  assert.equal(pc.undo('pill-aaaa1111', due, due + 120_000).stock, 30)
  assert.equal(pc.setStock('pill-aaaa1111', 12.4, due + 180_000).stock, 12.5)
  assert.equal(pc.addStock('pill-aaaa1111', 2, 0, 28, due + 240_000).stock, 68.5)
  assert.equal(pc.medicines()[0].perBox, 28)
  assert.deepEqual(fs.readdirSync(dir).sort(), ['log.Computer.jsonl', 'pill-aaaa1111.Computer.json', 'pill-aaaa1111.Phone.json'])
  const line = JSON.parse(fs.readFileSync(path.join(dir, 'log.Computer.jsonl'), 'utf8').split('\n').find(l => l.includes('count')))
  assert.deepEqual(line, { at: new Date(due + 180_000).toISOString().replace('.000Z', 'Z'), med: 'pill-aaaa1111', kind: 'stock', due: null, amount: -17.5, stock: 12.5, note: 'count' })
})

test('the doses: every day, some days, every N days from since, until, nothing before since, missed after 90 min', () => {
  const now = at(2026, 11, 10, 12)
  const week = (m, log = []) => P.doses([m], log, at(2026, 11, 1), at(2026, 11, 15), now)
  const daily = med({ since: new Date(at(2026, 11, 1, 22)).toISOString() })
  assert.equal(week(daily)[0].due, at(2026, 11, 2, 21)) // 1 Nov's 21:00 was before it was added
  assert.equal(week(daily).length, 13)
  assert.deepEqual(week(med({ days: ['MO', 'WE'] })).map(d => new Date(d.due).getDate()), [2, 4, 9, 11]) // 2 Nov 2026 is a Monday
  assert.deepEqual(week(med({ every: 3 })).map(d => new Date(d.due).getDate()), [1, 4, 7, 10, 13])
  assert.deepEqual(week(med({ until: '2026-11-03' })).map(d => new Date(d.due).getDate()), [1, 2, 3])
  assert.equal(week(med({ archived: true })).length, 0)

  const due = at(2026, 11, 10, 9)
  const m = med({ times: ['09:00'] })
  assert.equal(P.doses([m], [], due, due + 1, due + 90 * 60_000)[0].state, 'waiting')
  assert.equal(P.doses([m], [], due, due + 1, due + 91 * 60_000)[0].state, 'missed')
  const taken = [ev('taken', due + 5 * 60_000, { due, amount: 1 })]
  assert.deepEqual(P.doses([m], taken, due, due + 1, now).map(d => [d.state, d.at]), [['taken', due + 5 * 60_000]])
  assert.equal(P.doses([m], [...taken, ev('undo', due + 6 * 60_000, { due })], due, due + 1, now)[0].state, 'missed')
})

test('today: its doses, after yesterday\'s still open; the parts of the day; the reminders at 0, +30, +60', () => {
  const m = med({ times: ['08:00', '21:00'] })
  const now = at(2026, 11, 10, 8, 40)
  const log = [ev('taken', at(2026, 11, 9, 8, 5), { due: at(2026, 11, 9, 8), amount: 1 })]
  const list = P.today([m], log, now)
  assert.deepEqual(list.map(d => [new Date(d.due).getDate(), P.clock(d.due), d.state]), [[9, '21:00', 'missed'], [10, '08:00', 'waiting'], [10, '21:00', 'waiting']])
  assert.deepEqual(['04:00', '10:59', '11:00', '17:00', '22:00', '03:59'].map(P.part), [0, 0, 1, 2, 3, 3])

  assert.deepEqual(P.rings([m], log, now).map(r => [P.clock(r.due), r.step]), [['08:00', 1]])
  assert.equal(P.nextRing([m], log, now), at(2026, 11, 10, 9))
  assert.equal(P.nextRing([m], [...log, ev('taken', now, { due: at(2026, 11, 10, 8), amount: 1 })], now), at(2026, 11, 10, 21))
})

test('progress: taken late more often than not, the reminder moved to the median time; forgotten in the evening, the bedside', () => {
  const now = at(2026, 11, 30, 23)
  const m = med({ since: new Date(at(2026, 11, 1)).toISOString() })
  const log = []
  for (let d = 10; d <= 29; d++) log.push(ev('taken', at(2026, 11, d, 22, d % 2 ? 10 : 25), { due: at(2026, 11, d, 21), amount: 1 })) // 22:10 and 22:25: the median 22:25, to 15 min
  const s = P.slots([m], log, now)
  assert.equal(s.length, 1)
  assert.equal(s[0].late, 20)
  const a = P.advice(s)
  assert.deepEqual(a.map(x => [x.kind, x.time]), [['move', '22:30']])

  const forgot = P.advice(P.slots([m], [], now))
  assert.deepEqual(forgot.map(x => x.kind), ['bedside'])
  assert.deepEqual(P.advice(P.slots([med({ times: ['09:00'], since: new Date(at(2026, 11, 1)).toISOString() })], [], now)).map(x => [x.kind, x.time]), [['earlier', '08:30']])
})

test('a name said finds its medicine; the strength tells two apart', () => {
  const meds = [med({ id: 'pill-1', name: 'Depon', strength: '500 mg' }), med({ id: 'pill-2', name: 'Depon', strength: '1000 mg' }), med({ id: 'pill-3', name: 'Λιπιτόρ' })]
  assert.deepEqual(P.find(meds, 'depon', '500').map(m => m.id), ['pill-1'])
  assert.equal(P.find(meds, 'Depon').length, 2)
  assert.deepEqual(P.find(meds, 'λιπιτορ').map(m => m.id), ['pill-3'])
})

test('AI Assist\'s pills_save, pills_taken and pills_list, as the phone\'s', async () => {
  const { Tools } = require('../assistant')
  const now = at(2026, 11, 10, 21, 10), pills = new P.Pills(folder(), 'PC')
  const told = [], tools = new Tools({ pills, now: () => now, changed: w => told.push(w) })
  assert.match((await tools.run('pills_save', { name: 'lipitor', strength: '20 mg', boxes: 2 })).forModel, /does not know how many pills a box holds/)
  assert.match((await tools.run('pills_save', { name: 'Lipitor', boxes: 2, per_box: 30, times: ['21:00'] })).forModel, /^Saved\. Lipitor 20 mg: 1 pill\(s\) at 21:00; stock 60 \(boxes of 30\)/)
  pills.save({ ...pills.medicines()[0], since: at(2026, 11, 1) })
  assert.match((await tools.run('pills_taken', {})).forModel, /^Marked taken: Lipitor 20 mg of 21:00, stock 59/)
  assert.equal((await tools.run('pills_taken', {})).forModel, 'No dose is waiting now.')
  assert.match((await tools.run('pills_list', {})).forModel, /21:00 Lipitor 20 mg: taken/)
  assert.ok(told.includes('pills'))
  assert.match((await new Tools({ pills, allowed: a => a !== 'pills' }).run('pills_list', {})).forModel, /switched AI Assist off for pills/)
})
