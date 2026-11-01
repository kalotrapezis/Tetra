'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Memory } = require('../memory')
const { Tools, Chat, system } = require('../assistant')

test('memory: kept once, changed, forgotten, checked; a broken file is an empty list', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-'))
  try {
    const m = new Memory(path.join(dir, 'Shared', 'memory.json'))
    assert.deepEqual(m.list(), [])
    const a = m.add('  Διδάσκει στο   3ο Δημοτικό ')
    assert.equal(a.text, 'Διδάσκει στο 3ο Δημοτικό')
    assert.equal(m.add('διδάσκει στο 3ο δημοτικό').id, a.id, 'the same words: not twice')
    assert.throws(() => m.add(' '), /remember/)
    assert.equal(m.add('x'.repeat(500)).text.length, 300)
    m.change(a.id, 'Διδάσκει στο 5ο Δημοτικό')
    assert.equal(m.list()[0].text, 'Διδάσκει στο 5ο Δημοτικό')
    assert.equal(JSON.parse(fs.readFileSync(m.file, 'utf8')).setBy, 'desktop')
    m.forget(a.id); assert.equal(m.list().length, 1)
    fs.writeFileSync(m.file, '{nope'); assert.deepEqual(m.list(), [])
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('AI Assist: «θυμήσου ότι…» kept by its tool, in the next chat\'s instructions, listed and forgotten', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-'))
  try {
    const told = [], tools = new Tools({ memory: new Memory(path.join(dir, 'memory.json')), changed: w => told.push(w) })
    assert.match((await tools.run('memory_add', { text: 'Η κόρη του λέγεται Ελένη' })).forModel, /Kept/)
    // a later chat (a new Chat, as a scheduled run makes) is told the fact
    const sent = []
    const api = { bill: {}, chat: async messages => { sent.push(messages[0].content); return { content: 'Εντάξει.' } } }
    await new Chat(api, tools).ask('Πώς λέγεται η κόρη μου;')
    assert.match(sent[0], /remember about them[^]*- Η κόρη του λέγεται Ελένη/)
    assert.ok(!system(new Date(), []).includes('remember about them'), 'nothing kept: no such part')
    assert.match((await tools.run('memory_list')).forModel, /^1\. Η κόρη του λέγεται Ελένη$/)
    assert.match((await tools.run('memory_forget', { choice: 1 })).forModel, /Forgot/)
    assert.match((await tools.run('memory_list')).forModel, /Nothing is kept/)
    assert.deepEqual(told, ['memory', 'memory'])
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
