/**
 * Tetra Passwords in Firefox: Tetra Desktop's Passwords applet (desktop/pwbridge.js on 127.0.0.1) is the only store —
 * nothing secret is kept here past a tab's lifetime. The popup lists the logins and 2FA codes; content.js fills them on
 * the page and tells us what was typed into a login form, which, new or changed, the popup offers to save to Tetra.
 */
const TETRA = 'http://127.0.0.1:43191'
const pending = new Map() // tabId → { host, user, password }: typed on that tab, not in Tetra yet

async function tetra(route, body) {
  const { token } = await browser.storage.local.get({ token: null })
  if (!token && route !== '/pw/pair') throw Object.assign(new Error('Not paired'), { status: 401 })
  const r = await fetch(TETRA + route, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) })
  const out = await r.json().catch(() => ({}))
  if (r.status === 401 && route !== '/pw/pair') await browser.storage.local.remove('token') // Tetra forgot us: pair again
  if (!r.ok) throw Object.assign(new Error(out.error || `Tetra: ${r.status}`), { status: r.status })
  return out
}

// "https://www.github.com/login" and "github.com" are the same site; a login for google.com fills accounts.google.com
const site = h => String(h ?? '').trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#:].*$/, '').replace(/^www\./, '')
const same = (a, b) => (a = site(a), b = site(b), !!a && !!b && (a === b || a.endsWith('.' + b) || b.endsWith('.' + a)))

async function logins(host) {
  try { return (await tetra('/pw/list')).logins.filter(l => same(l.host, host)) } catch { return [] } // locked, unpaired, Tetra closed: nothing to fill
}

function badge(tabId) {
  browser.browserAction.setBadgeText({ tabId, text: pending.has(tabId) ? '+' : '' })
  browser.browserAction.setBadgeBackgroundColor({ tabId, color: '#2a6df4' })
}

async function submitted(tabId, { host, user, password }) {
  if (!password) return
  const all = await logins(host)
  if (all.some(l => l.user === user && l.password === password)) return // Tetra has it already
  const was = all.find(l => l.user === user)
  pending.set(tabId, { host: was?.host ?? site(host), user, password, changed: !!was })
  badge(tabId)
}

browser.tabs.onRemoved.addListener(id => pending.delete(id))

browser.runtime.onMessage.addListener((m, sender) => {
  const tab = sender.tab?.id
  switch (m.type) {
    // from content.js
    case 'logins': return Promise.all([logins(m.host), browser.storage.local.get({ autofill: true })]).then(([l, s]) => ({ logins: l, autofill: s.autofill }))
    case 'submitted': return submitted(tab, m)
    // from the popup
    case 'status': return tetra('/pw/status').then(s => ({ paired: true, ...s }), e => ({ paired: e.status !== 401, down: e.status !== 401 }))
    case 'pair': return tetra('/pw/pair', {}).then(r => browser.storage.local.set({ token: r.token }))
    case 'open': return tetra('/pw/open', { secret: m.secret })
    case 'lock': return tetra('/pw/lock', {})
    case 'list': return tetra('/pw/list')
    case 'pending': return Promise.resolve(pending.get(m.tab) ?? null)
    case 'save': {
      const p = pending.get(m.tab)
      if (!p) return Promise.resolve(null)
      return tetra('/pw/save', p).then(r => { pending.delete(m.tab); badge(m.tab); return r })
    }
    case 'dismiss': pending.delete(m.tab); badge(m.tab); return Promise.resolve()
  }
})
