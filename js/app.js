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
    searchIndex: [],
    mindMapReady: false,
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

// Sync XHR to read the XLSX library text. Works on HTTP/HTTPS servers.
// Throws under file:// in standard browser environments due to local CORS restrictions.
function loadXlsxLibraryText() {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", "libs/xlsx.full.min.js", false); // synchronous XHR
    xhr.send();
    if (xhr.status === 0 || xhr.status === 200) {
        return xhr.responseText;
    }
    throw new Error("Could not load libs/xlsx.full.min.js (status " + xhr.status + ")");
}

function handleFile(file) {
    if (!file.name.endsWith(".xlsx")) {
        alert("Please upload a valid .xlsx file.");
        return;
    }

    // Show loaders
    var localLoading = document.getElementById("local-loading");
    var globalLoading = document.getElementById("global-loading-overlay");
    if (localLoading) {
        localLoading.style.display = "block";
        localLoading.querySelector("span").innerText = "Reading Excel file...";
    }
    if (globalLoading) {
        globalLoading.style.display = "flex";
        globalLoading.querySelector("p").innerText = "Reading Excel file...";
    }

    // Allow UI to update before blocking main thread
    setTimeout(function () {
        var xlsxCode = null;
        var useWorker = true;

        // XHR loading check
        if (window.location.protocol === 'file:') {
            useWorker = false;
        } else {
            try {
                xlsxCode = loadXlsxLibraryText();
            } catch (err) {
                console.warn("Failed to load XLSX library for worker: " + err.message + ". Falling back to main-thread parsing.");
                useWorker = false;
            }
        }

        var reader = new FileReader();
        reader.onload = function (e) {
            var arrayBuffer = e.target.result;

            if (useWorker) {
                try {
                    runWorker(arrayBuffer, xlsxCode, localLoading, globalLoading);
                } catch (workerErr) {
                    console.warn("Worker creation failed, falling back to main thread:", workerErr);
                    parseMainThreadAsync(arrayBuffer, localLoading, globalLoading);
                }
            } else {
                parseMainThreadAsync(arrayBuffer, localLoading, globalLoading);
            }
        };
        reader.readAsArrayBuffer(file);
    }, 100);
}

// Web Worker handler
function runWorker(arrayBuffer, xlsxCode, localLoading, globalLoading) {
    if (localLoading) localLoading.querySelector("span").innerText = "Parsing workbook (in worker)...";
    if (globalLoading) globalLoading.querySelector("p").innerText = "Parsing workbook (in worker)...";

    // Build the worker code string using identical helper functions from main thread (DRY)
    var workerCode = xlsxCode + "\n" +
        getColumnNameByPattern.toString() + "\n" +
        structureData.toString() + "\n" +
        buildSearchIndex.toString() + "\n" +
        `
        self.onmessage = function(e) {
            var data = e.data;
            var arrayBuffer = data.arrayBuffer;
            var primaryEntityPatterns = data.primaryEntityPatterns;
            var layerPatterns = data.layerPatterns;
            try {
                var workbook = XLSX.read(arrayBuffer, { type: "array" });
                var rawData = {};

                workbook.SheetNames.forEach(function(sheetName) {
                    var sheet = workbook.Sheets[sheetName];
                    var rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

                    if (rawRows.length === 0) return;

                    var headerRowIndex = 0;
                    for (var i = 0; i < Math.min(rawRows.length, 10); i++) {
                        var row = rawRows[i];
                        if (row && row.filter(function(c) { return c !== null && c !== ""; }).length > 2) {
                            headerRowIndex = i;
                            break;
                        }
                    }

                    var headers = rawRows[headerRowIndex].map(function(h) {
                        return h ? h.toString().trim() : "Column_" + Math.random();
                    });
                    var dataRows = [];

                    for (var i2 = headerRowIndex + 1; i2 < rawRows.length; i2++) {
                        var rowArr = rawRows[i2];
                        if (!rowArr || rowArr.length === 0 || rowArr.every(function(c) { return c === null || c === ""; })) continue;
                        var rowObj = {};
                        headers.forEach(function(header, index) {
                            rowObj[header] = rowArr[index];
                        });
                        dataRows.push(rowObj);
                    }

                    if (dataRows.length > 0) {
                        rawData[sheetName] = { headers: headers, rows: dataRows };
                    }
                });

                var result = structureData(rawData, layerPatterns, primaryEntityPatterns);
                var searchIndex = buildSearchIndex(result.structuredData, result.layers);

                self.postMessage({
                    status: "success",
                    rawData: rawData,
                    structuredData: result.structuredData,
                    layers: result.layers,
                    stats: result.stats,
                    searchIndex: searchIndex
                });
            } catch (error) {
                self.postMessage({ status: "error", error: error.message || String(error) });
            }
        };
        `;

    var blob = new Blob([workerCode], { type: "application/javascript" });
    var workerUrl = URL.createObjectURL(blob);
    var worker = new Worker(workerUrl);

    worker.onmessage = function (evt) {
        var response = evt.data;
        if (response.status === "success") {
            window.appState.rawData = response.rawData;
            window.appState.structuredData = response.structuredData;
            window.appState.layers = response.layers;
            window.appState.stats = response.stats;
            window.appState.searchIndex = response.searchIndex;
            window.appState.mindMapReady = false;

            updateDashboardUI();
        } else {
            console.error("Worker parsing error:", response.error);
            alert("Error parsing workbook: " + response.error);
        }

        if (localLoading) localLoading.style.display = "none";
        if (globalLoading) globalLoading.style.display = "none";
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
    };

    worker.onerror = function (err) {
        console.warn("Worker error event, falling back to main-thread parsing:", err);
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
        parseMainThreadAsync(arrayBuffer, localLoading, globalLoading);
    };

    worker.postMessage({
        arrayBuffer: arrayBuffer,
        primaryEntityPatterns: window.appState.primaryEntityPatterns,
        layerPatterns: window.appState.layerPatterns
    });
}

