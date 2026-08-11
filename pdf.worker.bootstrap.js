// Same-origin PDF.js worker bootstrap.
// The Worker itself is created from this site's origin, then loads the matching PDF.js worker code.
importScripts('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js');
