#!/usr/bin/env node
/*
 * tetra <app> <command> [--param value …] [--yes] [--json] — the running Tetra, from a terminal or a script (commands.js).
 * tetra help [app] reads the manual without Tetra running; tetra help --json, the registry as data. Parameters by name (--from 2026-11-14, --on=false, --flag) or in
 * order (tetra timer start 300). Exit 0 done, 1 refused or failed, 2 waits for --yes.
 */
const commands = require('./commands')

function parse(argv) {
  const named = {}, loose = []
  let yes = false, json = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--yes' || a === '-y') { yes = true; continue }
    if (a === '--json') { json = true; continue }
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a)
    if (!m) { loose.push(a); continue }
    if (m[2] !== undefined) named[m[1]] = m[2]
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) named[m[1]] = argv[++i]
    else named[m[1]] = 'true'
  }
  return { named, loose, yes, json }
}

async function main(argv) {
  const [app, verb, ...rest] = argv
  if (app === 'help' && argv.includes('--json')) { console.log(JSON.stringify(commands.manifest(), null, 1)); return 0 }
  if (!app || app === 'help' || app === '--help' || app === '-h') { process.stdout.write(commands.help(verb || null)); if (verb) process.stdout.write('\n'); return 0 }
  if (!verb || verb === 'help') { console.log(commands.help(app)); return 0 }
  const cmd = commands.find(`${app}.${verb}`)
  if (!cmd) { console.error(`tetra: no command "${app} ${verb}".`); return 1 }
  const { named, loose, yes, json } = parse(rest)
  // values without a name fill the parameters not named yet, in order
  const free = Object.keys(cmd.params).filter(n => !(n in named))
  if (loose.length > free.length) { console.error(`tetra: ${cmd.name} takes ${free.length ? free.map(n => '--' + n).join(' ') : 'nothing more'}; "${loose[free.length]}" is extra.`); return 1 }
  loose.forEach((v, i) => { named[free[i]] = v })
  try { commands.argsFor(cmd, named) } catch (e) { console.error(`tetra: ${e.message}`); return 1 } // said before Tetra is asked
  const r = await commands.ask(commands.socketPath(), cmd.name, named, yes)
  if (!r.ok) { console.error(`tetra: ${r.error}`); return r.asks ? 2 : 1 }
  const v = r.result
  if (json) console.log(JSON.stringify(v))
  else if (v == null) console.log('done')
  else console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2))
  return 0
}

// exitCode, not exit(): a long answer piped on is written out whole first
if (require.main === module) main(process.argv.slice(2)).then(code => { process.exitCode = code }, e => { console.error(`tetra: ${e.message}`); process.exitCode = 1 })

module.exports = { parse, main }
