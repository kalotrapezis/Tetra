'use strict'
/**
 * A map as one file, <id>.tetramap (the user, 10 Nov: "transfer maps by USB"): the phone's format (Tetra-mobile MapsArchive.kt),
 * so a map made here goes to a phone by cable and back. A ZIP whose first entry is the manifest:
 *
 *   tetramap.json  {"format":1,"id":"greece","name":"Greece","built":"2026-10-21","bounds":[w,s,e,n],
 *                   "files":[{"path":"greece.pmtiles","size":508325761,"sha256":"…"},…]}
 *
 * then the map's files under their paths in the Maps folder: <id>.pmtiles, <id>.json, <id>-gh/… (the routing graph),
 * <id>-<kind>.tsv and each <a>_<b>-crossings.tsv it is in. Written here stored (the map is compressed already, and every
 * entry's sizes then go before it, which is what the phone's reader wants); read either way, as the phone deflates some.
 * An import is a file from elsewhere: every path must be one of the map's own, every size and SHA-256 the manifest's, all in a
 * hidden folder first, and only then is the map put in place.
 */
const fs = require('node:fs')
const fsp = fs.promises
const path = require('node:path')
const crypto = require('node:crypto')
const zlib = require('node:zlib')

const FORMAT = 1
const MANIFEST = 'tetramap.json'
const MANIFEST_MAX = 4 << 20
const TEMP = '.tetramap-'
// shortcut: no ZIP64 here — a map over 4 GB is refused (Greece is 0.6 GB); add ZIP64 when a country needs it
const ZIP32 = 0xffffffff

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/
const SHA = /^[0-9a-f]{64}$/
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const own = id => new RegExp(`^${esc(id)}(\\.pmtiles|\\.json|-gh|-[a-z]+\\.tsv)$`)
const PAIR = /^([a-z0-9-]+)_([a-z0-9-]+)-crossings\.tsv$/
const crossing = (id, n) => { const m = PAIR.exec(n); return !!m && (m[1] === id || m[2] === id) }

/** The files of map `id` in `root`, relative to it: its own and the border crossings it is in. */
async function files(root, id) {
  const out = []
  for (const n of (await fsp.readdir(root)).sort()) {
    const f = path.join(root, n), st = await fsp.stat(f).catch(() => null)
    if (!st) continue
    if (n.endsWith('-gh') && own(id).test(n) && st.isDirectory()) {
      for (const g of (await fsp.readdir(f)).sort()) if (!g.startsWith('.') && (await fsp.stat(path.join(f, g))).isFile()) out.push(`${n}/${g}`)
    } else if ((own(id).test(n) || crossing(id, n)) && st.isFile()) out.push(n)
  }
  return out
}

/** Whether `p`, from an archive of map `id`, is one of its files: nothing outside the Maps folder, nothing of another map's. */
function allowed(id, p) {
  if (typeof p !== 'string' || /[\\:\0]/.test(p) || p.startsWith('/')) return false
  const parts = p.split('/')
  if (parts.some(x => !x || x.startsWith('.'))) return false
  return parts[0].endsWith('-gh') ? parts.length === 2 && own(id).test(parts[0]) : parts.length === 1 && (own(id).test(parts[0]) || crossing(id, parts[0]))
}

/** Size, SHA-256 and CRC-32 of a file, read once. */
async function measure(f, onBytes) {
  const sha = crypto.createHash('sha256'); let crc = 0, size = 0
  for await (const b of fs.createReadStream(f, { highWaterMark: 1 << 20 })) { sha.update(b); crc = zlib.crc32(b, crc); size += b.length; onBytes(b.length) }
  return { size, sha256: sha.digest('hex'), crc }
}

const dosTime = d => ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff
const dosDate = d => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff

/** A ZIP local file header (stored, sizes known, UTF-8 names). */
function localHeader(name, size, crc, when) {
  const n = Buffer.from(name, 'utf8'), h = Buffer.alloc(30)
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(10, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8)
  h.writeUInt16LE(dosTime(when), 10); h.writeUInt16LE(dosDate(when), 12); h.writeUInt32LE(crc >>> 0, 14)
  h.writeUInt32LE(size, 18); h.writeUInt32LE(size, 22); h.writeUInt16LE(n.length, 26); h.writeUInt16LE(0, 28)
  return Buffer.concat([h, n])
}

