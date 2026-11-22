/**
 * Helpers for the admin settings and programme screen tests: finding a form
 * field by its label, reading back what a screen wrote to a table, making one
 * table write fail as the database would, and a club settings provider whose
 * saved profile a test chooses.
 *
 * Jest treats every file under __tests__ as a suite, so this file checks
 * itself at the bottom, only when Jest runs it directly.
 */
import type { ReactNode } from 'react';
import type { TestInstance } from 'test-renderer';
import { fireEvent, screen, within } from 'expo-router/testing-library';

import { supabase } from '@/lib/supabase';
import type { QueryCall, QueryInfo, TableHandler } from './harness';

// ---------------------------------------------------------------------------
// Form fields

function hasInput(node: TestInstance) {
  return node.queryAll((n) => n.type === 'TextInput', { includeSelf: true }).length > 0;
}

/**
 * The closest part of the screen around a label (a TextField, PersonPicker or
 * ChipGroup) that holds a text box. `index` picks between labels shown twice.
 */
export function fieldGroup(label: string | RegExp, index = 0): TestInstance {
  let node: TestInstance | null = screen.getAllByText(label)[index];
  while (node && !hasInput(node)) node = node.parent;
  if (!node) throw new Error(`No text box near “${String(label)}”`);
  return node;
}

/** The text box under a label. */
export function input(label: string | RegExp, index = 0): TestInstance {
  return fieldGroup(label, index).queryAll((n) => n.type === 'TextInput', { includeSelf: true })[0];
}

/** Types into the text box under a label. */
export async function type(label: string | RegExp, text: string, index = 0) {
  await fireEvent.changeText(input(label, index), text);
}

/**
 * Searches a PersonPicker or PeoplePicker by name and taps the match (a
 * PeoplePicker shows matches as "+ Name").
 */
export async function pickPerson(pickerLabel: string, search: string, name: string) {
  await type(pickerLabel, search);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await fireEvent.press(within(fieldGroup(pickerLabel)).getByText(new RegExp(`^(\\+ )?${escaped}$`)));
}

/** Flips a Switch found by its accessibility label. */
export async function flip(label: string, value: boolean) {
  await fireEvent(screen.getByLabelText(label), 'valueChange', value);
}

/** Whether a Switch is on. */
export function isOn(label: string) {
  return screen.getByLabelText(label).props.value as boolean;
}

/** Whether a chip or button is shown as selected. */
export function isSelected(text: string | RegExp) {
  let node: TestInstance | null = screen.getByText(text);
  while (node && node.props.accessibilityState === undefined) node = node.parent;
  return node?.props.accessibilityState?.selected === true;
}

/** Whether the button holding this text can't be pressed. */
export function isDisabled(text: string) {
  let node: TestInstance | null = screen.getByText(text);
  while (node && node.props.accessibilityRole !== 'button') node = node.parent;
  return node?.props.accessibilityState?.disabled === true || node?.props.disabled === true;
}

// ---------------------------------------------------------------------------
// Table writes

export type TableQuery = { table: string; calls: QueryCall[] };

const WRITES = ['insert', 'update', 'upsert', 'delete'];

/**
 * Table handlers that note every query on these tables as it's answered,
 * then answer with `rows` (when given) or the seeded rows.
 */
export function recordTables(
  tables: string[],
  rows: Record<string, TableHandler> = {},
): { handlers: Record<string, TableHandler>; log: TableQuery[] } {
  const log: TableQuery[] = [];
  const handlers = Object.fromEntries(
    tables.map((table) => [
      table,
      (q: QueryInfo) => {
        log.push({ table, calls: [...q.calls] });
        return rows[table]?.(q);
      },
    ]),
  );
  return { handlers, log };
}

/** Each write in the log, as its method, the row or changes sent, and its filters. */
export function writes(log: TableQuery[], table: string) {
  return log
    .filter((q) => q.table === table && q.calls.some((c) => WRITES.includes(c.method)))
    .map((q) => {
      const write = q.calls.find((c) => WRITES.includes(c.method))!;
      return {
        method: write.method,
        values: write.args[0],
        filters: q.calls.filter((c) => c.method === 'eq').map((c) => c.args),
      };
    });
}

