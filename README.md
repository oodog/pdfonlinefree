# Free PDF Editor — Universal Build 1.0.0

Static browser-only PDF editor for Azure Static Web Apps.

## What this build does

- Open PDFs locally in the browser (no upload to a server)
- Detect existing PDF text
- Tap/click existing text to create an editable replacement overlay
- Match detected position, approximate font family/style, size, text colour and background colour
- Add new text
- Drag replacement text with mouse or touch
- Navigate multi-page PDFs lazily (only the page you open is rendered at full quality)
- Export the edited PDF
- Desktop/Android: normal PDF download
- iPhone/iPad: opens the finished PDF in a new tab; use Share → Save to Files

## Browser compatibility work in this build

This package is self-contained. It ships local copies of PDF.js 6.1.200, the matching PDF.js worker, and pdf-lib 1.17.1. It also includes compatibility polyfills used by Safari/iOS for ReadableStream async iteration and several newer browser APIs used by PDF.js.

## Upload to GitHub

Replace the site files in the repository root with the contents of this ZIP. Keep your existing `.github/workflows` folder.

Required structure:

```
index.html
styles-universal-v1.css
polyfills.js
bootstrap.mjs
app-universal.mjs
staticwebapp.config.json
vendor/
  pdf.mjs
  pdf.worker.mjs
  pdf-lib.min.js
.github/
  workflows/
  ... your existing Azure workflow ...
```

The build displays `Build universal-1.0.0` in the status bar. This makes it easy to confirm that your custom domain is serving the new version instead of an older cached copy.
