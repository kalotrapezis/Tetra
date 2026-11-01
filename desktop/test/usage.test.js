'use strict'
// AI Assist's usage record (usage.js): every paid call a line, tagged by feature; read back across devices and older formats;
// the dashboard's sums; the budget's 80 % warning and its cap.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Usage } = require('../usage')
const { Bill, Mistral } = require('../assistant')

const at = new Date(2026, 10, 1, 10, 0).getTime() // 1 Nov 2026, 10:00 local
const fresh = () => fs.mkdtempSync(path.join(os.tmpdir(), 'usage-'))

test('each paid call is a line tagged with what it was for; parts of the work count to their owner too', () => {
  const dir = fresh(), u = new Usage(dir, 'my pc', { now: () => at }), metered = []
  const bill = new Bill(x => metered.push(x), l => u.add(l))
  bill.tokens('mistral-small-latest', { prompt_tokens: 1000, completion_tokens: 500 })
  const job = bill.for('audio', { file: 'Μάθημα.pdf', job: 'j1' })
  job.for('tts').chars('α'.repeat(1000))
  bill.for('live').minutes('voxtral-mini-transcribe-realtime-3', 60)
  const lines = fs.readFileSync(path.join(dir, 'my-pc-2026-11.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
  assert.deepEqual(lines.map(l => [l.v, l.f, l.m]), [[1, 'chat', 'mistral-small-latest'], [1, 'tts', 'voxtral-mini-tts-3'], [1, 'live', 'voxtral-mini-transcribe-realtime-3']])
  assert.deepEqual([lines[0].i, lines[0].o, lines[1].c, lines[1].file, lines[1].job, lines[2].s], [1000, 500, 1000, 'Μάθημα.pdf', 'j1', 60])
  assert.equal(job.usd.toFixed(3), '0.016')
  assert.equal(bill.usd.toFixed(5), (0.00025 + 0.016 + 0.006).toFixed(5), 'the chat\'s bill holds its parts')
  assert.equal(metered.length, 3, 'the meter counts each once')
})

test('Mistral.as tags the calls of one feature and keeps the API', () => {
  const lines = [], api = new Mistral({ key: () => 'k', bill: new Bill(() => {}, l => lines.push(l)) })
  const ocr = api.as('ocr', { file: 'scan.pdf' })
  ocr.bill.add(0.002, { m: 'mistral-ocr-latest', p: 2 })
  assert.equal(typeof ocr.ocr, 'function')
  assert.deepEqual(lines, [{ f: 'ocr', file: 'scan.pdf', m: 'mistral-ocr-latest', p: 2, usd: 0.002 }])
  assert.equal(api.bill.usd, 0.002)
})

test('older lines, other devices and broken lines: read, never lost; the dashboard sums them', () => {
  const dir = fresh(), u = new Usage(dir, 'pc', { now: () => at })
  // an older format (v0: at/feature/model) and a line sync cut in half: the old one is read, the broken one skipped
  fs.writeFileSync(path.join(dir, 'phone-2026-10.jsonl'), `{"at":${at - 5 * 86_400_000},"feature":"chat","model":"mistral-small-latest","usd":0.5}\n{"v":1,"t":1,"f":"ch`)
  u.add({ f: 'chat', m: 'mistral-small-latest', usd: 0.25 })
  u.add({ f: 'tts', m: 'voxtral-mini-tts-3', c: 900, usd: 0.75, file: 'Μάθημα.pdf', job: 'j1' })
  u.add({ f: 'mp3', file: 'Μάθημα.pdf', title: 'Μάθημα — Εκπομπή', s: 60, job: 'j1', cost: 0.75 })
  const all = u.lines()
  assert.equal(all.length, 4)
  assert.deepEqual(all.find(x => x.device === 'phone'), { at: at - 5 * 86_400_000, feature: 'chat', model: 'mistral-small-latest', usd: 0.5, v: 0, t: at - 5 * 86_400_000, f: 'chat', m: 'mistral-small-latest', i: 0, o: 0, c: 0, s: 0, p: 0, cost: 0, device: 'phone' })
  const s = u.summary()
  assert.deepEqual([s.today, s.month, s.all], [1, 1, 1.5])
  assert.equal(s.days.length, 30); assert.equal(s.days.at(-1).usd, 1); assert.equal(s.days.at(-6).usd, 0.5)
  assert.deepEqual(s.byFeature.map(x => [x.key, x.usd, x.n]).sort(), [['chat', 0.75, 2], ['tts', 0.75, 1]])
  assert.deepEqual(s.files.map(x => [x.key, x.usd]), [['Μάθημα.pdf', 0.75]])
  assert.deepEqual(s.mp3s.map(x => [x.title, x.seconds, x.usd]), [['Μάθημα — Εκπομπή', 60, 0.75]], 'an MP3 shows its whole cost, counted once')
  assert.deepEqual(s.byDevice.map(x => x.key).sort(), ['pc', 'phone'])
})

test('budget: a warning once at 80 %, and the cap stops what runs by itself', () => {
  const dir = fresh(), u = new Usage(dir, 'pc', { now: () => at })
  assert.equal(u.capped(), false, 'no budget, no cap')
  u.setBudget(1)
  u.add({ f: 'chat', usd: 0.5 })
  assert.equal(u.warnNow(), false)
  u.add({ f: 'chat', usd: 0.35 })
  assert.equal(u.warnNow(), true); assert.equal(u.warnNow(), false, 'once a month')
  assert.equal(u.capped(), false)
  u.add({ f: 'chat', usd: 0.2 })
  assert.equal(u.capped(), true)
  assert.equal(new Usage(dir, 'phone', { now: () => at }).capped(), true, 'the same budget on every device')
  u.setBudget(0)
  assert.equal(u.capped(), false, '0: no budget')
})
