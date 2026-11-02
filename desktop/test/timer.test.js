'use strict'
// The same cases as the phone's TimerTest (Drive-Android), so the two engines agree.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Timers, parse, leftMs, UNANSWERED_MS } = require('../timer')

const t0 = Date.parse('2026-10-18T16:00:00Z')
function pair() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'timer-'))
  return [new Timers(path.join(tmp, 'tablet', 'Timer'), 'Tablet'), new Timers(path.join(tmp, 'computer', 'Timer'), 'Computer')]
}
/** What sync does with a changed file: the other side's copy replaced. */
function carry(from, to) {
  fs.mkdirSync(to.root, { recursive: true })
  for (const n of fs.readdirSync(from.root).filter(n => n.endsWith('.json'))) fs.copyFileSync(path.join(from.root, n), path.join(to.root, n))
}

test('time left counts down to the end, rings, and is over unanswered after ten minutes', () => {
  const [tablet] = pair()
  const r = tablet.start(300, t0)
  assert.equal(leftMs(r, t0), 300_000)
  assert.equal(tablet.active(t0 + 100_000)[0].leftMs, 200_000)
  assert.equal(tablet.active(t0 + 299_000)[0].ringing, false)
  assert.equal(tablet.active(t0 + 300_000)[0].ringing, true)
  assert.equal(tablet.active(t0 + 300_000 + UNANSWERED_MS + 1).length, 0)
  assert.equal(tablet.nextEnd(t0), t0 + 300_000)
})

test('pause keeps what is left; resume counts from then', () => {
  const [tablet] = pair()
  const { id } = tablet.start(300, t0)
  assert.ok(tablet.change(id, 'pause', t0 + 100_000))
  assert.equal(tablet.active(t0 + 5_000_000)[0].leftMs, 200_000)
  assert.equal(tablet.change(id, 'pause', t0), false) // already paused
  assert.ok(tablet.change(id, 'resume', t0 + 1_000_000))
  const r = tablet.read()[0]
  assert.equal(r.ends, t0 + 1_200_000)
  assert.equal(r.rev, 3)
})

test('OK on one device stops the ringing on the others', () => {
  const [tablet, computer] = pair()
  const { id } = tablet.start(600, t0)
  carry(tablet, computer)
  assert.equal(tablet.active(t0 + 600_000)[0].ringing, true) // both ring at the end
  assert.ok(computer.change(id, 'ok', t0 + 600_000))
  // written in the computer's own file; the tablet's is left as it was
  assert.deepEqual(fs.readdirSync(computer.root).sort(), [`${id}.Computer.json`, `${id}.Tablet.json`])
  carry(computer, tablet)
  assert.equal(tablet.active(t0 + 605_000).length, 0)
})

test('two changes at once make no copies, and stopping wins', () => {
  const [tablet, computer] = pair()
  const { id } = tablet.start(600, t0)
  carry(tablet, computer)
  tablet.change(id, 'pause', t0 + 10_000)
  computer.change(id, 'stop', t0 + 10_000)
  carry(tablet, computer); carry(computer, tablet) // each changed only its own file: nothing kept twice
  for (const d of [tablet, computer]) { assert.equal(fs.readdirSync(d.root).length, 2); assert.equal(d.active(t0 + 20_000).length, 0) }
  // a copy left by the old one-file-per-timer sync ("x (2).json") still reads as the same timer
  fs.copyFileSync(path.join(computer.root, `${id}.Tablet.json`), path.join(computer.root, `${id}.Tablet (2).json`))
  assert.equal(computer.active(t0 + 20_000).length, 0)
  const r = computer.read()[0]
  computer.write({ ...r, state: 'running', ends: t0 + 900_000, rev: r.rev + 1, by: 'Phone' })
  assert.equal(computer.active(t0 + 20_000)[0].state, 'running')
})

