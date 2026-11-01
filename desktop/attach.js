/*
 * A file attached to AI Assist (the user, 1 Nov 2026: "the chat needs a send File button"): its text read here, in place, and
 * what the model is given of it. A small file goes in once, whole; a larger one as its name, pages, headings and first page,
 * the rest read on demand (attachment_read). The text never stays in the chat's history: assistant.js takes it out after the turn.
 */
const fs = require('node:fs')
const path = require('node:path')
const { unzipSync, strFromU8 } = require('fflate')

const MAX_BYTES = 50 * 1024 * 1024 // Mistral OCR's own limit too
const MAX_CHARS = 600_000 // ~150k tokens, a 300-page book; past it only the start is kept, and said
const INLINE = 32_000 // ~8,000 tokens: goes in whole
const PART = 6_000 // what one attachment_read gives

const KINDS = { txt: 'text', md: 'text', csv: 'text', tsv: 'text', docx: 'docx', pptx: 'pptx', odt: 'odf', odp: 'odf', pdf: 'pdf', png: 'image', jpg: 'image', jpeg: 'image', webp: 'image' }
const kindOf = name => KINDS[path.extname(name).slice(1).toLowerCase()] ?? null

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unxml = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m)
const tags = s => unxml(s.replace(/<[^>]+>/g, ''))

/** Word: paragraphs, those styled as headings or a title kept as headings. */
function docx(zip) {
  const xml = strFromU8(zip['word/document.xml'] ?? new Uint8Array())
  const lines = [], headings = []
  for (const [, p] of xml.matchAll(/<w:p[ >]([\s\S]*?)<\/w:p>/g)) {
    const text = [...p.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)].map(m => m[1] != null ? unxml(m[1]) : m[0].includes('tab') ? '\t' : '\n').join('').trim()
    if (!text) continue
    if (/<w:pStyle w:val="(?:Heading|Title|Επικεφαλ|heading|title)/.test(p)) headings.push(text)
    lines.push(text)
  }
  return { pages: [lines.join('\n')], headings }
}
/** PowerPoint: a page a slide, its first line (the title) a heading. */
function pptx(zip) {
  const slides = Object.keys(zip).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0])
  const pages = slides.map(n => [...strFromU8(zip[n]).matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map(([, p]) => [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => unxml(m[1])).join('')).filter(l => l.trim()).join('\n'))
  return { pages, headings: pages.map(p => p.split('\n')[0]).filter(Boolean) }
}
/** OpenDocument text and slides. */
function odf(zip) {
  const xml = strFromU8(zip['content.xml'] ?? new Uint8Array()).replace(/<text:s(?: [^>]*)?\/>/g, ' ').replace(/<text:tab\/>/g, '\t').replace(/<text:line-break\/>/g, '\n')
  const headings = [...xml.matchAll(/<text:h[ >][\s\S]*?<\/text:h>/g)].map(m => tags(m[0]).trim()).filter(Boolean)
  const para = s => [...s.matchAll(/<text:(?:p|h)[ >][\s\S]*?<\/text:(?:p|h)>/g)].map(m => tags(m[0]).trim()).filter(Boolean).join('\n')
  const slides = [...xml.matchAll(/<draw:page[ >][\s\S]*?<\/draw:page>/g)].map(m => para(m[0]))
  return { pages: slides.length ? slides : [para(xml)], headings }
}
async function pdf(buf) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }), doc = await task.promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent()
    pages.push(c.items.map(x => (x.str ?? '') + (x.hasEOL ? '\n' : '')).join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim())
  }
  await task.destroy()
  return { pages, headings: [] }
}

/**
 * The file's text as pages. [ocr](buffer, mime) reads a scan or a picture (Mistral OCR); a PDF with almost no text is a scan.
 * Throws a sentence for the user when it cannot.
 */
