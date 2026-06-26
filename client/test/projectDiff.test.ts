import { describe, it, expect } from 'vitest';
import { flattenItems, computeItemDiff, stableJson } from '../app/utils/projectDiff';

const audio = (uuid: string, extra: Record<string, any> = {}) => ({ uuid, type: 'audio', ...extra });
const group = (uuid: string, children: any[] = [], extra: Record<string, any> = {}) =>
  ({ uuid, type: 'group', children, ...extra });

describe('flattenItems', () => {
  it('flattens playlist and cart-only with parent + cartOnly flags', () => {
    const items = [audio('a'), group('g', [audio('b'), audio('c')])];
    const cart = [audio('k')];
    const m = flattenItems(items, cart);
    expect([...m.keys()]).toEqual(['a', 'g', 'b', 'c', 'k']);
    expect(m.get('a')).toMatchObject({ parentUuid: '', cartOnly: false });
    expect(m.get('b')).toMatchObject({ parentUuid: 'g', cartOnly: false });
    expect(m.get('k')).toMatchObject({ parentUuid: '', cartOnly: true });
  });

  it('ignores null/undefined and entries without a uuid', () => {
    const m = flattenItems([null, { type: 'audio' }, audio('a')] as any, undefined);
    expect([...m.keys()]).toEqual(['a']);
  });
});

describe('computeItemDiff', () => {
  const diff = (prevItems: any[], prevCart: any[], curItems: any[], curCart: any[]) =>
    computeItemDiff(flattenItems(prevItems, prevCart), flattenItems(curItems, curCart));

  it('reports nothing when unchanged', () => {
    const items = [audio('a'), audio('b')];
    const d = diff(items, [], items, []);
    expect(d).toEqual({ moves: [], removes: [], adds: [], updates: [], reorders: [] });
  });

  it('detects a new item as an add', () => {
    const d = diff([audio('a')], [], [audio('a'), audio('b')], []);
    expect(d.adds.map(x => x.uuid)).toEqual(['b']);
    expect(d.removes).toEqual([]);
    expect(d.updates).toEqual([]);
  });

  it('detects a removed item', () => {
    const d = diff([audio('a'), audio('b')], [], [audio('a')], []);
    expect(d.removes).toEqual(['b']);
    expect(d.adds).toEqual([]);
  });

  it('detects an in-place content change as an update (not add/move)', () => {
    const d = diff([audio('a', { gainDb: 0 })], [], [audio('a', { gainDb: -3 })], []);
    expect(d.updates.map(x => x.uuid)).toEqual(['a']);
    expect(d.adds).toEqual([]);
    expect(d.moves).toEqual([]);
  });

  it('treats a reparent into a group as a move (and updates the group whose children changed)', () => {
    const prev = [audio('a'), group('g', [])];
    const cur  = [group('g', [audio('a')])];
    const d = diff(prev, [], cur, []);
    expect(d.moves.map(x => x.uuid)).toEqual(['a']);
    expect(d.moves[0]).toMatchObject({ parentUuid: 'g', cartOnly: false });
    expect(d.adds).toEqual([]);
    expect(d.removes).toEqual([]); // 'a' still exists, just reparented
    // 'g's serialized form gained a child, so it's a legitimate in-place update.
    expect(d.updates.map(x => x.uuid)).toEqual(['g']);
  });

  it('treats a playlist -> cart-only relocation as a move', () => {
    const d = diff([audio('a')], [], [], [audio('a')]);
    expect(d.moves.map(x => x.uuid)).toEqual(['a']);
    expect(d.moves[0]).toMatchObject({ parentUuid: '', cartOnly: true });
    expect(d.removes).toEqual([]);
    expect(d.adds).toEqual([]);
  });

  it('detects a sibling reorder and sends the full current order', () => {
    const d = diff([audio('a'), audio('b'), audio('c')], [],
                   [audio('c'), audio('a'), audio('b')], []);
    expect(d.reorders).toEqual([{ parentUuid: '', order: ['c', 'a', 'b'] }]);
    expect(d.moves).toEqual([]);
    expect(d.adds).toEqual([]);
    expect(d.removes).toEqual([]);
  });

  it('does not report a reorder when only an add/remove changed the order', () => {
    // Adding 'c' at the end keeps a,b common-order identical -> no reorder.
    const d = diff([audio('a'), audio('b')], [], [audio('a'), audio('b'), audio('c')], []);
    expect(d.reorders).toEqual([]);
    expect(d.adds.map(x => x.uuid)).toEqual(['c']);
  });

  it('cart-only items never produce a reorder op', () => {
    const d = diff([], [audio('x'), audio('y')], [], [audio('y'), audio('x')]);
    expect(d.reorders).toEqual([]);
  });
});

describe('stableJson', () => {
  it('treats null and undefined identically', () => {
    expect(stableJson(undefined)).toBe(stableJson(null));
  });
});
