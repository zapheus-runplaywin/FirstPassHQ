import { useLocalSearchParams } from 'expo-router';

import { DocumentViewer } from '@/components/document-viewer';
import { viewInjuryDocumentUrl } from '@/lib/injuries';

/**
 * Shows an injury document, such as proof of clearance, inside the app.
 * There is no save or share button here, and nothing is kept on the phone.
 */
export default function InjuryDocumentScreen() {
  const { path, name } = useLocalSearchParams<{ path: string; name?: string }>();
  return (
    <DocumentViewer
      path={path}
      name={name}
      fallbackName="Injury document"
      signedUrl={viewInjuryDocumentUrl}
    />
  );
}
