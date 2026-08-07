# Free PDF Editor MVP

A no-build, browser-only PDF editor ready for Azure Static Web Apps.

## Features
- Upload and preview multi-page PDFs
- Add replacement text boxes
- Cover original text with a chosen background colour
- Drag text into place
- Change text, size, colour, width and height
- Download the edited PDF
- Files remain in the browser

## Run locally
Use a local web server (ES modules do not work reliably from `file://`):

```bash
python -m http.server 8080
```
Then open `http://localhost:8080`.

## Azure Static Web Apps
Upload these files to a GitHub repository and create an Azure Static Web App with:
- App location: `/`
- API location: blank
- Output location: blank

## Limitation
This version visually replaces text by covering the original area and adding new text. It does not reconstruct arbitrary original PDF text objects. Scanned PDFs will need OCR later.
