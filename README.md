# Free PDF Editor v7 – Stable desktop + iPhone build

This build restores the working modern browser file-read path (`File.arrayBuffer()`), keeps PDF.js 3.11.174 for wider iPhone/Safari compatibility, and uses FileReader only as a fallback.

## Deploy
Upload/replace these files at the root of your GitHub repository:
- index.html
- app.js
- styles.css
- staticwebapp.config.json
- README.md

Keep your existing `.github/workflows` directory.

## Behaviour
- Opens page 1 first; later pages render on demand.
- Existing PDF text can be selected and replaced with overlays.
- Desktop downloads the edited PDF.
- iPhone/iPad opens the generated PDF for Share -> Save to Files.
