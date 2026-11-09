/**
 * On every page: fills a login from Tetra (by itself when the site has exactly one and autofill is on), offers a strong
 * password on a sign-up or change-password field, and tells background.js what was typed when a login form is sent.
 */
(() => {
  if (window.__tetraPasswords) return
  window.__tetraPasswords = true

  const visible = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden'
  const passwordsIn = root => [...root.querySelectorAll('input[type=password]')].filter(visible)
  const isNew = el => /new-password/i.test(el.autocomplete) || (el.form && passwordsIn(el.form).length >= 2) || /new|confirm|repeat|signup|register/i.test(el.name + ' ' + el.id)

  /** The username box of [pw]: the last visible text, e-mail or tel box before it in its form (or page). */
  function userFor(pw) {
    const boxes = [...(pw.form ?? document).querySelectorAll('input')].filter(i => visible(i) && (/^(text|email|tel)$/.test(i.type) || /username|email/.test(i.autocomplete)))
    return boxes.filter(i => i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING).pop() ?? null
  }

  // set as a person would type it: the page's own listeners (React, Vue) see an input
  function put(el, value) {
    if (!el) return
    el.focus()
    el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function fill({ user, password }) {
    const pws = passwordsIn(document).filter(p => !isNew(p) || passwordsIn(document).length === 1)
    const pw = pws[0]
    const u = pw ? userFor(pw) : [...document.querySelectorAll('input[type=email],input[autocomplete=username],input[name*=user i],input[name*=email i]')].find(visible)
    if (u && user) put(u, user)
    if (pw) put(pw, password)
    return !!(pw || u)
  }

  function fillCode(code) {
    const boxes = [...document.querySelectorAll('input')].filter(visible)
    const box = boxes.find(i => i.autocomplete === 'one-time-code') ?? boxes.find(i => /otp|totp|2fa|mfa|code|token|pin/i.test(i.name + ' ' + i.id) && i.type !== 'password' && i.type !== 'hidden')
      ?? (document.activeElement instanceof HTMLInputElement ? document.activeElement : null)
    if (box) put(box, code)
    return !!box
  }

  // ---- a strong password, offered on a new-password field ----
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!#$%&*+-=?@_'
  function strong(n = 20) {
    for (;;) {
      const out = [], b = new Uint8Array(n * 2)
      crypto.getRandomValues(b)
      for (const x of b) { if (x < 256 - 256 % ALPHABET.length) out.push(ALPHABET[x % ALPHABET.length]); if (out.length === n) break }
      const s = out.join('')
      if (s.length === n && /[A-Z]/.test(s) && /[a-z]/.test(s) && /\d/.test(s) && /[^A-Za-z0-9]/.test(s)) return s // sites ask for every kind
    }
  }
  let chip = null
  function offer(pw) {
    chip?.remove()
    const value = strong()
    chip = document.createElement('div')
    chip.setAttribute('style', 'all:initial;position:absolute;z-index:2147483647;background:#fff;color:#111;border:1px solid #bbb;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.2);padding:6px 10px;font:13px system-ui,sans-serif;cursor:pointer;')
    chip.textContent = '🔑 Tetra: ισχυρός κωδικός — ' + value.slice(0, 6) + '… (πάτα για χρήση)'
    const r = pw.getBoundingClientRect()
    chip.style.left = `${r.left + scrollX}px`; chip.style.top = `${r.bottom + scrollY + 4}px`
    chip.addEventListener('mousedown', e => {
      e.preventDefault()
      for (const p of passwordsIn(pw.form ?? document)) if (isNew(p) || p === pw) put(p, value) // the password and its "repeat" box
      chip.remove(); chip = null
    })
    document.body.append(chip)
  }
  document.addEventListener('focusin', e => {
    const el = e.target
    if (el instanceof HTMLInputElement && el.type === 'password' && isNew(el) && !el.value) offer(el)
  })
  document.addEventListener('focusout', () => setTimeout(() => { if (chip && !(document.activeElement?.type === 'password')) { chip.remove(); chip = null } }, 200))

  // ---- what was typed, when a login form goes ----
  let told = ''
  function sent(root) {
    const pws = passwordsIn(root).filter(p => p.value)
    if (!pws.length) return
    const pw = pws.find(isNew) ?? pws[0] // a change-password form: the new one
    const user = (userFor(pws[0])?.value ?? '').trim()
    const key = user + '\n' + pw.value
    if (key === told) return
    told = key
    browser.runtime.sendMessage({ type: 'submitted', host: location.hostname, user, password: pw.value })
  }
  document.addEventListener('submit', e => sent(e.target), true)
  // many sites send with a script, never a submit: a click on a button, or Enter in the password box
  document.addEventListener('click', e => { const b = e.target.closest?.('button,input[type=submit],[role=button]'); if (b) sent(b.form ?? document) }, true)
  document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.type === 'password') sent(e.target.form ?? document) }, true)

  // ---- filled by itself: one login for this site, autofill on ----
  let filled = false
  async function auto() {
    if (filled || !passwordsIn(document).some(p => !isNew(p) && !p.value)) return
    filled = true
    const { logins, autofill } = await browser.runtime.sendMessage({ type: 'logins', host: location.hostname })
    if (autofill && logins.length === 1) fill(logins[0])
  }
  auto()
  let wait = null
  new MutationObserver(() => { if (!filled) { clearTimeout(wait); wait = setTimeout(auto, 500) } }).observe(document.documentElement, { childList: true, subtree: true })

  browser.runtime.onMessage.addListener(m => {
    if (m.type === 'fill') return Promise.resolve(fill(m))
    if (m.type === 'code') return Promise.resolve(fillCode(m.code))
  })
})()
