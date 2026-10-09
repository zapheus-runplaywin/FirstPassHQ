import { useLocalSearchParams } from 'expo-router';

import { DocumentViewer } from '@/components/document-viewer';
import { viewCertificateUrl } from '@/lib/training';

/** Shows a training certificate inside the app, without saving it to the phone. */
export default function CertificateScreen() {
  const { path, name } = useLocalSearchParams<{ path: string; name?: string }>();
  return (
    <DocumentViewer
      path={path}
      name={name}
      fallbackName="Training certificate"
      signedUrl={viewCertificateUrl}
    />
  );
}
