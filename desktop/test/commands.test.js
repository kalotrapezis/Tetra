'use strict'
// The command line (commands.js, cli.js): the registry matches main.js, the manual is made from it, the socket answers, and
// AI Assist's tetra_command keeps the safety rules.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const commands = require('../commands')
const { Tools, Chat } = require('../assistant')
const { APPS: AI_APPS } = require('../ai')

const MAIN = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8')
const channels = new Set([...MAIN.matchAll(/ipcMain\.handle\('([^']+)'/g)].map(m => m[1]))

test('commands: every command calls a handler main.js has, with a known tag, app and parameter types', () => {
  const names = new Set()
  for (const c of commands.COMMANDS) {
    assert.ok(channels.has(c.ipc[0]), `${c.name}: main.js has no ${c.ipc[0]}`)
    assert.ok(commands.APPS[c.app], c.name)
    assert.ok(Object.keys(commands.TAGS).includes(c.tag), c.name)
    assert.match(c.verb, /^[a-z][a-z-]*$/, c.name)
    assert.ok(!names.has(c.name), `${c.name} twice`); names.add(c.name)
    for (const s of Object.values(c.params)) assert.ok(['string', 'integer', 'number', 'boolean', 'time', 'strings', 'json', 'choice'].includes(commands.spec(s).type), `${c.name}: ${s}`)
    if (c.obj) assert.ok(c.obj in c.params, c.name)
  }
  for (const [, [, sw]] of Object.entries(commands.APPS)) assert.ok(sw === null || sw === false || AI_APPS.includes(sw))
  for (const app of Object.keys(commands.APPS)) assert.ok(commands.COMMANDS.some(c => c.app === app), `${app} has no command`)
  // the method-call channels: each method named is one main.js allows
  for (const [ch, list] of [['calendar:call', 'CALENDAR_CALLS'], ['notes:call', 'NOTE_CALLS'], ['contacts:call', 'CONTACTS_CALLS'], ['files:call', 'FILE_CALLS']]) {
    const allowed = new RegExp(`const ${list} = \\[([^\\]]+)\\]`).exec(MAIN)[1]
    for (const c of commands.COMMANDS.filter(x => x.ipc[0] === ch)) assert.ok(allowed.includes(`'${c.ipc[1]}'`), `${c.name}: ${c.ipc[1]}`)
  }
})

test('commands: secrets, Reset\'s delete and approving AI Assist\'s held actions are never commands', () => {
  const never = ['passwords:open', 'passwords:list', 'passwords:passphrase', 'passwords:cvc', 'passwords:change', 'passwords:codes', 'passwords:copy',
    'vault:unlock', 'vault:setup', 'assistant:setKey', 'mail:add', 'mail:pasteAppPassword', 'role:join', 'reset:delete', 'reset:arm', 'assistant:confirm', 'assistant:refuse']
  for (const ch of never) assert.ok(!commands.COMMANDS.some(c => c.ipc[0] === ch), ch)
  // sending, calling and deleting ask
  for (const n of ['mail.send', 'messages.send', 'phone.call', 'files.empty-trash', 'notes.remove', 'calendar.trash', 'mail.delete', 'timer.delete']) assert.equal(commands.find(n).tag, 'asks', n)
  // AI Assist never gets its own switches, the budget, sync or the vault
  for (const n of ['ai.set', 'usage.set-budget', 'devices.forget', 'vault.hide', 'assistant.ask', 'assistant.set']) assert.equal(commands.forAi(commands.find(n)), false, n)
})

test('commands: arguments by name become the handler\'s, in its order, typed', () => {
  const a = (n, x) => commands.argsFor(commands.find(n), x)
  assert.deepEqual(a('timer.start', { seconds: '300' }), [300])
  assert.deepEqual(a('timer.delete', { id: 't1' }), ['t1', 'trash'], 'a fixed last argument')
  assert.deepEqual(a('mail.delete', { ids: 'a,b' }), ['delete', ['a', 'b']], 'a fixed first argument, a list from a,b')
  assert.deepEqual(a('calendar.events', { from: '2026-11-14', to: '2026-11-15T09:30' }), ['occurrences', new Date(2026, 10, 14).getTime(), new Date(2026, 10, 15, 9, 30).getTime()])
  assert.deepEqual(a('calendar.save', { calendar: 'c', event: '{"title":"x"}' }), ['save', undefined, 'c', { title: 'x' }], 'a left-out middle one stays in its place')
  assert.deepEqual(a('calendar.export', {}), [], 'a left-out last one is not sent')
  assert.deepEqual(a('schedules.change', { id: 's1', paused: 'true', time: '08:00' }), ['s1', { time: '08:00', paused: true }], 'from obj on: one object')
  assert.deepEqual(a('notes.create', {}), ['create', {}])
  assert.deepEqual(a('mail.set-check', { every: '15' }), [15], 'mail\'s 15 minutes is a number')
  assert.deepEqual(a('mail.set-check', { every: 'push' }), ['push'])
  assert.throws(() => a('timer.start', {}), /needs --seconds/)
  assert.throws(() => a('timer.start', { seconds: 'soon' }), /whole number/)
  assert.throws(() => a('timer.start', { seconds: 5, label: 'x' }), /no --label/)
  assert.throws(() => a('timer.watch', { action: 'explode' }), /start, hold, lap, reset/)
  assert.throws(() => a('calendar.events', { from: '2026-02-30', to: '2026-03-01' }), /real date/)
  assert.throws(() => a('settings.set-theme', { theme: 'dark', x: 1 }), /no --x/)
})

test('commands: run calls the button\'s own handler; an "asks" one only with yes', async () => {
  const seen = []
  const handlers = new Map([['timer:change', (e, ...args) => { seen.push(args); return 'ok' }], ['timer:start', () => 'id']])
  assert.equal(await commands.run(handlers, 'timer.change', { id: 't1', action: 'pause' }), 'ok')
  await assert.rejects(commands.run(handlers, 'timer.delete', { id: 't1' }), e => e.asks)
  assert.equal(await commands.run(handlers, 'timer delete', { id: 't1' }, { yes: true }), 'ok', '"app verb" works too')
  assert.deepEqual(seen, [['t1', 'pause'], ['t1', 'trash']])
  await assert.rejects(commands.run(handlers, 'timer.explode'), /timer has: list, last, start/)
  await assert.rejects(commands.run(handlers, 'nope.x'), /The apps:/)
  await assert.rejects(commands.run(new Map(), 'timer.list'), /not ready/)
})

test('commands: the manual has every app and command; the AI\'s leaves out what is not for it; COMMANDS.txt is the manual', () => {
  const all = commands.help()
  for (const c of commands.COMMANDS) assert.ok(all.includes(`tetra ${c.app} ${c.verb}`), c.name)
  const ai = commands.help(null, { ai: true })
  assert.ok(ai.includes('calendar') && !/^ {2}devices/m.test(ai) && !/^ {2}vault/m.test(ai))
  assert.ok(!commands.help('assistant', { ai: true }).includes('assistant ask'))
  assert.throws(() => commands.help('devices', { ai: true }), /No app/)
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'COMMANDS.txt'), 'utf8'), all, 'run: node cli.js help > COMMANDS.txt')
})

