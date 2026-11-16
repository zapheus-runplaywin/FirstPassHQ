import { loadPilot, pilotFeaturesToSave, pilotGroupOptions, pilotSummary, savePilot } from '@/lib/pilot';
import { supabase } from '@/lib/supabase';
import type { Team } from '@/lib/types';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('@/lib/club', () => ({}));

const rpc = supabase.rpc as jest.Mock;
const team = (id: string, kind: 'squad' | 'team', squad_id: string | null = null): Team => ({
  id,
  name: id,
  kind,
  squad_id,
  sort_order: 0,
  season: 2026,
  selections_completed_at: null,
});

beforeEach(() => rpc.mockReset());

describe('loadPilot', () => {
  it('reads the saved pilot', async () => {
    rpc.mockResolvedValue({
      data: [{ pilot_features: ['injuries'], pilot_team_ids: ['a'] }],
      error: null,
    });
    expect(await loadPilot()).toEqual({
      features: ['injuries'],
      teamIds: ['a'],
    });
    expect(rpc).toHaveBeenCalledWith('admin_pilot_settings');
  });

  it('is no pilot on a refusal, no rows or empty columns', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'no' } });
    expect(await loadPilot()).toEqual({ features: [], teamIds: [] });
    rpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await loadPilot()).toEqual({ features: [], teamIds: [] });
    rpc.mockResolvedValueOnce({
      data: [{ pilot_features: null, pilot_team_ids: null }],
      error: null,
    });
    expect(await loadPilot()).toEqual({ features: [], teamIds: [] });
  });
});

describe('savePilot', () => {
  it('sends the features and teams, and returns the refusal', async () => {
    rpc.mockResolvedValueOnce({ error: null });
    expect(await savePilot(['surveys'], ['t'])).toBeNull();
    expect(rpc).toHaveBeenCalledWith('admin_set_pilot', {
      p_features: ['surveys'],
      p_team_ids: ['t'],
    });
    rpc.mockResolvedValueOnce({
      error: { message: 'Only admins can change the pilot' },
    });
    expect(await savePilot([], [])).toBe('Only admins can change the pilot');
  });
});

describe('pilotFeaturesToSave', () => {
  it('keeps only pilot-only features that are on', () => {
    const on = { injuries: false, surveys: true } as unknown as Parameters<typeof pilotFeaturesToSave>[0];
    expect(pilotFeaturesToSave(on, ['injuries', 'surveys'])).toEqual(['surveys']);
    expect(pilotFeaturesToSave(on, [])).toEqual([]);
  });
});

describe('pilotGroupOptions', () => {
  it('puts each squad before its teams and keeps a team whose squad isn’t listed', () => {
    const options = pilotGroupOptions([
      team('Open', 'squad'),
      team('Orphan', 'team', 'old-squad'),
      team('20U', 'squad'),
      team('20U A', 'team', '20U'),
      team('Mixed', 'team'),
    ]);
    expect(options.map((o) => o.label)).toEqual([
      'Open (squad)',
      '20U (squad)',
      '20U A (team)',
      'Mixed',
      'Orphan (team)',
    ]);
    expect(options.map((o) => o.value)).toEqual(['Open', '20U', '20U A', 'Mixed', 'Orphan']);
  });
});

describe('pilotSummary', () => {
  it('says nothing with no pilot-only features', () => {
    expect(pilotSummary([], ['a'])).toBeNull();
  });
  it('warns with no squads or teams in the pilot', () => {
    expect(pilotSummary(['injuries'], [])).toMatch(/only show just for admins and committee/);
  });
  it('says who sees them', () => {
    expect(pilotSummary(['injuries'], ['a'])).toMatch(/parents of their athletes, admins and committee/);
  });
});
