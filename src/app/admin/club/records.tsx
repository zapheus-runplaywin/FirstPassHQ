import { RecordRetention } from '@/components/record-retention';
import { Screen } from '@/components/screen';

/**
 * Administration > Record keeping: how long the club keeps members' records,
 * and whether old ones are removed each night.
 */
export default function RecordKeepingScreen() {
  return (
    <Screen>
      <RecordRetention />
    </Screen>
  );
}
