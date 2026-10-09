import { FirstPass } from '@/constants/club';
import { pdfViewerHtml } from '@/lib/pdf-viewer-html';

/** On the web, the same viewer page runs in a sandboxed frame. */
export function PdfView({ uri }: { uri: string }) {
  return (
    <iframe
      title="Document"
      srcDoc={pdfViewerHtml(uri)}
      sandbox="allow-scripts"
      style={{ flex: 1, border: 0, width: '100%', height: '100%', background: FirstPass.navy }}
    />
  );
}
