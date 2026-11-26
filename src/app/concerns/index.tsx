import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import ConcernScreen from '@/app/concerns/[id]';
import { ListDetail, useListDetail } from '@/components/list-detail';
import { Screen } from '@/components/screen';
import { StatusLine } from '@/components/status-line';
import { ThemedText } from '@/components/themed-text';
import { Button, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { useChatBlocksWaiting } from '@/lib/chat-blocks';
import { useClub } from '@/lib/club';
import { concernAboutLine, concernStatusLabels } from '@/lib/concerns';
import { useLoadPatternAlerts } from '@/lib/load-monitoring';
import { useMessageAccessTodo } from '@/lib/message-access';
import { localDay } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import type { Concern } from '@/lib/types';
import { useWellbeingFlagAlerts } from '@/lib/wellbeing-flags';

/**
 * The concerns register, for the Child Safety Officer, the Complaints Manager
 * and admins. Nobody sees a concern about themselves.
 */
export default function ConcernsScreen() {
  const { isAdmin, isSafeguardingOfficer, hasEscalatedConcerns } = useAuth();
  // The route guard lets only these in; this keeps the register's controls
  // to them even so. The database returns no concerns to anyone else.
  const handles = isAdmin || isSafeguardingOfficer;
  const accessTodo = useMessageAccessTodo(handles);
  // Only the Child Safety Officer sees athletes' check-in flags.
  const { features } = useClub();
  const wellbeing = useWellbeingFlagAlerts(handles && features.checkIns);
  const loadOn = wellbeing.isOfficer && features.trainingLoad;
  const loadPatterns = useLoadPatternAlerts(loadOn);
  const blocksWaiting = useChatBlocksWaiting(handles && features.chatGroups);
  const [concerns, setConcerns] = useState<Concern[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('concern_register');
    setConcerns((data as Concern[] | null) ?? []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const open = (concerns ?? []).filter((c) => c.status !== 'closed');
  const closed = (concerns ?? []).filter((c) => c.status === 'closed');
  // On a tablet a concern opens beside the register; otherwise on its own screen.
  const detail = useListDetail<{ id: string }>((params) =>
    router.push({ pathname: '/concerns/[id]', params }),
  );
  const chosenId = detail.chosen?.id ?? null;

  const list = (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      {handles ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Concerns raised by members, newest first. Only the Child Safety Officer, the Complaints
            Manager and admins see them, and nobody sees one about themselves. Child abuse and serious
            crimes go to Police and the governing body straight away.
          </ThemedText>
          <Button
            title={
              accessTodo.to_decide > 0
                ? `Message access (${accessTodo.to_decide} to answer)`
                : 'Message access'
            }
            variant="secondary"
            onPress={() => router.push('/concerns/message-access')}
          />
          {features.chatGroups ? (
            <Button
              title={
                blocksWaiting > 0
                  ? `Blocks in chat groups (${blocksWaiting} to follow up)`
                  : 'Blocks in chat groups'
              }
              variant="secondary"
              onPress={() => router.push('/concerns/blocks')}
            />
          ) : null}
          <Button
            title="Export the register as a PDF"
            variant="secondary"
            onPress={() => router.push('/concerns/report')}
          />
          {wellbeing.isOfficer ? (
            <Button
              title={
                wellbeing.repeated > 0
                  ? `Wellbeing flags (${wellbeing.repeated} to look at)`
                  : 'Wellbeing flags'
              }
              variant="secondary"
              onPress={() => router.push('/concerns/wellbeing')}
            />
          ) : null}
          {loadOn ? (
            <Button
              title={
                loadPatterns > 0
                  ? `Training load patterns (${loadPatterns} to look at)`
                  : 'Training load patterns'
              }
              variant="secondary"
              onPress={() => router.push('/concerns/load')}
            />
          ) : null}
        </>
      ) : hasEscalatedConcerns ? (
        <ThemedText type="small" themeColor="textSecondary">
          Concerns escalated to you by name because nothing was recorded on them in time. Record
          what you do on each one. You see them only while they’re open, and each look is kept with
          the concern.
        </ThemedText>
      ) : null}
      <Section title="Open" concerns={open} empty="No open concerns." chosenId={chosenId} onOpen={detail.open} />
      <Section title="Closed" concerns={closed} empty="None closed yet." chosenId={chosenId} onOpen={detail.open} />
    </Screen>
  );
  return (
    <ListDetail
      chosen={detail.chosen}
      detail={<ConcernScreen />}
      title="Concern"
      hint="Choose a concern to open it here."
      onLeave={() => {
        detail.close();
        load();
      }}
      onChanged={load}>
      {list}
    </ListDetail>
  );
}

function Section({
  title,
  concerns,
  empty,
  chosenId,
  onOpen,
}: {
  title: string;
  concerns: Concern[];
  empty: string;
  /** The concern open beside the register, if one is. */
  chosenId: string | null;
  onOpen: (params: { id: string }) => void;
}) {
  return (
    <View style={styles.group}>
      <ThemedText type="smallBold">{title}</ThemedText>
      {concerns.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {empty}
        </ThemedText>
      ) : (
        concerns.map((c) => (
          <PressableCard
            key={c.id}
            selected={chosenId === null ? undefined : c.id === chosenId}
            onPress={() => onOpen({ id: c.id })}>
            <ThemedText type="smallBold">
              {c.reference ? `${c.reference} · ` : ''}
              {localDay(c.created_at)}
              {concernAboutLine(c) ? ` · about ${concernAboutLine(c)}` : ''}
            </ThemedText>
            <ThemedText type="small" numberOfLines={2}>
              {c.body}
            </ThemedText>
            <StatusLine
              tone={c.status === 'received' ? 'attention' : 'quiet'}
              text={
                concernStatusLabels[c.status] +
                (c.involves_child === 'yes' ? ' · child’s safety' : '') +
                (c.anonymous ? ' · name not shown' : ` · from ${c.raised_by_name ?? 'a former member'}`)
              }
            />
          </PressableCard>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
});
