'use strict'
process.env.TZ = 'Europe/Athens' // clocks go back 25 Oct 2026, forward 28 Mar 2027
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Schedules, nextRun, due } = require('../schedule')
const brief = require('../brief')

const at = s => new Date(s).getTime() // local, as TZ says
const local = ms => new Date(ms).toLocaleString('sv-SE').slice(0, 16)

test('schedule: the next run of each repetition, across the clock changes, on short months and on 29 February', () => {
  const daily = { time: '08:00', repeat: 'daily' }
  assert.equal(local(nextRun(daily, at('2026-11-01T07:59'))), '2026-11-01 08:00')
  assert.equal(local(nextRun(daily, at('2026-11-01T08:00'))), '2026-11-02 08:00', 'strictly after')
  assert.equal(local(nextRun(daily, at('2026-10-24T09:00'))), '2026-10-25 08:00', 'the autumn change: still 08:00')
  assert.equal(nextRun(daily, at('2026-10-24T08:00')) - nextRun(daily, at('2026-10-23T08:00')), 25 * 3600_000, 'that day is 25 hours long')
  assert.equal(local(nextRun(daily, at('2027-03-27T09:00'))), '2027-03-28 08:00', 'the spring change: still 08:00')
  assert.equal(local(nextRun({ time: '03:30', repeat: 'daily' }, at('2027-03-27T12:00'))), '2027-03-28 04:30', 'a skipped time runs as the clock says')

  const mondays = { time: '08:00', repeat: 'weekly', days: [1, 4] } // Monday and Thursday
  assert.equal(local(nextRun(mondays, at('2026-11-01T12:00'))), '2026-11-02 08:00') // Sunday → Monday
  assert.equal(local(nextRun(mondays, at('2026-11-02T08:00'))), '2026-11-05 08:00') // → Thursday
  assert.equal(nextRun({ time: '08:00', repeat: 'weekly', days: [] }, at('2026-11-01T12:00')), null)

  const monthly = { time: '09:00', repeat: 'monthly', date: '2026-01-31' }
  assert.equal(local(nextRun(monthly, at('2026-11-01T00:00'))), '2026-11-30 09:00', 'a 31st on a 30-day month: its last day')
  assert.equal(local(nextRun(monthly, at('2027-02-01T00:00'))), '2027-02-28 09:00')
  assert.equal(local(nextRun(monthly, at('2027-03-01T00:00'))), '2027-03-31 09:00')

  const leap = { time: '10:00', repeat: 'yearly', date: '2028-02-29' }
  assert.equal(local(nextRun(leap, at('2026-11-01T00:00'))), '2027-02-28 10:00', '29 Feb on a year without one: the 28th')
  assert.equal(local(nextRun(leap, at('2027-03-01T00:00'))), '2028-02-29 10:00')
  assert.equal(local(nextRun({ time: '10:00', repeat: 'yearly', date: '2020-11-05' }, at('2026-11-06T00:00'))), '2027-11-05 10:00')

  const once = { time: '18:00', repeat: 'once', date: '2026-11-03' }
  assert.equal(local(nextRun(once, at('2026-11-01T00:00'))), '2026-11-03 18:00')
  assert.equal(nextRun(once, at('2026-11-03T18:00')), null, 'once is once')
  assert.equal(nextRun({ time: '25:00', repeat: 'daily' }, 0), null)
})

