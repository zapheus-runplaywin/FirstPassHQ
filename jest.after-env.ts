// What a screen test leaves behind would otherwise keep every screen it
// rendered, and the 2,815 route tests in one file ran out of memory:
// - React Native's mocked host components share one jest.fn for each native
//   method (measure, focus and the rest), and a jest.fn keeps the component
//   behind every call.
// - Unmounting a screen queues navigation work as microtasks. Under fake
//   timers those wait in the fake clock, which Jest keeps after the test, so
//   the screen is unmounted and that work run here.
// - React Native's test set-up makes performance.now a jest.fn, which React's
//   scheduler calls thousands of times a test, and the Supabase client mock
//   (jest.setup.ts) keeps every query. Both live for the whole file, so their
//   calls are cleared too.
import { cleanup } from '@testing-library/react-native';

import { supabase } from '@/lib/supabase';

// Untyped; the methods are the jest.fn mocks every native component shares.
const MockNativeMethods = jest.requireActual<{ default: Record<string, jest.Mock> }>(
  '@react-native/jest-preset/jest/MockNativeMethods',
).default;

// Fake timers swap performance for their own, so keep the one React holds.
const performanceNow = performance.now;

afterEach(async () => {
  for (const method of Object.values(MockNativeMethods)) method.mockClear();
  await cleanup();
  if ('clock' in setTimeout) jest.runAllTicks();
  for (const fn of [performanceNow, supabase.rpc, supabase.from, supabase.storage.from]) {
    if (jest.isMockFunction(fn)) fn.mockClear();
  }
});
