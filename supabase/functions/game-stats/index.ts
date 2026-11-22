// One athlete's own figures from a recorded game, for the game's goals page.
// The logic is in stats.ts, which Jest tests; this file only talks to the
// database and serves requests.
//
// Deployed with JWT verification on, so only signed-in members reach it, by
// .github/workflows/game-stats-function.yml (only when someone presses Run
// workflow). It needs no secrets of its own: SUPABASE_URL, the anon key and
// the service role key are given to every function.
//
// deno.json beside this file names the engine and schema versions: keep them
// the same as package.json, which the tests run (__tests__/versions.test.ts).

import { createClient } from 'npm:@supabase/supabase-js@2';
import * as engine from '@firstpass/engine';
import { anonKey, handleStats, type Access, type EventRow } from './stats.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const options = { auth: { persistSession: false, autoRefreshToken: false } };

Deno.serve((request) =>
  handleStats(request, {
    engine,
    logger: console,
    // As the caller, so the database's own rules decide.
    async access(authorization, athleteId, fixtureId) {
      const client = createClient(url, anonKey(Deno.env), { ...options, global: { headers: { Authorization: authorization } } });
      const { data, error } = await client.rpc('goal_game_stats_access', { p_athlete_id: athleteId, p_fixture_id: fixtureId });
      if (error) throw new Error(`goal_game_stats_access: ${error.code ?? 'failed'}`);
      return (data ?? null) as Access;
    },
    // With the service role, and only after access() said yes.
    async events(gameId) {
      const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, options);
      const rows: EventRow[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await admin
          .from('game_events')
          .select('id, game_id, stream, seq, type, payload, recorded_at')
          .eq('game_id', gameId)
          .not('stream', 'like', 'shadow:%')
          .order('stream')
          .order('seq')
          .range(from, from + 999);
        if (error) throw new Error(`game_events: ${error.code ?? 'failed'}`);
        rows.push(...((data ?? []) as EventRow[]));
        if (!data || data.length < 1000) return rows;
      }
    },
  }),
);
