// Mind map and graph visualization logic using Cytoscape.js
window.initMindMap = function() {
    if (window.appState.cy) {
        window.appState.cy.destroy();
    }

    const totalTxns = window.appState.stats.transactions;
    const threshold = 500;
    const isOverThreshold = totalTxns > threshold;
    
    // Determine if we should aggregate
    const aggregateMode = isOverThreshold && !window.appState.forceFullGraph;

    // Render/Configure Performance Mode Banner
    const banner = document.getElementById("graph-perf-banner");
    if (banner) {
        if (isOverThreshold) {
            banner.style.display = "flex";
            if (aggregateMode) {
                banner.innerHTML = `
                    <span>⚡ <strong>Performance Mode Active:</strong> Similar terminal transactions and duplicate transfers are grouped (${totalTxns} total transactions).</span>
                    <button id="btn-force-full-graph">Show Full Graph</button>
                `;
                document.getElementById("btn-force-full-graph").addEventListener("click", () => {
                    window.appState.forceFullGraph = true;
                    window.initMindMap();
                });
            } else {
                banner.innerHTML = `
                    <span>🔍 <strong>Full Graph Mode Active:</strong> All ${totalTxns} transactions rendered. Layout calculation might take longer.</span>
                    <button id="btn-reset-perf-graph">Switch to Aggregated</button>
                `;
                document.getElementById("btn-reset-perf-graph").addEventListener("click", () => {
                    window.appState.forceFullGraph = false;
                    window.initMindMap();
                });
            }
        } else {
            banner.style.display = "none";
            banner.innerHTML = "";
        }
    }

    const elements = generateGraphElements(aggregateMode);

    const cy = cytoscape({
        container: document.getElementById('cy'),
        elements: elements,
        style: [
            {
                selector: 'node[type="entity"]',
                style: {
                    'background-color': '#3498db',
                    'label': 'data(label)',
                    'color': '#2c3e50',
                    'font-size': '12px',
                    'text-valign': 'bottom',
                    'text-halign': 'center',
                    'text-margin-y': '5px',
                    'width': '40px',
                    'height': '40px',
                    'border-width': 2,
                    'border-color': '#2980b9'
                }
            },
            {
                selector: 'node[type="terminal"]',
                style: {
                    'background-color': '#e74c3c',
                    'label': 'data(label)',
                    'color': '#c0392b',
                    'font-size': '10px',
                    'text-valign': 'center',
                    'text-halign': 'center',
                    'width': '25px',
                    'height': '25px',
                    'shape': 'diamond'
                }
            },
            {
                selector: 'edge',
                style: {
                    'width': 2,
                    'line-color': '#bdc3c7',
                    'target-arrow-color': '#bdc3c7',
                    'target-arrow-shape': 'triangle',
                    'curve-style': 'bezier',
                    'label': 'data(amount)',
                    'font-size': '8px',
                    'text-rotation': 'autorotate',
                    'text-margin-y': '-10px',
                    'color': '#7f8c8d'
                }
            },
            {
                selector: 'edge[type="money_transfer"]',
                style: {
                    'line-color': '#2ecc71',
                    'target-arrow-color': '#2ecc71',
                    'width': 3
                }
            }
        ],
        layout: getLayoutOptions(document.getElementById("toggle-layout")?.checked || false)
    });

    window.appState.cy = cy;

    // Interaction: show details on click
    cy.on('tap', 'node', function(evt){
        const node = evt.target;
        if (node.data('type') === 'entity') {
            document.getElementById('global-search').value = node.data('id');
            if (window.performSearch) {
                window.performSearch();
            }
            document.querySelector('.tab-btn[data-target="table-view"]').click();
        }
    });

    // Initial highlight for the active layer
    const activeLi = document.querySelector('#layer-navigator li.active');
    if (activeLi) {
        const layerKey = activeLi.childNodes[0].textContent.trim();
        window.highlightLayerInGraph(cy, layerKey);
    }
};

