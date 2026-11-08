'use strict'
/**
 * «Προσωπικά στοιχεία» (1 Nov 2026): a few facts the user told AI Assist to keep («θυμήσου ότι…»), put into every chat's
 * and every scheduled action's instructions. One small file every device shares, like ai.json:
 *
 *   ~/Tetra/.System/Assistant/Shared/memory.json   (synced as "AI Assist/memory.json"; the phone's AssistantMemory the same)
 *   { "facts": [{ "id", "text", "at", "source"? }], "setAt": ms, "setBy": "desktop" | "<device>" }
 *   source "auto": learnt by itself from what the user said (assistant.js learn); none: the user's own, never deleted by a tidy
 *
 * shortcut: whoever changes it writes the whole file, the later one winning, so a fact added on two devices before they sync
 * keeps only one; merge by id if that ever bites.
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const MAX = 20, LONG = 300 // they go into every request: a short list of short facts

const plain = s => String(s).toLowerCase().normalize('NFD').replace(/\p{Mn}+/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
/** Near the same fact: one's words inside the other's, or most words shared (stems: Greek endings change). */
function near(a, b) {
  const x = plain(a), y = plain(b)
  if (!x || !y) return false
  if (x.includes(y) || y.includes(x)) return true
  const w = s => new Set(s.split(' ').filter(t => t.length > 2).map(t => t.slice(0, 5)))
  const p = w(x), q = w(y), both = [...p].filter(t => q.has(t)).length
  return both / Math.max(1, Math.min(p.size, q.size)) >= 0.85 // "his daughter is Eleni" and "… Maria" share 3 of 4: two facts
}

class Memory {
  constructor(file, by = 'desktop') { this.file = file; this.by = by }
  list() {
    try { return (JSON.parse(fs.readFileSync(this.file, 'utf8')).facts ?? []).filter(f => f && typeof f.text === 'string' && f.text.trim()) } catch { return [] }
  }
  write(facts) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const part = path.join(path.dirname(this.file), `.${path.basename(this.file)}.part`)
    fs.writeFileSync(part, JSON.stringify({ facts, setAt: Date.now(), setBy: this.by }, null, 2)); fs.renameSync(part, this.file)
    return facts
  }
  /**
   * A new fact, or the one already saved with the same words. [source] "auto" (learnt by itself): a near one already kept,
   * or a full list, keeps nothing and answers null.
   */
  add(text, source = null) {
    const t = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, LONG), facts = this.list()
    if (!t) throw new Error('Say what to remember.')
    const same = facts.find(f => f.text.toLowerCase() === t.toLowerCase())
    if (same) return same
    if (source === 'auto' && (facts.length >= MAX || facts.some(f => near(f.text, t)))) return null
    if (facts.length >= MAX) throw new Error(`Already ${MAX} facts kept: forget one first.`)
    const f = { id: crypto.randomUUID(), text: t, at: Date.now(), ...(source ? { source } : {}) }
    this.write([...facts, f])
    return f
  }
  /** Its words changed; empty words forget it. */
  change(id, text) {
    const t = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, LONG)
    return this.write(this.list().flatMap(f => f.id !== id ? [f] : t ? [{ ...f, text: t }] : []))
  }
  forget(id) { return this.change(id, '') }
}

module.exports = { Memory, MAX, LONG, near }
