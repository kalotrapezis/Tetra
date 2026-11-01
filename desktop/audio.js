/*
 * A document made into an MP3 (the user, 1 Nov 2026: "I give the file and it gives me an mp3", to listen to lessons while
 * driving): «Διάβασέ το μου» reads it with one voice, cleaned up only; «Ραδιοφωνική εκπομπή» is a host and an expert talking it
 * through, an example and a recap a section. Mistral writes the script as JSON lines, a cheap second pass takes out what the
 * source does not say, Voxtral reads each line (cached by its hash, so a retry costs nothing), the lines are evened out and
 * joined with pauses, and lamejs makes a 64 kbps mono MP3 with ID3 chapters. Runs in main, in the background.
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { parts } = require('./attach')

const RATE = 24000 // Voxtral's PCM
const LINE_GAP = 0.35, SECTION_GAP = 1.2 // seconds
const CHARS_A_MINUTE = 900 // Greek read aloud: ~150 words of ~6 letters
const WORDS_A_MINUTE = 150
const PARALLEL = 3
const SHOW_MODEL = 'mistral-medium-latest', SMALL = 'mistral-small-latest'
const TOKEN = 3.5 // letters a token, Greek
const PRICE = { [SHOW_MODEL]: [0.4, 2.0], [SMALL]: [0.1, 0.3] }
const TTS_CHAR = 0.016 / 1000

/** How long, how much, how soon: said to the user before anything is spent. */
function estimate({ chars, mode, minutes }) {
  const show = mode === 'show'
  // a show runs about as long as one and a half readings of its source (tried: two pages made 2 minutes, not the 6 asked)
  const min = show ? Math.max(3, Math.min(60, Math.round(chars / 600), Math.round(Number(minutes) || Math.min(20, Math.max(8, chars / 2500))))) : Math.max(1, Math.round(chars / CHARS_A_MINUTE))
  const spoken = min * CHARS_A_MINUTE
  const tok = (model, inChars, outChars) => (inChars / TOKEN * PRICE[model][0] + outChars / TOKEN * PRICE[model][1]) / 1e6
  const usd = spoken * TTS_CHAR + (show ? tok(SHOW_MODEL, chars, spoken) + tok(SMALL, chars + spoken, 200) : tok(SMALL, chars, chars))
  return { minutes: min, usd, ready: Math.max(2, Math.ceil(min / 4) + (show ? 1 : 0)) }
}