function centralHeader(name, size, crc, when, offset) {
  const n = Buffer.from(name, 'utf8'), h = Buffer.alloc(46)
  h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(0x031e, 4); h.writeUInt16LE(10, 6); h.writeUInt16LE(0x0800, 8); h.writeUInt16LE(0, 10)
  h.writeUInt16LE(dosTime(when), 12); h.writeUInt16LE(dosDate(when), 14); h.writeUInt32LE(crc >>> 0, 16)
  h.writeUInt32LE(size, 20); h.writeUInt32LE(size, 24); h.writeUInt16LE(n.length, 28)
  h.writeUInt32LE((0o100644 << 16) >>> 0, 38); h.writeUInt32LE(offset, 42)
  return Buffer.concat([h, n])
}

/**
 * Map `id` of `root` (with its `pack`: name, built, bounds) into the file `out`; `progress(0..1)`. Written to `out`.part and
 * renamed, so a half-written file never has the name.
 */
async function exportMap(root, id, out, pack = {}, progress = () => {}) {
  const paths = await files(root, id)
  if (!paths.includes(`${id}.pmtiles`)) throw new Error(`There is no map ${id}.`)
  const sizes = await Promise.all(paths.map(p => fsp.stat(path.join(root, p)).then(s => s.size)))
  const total = sizes.reduce((a, b) => a + b, 0) * 2 // each file read twice: measured first, as the manifest goes first
  if (total / 2 > ZIP32) throw new Error('This map is over 4 GB, more than this computer can put in one file yet.')
  let done = 0, shown = -1
  const tick = n => { done += n; const p = Math.floor(done * 100 / total); if (p !== shown) { shown = p; progress(p / 100) } }
  const items = []
  for (const p of paths) items.push({ path: p, ...(await measure(path.join(root, p), tick)) })
  const manifest = Buffer.from(JSON.stringify({ format: FORMAT, id, name: pack.name || id, built: pack.built || '', ...(Array.isArray(pack.bounds) && pack.bounds.length === 4 ? { bounds: pack.bounds } : {}),
    files: items.map(({ path: p, size, sha256 }) => ({ path: p, size, sha256 })) }, null, 1) + '\n')
  const part = `${out}.part`
  const w = fs.createWriteStream(part)
  const write = b => new Promise((ok, no) => w.write(b, e => e ? no(e) : ok()))
  const central = []; let offset = 0
  const entry = async (name, size, crc, when, body) => {
    const h = localHeader(name, size, crc, when)
    central.push(centralHeader(name, size, crc, when, offset))
    await write(h); offset += h.length
    await body(); offset += size
  }
  try {
    const now = new Date()
    await entry(MANIFEST, manifest.length, zlib.crc32(manifest), now, () => write(manifest))
    for (const it of items) {
      const f = path.join(root, it.path), when = (await fsp.stat(f)).mtime
      await entry(it.path, it.size, it.crc, when, async () => {
        const sha = crypto.createHash('sha256'); let n = 0
        for await (const b of fs.createReadStream(f, { highWaterMark: 1 << 20 })) { sha.update(b); n += b.length; await write(b); tick(b.length) }
        if (n !== it.size || sha.digest('hex') !== it.sha256) throw new Error(`${it.path} changed while it was exported.`)
      })
    }
    if (offset > ZIP32) throw new Error('This map is over 4 GB, more than this computer can put in one file yet.')
    const cd = Buffer.concat(central), end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10)
    end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
    await write(cd); await write(end)
    await new Promise((ok, no) => w.end(e => e ? no(e) : ok()))
    await fsp.rename(part, out)
  } catch (e) {
    w.destroy(); await fsp.rm(part, { force: true }); throw e
  }
  progress(1)
  return { files: items.length, bytes: total / 2 }
}

