import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { kpiCountLabel, reviewCountLabel, useKpiPeople, type KpiPerson } from '@/lib/kpis';
import { teamPositionLabel } from '@/lib/labels';
import { hasRole } from '@/lib/roles';
import { seasonLabel } from '@/lib/use-teams';

/**
 * Season KPIs: the member's own, their children's, and those of the people
 * they set them for, by squad or team.
 */
export default function KpisScreen() {
  const { profile } = useAuth();
  const { kpiPeople, reloadKpiPeople } = useKpiPeople();
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await reloadKpiPeople();
    setRefreshing(false);
  }

  if (kpiPeople === null) return <Screen>{null}</Screen>;

  const current = kpiPeople.filter((p) => !p.archived);
  const past = kpiPeople.filter((p) => p.archived);
  const own = current.filter((p) => p.relation === 'self');
  const children = current.filter((p) => p.relation === 'guardian');
  // People the member sets KPIs for, and athletes' for an admin to read.
  const groups = groupsOf(current.filter((p) => p.relation === 'setter' || p.relation === 'viewer'));
  const seasons = new Set(current.map((p) => p.season));

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ThemedText type="small" themeColor="textSecondary">
        Season KPIs say what someone is working to achieve by the end of the season. A KPI is one
        measure with a target. An OKR is an objective with up to 5 key results.
      </ThemedText>

      {own.length > 0 ? (
        <View style={styles.section}>
          <ThemedText type="subtitle">Yours</ThemedText>
          {own.map((p) => (
            <PersonCard
              key={p.team_id}
              person={p}
              title={groupName(p, seasons)}
              showPosition
              showReviews
            />
          ))}
        </View>
      ) : null}

      {children.length > 0 ? (
        <View style={styles.section}>
          <ThemedText type="subtitle">Your children</ThemedText>
          {children.map((p) => (
            <PersonCard
              key={`${p.profile_id}:${p.team_id}`}
              person={p}
              title={p.full_name}
              subtitle={groupName(p, seasons)}
            />
          ))}
        </View>
      ) : null}

      {groups.map((group) => (
        <View key={group.teamId} style={styles.section}>
          <ThemedText type="subtitle">{groupName(group.people[0], seasons)}</ThemedText>
          {group.people.map((p) => (
            <PersonCard key={p.profile_id} person={p} title={p.full_name} showPosition showReviews />
          ))}
        </View>
      ))}

      {current.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {hasRole(profile, 'committee', 'admin')
            ? 'No squad or team has a coach or manager yet, so there’s nobody to set KPIs for.'
            : 'You’re not in a squad or team this season, so there are no KPIs to show.'}
        </ThemedText>
      ) : null}

      {past.length > 0 ? (
        <View style={styles.section}>
          <ThemedText type="subtitle">Past seasons</ThemedText>
          {past.map((p) => (
            <PersonCard
              key={`${p.profile_id}:${p.team_id}`}
              person={p}
              title={p.relation === 'self' ? 'Yours' : p.full_name}
              subtitle={`${p.team_name} (${seasonLabel(p.season)})`}
              showPosition={p.relation !== 'guardian'}
            />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

function PersonCard({
  person,
  title,
  subtitle,
  showPosition = false,
  showReviews = false,
}: {
  person: KpiPerson;
  title: string;
  subtitle?: string;
  showPosition?: boolean;
  showReviews?: boolean;
}) {
  const reviews = reviewCountLabel(person);
  return (
    <PressableCard
      onPress={() =>
        router.push({
          pathname: '/kpis/person',
          params: { profile: person.profile_id, team: person.team_id },
        })
      }>
      <ThemedText type="smallBold">{title}</ThemedText>
      {subtitle ? (
        <ThemedText type="small" themeColor="textSecondary">
          {subtitle}
        </ThemedText>
      ) : null}
      {showPosition ? (
        <ThemedText type="small" themeColor="textSecondary">
          {teamPositionLabel(person.team_role, person.coach_title)}
        </ThemedText>
      ) : null}
      <ThemedText type="small">
        {kpiCountLabel(person.kpi_count, person.result_count)}
        {showReviews && reviews ? ` · ${reviews}` : ''}
      </ThemedText>
    </PressableCard>
  );
}

/** The group's name, with its season while two seasons run side by side. */
function groupName(person: KpiPerson, seasons: Set<number>) {
  return seasons.size > 1 ? `${person.team_name} (${seasonLabel(person.season)})` : person.team_name;
}

const positionOrder: Record<string, number> = { coach: 0, manager: 1, athlete: 2 };

/** People by squad or team, coaches first, then managers, then athletes. */
function groupsOf(people: KpiPerson[]) {
  const groups: { teamId: string; people: KpiPerson[] }[] = [];
  for (const person of people) {
    let group = groups.find((g) => g.teamId === person.team_id);
    if (!group) {
      group = { teamId: person.team_id, people: [] };
      groups.push(group);
    }
    group.people.push(person);
  }
  for (const group of groups) {
    group.people.sort(
      (a, b) =>
        (positionOrder[a.team_role] ?? 3) - (positionOrder[b.team_role] ?? 3) ||
        (a.coach_title === 'head_coach' ? 0 : 1) - (b.coach_title === 'head_coach' ? 0 : 1) ||
        a.full_name.localeCompare(b.full_name),
    );
  }
  return groups;
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
});