// Progressive, asynchronous main-thread parser fallback
function parseMainThreadAsync(arrayBuffer, localLoading, globalLoading) {
    if (localLoading) localLoading.querySelector("span").innerText = "Reading Excel workbook...";
    if (globalLoading) globalLoading.querySelector("p").innerText = "Reading Excel workbook...";

    setTimeout(function () {
        try {
            var data = new Uint8Array(arrayBuffer);
            var workbook = XLSX.read(data, { type: "array" });
            processWorkbookAsync(workbook, localLoading, globalLoading);
        } catch (error) {
            console.error("Error parsing workbook on main thread:", error);
            alert("Error parsing Excel file: " + (error.message || String(error)));
            if (localLoading) localLoading.style.display = "none";
            if (globalLoading) globalLoading.style.display = "none";
        }
    }, 50);
}

// Progressive sheet-by-sheet parser to prevent blocking main thread
function processWorkbookAsync(workbook, localLoading, globalLoading) {
    var rawData = {};
    var sheetNames = workbook.SheetNames;
    var currentSheetIndex = 0;

    function parseNextSheet() {
        if (currentSheetIndex >= sheetNames.length) {
            if (localLoading) localLoading.querySelector("span").innerText = "Structuring data...";
            if (globalLoading) globalLoading.querySelector("p").innerText = "Structuring data...";

            setTimeout(function () {
                try {
                    var result = structureData(rawData, window.appState.layerPatterns, window.appState.primaryEntityPatterns);
                    var searchIndex = buildSearchIndex(result.structuredData, result.layers);

                    window.appState.rawData = rawData;
                    window.appState.structuredData = result.structuredData;
                    window.appState.layers = result.layers;
                    window.appState.stats = result.stats;
                    window.appState.searchIndex = searchIndex;
                    window.appState.mindMapReady = false;

                    updateDashboardUI();
                } catch (error) {
                    console.error("Error structuring data:", error);
                    alert("Error structuring data: " + error.message);
                } finally {
                    if (localLoading) localLoading.style.display = "none";
                    if (globalLoading) globalLoading.style.display = "none";
                }
            }, 50);
            return;
        }

        var sheetName = sheetNames[currentSheetIndex];
        if (localLoading) localLoading.querySelector("span").innerText = "Parsing sheet: " + sheetName + "...";
        if (globalLoading) globalLoading.querySelector("p").innerText = "Parsing sheet: " + sheetName + "...";

        setTimeout(function () {
            try {
                var sheet = workbook.Sheets[sheetName];
                var rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

                if (rawRows.length > 0) {
                    var headerRowIndex = 0;
                    for (var i = 0; i < Math.min(rawRows.length, 10); i++) {
                        var row = rawRows[i];
                        if (row && row.filter(function (c) { return c !== null && c !== ""; }).length > 2) {
                            headerRowIndex = i;
                            break;
                        }
                    }

                    var headers = rawRows[headerRowIndex].map(function (h) {
                        return h ? h.toString().trim() : "Column_" + Math.random();
                    });
                    var dataRows = [];

                    for (var i2 = headerRowIndex + 1; i2 < rawRows.length; i2++) {
                        var rowArr = rawRows[i2];
                        if (!rowArr || rowArr.length === 0 || rowArr.every(function (c) { return c === null || c === ""; })) continue;

                        var rowObj = {};
                        headers.forEach(function (header, index) {
                            rowObj[header] = rowArr[index];
                        });
                        dataRows.push(rowObj);
                    }

                    if (dataRows.length > 0) {
                        rawData[sheetName] = { headers: headers, rows: dataRows };
                    }
                }
            } catch (err) {
                console.error("Error parsing sheet " + sheetName + ":", err);
            }

            currentSheetIndex++;
            parseNextSheet();
        }, 30);
    }

    parseNextSheet();
}

