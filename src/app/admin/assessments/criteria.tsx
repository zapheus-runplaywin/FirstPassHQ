import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import {
  MAX_GROUPS,
  MAX_ITEMS,
  MAX_NAME,
  MAX_STEP,
  addGroup,
  addItem,
  criteriaProblem,
  removeGroup,
  removeItem,
  renameGroup,
  renameItem,
  renameStep,
  starterCriteria,
  type Criteria,
} from '@/lib/assessments';
import { supabase } from '@/lib/supabase';

const STEPS = ['Lowest step', 'Middle step', 'Highest step'];

/**
 * The club's assessment criteria: groups of items, each group with its own
 * three-step scale. A new club starts from an example or from blank. A round
 * copies the criteria when it opens, so changes here reach new rounds only.
 */
export default function AssessmentCriteriaScreen() {
  const [criteria, setCriteria] = useState<Criteria | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc('admin_assessment_criteria').then(({ data, error: loadError }) => {
      if (loadError) setError(loadError.message);
      setCriteria((data as Criteria | null) ?? { groups: [] });
    });
  }, []);

  async function save() {
    if (!criteria) return;
    const problem = criteriaProblem(criteria);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.rpc('admin_save_assessment_criteria', {
      p_criteria: criteria,
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    router.back();
  }

  if (!criteria) return <Screen>{null}</Screen>;

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary">
        What athletes are assessed on. Put the items in groups, and give each group three steps
        for its scale. A round keeps the criteria it opened with, so changes here apply to rounds
        you open afterwards. Share the criteria with athletes before a round starts.
      </ThemedText>

      {criteria.groups.length === 0 ? (
        <>
          <Button title="Start from the netball example" onPress={() => setCriteria(starterCriteria())} />
          <ThemedText type="small" themeColor="textSecondary">
            Nine groups, from technical ability to team focus. Change, add or remove anything to
            suit your sport and club.
          </ThemedText>
          <Button title="Start blank" variant="secondary" onPress={() => setCriteria(addGroup(criteria))} />
        </>
      ) : null}

      {criteria.groups.map((group, index) => (
        <Card key={group.key} style={styles.card}>
          <TextField
            label={`Group ${index + 1}`}
            value={group.name}
            onChangeText={(name) => setCriteria(renameGroup(criteria, group.key, name))}
            placeholder="Such as Technical ability"
            maxLength={MAX_NAME}
          />
          {STEPS.map((label, step) => (
            <TextField
              key={label}
              label={`${label} (group ${index + 1})`}
              value={group.scale[step] ?? ''}
              onChangeText={(text) => setCriteria(renameStep(criteria, group.key, step, text))}
              maxLength={MAX_STEP}
            />
          ))}
          {group.items.map((item, itemIndex) => (
            <TextField
              key={item.key}
              label={`Item ${itemIndex + 1} (group ${index + 1})`}
              value={item.name}
              onChangeText={(name) => setCriteria(renameItem(criteria, group.key, item.key, name))}
              placeholder="Such as Decision making"
              maxLength={MAX_NAME}
            />
          ))}
          {group.items.length < MAX_ITEMS ? (
            <Button
              title={`Add an item to ${group.name.trim() || `group ${index + 1}`}`}
              variant="secondary"
              onPress={() => setCriteria(addItem(criteria, group.key))}
            />
          ) : null}
          {group.items.length > 1 ? (
            <Button
              title={`Remove the last item from ${group.name.trim() || `group ${index + 1}`}`}
              variant="secondary"
              onPress={() =>
                setCriteria(removeItem(criteria, group.key, group.items[group.items.length - 1].key))
              }
            />
          ) : null}
          <Button
            title={`Remove ${group.name.trim() || `group ${index + 1}`}`}
            variant="secondary"
            onPress={() => setCriteria(removeGroup(criteria, group.key))}
          />
        </Card>
      ))}

      {criteria.groups.length > 0 && criteria.groups.length < MAX_GROUPS ? (
        <Button title="Add a group" variant="secondary" onPress={() => setCriteria(addGroup(criteria))} />
      ) : null}

      <ErrorText>{error}</ErrorText>
      {criteria.groups.length > 0 ? <Button title="Save criteria" onPress={save} busy={saving} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.two },
});
