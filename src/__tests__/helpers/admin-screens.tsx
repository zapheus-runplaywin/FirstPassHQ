/**
 * Helpers for the admin member and group screen tests: finding a form field
 * by its label, a chip inside one section, the RPCs and table writes a screen
 * sent, and table writes the database refuses.
 *
 * Jest treats every file under __tests__ as a suite, so this file checks its
 * own helpers at the bottom, and only when Jest runs it directly.
 */
import { act, fireEvent, screen } from 'expo-router/testing-library';
import type { TestInstance } from 'test-renderer';

import { supabase } from '@/lib/supabase';

import { type QueryCall, type QueryInfo, type TableHandler } from './harness';

/** The smallest element holding `from` and something `has` finds in it. */
function closest(from: TestInstance, has: (node: TestInstance) => boolean) {
  let node: TestInstance | null = from;
  while (node && !has(node)) node = node.parent;
  if (!node) throw new Error('Nothing around that element matches');
  return node;
}

/** The text box under a field's label (TextField puts them side by side). */
export function fieldFor(label: string): TestInstance {
  const inputs = (n: TestInstance) => n.queryAll((c) => c.type === 'TextInput', { includeSelf: true });
  return inputs(closest(screen.getByText(label), (n) => inputs(n).length > 0))[0];
}

/** Types into the field with this label. */
export async function typeInto(label: string, text: string) {
  await fireEvent.changeText(fieldFor(label), text);
  await untilQuiet();
}

/** Presses the control showing this text and lets the screen's calls finish. */
export async function press(text: string | RegExp) {
  await fireEvent.press(screen.getByText(text));
  await untilQuiet();
}

/** How many calls the screen has made to the database so far. */
function requestsSoFar() {
  return (supabase.rpc as jest.Mock).mock.calls.length + (supabase.from as jest.Mock).mock.calls.length;
}

/**
 * Waits until the screen has finished reacting to a press: flushes React and
 * the fake backend's promises until no new database call has started for
 * three rounds in a row (a call, its answer and the re-render each take one).
 * Nothing here waits on the clock, so a busy machine changes how long it
 * takes, never what the screen shows. Fails loudly rather than hang if the
 * screen never settles.
 */
export async function untilQuiet() {
  let quiet = 0;
  let seen = requestsSoFar();
  for (let round = 0; round < 200 && quiet < 3; round++) {
    await act(async () => {
      await Promise.resolve();
    });
    const now = requestsSoFar();
    quiet = now === seen ? quiet + 1 : 0;
    seen = now;
  }
  if (quiet < 3) throw new Error('The screen kept calling the database and never settled');
}

const texts = (n: TestInstance) =>
  n.queryAll((c) => typeof c.props.children === 'string' || Array.isArray(c.props.children), {
    includeSelf: true,
  });

/** Whether this element shows exactly `text`. */
function showsText(n: TestInstance, text: string) {
  return texts(n).some((c) => c.props.children === text);
}

/**
 * A chip (or button) showing `label` inside the part of the screen headed
 * `heading`, for labels such as "Other" that more than one section offers.
 */
export function inSection(heading: string, label: string): TestInstance {
  const section = closest(screen.getByText(heading), (n) => showsText(n, label));
  const match = section.queryAll((c) => c.props.children === label, { includeSelf: true });
  if (match.length === 0) throw new Error(`No "${label}" under "${heading}"`);
  return match[0];
}

export async function pressInSection(heading: string, label: string) {
  await fireEvent.press(inSection(heading, label));
  await untilQuiet();
}

/** The labels of the chips under a chip group's label, in order. */
export function optionsUnder(label: string): string[] {
  const buttons = (n: TestInstance) =>
    n.queryAll((c) => c.props.accessibilityRole === 'button', { includeSelf: true });
  const group = closest(screen.getByText(label), (n) => buttons(n).length > 0);
  return buttons(group).map((b) =>
    b
      .queryAll((c) => typeof c.props.children === 'string', { includeSelf: true })
      .map((t) => t.props.children as string)
      .join(''),
  );
}

