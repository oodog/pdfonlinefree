# Free PDF Editor v4 – iPhone compatibility build

Static browser-only PDF editor for Azure Static Web Apps.

## iPhone/iPad compatibility changes
- Uses PDF.js 3.11.174 classic browser build instead of the newer module build.
- Uses FileReader instead of File.arrayBuffer()/Blob.arrayBuffer().
- Uses canvas data URLs instead of Blob-backed rendered page previews.
- Keeps pointer/touch editing and Safari PDF preview/save flow.
- Cache-busted app.js and styles.css references.

Upload the files in this folder to the root of the GitHub repository. Keep your existing `.github/workflows` deployment file.
