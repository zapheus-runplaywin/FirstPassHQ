// Unit tests never reach a club's Supabase project. Tests that need data mock
// the calls they make on this client.
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), auth: {}, storage: { from: jest.fn() } },
  connectToClub: jest.fn(),
}));

// Unit tests never send crash reports. src/lib/__tests__/crash-reports.test.ts
// checks what the app would pass to Sentry through these.
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  setTag: jest.fn(),
  setUser: jest.fn(),
  captureException: jest.fn(),
}));
