import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { formatDate, parseDate } from '@/lib/age';
import { useSquads } from '@/lib/club';
import { formatDateString } from '@/lib/injuries';
import {
  childDetailsProblem,
  newestSeasonGroups,
  type MyNoAppChildRequest,
  type NoAppChildRequest,
} from '@/lib/no-app-child';
import { supabase } from '@/lib/supabase';
import { newestGroups, useTeams } from '@/lib/use-teams';

/**
 * A parent or guardian asks the club to add their child who won't use the
 * app. A club admin checks the details and adds the child, linked to them.
 */
export function NoAppChildCard() {
  const groups = newestGroups(useTeams());
  const word = useSquads() ? 'squad' : 'team';
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [teamId, setTeamId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<MyNoAppChildRequest[]>([]);

  const load = useCallback(
    () =>
      supabase
        .rpc('my_no_app_child_requests')
        .then(({ data }) => setRequests((data as MyNoAppChildRequest[] | null) ?? [])),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  async function send() {
    const problem = childDetailsProblem(name, dateOfBirth);
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('request_no_app_child', {
      p_full_name: name,
      p_date_of_birth: parseDate(dateOfBirth),
      p_team_id: teamId,
    });
    setSaving(false);
    if (rpcError) return setError(rpcError.message);
    setName('');
    setDateOfBirth('');
    setTeamId(null);
    setOpen(false);
    load();
  }

  async function withdraw(id: string) {
    const { error: rpcError } = await supabase.rpc('withdraw_no_app_child_request', {
      p_request_id: id,
    });
    if (rpcError) return setError(rpcError.message);
    load();
  }

  return (
    <Card>
      <ThemedText type="smallBold">Child who won’t use the app</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        If your child under 18 has no phone or won’t use the app, the club can add them without a
        sign-in of their own. You then do everything for them: consent, absences, injuries and
        surveys.
      </ThemedText>
      {requests.map((r) => (
        <View key={r.id} style={styles.row}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.grow}>
            ✓ You’ve asked the club to add {r.full_name}
            {r.team_name ? ` (${r.team_name})` : ''}. A club admin will check and add them.
          </ThemedText>
          <Button title="Withdraw" variant="secondary" onPress={() => withdraw(r.id)} />
        </View>
      ))}
      {open ? (
        <ChildDetails
          name={name}
          setName={setName}
          dateOfBirth={dateOfBirth}
          setDateOfBirth={setDateOfBirth}>
          {groups.length > 0 ? (
            <ChipGroup
              label={`Their ${word}`}
              options={groups.map((t) => ({ value: t.id, label: t.name }))}
              selected={teamId ? [teamId] : []}
              onToggle={(id) => setTeamId(id === teamId ? null : id)}
            />
          ) : null}
        </ChildDetails>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {open ? (
        <Button title="Ask the club to add them" onPress={send} busy={saving} />
      ) : (
        <Button
          title="Add a child who won’t use the app"
          variant="secondary"
          onPress={() => setOpen(true)}
        />
      )}
    </Card>
  );
}

/** The child's name and date of birth, with anything else the form needs below. */
function ChildDetails({
  name,
  setName,
  dateOfBirth,
  setDateOfBirth,
  children,
}: {
  name: string;
  setName: (v: string) => void;
  dateOfBirth: string;
  setDateOfBirth: (v: string) => void;
  children?: ReactNode;
}) {
  return (
    <View style={styles.form}>
      <TextField label="Child’s name" value={name} onChangeText={setName} maxLength={80} />
      <TextField
        label="Child’s date of birth"
        value={dateOfBirth}
        onChangeText={setDateOfBirth}
        placeholder="DD/MM/YYYY"
        keyboardType="numbers-and-punctuation"
        maxLength={10}
      />
      {children}
    </View>
  );
}

/**
 * On a verified parent's page in Members: the children they asked the club to
 * add, and a form to add a child who won't sign in, linked to them.
 */
export function NoAppChildAdmin({
  guardianId,
  guardianName,
  canAdd,
  onAdded,
}: {
  guardianId: string;
  guardianName: string;
  /** Verified, and asking to join as, or approved as, a parent or guardian. */
  canAdd: boolean;
  onAdded: () => void;
}) {
  const teams = newestSeasonGroups(useTeams());
  const [requests, setRequests] = useState<NoAppChildRequest[]>([]);
  // The request being added (its id), 'new' for one with no request, or null.
  const [adding, setAdding] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      supabase
        .rpc('admin_no_app_child_requests', { p_guardian_id: guardianId })
        .then(({ data }) => setRequests((data as NoAppChildRequest[] | null) ?? [])),
    [guardianId],
  );

  useEffect(() => {
    load();
  }, [load]);

  function start(request: NoAppChildRequest | null) {
    setAdding(request?.id ?? 'new');
    setName(request?.full_name ?? '');
    setDateOfBirth(formatDate(request?.date_of_birth));
    setTeamIds(request?.team_id ? [request.team_id] : []);
    setError(null);
  }

  async function add() {
    const problem = childDetailsProblem(name, dateOfBirth);
    if (problem) return setError(problem);
    setBusy('add');
    setError(null);
    const { error: rpcError } = await supabase.rpc('admin_add_no_app_child', {
      p_guardian_id: guardianId,
      p_full_name: name,
      p_date_of_birth: parseDate(dateOfBirth),
      p_team_ids: teamIds,
      p_request_id: adding === 'new' ? null : adding,
    });
    setBusy(null);
    if (rpcError) return setError(rpcError.message);
    setAdding(null);
    load();
    onAdded();
  }

  async function decline(id: string) {
    setBusy(id);
    setError(null);
    const { error: rpcError } = await supabase.rpc('admin_decline_no_app_child_request', {
      p_request_id: id,
    });
    setBusy(null);
    if (rpcError) return setError(rpcError.message);
    load();
  }

  if (!canAdd && requests.length === 0) return null;

  return (
    <View style={styles.form}>
      <ThemedText type="smallBold">Children who won’t use the app</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        A child added here has no sign-in: {guardianName} does everything for them. Check the
        child’s name, date of birth and that {guardianName} is their parent or guardian against
        PlayHQ first. The child is approved as an athlete and linked to {guardianName}
        {canAdd ? ', who is approved with them if they’re still waiting' : ''}.
      </ThemedText>
      {!canAdd ? (
        <ThemedText type="small" themeColor="textSecondary">
          Verify who {guardianName} is before adding a child.
        </ThemedText>
      ) : null}
      {requests.map((r) => (
        <Card key={r.id}>
          <ThemedText type="smallBold">{r.full_name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Born {formatDateString(r.date_of_birth)}
            {r.team_name ? ` · Asked for ${r.team_name}` : ''} · Asked{' '}
            {formatDateString(r.requested_at.slice(0, 10))}
          </ThemedText>
          {adding !== r.id ? (
            <View style={styles.row}>
              {canAdd ? (
                <Button title={`Check and add ${r.full_name}`} onPress={() => start(r)} />
              ) : null}
              <Button
                title="Turn down"
                variant="secondary"
                busy={busy === r.id}
                onPress={() => decline(r.id)}
              />
            </View>
          ) : null}
        </Card>
      ))}
      {adding ? (
        <View style={styles.form}>
          <ChildDetails
            name={name}
            setName={setName}
            dateOfBirth={dateOfBirth}
            setDateOfBirth={setDateOfBirth}>
            <ChipGroup
              label="Squads and teams"
              options={teams.map((t) => ({
                value: t.id,
                label: t.squad_id ? `· ${t.name}` : t.name,
              }))}
              selected={teamIds}
              onToggle={(id) =>
                setTeamIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
              }
            />
            <ThemedText type="small" themeColor="textSecondary">
              A team’s squad is added with it.
            </ThemedText>
          </ChildDetails>
          <ErrorText>{error}</ErrorText>
          <Button title="Add child" onPress={add} busy={busy === 'add'} />
          <Button title="Cancel" variant="secondary" onPress={() => setAdding(null)} />
        </View>
      ) : (
        <>
          <ErrorText>{error}</ErrorText>
          {canAdd ? (
            <Button
              title="Add a child who won’t sign in"
              variant="secondary"
              onPress={() => start(null)}
            />
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.two,
  },
  grow: {
    flexGrow: 1,
    flexShrink: 1,
  },
});
