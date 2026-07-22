window.initMindMap = function() {
    if (window.appState.cy) {
        window.appState.cy.destroy();
    }

    const elements = generateGraphElements();

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
        layout: getLayoutOptions(false)
    });

    window.appState.cy = cy;

    // Interaction: show details on click
    cy.on('tap', 'node', function(evt){
        const node = evt.target;
        if (node.data('type') === 'entity') {
            document.getElementById('global-search').value = node.data('id');
            document.getElementById('filter-btn').click();
            document.querySelector('.tab-btn[data-target="table-view"]').click();
        }
    });

    // Handle Layer Highlighting
    document.getElementById('layer-navigator').addEventListener('click', (e) => {
        const li = e.target.closest('li');
        if (!li) return;

        // Extract layer key from the text (ignoring the span)
        const layerKey = li.childNodes[0].textContent.trim();

        // Un-dim all edges and nodes first
        cy.elements().removeClass('dimmed');
        cy.elements().style({
            'opacity': 1,
            'overlay-opacity': 0
        });

        if (layerKey) {
            // Find nodes matching this layer (either explicitly or via the string 'Unclassified Data')
            const selectedNodes = cy.nodes().filter(n => {
                const nodeLayerIdx = n.data('layer');
                const expectedIdx = window.appState.layers.indexOf(layerKey) + 1;
                // Since "Unclassified Data" might be layer index length, we just match by layer index
                return nodeLayerIdx === expectedIdx || layerKey === "Unclassified Data" && n.data('layerStr') === "Unclassified Data";
            });

            // Dim others
            if (selectedNodes.length > 0) {
                cy.elements().not(selectedNodes).not(selectedNodes.connectedEdges()).style('opacity', 0.2);
            }
        }
    });

    // Toggle layout event
    document.getElementById("toggle-layout").addEventListener("change", (e) => {
        const isSwimlane = e.target.checked;
        const layout = cy.layout(getLayoutOptions(isSwimlane));
        layout.run();
    });
};

function generateGraphElements() {
    const elements = { nodes: [], edges: [] };
    const structured = window.appState.structuredData;
    const layers = window.appState.layers;

    // To prevent duplicate nodes across layers
    const addedNodes = new Set();
    let terminalNodeIdCounter = 0;

    layers.forEach((layerKey, layerIndex) => {
        const entities = structured[layerKey];

        Object.keys(entities).forEach(entityName => {
            const cleanEntityId = String(entityName).trim();

            if (!addedNodes.has(cleanEntityId)) {
                elements.nodes.push({
                    data: {
                        id: cleanEntityId,
                        label: cleanEntityId,
                        type: 'entity',
                        layer: layerIndex + 1, // Used for concentric layout
                        layerStr: layerKey
                    }
                });
                addedNodes.add(cleanEntityId);
            }

            // Edges and Terminal Nodes
            const sheets = entities[entityName];
            Object.keys(sheets).forEach(sheetName => {
                const isMoneyTransfer = sheetName.toLowerCase().includes("money transfer");
                const rows = sheets[sheetName];

                rows.forEach(row => {
                    const amountCol = Object.keys(row).find(k => k.toLowerCase().includes("amount"));
                    const amount = amountCol ? row[amountCol] : "";

                    if (isMoneyTransfer) {
                        // Find receiver
                        const receiverCol = Object.keys(row).find(k => k.toLowerCase() === "account no" || k.toLowerCase().includes("to account"));
                        const receiverId = receiverCol ? String(row[receiverCol]).trim() : null;

                        if (receiverId) {
                            // Make sure receiver node exists
                            if (!addedNodes.has(receiverId)) {
                                elements.nodes.push({
                                    data: {
                                        id: receiverId,
                                        label: receiverId,
                                        type: 'entity',
                                        layer: layerIndex + 2, // Assuming it moves to next layer
                                        layerStr: layerKey
                                    }
                                });
                                addedNodes.add(receiverId);
                            }

                            elements.edges.push({
                                data: {
                                    source: cleanEntityId,
                                    target: receiverId,
                                    type: 'money_transfer',
                                    amount: formatAmount(amount)
                                }
                            });
                        }
                    } else {
                        // Terminal Node (ATM, POS, etc.)
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
                                amount: formatAmount(amount)
                            }
                        });
                    }
                });
            });
        });
    });

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
                // Outer rings for higher layers. Max layer at center? Or vice-versa.
                // Usually Layer 1 is center. So higher value = center in Cytoscape.
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

    // Convert to K/M for brief display on edges
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
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
