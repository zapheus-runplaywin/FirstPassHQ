// Unit tests never reach a club's Supabase project. Tests that need data mock
// the calls they make on this client.
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), auth: {}, storage: { from: jest.fn() } },
  connectToClub: jest.fn(),
  signOutOfClub: jest.fn(async () => {}),
}));
