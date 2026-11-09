const main = document.getElementById('main'), lockButton = document.getElementById('lock')
const ask = (type, more = {}) => browser.runtime.sendMessage({ type, ...more })
const h = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e }
const site = s => String(s ?? '').toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#:].*$/, '').replace(/^www\./, '')
const same = (a, b) => (a = site(a), b = site(b), !!a && !!b && (a === b || a.endsWith('.' + b) || b.endsWith('.' + a)))
let tab = null, view = 'logins', query = '', timer = null

const said = text => { const s = document.getElementById('said'); if (s) { s.textContent = text; setTimeout(() => { s.textContent = '' }, 2000) } }
const copy = (text, what) => navigator.clipboard.writeText(text).then(() => said(what + ' αντιγράφηκε'))
const toTab = m => browser.tabs.sendMessage(tab.id, m).catch(() => false)

async function show() {
  clearTimeout(timer)
  const s = await ask('status')
  lockButton.hidden = !s.open
  if (s.down) return main.replaceChildren(h('p', { textContent: 'Το Tetra δεν απαντά. Άνοιξε το Tetra στον υπολογιστή.' }), h('button', { textContent: 'Ξανά', onclick: show }))
  if (!s.paired) {
    const go = h('button', { className: 'main', textContent: 'Σύνδεση με το Tetra' })
    go.onclick = async () => {
      main.replaceChildren(h('p', { textContent: 'Περιμένω να το επιτρέψεις στο Tetra…' }))
      try { await ask('pair') } catch (e) { return main.replaceChildren(h('p', { textContent: /Not allowed/.test(e.message) ? 'Δεν επιτράπηκε στο Tetra.' : e.message }), h('button', { textContent: 'Ξανά', onclick: show })) }
      show()
    }
    return main.replaceChildren(h('p', { textContent: 'Οι κωδικοί σου μένουν στο Tetra. Πάτα «Σύνδεση» και το Tetra θα σε ρωτήσει αν το επιτρέπεις.' }), go)
  }
  if (s.need) return main.replaceChildren(h('p', { textContent: 'Άνοιξε πρώτα τους Κωδικούς στο Tetra και βάλε τον κωδικό συγχρονισμού.' }), h('button', { textContent: 'Ξανά', onclick: show }))
  if (!s.open) {
    const box = h('input', { type: 'password', placeholder: 'Κωδικός σύνδεσης υπολογιστή ή συγχρονισμού', autofocus: true })
    const go = h('button', { className: 'main', textContent: 'Ξεκλείδωμα' }), err = h('p')
    const unlock = async () => { try { await ask('open', { secret: box.value }); show() } catch { err.textContent = 'Λάθος κωδικός.'; box.select() } }
    go.onclick = unlock; box.onkeydown = e => { if (e.key === 'Enter') unlock() }
    main.replaceChildren(h('p', { textContent: 'Οι Κωδικοί είναι κλειδωμένοι.' }), box, go, err)
    return box.focus()
  }
  list()
}

