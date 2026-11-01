/**
 * Small readers over the mocked Supabase client, for screen tests that check
 * exactly what a screen sends: which RPCs it calls and with what, which
 * tables it reads, and with which filters.
 *
 * Jest treats every file under __tests__ as a suite, so this file checks
 * itself at the bottom, only when Jest runs it directly.
 */
import { router } from 'expo-router';
import { act, screen, within } from 'expo-router/testing-library';

import { supabase } from '@/lib/supabase';

type Args = Record<string, unknown>;

const rpcMock = () => supabase.rpc as jest.Mock;
const fromMock = () => supabase.from as jest.Mock;

/** The names of every RPC called so far, in order. */
export function rpcNames(): string[] {
  return (rpcMock().mock.calls as [string][]).map(([name]) => name);
}

/** The arguments of every call to one RPC, in order. */
export function rpcCalls(name: string): Args[] {
  return (rpcMock().mock.calls as [string, Args | undefined][])
    .filter(([n]) => n === name)
    .map(([, args]) => args ?? {});
}

/** The arguments of the only call to one RPC; fails unless it was called exactly once. */
export function onlyRpcCall(name: string): Args {
  const calls = rpcCalls(name);
  expect(calls).toHaveLength(1);
  return calls[0];
}

/** The names of every table read or written so far, in order. */
export function tablesRead(): string[] {
  return (fromMock().mock.calls as [string][]).map(([name]) => name);
}

/** Forgets the calls so far, keeping the fake backend's answers. */
export function clearCalls() {
  rpcMock().mockClear();
  fromMock().mockClear();
}

/** The RPCs a screen calls that change something, from a list of reads it may also make. */
export function writesAmong(reads: string[]): string[] {
  return rpcNames().filter((n) => !reads.includes(n));
}

/**
 * Moves on to another screen as a tap would, so a screen that finishes with
 * router.back() has somewhere to go back to.
 */
export async function pushTo(url: string) {
  await act(async () => {
    router.push(url as Parameters<typeof router.push>[0]);
  });
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/**
 * The text box under a label, for TextFields with no placeholder: the
 * closest box whose own field holds that label and no other box.
 */
export function fieldLabelled(label: string) {
  const inputs = screen.container.queryAll((n) => n.type === 'TextInput');
  const found = inputs.filter((input) => {
    let node = input.parent;
    for (let up = 0; node && up < 6; up++, node = node.parent) {
      if (node.queryAll((n) => n.type === 'TextInput', { includeSelf: true }).length > 1) return false;
      if (within(node).queryAllByText(label).length > 0) return true;
    }
    return false;
  });
  if (found.length !== 1) throw new Error(`Expected one text box labelled "${label}", found ${found.length}`);
  return found[0];
}

if (expect.getState().testPath?.endsWith('/__tests__/helpers/calls.tsx')) {
  describe('call readers', () => {
    it('reads back the RPCs and tables called on the mocked client', () => {
      rpcMock().mockReset();
      fromMock().mockReset();
      supabase.rpc('one', { p_a: 1 });
      supabase.rpc('two');
      supabase.rpc('one', { p_a: 2 });
      supabase.from('teams');
      expect(rpcNames()).toEqual(['one', 'two', 'one']);
      expect(rpcCalls('one')).toEqual([{ p_a: 1 }, { p_a: 2 }]);
      expect(onlyRpcCall('two')).toEqual({});
      expect(writesAmong(['one'])).toEqual(['two']);
      expect(tablesRead()).toEqual(['teams']);
      clearCalls();
      expect(rpcNames()).toEqual([]);
      expect(tablesRead()).toEqual([]);
    });
  });
}
