'use strict'
// AI Assist's attached files (attach.js) and the MP3 made of them (audio.js): each format read, the context caps, the script
// parse, the MP3 and its ID3 chapters, and that a file's text never stays in the chat's history.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { zipSync, strToU8 } = require('fflate')
const attach = require('../attach')
const audio = require('../audio')
const { Chat, Tools } = require('../assistant')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attach-'))
const put = (name, data) => { const f = path.join(dir, name); fs.writeFileSync(f, data); return f }
const zip = files => Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))))

test('text, markdown and csv are read as they are; markdown headings kept', async () => {
  const d = await attach.extract(put('Σημειώσεις.md', '# Εισαγωγή\nΗ μάθηση.\n## Θεωρίες\nΟ Piaget.'))
  assert.equal(d.text, '# Εισαγωγή\nΗ μάθηση.\n## Θεωρίες\nΟ Piaget.')
  assert.deepEqual(d.headings, ['Εισαγωγή', 'Θεωρίες'])
  assert.equal((await attach.extract(put('a.csv', 'x;y\n1;2'))).text, 'x;y\n1;2')
})

test('docx: paragraphs, tabs, entities and heading styles', async () => {
  const p = (text, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
  const body = p('Κεφάλαιο 1', 'Heading1') + p('Ο Vygotsky &amp; η ΖΕΑ') + '<w:p><w:r><w:t>α</w:t></w:r><w:r><w:tab/><w:t>β</w:t></w:r></w:p><w:p/>' + p('Τέλος', 'Title')
  const d = await attach.extract(put('Μάθημα.docx', zip({ 'word/document.xml': `<w:document><w:body>${body}</w:body></w:document>` })))
  assert.equal(d.text, 'Κεφάλαιο 1\nΟ Vygotsky & η ΖΕΑ\nα\tβ\nΤέλος')
  assert.deepEqual(d.headings, ['Κεφάλαιο 1', 'Τέλος'])
})

test('pptx: a page a slide, in slide order (10 after 2), titles as headings', async () => {
  const slide = (...ps) => `<p:sld>${ps.map(x => `<a:p><a:r><a:t>${x}</a:t></a:r></a:p>`).join('')}</p:sld>`
  const d = await attach.extract(put('Δ.pptx', zip({ 'ppt/slides/slide10.xml': slide('Τρίτη'), 'ppt/slides/slide2.xml': slide('Δεύτερη', 'κείμενο'), 'ppt/slides/slide1.xml': slide('Πρώτη') })))
  assert.equal(d.pages, 3)
  assert.deepEqual(d.pageTexts, ['Πρώτη', 'Δεύτερη\nκείμενο', 'Τρίτη'])
  assert.deepEqual(d.headings, ['Πρώτη', 'Δεύτερη', 'Τρίτη'])
})

test('odt: headings and paragraphs, spaces and tabs', async () => {
  const xml = '<office:document-content><office:body><office:text><text:h text:outline-level="1">Θέμα</text:h><text:p>α<text:s/>β<text:tab/>γ</text:p></office:text></office:body></office:document-content>'
  const d = await attach.extract(put('Ε.odt', zip({ 'content.xml': xml })))
  assert.equal(d.text, 'Θέμα\nα β\tγ')
  assert.deepEqual(d.headings, ['Θέμα'])
})

test('pdf: its text by page; a scan goes to OCR; unknown kinds and empty files are said', async () => {
  // a two-page PDF with text, written by hand (Helvetica, no fonts embedded)
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R /Resources << /Font << /F1 7 0 R >> >> >>', null,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>', null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  const stream = s => `<< /Length ${s.length} >>\nstream\n${s}\nendstream`
  objs[3] = stream('BT /F1 12 Tf 20 250 Td (First page of the lesson about learning) Tj ET')
  objs[5] = stream('BT /F1 12 Tf 20 250 Td (Second page with the theory of Piaget) Tj ET')
  let out = '%PDF-1.4\n', xref = []
  objs.forEach((o, i) => { xref.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const at = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${xref.map(x => String(x).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${at}\n%%EOF`
  const d = await attach.extract(put('lesson.pdf', out))
  assert.equal(d.pages, 2)
  assert.match(d.pageTexts[0], /First page of the lesson/)
  assert.match(d.pageTexts[1], /theory of Piaget/)
  // a scan (a picture): OCR's pages
  const png = put('scan.png', Buffer.from('89504e470d0a1a0a', 'hex'))
  assert.deepEqual((await attach.extract(png, { ocr: async (_, mime) => [`read ${mime}`] })).text, 'read image/png')
  await assert.rejects(attach.extract(png), /attach.scan/)
  await assert.rejects(attach.extract(put('x.exe', 'MZ')), /attach.unknown/)
  await assert.rejects(attach.extract(put('blank.txt', '  \n ')), /attach.empty/)
})

test('caps: a small file goes in whole; a large one as its start, headings and attachment_read; past MAX_CHARS it is cut and said', async () => {
  const small = await attach.extract(put('s.txt', 'Λίγο κείμενο.'))
  assert.ok(attach.small(small))
  assert.match(attach.forModel(small), /<<<\nΛίγο κείμενο.\n>>>/)
  const para = 'Η θεωρία της μάθησης εξηγεί πώς μαθαίνουμε. '.repeat(20) // ~900 letters
  const big = await attach.extract(put('b.md', Array.from({ length: 60 }, (_, i) => `# Ενότητα ${i + 1}\n${i === 41 ? 'Ο Bandura και η κοινωνική μάθηση.\n' : ''}${para}`).join('\n')))
  assert.ok(!attach.small(big))
  const said = attach.forModel(big), ps = attach.parts(big)
  assert.ok(said.length < 6000, `too much inline: ${said.length}`)
  assert.match(said, new RegExp(`attachment_read: part 1–${ps.length}`))
  assert.match(said, /Ενότητα 1 · Ενότητα 2/)
  assert.ok(ps.every(p => p.text.length <= attach.PART * 1.5))
  assert.equal(ps.map(p => p.text).join('\n'), big.text)
  assert.match(attach.read(big, { part: 2 }), /^Part 2 of \d+/)
  assert.match(attach.read(big, { part: 99 }), /No part 99/)
  assert.match(attach.read(big, { query: 'Bandura κοινωνικής' }), /\[part \d+\] Ο Bandura και η κοινωνική μάθηση/)
  const huge = await attach.extract(put('h.txt', 'α'.repeat(attach.MAX_CHARS + 10)))
  assert.ok(huge.cut); assert.equal(huge.text.length, attach.MAX_CHARS)
  assert.match(attach.forModel(huge), /only its first 600000 characters/)
  const sparse = put('z.txt', ''); fs.truncateSync(sparse, attach.MAX_BYTES + 1) // sparse: no 50 MB written
  await assert.rejects(attach.extract(sparse), /attach.tooBig/)
})

test('the file\'s text goes with one turn only: the history and a kept chat hold its name; attachment_read reads it again', async () => {
  const doc = await attach.extract(put('Μάθημα 3.txt', 'ΜΥΣΤΙΚΟ κείμενο του μαθήματος.'))
  const seen = []
  const api = { bill: { reset() {} }, async chat(messages) {
    seen.push(JSON.stringify(messages))
    return seen.length === 1 ? { role: 'assistant', content: '', tool_calls: [{ id: 'a', function: { name: 'attachment_read', arguments: '{"part":1}' } }] } : { role: 'assistant', content: 'Εντάξει.' }
  } }
  const tools = new Tools({ extract: async () => doc })
  const chat = new Chat(api, tools)
  assert.equal((await chat.ask('Τι λέει;', null, doc)).text, 'Εντάξει.')
  assert.match(seen[0], /ΜΥΣΤΙΚΟ/) // in the turn itself
  assert.ok(!JSON.stringify(chat.messages).includes('ΜΥΣΤΙΚΟ'), 'the text stayed in the history')
  assert.match(chat.messages[0].content, /\[Attached file: Μάθημα 3.txt; its text is not kept here/)
  await chat.ask('Και μετά;')
  assert.ok(!seen.at(-1).includes('ΜΥΣΤΙΚΟ'))
  // a kept chat back: only the path, read again when asked
  tools.doc = { name: doc.name, path: doc.path }
  assert.match((await tools.run('attachment_read', { query: 'μαθήματος' })).forModel, /ΜΥΣΤΙΚΟ/)
})

test('audio_make answers an estimate and a card, nothing spent', async () => {
  const doc = await attach.extract(put('Δ.txt', 'α'.repeat(9000)))
  const tools = new Tools({ extract: async () => doc })
  tools.doc = doc
  const r = await tools.run('audio_make', { mode: 'narration' })
  assert.match(r.forModel, /≈ 10 minutes of audio, ≈ €0\.\d\d, ready in ~3 minutes/)
  assert.equal(r.audio.mode, 'narration')
  assert.equal(r.audio.path, doc.path)
  const show = audio.estimate({ chars: 60000, mode: 'show', minutes: 15 })
  assert.equal(show.minutes, 15)
  assert.ok(show.usd > 0.2 && show.usd < 0.35, `show costs ${show.usd}`) // ≈ $0.93 an hour of speech, and the script
  assert.equal(show.ready, 5)
  assert.match((await new Tools({}).run('audio_make', { mode: 'show' })).forModel, /No file/)
})

test('the script: JSON lines, an array, fences and stray words; sections carry on', () => {
  const lines = audio.parseScript('Εδώ το σενάριο:\n```json\n{"speaker":"host","text":"Καλώς ήρθατε.","section":"Αρχή"}\n{"speaker":"expert","text":"  Η μάθηση  είναι…"},\n{"speaker":"x","text":""}\nnot json\n```')
  assert.deepEqual(lines, [{ speaker: 'host', text: 'Καλώς ήρθατε.', section: 'Αρχή' }, { speaker: 'expert', text: 'Η μάθηση είναι…', section: 'Αρχή' }])
  assert.deepEqual(audio.parseScript('[{"speaker":"expert","text":"Α","section":"Β"}]'), [{ speaker: 'expert', text: 'Α', section: 'Β' }])
  assert.deepEqual(audio.parseScript('nothing'), [])
  assert.deepEqual(audio.pieces('Α. '.repeat(400), 700).map(p => p.length <= 700), Array(audio.pieces('Α. '.repeat(400), 700).length).fill(true))
})

test('mix: even loudness, pauses, chapters; the MP3 starts with an ID3 tag whose chapters read back', async () => {
  const tone = (n, a) => Float32Array.from({ length: n }, (_, i) => a * Math.sin(i / 5))
  const m = audio.mix([{ section: 'Α', pcm: tone(24000, 0.5) }, { section: 'Α', pcm: tone(24000, 0.05) }, { section: 'Β', pcm: tone(12000, 0.2) }])
  assert.equal(m.seconds.toFixed(2), (1 + 0.35 + 1 + 1.2 + 0.5).toFixed(2))
  assert.deepEqual(m.chapters.map(c => [c.title, +c.start.toFixed(2), +c.end.toFixed(2)]), [['Α', 0, 3.55], ['Β', 3.55, 4.05]])
  const rms = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += m.pcm[i] ** 2; return Math.sqrt(s / (b - a)) }
  assert.ok(Math.abs(rms(0, 24000) - rms(32400, 56400)) < 0.01, 'the quiet line was not brought up') // 0.35 s after the first
  const tag = audio.id3({ title: 'Μάθημα — Εκπομπή', chapters: m.chapters })
  const mp3 = Buffer.concat([tag, await audio.mp3(m.pcm)])
  assert.equal(mp3.toString('latin1', 0, 3), 'ID3')
  const size = (mp3[6] << 21) | (mp3[7] << 14) | (mp3[8] << 7) | mp3[9]
  assert.equal(mp3[10 + size], 0xff); assert.equal(mp3[11 + size] & 0xe0, 0xe0) // an MPEG frame right after the tag
  assert.deepEqual(audio.readChapters(mp3).map(c => [c.id, c.title, c.start, c.end]), [['ch0', 'Α', 0, 3.55], ['ch1', 'Β', 3.55, 4.05]])
  // ~64 kbps: 4 s of sound is about 32 KB
  assert.ok(mp3.length - tag.length > 20_000 && mp3.length - tag.length < 45_000, `${mp3.length}`)
})
