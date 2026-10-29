'use client'

import { create } from 'zustand'

// ── Groups on the timeline (as Resolve's Link Clips / Premiere's Group, user 2026-10-27) ──────────
// Things on the rows — videos and photos on top, text, music — joined so they're picked and moved as
// one: a click on any of them picks them all, a drag carries them all, Delete takes them all. Alt +
// click picks one alone (to trim it, say). Saved with the clip beside its rows (clips.layers.groups);
// Undo covers it (history.ts). The main video's own parts are never in one (that row closes up).

/** Each group: the ids of what's in it (two or more) */
export type Groups = string[][]

export const useGroupStore = create<{ groups: Groups }>(() => ({ groups: [] }))

/** The groups kept to what's still there, each of two or more, no id in two */
export function cleanGroups(raw: unknown, exists: (id: string) => boolean = () => true): Groups {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: Groups = []
  for (const g of raw) {
    if (!Array.isArray(g)) continue
    const ids = [...new Set(g.filter((x): x is string => typeof x === 'string' && x.length <= 64 && exists(x) && !seen.has(x)))]
    if (ids.length < 2) continue
    ids.forEach(x => seen.add(x))
    out.push(ids)
  }
  return out
}

/** The group `id` is in (its members), if any */
export const groupOf = (groups: Groups, id: string) => groups.find(g => g.includes(id)) ?? null

/** `ids` joined into one group (taken out of the groups they were in; a group left with one goes) */
export function joinGroup(groups: Groups, ids: string[]): Groups {
  const want = [...new Set(ids)]
  if (want.length < 2) return groups
  const rest = groups.map(g => g.filter(x => !want.includes(x))).filter(g => g.length > 1)
  return [...rest, want]
}

/** The groups any of `ids` are in, undone */
export const splitGroups = (groups: Groups, ids: string[]): Groups => groups.filter(g => !g.some(x => ids.includes(x)))

/** Every member of the groups `ids` are in, with `ids` (what picking them picks) */
export function withGroups(groups: Groups, ids: string[]): string[] {
  const out = new Set(ids)
  for (const id of ids) for (const x of groupOf(groups, id) ?? []) out.add(x)
  return [...out]
}
