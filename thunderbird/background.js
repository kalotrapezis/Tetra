/**
 * Tetra Mail in Thunderbird: the accounts the user ticked (options) go to Tetra (desktop/tbbridge.js on 127.0.0.1) —
 * Inbox and Sent, every mail once — and what Tetra sends from them goes out through Thunderbird. Thunderbird does the
 * signing in (a university's Microsoft 365 lets Thunderbird in, not Tetra); Tetra never sees a password or a token.
 */
const TETRA = 'http://127.0.0.1:43190'
const ROLES = { inbox: 'Inbox', sent: 'Sent' }
const EVERY = 5 * 60_000 // a full look at both folders; new mail comes at once (onNewMailReceived)
const OUTBOX = 10_000    // how often Tetra is asked for mail to send

const settings = () => messenger.storage.local.get({ token: null, accounts: [] })

async function tetra(route, body) {
  const { token } = await settings()
  if (!token) throw new Error('Not paired with Tetra')
  const r = await fetch(TETRA + route, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body && JSON.stringify(body) })
  const out = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(out.error || `Tetra: ${r.status}`), { status: r.status })
  return out
}

const base64 = file => new Promise((resolve, reject) => {
  const fr = new FileReader()
  fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '')
  fr.onerror = () => reject(fr.error)
  fr.readAsDataURL(file)
})
const role = folder => ROLES[(folder.specialUse ?? []).find(u => ROLES[u])] ?? ROLES[folder.type] ?? null
const addressOf = account => account.identities?.[0]?.email?.toLowerCase() ?? null

/** The accounts the user ticked, with their Inbox and Sent folders. */
async function chosen() {
  const { accounts } = await settings(), out = []
  for (const account of await messenger.accounts.list(false)) {
    if (!accounts.includes(account.id) || !addressOf(account)) continue
    const folders = await messenger.folders.getSubFolders(account.rootFolder?.id ?? account.id, true)
    const flat = list => list.flatMap(f => [f, ...flat(f.subFolders ?? [])])
    out.push({ account, address: addressOf(account), folders: flat(folders).filter(role) })
  }
  return out
}

async function give(address, folder, message, extra = {}) {
  const raw = await base64(await messenger.messages.getRaw(message.id, { data_format: 'File' }))
  return tetra('/tb/mail', { account: address, folder: role(folder), raw, seen: !!message.read, flagged: !!message.flagged, ...extra })
}

let busy = false
/** Every mail of the ticked accounts' Inbox and Sent that Tetra has not got yet, oldest last. */
async function syncAll() {
  if (busy) return
  busy = true
  try {
    for (const { account, address, folders } of await chosen()) {
      try { await tetra('/tb/account', { address, name: account.name }) } catch (e) { console.warn('[tetra]', address, e.message); continue } // 409: Tetra fetches it itself
      for (const folder of folders) {
        const known = new Set((await tetra(`/tb/known?account=${encodeURIComponent(address)}&folder=${role(folder)}`)).ids)
        let page = await messenger.messages.list(folder.id)
        for (;;) {
          for (const m of page.messages) if (!known.has(m.headerMessageId)) {
            try { await give(address, folder, m); known.add(m.headerMessageId) } catch (e) { console.warn('[tetra]', m.subject, e.message) }
          }
          if (!page.id) break
          page = await messenger.messages.continueList(page.id)
        }
      }
    }
  } catch (e) { if (!/Not paired|Failed to fetch|NetworkError/.test(e.message)) console.warn('[tetra]', e.message) } // Tetra closed: next time
  finally { busy = false }
}

/** Is [folder] the Inbox or Sent of a ticked account? Its address, or null. */
async function watched(folder) {
  if (!role(folder)) return null
  const { accounts } = await settings()
  if (!accounts.includes(folder.accountId)) return null
  return addressOf(await messenger.accounts.get(folder.accountId))
}

messenger.messages.onNewMailReceived.addListener(async (folder, list) => {
  const address = await watched(folder).catch(() => null)
  if (!address) return
  let page = list
  for (;;) {
    for (const m of page.messages) await give(address, folder, m, { fresh: true }).catch(e => console.warn('[tetra]', e.message))
    if (!page.id) break
    page = await messenger.messages.continueList(page.id)
  }
})

// read or ♥ changed in Thunderbird: Tetra follows (a mail read in Tetra stays read there until Thunderbird changes it)
messenger.messages.onUpdated.addListener(async (message, changed) => {
  if (!('read' in changed) && !('flagged' in changed)) return
  const address = await watched(message.folder).catch(() => null)
  if (address) await give(address, message.folder, message, { update: true }).catch(e => console.warn('[tetra]', e.message))
})

const recipient = a => a.name ? `"${a.name.replace(/["\\]/g, '')}" <${a.address}>` : a.address

/** Mail Tetra sends from a ticked account: composed and sent by Thunderbird, its answer back to Tetra. */
async function sendFromTetra() {
  let mails = []
  try { ({ mails } = await tetra('/tb/outbox')) } catch { return }
  for (const m of mails) {
    try {
      const account = (await messenger.accounts.list(false)).find(a => addressOf(a) === m.account)
      if (!account) throw new Error(`Thunderbird has no account ${m.account}`)
      const attachments = m.attachments.map(a => ({ file: new File([Uint8Array.from(atob(a.data), c => c.charCodeAt(0))], a.name, { type: a.type }) }))
      const tab = await messenger.compose.beginNew({
        identityId: account.identities[0].id, to: m.to.map(recipient), cc: m.cc.map(recipient), bcc: m.bcc.map(recipient),
        subject: m.subject, body: m.html, isPlainText: false, attachments, customHeaders: [{ name: 'X-Tetra-Id', value: m.id }],
      })
      await messenger.compose.sendMessage(tab.id, { mode: 'sendNow' })
      await tetra('/tb/sent', { id: m.id })
      setTimeout(syncAll, 5_000) // Thunderbird's Sent copy to Tetra
    } catch (e) {
      console.warn('[tetra] not sent', m.subject, e.message)
      await tetra('/tb/sent', { id: m.id, error: e.message }).catch(() => {})
    }
  }
}

messenger.storage.onChanged.addListener(() => syncAll())
setInterval(syncAll, EVERY)
setInterval(sendFromTetra, OUTBOX)
syncAll()