test('clocks a few seconds apart show the same time left within the gap', () => {
  const [tablet, computer] = pair()
  const skew = 3000
  const { id } = tablet.start(300, t0)
  carry(tablet, computer)
  assert.equal(tablet.active(t0 + 60_000)[0].leftMs - computer.active(t0 + 60_000 + skew)[0].leftMs, skew)
  computer.change(id, 'pause', t0 + 60_000 + skew)
  carry(computer, tablet)
  assert.equal(tablet.active(t0 + 61_000)[0].leftMs, 237_000)
  tablet.change(id, 'resume', t0 + 70_000)
  carry(tablet, computer)
  assert.equal(computer.read()[0].state, 'running')
  assert.equal(computer.read()[0].rev, 3)
})

test('a new timer takes the file of one that is over', () => {
  const [tablet] = pair()
  const first = tablet.start(60, t0)
  tablet.change(first.id, 'stop', t0 + 10_000)
  const second = tablet.start(120, t0 + 100_000)
  assert.equal(second.file, first.file)
  assert.equal(second.rev, 3)
  const third = tablet.start(30, t0 + 100_000)
  assert.notEqual(third.file, second.file)
  assert.equal(tablet.active(t0 + 101_000).length, 2)
})

test('a pinned card stays ready; the trash takes it away everywhere', () => {
  const [tablet, computer] = pair()
  const { id } = tablet.start(900, t0)
  tablet.change(id, 'pin', t0); tablet.change(id, 'stop', t0)
  assert.equal(tablet.active(t0).length, 0)
  const [c] = tablet.cards(t0)
  assert.ok(c.pinned && c.ready)
  assert.notEqual(tablet.start(60, t0).file, c.file) // a pinned card's file is not taken
  tablet.change(id, 'restart', t0 + 10_000)
  assert.equal(tablet.read().find(r => r.id === id).ends, t0 + 910_000)
  carry(tablet, computer)
  computer.change(id, 'trash', t0 + 20_000)
  carry(computer, tablet)
  assert.ok(!tablet.cards(t0 + 20_000).some(r => r.id === id))
})

test('nine timers at most', () => {
  const [tablet] = pair()
  for (let i = 0; i < 9; i++) tablet.start(60 + i, t0)
  assert.throws(() => tablet.start(30, t0), /Nine timers/)
  assert.equal(tablet.cards(t0).length, 9)
})

test('a timer Claude writes by hand is read; anything else is not a timer', () => {
  const [tablet] = pair()
  fs.mkdirSync(tablet.root, { recursive: true })
  fs.writeFileSync(path.join(tablet.root, 'tea.json'), '{"seconds": 180, "state": "running", "ends": "2026-10-18T16:03:00Z"}')
  fs.writeFileSync(path.join(tablet.root, 'notes.json'), 'not a timer')
  const [r] = tablet.active(t0)
  assert.equal(r.id, 'tea')
  assert.equal(r.leftMs, 180_000)
  assert.equal(parse('{"state":"exploded"}'), null)
  // and a file Tetra on the phone writes reads the same (Timer.kt's json(): ends as an ISO instant, left in seconds)
  assert.equal(parse('{"id":"k3f9a2","seconds":300,"label":"","state":"paused","ends":null,"left":200.5,"rev":2,"by":"Tablet"}').left, 200.5)
})

test('clean clears the old copies and keeps each timer as it is: a stop, a pin, a running one; an older paused one never comes back', () => {
  const [tablet] = pair()
  const now = t0 + 3600_000
  fs.mkdirSync(tablet.root, { recursive: true })
  const put = (name, r) => fs.writeFileSync(path.join(tablet.root, name), JSON.stringify(r))
  put('a.json', { id: 'a', seconds: 300, state: 'paused', ends: null, left: 120, rev: 1 })
  put('a (2).json', { id: 'a', seconds: 300, state: 'stopped', ends: null, left: 0, rev: 2, by: 'Tablet' })
  put('b.Tablet.json', { id: 'b', seconds: 60, state: 'stopped', ends: null, left: 0, rev: 3, by: 'Tablet' })
  put('b (2).json', { id: 'b', seconds: 60, state: 'stopped', ends: null, left: 0, rev: 2 })
  put('b (3) (2).json', { id: 'b', seconds: 60, state: 'stopped', ends: null, left: 0, rev: 1 })
  put('c (2).json', { id: 'c', seconds: 7200, state: 'running', ends: new Date(now + 600_000).toISOString(), left: 0, rev: 1 })
  put('d (2).json', { id: 'd', seconds: 60, state: 'stopped', ends: null, left: 0, rev: 1, pinned: true })
  put('d (3).json', { id: 'd', seconds: 60, state: 'stopped', ends: null, left: 0, rev: 2, pinned: true })
  assert.equal(tablet.clean(), 6)
  assert.deepEqual(fs.readdirSync(tablet.root).sort(), ['a.Tablet.json', 'a.json', 'b.Tablet.json', 'c.Tablet.json', 'd.Tablet.json'])
  const after = Object.fromEntries(tablet.read().map(r => [r.id, r]))
  assert.equal(after.a.state, 'stopped')
  assert.equal(after.c.ends, now + 600_000)
  assert.equal(after.d.pinned, true); assert.equal(after.d.rev, 2)
  assert.deepEqual(tablet.cards(now).map(r => r.id).sort(), ['c', 'd'])
  assert.equal(tablet.clean(), 0)
})

