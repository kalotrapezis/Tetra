'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const zlib = require('node:zlib')
const { spawnSync } = require('node:child_process')
const { exportMap, importMap, peek, allowed } = require('../tetramap')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tetramap-'))
const sha = b => crypto.createHash('sha256').update(b).digest('hex')

/** A small map "greece" as the builder leaves it, with a neighbour's crossing and the user's own files beside it. */
function makeMaps(root, tag = 'v1') {
  fs.mkdirSync(path.join(root, 'greece-gh'), { recursive: true })
  const files = {
    'greece.pmtiles': crypto.randomBytes(300_000),
    'greece.json': Buffer.from(JSON.stringify({ name: 'Greece', built: '2026-10-21', bounds: [19, 34, 30, 42] })),
    'greece-gh/nodes': Buffer.from(`nodes ${tag}`.repeat(1000)),
    'greece-gh/properties': Buffer.from(`props ${tag}`),
    'greece-places.tsv': Buffer.from(`Αθήνα\t37.98\t23.72\n${tag}`),
    'albania_greece-crossings.tsv': Buffer.from(`crossing ${tag}`),
  }
  for (const [p, b] of Object.entries(files)) fs.writeFileSync(path.join(root, p), b)
  fs.writeFileSync(path.join(root, 'added-places.tsv'), 'mine') // the user's, never in a map's file
  fs.mkdirSync(path.join(root, 'Places'), { recursive: true }); fs.writeFileSync(path.join(root, 'Places', 'home.json'), '{}')
  fs.writeFileSync(path.join(root, 'italy.pmtiles'), 'another map')
  return files
}

test('a map exported here imports elsewhere whole, the old one replaced and the user\'s files kept', async () => {
  const a = tmp(), b = tmp(), out = path.join(tmp(), 'greece.tetramap')
  const files = makeMaps(a, 'new')
  let last = 0
  await exportMap(a, 'greece', out, { name: 'Greece', built: '2026-10-21', bounds: [19, 34, 30, 42] }, p => { assert.ok(p >= last); last = p })
  assert.equal(last, 1)
  const { manifest } = await peek(out)
  assert.equal(manifest.id, 'greece'); assert.equal(manifest.name, 'Greece')
  assert.deepEqual(manifest.files.map(f => f.path).sort(), Object.keys(files).sort())
  makeMaps(b, 'old'); fs.writeFileSync(path.join(b, 'greece-lanes.tsv'), 'a list the new map lacks')
  await importMap(b, out)
  for (const [p, buf] of Object.entries(files)) assert.equal(sha(fs.readFileSync(path.join(b, p))), sha(buf), p)
  assert.ok(!fs.existsSync(path.join(b, 'greece-lanes.tsv')), 'the old map goes whole')
  assert.equal(fs.readFileSync(path.join(b, 'added-places.tsv'), 'utf8'), 'mine')
  assert.ok(fs.existsSync(path.join(b, 'Places', 'home.json')) && fs.existsSync(path.join(b, 'italy.pmtiles')))
  assert.deepEqual(fs.readdirSync(b).filter(n => n.startsWith('.')), [], 'no hidden leftovers')
})

/** A ZIP of `entries` ([name, buffer]) the simple way (stored), for archives the export would never write. */
function zip(entries) {
  const parts = [], central = []; let off = 0
  for (const [name, data] of entries) {
    const n = Buffer.from(name), h = Buffer.alloc(30), c = Buffer.alloc(46), crc = zlib.crc32(data)
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(10, 4); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26)
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(10, 6); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42)
    parts.push(h, n, data); central.push(c, n); off += 30 + n.length + data.length
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22)
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16)
  return Buffer.concat([...parts, cd, e])
}
const manifest = (files, extra = {}) => Buffer.from(JSON.stringify({ format: 1, id: 'greece', name: 'Greece', built: '2026-10-21',
  files: files.map(([p, b]) => ({ path: p, size: b.length, sha256: sha(b) })), ...extra }))

test('a file from elsewhere is refused when it is not what its manifest says, and the map here stays', async () => {
  const pm = Buffer.from('tiles')
  const cases = {
    'a path out of the Maps folder': (() => { const f = [['greece.pmtiles', pm], ['../evil.sh', Buffer.from('x')]]; return zip([['tetramap.json', manifest(f)], ...f]) })(),
    'another map\'s file': (() => { const f = [['greece.pmtiles', pm], ['italy.pmtiles', Buffer.from('x')]]; return zip([['tetramap.json', manifest(f)], ...f]) })(),
    'an entry not in the manifest': zip([['tetramap.json', manifest([['greece.pmtiles', pm]])], ['greece.pmtiles', pm], ['greece-gh/../../x', Buffer.from('x')]]),
    'a tampered file of the same size': zip([['tetramap.json', manifest([['greece.pmtiles', pm]])], ['greece.pmtiles', Buffer.from('tilez')]]),
    'a missing file': zip([['tetramap.json', manifest([['greece.pmtiles', pm], ['greece.json', Buffer.from('{}')]])], ['greece.pmtiles', pm]]),
    'a newer format': zip([['tetramap.json', manifest([['greece.pmtiles', pm]], { format: 2 })], ['greece.pmtiles', pm]]),
    'no manifest first': zip([['greece.pmtiles', pm], ['tetramap.json', manifest([['greece.pmtiles', pm]])]]),
    'not a ZIP': Buffer.from('hello'),
  }
  for (const [why, bytes] of Object.entries(cases)) {
    const root = tmp(), file = path.join(tmp(), 'x.tetramap')
    makeMaps(root, 'here'); fs.writeFileSync(file, bytes)
    const before = fs.readFileSync(path.join(root, 'greece.pmtiles'))
    await assert.rejects(importMap(root, file), undefined, why)
    assert.ok(fs.readFileSync(path.join(root, 'greece.pmtiles')).equals(before), `${why}: the map here stays`)
    assert.deepEqual(fs.readdirSync(root).filter(n => n.startsWith('.')), [], `${why}: no leftovers`)
    assert.ok(!fs.existsSync(path.join(path.dirname(root), 'evil.sh')))
  }
})

