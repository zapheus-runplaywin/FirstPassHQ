/**
 * Small helpers for the form and everyday-screen tests: finding a labelled
 * text field, reading the RPCs and table writes a screen sent to the fake
 * backend (helpers/harness.tsx), and pressing buttons.
 *
 * Jest treats every file under __tests__ as a suite, so this file checks
 * itself at the bottom, only when Jest runs it directly.
 */
import { fireEvent, screen } from 'expo-router/testing-library';
import type { ReactTestInstance } from 'react-test-renderer';

import { supabase } from '@/lib/supabase';

import type { QueryCall, QueryInfo, TableHandler } from './harness';

/** Forgets the calls earlier tests made. Call it in beforeEach. */
export function clearCalls() {
  (supabase.rpc as jest.Mock).mockClear();
  (supabase.from as jest.Mock).mockClear();
}

/** Every RPC the screen called, with its arguments, in order. */
export function rpcCalls() {
  return (supabase.rpc as jest.Mock).mock.calls as [string, Record<string, unknown> | undefined][];
}

export function rpcNames() {
  return rpcCalls().map(([name]) => name);
}

/** The arguments of each call to one RPC. */
export function argsOf(name: string) {
  return rpcCalls()
    .filter(([n]) => n === name)
    .map(([, args]) => args);
}

/** Every table the screen read or wrote. */
export function tableNames() {
  return ((supabase.from as jest.Mock).mock.calls as [string][]).map(([t]) => t);
}

/**
 * Records each query on a table (its filters, and any insert, update or
 * delete with its payload), answering with `rows` or the seeded rows.
 */
export function recordTable(rows?: (q: QueryInfo) => unknown) {
  const queries: QueryCall[][] = [];
  const handler: TableHandler = (q) => {
    queries.push([...q.calls]);
    return rows?.(q);
  };
  /** The payloads of each write of this kind, such as every `insert(...)`. */
  const writes = (method: 'insert' | 'update' | 'delete' | 'upsert') =>
    queries.flatMap((calls) => calls.filter((c) => c.method === method).map((c) => c.args[0]));
  /** The filters chained on the write of this kind, such as `[['id', 'x']]` for eq. */
  const filtersOf = (method: 'insert' | 'update' | 'delete' | 'upsert', filter = 'eq') =>
    queries
      .filter((calls) => calls.some((c) => c.method === method))
      .map((calls) => calls.filter((c) => c.method === filter).map((c) => c.args));
  return { handler, queries, writes, filtersOf };
}

/** The text input under a field's label (TextField in components/ui.tsx). */
export function field(label: string | RegExp): ReactTestInstance {
  let node: ReactTestInstance | null = screen.getByText(label);
  while (node) {
    const inputs = node.findAll((n) => (n.type as unknown) === 'TextInput', { deep: true });
    if (inputs.length > 0) return inputs[0];
    node = node.parent;
  }
  throw new Error(`No text field labelled ${String(label)}`);
}

export function type(label: string | RegExp, value: string) {
  fireEvent.changeText(field(label), value);
}

/** Whether a chip or toggle (accessibilityState.selected) is chosen. */
export function isSelected(label: string | RegExp) {
  let node: ReactTestInstance | null = screen.getByText(label);
  while (node) {
    const state = node.props.accessibilityState as { selected?: boolean } | undefined;
    if (state && 'selected' in state) return !!state.selected;
    node = node.parent;
  }
  throw new Error(`${String(label)} is not a chip`);
}

/** Whether the Pressable around this text is disabled. */
export function isDisabled(label: string | RegExp) {
  let node: ReactTestInstance | null = screen.getByText(label);
  while (node) {
    if (node.props.accessibilityRole === 'button' || node.props.role === 'button') {
      return !!(node.props.disabled || node.props.accessibilityState?.disabled);
    }
    node = node.parent;
  }
  throw new Error(`${String(label)} is not in a button`);
}

if (expect.getState().testPath?.endsWith('/__tests__/helpers/forms.tsx')) {
  describe('form helpers', () => {
    it('recordTable keeps each write’s payload and filters', () => {
      const t = recordTable(() => [{ id: 'r1' }]);
      const calls = (list: [string, ...unknown[]][]) =>
        list.map(([method, ...args]) => ({ method, args }));
      const q = (c: QueryCall[]): QueryInfo => ({ name: 't', calls: c, eq: () => undefined });
      expect(t.handler(q(calls([['insert', { a: 1 }], ['select', '*']])))).toEqual([{ id: 'r1' }]);
      t.handler(q(calls([['update', { b: 2 }], ['eq', 'id', 'x']])));
      expect(t.writes('insert')).toEqual([{ a: 1 }]);
      expect(t.writes('update')).toEqual([{ b: 2 }]);
      expect(t.filtersOf('update')).toEqual([[['id', 'x']]]);
      expect(t.writes('delete')).toEqual([]);
    });
  });
}
