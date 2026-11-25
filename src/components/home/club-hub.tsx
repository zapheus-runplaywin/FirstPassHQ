/**
 * The Club tab's contents for the committee and admins: a search (admins), then
 * what they look after in five areas, each opening where it is. An area says
 * what is inside it and shows anything waiting there, so nothing has to be
 * opened to find out what needs them.
 *
 * Every card and link here is one the member already had: the cards
 * src/lib/home.tsx shows them and the admin's menu. Each opens a screen with
 * its own rule for who may open it (src/lib/route-access.ts).
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { CardGrid } from '@/components/columns';
import { HomeCardView } from '@/components/home/cards';
import { CountBadge, FeatureCard, IconSquare, StatusLine } from '@/components/home/feature-card';
import { SectionTitle } from '@/components/home/tab-header';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  clubRows,
  MEMBER_SEARCH_MIN,
  searchClub,
  searchMembers,
  shownIn,
  type ClubArea,
  type ClubAreaName,
  type ClubEntry,
} from '@/lib/club-areas';
import { rolesLabel } from '@/lib/labels';
import { rolesOf } from '@/lib/roles';
import { useMemberFinder, type FoundMember } from '@/lib/use-club-areas';

/** How many members a search lists before it points to Members for the rest. */
const MEMBERS_SHOWN = 6;

export const CLUB_SEARCH_LABEL = 'Find a member or a setting';

/** One thing in the Club tab: its card with its live line, or an admin's link. */
function EntryView({ entry }: { entry: ClubEntry }) {
  if (entry.card) return <HomeCardView card={entry.card} />;
  const link = entry.link!;
  return (
    <FeatureCard
      icon={link.icon}
      title={link.title}
      detail={entry.waitingText ?? link.detail}
      detailTone={entry.waiting > 0 ? 'attention' : 'quiet'}
      badge={entry.waiting}
      onPress={() => router.push(link.href)}
    />
  );
}

/**
 * An area: a row saying what is inside, which opens where it is. Anything with
 * work waiting shows under the row whether the area is open or not.
 */