async function list() {
  const [data, pend, { autofill }] = await Promise.all([ask('list').catch(() => null), ask('pending', { tab: tab.id }), browser.storage.local.get({ autofill: true })])
  if (!data) return show()
  const parts = []

  if (pend) { // typed on this tab, not in Tetra yet
    const yes = h('button', { className: 'main', textContent: 'Αποθήκευση' }), no = h('button', { textContent: 'Όχι' })
    yes.onclick = async () => { await ask('save', { tab: tab.id }); said('Αποθηκεύτηκε στο Tetra'); list() }
    no.onclick = async () => { await ask('dismiss', { tab: tab.id }); list() }
    parts.push(h('div', { className: 'save' }, h('div', { textContent: `${pend.changed ? 'Αλλαγή κωδικού' : 'Νέος κωδικός'} για ${pend.host}${pend.user ? ' (' + pend.user + ')' : ''};` }), h('div', { className: 'gen' }, yes, no)))
  }

  const tabs = h('div', { className: 'tabs' })
  for (const [k, name] of [['logins', 'Κωδικοί'], ['codes', '2FA'], ['new', 'Νέος κωδικός']]) {
    const b = h('button', { textContent: name })
    b.setAttribute('aria-pressed', String(view === k))
    b.onclick = () => { view = k; list() }
    tabs.append(b)
  }
  parts.push(tabs)

  if (view !== 'new') {
    const search = h('input', { type: 'search', placeholder: 'Αναζήτηση', value: query })
    search.oninput = () => { query = search.value; list().then(() => { const s = main.querySelector('input[type=search]'); s.focus(); s.setSelectionRange(query.length, query.length) }) }
    parts.push(search)
  }
  const hit = (...xs) => !query || xs.some(x => String(x).toLowerCase().includes(query.toLowerCase()))

  if (view === 'logins') {
    const rows = data.logins.filter(l => hit(l.host, l.user)).sort((a, b) => same(b.host, tab.url) - same(a.host, tab.url) || a.host.localeCompare(b.host))
    if (!rows.length) parts.push(h('p', { textContent: 'Κανένας κωδικός.' }))
    for (const l of rows) {
      const fill = h('button', { className: 'main', textContent: 'Συμπλήρωση', title: 'Στη σελίδα' })
      fill.onclick = async () => { if (await toTab({ type: 'fill', user: l.user, password: l.password })) window.close(); else said('Δεν βρέθηκε πεδίο') }
      parts.push(h('div', { className: 'row' + (same(l.host, tab.url) ? ' here' : '') },
        h('div', {}, h('b', { textContent: l.host }), h('small', { textContent: l.user || '—' })),
        h('button', { textContent: '👤', title: 'Αντιγραφή χρήστη', onclick: () => copy(l.user, 'Ο χρήστης') }),
        h('button', { textContent: '🔑', title: 'Αντιγραφή κωδικού', onclick: () => copy(l.password, 'Ο κωδικός') }),
        fill))
    }
  } else if (view === 'codes') {
    const rows = data.codes.filter(c => hit(c.issuer, c.account))
    if (!rows.length) parts.push(h('p', { textContent: 'Κανένας κωδικός 2FA.' }))
    for (const c of rows) {
      const use = h('button', { className: 'main', textContent: 'Χρήση', title: 'Αντιγραφή και συμπλήρωση' })
      use.onclick = async () => { await copy(c.code, 'Ο κωδικός'); if (await toTab({ type: 'code', code: c.code })) window.close() }
      parts.push(h('div', { className: 'row' }, h('div', {}, h('b', { textContent: c.issuer || c.account }), h('small', { textContent: `${c.account} · ${c.left}″` })), h('span', { className: 'code', textContent: c.code }), use))
    }
    timer = setTimeout(list, Math.min(...rows.map(c => c.left), 30) * 1000 + 300) // new codes when the soonest runs out
  } else {
    const gen = h('code'), again = h('button', { textContent: '↻', title: 'Άλλος' }), take = h('button', { className: 'main', textContent: 'Αντιγραφή' })
    const make = () => { const b = new Uint32Array(20), A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!#$%&*+-=?@_'; let s; do { crypto.getRandomValues(b); s = [...b].map(x => A[x % A.length]).join('') } while (!(/[A-Z]/.test(s) && /[a-z]/.test(s) && /\d/.test(s) && /[^A-Za-z0-9]/.test(s))); gen.textContent = s }
    again.onclick = make; take.onclick = () => copy(gen.textContent, 'Ο κωδικός'); make()
    parts.push(h('p', { textContent: 'Σε φόρμα εγγραφής ή αλλαγής κωδικού, το Tetra τον προτείνει και μόνο του. Μόλις τον στείλεις, θα σε ρωτήσει αν θα τον αποθηκεύσει.' }), h('div', { className: 'gen' }, gen, again, take))
  }

  const auto = h('input', { type: 'checkbox', checked: autofill })
  auto.onchange = () => browser.storage.local.set({ autofill: auto.checked })
  parts.push(h('label', {}, auto, 'Αυτόματη συμπλήρωση όταν η σελίδα έχει έναν μόνο κωδικό'), h('p', { id: 'said' }))
  main.replaceChildren(...parts)
}

lockButton.onclick = async () => { await ask('lock'); show() }
browser.tabs.query({ active: true, currentWindow: true }).then(([t]) => { tab = t; show() })
