window.renderSidebarAndTables = function() {
    const layers = window.appState.layers;
    const navigator = document.getElementById("layer-navigator");
    const container = document.getElementById("table-container");

    navigator.innerHTML = "";
    container.innerHTML = "";

    layers.forEach((layerKey, index) => {
        const entityCount = Object.keys(window.appState.structuredData[layerKey]).length;

        // Sidebar item
        const li = document.createElement("li");
        li.innerHTML = `${layerKey} <span class="meta">${entityCount} Entities</span>`;
        if (index === 0) li.classList.add("active");
        li.addEventListener("click", () => switchLayer(layerKey, li));
        navigator.appendChild(li);

        // Layer container
        const layerDiv = document.createElement("div");
        layerDiv.id = `view-${layerKey.replace(/\s+/g, '-')}`;
        layerDiv.className = "layer-view";
        layerDiv.style.display = index === 0 ? "block" : "none";
        container.appendChild(layerDiv);

        renderLayerData(layerKey, layerDiv);
    });

    setupSearchFilter();
    setupPrimaryEntityToggle();
};

function switchLayer(layerKey, activeLi) {
    document.querySelectorAll(".layer-list li").forEach(li => li.classList.remove("active"));
    activeLi.classList.add("active");

    document.querySelectorAll(".layer-view").forEach(div => div.style.display = "none");
    document.getElementById(`view-${layerKey.replace(/\s+/g, '-')}`).style.display = "block";
}

function renderLayerData(layerKey, container) {
    const entities = window.appState.structuredData[layerKey];

    // Find previous layer for cross-referencing
    const currentLayerIndex = window.appState.layers.indexOf(layerKey);
    const prevLayerKey = currentLayerIndex > 0 ? window.appState.layers[currentLayerIndex - 1] : null;

    Object.keys(entities).forEach(entityName => {
        const entityDiv = document.createElement("div");
        entityDiv.className = "entity-section";

        const header = document.createElement("div");
        header.className = "entity-header";
        const totalTxns = Object.values(entities[entityName]).reduce((sum, arr) => sum + arr.length, 0);

        let headerText = `Entity: ${entityName} (${totalTxns} Transactions)`;

        // Check if this entity is a receiver from the previous layer's Money Transfer
        let crossRefText = "";
        if (prevLayerKey) {
            const isLinked = checkCrossReference(prevLayerKey, entityName);
            if (isLinked) {
                crossRefText = `<span class="cross-ref-badge">Linked from ${prevLayerKey}</span>`;
                entityDiv.classList.add("cross-ref");
            }
        }

        header.innerHTML = `<span>${crossRefText} ${headerText}</span> <span>▼</span>`;
        entityDiv.appendChild(header);

        const content = document.createElement("div");
        content.className = "entity-content";
        content.style.display = "block"; // default open or closed based on pref

        header.addEventListener("click", () => {
            content.style.display = content.style.display === "none" ? "block" : "none";
            header.querySelector("span:last-child").innerText = content.style.display === "none" ? "▶" : "▼";
        });

        // Transactions
        const sheets = entities[entityName];
        Object.keys(sheets).forEach(sheetName => {
            const rows = sheets[sheetName];
            if (rows.length === 0) return;

            const txnSection = document.createElement("div");
            txnSection.className = "transaction-section";
            txnSection.innerHTML = `<h4>${sheetName} (${rows.length})</h4>`;

            const table = document.createElement("table");
            table.className = "data-table";

            // Generate Headers based on raw data to keep original columns
            const originalHeaders = window.appState.rawData[sheetName].headers;

            const thead = document.createElement("thead");
            const trHead = document.createElement("tr");
            originalHeaders.forEach(col => {
                const th = document.createElement("th");
                th.innerText = col;
                th.className = isPrimaryEntityCol(col) ? "primary-entity-col" : "";
                trHead.appendChild(th);
            });
            thead.appendChild(trHead);
            table.appendChild(thead);

            // Generate Rows with Pagination
            const tbody = document.createElement("tbody");
            table.appendChild(tbody);
            txnSection.appendChild(table);

            const paginationControls = document.createElement("div");
            paginationControls.className = "pagination-controls";
            paginationControls.style.display = "none"; // Hide initially if 1 page
            const prevBtn = document.createElement("button");
            const pageInfo = document.createElement("span");
            const nextBtn = document.createElement("button");
            paginationControls.appendChild(prevBtn);
            paginationControls.appendChild(pageInfo);
            paginationControls.appendChild(nextBtn);
            txnSection.appendChild(paginationControls);

            const ROWS_PER_PAGE = 50;

            // Attach render logic to the table so global search can call it
            table.filteredRows = [...rows];
            table.currentPage = 1;

            table.renderPage = () => {
                const totalPages = Math.ceil(table.filteredRows.length / ROWS_PER_PAGE) || 1;
                if (table.currentPage > totalPages) table.currentPage = totalPages;

                tbody.innerHTML = "";
                const start = (table.currentPage - 1) * ROWS_PER_PAGE;
                const end = start + ROWS_PER_PAGE;
                const pageRows = table.filteredRows.slice(start, end);

                pageRows.forEach(row => {
                    const tr = document.createElement("tr");
                    originalHeaders.forEach(col => {
                        const td = document.createElement("td");
                        td.innerText = row[col] !== null && row[col] !== undefined ? row[col] : "";
                        td.className = isPrimaryEntityCol(col) ? "primary-entity-col" : "";
                        tr.appendChild(td);
                    });
                    tbody.appendChild(tr);
                });

                setupPrimaryEntityToggle(true);

                if (totalPages > 1) {
                    paginationControls.style.display = "flex";
                    prevBtn.innerText = "Previous";
                    prevBtn.disabled = table.currentPage === 1;
                    pageInfo.innerText = `Page ${table.currentPage} of ${totalPages}`;
                    nextBtn.innerText = "Next";
                    nextBtn.disabled = table.currentPage === totalPages;
                } else {
                    paginationControls.style.display = "none";
                }
            };

            // Attach actual full row data for searching
            table.fullRowsData = rows.map(r => ({
                row: r,
                searchString: Object.values(r).join(" ").toLowerCase()
            }));

            prevBtn.addEventListener("click", () => {
                if (table.currentPage > 1) {
                    table.currentPage--;
                    table.renderPage();
                }
            });

            nextBtn.addEventListener("click", () => {
                const totalPages = Math.ceil(table.filteredRows.length / ROWS_PER_PAGE);
                if (table.currentPage < totalPages) {
                    table.currentPage++;
                    table.renderPage();
                }
            });

            table.renderPage();
            content.appendChild(txnSection);
        });

        entityDiv.appendChild(content);
        container.appendChild(entityDiv);
    });
}