/** The ZIP's entries from its central directory: name, method, sizes, where its data begins. */
async function entries(fh, length) {
  const tailLen = Math.min(length, 22 + 0xffff), tail = Buffer.alloc(tailLen)
  await fh.read(tail, 0, tailLen, length - tailLen)
  const at = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (at < 0) throw new Error('Not a Tetra map: it is not a ZIP file.')
  const count = tail.readUInt16LE(at + 10), cdSize = tail.readUInt32LE(at + 12), cdAt = tail.readUInt32LE(at + 16)
  if (count === 0xffff || cdAt === ZIP32 || cdSize === ZIP32) throw new Error('This map is over 4 GB, more than this computer can read yet.')
  if (cdAt + cdSize > length) throw new Error('The file is cut short.')
  const cd = Buffer.alloc(cdSize); await fh.read(cd, 0, cdSize, cdAt)
  const out = []; let p = 0
  for (let i = 0; i < count; i++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('The file is damaged (its list of contents).')
    const flags = cd.readUInt16LE(p + 8), method = cd.readUInt16LE(p + 10)
    const csize = cd.readUInt32LE(p + 20), size = cd.readUInt32LE(p + 24)
    const nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32), local = cd.readUInt32LE(p + 42)
    if ([csize, size, local].includes(ZIP32)) throw new Error('This map is over 4 GB, more than this computer can read yet.')
    if (flags & 1) throw new Error('The file is encrypted.')
    if (method !== 0 && method !== 8) throw new Error('The file is packed in a way Tetra does not read.')
    const name = cd.toString('utf8', p + 46, p + 46 + nl)
    const lh = Buffer.alloc(30); await fh.read(lh, 0, 30, local)
    if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error('The file is damaged.')
    out.push({ name, method, csize, size, data: local + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28) })
    p += 46 + nl + xl + cl
  }
  return out
}

/** Entry `e` of `file` as a stream of its own bytes (inflated when deflated). */
function body(file, e) {
  const raw = fs.createReadStream(file, { start: e.data, end: e.data + e.csize - 1, highWaterMark: 1 << 20 })
  return e.csize === 0 ? raw : e.method === 8 ? raw.pipe(zlib.createInflateRaw()) : raw
}

/** The manifest, read and checked: format, id, every path one of the map's, sizes and hashes well formed. */
function manifestOf(text) {
  let o
  try { o = JSON.parse(text) } catch { throw new Error('The manifest is unreadable.') }
  if (o.format !== FORMAT) throw new Error(`This map is in format ${o.format}; this Tetra reads format ${FORMAT}. Update Tetra.`)
  if (typeof o.id !== 'string' || !ID.test(o.id)) throw new Error(`The map's id "${o.id}" is not valid.`)
  if (!Array.isArray(o.files)) throw new Error('The manifest lists no files.')
  const files = o.files.map(f => {
    if (!f || !allowed(o.id, f.path)) throw new Error(`${f?.path} is not a file of map ${o.id}.`)
    if (!Number.isSafeInteger(f.size) || f.size < 0 || typeof f.sha256 !== 'string' || !SHA.test(f.sha256)) throw new Error(`${f.path}'s size or SHA-256 is not valid.`)
    return { path: f.path, size: f.size, sha256: f.sha256 }
  })
  if (new Set(files.map(f => f.path)).size !== files.length) throw new Error('The manifest lists a file twice.')
  if (!files.some(f => f.path === `${o.id}.pmtiles`)) throw new Error(`The file has no ${o.id}.pmtiles.`)
  return { id: o.id, name: typeof o.name === 'string' && o.name ? o.name : o.id, built: typeof o.built === 'string' ? o.built : '', bounds: o.bounds, files }
}

/** What `file` holds (its manifest), nothing written. */
async function peek(file) {
  const fh = await fsp.open(file, 'r')
  try {
    const all = await entries(fh, (await fh.stat()).size)
    if (all[0]?.name !== MANIFEST) throw new Error(`Not a Tetra map: its first entry is ${all[0]?.name}.`)
    if (all[0].size > MANIFEST_MAX) throw new Error('The manifest is too large.')
    const chunks = []; for await (const b of body(file, all[0])) chunks.push(b)
    return { manifest: manifestOf(Buffer.concat(chunks).toString('utf8')), entries: all }
  } finally { await fh.close() }
}