// Data parser logic (reused both in Web Worker and Main Thread Fallback)
function getColumnNameByPattern(headers, patterns) {
    for (var h = 0; h < headers.length; h++) {
        var lowerHeader = headers[h].toLowerCase();
        for (var p = 0; p < patterns.length; p++) {
            if (lowerHeader.indexOf(patterns[p]) !== -1) return headers[h];
        }
    }
    return null;
}

function structureData(rawData, layerPatterns, primaryEntityPatterns) {
    var structured = {};
    var entitiesSet = {};
    var totalTxns = 0;
    var totalAmt = 0;
    var amountPatterns = ["transaction amount", "withdrawal amount", "put on hold amount"];
    var sheetNames = Object.keys(rawData);

    for (var si = 0; si < sheetNames.length; si++) {
        var sheetName = sheetNames[si];
        var headers = rawData[sheetName].headers;
        var rows = rawData[sheetName].rows;
        var layerCol = getColumnNameByPattern(headers, layerPatterns);
        var entityCol = getColumnNameByPattern(headers, primaryEntityPatterns);
        var amountCol = getColumnNameByPattern(headers, amountPatterns);

        for (var ri = 0; ri < rows.length; ri++) {
            var row = rows[ri];
            var isUnclassified = false;
            var layerVal = layerCol ? row[layerCol] : null;
            var entityVal = entityCol ? row[entityCol] : null;

            if (!layerVal || !entityVal) {
                isUnclassified = true;
                layerVal = "Unclassified Data";
                entityVal = "Unclassified Entity";
            }

            var layerKey = layerVal;
            if (!isUnclassified) {
                var layerMatch = String(layerVal).match(/\d+/);
                var layerNum = layerMatch ? parseInt(layerMatch[0]) : 999;
                layerKey = "Layer " + layerNum;
            }

            if (!structured[layerKey]) structured[layerKey] = {};
            if (!structured[layerKey][entityVal]) structured[layerKey][entityVal] = {};
            if (!structured[layerKey][entityVal][sheetName]) structured[layerKey][entityVal][sheetName] = [];

            structured[layerKey][entityVal][sheetName].push(row);
            entitiesSet[entityVal] = 1;
            totalTxns++;

            if (amountCol && row[amountCol]) {
                var amt = parseFloat(String(row[amountCol]).replace(/,/g, ""));
                if (!isNaN(amt)) totalAmt += amt;
            }
        }
    }

    var layerKeys = Object.keys(structured).sort(function (a, b) {
        if (a === "Unclassified Data") return 1;
        if (b === "Unclassified Data") return -1;
        var numA = parseInt((a.match(/\d+/) || [999])[0]);
        var numB = parseInt((b.match(/\d+/) || [999])[0]);
        return numA - numB;
    });

    return {
        structuredData: structured,
        layers: layerKeys,
        stats: {
            layers: layerKeys.length,
            entities: Object.keys(entitiesSet).length,
            transactions: totalTxns,
            totalAmount: totalAmt
        }
    };
}

