// Table rendering and filtering logic
window.renderSidebarAndTables = function() {
    const layers = window.appState.layers;
    const navigator = document.getElementById("layer-navigator");
    const container = document.getElementById("table-container");

    navigator.innerHTML = "";
    container.innerHTML = "";

    const query = window.lastSearchQuery || "";

    layers.forEach((layerKey, index) => {
        const entityCount = getMatchingEntityCountForLayer(layerKey, query);

        // Sidebar item
        const li = document.createElement("li");
        li.innerHTML = `${layerKey} <span class="meta">${entityCount} Entities</span>`;
        if (index === 0) li.classList.add("active");
        
        // Highlight if matches exist
        if (query !== "" && getLayerMatchCount(layerKey, query) > 0) {
            li.classList.add("has-matches");
        }

        li.addEventListener("click", () => switchLayer(layerKey, li));
        navigator.appendChild(li);

        // Layer container
        const layerDiv = document.createElement("div");
        layerDiv.id = `view-${layerKey.replace(/\s+/g, '-')}`;
        layerDiv.className = "layer-view";
        layerDiv.style.display = index === 0 ? "block" : "none";
        container.appendChild(layerDiv);

        // Lazy load: only render the active layer initially
        if (index === 0) {
            renderLayerData(layerKey, layerDiv);
            layerDiv.dataset.rendered = "true";
        } else {
            layerDiv.dataset.rendered = "false";
        }
    });

    setupSearchFilter();
    setupPrimaryEntityToggle();
};

function switchLayer(layerKey, activeLi) {
    document.querySelectorAll(".layer-list li").forEach(li => li.classList.remove("active"));
    activeLi.classList.add("active");

    // Hide all other layer containers and recycle their DOM
    document.querySelectorAll(".layer-view").forEach(div => {
        const expectedId = `view-${layerKey.replace(/\s+/g, '-')}`;
        if (div.id !== expectedId) {
            div.style.display = "none";
            // Clear content to free DOM memory (DOM Recycling)
            div.innerHTML = "";
            div.dataset.rendered = "false";
        }
    });

    const layerDivId = `view-${layerKey.replace(/\s+/g, '-')}`;
    const layerDiv = document.getElementById(layerDivId);
    if (layerDiv) {
        layerDiv.style.display = "block";
        if (layerDiv.dataset.rendered === "false") {
            renderLayerData(layerKey, layerDiv);
            layerDiv.dataset.rendered = "true";
        }
    }

    // Update active search summary chips
    if (window.lastSearchQuery !== "") {
        performSearch(window.lastSearchQuery, false);
    }

    // Highlight layer in graph as well
    if (window.appState.cy && window.highlightLayerInGraph) {
        window.highlightLayerInGraph(window.appState.cy, layerKey);
    }
}

