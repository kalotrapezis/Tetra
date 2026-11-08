const TETRA = 'http://127.0.0.1:43190'
const status = document.getElementById('status'), pair = document.getElementById('pair'), list = document.getElementById('accounts')

async function show() {
  const { token, accounts } = await messenger.storage.local.get({ token: null, accounts: [] })
  pair.hidden = !!token
  status.textContent = token ? 'Συνδεδεμένο με το Tetra. Διάλεξε λογαριασμούς:' : 'Άνοιξε το Tetra και πάτα «Σύνδεση». Το Tetra θα σε ρωτήσει αν το επιτρέπεις.'
  list.replaceChildren()
  if (!token) return
  for (const a of await messenger.accounts.list(false)) {
    const email = a.identities?.[0]?.email
    if (!email) continue
    const label = document.createElement('label'), box = document.createElement('input')
    box.type = 'checkbox'; box.checked = accounts.includes(a.id)
    box.onchange = async () => {
      const now = (await messenger.storage.local.get({ accounts: [] })).accounts.filter(id => id !== a.id)
      await messenger.storage.local.set({ accounts: box.checked ? [...now, a.id] : now })
    }
    label.append(box, ` ${a.name} — ${email}`)
    list.append(label)
  }
}

pair.onclick = async () => {
  status.textContent = 'Περιμένω να το επιτρέψεις στο Tetra…'
  try {
    const r = await fetch(`${TETRA}/tb/pair`, { method: 'POST' })
    if (!r.ok) throw new Error(r.status === 403 ? 'Δεν επιτράπηκε στο Tetra.' : `Tetra: ${r.status}`)
    await messenger.storage.local.set({ token: (await r.json()).token })
  } catch (e) { status.textContent = /fetch|Network/i.test(e.message) ? 'Το Tetra δεν απαντά: είναι ανοιχτό;' : e.message; return }
  show()
}

show()