/**
 * From now on, a query on `table` that calls `method` (such as insert) fails
 * with `message`, as the database refusing it. Other queries are unchanged.
 */
export function failTableWrite(table: string, method: string, message: string) {
  const from = supabase.from as jest.Mock;
  const original = from.getMockImplementation()!;
  from.mockImplementation((name: string) => {
    const real = original(name);
    if (name !== table) return real;
    let failing = false;
    const wrap = (inner: unknown): unknown =>
      new Proxy(function builder() {}, {
        get(_t, prop) {
          const target = inner as Record<string | symbol, unknown>;
          if (prop === 'then') {
            if (!failing) return (target.then as (...a: unknown[]) => unknown).bind(inner);
            return (ok?: (r: unknown) => unknown, fail?: (e: unknown) => unknown) =>
              Promise.resolve({ data: null, error: { message }, count: null, status: 400 }).then(
                ok,
                fail,
              );
          }
          if (typeof prop === 'symbol') return undefined;
          return (...args: unknown[]) => {
            if (prop === method) failing = true;
            return wrap((target[prop] as (...a: unknown[]) => unknown)(...args));
          };
        },
      });
    return wrap(real);
  });
}

// ---------------------------------------------------------------------------
// Club settings with a saved profile

type ClubProfileRow = {
  club_name: string | null;
  short_name: string | null;
  background_colour: string | null;
  text_colour: string | null;
  hero_colour: string | null;
  logo_path: string | null;
  features: Partial<Record<string, boolean>>;
  updated_at: string | null;
  timezone?: string | null;
};

const EMPTY_PROFILE: ClubProfileRow = {
  club_name: null,
  short_name: null,
  background_colour: null,
  text_colour: null,
  hero_colour: null,
  logo_path: null,
  features: {},
  updated_at: null,
};

let savedProfile: ClubProfileRow = EMPTY_PROFILE;
let savedValue: unknown = null;
export const clubReload = jest.fn(async () => {});

/** The club's saved settings, as Club settings would load them. */
export function setSavedClub(profile: Partial<ClubProfileRow> = {}) {
  savedProfile = { ...EMPTY_PROFILE, ...profile };
  savedValue = null;
  clubReload.mockClear();
}

/** Stands in for `@/lib/club` with a saved profile, for the Club settings screen. */
export function savedClubModuleMock() {
  const actual = jest.requireActual('@/lib/club') as typeof import('@/lib/club');
  const current = () => {
    if (!savedValue) {
      savedValue = {
        ready: true,
        profile: savedProfile,
        reload: clubReload,
        ...actual.resolveClub(savedProfile),
      };
    }
    return savedValue as ReturnType<typeof actual.useClub>;
  };
  return {
    ...actual,
    ClubProvider: ({ children }: { children: ReactNode }) => children,
    useClub: () => current(),
    useFeature: (key: keyof ReturnType<typeof actual.useClub>['features']) =>
      current().features[key],
    useSquads: () => current().squads,
    useClubColors: () => current().colors,
  };
}

// ---------------------------------------------------------------------------
// This file's own checks, run only when Jest runs it directly.

if (expect.getState().testPath?.endsWith('/__tests__/helpers/settings-forms.tsx')) {
  describe('settings form helpers', () => {
    it('records table writes with their filters, and fails only the chosen write', async () => {
      const { signInAs, personas } = jest.requireActual('./harness') as typeof import('./harness');
      const { handlers, log } = recordTables(['calendars']);
      signInAs(personas.admin, { calendars: [{ id: 'c1' }] }, { tableHandlers: handlers });
      await supabase.from('calendars').update({ name: 'New' }).eq('id', 'c1');
      expect(writes(log, 'calendars')).toEqual([
        { method: 'update', values: { name: 'New' }, filters: [['id', 'c1']] },
      ]);
      failTableWrite('calendars', 'insert', 'Refused');
      const failed = await supabase.from('calendars').insert({ name: 'x' });
      expect(failed.error).toEqual({ message: 'Refused' });
      const read = await supabase.from('calendars').select('*');
      expect(read.error).toBeNull();
      expect(read.data).toEqual([{ id: 'c1' }]);
    });
  });
}
