// =====================================================================
// projectDiff.ts
// ---------------------------------------------------------------------
// Pure, dependency-free diff logic for the client -> server item sync.
//
// Extracted out of useProject.ts so the (historically fragile) diff can be
// unit-tested in isolation, without Vue/Nuxt or a live server. useProject's
// syncItemsDiff() flattens the previous and current item trees, calls
// computeItemDiff() to get the ordered set of server operations, then applies
// them (with error handling). Keeping the computation pure means a regression
// in move/remove/add/update/reorder detection is caught by Vitest, not on stage.
// =====================================================================

export interface FlatEntry {
  item: any;
  parentUuid: string;
  cartOnly: boolean;
}

export type FlatMap = Map<string, FlatEntry>;

// Stable stringify used for change detection (mirrors useProject's stableJson).
export function stableJson(v: any): string {
  return JSON.stringify(v ?? null);
}

// Flatten the playlist + cart-only trees into a uuid -> {item, parentUuid,
// cartOnly} map. Map iteration order follows array/walk order, which the
// reorder step relies on. Mirrors useProject's flatten().
export function flattenItems(
  items: any[] | null | undefined,
  cartOnly: any[] | null | undefined,
): FlatMap {
  const m: FlatMap = new Map();
  const walk = (arr: any[] | null | undefined, parentUuid: string, isCartOnly: boolean) => {
    if (!Array.isArray(arr)) return;
    for (const it of arr) {
      if (!it || typeof it !== 'object') continue;
      const u = it.uuid;
      if (!u) continue;
      m.set(u, { item: it, parentUuid, cartOnly: isCartOnly });
      if (it.type === 'group' && Array.isArray(it.children)) walk(it.children, u, isCartOnly);
    }
  };
  walk(items, '', false);
  walk(cartOnly, '', true);
  return m;
}

export interface ItemRef {
  uuid: string;
  item: any;
  parentUuid: string;
  cartOnly: boolean;
}

export interface ItemDiff {
  // Same uuid, but its parent group or playlist/cart location changed. Applied
  // as remove-then-add so the server re-files it. Must run before plain adds.
  moves: ItemRef[];
  // uuids present before but gone now.
  removes: string[];
  // uuids new this round (not present before, not a move).
  adds: ItemRef[];
  // uuids whose content changed in place (same parent + location).
  updates: Array<{ uuid: string; item: any }>;
  // Per-parent playlist ordering that changed (cart-only items excluded — they
  // are addressed by slot, not list order). `order` is the full current order.
  reorders: Array<{ parentUuid: string; order: string[] }>;
}

// Compute the ordered set of server operations to turn `prev` into `curr`.
// Pure: no side effects, no awaits. Mirrors the five steps formerly inline in
// useProject.syncItemsDiff(), in the same order.
export function computeItemDiff(prev: FlatMap, curr: FlatMap): ItemDiff {
  const moves: ItemRef[] = [];
  const removes: string[] = [];
  const adds: ItemRef[] = [];
  const updates: Array<{ uuid: string; item: any }> = [];
  const reorders: Array<{ parentUuid: string; order: string[] }> = [];

  // 1. Cross-parent moves: same uuid, different parent group or list.
  for (const [uuid, { item, parentUuid, cartOnly }] of curr) {
    const before = prev.get(uuid);
    if (!before) continue;
    if (before.parentUuid === parentUuid && before.cartOnly === cartOnly) continue;
    moves.push({ uuid, item, parentUuid, cartOnly });
  }

  // 2. Removes: present before, gone now.
  for (const [uuid] of prev) {
    if (!curr.has(uuid)) removes.push(uuid);
  }

  // 3. Adds: new this round (not a cross-parent move).
  for (const [uuid, { item, parentUuid, cartOnly }] of curr) {
    if (prev.has(uuid)) continue;
    adds.push({ uuid, item, parentUuid, cartOnly });
  }

  // 4. Updates: content changed in place (not a move, not new).
  for (const [uuid, { item, parentUuid, cartOnly }] of curr) {
    const before = prev.get(uuid);
    if (!before) continue;
    if (before.parentUuid !== parentUuid || before.cartOnly !== cartOnly) continue; // step 1
    if (stableJson(before.item) === stableJson(item)) continue;
    updates.push({ uuid, item });
  }

  // 5. Reorder: per playlist parent level, if the common-item order changed.
  const parentUuidsInCurr = new Set<string>();
  for (const [, { parentUuid, cartOnly }] of curr) {
    if (!cartOnly) parentUuidsInCurr.add(parentUuid);
  }
  for (const parentUuid of parentUuidsInCurr) {
    const prevOrder = [...prev.entries()]
      .filter(([, v]) => !v.cartOnly && v.parentUuid === parentUuid)
      .map(([u]) => u);
    const currOrder = [...curr.entries()]
      .filter(([, v]) => !v.cartOnly && v.parentUuid === parentUuid)
      .map(([u]) => u);
    // Restrict comparison to items present in both, so add/remove (handled
    // above) don't look like a reorder.
    const prevCommon = prevOrder.filter(u => curr.has(u));
    const currCommon = currOrder.filter(u => prev.has(u));
    if (stableJson(prevCommon) !== stableJson(currCommon)) {
      reorders.push({ parentUuid, order: currOrder });
    }
  }

  return { moves, removes, adds, updates, reorders };
}