/**
 * The map in `file` into `root`: every file checked in a hidden folder there, then the old map's own files set aside and the
 * new ones moved in (its .pmtiles last, so the map shows only when whole); a failed move puts the old ones back. Its manifest.
 */
async function importMap(root, file, progress = () => {}) {
  await fsp.mkdir(root, { recursive: true })
  for (const n of await fsp.readdir(root)) if (n.startsWith(TEMP)) await fsp.rm(path.join(root, n), { recursive: true, force: true }) // an earlier import's leftovers
  const { manifest: m, entries: all } = await peek(file)
  const want = new Map(m.files.map(f => [f.path, f]))
  const total = m.files.reduce((a, f) => a + f.size, 0)
  const free = await fsp.statfs(root).then(s => s.bavail * s.bsize, () => Infinity)
  if (free < total) throw new Error(`Not enough space: the map needs ${Math.ceil(total / 1e6)} MB.`)
  const temp = path.join(root, TEMP + Date.now())
  await fsp.mkdir(temp)
  try {
    let done = 0, shown = -1
    const got = new Set()
    for (const e of all.slice(1)) {
      const it = want.get(e.name)
      if (!it) throw new Error(`${e.name} is not in the manifest.`)
      if (got.has(e.name)) throw new Error(`${e.name} is in the file twice.`)
      got.add(e.name)
      const f = path.join(temp, e.name)
      if (!path.resolve(f).startsWith(path.resolve(temp) + path.sep)) throw new Error(`${e.name} is outside the map.`)
      await fsp.mkdir(path.dirname(f), { recursive: true })
      const sha = crypto.createHash('sha256'); let n = 0
      const w = fs.createWriteStream(f)
      try {
        for await (const b of body(file, e)) {
          n += b.length
          if (n > it.size) throw new Error(`${e.name} is larger than its manifest says.`)
          sha.update(b)
          if (!w.write(b)) await new Promise(ok => w.once('drain', ok))
          done += b.length; const p = Math.floor(done * 100 / Math.max(1, total)); if (p !== shown) { shown = p; progress(p / 100) }
        }
      } finally { await new Promise(ok => w.end(ok)) }
      if (n !== it.size) throw new Error(`${e.name} is ${n} bytes, its manifest says ${it.size}.`)
      if (sha.digest('hex') !== it.sha256) throw new Error(`${e.name} is damaged: its SHA-256 is not the manifest's.`)
    }
    for (const p of want.keys()) if (!got.has(p)) throw new Error(`${p} is missing.`)
    await place(root, temp, m)
    return m
  } finally {
    await fsp.rm(temp, { recursive: true, force: true })
  }
}

/** The checked files from `temp` into `root`: the old map's own files (and the crossings coming new) aside first, back if a move fails. */
async function place(root, temp, m) {
  const tops = [...new Set(m.files.map(f => f.path.split('/')[0]))].sort((a, b) => a.endsWith('.pmtiles') - b.endsWith('.pmtiles'))
  const old = (await fsp.readdir(root)).filter(n => own(m.id).test(n) || tops.includes(n)).sort((a, b) => b.endsWith('.pmtiles') - a.endsWith('.pmtiles'))
  const aside = path.join(temp, '.old'); await fsp.mkdir(aside)
  const setAside = [], placed = []
  try {
    for (const n of old) { await fsp.rename(path.join(root, n), path.join(aside, n)); setAside.push(n) }
    for (const n of tops) { await fsp.rename(path.join(temp, n), path.join(root, n)); placed.push(n) }
  } catch (e) {
    for (const n of placed) await fsp.rm(path.join(root, n), { recursive: true, force: true })
    for (const n of setAside) await fsp.rename(path.join(aside, n), path.join(root, n)).catch(() => {})
    throw e
  }
}

module.exports = { exportMap, importMap, peek, files, allowed, FORMAT }
