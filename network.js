// Handles vis-network setup, node/edge creation, and event handling
// Exports: setupNetwork()
import { setupEdgeToolbar } from './edgeToolbar.js';
import { setupNodeOverlays } from './nodeOverlays.js';
import { getColorHex, DEFAULT_COLOR } from './colors.js';

const SELECTED_WIDTH = 400;
const SELECTED_HEIGHT = Math.round(SELECTED_WIDTH * 1.414); // A4 aspect ratio
const DEFAULT_WIDTH = 240;
const DEFAULT_HEIGHT = 30; // vis-network default
const DEFAULT_LENGTH = 400;
const SELECTED_LENGTH = 600;

// Notes editing mode dimensions
const NOTES_MODE = {
    WIDTH: 1400,
    HEIGHT: Math.round(SELECTED_WIDTH * 1.414), // Landscape aspect ratio (2:1)
    SCREEN_WIDTH_PERCENT: 90,
    SCREEN_HEIGHT_VH: 80,
    TOP_OFFSET: 80
};

// Spacing / physics tuning constants (used for both physics and hierarchical modes)
const DEFAULT_NODE_DISTANCE = 220;
const DEFAULT_SPRING_LENGTH = 110;
const DEFAULT_SPRING_CONSTANT = 0.02;

const HIER_DEFAULT_NODE_SPACING = DEFAULT_WIDTH + 40;
const HIER_DEFAULT_LEVEL_SEPARATION = 2 * DEFAULT_HEIGHT + 60;

const DEFAULT_GRAVITATIONAL_CONSTANT = -1; // negative for repulsion
const DEFAULT_CENTRAL_GRAVITY = 0.0001; // remove central attraction
const DEFAULT_DAMPING = 0.4; // add damping to reduce oscillation