// Global helper to highlight/dim layers in Cytoscape
window.highlightLayerInGraph = function(cy, layerKey) {
    if (!cy) return;

    // Un-dim everything first
    cy.elements().style({
        'opacity': 1,
        'overlay-opacity': 0
    });

    if (layerKey) {
        const selectedNodes = cy.nodes().filter(n => {
            const nodeLayerIdx = n.data('layer');
            const expectedIdx = window.appState.layers.indexOf(layerKey) + 1;
            return nodeLayerIdx === expectedIdx || (layerKey === "Unclassified Data" && n.data('layerStr') === "Unclassified Data");
        });

        if (selectedNodes.length > 0) {
            // Strongly highlight selected nodes and their connected edges
            selectedNodes.style('opacity', 1);
            selectedNodes.connectedEdges().style('opacity', 1);
            
            // Dim everything else
            cy.elements().not(selectedNodes).not(selectedNodes.connectedEdges()).style('opacity', 0.15);
        }
    }
};

function generateGraphElements(aggregateMode) {
    const elements = { nodes: [], edges: [] };
    const structured = window.appState.structuredData;
    const layers = window.appState.layers;
    const query = window.lastSearchQuery || "";

    const addedNodes = new Set();
    let terminalNodeIdCounter = 0;

    // Aggregation maps
    const moneyTransferMap = new Map(); // key: source_to_target -> { amountSum, count }
    const terminalFlowMap = new Map();   // key: source_to_sheetName -> { amountSum, count, layerIndex, layerKey }

    layers.forEach((layerKey, layerIndex) => {
        const entities = structured[layerKey];

        Object.keys(entities).forEach(entityName => {
            const cleanEntityId = String(entityName).trim();
            const sheets = entities[entityName];

            Object.keys(sheets).forEach(sheetName => {
                const isMoneyTransfer = sheetName.toLowerCase().includes("money transfer");
                const rows = sheets[sheetName];

                rows.forEach(row => {
                    // Filter row by search query if active
                    if (query !== "") {
                        const rowStr = Object.values(row)
                            .filter(v => v !== null && v !== undefined)
                            .map(v => String(v).toLowerCase())
                            .join(" ");
                        if (!rowStr.includes(query)) return;
                    }

                    // Add sender node
                    if (!addedNodes.has(cleanEntityId)) {
                        elements.nodes.push({
                            data: {
                                id: cleanEntityId,
                                label: cleanEntityId,
                                type: 'entity',
                                layer: layerIndex + 1,
                                layerStr: layerKey
                            }
                        });
                        addedNodes.add(cleanEntityId);
                    }

                    const amountCol = Object.keys(row).find(k => k.toLowerCase().includes("amount"));
                    const amountVal = amountCol ? row[amountCol] : "";
                    const amountNum = parseAmount(amountVal);

                    if (isMoneyTransfer) {
                        const receiverCol = Object.keys(row).find(k => k.toLowerCase() === "account no" || k.toLowerCase().includes("to account"));
                        const receiverId = receiverCol ? String(row[receiverCol]).trim() : null;

                        if (receiverId) {
                            if (!addedNodes.has(receiverId)) {
                                elements.nodes.push({
                                    data: {
                                        id: receiverId,
                                        label: receiverId,
                                        type: 'entity',
                                        layer: layerIndex + 2,
                                        layerStr: layerKey
                                    }
                                });
                                addedNodes.add(receiverId);
                            }

                            if (aggregateMode) {
                                const edgeKey = `${cleanEntityId}_to_${receiverId}`;
                                if (!moneyTransferMap.has(edgeKey)) {
                                    moneyTransferMap.set(edgeKey, {
                                        source: cleanEntityId,
                                        target: receiverId,
                                        amountSum: 0,
                                        count: 0
                                    });
                                }
                                const item = moneyTransferMap.get(edgeKey);
                                item.amountSum += amountNum;
                                item.count += 1;
                            } else {
                                // Full mode: every transaction gets an edge
                                elements.edges.push({
                                    data: {
                                        source: cleanEntityId,
                                        target: receiverId,
                                        type: 'money_transfer',
                                        amount: formatAmount(amountNum)
                                    }
                                });
                            }
                        }
                    } else {
                        // Terminal flow
                        if (aggregateMode) {
                            const edgeKey = `${cleanEntityId}_to_${sheetName}`;
                            if (!terminalFlowMap.has(edgeKey)) {
                                terminalFlowMap.set(edgeKey, {
                                    source: cleanEntityId,
                                    sheetName: sheetName,
                                    amountSum: 0,
                                    count: 0,
                                    layerIndex: layerIndex,
                                    layerKey: layerKey
                                });
                            }
                            const item = terminalFlowMap.get(edgeKey);
                            item.amountSum += amountNum;
                            item.count += 1;
                        } else {
                            // Full mode: every transaction gets a separate node and edge
                            const termId = `term_${terminalNodeIdCounter++}`;
                            elements.nodes.push({
                                data: {
                                    id: termId,
                                    label: getShortLabel(sheetName),
                                    type: 'terminal',
                                    layer: layerIndex + 1,
                                    layerStr: layerKey
                                }
                            });
                            elements.edges.push({
                                data: {
                                    source: cleanEntityId,
                                    target: termId,
                                    type: 'terminal_flow',
                                    amount: formatAmount(amountNum)
                                }
                            });
                        }
                    }
                });
            });
        });
    });

    // Helper to parse amount
    function parseAmount(val) {
        if (!val) return 0;
        const num = parseFloat(String(val).replace(/,/g, ''));
        return isNaN(num) ? 0 : num;
    }

    // Map aggregated elements into output lists
    if (aggregateMode) {
        // 1. Add aggregated money transfers
        moneyTransferMap.forEach((data, edgeKey) => {
            elements.edges.push({
                data: {
                    id: edgeKey,
                    source: data.source,
                    target: data.target,
                    type: 'money_transfer',
                    amount: `${formatAmount(data.amountSum)} (${data.count} txns)`
                }
            });
        });

        // 2. Add aggregated terminal nodes and edges
        let terminalCounter = 0;
        terminalFlowMap.forEach((data, edgeKey) => {
            const termNodeId = `term_agg_${terminalCounter++}`;
            elements.nodes.push({
                data: {
                    id: termNodeId,
                    label: getShortLabel(data.sheetName),
                    type: 'terminal',
                    layer: data.layerIndex + 1,
                    layerStr: data.layerKey
                }
            });

            elements.edges.push({
                data: {
                    id: edgeKey,
                    source: data.source,
                    target: termNodeId,
                    type: 'terminal_flow',
                    amount: `${formatAmount(data.amountSum)} (${data.count} txns)`
                }
            });
        });
    }

    return elements;
}