function buildSearchIndex(structuredData, layers) {
    var index = [];
    for (var li = 0; li < layers.length; li++) {
        var layerKey = layers[li];
        var entities = structuredData[layerKey];
        var entityNames = Object.keys(entities);
        for (var ei = 0; ei < entityNames.length; ei++) {
            var entityName = entityNames[ei];
            var sheets = entities[entityName];
            var sheetNames = Object.keys(sheets);
            for (var si = 0; si < sheetNames.length; si++) {
                var sheetName = sheetNames[si];
                var rows = sheets[sheetName];
                for (var ri = 0; ri < rows.length; ri++) {
                    var row = rows[ri];
                    var vals = Object.values(row);
                    var parts = [];
                    for (var vi = 0; vi < vals.length; vi++) {
                        if (vals[vi] !== null && vals[vi] !== undefined) {
                            parts.push(String(vals[vi]).toLowerCase());
                        }
                    }
                    index.push({
                        normalizedText: parts.join(" "),
                        row: row,
                        layer: layerKey,
                        sheet: sheetName,
                        entity: entityName
                    });
                }
            }
        }
    }
    return index;
}

function updateDashboardUI() {
    document.getElementById("upload-overlay").classList.add("hidden");
    document.getElementById("dashboard").style.display = "flex";

    // Hide loaders
    var localLoading = document.getElementById("local-loading");
    var globalLoading = document.getElementById("global-loading-overlay");
    if (localLoading) localLoading.style.display = "none";
    if (globalLoading) globalLoading.style.display = "none";

    // Show Export button
    var exportBtn = document.getElementById("export-word-btn");
    if (exportBtn) exportBtn.style.display = "inline-block";

    // Update stats
    document.getElementById("stat-layers").innerText = window.appState.stats.layers;
    document.getElementById("stat-entities").innerText = window.appState.stats.entities;
    document.getElementById("stat-txns").innerText = window.appState.stats.transactions;

    // Format amount with commas
    var formatter = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById("stat-amount").innerText = formatter.format(window.appState.stats.totalAmount);

    // Initialize Table View
    if (window.renderSidebarAndTables) {
        window.renderSidebarAndTables();
    }

    // Reset flag so next tab-switch triggers init
    window.appState.mindMapReady = false;
    if (window.appState.cy) {
        window.appState.cy.destroy();
        window.appState.cy = null;
    }

    // If the graph tab is currently active, rebuild immediately
    var graphTab = document.querySelector('.tab-btn[data-target="graph-view"]');
    if (graphTab && graphTab.classList.contains("active") && window.appState.layers.length > 0) {
        var cyContainer = document.getElementById("cy");
        if (cyContainer) {
            cyContainer.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#7f8c8d;font-size:14px;"><div class="spinner-small" style="margin-right:10px;"></div> Building graph...</div>';
        }
        setTimeout(function () {
            if (window.initMindMap) window.initMindMap();
            window.appState.mindMapReady = true;
        }, 50);
    }
}

function setupTabs() {
    var tabs = document.querySelectorAll(".tab-btn");
    var panels = document.querySelectorAll(".view-panel");

    tabs.forEach(function (tab) {
        tab.addEventListener("click", function () {
            tabs.forEach(function (t) { t.classList.remove("active"); });
            panels.forEach(function (p) { p.classList.remove("active"); });

            tab.classList.add("active");
            document.getElementById(tab.dataset.target).classList.add("active");

            // Lazy mind-map init
            if (tab.dataset.target === "graph-view") {
                if (!window.appState.mindMapReady && window.appState.layers.length > 0) {
                    var cy = document.getElementById("cy");
                    if (cy) {
                        cy.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#7f8c8d;font-size:14px;"><div class="spinner-small" style="margin-right:10px;"></div> Building graph...</div>';
                    }
                    setTimeout(function () {
                        if (window.initMindMap) window.initMindMap();
                        window.appState.mindMapReady = true;
                    }, 50);
                } else if (window.appState.cy) {
                    window.appState.cy.resize();
                    window.appState.cy.fit();
                }
            }
        });
    });
}
