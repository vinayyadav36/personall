// Global State
window.appState = {
    rawData: {}, // { sheetName: { headers: [], rows: [] } }
    structuredData: {}, // { layerNumber: { entityName: { sheetName: [ rows ] } } }
    layers: [],
    stats: {
        layers: 0,
        entities: 0,
        transactions: 0,
        totalAmount: 0
    },
    primaryEntityPatterns: ["account no", "wallet", "pg", "pa", "id", "account no./(wallet/pg/pa) id"],
    layerPatterns: ["layer", "layer no", "lyr"]
};

document.addEventListener("DOMContentLoaded", () => {
    setupDragAndDrop();
    setupTabs();
});

function setupDragAndDrop() {
    const dropZone = document.getElementById("drop-zone");
    const fileInput = document.getElementById("file-input");

    dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.style.borderColor = "var(--success-color)";
    });

    dropZone.addEventListener("dragleave", (e) => {
        e.preventDefault();
        dropZone.style.borderColor = "var(--accent-color)";
    });

    dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.style.borderColor = "var(--accent-color)";
        if (e.dataTransfer.files.length) {
            handleFile(e.dataTransfer.files[0]);
        }
    });

    fileInput.addEventListener("change", (e) => {
        if (e.target.files.length) {
            handleFile(e.target.files[0]);
        }
    });
}

function handleFile(file) {
    if (!file.name.endsWith(".xlsx")) {
        alert("Please upload a valid .xlsx file.");
        return;
    }

    // Show loaders
    const localLoading = document.getElementById('local-loading');
    const globalLoading = document.getElementById('global-loading-overlay');
    if (localLoading) localLoading.style.display = 'block';
    if (globalLoading) globalLoading.style.display = 'flex';

    // Allow UI to update before blocking main thread
    setTimeout(() => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: "array" });
                processWorkbook(workbook);
            } catch (error) {
                console.error("Error reading Excel file:", error);
                alert("Error parsing the Excel file. See console for details.");
                if (localLoading) localLoading.style.display = 'none';
                if (globalLoading) globalLoading.style.display = 'none';
            }
        };
        reader.readAsArrayBuffer(file);
    }, 100);
}

function processWorkbook(workbook) {
    window.appState.rawData = {};
    window.appState.structuredData = {};
    window.appState.layers = [];
    window.appState.stats = { layers: 0, entities: 0, transactions: 0, totalAmount: 0 };

    workbook.SheetNames.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        // Read raw array to find headers manually
        const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

        if (rawRows.length === 0) return;

        // Find header row (first row with significant data)
        let headerRowIndex = 0;
        for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
            const row = rawRows[i];
            if (row && row.filter(cell => cell !== null && cell !== "").length > 2) {
                headerRowIndex = i;
                break;
            }
        }

        const headers = rawRows[headerRowIndex].map(h => (h ? h.toString().trim() : `Column_${Math.random()}`));
        const dataRows = [];

        for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
            const rowArr = rawRows[i];
            // Skip completely empty rows
            if (!rowArr || rowArr.length === 0 || rowArr.every(cell => cell === null || cell === "")) continue;

            const rowObj = {};
            headers.forEach((header, index) => {
                rowObj[header] = rowArr[index];
            });
            dataRows.push(rowObj);
        }

        if (dataRows.length > 0) {
            window.appState.rawData[sheetName] = { headers, rows: dataRows };
        }
    });

    structureData();
    updateDashboardUI();
}

function getColumnNameByPattern(headers, patterns) {
    for (const header of headers) {
        const lowerHeader = header.toLowerCase();
        for (const pattern of patterns) {
            if (lowerHeader.includes(pattern)) {
                return header;
            }
        }
    }
    return null;
}

