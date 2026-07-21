# Financial Transaction Visualizer

This is a fully local, offline-capable web application for visualizing and analyzing layered financial transaction data extracted from Excel (.xlsx) files.
It processes data completely in the browser — no backend, no server, and no internet dependency after the initial setup.

## Setup Instructions

To run this application locally without internet access, you need to download two JavaScript libraries and place them in the `/libs/` folder.

1. **SheetJS**
   - Download the latest stable version of `xlsx.full.min.js`.
   - You can get it from their CDN or GitHub releases. For example: `https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js`
   - Save the file as `libs/xlsx.full.min.js`.

2. **Cytoscape.js**
   - Download the latest stable version of `cytoscape.min.js`.
   - You can get it from their CDN or GitHub. For example: `https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.28.1/cytoscape.min.js`
   - Save the file as `libs/cytoscape.min.js`.

After placing these two files in the `libs` folder, simply open `index.html` in your web browser (double-click the file) to start using the application.

## Features

- **Local Processing:** 100% of the data processing happens in your browser. No data is sent to any server.
- **Layer-wise Organization:** Visualizes multiple layers of financial transactions (Layer 1, Layer 2, etc.).
- **Cross-Reference:** Links entities and transaction flows automatically between layers.
- **Table and Mind Map Views:** Explore the data either in a detailed, sortable table or visually via an interactive concentric mind map.
- **Filtering & Search:** Easily filter by specific transaction criteria (amount, date, UTR, account).
- **Themes:** Light theme for clarity and professional forensic analysis.

## Development

This app is built using plain HTML5, CSS3, and Vanilla JavaScript (ES6+).
It uses `<script>` tags rather than ES6 modules to support opening via the `file://` protocol directly.