export function setupNetwork() {
	const nodes = new vis.DataSet([]);
	const edges = new vis.DataSet([]);
	const data = { nodes, edges };
	const container = document.getElementById('network');

	const options = {
		physics: {
			enabled: true,
			solver: 'forceAtlas2Based',
			stabilization: { iterations: 200 },
			forceAtlas2Based: {
				avoidOverlap: 1,
				springLength: DEFAULT_SPRING_LENGTH,
				springConstant: DEFAULT_SPRING_CONSTANT,
				gravitationalConstant: DEFAULT_GRAVITATIONAL_CONSTANT, // negative for repulsion instead of attraction
				centralGravity: DEFAULT_CENTRAL_GRAVITY, // remove central attraction
				damping: DEFAULT_DAMPING // add damping to reduce oscillation
			}
		},
		layout: {},
		nodes: {
			shape: 'box',
			margin: 10,
			widthConstraint: { minimum: DEFAULT_WIDTH, maximum: DEFAULT_WIDTH },
			heightConstraint: { minimum: DEFAULT_HEIGHT },
			font: { multi: 'html' },
			// Make canvas node visuals transparent; overlays will render the card on top
			color: {
				background: 'rgba(0,0,0,0)',
				highlight: { background: 'rgba(0,0,0,0)', border: 'rgba(0,0,0,0)' },
				hover: { background: 'rgba(0,0,0,0)', border: 'rgba(0,0,0,0)' }
			}
		},
		edges: {
			arrows: { to: { enabled: true, scaleFactor: 1 } },
			smooth: { enabled: true, type: 'cubicBezier' }
		},
		interaction: { hover: true, multiselect: false, navigationButtons: true }
	};

	const network = new vis.Network(container, data, options);
	// Track current layout mode to avoid accidental switches during select/deselect
	network.__layoutMode = 'physics';

	// Helper to switch spacing values when a node is selected/deselected,
	// without toggling the current layout mode.
	function applySpacing(selected) {
		if (network.__layoutMode === 'physics') {
			// physics tuning with overlap avoidance based on node size
			network.setOptions({
				physics: {
					enabled: true,
					solver: 'forceAtlas2Based',
					forceAtlas2Based: {
						avoidOverlap: 1,
						springLength: DEFAULT_SPRING_LENGTH,
						springConstant: DEFAULT_SPRING_CONSTANT,
						gravitationalConstant: DEFAULT_GRAVITATIONAL_CONSTANT, // negative for repulsion
						centralGravity: DEFAULT_CENTRAL_GRAVITY, // remove central attraction
						damping: DEFAULT_DAMPING // add damping
					}
				}
			});
			if (network.stabilize) network.stabilize();
		} else if (network.__layoutMode === 'hierarchical') {
			// hierarchical layout spacing
			network.setOptions({
				layout: {
					hierarchical: {
						nodeSpacing: HIER_DEFAULT_NODE_SPACING,
						levelSeparation: HIER_DEFAULT_LEVEL_SEPARATION
					}
				}
			});
			if (network.redraw) network.redraw();
		}
	}

	// Expose spacing helper so toolbar can apply immediately on layout switch
	window._applySpacing = (selected = false) => applySpacing(selected);
	let lastSelectedNodes = [];
	
	// Debounced auto-save to prevent infinite loops during position restoration
	let saveTimeout = null;
	network.on('dragEnd', function (params) {
		if (params.nodes && params.nodes.length > 0 && !window._restoringPositions) {
			// Clear any existing timeout
			if (saveTimeout) clearTimeout(saveTimeout);
			// Set a new timeout to save after user stops dragging
			saveTimeout = setTimeout(() => {
				saveToStorage();
				saveTimeout = null;
			}, 500); // Wait 500ms after last drag to save
		}
	});
	
	network.on('selectNode', function (params) {
		lastSelectedNodes = params.nodes.slice();
		
		// Resize selected nodes but don't affect physics
		params.nodes.forEach(nodeId => {
			nodes.update({
				id: nodeId,
				widthConstraint: { minimum: SELECTED_WIDTH, maximum: SELECTED_WIDTH },
				heightConstraint: { minimum: SELECTED_HEIGHT },
				font: { size: 16 }
			});
		});

		// After the node is resized, zoom and center selection to ~70% of viewport
		const focusSelection = () => {
			try {
				if (!params.nodes || !params.nodes.length) return;
				const ids = params.nodes;
				// Compute union bounding box in canvas coords
				let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
				ids.forEach(id => {
					const bb = network.getBoundingBox(id);
					if (!bb) return;
					left = Math.min(left, bb.left);
					right = Math.max(right, bb.right);
					top = Math.min(top, bb.top);
					bottom = Math.max(bottom, bb.bottom);
				});
				if (!isFinite(left) || !isFinite(right) || !isFinite(top) || !isFinite(bottom)) return;

				const width = Math.max(1, right - left);
				const height = Math.max(1, bottom - top);
				const centerX = (left + right) / 2;
				const centerY = (top + bottom) / 2;
				const cont = network.body && network.body.container ? network.body.container : document.getElementById('network');
				const cw = (cont && cont.clientWidth) ? cont.clientWidth : window.innerWidth || 800;
				const ch = (cont && cont.clientHeight) ? cont.clientHeight : window.innerHeight || 600;
				// target up to 70% of viewport in both directions
				const targetRatio = 0.7;
				let targetScale = Math.min((targetRatio * cw) / width, (targetRatio * ch) / height);
				// clamp scale to reasonable bounds
				targetScale = Math.max(0.2, Math.min(3, targetScale));

				network.moveTo({
					position: { x: centerX, y: centerY },
					scale: targetScale,
					animation: { duration: 500, easingFunction: 'easeInOutQuad' }
				});
			} catch { /* no-op */ }
		};
		if (typeof network.once === 'function') {
			network.once('afterDrawing', focusSelection);
		} else if (typeof network.on === 'function' && typeof network.off === 'function') {
			const handler = () => { try { focusSelection(); } finally { network.off('afterDrawing', handler); } };
			network.on('afterDrawing', handler);
		} else {
			// fallback: queue microtask
			setTimeout(focusSelection, 0);
		}
	});
	network.on('deselectNode', function (params) {
		// Restore previous nodes to default size (only if they still exist)
		lastSelectedNodes.forEach(nodeId => {
			// Check if node still exists before updating
			if (nodes.get(nodeId)) {
				nodes.update({
					id: nodeId,
					widthConstraint: { minimum: DEFAULT_WIDTH, maximum: DEFAULT_WIDTH },
					heightConstraint: { minimum: DEFAULT_HEIGHT },
					font: { size: 16 }
				});
			}
		});
		lastSelectedNodes = [];
	});

	function addOrGetPaper({ title, nickname, authors, doi, link, type, notes, year, citations }) {
		// Remove HTML tags
		const stripHtmlTags = str => (!str ? '' : str.replace(/<[^>]*>/g, ''));
		title = stripHtmlTags(title);
		nickname = stripHtmlTags(nickname || '');
		authors = stripHtmlTags(authors || '');
		doi = stripHtmlTags(doi || '');
		link = stripHtmlTags(link || '');
		type = stripHtmlTags(type || 'paper');
		// Find node by title
		const findNodeByTitle = title => {
			if (!title) return null;
			const t = title.trim().toLowerCase();
			if (!t) return null;
			const found = nodes.get().find(n => (n.title || '').trim().toLowerCase() === t);
			return found || null;
		};
		const existing = findNodeByTitle(title);
		if (existing) {
			// optionally update metadata
			if (nickname) existing.nickname = nickname;
			if (authors) existing.authors = authors;
			if (doi) existing.doi = doi;
			if (link) existing.link = link;
			if (type) existing.type = type;
			if (notes) existing.notes = notes;
			if (year) existing.year = year;
			if (citations) existing.citations = citations;
			const escapeHtml = s => (!s ? '' : s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'));
			const formatLabel = node => {
				const authors = node.authors ? `\n${escapeHtml(node.authors)}` : '';
				return `${escapeHtml(node.title)}${authors}`;
			};
			nodes.update({ ...existing, label: formatLabel(existing) });
			return existing;
		}
		// Generate next id
		const nextId = () => {
			let all = nodes.getIds();
			let id = 1;
			while (all.includes(id)) id++;
			return id;
		};
		const escapeHtml = s => (!s ? '' : s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'));
		const formatLabel = node => {
			const authors = node.authors ? `\n${escapeHtml(node.authors)}` : '';
			return `${escapeHtml(node.title)}${authors}`;
		};
		const id = nextId();
		const node = { 
			id, 
			title: title, 
			nickname: nickname,
			authors: authors, 
			doi: doi,
			link: link,
			type: type,
			notes,
			year,
			citations,
			colorId: DEFAULT_COLOR, // Default color for new nodes
			label: formatLabel({ title, authors }), 
			shape: 'box',
			color: {
				background: getColorHex(DEFAULT_COLOR),
				border: getColorHex(DEFAULT_COLOR),
				highlight: {
					background: getColorHex(DEFAULT_COLOR),
					border: getColorHex(DEFAULT_COLOR)
				},
				hover: {
					background: getColorHex(DEFAULT_COLOR),
					border: getColorHex(DEFAULT_COLOR)
				}
			}
		};
		nodes.add(node);
		network.focus(id, { scale: 1.2, animation: true });
		return node;
	}

	function saveToStorage() {
		const data = { nodes: nodes.get(), edges: edges.get() };
		
		// Get current node positions and add them to the data
		try {
			const positions = network.getPositions();
			data.nodes.forEach(node => {
				const pos = positions[node.id];
				if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
					node.x = pos.x;
					node.y = pos.y;
				}
			});
		} catch (e) {
			console.error('Failed to save node positions', e);
		}
		
		// Attempt to persist graph to localStorage; if quota is exceeded, warn but do not block
		try {
			localStorage.setItem('paper-web-data-v1', JSON.stringify(data));
		} catch (e) {
			const isQuota = e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
			if (isQuota) {
				console.warn('[Storage] Local storage quota exceeded. Recent changes may not be saved. Please export a ZIP for a full backup.');
				// Persist a flag (best-effort) and show a non-blocking warning
				try { localStorage.setItem('paper-web-storage-exceeded', 'true'); } catch {}
				if (typeof window._setStorageExceededFlag === 'function') {
					try { window._setStorageExceededFlag(true); } catch {}
				}
				if (typeof window._notifyStorageQuotaExceeded === 'function') {
					try { window._notifyStorageQuotaExceeded(); } catch {}
				}
			} else {
				console.error('Failed to save to localStorage', e);
			}
		}
		// Note: Assets are now automatically saved to IndexedDB when registered (see toolbar.js)
	}

	// Function to change node color
	function changeNodeColor(nodeId, colorId) {
		console.log('changeNodeColor called:', nodeId, colorId);
		const node = nodes.get(nodeId);
		if (!node) {
			console.log('Node not found:', nodeId);
			return;
		}
		
		const colorHex = getColorHex(colorId);
		console.log('Color hex:', colorHex);
		nodes.update({
			id: nodeId,
			colorId: colorId, // Store the color ID
			color: {
				background: colorHex,
				border: colorHex,
				highlight: {
					background: colorHex,
					border: colorHex
				},
				hover: {
					background: colorHex,
					border: colorHex
				}
			}
		});
		console.log('Node updated with color');
		
		saveToStorage();
	}

	// Expose for toolbar.js and overlays
	window._addOrGetPaper = addOrGetPaper;
	window._saveToStorage = saveToStorage;
	window._changeNodeColor = changeNodeColor;
	window._setupNodeOverlays = () => setupNodeOverlays(network, nodes, edges);

	setupEdgeToolbar(network, nodes, edges);
	// Replace labels with overlays
	nodes.update(nodes.get().map(n => ({ id: n.id, label: '' })));
	setupNodeOverlays(network, nodes, edges);

	// Enforce default visuals for any nodes as they are added (including during loadFromStorage)
	nodes.on('add', (e) => {
		if (e && Array.isArray(e.items) && e.items.length) {
			const updates = e.items.map((id) => {
				const node = nodes.get(id);
				const colorId = node.colorId || DEFAULT_COLOR;
				const colorHex = getColorHex(colorId);
				
				return {
					id,
					widthConstraint: { minimum: DEFAULT_WIDTH, maximum: DEFAULT_WIDTH },
					heightConstraint: { minimum: DEFAULT_HEIGHT },
					font: { size: 16 },
					colorId: colorId,
					color: {
						background: colorHex,
						border: colorHex,
						highlight: {
							background: colorHex,
							border: colorHex
						},
						hover: {
							background: colorHex,
							border: colorHex
						}
					}
				};
			});
			nodes.update(updates);
		}
	});

	// Ensure starting state: default spacing, and no selections (toolbar hidden)
	try { applySpacing(false); } catch {}
	if (typeof network.unselectAll === 'function') network.unselectAll();

		// One-time initial reset after first render to guarantee defaults
		let initialResetDone = false;
		const initialReset = () => {
			if (initialResetDone) return; // Prevent multiple executions
			initialResetDone = true;
			
			try {
				// Reset all nodes to default constraints and font
				const nodeUpdates = nodes.get().map(n => ({
					id: n.id,
					widthConstraint: { minimum: DEFAULT_WIDTH, maximum: DEFAULT_WIDTH },
					heightConstraint: { minimum: DEFAULT_HEIGHT },
					font: { size: 16 }
				}));
				if (nodeUpdates.length) nodes.update(nodeUpdates);

				// Apply default spacing (without unselect to avoid infinite loop)
				try { applySpacing(false); } catch {}

				// Ensure overlay toolbars are hidden
				const cont = document.getElementById('nodeOverlayContainer');
				if (cont) cont.querySelectorAll('.node-overlay.is-selected').forEach(el => el.classList.remove('is-selected'));
			} finally {
				// Remove the event listener to prevent further calls
				if (typeof network.off === 'function') network.off('afterDrawing', initialReset);
			}
		};
		if (typeof network.on === 'function') network.on('afterDrawing', initialReset);

	return { network, nodes, edges, NOTES_MODE };
}