async function extract(full, { ocr = null, t = k => k } = {}) {
  const name = path.basename(full), kind = kindOf(name)
  if (!kind) throw new Error(t('attach.unknown'))
  const size = fs.statSync(full).size
  if (size > MAX_BYTES) throw new Error(t('attach.tooBig', { mb: MAX_BYTES >> 20 }))
  const buf = fs.readFileSync(full)
  let r
  if (kind === 'text') r = { pages: [buf.toString('utf8')], headings: buf.toString('utf8').split('\n').filter(l => /^#{1,3}\s/.test(l)).map(l => l.replace(/^#+\s*/, '')) }
  else if (kind === 'pdf') r = await pdf(buf)
  else if (kind === 'image') r = null
  else { const zip = unzipSync(new Uint8Array(buf)); r = kind === 'docx' ? docx(zip) : kind === 'pptx' ? pptx(zip) : odf(zip) }
  const scanned = !r || (kind === 'pdf' && r.pages.join('').replace(/\s/g, '').length < 20 * r.pages.length)
  if (scanned) {
    if (!ocr) throw new Error(t('attach.scan'))
    r = { pages: await ocr(buf, kind === 'pdf' ? 'application/pdf' : `image/${path.extname(name).slice(1).toLowerCase().replace('jpg', 'jpeg')}`), headings: [] }
    r.headings = r.pages.flatMap(p => p.split('\n').filter(l => /^#{1,3}\s/.test(l)).map(l => l.replace(/^#+\s*/, '')))
  }
  let pages = r.pages.map(p => p.trim()), total = 0, cut = false
  pages = pages.filter(p => { if (total >= MAX_CHARS) { cut = true; return false } total += p.length; return true })
  if (total > MAX_CHARS) { cut = true; pages[pages.length - 1] = pages.at(-1).slice(0, pages.at(-1).length - (total - MAX_CHARS)) }
  const text = pages.join('\n\n')
  if (!text.replace(/\s/g, '')) throw new Error(t('attach.empty'))
  return { name, path: full, pages: pages.length, pageTexts: pages, text, headings: r.headings.slice(0, 60), cut, scanned, kind }
}

/** The text in parts of about PART letters, cut at paragraphs; each knows its pages. */
function parts(doc) {
  const out = []
  let cur = { text: '', from: 1, to: 1 }
  doc.pageTexts.forEach((page, i) => {
    for (const para of page.split(/\n(?=\S)/)) {
      if (cur.text.length + para.length > PART && cur.text) { out.push(cur); cur = { text: '', from: i + 1, to: i + 1 } }
      cur.text += (cur.text ? '\n' : '') + para; cur.to = i + 1
    }
  })
  if (cur.text) out.push(cur)
  // a paragraph longer than a part (a PDF without line ends) cut by length
  return out.flatMap(p => p.text.length <= PART * 1.5 ? [p] : Array.from({ length: Math.ceil(p.text.length / PART) }, (_, k) => ({ ...p, text: p.text.slice(k * PART, (k + 1) * PART) })))
}

const small = doc => doc.text.length <= INLINE
const pagesSaid = doc => doc.kind === 'docx' || doc.kind === 'text' ? '' : `, ${doc.pages} page(s)`

/** What goes with the user's message, this turn only. */
function forModel(doc) {
  const head = `[Attached file: ${doc.name}${pagesSaid(doc)}${doc.cut ? `; only its first ${MAX_CHARS} characters were read (it is longer)` : ''}]`
  if (small(doc)) return `${head}\n<<<\n${doc.text}\n>>>`
  const ps = parts(doc)
  return `${head}\nIt is long (${doc.text.length} characters), so only its start is here. Read more with attachment_read: part 1–${ps.length}, or a query for the passages about something.` +
    (doc.headings.length ? `\nHeadings: ${doc.headings.join(' · ')}` : '') + `\nFirst page:\n<<<\n${doc.pageTexts[0].slice(0, 3000)}\n>>>`
}
/** What stays in the history instead. */
const kept = doc => `[Attached file: ${doc.name}${pagesSaid(doc)}; its text is not kept here: attachment_read reads it again]`

const plain = s => String(s).toLowerCase().normalize('NFD').replace(/\p{Mn}+/gu, '')
/** One part, or the paragraphs that have most of the query's words (their first five letters: Greek endings change). */
function read(doc, { part, query } = {}) {
  const ps = parts(doc)
  if (part != null && !query) {
    const p = ps[Number(part) - 1]
    return p ? `Part ${part} of ${ps.length} (pages ${p.from}–${p.to}):\n${p.text}` : `No part ${part}: there are ${ps.length}.`
  }
  const words = plain(query ?? '').split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2).map(w => w.slice(0, 5))
  if (!words.length) return `Say a part (1–${ps.length}) or what to look for.`
  const hits = ps.flatMap((p, n) => p.text.split(/\n+/).map(para => ({ para, n, score: words.filter(w => plain(para).includes(w)).length })))
    .filter(h => h.score).sort((a, b) => b.score - a.score)
  let out = '', count = 0
  for (const h of hits) { if (out.length + h.para.length > PART) break; out += `[part ${h.n + 1}] ${h.para}\n`; count++ }
  return count ? out.trim() : `Nothing about "${query}" in ${doc.name}.`
}

module.exports = { extract, parts, forModel, kept, read, small, kindOf, MAX_BYTES, MAX_CHARS, INLINE, PART, docx, pptx, odf }
