import { router } from 'expo-router';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { contactNames, helplines, useSafeguardingContacts } from '@/lib/concerns';
import { namesLine } from '@/lib/people-picker';
import { formatDateTime } from '@/lib/format';
import { formatPhone, telLink } from '@/lib/phone';
import { useTheme } from '@/hooks/use-theme';

/**
 * Who to talk to about a child's safety: the club's Child Safety Officers and
 * Complaints Managers, the governing body, and services anyone can call.
 * Phone numbers and links open when tapped.
 */
export function SafeguardingContactsCard() {
  const contacts = useSafeguardingContacts();
  const theme = useTheme();
  const link = (label: string, url: string) => (
    <Pressable accessibilityRole="link" onPress={() => Linking.openURL(url)}>
      <ThemedText type="small" style={{ color: theme.tint }}>
        {label}
      </ThemedText>
    </Pressable>
  );
  const phone = (number: string) => link(number, telLink(number));
  const officers = contactNames(contacts, 'officers');
  const managers = contactNames(contacts, 'managers');

  return (
    <Card>
      <ThemedText type="smallBold">If a child is in danger now, call 000.</ThemedText>
      <View style={styles.rows}>
        {officers.length > 0 ? (
          <ThemedText type="small">
            {officers.length === 1 ? 'Child Safety Officer' : 'Child Safety Officers'}:{' '}
            {namesLine(officers)}
          </ThemedText>
        ) : null}
        {managers.length > 0 ? (
          <ThemedText type="small">
            {managers.length === 1 ? 'Complaints Manager' : 'Complaints Managers'}:{' '}
            {namesLine(managers)}
          </ThemedText>
        ) : null}
        {contacts?.governing_body_name ? (
          <View>
            <ThemedText type="small">{contacts.governing_body_name}</ThemedText>
            {contacts.governing_body_phone
              ? phone(formatPhone(contacts.governing_body_phone))
              : null}
            {contacts.governing_body_url
              ? link('Complaints form', contacts.governing_body_url)
              : null}
          </View>
        ) : null}
        {helplines.map((h) => (
          <View key={h.name}>
            <ThemedText type="small">
              {h.name}{' '}
              <ThemedText type="small" themeColor="textSecondary">
                · {h.detail}
              </ThemedText>
            </ThemedText>
            {phone(h.phone)}
          </View>
        ))}
        {contacts?.policy_url ? link('The club’s safeguarding policy', contacts.policy_url) : null}
      </View>
    </Card>
  );
}

/**
 * A link to raise a concern, with where it came from (for example a message)
 * kept with the concern.
 */
export function RaiseConcernLink({
  context,
  label,
  messageId,
}: {
  context?: string;
  label?: string;
  /** The message being reported, so the concern keeps a copy of it. */
  messageId?: string;
}) {
  const theme = useTheme();
  const params: Record<string, string> = {};
  if (context) params.context = context;
  if (messageId) params.message = messageId;
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push({ pathname: '/concern/new', params })}
      style={styles.link}>
      <ThemedText type="small" style={{ color: theme.tint }}>
        {label ?? 'Worried about something? Raise a concern'}
      </ThemedText>
    </Pressable>
  );
}

/**
 * A reported message as the concern keeps it: who sent it, when, and exactly
 * what it said.
 */
export function ReportedMessage({
  title = 'Reported message',
  senderName,
  sentAt,
  body,
}: {
  title?: string;
  senderName: string | null | undefined;
  sentAt: string | null | undefined;
  body: string;
}) {
  const theme = useTheme();
  return (
    <Card testID="reported-message">
      <ThemedText type="smallBold">{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        From {senderName ?? 'a former member'}
        {sentAt ? `, ${formatDateTime(new Date(sentAt))}` : ''}
      </ThemedText>
      <View style={[styles.quote, { borderLeftColor: theme.textSecondary }]}>
        <ThemedText type="small" selectable>
          {body}
        </ThemedText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  quote: { borderLeftWidth: 3, paddingLeft: Spacing.two },
  link: { paddingVertical: Spacing.two },
  rows: { gap: Spacing.two },
});