function structureData() {
    const rawData = window.appState.rawData;
    const structured = {};
    const entitiesSet = new Set();
    let totalTxns = 0;
    let totalAmt = 0;
    const amountPatterns = ["transaction amount", "withdrawal amount", "put on hold amount"];

    Object.keys(rawData).forEach(sheetName => {
        const { headers, rows } = rawData[sheetName];

        const layerCol = getColumnNameByPattern(headers, window.appState.layerPatterns);
        const entityCol = getColumnNameByPattern(headers, window.appState.primaryEntityPatterns);
        const amountCol = getColumnNameByPattern(headers, amountPatterns);

        rows.forEach(row => {
            let isUnclassified = false;
            let layerVal = layerCol ? row[layerCol] : null;
            let entityVal = entityCol ? row[entityCol] : null;

            if (!layerVal || !entityVal) {
                isUnclassified = true;
                layerVal = "Unclassified Data";
                entityVal = "Unclassified Entity";
            }

            // Clean layer name for sorting (e.g., "Layer 1" -> 1)
            let layerKey = layerVal;
            if (!isUnclassified) {
                const layerMatch = String(layerVal).match(/\d+/);
                const layerNum = layerMatch ? parseInt(layerMatch[0]) : 999;
                layerKey = `Layer ${layerNum}`;
            }

            if (!structured[layerKey]) {
                structured[layerKey] = {};
            }
            if (!structured[layerKey][entityVal]) {
                structured[layerKey][entityVal] = {};
            }
            if (!structured[layerKey][entityVal][sheetName]) {
                structured[layerKey][entityVal][sheetName] = [];
            }

            structured[layerKey][entityVal][sheetName].push(row);
            entitiesSet.add(entityVal);
            totalTxns++;

            if (amountCol && row[amountCol]) {
                const amt = parseFloat(row[amountCol].toString().replace(/,/g, ''));
                if (!isNaN(amt)) {
                    totalAmt += amt;
                }
            }
        });
    });

    window.appState.structuredData = structured;

    // Sort layers
    window.appState.layers = Object.keys(structured).sort((a, b) => {
        if (a === "Unclassified Data") return 1; // Put unclassified at the end
        if (b === "Unclassified Data") return -1;

        const numA = parseInt(a.match(/\d+/)?.[0] || 999);
        const numB = parseInt(b.match(/\d+/)?.[0] || 999);
        return numA - numB;
    });

    window.appState.stats = {
        layers: window.appState.layers.length,
        entities: entitiesSet.size,
        transactions: totalTxns,
        totalAmount: totalAmt
    };
}

function updateDashboardUI() {
    document.getElementById("upload-overlay").classList.add("hidden");
    document.getElementById("dashboard").style.display = "flex";

    // Hide loaders
    const localLoading = document.getElementById('local-loading');
    const globalLoading = document.getElementById('global-loading-overlay');
    if (localLoading) localLoading.style.display = 'none';
    if (globalLoading) globalLoading.style.display = 'none';

    // Show Export button
    const exportBtn = document.getElementById("export-word-btn");
    if (exportBtn) exportBtn.style.display = "inline-block";

    // Update stats
    document.getElementById("stat-layers").innerText = window.appState.stats.layers;
    document.getElementById("stat-entities").innerText = window.appState.stats.entities;
    document.getElementById("stat-txns").innerText = window.appState.stats.transactions;

    // Format amount with commas
    const formatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById("stat-amount").innerText = formatter.format(window.appState.stats.totalAmount);

    // Initialize Table View
    if (window.renderSidebarAndTables) {
        window.renderSidebarAndTables();
    }

    // Initialize Mind Map View
    if (window.initMindMap) {
        window.initMindMap();
    }
}

function setupTabs() {
    const tabs = document.querySelectorAll(".tab-btn");
    const panels = document.querySelectorAll(".view-panel");

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => t.classList.remove("active"));
            panels.forEach(p => p.classList.remove("active"));

            tab.classList.add("active");
            document.getElementById(tab.dataset.target).classList.add("active");

            // Fix cytoscape rendering issue when container is initially hidden
            if (tab.dataset.target === "graph-view" && window.appState.cy) {
                window.appState.cy.resize();
                window.appState.cy.fit();
            }
        });
    });
}
