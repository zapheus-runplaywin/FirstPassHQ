/**
 * A join request as one decision, at the top of the member's page
 * (src/app/admin/[id].tsx): the checks first, then what Approve will give
 * them, then Approve. Anything else, such as another role, a guardian link or
 * a Working With Children Check, is in the full record, one tap away.
 *
 * It decides nothing itself: the page saves with the same steps and the same
 * rules as its full record, and the checks come from src/lib/join-request.ts.
 */
import { StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { JoinCheck, JoinCheckTone } from '@/lib/join-request';
import { rejectionReasonLabels } from '@/lib/labels';
import type { RejectionReason } from '@/lib/types';

const rejectionReasons = Object.keys(rejectionReasonLabels) as RejectionReason[];

/** The mark beside a check, and what a screen reader says in its place. */
const MARKS: Record<JoinCheckTone, { icon: IconName; says: string }> = {
  done: { icon: 'check', says: 'Checked' },
  attention: { icon: 'alert-circle', says: 'Needs sorting out' },
  note: { icon: 'info', says: 'To check' },
};

function CheckRow({ check }: { check: JoinCheck }) {
  const theme = useTheme();
  const mark = MARKS[check.tone];
  const color =
    check.tone === 'done'
      ? theme.positive
      : check.tone === 'attention'
        ? theme.attention
        : theme.textSecondary;
  return (
    <View
      accessible
      accessibilityLabel={`${mark.says}: ${check.text}`}
      testID={`join-check-${check.key}`}
      style={styles.check}>
      <Icon name={mark.icon} size={16} color={color} style={styles.mark} />
      <ThemedText
        type={check.tone === 'attention' ? 'smallBold' : 'small'}
        themeColor={check.tone === 'attention' ? 'attention' : undefined}
        style={styles.checkText}>
        {check.text}
      </ThemedText>
    </View>
  );
}

export type JoinAnswer = { label: string; value: string };

export function JoinRequestSummary({
  asked,
  askedOn,
  firstName,
  checks,
  answers,
  canApprove,
  verify,
  reason,
  onReason,
  declining,
  onDecline,
  onApprove,
  onFullRecord,
  saving,
  error,
}: {
  /** What they asked for, as one line. */
  asked: string;
  /** The day they asked. */
  askedOn: string | null;
  firstName: string;
  checks: JoinCheck[];
  /** What Approve will give them, and what they told the club. */
  answers: JoinAnswer[];
  /** Nothing is in the way of approving them from here. */
  canApprove: boolean;
  /** Their 6-digit code, while they aren't verified. */
  verify: {
    code: string;
    onCode: (code: string) => void;
    onCheck: () => void;
    busy: boolean;
    error: string | null;
  } | null;
  reason: RejectionReason | null;
  onReason: (reason: RejectionReason | null) => void;
  /** Don't approve was pressed: the reasons are showing. */
  declining: boolean;
  onDecline: () => void;
  onApprove: () => void;
  onFullRecord: () => void;
  saving: 'approved' | 'rejected' | null;
  error: string | null;
}) {
  return (
    <View style={styles.summary} testID="join-request">
      <View style={styles.lead}>
        <ThemedText type="smallBold">{asked}</ThemedText>
        {askedOn ? (
          <ThemedText type="small" themeColor="textSecondary">
            Asked on {askedOn}
          </ThemedText>
        ) : null}
      </View>

      <Card testID="join-checks" style={styles.checks}>
        <ThemedText type="smallBold">Checks</ThemedText>
        {checks.map((check) => (
          <CheckRow key={check.key} check={check} />
        ))}
        {verify ? (
          <View style={styles.verify}>
            <View style={styles.code}>
              <TextField
                label="Their code"
                value={verify.code}
                onChangeText={verify.onCode}
                placeholder="123 456"
                keyboardType="number-pad"
                maxLength={7}
              />
            </View>
            <Button
              title="Check code"
              variant="secondary"
              onPress={verify.onCheck}
              busy={verify.busy}
            />
          </View>
        ) : null}
        {verify?.error ? <ErrorText>{verify.error}</ErrorText> : null}
      </Card>

      <Card testID="join-answers">
        {answers.map((answer) => (
          <View key={answer.label} style={styles.answer}>
            <ThemedText type="small" themeColor="textSecondary">
              {answer.label}
            </ThemedText>
            <ThemedText type="small" style={styles.answerValue}>
              {answer.value}
            </ThemedText>
          </View>
        ))}
      </Card>

      {declining ? (
        <View style={styles.lead}>
          <ChipGroup
            label="Reason if not approving"
            options={rejectionReasons.map((r) => ({ value: r, label: rejectionReasonLabels[r] }))}
            selected={reason ? [reason] : []}
            onToggle={(r) => onReason(r === reason ? null : r)}
          />
          <ThemedText type="small" themeColor="textSecondary">
            They see the reason. Choose one, then tap Don’t approve again.
          </ThemedText>
        </View>
      ) : null}

      <ErrorText>{error}</ErrorText>

      {canApprove ? (
        <Button
          title={firstName ? `Approve ${firstName}` : 'Approve'}
          onPress={onApprove}
          busy={saving === 'approved'}
        />
      ) : (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            The checks marked ! come before Approve.
          </ThemedText>
          <Button title="Open the full record" onPress={onFullRecord} />
        </>
      )}
      <View style={styles.others}>
        <View style={styles.other}>
          <Button
            title="Don't approve"
            variant="secondary"
            onPress={onDecline}
            busy={saving === 'rejected'}
          />
        </View>
        {canApprove ? (
          <View style={styles.other}>
            <Button title="Full record" variant="secondary" onPress={onFullRecord} />
          </View>
        ) : null}
      </View>
      {canApprove ? (
        <ThemedText type="small" themeColor="textSecondary">
          The full record changes their role, squad or team, date of birth and guardians.
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  summary: {
    gap: Spacing.three,
  },
  lead: {
    gap: Spacing.one,
  },
  checks: {
    gap: Spacing.two,
  },
  check: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  // Level with the first line of the check's words.
  mark: {
    marginTop: 2,
  },
  checkText: {
    flex: 1,
    minWidth: 0,
  },
  verify: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
  },
  code: {
    flex: 1,
    minWidth: 0,
  },
  answer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  answerValue: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
  },
  others: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  other: {
    flex: 1,
    minWidth: 0,
  },
});