// Alarms and the stopwatch: the phone's TimerAlarmsTest, in this computer's time zone
const local = (d, h, m) => new Date(2026, 10, d, h, m).getTime() // November 2026: the 2nd is a Monday

test('an alarm on weekdays rings at its time, dismiss on one device stops it on the other, then the next day', () => {
  const [tablet, computer] = pair()
  const a = tablet.alarmAdd('07:30', ['MO', 'TU', 'WE', 'TH', 'FR'], 'School', local(1, 20, 0))
  assert.equal(tablet.alarmCards(local(1, 20, 0))[0].next, local(2, 7, 30))
  carry(tablet, computer)
  assert.equal(computer.alarmCards(local(2, 7, 31))[0].ringing, local(2, 7, 30))
  assert.ok(computer.alarmChange(a.id, 'dismiss', local(2, 7, 31)))
  carry(computer, tablet)
  const after = tablet.alarmCards(local(2, 7, 32))[0]
  assert.equal(after.ringing, null)
  assert.equal(after.next, local(3, 7, 30))
  assert.equal(tablet.read().length, 0) // timers' readers skip alarms
})

test('a single alarm is off once dismissed; snooze rings ten minutes later; skip answers the next one', () => {
  const [tablet] = pair()
  const once = tablet.alarmAdd('06:00', [], '', local(2, 22, 0))
  assert.equal(once.date, '2026-11-03')
  tablet.alarmChange(once.id, 'snooze', local(3, 6, 1))
  const s = tablet.alarmCards(local(3, 6, 5))[0]
  assert.equal(s.ringing, null)
  assert.equal(s.next, local(3, 6, 11))
  assert.equal(tablet.alarmCards(local(3, 6, 11))[0].ringing, local(3, 6, 11))
  tablet.alarmChange(once.id, 'dismiss', local(3, 6, 12))
  assert.equal(tablet.alarmCards(local(3, 6, 12))[0].on, false)
  const daily = tablet.alarmAdd('08:00', ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'], '', local(2, 12, 0))
  tablet.alarmChange(daily.id, 'skip', local(2, 12, 0))
  const d = tablet.alarmCards(local(2, 12, 0)).find(x => x.id === daily.id)
  assert.equal(d.skipped, true)
  assert.equal(d.next, local(4, 8, 0))
  tablet.alarmChange(daily.id, 'delete', local(2, 12, 0))
  assert.equal(tablet.alarms().length, 1)
})

test('the stopwatch counts, holds, laps and resets, and is the same on both devices', () => {
  const [tablet, computer] = pair()
  const s0 = Date.parse('2026-11-02T10:00:00Z')
  assert.ok(tablet.watch('start', s0))
  assert.ok(tablet.watch('lap', s0 + 62_400))
  assert.ok(tablet.watch('hold', s0 + 90_000))
  carry(tablet, computer)
  const w = computer.stopwatch()
  assert.equal(w.state, 'held')
  assert.equal(w.elapsed, 90)
  assert.deepEqual(w.laps, [62.4])
  assert.ok(computer.watch('start', s0 + 200_000))
  assert.equal(computer.stopwatch().started, s0 + 110_000)
  assert.equal(computer.watch('reset', s0), true)
  assert.equal(computer.watch('reset', s0), false)
})
