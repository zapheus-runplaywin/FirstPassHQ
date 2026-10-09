// PDF.js, pinned. It draws each page onto a canvas, so the document is shown
// without the browser's own PDF viewer and its download and print buttons.
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';
const PDFJS_SRI =
  'sha512-q+4liFwdPC/bNdhUpZx6aXDx/h77yEQtn4I1slHydcbZK34nLaR3cAeYSJshoxIOq3mjEf7xJE8YWIUHMn+oCQ==';

/**
 * A page that shows the PDF at `url` (a short-lived signed link) one page
 * under the next, with pinch to zoom. The file is only held in memory.
 */
export function pdfViewerHtml(url: string) {
  // As a script value that can't close the script tag.
  const source = JSON.stringify(url).replace(/</g, '\\u003c');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=6, user-scalable=yes">
<style>
  html, body { margin: 0; background: #0F172A; color: #fff; font: 15px -apple-system, system-ui, sans-serif; }
  body { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
  #pages { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 12px 0; }
  canvas { width: calc(100vw - 16px); height: auto; background: #fff; pointer-events: none; }
  #status { padding: 24px 16px; text-align: center; color: #bbb; }
</style>
<script src="${PDFJS}/pdf.min.js" integrity="${PDFJS_SRI}" crossorigin="anonymous"></script>
</head>
<body oncontextmenu="return false">
<div id="status">Loading…</div>
<div id="pages"></div>
<script>
(async function () {
  var status = document.getElementById('status');
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '${PDFJS}/pdf.worker.min.js';
    var pdf = await pdfjsLib.getDocument({ url: ${source}, isEvalSupported: false }).promise;
    status.remove();
    // Drawn at twice the screen's resolution so text stays sharp when zoomed in.
    var cssWidth = window.innerWidth - 16;
    var ratio = Math.min((window.devicePixelRatio || 1) * 2, 4);
    for (var n = 1; n <= pdf.numPages; n++) {
      var page = await pdf.getPage(n);
      var unscaled = page.getViewport({ scale: 1 });
      var viewport = page.getViewport({ scale: (cssWidth / unscaled.width) * ratio });
      var canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      document.getElementById('pages').appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
    }
  } catch (e) {
    status.textContent = 'This document couldn’t be shown. Go back and try again.';
  }
})();
</script>
</body>
</html>`;
}
