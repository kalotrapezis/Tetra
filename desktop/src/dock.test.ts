import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_DOCK, move, ordered, placed, split } from './dock.ts'

const apps = ['photos', 'files', 'mail', 'notes', 'calendar'].map(key => ({ key }))
const keys = (xs: { key: string }[]) => xs.map(x => x.key).join(',')

test('the person\'s order first, apps it does not know last in their own order', () => {
  assert.equal(keys(ordered(apps, ['mail', 'photos'])), 'mail,photos,files,notes,calendar')
})

test('all fit: ⋯ holds only the ones kept out', () => {
  const r = split(apps, { ...DEFAULT_DOCK, out: ['notes'] }, 10)
  assert.equal(keys(r.shown), 'photos,files,mail,calendar')
  assert.equal(keys(r.more), 'notes')
})

test('short window: ⋯ takes a slot and the rest go into it, before the ones kept out', () => {
  const r = split(apps, { ...DEFAULT_DOCK, out: ['files'] }, 3)
  assert.equal(keys(r.shown), 'photos,mail')
  assert.equal(keys(r.more), 'notes,calendar,files')
})

test('move swaps with a neighbour and stops at the ends', () => {
  assert.deepEqual(move(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c'])
  assert.deepEqual(move(['a', 'b', 'c'], 'c', 1), ['a', 'b', 'c'])
})

test('dock: an app dragged on goes where it is dropped, one dragged off leaves it, the rest keep their order', () => {
  const keys = ['photos', 'files', 'mail', 'notes']
  const off = placed(DEFAULT_DOCK, keys, 'files', false)
  assert.deepEqual(off.out, ['files'])
  const back = placed(off, keys, 'files', true, 'notes')
  assert.deepEqual(back.out, [])
  assert.deepEqual(back.order, ['photos', 'mail', 'files', 'notes'])
  assert.deepEqual(placed(back, keys, 'photos', true, null).order, ['mail', 'files', 'notes', 'photos']) // dropped below the last: last
  assert.deepEqual(placed(off, keys, 'files', false), off) // off already: as it was
})
