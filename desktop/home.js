'use strict'
/**
 * Where Tetra keeps your things: ~/Tetra/Photos and ~/Tetra/Files. Until 2026-09-24 it was ~/Drive/Photos and
 * ~/Drive/Drive, named after the app's old name; this moves them, once, without copying a byte.
 *
 * Only renames: on one disk that is instant, needs no free space (the disk was 94 % full when this was written)
 * and either happens or does not. Nothing in the database changes, because every path it stores is relative to
 * these folders. It only moves a ~/Drive that holds nothing but Tetra's own Photos and Drive, and only when
 * ~/Tetra does not exist yet; anything else is left exactly where it is, and the old folders keep being used.
 */
const fs = require('node:fs')
const path = require('node:path')

function roots(home, { migrate = true } = {}) {
  const old = path.join(home, 'Drive'), root = path.join(home, 'Tetra')
  const moved = []
  let note = null
  if (migrate && !fs.existsSync(root) && fs.existsSync(old)) {
    const inside = fs.readdirSync(old).filter(n => !n.startsWith('.'))
    if (inside.every(n => n === 'Photos' || n === 'Drive')) { fs.renameSync(old, root); moved.push(`${old} → ${root}`) }
    else note = `~/Drive also holds ${inside.filter(n => n !== 'Photos' && n !== 'Drive').join(', ')}, so it was left where it is.`
  }
  // The second step on its own too, so an interrupted move finishes on the next start.
  if (migrate && fs.existsSync(path.join(root, 'Drive')) && !fs.existsSync(path.join(root, 'Files'))) {
    fs.renameSync(path.join(root, 'Drive'), path.join(root, 'Files')); moved.push(`${path.join(root, 'Drive')} → ${path.join(root, 'Files')}`)
  }
  // a ~/Tetra holding only .System (system.js) is not the library: a ~/Drive left where it was is still used
  const useOld = fs.existsSync(old) && !['Photos', 'Files', 'Drive'].some(n => fs.existsSync(path.join(root, n)))
  return {
    root: useOld ? old : root,
    photos: useOld ? path.join(old, 'Photos') : path.join(root, 'Photos'),
    files: useOld ? path.join(old, 'Drive') : path.join(root, 'Files'),
    moved, note,
  }
}

/** A .ico holding one PNG (256 px or smaller), as Windows reads them since Vista: a 6-byte header and one 16-byte entry. */
function pngIco(png, size) {
  const head = Buffer.alloc(22)
  head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4) // an icon, one image
  head[6] = head[7] = size >= 256 ? 0 : size // 0 is 256
  head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12); head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18)
  return Buffer.concat([head, png])
}

/**
 * The folder wears the app's icon: a .directory file for KDE's Dolphin, and GNOME's custom-icon attribute where
 * `gio` exists; on Windows a desktop.ini, which Explorer reads in a read-only folder. The icon is copied next to the database,
 * because the app's own copy may be inside a package.
 */
function markFolder(root, iconSource, dataDir) {
  if (process.platform === 'win32') return markWindowsFolder(root, iconSource, dataDir)
  try {
    const icon = path.join(dataDir, 'tetra-folder.png')
    fs.mkdirSync(dataDir, { recursive: true })
    fs.copyFileSync(iconSource, icon)
    const dotDirectory = path.join(root, '.directory')
    const ours = !fs.existsSync(dotDirectory) || fs.readFileSync(dotDirectory, 'utf8').includes('tetra-folder.png')
    if (ours) fs.writeFileSync(dotDirectory, `[Desktop Entry]\nIcon=${icon}\n`)
    require('node:child_process').execFile('gio', ['set', root, 'metadata::custom-icon', 'file://' + icon], () => {})
  } catch {}
}

/** Written once: Node cannot write over a hidden file on Windows, and the icon's place does not change. */
async function markWindowsFolder(root, iconSource, dataDir) {
  const ini = path.join(root, 'desktop.ini')
  if (fs.existsSync(ini)) return
  try {
    const ico = path.join(dataDir, 'tetra-folder.ico')
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(ico, pngIco(await require('sharp')(iconSource).resize(256, 256).png().toBuffer(), 256))
    // UTF-16 with its BOM: the path may have a Greek user name in it
    fs.writeFileSync(ini, Buffer.from(`\ufeff[.ShellClassInfo]\r\nIconResource=${ico},0\r\n`, 'utf16le'))
    const attrib = (...a) => new Promise(r => require('node:child_process').execFile('attrib', a, { windowsHide: true }, () => r()))
    await attrib('+h', '+s', ini)
    await attrib('+r', root)
  } catch (e) { console.warn('[home] folder icon', e.message) }
}

module.exports = { roots, markFolder, pngIco }
