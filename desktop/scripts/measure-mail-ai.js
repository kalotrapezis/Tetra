// Dev helper: the moments of Mail and AI Assist the user waits for (PERF_MAIL_AI.md). Run on a copy, never the real folders:
//   HOME=<a fake home with Tetra/.System copied> DRIVE_DATA=<a copy of library.db's folder> DRIVE_FILES=<that home>/Tetra/Files \
//   node_modules/.bin/electron scripts/measure-mail-ai.js            (ASK=1 also asks Mistral one short question, a few cents)
// Renders hidden, like measure.js. Each line: until the thing is on screen, until the page stops changing (0.6 s quiet), and
// the longest task that kept the window from answering (Chromium's long tasks, > 50 ms). One process is one cold start: run
// it several times and take the median. Lines start with "@" so a script can pick them up.
const { app, BrowserWindow } = require('electron')
process.env.DRIVE_HIDDEN = '1'
// network apart from the app: each request to Mistral and when its first bytes came (main's clock = the window's Date.now())
const net = []
const realFetch = globalThis.fetch
globalThis.fetch = async (url, o) => {
  const r = { url: String(url), start: Date.now() }; net.push(r)
  const res = await realFetch(url, o); r.headers = Date.now(); return res
}
// the copy holds the user's real accounts and keys: opening an unread row would mark it read on the server. Never here.
const { Mail } = require('../mail.js')
Mail.prototype.withClient = () => Promise.reject(new Error('measuring: no mail server'))
Mail.prototype.send = () => Promise.reject(new Error('measuring: no mail server'))
const started = Date.now()
let readyAt, madeAt, loadedAt
app.once('ready', () => { readyAt = Date.now() })
app.once('browser-window-created', (_, w) => { madeAt = Date.now(); w.webContents.once('did-finish-load', () => { loadedAt = Date.now() }) })
require('../main.js')

const helpers = `
window.__m = (act, ready, label) => new Promise(done => {
  const longs = []; const po = new PerformanceObserver(l => l.getEntries().forEach(e => longs.push(e.duration))); po.observe({ type: 'longtask' })
  const t0 = performance.now(); let last = t0, shown = null
  const mo = new MutationObserver(rs => { if (rs.every(r => r.target.closest?.('.assist-cloud') || r.target.classList?.contains('assist-cloud') || r.target.parentElement?.closest('.assist-cloud'))) return; last = performance.now(); if (shown == null && ready()) shown = last }); mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true })
  act()
  if (ready()) shown = performance.now()
  const check = () => {
    if (shown == null && ready()) shown = performance.now()
    if ((shown != null && performance.now() - last > 600) || performance.now() - t0 > 20000) {
      mo.disconnect(); po.disconnect()
      done('@' + label + ' shown ' + (shown == null ? 'never' : Math.round(shown - t0)) + ' stable ' + Math.round(last - t0) + ' longest ' + Math.round(Math.max(0, ...longs)) + ' n50 ' + longs.length)
    } else setTimeout(check, 16)
  }
  setTimeout(check, 0)
})
window.__nav = names => [...document.querySelectorAll('.nav-item')].find(b => names.includes(b.title))
window.__input = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
0
`
const mail = `(async () => {
  const out = [], $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)]
  out.push(await __m(() => __nav(['Αλληλογραφία', 'Mail']).click(), () => $$('.mail-row').length > 0, 'mail.open'))
  out.push(await __m(() => { const l = $('.mail-list'); l.scrollTop = l.scrollHeight; $('.mail-more')?.click() }, () => $$('.mail-row').length > 300, 'mail.scroll'))
  for (let i = 0; i < 2; i++) out.push(await __m(() => { const l = $('.mail-list'); l.scrollTop = l.scrollHeight; $('.mail-more')?.click() }, () => true, 'mail.scroll'))
  $('.mail-list').scrollTop = 0
  out.push(await __m(() => $('.mail-row').click(), () => !!$('.mail-read iframe, .mail-read .mail-head'), 'mail.read'))
  // the largest mail with attachments on disk, as the Reader asks for it
  const all = await window.drive.mail.list('Inbox', null, false), big = all.filter(m => m.saved && m.attachments > 0).sort((a, b) => b.size - a.size)[0]
  if (big) { const t = performance.now(); await window.drive.mail.open(big.id, false); out.push('@mail.attachment ipc ' + Math.round(performance.now() - t) + ' size ' + big.size) }
  const folder = role => $$('.mail-folder-name').find(b => b.textContent.trim() === role)
  out.push(await __m(() => folder(${JSON.stringify('Απεσταλμένα')})?.click() ?? $$('.mail-folder-name')[1].click(), () => true, 'mail.folder.sent'))
  out.push(await __m(() => $$('.mail-folder-name')[0].click(), () => $$('.mail-row').length > 0, 'mail.folder.inbox'))
  out.push(await __m(() => __input($('.mail-search input'), 'σχολ'), () => true, 'mail.search'))
  out.push(await __m(() => __input($('.mail-search input'), ''), () => true, 'mail.search.clear'))
  return out.join('\\n')
})()`
const ai = `(async () => {
  const out = [], $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)]
  if (!__nav(['AI Assist'])) return '@ai no nav: ' + $$('.nav-item').map(b => b.title).join(', ')
  out.push(await __m(() => __nav(['AI Assist']).click(), () => !!$('.assist-cloud') && !!$('.assist-side'), 'ai.open'))
  if (!$('.assist-pills')) return out.join('\\n') + '\\n@ai no sidebar: ' + $('.assist-page')?.className + ' ' + innerWidth
  for (const [i, name] of [[0, 'scheduled'], [1, 'history'], [3, 'memory']]) out.push(await __m(() => $$('.assist-pills button')[i].click(), () => true, 'ai.' + name))
  return out.join('\\n')
})()`
const ask = `new Promise(done => {
  const t0 = Date.now(); let first = null
  const off = window.drive.assistant.onWords(() => { first ??= Date.now() })
  window.drive.assistant.ask(${JSON.stringify(process.env.QUESTION || 'Πες μόνο τη λέξη γεια.')}, false).then(() => { off(); done({ t0, first, end: Date.now() }) }, e => { off(); done({ t0, error: String(e) }) })
})`

