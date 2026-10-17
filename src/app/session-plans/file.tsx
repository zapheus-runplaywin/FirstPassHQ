import { useLocalSearchParams } from 'expo-router';

import { DocumentViewer } from '@/components/document-viewer';
import { planFileUrl } from '@/lib/session-plans';

/** Shows a session plan's photo or PDF inside the app. */
export default function SessionPlanFileScreen() {
  const { path, name } = useLocalSearchParams<{ path: string; name?: string }>();
  return (
    <DocumentViewer path={path} name={name} fallbackName="Session plan" signedUrl={planFileUrl} />
  );
}