/** Mistral's answer as script lines: JSON lines (or one JSON array), fences and stray text ignored. */
function parseScript(text, section = '') {
  const raw = String(text).replace(/```(?:json)?/g, '').trim()
  let items = []
  if (raw.startsWith('[')) try { items = JSON.parse(raw) } catch {}
  if (!items.length) for (const l of raw.split('\n')) { const s = l.trim().replace(/,$/, ''); if (s.startsWith('{')) try { items.push(JSON.parse(s)) } catch {} }
  const out = []
  for (const x of items) {
    const t = typeof x?.text === 'string' ? x.text.replace(/\s+/g, ' ').trim() : ''
    if (!t) continue
    section = typeof x.section === 'string' && x.section.trim() ? x.section.trim() : section
    out.push({ speaker: x.speaker === 'expert' ? 'expert' : 'host', text: t, section })
  }
  return out
}

const SPOKEN = 'Greek, spoken style, short sentences; no markdown, lists, symbols or links; numbers, dates and abbreviations written as they are said.'
function showPrompt({ name, words, first, last, focus, style }) {
  return `You write part of a Greek radio show about the document «${name}», for a student who listens while driving.
Two voices: "host" (the presenter, asks and guides) and "expert" (explains from the document).
Output only JSON lines, one per spoken line: {"speaker":"host"|"expert","text":"…","section":"<this section's short title>"}
${SPOKEN}
For each section of the source below: the host introduces it, the expert explains it, one concrete example, then a short recap by the host.
Use only what the source says. An example that is not in the source starts with «Δικό μας παράδειγμα:».
${first ? 'Start with the host welcoming the listener and saying what the document is about.' : 'Go straight on from the previous part: no welcome.'}
${last ? 'End with a short recap of the whole and a goodbye.' : 'No goodbye: the show goes on after this part.'}
About ${words} words in all: some ${Math.max(8, Math.round(words / 35))} lines of two or three sentences each. Do not stop short.${focus ? `\nFocus on: ${focus}.` : ''}${style ? `\nStyle: ${style}.` : ''}`
}
const NARRATE = `Prepare this text to be read aloud in Greek, word for word: do not summarise, shorten or explain.
Only clean up: drop page numbers, running headers and footers, reference lists and footnote marks; join lines broken by the page; write abbreviations, symbols and numbers as they are said.
Output only JSON lines, one per paragraph: {"speaker":"host","text":"…","section":"<the heading it falls under>"}`
const CHECK = `You check a radio script against its source. Give back {"unsupported":[numbers]}: the numbers of the lines that state a fact, figure, name or claim that the source does not support.
Not these: greetings, questions, transitions, recaps of what the source says, and lines starting «Δικό μας παράδειγμα».`

/** [api] with its costs recorded as [f] (Mistral.as), where it can. */
const as = (api, f) => api.as?.(f) ?? api

/** [n] at a time, in order. */
async function pool(items, n, each) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await each(items[i], i) } }))
  return out
}

/** The script: for a show, a few groups of the text (≈3 minutes each); for a reading, every part. */
async function script(api, doc, { mode, minutes, focus, style, signal, progress }) {
  const ps = parts(doc)
  let groups
  if (mode === 'show') {
    const g = Math.max(1, Math.min(10, Math.ceil(minutes / 3), ps.length)), per = Math.ceil(ps.length / g)
    groups = Array.from({ length: Math.ceil(ps.length / per) }, (_, i) => ps.slice(i * per, (i + 1) * per).map(p => p.text).join('\n'))
  } else groups = ps.map(p => p.text)
  let done = 0
  const scripts = await pool(groups, mode === 'show' ? 2 : PARALLEL, async (text, i) => {
    const sys = mode === 'show' ? showPrompt({ name: doc.name, words: Math.round(minutes * WORDS_A_MINUTE / groups.length), first: i === 0, last: i === groups.length - 1, focus, style }) : NARRATE
    let lines = parseScript(await as(api, 'script').complete([{ role: 'system', content: sys }, { role: 'user', content: text }], { model: mode === 'show' ? SHOW_MODEL : SMALL, signal }))
    let dropped = 0
    if (mode === 'show' && lines.length) {
      const said = await as(api, 'verify').complete([{ role: 'system', content: CHECK }, { role: 'user', content: `Source:\n<<<\n${text}\n>>>\nScript:\n${lines.map((l, n) => `${n + 1}. ${l.text}`).join('\n')}` }], { json: true, signal }).catch(() => '{}')
      let bad = []
      try { bad = JSON.parse(said).unsupported ?? [] } catch {}
      const drop = new Set(bad.map(Number).filter(n => n > 1)) // never the opening line
      dropped = drop.size
      lines = lines.filter((_, n) => !drop.has(n + 1))
    }
    progress({ stage: 'script', done: ++done, total: groups.length })
    return { lines, dropped }
  })
  // a section's title carries on from the part before when a part starts without one
  let section = doc.name.replace(/\.[^.]+$/, '')
  const lines = scripts.flatMap(s => s.lines).map(l => ({ ...l, section: (section = l.section || section) }))
  return { lines, dropped: scripts.reduce((n, s) => n + s.dropped, 0) }
}

/** A line cut into requests of at most [max] letters, at sentence ends. */
function pieces(text, max = 700) {
  const out = []
  let cur = ''
  for (const s of text.match(/[^.!;;…]+[.!;;…]*\s*/g) ?? [text]) {
    if (cur && cur.length + s.length > max) { out.push(cur.trim()); cur = '' }
    cur += s
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** One line read by [voice]: from the cache, else Voxtral (then kept). */
async function speak(api, voice, text, cache, signal) {
  const file = path.join(cache, crypto.createHash('sha256').update(`${voice}\n${text}`).digest('hex').slice(0, 32) + '.f32')
  try { const b = fs.readFileSync(file); return new Float32Array(b.buffer, b.byteOffset, b.length / 4) } catch {}
  const chunks = []
  for (const piece of pieces(text)) await api.speech(voice, piece, pcm => chunks.push(pcm), signal)
  const all = join(chunks)
  fs.mkdirSync(cache, { recursive: true })
  fs.writeFileSync(file, Buffer.from(all.buffer, all.byteOffset, all.byteLength))
  return all
}
function join(list) {
  const out = new Float32Array(list.reduce((n, x) => n + x.length, 0))
  let at = 0
  for (const x of list) { out.set(x, at); at += x.length }
  return out
}

/** Each line brought to the same loudness (RMS), never past the top; pauses between lines and longer ones between sections. */
function mix(lines) {
  const TARGET = 0.08
  const chapters = [], out = []
  let at = 0, section = null
  lines.forEach((l, i) => {
    if (l.section !== section) {
      if (i) { out.push(new Float32Array(Math.round(SECTION_GAP * RATE))); at += SECTION_GAP }
      chapters.push({ title: l.section, start: at }); section = l.section
    } else if (i) { out.push(new Float32Array(Math.round(LINE_GAP * RATE))); at += LINE_GAP }
    const pcm = l.pcm
    let sum = 0
    for (const x of pcm) sum += x * x
    const rms = Math.sqrt(sum / Math.max(1, pcm.length)), gain = rms > 1e-4 ? Math.min(4, TARGET / rms) : 1
    const y = new Float32Array(pcm.length)
    for (let k = 0; k < pcm.length; k++) y[k] = Math.max(-0.98, Math.min(0.98, pcm[k] * gain))
    out.push(y); at += pcm.length / RATE
  })
  for (let c = 0; c < chapters.length; c++) chapters[c].end = chapters[c + 1]?.start ?? at
  return { pcm: join(out), chapters, seconds: at }
}

/** Float samples to MP3 frames, 64 kbps mono at 24 kHz. */
async function mp3(pcm) {
  const { Mp3Encoder } = await import('@breezystack/lamejs')
  const enc = new Mp3Encoder(1, RATE, 64), out = []
  const BLOCK = 1152 * 20, s = new Int16Array(BLOCK)
  for (let i = 0; i < pcm.length; i += BLOCK) {
    const n = Math.min(BLOCK, pcm.length - i)
    for (let k = 0; k < n; k++) s[k] = pcm[i + k] * 32767
    const b = enc.encodeBuffer(n === BLOCK ? s : s.subarray(0, n))
    if (b.length) out.push(Buffer.from(b.buffer, b.byteOffset, b.length))
  }
  out.push(Buffer.from(enc.flush()))
  return Buffer.concat(out)
}

// ---- ID3v2.3: the title, the artist, and chapters (CHAP, with a CTOC listing them) that players show and skip by ----
const u16 = text => Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(text, 'utf16le'), Buffer.from([0, 0])])
function frame(id, data) { const h = Buffer.alloc(10); h.write(id, 0, 'latin1'); h.writeUInt32BE(data.length, 4); return Buffer.concat([h, data]) }
const syncsafe = n => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])
function id3({ title, artist = 'Tetra AI Assist', chapters = [] }) {
  const ms = x => { const b = Buffer.alloc(4); b.writeUInt32BE(Math.round(x * 1000)); return b }
  const z = s => Buffer.from(s + '\0', 'latin1')
  const frames = [frame('TIT2', u16(title)), frame('TPE1', u16(artist))]
  if (chapters.length) {
    frames.push(frame('CTOC', Buffer.concat([z('toc'), Buffer.from([0x03, chapters.length]), ...chapters.map((_, i) => z(`ch${i}`)), frame('TIT2', u16(title))])))
    chapters.forEach((c, i) => frames.push(frame('CHAP', Buffer.concat([z(`ch${i}`), ms(c.start), ms(c.end), Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), frame('TIT2', u16(c.title))]))))
  }
  const body = Buffer.concat(frames)
  return Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), syncsafe(body.length), body])
}
/** The tag's chapters read back (the tests'). */
function readChapters(buf) {
  const size = (buf[6] << 21) | (buf[7] << 14) | (buf[8] << 7) | buf[9], out = []
  const title = b => { let at = 0; while (at + 10 <= b.length) { const id = b.toString('latin1', at, at + 4), n = b.readUInt32BE(at + 4); if (id === 'TIT2') return b.subarray(at + 13, at + 10 + n).toString('utf16le').replace(/\0+$/, ''); at += 10 + n } return '' }
  for (let at = 10; at + 10 <= 10 + size;) {
    const id = buf.toString('latin1', at, at + 4), n = buf.readUInt32BE(at + 4)
    if (!/^[A-Z0-9]{4}$/.test(id)) break
    if (id === 'CHAP') { const d = buf.subarray(at + 10, at + 10 + n), e = d.indexOf(0); out.push({ id: d.toString('latin1', 0, e), start: d.readUInt32BE(e + 1) / 1000, end: d.readUInt32BE(e + 5) / 1000, title: title(d.subarray(e + 17)) }) }
    at += 10 + n
  }
  return out
}

const safe = s => String(s).replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Audio'

/**
 * The whole job: script, voices, mix, MP3 (and one MP3 a section when [perSection]) in [dir]. [voices]: [host, expert];
 * [progress] gets { stage, done, total }. Answers the file, the chapters and how long it is.
 */
async function make({ api, doc, mode = 'narration', minutes, focus, style, perSection = false, voices, dir, cache, progress = () => {}, signal }) {
  const est = estimate({ chars: doc.text.length, mode, minutes })
  const { lines, dropped } = await script(api, doc, { mode, minutes: est.minutes, focus, style, signal, progress })
  if (!lines.length) throw new Error('No script came back.')
  let done = 0
  const tts = as(api, 'tts')
  await pool(lines, PARALLEL, async l => {
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    l.pcm = await speak(tts, l.speaker === 'expert' ? voices[1] ?? voices[0] : voices[0], l.text, cache, signal)
    progress({ stage: 'voice', done: ++done, total: lines.length })
  })
  progress({ stage: 'mix', done: 0, total: 1 })
  const base = doc.name.replace(/\.[^.]+$/, '').replace(/_+/g, ' '), title = `${base} — ${mode === 'show' ? 'Εκπομπή' : 'Ανάγνωση'}`
  const { pcm, chapters, seconds } = mix(lines)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'script.json'), JSON.stringify({ mode, minutes: est.minutes, dropped, lines: lines.map(({ pcm, ...l }) => l) }, null, 1)) // what was said, to look at when it sounds wrong
  const file = path.join(dir, `${safe(title)}.mp3`)
  fs.writeFileSync(file, Buffer.concat([id3({ title, chapters }), await mp3(pcm)]))
  const files = [file]
  if (perSection && chapters.length > 1) {
    const secs = [...new Set(lines.map(l => l.section))]
    for (const [i, s] of secs.entries()) {
      const one = mix(lines.filter(l => l.section === s)), f = path.join(dir, `${String(i + 1).padStart(2, '0')} ${safe(s)}.mp3`)
      fs.writeFileSync(f, Buffer.concat([id3({ title: s }), await mp3(one.pcm)]))
      files.push(f)
    }
  }
  progress({ stage: 'mix', done: 1, total: 1 })
  return { file, files, title, seconds, chapters: chapters.map(c => ({ title: c.title, start: c.start })), dropped }
}

module.exports = { estimate, parseScript, pieces, mix, mp3, id3, readChapters, make, script, RATE, CHARS_A_MINUTE }
