import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Switch, View } from 'react-native';

import { WhyThisFlag } from '@/components/load-monitoring';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { LOAD_CAVEAT, RATIO_CHOICES, type RatioChoice } from '@/lib/load-monitoring';
import { supabase } from '@/lib/supabase';

/**
 * Club settings > Training load flags. Admins pick only between published
 * values, each with its source (Matt, 28 October 2026): no numbers of the
 * club's own.
 */
export function LoadMonitoringSettings() {
  const theme = useTheme();
  const [ratio, setRatio] = useState<RatioChoice | null>(null);
  const [hours, setHours] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .rpc('load_monitoring_settings')
      .maybeSingle()
      .then(({ data }) => {
        const settings = data as { ratio_flag: RatioChoice; hours_flag: boolean } | null;
        setRatio(settings?.ratio_flag ?? 'from_1_5');
        setHours(settings?.hours_flag ?? true);
      });
  }, []);

  async function save() {
    if (!ratio) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    const { error: saveError } = await supabase.rpc('admin_set_load_monitoring', {
      p_ratio_flag: ratio,
      p_hours_flag: hours,
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setNotice('Training load flags saved.');
  }

  if (!ratio) return null;
  const chosen = RATIO_CHOICES.find((c) => c.value === ratio);

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Training load flags</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Prompts for coaches from the sessions athletes log under their check-in. Each choice is a
        value from a published study. Coaches see the flags for their own athletes; parents see
        when a coach has checked in; the Child Safety Officer sees patterns for under 18s.
      </ThemedText>
      <ChipGroup
        label="Flag a rise in load (last 7 days against the last 28)"
        options={RATIO_CHOICES.map((c) => ({ value: c.value, label: c.label }))}
        selected={[ratio]}
        onToggle={(value) => setRatio(value)}
      />
      {chosen ? (
        <ThemedText type="small" themeColor="textSecondary">
          {chosen.detail}
        </ThemedText>
      ) : null}
      <WhyThisFlag sources={['gabbett2016', 'impellizzeri2020']} label="Sources" />
      <Card style={styles.row}>
        <View style={styles.text}>
          <ThemedText type="smallBold">Hours over age (under 18s)</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Flag an athlete under 18 whose last 7 days add up to more hours of sport than their age
            in years (Jayanthi et al. 2015).
          </ThemedText>
        </View>
        <Switch
          accessibilityLabel="Hours over age (under 18s)"
          value={hours}
          onValueChange={setHours}
          trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
          thumbColor={theme.text}
          {...(Platform.OS === 'web' ? { activeThumbColor: theme.onAccent } : {})}
        />
      </Card>
      <WhyThisFlag sources={['jayanthi2015']} label="Source" />
      <ThemedText type="small" themeColor="textSecondary">
        {LOAD_CAVEAT}
      </ThemedText>
      <ErrorText>{error}</ErrorText>
      {notice ? (
        <ThemedText type="small" themeColor="textSecondary">
          {notice}
        </ThemedText>
      ) : null}
      <Button title="Save training load flags" variant="secondary" onPress={save} busy={saving} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  text: { flex: 1, gap: Spacing.half },
});