/** Whether a chip is shown as chosen. */
export function isChosen(el: TestInstance) {
  const pressable = closest(el, (n) => n.props.accessibilityState !== undefined);
  return !!pressable.props.accessibilityState?.selected;
}

/** Every RPC the screen sent, in order, as [name, args]. */
export function rpcCalls(): [string, Record<string, unknown> | undefined][] {
  return (supabase.rpc as jest.Mock).mock.calls as [string, Record<string, unknown> | undefined][];
}

/** The RPCs sent whose names start with one of `prefixes`, in order (writes, say). */
export function rpcsNamed(...prefixes: string[]) {
  return rpcCalls().filter(([name]) => prefixes.some((p) => name.startsWith(p)));
}

/** The admin_… RPCs sent, in order, with their arguments: what the screen changed. */
export function adminWrites() {
  return rpcCalls().filter(
    ([name]) =>
      name.startsWith('admin_') &&
      ![
        'admin_volunteer_exemptions',
        'admin_wwcc_applications',
        'admin_date_of_birth_record',
        'admin_inactive_members',
        'admin_no_app_child_requests',
      ].includes(name),
  );
}

/** A table write a screen sent: the table and every builder call. */
export type TableWrite = { table: string; calls: QueryCall[] };

const WRITES = ['insert', 'update', 'upsert', 'delete'];

/**
 * A table handler that notes every write to the table in `log` and then
 * answers as `next` would (or with the seeded rows).
 */
export function recordWrites(table: string, log: TableWrite[], next?: TableHandler): TableHandler {
  return (q: QueryInfo) => {
    if (q.calls.some((c) => WRITES.includes(c.method))) {
      log.push({ table, calls: [...q.calls] });
      return [];
    }
    return next?.(q);
  };
}

/**
 * Makes writes to `table` fail as the database would, with an error code
 * (such as 23505 for a name already taken). Reads still answer as before.
 * Call after signInAs / openScreen.
 */
export function refuseTableWrites(table: string, error: { message: string; code?: string }) {
  const from = supabase.from as jest.Mock;
  const answer = from.getMockImplementation()!;
  from.mockImplementation((name: string) => {
    if (name !== table) return answer(name);
    const calls: QueryCall[] = [];
    const replay = () => {
      if (calls.some((c) => WRITES.includes(c.method))) {
        return Promise.resolve({ data: null, error, count: null, status: 409 });
      }
      let builder = answer(name);
      for (const c of calls) builder = builder[c.method](...c.args);
      return builder;
    };
    const builder: object = new Proxy(function builder() {}, {
      get(_t, prop) {
        if (prop === 'then') {
          return (ok?: (r: unknown) => unknown, fail?: (e: unknown) => unknown) =>
            Promise.resolve(replay()).then(ok, fail);
        }
        if (typeof prop === 'symbol') return undefined;
        return (...args: unknown[]) => {
          calls.push({ method: prop, args });
          return builder;
        };
      },
    });
    return builder;
  });
}

/** Spies on router.back, which saving and deleting use to leave the screen. */
export function spyOnBack() {
  // Loaded here so the self-check below doesn't need the router.
  const { router } = jest.requireActual('expo-router') as typeof import('expo-router');
  return jest.spyOn(router, 'back').mockImplementation(() => {});
}

// ---------------------------------------------------------------------------
// The helpers' own checks, run only when Jest runs this file.

if (expect.getState().testPath?.endsWith('/__tests__/helpers/admin-screens.tsx')) {
  describe('admin screen test helpers', () => {
    it('records table writes and lets reads through', () => {
      const log: TableWrite[] = [];
      const handler = recordWrites('teams', log, () => [{ id: 't' }]);
      const read: QueryInfo = { name: 'teams', calls: [{ method: 'select', args: ['*'] }], eq: () => undefined };
      expect(handler(read)).toEqual([{ id: 't' }]);
      expect(log).toEqual([]);
      const write: QueryInfo = {
        name: 'teams',
        calls: [
          { method: 'update', args: [{ name: 'New' }] },
          { method: 'eq', args: ['id', 't'] },
        ],
        eq: () => 't',
      };
      expect(handler(write)).toEqual([]);
      expect(log).toEqual([{ table: 'teams', calls: write.calls }]);
    });
  });
}