app.whenReady().then(() => setTimeout(async () => {
  const win = BrowserWindow.getAllWindows()[0]
  win.setContentSize(1600, 1000) // the sidebar of AI Assist is there from 900 px of page
  const js = s => win.webContents.executeJavaScript(s)
  await js(helpers)
  const which = (process.env.ONLY || 'mail,ai').split(',')
  // the first page has to be on screen before the clicks: the window was made `started` ms ago
  console.log('@window ' + (Date.now() - started))
  console.log(`@startup setup ${madeAt - readyAt} loaded ${loadedAt - readyAt}`)
  for (const [name, code] of [['mail', mail], ['ai', ai]]) {
    if (which.includes(name)) console.log(await js(code).catch(e => '@' + name + ' error ' + e.message))
  // while mail downloads, main says "changed" twice a second: how long the window stops answering in 10 s (on the Inbox)
    if (name === 'mail' && which.includes('mail')) {
      const tick = setInterval(() => win.webContents.send('mail-changed'), 500)
      console.log(await js(`new Promise(done => {
        const longs = []; const po = new PerformanceObserver(l => l.getEntries().forEach(e => longs.push(e.duration))); po.observe({ type: 'longtask' })
        let worst = 0, at = performance.now()
        const lag = setInterval(() => { const now = performance.now(); worst = Math.max(worst, now - at - 50); at = now }, 50)
        setTimeout(() => { clearInterval(lag); po.disconnect(); done('@mail.busy10s blocked ' + Math.round(longs.reduce((a, b) => a + b, 0)) + ' longest ' + Math.round(Math.max(0, ...longs)) + ' worstlag ' + Math.round(worst)) }, 10000)
      })`))
      clearInterval(tick)
    }
  }
  if (process.env.ASK) for (let i = 0; i < Number(process.env.ASK); i++) {
    net.length = 0
    await js('window.drive.assistant.clear()')
    const r = await js(ask).catch(e => ({ error: e.message })), req = net[0]
    if (r.error || !req) { console.log('@ai.ask error ' + (r.error ?? 'no request')); continue }
    // before the request: the app's; request → first word: Mistral and the line; the rest of the app's is in between
    console.log(`@ai.ask before ${req.start - r.t0} network ${req.headers - req.start} firstword ${r.first - r.t0} total ${r.end - r.t0} requests ${net.length}` +
      // between one request's first bytes and the next request: the rest of that answer, then the tools here
      net.slice(1).map((n, i) => ` gap${i + 1} ${n.start - net[i].headers} net${i + 2} ${n.headers - n.start}`).join(''))
  }
  app.exit(0) // quit() can wait on the window's own leaving (a draft being kept)
}, Number(process.env.WAIT) || 8000))