function checkCrossReference(prevLayerKey, currentEntityName) {
    const prevLayerEntities = window.appState.structuredData[prevLayerKey];
    if (!prevLayerEntities) return false;

    // We look into the previous layer's "Money Transfer" or similar sheets to see if currentEntityName was a receiver
    for (const senderEntity in prevLayerEntities) {
        for (const sheetName in prevLayerEntities[senderEntity]) {
            if (sheetName.toLowerCase().includes("money transfer")) {
                const rows = prevLayerEntities[senderEntity][sheetName];
                for (const row of rows) {
                    // Try to find the account no / receiver col
                    const receiverCol = Object.keys(row).find(k => k.toLowerCase() === "account no" || k.toLowerCase().includes("to account"));
                    if (receiverCol && String(row[receiverCol]).trim() === String(currentEntityName).trim()) {
                        return true;
                    }
                }
            }
        }
    }
    return false;
}

function isPrimaryEntityCol(colName) {
    const lower = colName.toLowerCase();
    return window.appState.primaryEntityPatterns.some(p => lower.includes(p));
}

function setupPrimaryEntityToggle(skipEvent = false) {
    const toggle = document.getElementById("toggle-primary-entity");
    const updateVisibility = () => {
        const cols = document.querySelectorAll(".primary-entity-col");
        cols.forEach(c => {
            c.style.display = toggle.checked ? "table-cell" : "none";
        });
    };

    if (!skipEvent) {
        // Remove old listener if exists
        const newToggle = toggle.cloneNode(true);
        toggle.parentNode.replaceChild(newToggle, toggle);
        newToggle.addEventListener("change", updateVisibility);
    }
    updateVisibility(); // initial state
}

window.lastSearchQuery = "";

function performSearch(queryText = null, updateWindowRef = true) {
    const searchInput = document.getElementById("global-search");
    const query = queryText !== null ? queryText : searchInput.value.toLowerCase().trim();
    if (updateWindowRef) window.lastSearchQuery = query;

    const tables = document.querySelectorAll(".data-table");

    tables.forEach(table => {
        if (!table.fullRowsData) return; // Skip if not initialized

        if (query === "") {
            table.filteredRows = table.fullRowsData.map(item => item.row);
        } else {
            table.filteredRows = table.fullRowsData
                .filter(item => item.searchString.includes(query))
                .map(item => item.row);
        }
        table.currentPage = 1;
        table.renderPage();
    });

    // Hide empty entity sections
    document.querySelectorAll(".entity-section").forEach(section => {
        const hasVisibleData = Array.from(section.querySelectorAll(".data-table")).some(table => table.filteredRows && table.filteredRows.length > 0);
        section.style.display = hasVisibleData ? "block" : "none";
    });
}

function setupSearchFilter() {
    const searchInput = document.getElementById("global-search");
    const filterBtn = document.getElementById("filter-btn");

    // Remove old listeners
    const newBtn = filterBtn.cloneNode(true);
    filterBtn.parentNode.replaceChild(newBtn, filterBtn);

    const newInput = searchInput.cloneNode(true);
    searchInput.parentNode.replaceChild(newInput, searchInput);

    newBtn.addEventListener("click", () => performSearch());

    let debounceTimer;
    newInput.addEventListener("keyup", (e) => {
        if (e.key === "Enter") {
            clearTimeout(debounceTimer);
            performSearch();
        } else {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => performSearch(), 300);
        }
    });
}