test('commands: the socket answers one JSON line, only this user can open it, and the CLI talks to it', { skip: process.platform === 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tetra-cli-'))
  const at = path.join(dir, 'run', 'tetra.sock')
  const handlers = new Map([['timer:start', (_, s) => `started ${s}`], ['timer:change', () => undefined], ['timer:active', () => [{ id: 't1' }]]])
  const server = await commands.serve(at, (n, a, yes) => commands.run(handlers, n, a, { yes }))
  try {
    assert.equal(fs.statSync(at).mode & 0o777, 0o600)
    assert.equal(fs.statSync(path.dirname(at)).mode & 0o777, 0o700)
    assert.deepEqual(await commands.ask(at, 'timer.start', { seconds: 60 }), { ok: true, result: 'started 60' })
    assert.deepEqual(await commands.ask(at, 'timer.delete', { id: 't1' }), { ok: false, error: 'timer.delete sends, calls, deletes or moves out: run it again with --yes to do it.', asks: true })
    assert.deepEqual(await commands.ask(at, 'timer.delete', { id: 't1' }, true), { ok: true, result: null })
    // the CLI itself
    const { main } = require('../cli')
    const out = [], err = []
    const log = console.log, error = console.error
    console.log = s => out.push(s); console.error = s => err.push(s)
    process.env.TETRA_SOCKET = at
    try {
      assert.equal(await main(['timer', 'start', '90']), 0)
      assert.equal(await main(['timer', 'delete', '--id', 't1']), 2, 'waits for --yes')
      assert.equal(await main(['timer', 'delete', 't1', '--yes']), 0)
      assert.equal(await main(['timer', 'list', '--json']), 0)
      assert.equal(await main(['timer', 'start', 'x']), 1)
    } finally { console.log = log; console.error = error; delete process.env.TETRA_SOCKET }
    assert.deepEqual(out, ['started 90', 'done', '[{"id":"t1"}]'])
    assert.match(err[0], /--yes/)
    assert.match(err[1], /whole number/)
  } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }) }
  await assert.rejects(commands.ask(at, 'timer.list'), /not running/)
})