function getLayoutOptions(isSwimlane) {
    if (isSwimlane) {
        return {
            name: 'breadthfirst',
            directed: true,
            padding: 10,
            spacingFactor: 1.5,
            roots: window.appState.cy ? window.appState.cy.nodes('[layer = 1]') : undefined
        };
    } else {
        return {
            name: 'concentric',
            concentric: function(node) {
                const maxLayer = window.appState.layers.length + 1;
                return maxLayer - (node.data('layer') || 1);
            },
            levelWidth: function(nodes) {
                return 1;
            },
            padding: 30,
            spacingFactor: 1.2
        };
    }
}

function formatAmount(val) {
    if (!val) return "";
    const num = parseFloat(String(val).replace(/,/g, ''));
    if (isNaN(num)) return val;

    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toFixed(2);
}

function getShortLabel(sheetName) {
    const lower = sheetName.toLowerCase();
    if (lower.includes("atm")) return "ATM";
    if (lower.includes("pos")) return "POS";
    if (lower.includes("cheque")) return "CHQ";
    if (lower.includes("aeps")) return "AEPS";
    if (lower.includes("hold")) return "HOLD";
    return "TXN";
}

// Single DOMContentLoaded listener to avoid memory leak of multiple event handler attachments
document.addEventListener("DOMContentLoaded", () => {
    const layoutToggle = document.getElementById("toggle-layout");
    if (layoutToggle) {
        layoutToggle.addEventListener("change", (e) => {
            if (window.appState.cy) {
                const isSwimlane = e.target.checked;
                const layout = window.appState.cy.layout(getLayoutOptions(isSwimlane));
                layout.run();
            }
        });
    }
});
