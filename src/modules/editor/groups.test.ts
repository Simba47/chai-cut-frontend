// Groups on the timeline (groups.ts). Run: npx tsx --test src/modules/editor/groups.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanGroups, groupOf, joinGroup, splitGroups, withGroups } from './groups'

test('saved groups made safe: two or more each, what is gone left out, no id in two groups', () => {
  assert.deepEqual(cleanGroups([['a', 'b'], ['b', 'c', 'd'], ['e'], 'x', [1, 2]], id => id !== 'd'), [['a', 'b']])
  assert.deepEqual(cleanGroups(null), [])
})

test('joining takes things out of the groups they were in; a group left with one goes', () => {
  const g = joinGroup([['a', 'b'], ['c', 'd', 'e']], ['b', 'c'])
  assert.deepEqual(g, [['d', 'e'], ['b', 'c']])
  assert.deepEqual(joinGroup(g, ['x']), g)
})

test('ungrouping, and picking with whole groups', () => {
  const g = [['a', 'b'], ['c', 'd']]
  assert.deepEqual(splitGroups(g, ['b']), [['c', 'd']])
  assert.deepEqual(withGroups(g, ['a', 'z']).sort(), ['a', 'b', 'z'])
  assert.deepEqual(groupOf(g, 'd'), ['c', 'd'])
  assert.equal(groupOf(g, 'z'), null)
})
