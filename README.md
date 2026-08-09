# Free PDF Editor v3 — Desktop + iPhone

Static browser-based PDF editor for Azure Static Web Apps.

## Features
- Open PDFs locally in the browser
- Detect and tap/click existing PDF text
- Replace text using an overlay while matching detected size, family/style and colour as closely as possible
- Add new text
- Drag replacement text with mouse or touch
- Previous/Next page controls on mobile
- Responsive PDF view for iPhone/iPad
- Download edited PDFs on desktop
- iPhone/iPad export opens the finished PDF in Safari so the user can use Share → Save to Files
- No server-side PDF upload required

## Azure Static Web Apps
Upload these files to the root of the GitHub repository:

- `index.html`
- `app.js`
- `styles.css`
- `staticwebapp.config.json`
- `README.md`

Keep the existing GitHub Actions workflow that already deploys your Static Web App.

The Static Web Apps workflow should deploy the repository root as static files (`app_location: "/"`, `skip_app_build: true`).

## Notes
PDF text is not a Word-style document model. This editor visually replaces existing text by covering the original region and drawing replacement text over it. Standard PDF fonts are embedded directly on export. Other detected/custom fonts are rendered as high-resolution text images so the appearance can be matched more closely.
