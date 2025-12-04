// Handles documentToolbar logic: layout switching, add paper, export/import
// Exports: setupDocumentToolbar(network, nodes, edges)
import { saveAsset, getAsset, getAllAssets, initAssetStorage, saveSetting, getSetting } from './assetStorage.js';

export async function setupDocumentToolbar(network, nodes, edges) {
  // Initialize IndexedDB for assets
  await initAssetStorage();
  
  // In-memory map for quick access (IndexedDB is primary storage)
  const sessionAssets = new Map();
  
  // Load assets from IndexedDB into session memory
  try {
    const assets = await getAllAssets();
    Object.entries(assets).forEach(([name, blob]) => {
      sessionAssets.set(name, blob);
    });
    console.log(`[Assets] Loaded ${sessionAssets.size} assets from IndexedDB`);
  } catch (e) {
    console.error('[Assets] Failed to load from IndexedDB', e);
  }

  // Helper to register an asset (file) into sessionAssets and IndexedDB
  async function registerAsset(file) {
    // Use the original file name; if collision, append a numeric suffix
    let base = file.name;
    let name = base;
    let i = 1;
    while (sessionAssets.has(name)) {
      const dot = base.lastIndexOf('.');
      const prefix = dot !== -1 ? base.slice(0, dot) : base;
      const ext = dot !== -1 ? base.slice(dot) : '';
      name = `${prefix}-${i}${ext}`;
      i += 1;
    }
    sessionAssets.set(name, file);
    
    // Save to IndexedDB (non-blocking)
    saveAsset(name, file).catch(e => {
      console.error(`[Assets] Failed to save ${name} to IndexedDB`, e);
    });
    
    return name;
  }

  // Expose a minimal session asset API for other modules (paperForm, viewer, export)
  window._getSessionAssets = function() {
    return Array.from(sessionAssets.keys());
  };
  window._getSessionAssetBlob = function(name) {
    const blob = sessionAssets.get(name);
    if (!blob) {
      console.warn('[Assets] Blob not found for:', name, 'Available:', Array.from(sessionAssets.keys()));
    }
    return blob || null;
  };
  window._registerSessionAsset = async function(file) {
    const name = await registerAsset(file);
    console.log('[Assets] Registered', name, 'Total assets:', sessionAssets.size);
    return name;
  };

  // Ensure any currently selected nodes are reset to default visuals before deselecting
  function restoreSelectedThenUnselect() {
    if (typeof network.getSelectedNodes === 'function') {
      const selected = network.getSelectedNodes();
      if (Array.isArray(selected) && selected.length) {
        selected.forEach((nodeId) => {
          // restore node size and font to defaults (keep in sync with network.js defaults)
          nodes.update({
            id: nodeId,
            widthConstraint: { minimum: 240, maximum: 240 },
            heightConstraint: { minimum: 30 },
            font: { size: 16 },
          });
          // restore connected edge lengths
          edges.get().forEach((edge) => {
            if (edge.from === nodeId || edge.to === nodeId) {
              edges.update({ id: edge.id, length: 400 });
            }
          });
        });
      }
    }
    if (window._applySpacing) window._applySpacing(false);
    if (typeof network.unselectAll === 'function') network.unselectAll();
  }
  document.getElementById('clearBtn').addEventListener('click', () => {
    if (confirm('Clear the entire graph? This cannot be undone.')) {
      nodes.clear();
      edges.clear();
      // Remove overlay DOMs
      const container = document.getElementById('nodeOverlayContainer');
      if (container) {
        while (container.firstChild) container.removeChild(container.firstChild);
      }
      // Reinitialize node overlays after clearing
      if (window._setupNodeOverlays) {
        window._setupNodeOverlays();
      }
      window._saveToStorage();
      network.fit();
    }
  });
  document.getElementById('switchPhysics').onclick = function () {
    // Reset any selected papers first, then deselect
    restoreSelectedThenUnselect();
    // Get current positions
    const currentPositions = network.getPositions();
    // Set node positions to current
    Object.entries(currentPositions).forEach(([id, pos]) => {
      nodes.update({ id: Number(id), x: pos.x, y: pos.y, fixed: false });
    });

  // Remove hierarchical layout forcibly
  network.setOptions({ layout: { hierarchical: false } });
  network.setOptions({ layout: {} });
  // enable physics; spacing parameters are controlled centrally in network.js
  network.setOptions({ physics: { enabled: true } });
  // mark mode
  network.__layoutMode = 'physics';
  if (network && network.stabilize) network.stabilize();
  };
  document.getElementById('switchHierUD').onclick = function () {
    // Reset any selected papers first, then deselect
    restoreSelectedThenUnselect();
    network.setOptions({
    physics: { enabled: false },
      layout: {
        hierarchical: {
          direction: 'UD',
          sortMethod: 'directed',
      nodeSpacing: 120,
      levelSeparation: 120,
          treeSpacing: 100,
          blockShifting: false,
          edgeMinimization: false,
        }
      }
    });
  // mark mode
  network.__layoutMode = 'hierarchical';
  if (network.redraw) network.redraw();
  // apply hierarchical spacing immediately (use default selection=false)
  if (window._applySpacing) window._applySpacing(false);
  };
  //   document.getElementById('switchHierLR').onclick = function() {
  //     network.setOptions({
  //       physics: true,
  //       layout: {
  //         hierarchical: {
  //           direction: 'LR',
  //           sortMethod: 'directed',
  //           nodeSpacing: 120,
  //           levelSeparation: 120,
  //           treeSpacing: 100,
  //           blockShifting: false,
  //           edgeMinimization: false,
  //         }
  //       }
  //     });
  //   };

  document.getElementById('addPaperBtn').addEventListener('click', () => {
    if (window._showPaperForm) {
      window._showPaperForm('add', {}, (formData) => {
        window._addOrGetPaper(formData);
        window._saveToStorage();
      });
    } else {
      // Fallback to old prompt method
      const title = prompt('Paper title (required):');
      if (!title || !title.trim()) return;
      const authors = prompt('Authors (optional):') || '';
      window._addOrGetPaper({ title: title.trim(), authors: authors.trim() });
      window._saveToStorage();
    }
  });

  // --- Storage quota exceeded banner and helpers ---
  let _storageBannerEl = null;
  function _ensureStorageBanner() {
    if (_storageBannerEl) return _storageBannerEl;
    const banner = document.createElement('div');
    banner.className = 'storage-warning-banner hidden';
    banner.innerHTML = `
      <div class="storage-warning-content">
        <span class="storage-warning-text">Storage is full. Recent changes may not be saved. Please export your project as a ZIP to back up all data.</span>
        <div class="storage-warning-actions">
          <button class="btn-export-now">Export ZIP</button>
          <button class="btn-dismiss">Dismiss</button>
        </div>
      </div>`;
    // Place banner right after the main toolbar so it appears below it
    const toolbar = document.getElementById('documentToolbar');
    if (toolbar && toolbar.insertAdjacentElement) {
      toolbar.insertAdjacentElement('afterend', banner);
    } else {
      document.body.appendChild(banner);
    }
    // Wire actions
    const exportBtn = banner.querySelector('.btn-export-now');
    const dismissBtn = banner.querySelector('.btn-dismiss');
    if (exportBtn) exportBtn.addEventListener('click', () => {
      const btn = document.getElementById('exportBtn');
      if (btn) btn.click();
    });
    if (dismissBtn) dismissBtn.addEventListener('click', () => {
      banner.classList.add('hidden');
      try { localStorage.setItem('paper-web-storage-exceeded', 'false'); } catch {}
    });
    _storageBannerEl = banner;
    return banner;
  }

  function _showStorageBanner() {
    // Only show on the main web view (not in fullscreen editor)
    if (document.body.classList.contains('fullscreen-editor-active')) {
      console.log('[StorageBanner] Suppressed in fullscreen editor mode');
      return;
    }
    const el = _ensureStorageBanner();
    // Position directly below the toolbar
    const toolbar = document.getElementById('documentToolbar');
    let topPx = 0;
    if (toolbar && !toolbar.classList.contains('hidden')) {
      const rect = toolbar.getBoundingClientRect();
      // Toolbar is fixed at top; use its height/bottom
      topPx = Math.max(rect.bottom, toolbar.offsetHeight || 0);
    }
    console.log('[StorageBanner] Showing at top px =', topPx);
    el.style.position = 'fixed';
    el.style.left = '0px';
    el.style.right = '0px';
    el.style.top = `${topPx}px`;
    el.classList.remove('hidden');
    // Keep it in the right place on resize
    const onResize = () => {
      if (el.classList.contains('hidden')) return;
      const tb = document.getElementById('documentToolbar');
      let t = 0;
      if (tb && !tb.classList.contains('hidden')) {
        const r = tb.getBoundingClientRect();
        t = Math.max(r.bottom, tb.offsetHeight || 0);
      }
      el.style.top = `${t}px`;
    };
    window.addEventListener('resize', onResize, { passive: true });
    // Store handler for potential future cleanup (optional)
    el._onResizeHandler = onResize;
  }

  // Expose helpers for other modules
  window._notifyStorageQuotaExceeded = () => _showStorageBanner();
  window._setStorageExceededFlag = (val) => {
    try { localStorage.setItem('paper-web-storage-exceeded', val ? 'true' : 'false'); } catch {}
  };

  // On load, if the flag is set, show a gentle warning and then clear it on dismiss
  try {
    const exceeded = localStorage.getItem('paper-web-storage-exceeded');
    if (exceeded === 'true') {
      console.log('[StorageBanner] Flag detected on load. Scheduling banner show.');
      // Defer slightly to avoid layout jank during initial render
      setTimeout(_showStorageBanner, 300);
    }
  } catch {}

  // Expose a manual test hook for debugging
  window.showStorageBannerNow = () => {
    try { localStorage.setItem('paper-web-storage-exceeded', 'true'); } catch {}
    _showStorageBanner();
  };

  document.getElementById('lockAllBtn').addEventListener('click', () => {
    const allNodes = nodes.get();
    const updates = allNodes.map(node => ({ id: node.id, physics: false }));
    nodes.update(updates);
    // Force update lock button appearances
    if (window._updateLockStates) window._updateLockStates();
    window._saveToStorage();
  });

  document.getElementById('unlockAllBtn').addEventListener('click', () => {
    const allNodes = nodes.get();
    const updates = allNodes.map(node => ({ id: node.id, physics: true }));
    nodes.update(updates);
    // Force update lock button appearances
    if (window._updateLockStates) window._updateLockStates();
    window._saveToStorage();
  });

  document.getElementById('combineNotesBtn').addEventListener('click', () => {
    const allNodes = nodes.get();
    const allEdges = edges.get();
    
    // Filter nodes that have notes
    const nodesWithNotes = allNodes.filter(node => node.notes && node.notes.trim().length > 0);
    
    if (nodesWithNotes.length === 0) {
      alert('No papers have notes to combine.');
      return;
    }
    
    // Create a hierarchical ordering based on the network structure
    const getHierarchicalOrder = () => {
      // Find root nodes (nodes with no incoming edges)
      const nodeIds = new Set(allNodes.map(n => n.id));
      const hasIncomingEdge = new Set();
      
      allEdges.forEach(edge => {
        hasIncomingEdge.add(edge.to);
      });
      
      const rootNodes = allNodes.filter(node => !hasIncomingEdge.has(node.id));
      const orderedNodes = [];
      const visited = new Set();
      
      // Depth-first traversal from root nodes
      const dfs = (nodeId, depth = 0) => {
        if (visited.has(nodeId)) return;
        visited.add(nodeId);
        
        const node = allNodes.find(n => n.id === nodeId);
        if (node && node.notes && node.notes.trim().length > 0) {
          orderedNodes.push({ ...node, depth });
        }
        
        // Find children of this node
        const children = allEdges
          .filter(edge => edge.from === nodeId)
          .map(edge => edge.to)
          .sort(); // Sort for consistent ordering
        
        children.forEach(childId => dfs(childId, depth + 1));
      };
      
      // Start DFS from all root nodes
      rootNodes.forEach(root => dfs(root.id));
      
      // Add any remaining nodes with notes that weren't reached
      nodesWithNotes.forEach(node => {
        if (!visited.has(node.id)) {
          orderedNodes.push({ ...node, depth: 0 });
        }
      });
      
      return orderedNodes;
    };
    
    const orderedNodes = getHierarchicalOrder();
    
    // Generate the combined markdown
    let combinedMarkdown = '# Combined Paper Notes\n\n';
    
    orderedNodes.forEach((node, index) => {
      combinedMarkdown += '_____________________\n';
      combinedMarkdown += `#### ${node.title}\n`;
      if (node.authors) {
        combinedMarkdown += `**Authors:** ${node.authors}\n`;
      }
      if (node.doi) {
        combinedMarkdown += `**DOI:** ${node.doi}\n`;
      }
      if (node.link) {
        combinedMarkdown += `**Link:** ${node.link}\n`;
      }
      combinedMarkdown += '\n';
      combinedMarkdown += node.notes;
      combinedMarkdown += '\n\n';
    });
    
    // Create a new window to display the combined notes
    const newWindow = window.open('', '_blank', 'width=800,height=600');
    if (newWindow) {
      newWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Combined Paper Notes</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
              line-height: 1.6;
            }
            .header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 20px;
              padding-bottom: 10px;
              border-bottom: 1px solid #eee;
            }
            .copy-btn {
              background: #007bff;
              color: white;
              border: none;
              padding: 8px 16px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 14px;
            }
            .copy-btn:hover {
              background: #0056b3;
            }
            .content {
              white-space: pre-wrap;
              font-family: 'Courier New', monospace;
              background: #f8f9fa;
              padding: 20px;
              border-radius: 4px;
              border: 1px solid #e9ecef;
            }
            .success-message {
              color: green;
              font-size: 12px;
              margin-left: 10px;
              opacity: 0;
              transition: opacity 0.3s;
            }
            .success-message.show {
              opacity: 1;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Combined Paper Notes</h1>
            <div>
              <button class="copy-btn" onclick="copyToClipboard()">Copy to Clipboard</button>
              <span class="success-message" id="successMessage">Copied!</span>
            </div>
          </div>
          <div class="content" id="content">${combinedMarkdown.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
          <script>
            function copyToClipboard() {
              const content = document.getElementById('content').textContent;
              navigator.clipboard.writeText(content).then(() => {
                const msg = document.getElementById('successMessage');
                msg.classList.add('show');
                setTimeout(() => msg.classList.remove('show'), 2000);
              }).catch(err => {
                // Fallback for older browsers
                const textArea = document.createElement('textarea');
                textArea.value = content;
                document.body.appendChild(textArea);
                textArea.select();
                try {
                  document.execCommand('copy');
                  const msg = document.getElementById('successMessage');
                  msg.classList.add('show');
                  setTimeout(() => msg.classList.remove('show'), 2000);
                } catch (err) {
                  alert('Copy failed. Please select all text and copy manually.');
                }
                document.body.removeChild(textArea);
              });
            }
          </script>
        </body>
        </html>
      `);
      newWindow.document.close();
    } else {
      // Fallback if popup is blocked
      alert('Popup blocked. Please allow popups for this site to view combined notes.');
    }
  });

  document.getElementById('exportBtn').addEventListener('click', async () => {
    const data = { nodes: nodes.get(), edges: edges.get() };
    
    // Get current node positions and add them to the export data
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
      console.error('Failed to export node positions', e);
    }
    
    // If we have session assets (local PDFs), export as a project ZIP: web.json + assets/
    if (sessionAssets.size > 0 && typeof JSZip !== 'undefined') {
      try {
        const zip = new JSZip();
        zip.file('web.json', JSON.stringify(data, null, 2));
        const assetsFolder = zip.folder('assets');
        sessionAssets.forEach((file, filename) => {
          assetsFolder.file(filename, file);
        });
        
        const blob = await zip.generateAsync({ type: 'blob' });
        
        // Try to use File System Access API (Chrome/Edge only)
        if ('showSaveFilePicker' in window) {
          try {
            // Try to get the last saved directory handle
            const lastDirHandle = await getSetting('lastExportDirectory');
            
            const options = {
              suggestedName: 'paper-web-project.zip',
              types: [{
                description: 'ZIP Archive',
                accept: { 'application/zip': ['.zip'] }
              }]
            };
            
            // If we have a saved directory, try to use it as the starting directory
            if (lastDirHandle) {
              try {
                // Verify we still have permission to the directory
                const permission = await lastDirHandle.queryPermission({ mode: 'readwrite' });
                if (permission === 'granted') {
                  options.startIn = lastDirHandle;
                  console.log('[Export] Using last saved directory');
                }
              } catch (e) {
                console.log('[Export] Could not access last directory:', e);
              }
            }
            
            const handle = await window.showSaveFilePicker(options);
            
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            
            // Save the parent directory handle for next time
            try {
              const parent = await handle.getParent();
              if (parent) {
                await saveSetting('lastExportDirectory', parent);
                console.log('[Export] Saved directory for next time');
              }
            } catch (e) {
              console.log('[Export] Could not save directory handle:', e);
            }
            
            console.log('[Export] Saved to:', handle.name);
          } catch (e) {
            if (e.name !== 'AbortError') {
              console.error('[Export] File System Access failed:', e);
              // Fallback to regular download
              downloadBlob(blob, 'paper-web-project.zip');
            }
          }
        } else {
          // Fallback to regular download
          downloadBlob(blob, 'paper-web-project.zip');
        }
      } catch (e) {
        console.error('[Export] Failed to create ZIP:', e);
        alert('Export failed: ' + e.message);
      }
    } else {
      // No assets, export simple JSON
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      
      // Try to use File System Access API
      if ('showSaveFilePicker' in window) {
        try {
          // Try to get the last saved directory handle
          const lastDirHandle = await getSetting('lastExportDirectory');
          
          const options = {
            suggestedName: 'paper-web-export.json',
            types: [{
              description: 'JSON File',
              accept: { 'application/json': ['.json'] }
            }]
          };
          
          // If we have a saved directory, try to use it as the starting directory
          if (lastDirHandle) {
            try {
              // Verify we still have permission to the directory
              const permission = await lastDirHandle.queryPermission({ mode: 'readwrite' });
              if (permission === 'granted') {
                options.startIn = lastDirHandle;
                console.log('[Export] Using last saved directory');
              }
            } catch (e) {
              console.log('[Export] Could not access last directory:', e);
            }
          }
          
          const handle = await window.showSaveFilePicker(options);
          
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          
          // Save the parent directory handle for next time
          try {
            const parent = await handle.getParent();
            if (parent) {
              await saveSetting('lastExportDirectory', parent);
              console.log('[Export] Saved directory for next time');
            }
          } catch (e) {
            console.log('[Export] Could not save directory handle:', e);
          }
          
          console.log('[Export] Saved to:', handle.name);
        } catch (e) {
          if (e.name !== 'AbortError') {
            console.error('[Export] File System Access failed:', e);
            // Fallback to regular download
            downloadBlob(blob, 'paper-web-export.json');
          }
        }
      } else {
        // Fallback to regular download
        downloadBlob(blob, 'paper-web-export.json');
      }
    }
  });

  // --- Close confirmation (Save / Don't save / Cancel) ---
  // Browsers restrict customizing the native beforeunload dialog. We trigger it,
  // and if the user chooses to stay, we then show our custom 3-option modal.
  let _beforeUnloadHandler;
  let _closeModalEl;
  function _ensureCloseModal() {
    if (_closeModalEl) return _closeModalEl;
    const modal = document.createElement('div');
    modal.className = 'modal hidden';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>Save changes?</h3>
          <button class="modal-close" title="Close">×</button>
        </div>
        <div style="padding:16px;">
          <p>If you close now, recent changes may be lost.</p>
          <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:16px;">
            <button class="btn-cancel" data-action="cancel">Cancel</button>
            <button class="btn-save" data-action="save" autofocus>Save</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const closeBtn = modal.querySelector('.modal-close');
    const onAction = async (action) => {
      if (action === 'save') {
        // Trigger the same logic as "Save Project" button
        const btn = document.getElementById('exportBtn');
        if (btn) btn.click();
        modal.classList.add('hidden');
      } else {
        // cancel
        modal.classList.add('hidden');
      }
    };
    modal.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.dataset && target.dataset.action) {
        onAction(target.dataset.action);
      }
      if (target === closeBtn) {
        onAction('cancel');
      }
    });

    _closeModalEl = modal;
    return modal;
  }

  function _showCloseModal() {
    const modal = _ensureCloseModal();
    modal.classList.remove('hidden');
    // Focus Save (default)
    const saveBtn = modal.querySelector('[data-action="save"]');
    if (saveBtn) saveBtn.focus();
  }

  _beforeUnloadHandler = (e) => {
    e.preventDefault();
    const msg = 'You have unsaved changes.';
    // Some browsers require a non-empty string and/or a return value
    e.returnValue = msg;
    // After the user cancels the native dialog (chooses to stay), show custom modal
    setTimeout(_showCloseModal, 0);
    return msg;
  };
  window.addEventListener('beforeunload', _beforeUnloadHandler);
  
  // Helper function to download a blob (fallback for browsers without File System Access API)
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  document.getElementById('importBtn').addEventListener('click', () => {
    // Ask user whether to import ZIP or directory
    const choice = confirm('Import as ZIP file?\n\nOK = Import ZIP file\nCancel = Import directory (folder picker)');
    
    if (choice) {
      // Import ZIP file
      document.getElementById('importProjectZip').click();
    } else {
      // Import directory (if browser supports it)
      const importProjectEl = document.getElementById('importProject');
      if (importProjectEl && importProjectEl.style) {
        importProjectEl.click();
      } else {
        // Fallback to single JSON file
        document.getElementById('importFile').click();
      }
    }
  });

  document.getElementById('importFile').addEventListener('change', (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        if (parsed.nodes) {
          nodes.clear();
          nodes.add(parsed.nodes);
          
          // If imported data has positions, apply them after network is ready
          if (parsed.nodes.some(node => typeof node.x === 'number' && typeof node.y === 'number')) {
            let positionsRestored = false; // Flag to ensure it only runs once
            
            const restorePositions = () => {
              if (positionsRestored) return; // Prevent multiple executions
              positionsRestored = true;
              
              try {
                const positionUpdates = [];
                parsed.nodes.forEach(node => {
                  if (typeof node.x === 'number' && typeof node.y === 'number' && !isNaN(node.x) && !isNaN(node.y)) {
                    // Preserve the original physics/locked state of the node
                    const originalPhysics = node.physics !== undefined ? node.physics : true;
                    positionUpdates.push({
                      id: node.id,
                      x: node.x,
                      y: node.y,
                      physics: originalPhysics // Preserve original physics state
                    });
                  }
                });
                if (positionUpdates.length > 0) {
                  nodes.update(positionUpdates);
                }
              } catch (e) {
                console.error('Failed to restore imported node positions', e);
              }
            };

            // Single timing approach
            if (typeof network.on === 'function') {
              const stabilizedHandler = () => {
                network.off('stabilized', stabilizedHandler);
                setTimeout(restorePositions, 100);
              };
              network.on('stabilized', stabilizedHandler);
            } else {
              // Fallback timeout
              setTimeout(restorePositions, 500);
            }
          }
        }
        if (parsed.edges) {
          edges.clear();
          edges.add(parsed.edges);
        }
        window._saveToStorage();
      } catch (err) { 
        alert('Invalid JSON'); 
      }
    };
    reader.readAsText(f);
  });

  // Handle importing a project directory (web.json + assets/*) or ZIP file
  const importProjectEl = document.getElementById('importProject');
  if (importProjectEl) {
    importProjectEl.addEventListener('change', async (ev) => {
      const files = Array.from(ev.target.files || []);
      if (!files.length) return;

      // Check if it's a ZIP file
      const zipFile = files.find(f => f.name.toLowerCase().endsWith('.zip'));
      if (zipFile) {
        try {
          const zip = await JSZip.loadAsync(zipFile);
          
          // Find web.json in the ZIP
          let webJsonContent = null;
          const webJsonFile = zip.file('web.json');
          if (webJsonFile) {
            webJsonContent = await webJsonFile.async('string');
          }

          if (!webJsonContent) {
            alert('No web.json found in ZIP file');
            return;
          }

          // Parse the web.json
          const parsed = JSON.parse(webJsonContent);

          // Extract and register assets from the ZIP
          const assetFolder = zip.folder('assets');
          if (assetFolder) {
            const assetPromises = [];
            assetFolder.forEach((relativePath, file) => {
              if (!file.dir) {
                assetPromises.push(
                  file.async('blob').then(async blob => {
                    const fileName = relativePath;
                    const fileObj = new File([blob], fileName, { type: blob.type || 'application/pdf' });
                    await registerAsset(fileObj);
                  })
                );
              }
            });
            await Promise.all(assetPromises);
          }

          // Load the data
          if (parsed.nodes) {
            nodes.clear();
            nodes.add(parsed.nodes);
          }
          if (parsed.edges) {
            edges.clear();
            edges.add(parsed.edges);
          }
          window._saveToStorage();

        } catch (err) {
          console.error('Error importing ZIP:', err);
          alert('Failed to import ZIP file: ' + err.message);
        }
        return;
      }

      // Otherwise, handle as directory upload (multiple files)
      // Find web.json (or web.json-like) file
      const webFile = files.find(f => f.name.toLowerCase() === 'web.json' || f.name.toLowerCase() === 'web.json');
      let parsed = null;
      const assetFiles = files.filter(f => f.name && !/web\.json/i.test(f.name));

      // Register asset files (fire and forget - assets save async to IndexedDB)
      assetFiles.forEach(f => registerAsset(f));

      if (webFile) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            parsed = JSON.parse(e.target.result);
            if (parsed.nodes) {
              nodes.clear();
              nodes.add(parsed.nodes);
            }
            if (parsed.edges) {
              edges.clear();
              edges.add(parsed.edges);
            }
            window._saveToStorage();
          } catch (err) {
            alert('Invalid project web.json');
          }
        };
        reader.readAsText(webFile);
      } else {
        alert('No web.json found in selected project folder');
      }
    });
  }

  // Handle importing a project ZIP file
  const importProjectZipEl = document.getElementById('importProjectZip');
  if (importProjectZipEl) {
    importProjectZipEl.addEventListener('change', async (ev) => {
      const zipFile = ev.target.files[0];
      if (!zipFile) return;

      try {
        const zip = await JSZip.loadAsync(zipFile);
        
        // Find web.json in the ZIP
        let webJsonContent = null;
        const webJsonFile = zip.file('web.json');
        if (webJsonFile) {
          webJsonContent = await webJsonFile.async('string');
        }

        if (!webJsonContent) {
          alert('No web.json found in ZIP file');
          return;
        }

        // Parse the web.json
        const parsed = JSON.parse(webJsonContent);

        // Extract and register assets from the ZIP
        const assetFolder = zip.folder('assets');
        if (assetFolder) {
          const assetPromises = [];
          assetFolder.forEach((relativePath, file) => {
            if (!file.dir) {
              assetPromises.push(
                file.async('blob').then(async blob => {
                  const fileName = relativePath;
                  const fileObj = new File([blob], fileName, { type: blob.type || 'application/pdf' });
                  await registerAsset(fileObj);
                })
              );
            }
          });
          await Promise.all(assetPromises);
        }

        // Load the data
        if (parsed.nodes) {
          nodes.clear();
          nodes.add(parsed.nodes);
        }
        if (parsed.edges) {
          edges.clear();
          edges.add(parsed.edges);
        }
        window._saveToStorage();

      } catch (err) {
        console.error('Error importing ZIP:', err);
        alert('Failed to import ZIP file: ' + err.message);
      }
    });
  }

  // Drag-and-drop support for PDFs, JSON, and ZIP imports (minimal, non-invasive)
  async function handleDropFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    // Check for ZIP file first
    const zipFile = files.find(f => f.name.toLowerCase().endsWith('.zip'));
    if (zipFile) {
      try {
        const zip = await JSZip.loadAsync(zipFile);
        
        // Find web.json in the ZIP
        let webJsonContent = null;
        const webJsonFile = zip.file('web.json');
        if (webJsonFile) {
          webJsonContent = await webJsonFile.async('string');
        }

        if (!webJsonContent) {
          alert('No web.json found in ZIP file');
          return;
        }

        // Parse the web.json
        const parsed = JSON.parse(webJsonContent);

        // Extract and register assets from the ZIP
        const assetFolder = zip.folder('assets');
        if (assetFolder) {
          const assetPromises = [];
          assetFolder.forEach((relativePath, file) => {
            if (!file.dir) {
              assetPromises.push(
                file.async('blob').then(async blob => {
                  const fileName = relativePath;
                  const fileObj = new File([blob], fileName, { type: blob.type || 'application/pdf' });
                  await registerAsset(fileObj);
                })
              );
            }
          });
          await Promise.all(assetPromises);
        }

        // Load the data
        if (parsed.nodes) {
          nodes.clear();
          nodes.add(parsed.nodes);
        }
        if (parsed.edges) {
          edges.clear();
          edges.add(parsed.edges);
        }
        window._saveToStorage();

      } catch (err) {
        console.error('Error importing ZIP:', err);
        alert('Failed to import ZIP file: ' + err.message);
      }
      return;
    }

    // If there's a JSON, prefer it (single-file import)
    const jsonFile = files.find(f => f.name.endsWith('.json'));
    if (jsonFile) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const parsed = JSON.parse(e.target.result);
          if (parsed.nodes) {
            nodes.clear();
            nodes.add(parsed.nodes);
          }
          if (parsed.edges) {
            edges.clear();
            edges.add(parsed.edges);
          }
          window._saveToStorage();
        } catch (err) { alert('Invalid JSON file'); }
      };
      reader.readAsText(jsonFile);
      return;
    }

    // Otherwise, treat dropped PDF files as assets to register and open file dialog in paper form
    const pdfs = files.filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (pdfs.length > 0) {
      // Register assets (fire and forget - assets save async to IndexedDB)
      pdfs.forEach(f => registerAsset(f));
      alert(`${pdfs.length} PDF(s) registered for this session. When adding a paper, choose from attached files in the "PDF URL" field.`);
    }
  }

  // Add drag/drop listeners on the document body
  ;['dragover','drop'].forEach(evt => {
    document.body.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  });
  document.body.addEventListener('drop', (e) => {
    handleDropFiles(e.dataTransfer.files);
  });
  document.getElementById('listPapersBtn').addEventListener('click', () => {
    const allNodes = nodes.get();
    if (!allNodes.length) {
      alert('No papers in the web.');
      return;
    }
    let listHtml = '<h1>All Papers</h1><ul style="font-family:monospace;line-height:1.7">';
    allNodes.forEach(node => {
      listHtml += '<li>';
      listHtml += `<strong>${node.title || '(untitled)'}</strong>`;
      if (node.authors) listHtml += ` &mdash; <span>${node.authors}</span>`;
      if (node.link) listHtml += ` <a href="${node.link}" target="_blank">[link]</a>`;
      listHtml += '</li>';
    });
    listHtml += '</ul>';
    const win = window.open('', '_blank', 'width=700,height=600');
    if (win) {
      win.document.write(`<!DOCTYPE html><html><head><title>Paper List</title></head><body>${listHtml}</body></html>`);
      win.document.close();
    } else {
      alert('Popup blocked. Please allow popups for this site.');
    }
  });
}