function AreaView({
  area,
  open,
  onToggle,
}: {
  area: ClubArea;
  open: boolean;
  onToggle: () => void;
}) {
  const theme = useTheme();
  // Closed, an area still shows what is waiting in it.
  const inside = shownIn(area, open);
  return (
    <View style={styles.area} testID={`club-area-${area.name}`}>
      <Pressable
        accessibilityRole="button"
        aria-expanded={open}
        onPress={onToggle}
        style={({ pressed }) => [
          styles.areaRow,
          { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
        ]}>
        <IconSquare name={area.icon} />
        <View style={styles.text}>
          <ThemedText type="smallBold">{area.title}</ThemedText>
          {open ? null : <StatusLine text={area.summary} />}
        </View>
        <CountBadge count={area.waiting} />
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={theme.textSecondary} />
      </Pressable>
      {inside.length > 0 ? (
        <View style={[styles.inside, { borderLeftColor: theme.backgroundSelected }]}>
          <CardGrid gap={Spacing.two}>
            {inside.map((entry) => (
              <EntryView key={entry.key} entry={entry} />
            ))}
          </CardGrid>
        </View>
      ) : null}
    </View>
  );
}

/** Where a member stands, for a search result. */
function memberLine(member: FoundMember) {
  if (member.status === 'approved') return rolesLabel(rolesOf(member));
  if (member.status === 'rejected') return 'Not approved';
  return member.join_requested_at ? 'Waiting for approval' : 'Signed in, no request yet';
}

function MemberResult({ member }: { member: FoundMember }) {
  const waiting = member.status === 'pending' && !!member.join_requested_at;
  return (
    <FeatureCard
      icon="user"
      title={member.full_name || member.email || 'No name yet'}
      detail={memberLine(member)}
      detailTone={waiting ? 'attention' : 'quiet'}
      onPress={() => router.push({ pathname: '/admin/[id]', params: { id: member.id } })}
    />
  );
}

/** What a search found: things in the Club tab first, then members. */
function Results({ areas, query }: { areas: ClubArea[]; query: string }) {
  const entries = searchClub(areas, query);
  const { members } = useMemberFinder(query.trim().length >= MEMBER_SEARCH_MIN);
  const people = searchMembers(members ?? [], query);
  const more = people.length - MEMBERS_SHOWN;
  const looking = members === null && query.trim().length >= MEMBER_SEARCH_MIN;

  if (entries.length === 0 && people.length === 0 && !looking) {
    return (
      <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
        Nothing found for “{query.trim()}”. Try a member’s name or email, or what a setting does,
        such as “time zone”.
      </ThemedText>
    );
  }
  return (
    <>
      {entries.length > 0 ? (
        <View style={styles.group}>
          <SectionTitle>In Club</SectionTitle>
          <CardGrid gap={Spacing.two}>
            {entries.map((entry) => (
              <EntryView key={entry.key} entry={entry} />
            ))}
          </CardGrid>
        </View>
      ) : null}
      {people.length > 0 ? (
        <View style={styles.group}>
          <SectionTitle>Members</SectionTitle>
          <CardGrid gap={Spacing.two}>
            {people.slice(0, MEMBERS_SHOWN).map((member) => (
              <MemberResult key={member.id} member={member} />
            ))}
          </CardGrid>
          {more > 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              And {more} more. Type more of the name, or open Members to see everyone.
            </ThemedText>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

/**
 * The Club tab below its title: the search for admins, then the areas, or the
 * member's few things as they are.
 */
export function ClubHub({ areas }: { areas: ClubArea[] }) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  // The areas the member has opened.
  const [opened, setOpened] = useState<Partial<Record<ClubAreaName, boolean>>>({});
  // Only an admin has links, and with them a list long enough to search.
  const canSearch = areas.some((area) => area.entries.some((entry) => entry.link));
  const searching = canSearch && query.trim().length > 0;
  const rows = clubRows(areas);

  return (
    <>
      {canSearch ? (
        <View style={[styles.search, { backgroundColor: theme.backgroundElement }]}>
          <Icon name="search" size={18} color={theme.textSecondary} />
          <TextInput
            accessibilityLabel={CLUB_SEARCH_LABEL}
            placeholder={CLUB_SEARCH_LABEL}
            placeholderTextColor={theme.textSecondary}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={[styles.searchInput, { color: theme.text }]}
          />
          {query ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear the search"
              hitSlop={12}
              onPress={() => setQuery('')}>
              <Icon name="x" size={18} color={theme.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {searching ? (
        <Results areas={areas} query={query} />
      ) : (
        <>
          {rows.map((row) =>
            row.area ? (
              <AreaView
                key={row.area.name}
                area={row.area}
                open={!!opened[row.area.name]}
                onToggle={() => {
                  const { name } = row.area;
                  setOpened((old) => ({ ...old, [name]: !old[name] }));
                }}
              />
            ) : (
              <EntryView key={row.entry.key} entry={row.entry} />
            ),
          )}
          {canSearch ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push('/administration')}
              style={styles.everything}>
              <ThemedText type="small" themeColor="tint">
                Everything, A to Z
              </ThemedText>
            </Pressable>
          ) : null}
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  area: {
    gap: Spacing.two,
  },
  areaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: 12,
  },
  text: {
    flex: 1,
    gap: Spacing.half,
    minWidth: 0,
  },
  // A line down the side ties what is inside to its area.
  inside: {
    borderLeftWidth: 2,
    paddingLeft: Spacing.two,
    marginLeft: Spacing.two,
  },
  group: {
    gap: Spacing.two,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 12,
    minHeight: 48,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    paddingVertical: Spacing.two,
  },
  empty: {
    textAlign: 'center',
    paddingVertical: Spacing.four,
  },
  everything: {
    alignSelf: 'center',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
});