test('paths: only the map\'s own files', () => {
  for (const p of ['greece.pmtiles', 'greece.json', 'greece-gh/nodes', 'greece-places.tsv', 'albania_greece-crossings.tsv']) assert.ok(allowed('greece', p), p)
  for (const p of ['../greece.pmtiles', '/greece.pmtiles', 'greece-gh/../x', 'greece-gh/.hidden', 'italy.pmtiles', 'Places/home.json', 'added-places.tsv',
    'greece-gh/a/b', 'albania_italy-crossings.tsv', 'greece.pmtiles\\x', 'C:greece.pmtiles']) assert.ok(!allowed('greece', p), p)
})

// The phone writes with Java's ZipOutputStream (Tetra-mobile MapsArchive.kt): the .pmtiles stored, the rest deflated with data
// descriptors after them. The same here, made by the JDK when there is one.
const java = [process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, 'bin', 'java'), '/usr/lib/jvm/java-17-openjdk-amd64/bin/java', 'java']
  .find(j => j && spawnSync(j, ['-version']).status === 0)
test('a map the phone exported imports here', { skip: !java && 'no Java here' }, async () => {
  const a = tmp(), b = tmp(), src = path.join(tmp(), 'PhoneZip.java'), out = path.join(tmp(), 'greece.tetramap')
  const files = makeMaps(a, 'phone')
  const list = Object.entries(files).map(([p, buf]) => ({ path: p, size: buf.length, sha256: sha(buf) }))
  fs.writeFileSync(path.join(a, 'manifest.json'), JSON.stringify({ format: 1, id: 'greece', name: 'Greece', built: '2026-10-21', files: list }))
  fs.writeFileSync(src, `
import java.io.*; import java.nio.file.*; import java.util.zip.*;
public class PhoneZip { public static void main(String[] a) throws Exception {
  File root = new File(a[0]); ZipOutputStream z = new ZipOutputStream(new FileOutputStream(a[1]));
  z.putNextEntry(new ZipEntry("tetramap.json")); z.write(Files.readAllBytes(new File(root, "manifest.json").toPath())); z.closeEntry();
  for (int i = 2; i < a.length; i++) { byte[] d = Files.readAllBytes(new File(root, a[i]).toPath()); ZipEntry e = new ZipEntry(a[i]);
    if (a[i].endsWith(".pmtiles")) { CRC32 c = new CRC32(); c.update(d); e.setMethod(ZipEntry.STORED); e.setSize(d.length); e.setCompressedSize(d.length); e.setCrc(c.getValue()); }
    z.putNextEntry(e); z.write(d); z.closeEntry(); }
  z.close(); } }`)
  const r = spawnSync(java, [src, a, out, ...Object.keys(files)], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  makeMaps(b, 'old')
  await importMap(b, out)
  for (const [p, buf] of Object.entries(files)) assert.equal(sha(fs.readFileSync(path.join(b, p))), sha(buf), p)
})

test('a map exported here reads on the phone (Java\'s ZipInputStream, as MapsArchive.kt)', { skip: !java && 'no Java here' }, async () => {
  const a = tmp(), out = path.join(tmp(), 'greece.tetramap'), src = path.join(tmp(), 'PhoneRead.java')
  const files = makeMaps(a, 'pc')
  await exportMap(a, 'greece', out, { name: 'Greece', built: '2026-10-21' })
  fs.writeFileSync(src, `
import java.io.*; import java.security.*; import java.util.zip.*;
public class PhoneRead { public static void main(String[] a) throws Exception {
  ZipInputStream z = new ZipInputStream(new FileInputStream(a[0])); ZipEntry e; byte[] buf = new byte[65536];
  while ((e = z.getNextEntry()) != null) { MessageDigest md = MessageDigest.getInstance("SHA-256"); long n = 0; int r;
    while ((r = z.read(buf)) > 0) { md.update(buf, 0, r); n += r; }
    StringBuilder h = new StringBuilder(); for (byte b : md.digest()) h.append(String.format("%02x", b));
    System.out.println(e.getName() + "\\t" + n + "\\t" + h); } } }`)
  const r = spawnSync(java, [src, out], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const read = Object.fromEntries(r.stdout.trim().split('\n').map(l => l.split('\t')).map(([n, s, h]) => [n, { size: +s, sha256: h }]))
  assert.equal(Object.keys(read)[0], 'tetramap.json', 'the manifest first')
  for (const [p, buf] of Object.entries(files)) assert.deepEqual(read[p], { size: buf.length, sha256: sha(buf) }, p)
})