test('schedule: the store makes the brief first, checks what it is given, and counts a change from now', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-'))
  try {
    let now = at('2026-11-01T10:00')
    const s = new Schedules(path.join(dir, 'Data', 'schedules.json'), () => now)
    assert.deepEqual(s.list().map(x => [x.id, x.kind, x.repeat, x.paused]), [['brief', 'brief', 'daily', false]], 'the daily brief, on')
    const a = s.add({ prompt: 'πες μου τι έχω την εβδομάδα', time: '8:00', repeat: 'weekly', days: [1] })
    assert.equal(a.time, '08:00'); assert.equal(a.title, 'πες μου τι έχω την εβδομάδα')
    assert.equal(local(due(a)), '2026-11-02 08:00')
    assert.throws(() => s.add({ prompt: 'x', time: '8:00', repeat: 'weekly' }), /weekdays/)
    assert.throws(() => s.add({ prompt: 'x', time: '24:10' }), /Not a time/)
    assert.throws(() => s.add({ prompt: 'x', time: '8:00', repeat: 'hourly' }), /Not a repetition/)
    s.ran(a.id, at('2026-11-02T08:00'))
    assert.equal(local(due(s.list()[1])), '2026-11-09 08:00')
    now = at('2026-11-03T12:00')
    s.change(a.id, { paused: true }); assert.equal(due(s.list()[1]), null)
    s.change(a.id, { paused: false, time: '07:00' })
    assert.equal(local(due(s.list()[1])), '2026-11-09 07:00', 'resumed: nothing gone by runs at once')
    s.setBrief({ sections: { weather: false }, place: { name: 'Αθήνα', lat: 37.98, lon: 23.73 } })
    assert.deepEqual(s.read().brief.sections, { weather: false })
    assert.equal(s.runs('pc-1'), true, 'the first computer to ask runs them'); assert.equal(s.runs('pc-2'), false)
    s.change(s.list()[0].id, { runNow: true }); assert.equal(s.list()[0].runNow, true); assert.equal(s.read().runner, 'pc-1', 'kept through a change')
    s.remove(a.id); assert.equal(s.list().length, 1)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('brief: each section switch, the AI switch per app, a failing section, and the page in light and dark', async () => {
  const now = at('2026-11-02T07:30')
  const ctx = {
    now, place: { name: 'Αθήνα', lat: 37.98, lon: 23.73 },
    calendar: { occurrences: (from, to) => from === at('2026-11-02T00:00') ? [{ title: 'Σύλλογος', start: at('2026-11-02T13:00'), place: 'Γραφείο' }] : [] },
    notes: { list: () => [{ title: 'Ψώνια', noteType: 'CHECKLIST', updatedAt: 1, checklistItems: [{ text: 'γάλα', isChecked: false }, { text: 'ψωμί', isChecked: true }] }] },
    ask: async prompt => { assert.match(prompt, /mail report/); return 'Η γραμματεία θέλει απάντηση.' },
    fetch: async () => ({ ok: true, json: async () => ({ current: { temperature_2m: 17.6, weather_code: 61 }, daily: { weather_code: [61, 0], temperature_2m_min: [12, 10], temperature_2m_max: [19, 21], precipitation_probability_max: [80, 0] } }) }),
  }
  assert.deepEqual(brief.enabled().map(s => s.id), ['calendar', 'mail', 'weather', 'notes'])
  assert.deepEqual(brief.enabled({ mail: false, notes: false }).map(s => s.id), ['calendar', 'weather'])
  assert.deepEqual(brief.enabled({}, app => app !== 'web').map(s => s.id), ['calendar', 'mail', 'notes'], 'web switched off: no weather')

  const all = await brief.make({ ...ctx, switches: {}, allowed: () => true })
  for (const w of ['Σύλλογος', 'Γραφείο', 'Η γραμματεία θέλει απάντηση', '18°', 'Αθήνα', 'γάλα']) assert.ok(all.html.includes(w), w)
  assert.ok(!all.html.includes('ψωμί'), 'a ticked item is done')
  assert.match(all.html, /prefers-color-scheme: dark/)
  assert.match(all.line, /1/); assert.match(all.line, /18°/)

  const some = await brief.make({ ...ctx, switches: { calendar: false, weather: false }, allowed: app => app !== 'mail' })
  assert.ok(!some.html.includes('Σύλλογος') && !some.html.includes('Αθήνα') && !some.html.includes('γραμματεία'))
  assert.ok(some.html.includes('γάλα'))

  const broken = await brief.make({ ...ctx, switches: {}, allowed: () => true, fetch: async () => ({ ok: false, status: 503 }), place: ctx.place })
  assert.match(broken.html, /class="failed".*503/); assert.ok(broken.html.includes('Σύλλογος'), 'the others still come')
  assert.ok(brief.answer('Η εβδομάδα', now, '<b>x</b>').includes('&lt;b&gt;x'), 'the answer is text, not HTML')
})

test('AI Assist\'s tool: "κάθε Δευτέρα στις 8 πες μου τι έχω την εβδομάδα" made, listed, paused and deleted; the brief is only paused', async () => {
  const { Tools } = require('../assistant')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-'))
  try {
    const now = at('2026-11-01T10:00'), told = []
    const tools = new Tools({ schedules: new Schedules(path.join(dir, 'schedules.json'), () => now), now: () => now, changed: w => told.push(w) })
    assert.match((await tools.run('schedule_add', { prompt: 'πες μου τι έχω την εβδομάδα', time: '08:00', repeat: 'weekly', days: [1] })).forModel, /weekly on Mon at 08:00, next Mon 2026-11-02 08:00/)
    const list = (await tools.run('schedule_list')).forModel
    assert.match(list, /^1\. Η ενημέρωση της ημέρας — daily at 07:30.*\(the daily brief\)\n2\. .*"πες μου τι έχω την εβδομάδα"$/)
    assert.match((await tools.run('schedule_change', { choice: 2, paused: true })).forModel, /paused/)
    assert.match((await tools.run('schedule_delete', { choice: 1 })).forModel, /cannot be deleted; pause it/)
    assert.match((await tools.run('schedule_delete', { choice: 2 })).forModel, /Deleted/)
    assert.deepEqual(told, ['schedules', 'schedules', 'schedules'])
    assert.match((await new Tools({}).run('schedule_list')).forModel, /only on the computer/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