function renderLayerData(layerKey, container) {
    const entities = window.appState.structuredData[layerKey];
    if (!entities) return;

    const currentLayerIndex = window.appState.layers.indexOf(layerKey);
    const prevLayerKey = currentLayerIndex > 0 ? window.appState.layers[currentLayerIndex - 1] : null;
    const query = window.lastSearchQuery || "";

    Object.keys(entities).forEach(entityName => {
        const sheets = entities[entityName];
        
        // Filter rows by query
        let entityHasMatches = false;
        const filteredSheetsData = {};

        Object.keys(sheets).forEach(sheetName => {
            const rows = sheets[sheetName];
            const filtered = rows.filter(r => {
                if (query === "") return true;
                const searchString = Object.values(r)
                    .filter(v => v !== null && v !== undefined)
                    .map(v => String(v).toLowerCase())
                    .join(" ");
                return searchString.includes(query);
            });
            if (filtered.length > 0) {
                filteredSheetsData[sheetName] = filtered;
                entityHasMatches = true;
            }
        });

        if (!entityHasMatches) return; // Skip rendering if no rows match search query

        const entityDiv = document.createElement("div");
        entityDiv.className = "entity-section";

        const header = document.createElement("div");
        header.className = "entity-header";
        const totalTxns = Object.values(filteredSheetsData).reduce((sum, arr) => sum + arr.length, 0);

        let headerText = `Entity: ${entityName} (${totalTxns} Transactions)`;

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
        content.style.display = "block";

        header.addEventListener("click", () => {
            content.style.display = content.style.display === "none" ? "block" : "none";
            header.querySelector("span:last-child").innerText = content.style.display === "none" ? "▶" : "▼";
        });

        // Transactions
        Object.keys(filteredSheetsData).forEach(sheetName => {
            const rows = filteredSheetsData[sheetName];
            const txnSection = document.createElement("div");
            txnSection.className = "transaction-section";
            txnSection.innerHTML = `<h4>${sheetName} (${rows.length})</h4>`;

            const table = document.createElement("table");
            table.className = "data-table";

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

            const tbody = document.createElement("tbody");
            table.appendChild(tbody);
            txnSection.appendChild(table);

            const paginationControls = document.createElement("div");
            paginationControls.className = "pagination-controls";
            paginationControls.style.display = "none";
            const prevBtn = document.createElement("button");
            const pageInfo = document.createElement("span");
            const nextBtn = document.createElement("button");
            paginationControls.appendChild(prevBtn);
            paginationControls.appendChild(pageInfo);
            paginationControls.appendChild(nextBtn);
            txnSection.appendChild(paginationControls);

            const ROWS_PER_PAGE = 50;
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

    for (const senderEntity in prevLayerEntities) {
        for (const sheetName in prevLayerEntities[senderEntity]) {
            if (sheetName.toLowerCase().includes("money transfer")) {
                const rows = prevLayerEntities[senderEntity][sheetName];
                for (const row of rows) {
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
        const newToggle = toggle.cloneNode(true);
        toggle.parentNode.replaceChild(newToggle, toggle);
        newToggle.addEventListener("change", updateVisibility);
    }
    updateVisibility();
}

window.lastSearchQuery = "";

function performSearch(queryText = null, updateWindowRef = true) {
    const searchInput = document.getElementById("global-search");
    const query = queryText !== null ? queryText : searchInput.value.toLowerCase().trim();
    
    if (updateWindowRef) {
        window.lastSearchQuery = query;
        searchInput.value = query;
    }

    const layers = window.appState.layers;
    const navigator = document.getElementById("layer-navigator");
    const summaryBar = document.getElementById("search-summary-bar");

    // 1. Get search statistics
    let totalMatches = 0;
    const layerMatchCounts = {};
    const matchedLayersSet = new Set();
    const matchedEntitiesSet = new Set();

    if (query !== "") {
        const matches = window.appState.searchIndex.filter(item => item.normalizedText.includes(query));
        totalMatches = matches.length;
        matches.forEach(m => {
            matchedLayersSet.add(m.layer);
            matchedEntitiesSet.add(m.entity);
            layerMatchCounts[m.layer] = (layerMatchCounts[m.layer] || 0) + 1;
        });
    }

    // 2. Render Search Summary Bar
    if (query === "") {
        summaryBar.style.display = "none";
        summaryBar.innerHTML = "";
    } else {
        summaryBar.style.display = "flex";
        
        let discoveryHTML = `<div class="summary-text">`;
        if (totalMatches === 0) {
            discoveryHTML += `🔍 No matches found anywhere in the workbook.`;
        } else {
            discoveryHTML += `🔍 Found <strong>${totalMatches}</strong> matches in <strong>${matchedEntitiesSet.size}</strong> entities across <strong>${matchedLayersSet.size}</strong> layers. `;
        }
        discoveryHTML += `</div>`;

        const activeLi = navigator.querySelector("li.active");
        const activeLayerKey = activeLi ? activeLi.childNodes[0].textContent.trim() : (layers[0] || "");
        const activeLayerMatches = layerMatchCounts[activeLayerKey] || 0;

        if (totalMatches > 0) {
            discoveryHTML += `<div class="search-chips">`;
            if (activeLayerMatches === 0) {
                discoveryHTML += `<span style="margin-right: 5px; font-weight: bold; color: var(--danger-color);">Not in current layer. Go to:</span>`;
            } else {
                discoveryHTML += `<span style="margin-right: 5px; font-weight: bold;">Jump to:</span>`;
            }

            matchedLayersSet.forEach(layerKey => {
                const count = layerMatchCounts[layerKey];
                const isActive = (layerKey === activeLayerKey);
                discoveryHTML += `<button class="search-chip ${isActive ? 'active-chip' : ''}" onclick="window.jumpToLayerFromSearch('${layerKey.replace(/'/g, "\\'")}')">${layerKey} (${count})</button>`;
            });
            discoveryHTML += `</div>`;
        }

        summaryBar.innerHTML = discoveryHTML;
    }

    // 3. Re-render Sidebar to show matching layer badges and counts
    const activeLi = navigator.querySelector("li.active");
    const activeLayerKey = activeLi ? activeLi.childNodes[0].textContent.trim() : (layers[0] || "");
    navigator.innerHTML = "";

    layers.forEach((layerKey, index) => {
        const entityCount = getMatchingEntityCountForLayer(layerKey, query);

        const li = document.createElement("li");
        li.innerHTML = `${layerKey} <span class="meta">${entityCount} Entities</span>`;
        if (layerKey === activeLayerKey) {
            li.classList.add("active");
        }
        
        if (query !== "" && layerMatchCounts[layerKey] > 0) {
            li.classList.add("has-matches");
        }

        li.addEventListener("click", () => switchLayer(layerKey, li));
        navigator.appendChild(li);
    });

    // 4. Re-render Active Layer View
    if (activeLayerKey) {
        const activeContainerId = `view-${activeLayerKey.replace(/\s+/g, '-')}`;
        let activeContainer = document.getElementById(activeContainerId);
        if (!activeContainer) {
            activeContainer = document.createElement("div");
            activeContainer.id = activeContainerId;
            activeContainer.className = "layer-view";
            document.getElementById("table-container").appendChild(activeContainer);
        }
        activeContainer.innerHTML = "";
        activeContainer.style.display = "block";
        renderLayerData(activeLayerKey, activeContainer);
        activeContainer.dataset.rendered = "true";
    }

    // 5. Reset all other layer views to unrendered/empty state to prevent DOM growth
    document.querySelectorAll(".layer-view").forEach(div => {
        const expectedId = `view-${activeLayerKey.replace(/\s+/g, '-')}`;
        if (div.id !== expectedId) {
            div.dataset.rendered = "false";
            div.innerHTML = "";
            div.style.display = "none";
        }
    });

    // 6. Update the Mind Map Graph in sync
    if (window.initMindMap) {
        window.initMindMap();
    }
}

window.jumpToLayerFromSearch = function(layerKey) {
    const navigator = document.getElementById("layer-navigator");
    const lis = navigator.querySelectorAll("li");
    let targetLi = null;
    
    lis.forEach(li => {
        if (li.childNodes[0].textContent.trim() === layerKey) {
            targetLi = li;
        }
    });

    if (targetLi) {
        switchLayer(layerKey, targetLi);
    }
};

function getMatchingEntityCountForLayer(layerKey, query) {
    const entities = window.appState.structuredData[layerKey];
    if (!entities) return 0;
    if (!query) return Object.keys(entities).length;

    let count = 0;
    Object.keys(entities).forEach(entityName => {
        const sheets = entities[entityName];
        let entityMatches = false;
        for (const sheetName in sheets) {
            for (const row of sheets[sheetName]) {
                const rowStr = Object.values(row)
                    .filter(v => v !== null && v !== undefined)
                    .map(v => String(v).toLowerCase())
                    .join(" ");
                if (rowStr.includes(query)) {
                    entityMatches = true;
                    break;
                }
            }
            if (entityMatches) break;
        }
        if (entityMatches) count++;
    });
    return count;
}

function getLayerMatchCount(layerKey, query) {
    if (!query) return 0;
    return window.appState.searchIndex.filter(item => item.layer === layerKey && item.normalizedText.includes(query)).length;
}

function setupSearchFilter() {
    const searchInput = document.getElementById("global-search");
    const filterBtn = document.getElementById("filter-btn");

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
