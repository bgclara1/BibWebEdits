// Per-node floating overlays that mirror node size/position and host title + toolbar
import { NotesEditor } from './notesEditor.js';
import { NODE_COLORS, getColorHex, getTextColor, DEFAULT_COLOR } from './colors.js';

export function setupNodeOverlays(network, nodes, edges) {
  const overlayMap = new Map(); // nodeId -> HTMLElement
  const notesEditor = new NotesEditor();

  // Container inside the network element to ensure correct coordinate space
  const host = (network && network.body && network.body.container) ? network.body.container : document.getElementById('network');
  let container = document.getElementById('nodeOverlayContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'nodeOverlayContainer';
    container.style.position = 'absolute';
    container.style.left = '0';
    container.style.top = '0';
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.pointerEvents = 'none'; // let canvas interactions pass through by default
    container.style.zIndex = '5';
    container.style.setProperty('--zoom-scale', String(network.getScale ? network.getScale() : 1));
    if (host) host.appendChild(container);
    else document.body.appendChild(container);
  }

  function createViewerContent(node) {
    if (!node.link) {
      return 'paper'; // Default placeholder text
    }

    // Check if this is a session asset link (assets/<filename>)
    let actualLink = node.link;
    if (node.link.startsWith('assets/')) {
      const filename = node.link.substring(7); // Remove 'assets/' prefix
      if (typeof window._getSessionAssetBlob === 'function') {
        const blob = window._getSessionAssetBlob(filename);
        if (blob) {
          // Create a Blob URL for this session asset
          actualLink = URL.createObjectURL(blob);
        }
      }
    }

    if (node.type === 'video' && isYouTubeUrl(actualLink)) {
      const videoId = extractYouTubeId(actualLink);
      if (videoId) {
        return `<iframe 
          src="https://www.youtube.com/embed/${videoId}" 
          width="100%" 
          height="120" 
          frameborder="0" 
          allowfullscreen>
        </iframe>`;
      }
    } else if ((node.type === 'paper-url' || node.type === 'paper-file' || node.type === 'paper') && isPdfUrl(actualLink)) {
      return `<iframe 
        src="${escapeHtml(actualLink)}#toolbar=0&navpanes=0&scrollbar=0&view=FitH" 
        width="100%" 
        height="120" 
        frameborder="0">
      </iframe>`;
    }
    
    // Fallback: show a link
    return `<a href="${escapeHtml(actualLink)}" target="_blank" style="color: #2B7CE9; text-decoration: none;">
      ${node.type === 'video' ? '📹 View Video' : '📄 View Paper'}
    </a>`;
  }

  function isYouTubeUrl(url) {
    return /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)/.test(url);
  }

  function extractYouTubeId(url) {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/);
    return match ? match[1] : null;
  }

  function isPdfUrl(url) {
    return /\.pdf$/i.test(url) || url.includes('pdf') || url.startsWith('blob:');
  }

  function createOverlay(node) {
    const el = document.createElement('div');
    el.className = 'node-overlay';
    el.dataset.nodeId = String(node.id);
    el.style.position = 'absolute';
    el.style.pointerEvents = 'none'; // default off; enable only on toolbar
    
    // Create viewer content based on node type and link
    const viewerContent = createViewerContent(node);
    
    el.innerHTML = `
        <div class="node-overlay__card">
          <button class="node-overlay__title" title="Edit" style="width: 100%; text-align: left; background: none; border: none; padding: calc(8px * var(--zoom-scale,1)) calc(12px * var(--zoom-scale,1)); cursor: pointer; pointer-events: none;" onmouseover="if(this.closest('.node-overlay').classList.contains('is-selected')) this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">
            <div class="node-overlay__titleText">${escapeHtml(node.nickname || node.title || '')}</div>
            ${node.authors ? `<div class="node-overlay__authors">${escapeHtml(node.authors)}</div>` : ''}
          </button>
          <div class="node-overlay__spacer">
            <div class="node-overlay__content">
              <div class="viewer-container">${viewerContent}</div>
              <div class="notes-section"></div>
            </div>
          </div>
          <div class="node-overlay__toolbar">
          <button class="btn-edit" title="Edit notes">✏️</button>
          <button class="btn-del" title="Delete">🗑️</button>
        </div>
      </div>
    `;
    
    // Add notes editor to the notes section
    const notesSection = el.querySelector('.notes-section');
    const notesContainer = notesEditor.createNotesContainer(node.id, node.notes || '', 'preview');
    notesSection.appendChild(notesContainer);
  // Toolbar needs pointer events
  const toolbar = el.querySelector('.node-overlay__toolbar');
  toolbar.style.pointerEvents = 'auto';
  
  // Title button needs pointer events and edit functionality (only when selected)
  const titleButton = el.querySelector('.node-overlay__title');
  
  // Function to update title button state based on selection
  const updateTitleButtonState = () => {
    const isSelected = el.classList.contains('is-selected');
    if (isSelected) {
      titleButton.style.pointerEvents = 'auto';
      titleButton.style.cursor = 'pointer';
    } else {
      titleButton.style.pointerEvents = 'none';
      titleButton.style.cursor = 'default';
      titleButton.style.textDecoration = 'none';
    }
  };
  
  // Initial state
  updateTitleButtonState();
  
  // Update state when selection changes (we'll need to call this from selection logic)
  el._updateTitleButtonState = updateTitleButtonState;
  
  titleButton.addEventListener('click', (e) => {
    e.stopPropagation();
    // Only work if selected
    if (!el.classList.contains('is-selected')) return;
    
    const n = nodes.get(node.id);
    
    if (window._showPaperForm) {
      window._showPaperForm('edit', n, (formData) => {
        n.title = formData.title;
        n.nickname = formData.nickname;
        n.authors = formData.authors;
        n.doi = formData.doi;
        n.link = formData.link;
        n.notes = formData.notes;
        n.type = formData.type;
        n.year = formData.year;
        n.citations = formData.citations;
        n.label = '';
        nodes.update(n);
        
        // update overlay title/authors now
        const titleEl = el.querySelector('.node-overlay__title');
        const titleTextEl = titleEl.querySelector('.node-overlay__titleText');
        const authorsEl = titleEl.querySelector('.node-overlay__authors');
        
        titleTextEl.textContent = n.title || '';
        titleEl.title = n.title || '';
        
        if (authorsEl) {
          if (n.authors) {
            authorsEl.textContent = n.authors;
            authorsEl.style.display = '';
          } else {
            authorsEl.style.display = 'none';
          }
        } else if (n.authors) {
          const newAuthorsEl = document.createElement('div');
          newAuthorsEl.className = 'node-overlay__authors';
          newAuthorsEl.textContent = n.authors;
          titleEl.appendChild(newAuthorsEl);
        }
        
        // Re-create viewer content if type/link changed
        const viewerContainer = el.querySelector('.viewer-container');
        if (viewerContainer) {
          viewerContainer.innerHTML = createViewerContent(n);
        }
      });
    }
  });
  // hide toolbar by default; it will be shown when the node is selected
  // visibility is primarily controlled by CSS class .is-selected

    // Wire actions
    // Floating lock button (will be positioned top-right)
  const lockFloatBtn = document.createElement('button');
    lockFloatBtn.className = 'node-overlay__btnLockFloating';
    lockFloatBtn.style.pointerEvents = 'auto';
    const setLockUI = (locked) => {
      lockFloatBtn.textContent = locked ? '🔒' : '🔓';
      lockFloatBtn.title = locked ? 'Unlock (allow physics to move this node)' : 'Lock position (physics won’t move this node)';
      if (locked) el.classList.add('is-locked'); else el.classList.remove('is-locked');
    };
    lockFloatBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const n = nodes.get(node.id);
      const isLocked = n && n.physics === false;
      nodes.update({ id: node.id, physics: isLocked ? true : false });
      // update visual state
      const nowLocked = !isLocked;
      setLockUI(nowLocked);
      if (typeof window._saveToStorage === 'function') window._saveToStorage();
    });
  // initialize floating lock to current state
    const initLocked = (nodes.get(node.id) || {}).physics === false;
    setLockUI(initLocked);
    
    // Floating color picker button (top-left)
    const colorFloatBtn = document.createElement('button');
    colorFloatBtn.className = 'node-overlay__btnColorFloating';
    colorFloatBtn.style.pointerEvents = 'auto';
    colorFloatBtn.textContent = '🎨';
    colorFloatBtn.title = 'Change color';
    
    // Create color dropdown
    const colorDropdown = document.createElement('div');
    colorDropdown.className = 'node-overlay__colorDropdown';
    colorDropdown.style.pointerEvents = 'auto';
    colorDropdown.style.display = 'none';
    
    NODE_COLORS.forEach(color => {
      const colorOption = document.createElement('button');
      colorOption.className = 'node-overlay__colorOption';
      colorOption.style.backgroundColor = color.hex;
      colorOption.title = color.name;
      colorOption.dataset.colorId = color.id;
      
      colorOption.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof window._changeNodeColor === 'function') {
          window._changeNodeColor(node.id, color.id);
          
          // Update the overlay card color immediately
          const card = el.querySelector('.node-overlay__card');
          const colorHex = getColorHex(color.id);
          const textColor = getTextColor(color.id);
          card.style.backgroundColor = colorHex;
          card.style.borderColor = colorHex;
          card.style.color = textColor;
        }
        colorDropdown.style.display = 'none';
      });
      
      colorDropdown.appendChild(colorOption);
    });
    
    colorFloatBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = colorDropdown.style.display === 'block';
      colorDropdown.style.display = isVisible ? 'none' : 'block';
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!colorFloatBtn.contains(e.target) && !colorDropdown.contains(e.target)) {
        colorDropdown.style.display = 'none';
      }
    });
    
    // Floating add button (bottom-center)
    const addFloatBtn = document.createElement('button');
    addFloatBtn.className = 'node-overlay__btnAddFloating';
    addFloatBtn.style.pointerEvents = 'auto';
    addFloatBtn.textContent = '➕';
    addFloatBtn.title = 'Add referenced paper';
    addFloatBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const currentNodeId = node.id;
      
      if (window._showPaperForm) {
        window._showPaperForm('add', {}, (formData) => {
          const stripHtmlTags = str => (!str ? '' : str.replace(/<[^>]*>/g, ''));
          const findNodeByTitle = t => {
            if (!t) return null;
            const tt = t.trim().toLowerCase();
            if (!tt) return null;
            const found = nodes.get().find(n => (n.title || '').trim().toLowerCase() === tt);
            return found || null;
          };
          
          let target;
          const existing = findNodeByTitle(formData.title);
          if (existing) {
            target = existing;
          } else {
            const nextId = () => {
              let all = nodes.getIds();
              let id = 1;
              while (all.includes(id)) id++;
              return id;
            };
            target = {
              id: nextId(),
              title: formData.title,
              nickname: formData.nickname,
              authors: formData.authors,
              doi: formData.doi,
              link: formData.link,
              notes: formData.notes,
              type: formData.type,
              year: formData.year,
              citations: formData.citations,
              label: '',
              shape: 'box'
            };
            nodes.add(target);
            network.focus(target.id, { scale: 1.2, animation: true });
          }
          
          // create directed edge from current -> target unless exists
          const existsEdge = edges.get().find(e => e.from === node.id && e.to === target.id);
          if (!existsEdge) {
            edges.add({ from: node.id, to: target.id });
          } else {
            alert('This reference already exists.');
          }
          if (typeof window._saveToStorage === 'function') window._saveToStorage();
        });
      } else {
        // Fallback to old prompt method
        const title = prompt('Referenced paper title (required):');
        if (!title || !title.trim()) return;
        const stripHtmlTags = str => (!str ? '' : str.replace(/<[^>]*>/g, ''));
        const findNodeByTitle = t => {
          if (!t) return null;
          const tt = t.trim().toLowerCase();
          if (!tt) return null;
          const found = nodes.get().find(n => (n.title || '').trim().toLowerCase() === tt);
          return found || null;
        };
        let target;
        const existing = findNodeByTitle(title);
        if (existing) {
          target = existing;
        } else {
          const authors = prompt('Authors for referenced paper (optional):') || '';
          const nextId = () => {
            let all = nodes.getIds();
            let id = 1;
            while (all.includes(id)) id++;
            return id;
          };
          target = {
            id: nextId(),
            title: stripHtmlTags(title.trim()),
            authors: stripHtmlTags(authors.trim()),
            label: '',
            shape: 'box'
          };
          nodes.add(target);
          network.focus(target.id, { scale: 1.2, animation: true });
        }
        // create directed edge from current -> target unless exists
        const existsEdge = edges.get().find(e => e.from === node.id && e.to === target.id);
        if (!existsEdge) {
          edges.add({ from: node.id, to: target.id });
        } else {
          alert('This reference already exists.');
        }
        if (typeof window._saveToStorage === 'function') window._saveToStorage();
      }
    });

    const card = el.querySelector('.node-overlay__card');
    
    // Set card background color based on node's color
    const nodeColorId = node.colorId || DEFAULT_COLOR;
    const colorHex = getColorHex(nodeColorId);
    const textColor = getTextColor(nodeColorId);
    card.style.backgroundColor = colorHex;
    card.style.borderColor = colorHex;
    card.style.color = textColor;
    
    card.appendChild(lockFloatBtn);
    card.appendChild(addFloatBtn);
    card.appendChild(colorFloatBtn);
    card.appendChild(colorDropdown);
  // removed bottom-toolbar add handler (using floating add instead)
    toolbar.querySelector('.btn-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      // Switch to notes editing mode (fullscreen editor)
      if (window._switchToNotesMode) {
        window._switchToNotesMode(node.id);
      }
    });

    toolbar.querySelector('.btn-del').addEventListener('click', (e) => {
      e.stopPropagation();
      const n = nodes.get(node.id);
      if (!confirm(`Delete "${n.title}"? This removes the node and its edges.`)) return;
      nodes.remove(node.id);
      const remEdges = edges.get().filter(e => e.from === node.id || e.to === node.id).map(e => e.id).filter(Boolean);
      if (remEdges.length) edges.remove(remEdges);
      removeOverlay(node.id);
      if (typeof window._saveToStorage === 'function') window._saveToStorage();
    });

    container.appendChild(el);
    overlayMap.set(node.id, el);
    return el;
  }

  function removeOverlay(nodeId) {
    const el = overlayMap.get(nodeId);
    if (el && el.parentElement) el.parentElement.removeChild(el);
    overlayMap.delete(nodeId);
    // Clean up notes editor
    notesEditor.cleanup(nodeId);
  }

  function ensureOverlaysForAllNodes() {
    const ids = nodes.getIds();
    // create missing
    ids.forEach(id => {
      if (!overlayMap.has(id)) createOverlay(nodes.get(id));
    });
    // remove stale
    Array.from(overlayMap.keys()).forEach(id => {
      if (!ids.includes(id)) removeOverlay(id);
    });
  }

  function updatePositions() {
    // Reposition/resize overlays to match bounding boxes
  overlayMap.forEach((el, id) => {
  const bb = network.getBoundingBox(id);
  if (!bb) return;
  const center = network.getPositions([id])[id];
  const widthCanvas = bb.right - bb.left;
  const heightCanvas = bb.bottom - bb.top;
  const halfW = widthCanvas / 2;
  const halfH = heightCanvas / 2;
  const tlDom = network.canvasToDOM({ x: center.x - halfW, y: center.y - halfH });
  const brDom = network.canvasToDOM({ x: center.x + halfW, y: center.y + halfH });
  const width = Math.max(0, brDom.x - tlDom.x);
  const height = Math.max(0, brDom.y - tlDom.y);

  // First set size
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;

  // Then align by DOM center using the actual rendered size to avoid rounding drift
  const centerDom = network.canvasToDOM({ x: center.x, y: center.y });
  const ow = el.offsetWidth || width;
  const oh = el.offsetHeight || height;
  el.style.left = `${Math.round(centerDom.x - ow / 2)}px`;
  el.style.top = `${Math.round(centerDom.y - oh / 2)}px`;

  // Set z-index so nodes higher up the hierarchy (smaller y) draw above lower ones.
  // Selected nodes always on top.
  const isSelected = el.classList.contains('is-selected');
  const z = isSelected ? 2000000000 : Math.round(1000000 - center.y);
  el.style.zIndex = String(z);
    });
  }

  // Initial set
  ensureOverlaysForAllNodes();
  updatePositions();

  // Keep overlays in sync with node dataset
  nodes.on('add', () => { ensureOverlaysForAllNodes(); updatePositions(); });
  nodes.on('update', (e, _props) => {
    // update titles/authors in overlays if changed
    if (e && e.items) {
      e.items.forEach(id => {
        const el = overlayMap.get(id);
        if (!el) return;
        const n = nodes.get(id);
        const titleEl = el.querySelector('.node-overlay__title');
        const titleTextEl = el.querySelector('.node-overlay__titleText');
        const authorsEl = el.querySelector('.node-overlay__authors');
  const lockFloatBtn = el.querySelector('.node-overlay__btnLockFloating');
        if (titleEl && n) {
          titleEl.setAttribute('title', escapeHtml(n.title || ''));
          if (titleTextEl) titleTextEl.textContent = n.title || '';
          if (authorsEl) {
            if (n.authors) { authorsEl.textContent = n.authors; }
            else { authorsEl.remove(); }
          } else if (n.authors) {
            const a = document.createElement('div');
            a.className = 'node-overlay__authors';
            a.textContent = n.authors;
            titleEl.appendChild(a);
          }
          const locked = n.physics === false;
          if (lockFloatBtn) {
            lockFloatBtn.textContent = locked ? '🔒' : '🔓';
            lockFloatBtn.title = locked ? 'Unlock (allow physics to move this node)' : "Lock position (physics won't move this node)";
          }
          if (locked) el.classList.add('is-locked'); else el.classList.remove('is-locked');
        }
      });
    }
    updatePositions();
  });
  nodes.on('remove', (e) => {
    if (e && e.items) e.items.forEach(removeOverlay);
  });

  // Reposition overlays when the network draws/changes
  const reposition = () => {
    updatePositions();
  };
  function updateZoomVar() {
    const s = network.getScale ? network.getScale() : 1;
    container.style.setProperty('--zoom-scale', String(s));
    
    // Also update zoom scale for any notes-mode overlays
    const notesModeOverlays = container.querySelectorAll('.node-overlay.notes-mode');
    notesModeOverlays.forEach(overlay => {
      overlay.style.setProperty('--zoom-scale', String(s));
    });
  }
  network.on('afterDrawing', () => { reposition(); updateZoomVar(); });
  network.on('dragEnd', reposition);
  network.on('zoom', () => { reposition(); updateZoomVar(); });
  network.on('resize', () => { reposition(); updateZoomVar(); });

  // Selection handling: show toolbar only for selected nodes
  function hideAllToolbars() {
    overlayMap.forEach((el) => {
      el.classList.remove('is-selected');
      // Update title button state when deselected
      if (el._updateTitleButtonState) el._updateTitleButtonState();
    });
  }
  network.on('selectNode', (params) => {
    hideAllToolbars();
    if (params && Array.isArray(params.nodes)) {
      params.nodes.forEach((id) => {
        const el = overlayMap.get(id);
        if (el) {
          el.classList.add('is-selected');
          // Update title button state when selected
          if (el._updateTitleButtonState) el._updateTitleButtonState();
        }
      });
    }
  });
  network.on('deselectNode', () => {
    hideAllToolbars();
  });

  // Hover handling: show floating lock/add on hover even when not selected
  network.on('hoverNode', (params) => {
    if (params && params.node != null) {
      const el = overlayMap.get(params.node);
      if (el) el.classList.add('is-hover');
    }
  });
  network.on('blurNode', (params) => {
    if (params && params.node != null) {
      const el = overlayMap.get(params.node);
      if (el) el.classList.remove('is-hover');
    }
  });

  function updateLockStates() {
    // Force update all lock button states
    overlayMap.forEach((el, id) => {
      const n = nodes.get(id);
      const lockFloatBtn = el.querySelector('.node-overlay__btnLockFloating');
      if (n && lockFloatBtn) {
        const locked = n.physics === false;
        lockFloatBtn.textContent = locked ? '🔒' : '🔓';
        lockFloatBtn.title = locked ? 'Unlock (allow physics to move this node)' : "Lock position (physics won't move this node)";
        if (locked) el.classList.add('is-locked'); else el.classList.remove('is-locked');
      }
    });
  }

  // Expose for toolbar to call after bulk operations
  window._updateLockStates = updateLockStates;

  // Notes data management functions
  window._updateNodeNotes = (nodeId, notes) => {
    const node = nodes.get(nodeId);
    if (node) {
      node.notes = notes;
      nodes.update(node);
      if (typeof window._saveToStorage === 'function') window._saveToStorage();
      
      // Update the notes display in the overlay if it exists and is visible
      const overlay = overlayMap.get(nodeId);
      if (overlay) {
        const notesSection = overlay.querySelector('.notes-section');
        if (notesSection) {
          // Recreate the notes container with updated content
          notesSection.innerHTML = '';
          const notesContainer = notesEditor.createNotesContainer(nodeId, notes, 'preview');
          notesSection.appendChild(notesContainer);
        }
      }
    }
  };

  window._getNodeNotes = (nodeId) => {
    const node = nodes.get(nodeId);
    return node ? (node.notes || '') : '';
  };

  // Mode switching functions
  window._switchToNotesMode = (nodeId) => {
    const el = overlayMap.get(nodeId);
    if (el) {
      // Get node data for the fullscreen editor
      const nodeData = nodes.get(nodeId);
      if (nodeData) {
        // Get current notes
        const currentNotes = window._getNodeNotes(nodeId);
        
        // Create fullscreen editor
        notesEditor.enterFullscreenEditor(nodeId, {
          title: nodeData.title || 'Untitled Document',
          authors: nodeData.authors || '',
          link: nodeData.link || '',
          type: nodeData.type || 'paper',
          notes: currentNotes
        });
      }
    }
  };

  window._switchToPreviewMode = (nodeId) => {
    // Exit fullscreen editor mode
    notesEditor.exitFullscreenEditor(nodeId);
  };

  // Refresh overlays after assets are restored
  window._refreshNodeOverlays = function() {
    console.log('[Overlays] Refreshing viewer content for all nodes');
    overlayMap.forEach((el, nodeId) => {
      const node = nodes.get(nodeId);
      if (node && node.link && node.link.startsWith('assets/')) {
        // Find the viewer-container and update it
        const viewerContainer = el.querySelector('.viewer-container');
        if (viewerContainer) {
          const newViewerContent = createViewerContent(node);
          viewerContainer.innerHTML = newViewerContent;
          console.log('[Overlays] Refreshed viewer for node', nodeId, node.title);
        } else {
          console.log('[Overlays] Could not find .viewer-container for node:', nodeId);
        }
      }
    });
  };

  function escapeHtml(s) {
    return (!s ? '' : s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'));
  }
}
