import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, StyleSheet, Switch, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isMinor } from '@/lib/age';
import { PROFILE_COLUMNS } from '@/lib/auth';
import { memberName } from '@/lib/reports';
import { wwccStatus } from '@/lib/safety';
import { supabase } from '@/lib/supabase';
import type { Profile, SafeguardingContacts, VolunteerExemption } from '@/lib/types';

/** How many people to offer while searching. */
const MATCHES = 5;

/**
 * The club's Child Safety Officer and Complaints Manager, who see and act on
 * concerns members raise, and the governing body's contact details and the
 * club's safeguarding policy, shown wherever a concern can be raised.
 */
export default function SafeguardingScreen() {
  const [eligible, setEligible] = useState<Profile[]>([]);
  const [officer, setOfficer] = useState<string | null>(null);
  const [manager, setManager] = useState<string | null>(null);
  const [bodyName, setBodyName] = useState('');
  const [bodyPhone, setBodyPhone] = useState('');
  const [bodyUrl, setBodyUrl] = useState('');
  const [policyUrl, setPolicyUrl] = useState('');
  const [minorPhotos, setMinorPhotos] = useState(false);
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [contactsResult, membersResult, exemptionsResult, photosResult] = await Promise.all([
      supabase.rpc('safeguarding_contacts').maybeSingle(),
      supabase.from('profiles').select(PROFILE_COLUMNS).eq('status', 'approved').order('full_name'),
      supabase.rpc('admin_volunteer_exemptions'),
      supabase.rpc('safeguarding_photo_setting'),
    ]);
    setMinorPhotos(photosResult.data === true);
    const contacts = contactsResult.data as SafeguardingContacts | null;
    setOfficer(contacts?.child_safety_officer_id ?? null);
    setManager(contacts?.complaints_manager_id ?? null);
    setBodyName(contacts?.governing_body_name ?? '');
    setBodyPhone(contacts?.governing_body_phone ?? '');
    setBodyUrl(contacts?.governing_body_url ?? '');
    setPolicyUrl(contacts?.policy_url ?? '');
    const exempt = new Set(
      ((exemptionsResult.data as VolunteerExemption[] | null) ?? [])
        .filter((e) => !e.ended_at && e.valid)
        .map((e) => e.profile_id),
    );
    // The same rule as the database: approved adults, not stood down, screened.
    setEligible(
      ((membersResult.data as Profile[] | null) ?? []).filter((m) => {
        const check = wwccStatus(m).kind;
        return (
          !isMinor(m.date_of_birth, m.under_17) &&
          !m.stood_down_at &&
          (check === 'current' || check === 'expiring' || exempt.has(m.id))
        );
      }),
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function save() {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('admin_set_safeguarding', {
      p_child_safety_officer_id: officer,
      p_complaints_manager_id: manager,
      p_governing_body_name: bodyName,
      p_governing_body_phone: bodyPhone,
      p_governing_body_url: bodyUrl,
      p_policy_url: policyUrl,
    });
    const { error: photosError } = rpcError
      ? { error: null }
      : await supabase.rpc('admin_set_minor_injury_photos', { p_allowed: minorPhotos });
    setBusy(false);
    if (rpcError || photosError) {
      setError((rpcError ?? photosError)?.message ?? null);
      return;
    }
    router.back();
  }

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary">
        Members can raise a concern from their home screen, the check-in screen, injuries and
        messages. The Child Safety Officer, the Complaints Manager and admins see every concern,
        except one about themselves. Choose two different people, each an adult with a current
        Working With Children Check, so a concern about one can go to the other.
      </ThemedText>
      <PersonPicker
        label="Child Safety Officer"
        people={eligible}
        selected={officer}
        onChange={setOfficer}
      />
      <PersonPicker
        label="Complaints Manager"
        people={eligible}
        selected={manager}
        onChange={setManager}
      />

      <View style={styles.group}>
        <ThemedText type="smallBold">Governing body</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Shown to everyone raising a concern. Child abuse and serious crimes go to Police and the
          governing body straight away.
        </ThemedText>
        <TextField
          label="Name"
          value={bodyName}
          onChangeText={setBodyName}
          placeholder="For example, your state association"
          maxLength={100}
        />
        <TextField
          label="Phone or hotline"
          value={bodyPhone}
          onChangeText={setBodyPhone}
          keyboardType="phone-pad"
          maxLength={30}
        />
        <TextField
          label="Complaints form link"
          value={bodyUrl}
          onChangeText={setBodyUrl}
          placeholder="https://"
          autoCapitalize="none"
          keyboardType="url"
          maxLength={500}
        />
      </View>
      <TextField
        label="The club’s safeguarding policy (link)"
        value={policyUrl}
        onChangeText={setPolicyUrl}
        placeholder="https://"
        autoCapitalize="none"
        keyboardType="url"
        maxLength={500}
      />

      <View style={styles.group}>
        <ThemedText type="smallBold">Photos of under 18s’ injuries</ThemedText>
        <Card style={styles.switchRow}>
          <ThemedText type="small" style={styles.grow}>
            Allow a verified parent or guardian to add a photo of their child’s injury, after they
            confirm their consent
          </ThemedText>
          <Switch
            accessibilityLabel="Allow photos of under 18s’ injuries"
            value={minorPhotos}
            onValueChange={setMinorPhotos}
            trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
            thumbColor={theme.text}
            {...(Platform.OS === 'web' ? { activeThumbColor: theme.onAccent } : {})}
          />
        </Card>
        <ThemedText type="small" themeColor="textSecondary">
          Off by default, so under 18s attach the physio’s or doctor’s letter as a PDF. Athletes
          under 18 can never add a photo themselves.
        </ThemedText>
      </View>
      <ErrorText>{error}</ErrorText>
      <Button title="Save" onPress={save} busy={busy} />
    </Screen>
  );
}

function PersonPicker({
  label,
  people,
  selected,
  onChange,
}: {
  label: string;
  people: Profile[];
  selected: string | null;
  onChange: (id: string | null) => void;
}) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const chosen = people.find((p) => p.id === selected);
  const matches = query
    ? people
        .filter(
          (p) =>
            p.id !== selected &&
            [p.full_name, p.preferred_name, p.email].some((v) => v?.toLowerCase().includes(query)),
        )
        .slice(0, MATCHES)
    : [];
  return (
    <View style={styles.group}>
      <ThemedText type="smallBold">{label}</ThemedText>
      {chosen ? (
        <ChipGroup
          options={[{ value: chosen.id, label: `${memberName(chosen)}  ✕` }]}
          selected={[chosen.id]}
          onToggle={() => onChange(null)}
        />
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          Nobody chosen.
        </ThemedText>
      )}
      <TextField label="Search" value={search} onChangeText={setSearch} placeholder="Name or email" />
      {matches.length > 0 ? (
        <ChipGroup
          options={matches.map((p) => ({ value: p.id, label: memberName(p) }))}
          selected={[]}
          onToggle={(id) => {
            onChange(id);
            setSearch('');
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
  grow: { flex: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});