const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const fakeApi = rounds => ({ bill: { reset() {}, usd: 0 }, chat: async () => rounds.shift() ?? { content: 'OK' } })

test('commands: AI Assist\'s tetra_command runs through the registry, asks the app\'s switch, and holds what asks for the yes', async () => {
  const ran = []
  let on = true
  const tools = new Tools({ now: () => 0, allowed: app => on || app !== 'timer', command: async (n, a) => { ran.push([n, a]); return n === 'photos.list' ? 'x'.repeat(9000) : { ok: 1 } } })
  assert.match(tools.tetra_help({}).forModel, /tetra_command/)
  assert.match(tools.tetra_help({ app: 'timer' }).forModel, /timer alarm-save/)
  assert.equal((await tools.run('tetra_command', { command: 'timer.watch', args: { action: 'lap' } })).forModel, '{"ok":1}')
  assert.equal((await tools.run('tetra_command', { command: 'timer.watch', args: '{"action":"reset"}' })).forModel, '{"ok":1}', 'args as a JSON string too')
  assert.match((await tools.run('tetra_command', { command: 'ai.set', args: { changes: {} } })).forModel, /^Failed: no command/)
  assert.match((await tools.run('tetra_command', { command: 'photos.list' })).forModel, /cut: 9000 characters/)
  on = false
  assert.match((await tools.run('tetra_command', { command: 'timer.watch', args: { action: 'lap' } })).forModel, /switched AI Assist off for timer/)
  on = true
  ran.length = 0
  // a delete waits for the yes, a stopwatch lap does not; after the yes it runs
  const chat = new Chat(fakeApi([{ content: '', tool_calls: [call('1', 'tetra_command', { command: 'timer.delete', args: { id: 't1' } }), call('2', 'tetra_command', { command: 'timer.watch', args: { action: 'lap' } })] }]), tools)
  const r = await chat.ask('σβήσε το χρονόμετρο')
  assert.deepEqual(ran, [['timer.watch', { action: 'lap' }]])
  assert.equal(r.held.length, 1)
  assert.equal(r.held[0].what, 'Delete a timer: timer.delete({"id":"t1"})')
  await chat.confirm(r.held[0].id)
  assert.deepEqual(ran[1], ['timer.delete', { id: 't1' }])
  // after mail (text others wrote), even a side command waits; a read one does not
  ran.length = 0
  const after = new Chat(fakeApi([{ content: '', tool_calls: [call('1', 'tetra_command', { command: 'mail.list', args: { folder: 'Inbox' } })] },
    { content: '', tool_calls: [call('2', 'tetra_command', { command: 'timer.start', args: { seconds: 60 } }), call('3', 'tetra_command', { command: 'timer.list' })] }]), tools)
  const r2 = await after.ask('διάβασε τα mail')
  assert.deepEqual(ran.map(x => x[0]), ['mail.list', 'timer.list'])
  assert.deepEqual(r2.held.map(h => h.what), ['Start a countdown: timer.start({"seconds":60})'])
})
