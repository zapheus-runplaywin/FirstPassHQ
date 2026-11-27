import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';

import { Screen } from '@/components/screen';
import { SelectionAuditReport, type SelectionAuditReportHandle } from '@/components/selection-audit-report';

/** The Selection audit report for a round, for an admin. */
export default function SelectionAuditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const report = useRef<SelectionAuditReportHandle>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await report.current?.reload();
    setRefreshing(false);
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <SelectionAuditReport ref={report} roundId={id} />
    </Screen>
  );
}
