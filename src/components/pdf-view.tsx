import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

import { FirstPass } from '@/constants/club';
import { pdfViewerHtml } from '@/lib/pdf-viewer-html';

/**
 * Shows a PDF inside the app with pinch to zoom. Nothing is saved to the
 * phone: the web view keeps no cache and can't open links or downloads.
 */
export function PdfView({ uri }: { uri: string }) {
  return (
    <WebView
      source={{ html: pdfViewerHtml(uri) }}
      originWhitelist={['*']}
      style={styles.fill}
      incognito
      cacheEnabled={false}
      javaScriptEnabled
      allowFileAccess={false}
      setSupportMultipleWindows={false}
      setBuiltInZoomControls
      setDisplayZoomControls={false}
      allowsLinkPreview={false}
      dataDetectorTypes="none"
      // Only the viewer page itself loads; links and downloads go nowhere.
      onShouldStartLoadWithRequest={(request) => request.url === 'about:blank'}
    />
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: FirstPass.navy,
  },
});
