import { useLocalSearchParams } from 'expo-router';

import { DocumentViewer } from '@/components/document-viewer';
import { viewReceiptUrl } from '@/lib/wwcc-applications';

/** Shows a Working With Children Check application receipt inside the app, for admins. */
export default function WwccReceiptScreen() {
  const { path, name } = useLocalSearchParams<{ path: string; name?: string }>();
  return (
    <DocumentViewer
      path={path}
      name={name}
      fallbackName="Application receipt"
      signedUrl={viewReceiptUrl}
    />
  );
}
