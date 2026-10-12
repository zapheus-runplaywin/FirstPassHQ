import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { ReportView } from '@/components/report-view';
import { Screen } from '@/components/screen';
import { ErrorText } from '@/components/ui';
import { concernsReport, useSafeguardingContacts } from '@/lib/concerns';
import { supabase } from '@/lib/supabase';
import type { Concern, ConcernEvent } from '@/lib/types';

/** The concerns register with everything done about each one, ready to save as a PDF. */
export default function ConcernsReportScreen() {
  const contacts = useSafeguardingContacts();
  const [data, setData] = useState<{
    concerns: Concern[];
    history: Record<string, ConcernEvent[]>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: rows, error: registerError } = await supabase.rpc('concern_register');
    if (registerError) {
      setError(registerError.message);
      return;
    }
    const concerns = (rows as Concern[] | null) ?? [];
    const histories = await Promise.all(
      concerns.map((c) => supabase.rpc('concern_history', { p_concern_id: c.id })),
    );
    setData({
      concerns,
      history: Object.fromEntries(
        concerns.map((c, i) => [c.id, (histories[i].data as ConcernEvent[] | null) ?? []]),
      ),
    });
    setError(null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <Screen>
      <ErrorText>{error}</ErrorText>
      {data ? (
        <ReportView
          report={concernsReport(data.concerns, data.history, contacts?.governing_body_name ?? null)}
        />
      ) : null}
    </Screen>
  );
}
