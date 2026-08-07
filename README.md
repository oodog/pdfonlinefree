# Free PDF Editor v2

A browser-only PDF editor for Azure Static Web Apps.

## v2 features
- Upload and render multi-page PDFs with PDF.js.
- Detect selectable existing text from the PDF text layer.
- Click existing text to create an in-place replacement automatically.
- Preserve detected position, font size, font family hint, bold/italic hint and sampled text/background colours.
- Double-click replacement text to edit directly on the page.
- Add new text manually.
- Drag/resize replacement areas from the properties panel.
- Download the edited PDF locally using pdf-lib.

## Important font note
PDFs may contain subset/embedded fonts that cannot be re-used directly by pdf-lib. The editor maps common fonts to PDF standard fonts. For non-standard detected fonts, it renders the replacement as a high-resolution image using the closest browser-available family to preserve visual appearance.

## Deploy
This project is plain static HTML/CSS/JS. For Azure Static Web Apps with GitHub Actions use:
- `app_location: "/"`
- `api_location: ""`
- `output_location: ""`
- `skip_app_build: true`
