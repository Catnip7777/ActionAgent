(() => {
  'use strict';

  const core = window.__agentCore;
  if (!core) throw new Error('app-panels-workspace.js missing dependencies');

  let workspaceHandle = null;
  let workspaceHandles = {};

  function getHandle() { return workspaceHandle; }

  async function getBrowserHandleForWorkspace(ws) {
    if (!ws || !('showDirectoryPicker' in window)) return null;
    if (workspaceHandles[ws.id]) {
      try { const perm = await workspaceHandles[ws.id].queryPermission({ mode: ws.permission === 'readonly' ? 'read' : 'readwrite' }); if (perm === 'granted') return workspaceHandles[ws.id]; } catch {}
    }
    const handle = await loadWorkspaceHandleById(ws.id);
    if (!handle) return null;
    try { const perm = await handle.queryPermission({ mode: ws.permission === 'readonly' ? 'read' : 'readwrite' }); if (perm === 'granted') { workspaceHandles[ws.id] = handle; if (ws.id === core.getActiveWorkspace().id) workspaceHandle = handle; return handle; } } catch {}
    return null;
  }

  async function openWorkspaceDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(core.WS_DB_NAME || 'llm-action-agent-ws', 1);
      req.onupgradeneeded = () => req.result.createObjectStore(core.WS_STORE || 'handles');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function loadWorkspaceHandleById(id) {
    const db = await openWorkspaceDb();
    return new Promise((resolve) => {
      const store = db.transaction(core.WS_STORE || 'handles').objectStore(core.WS_STORE || 'handles');
      const req = store.get(id);
      req.onsuccess = () => { if (req.result) resolve(req.result); else if (id === core.getActiveWorkspace()?.id) { const legacyReq = store.get('workspace'); legacyReq.onsuccess = () => resolve(legacyReq.result || null); legacyReq.onerror = () => resolve(null); } else resolve(null); };
      req.onerror = () => resolve(null);
    });
  }

  async function renderWorkspacePanel() {
    await restoreWorkspace();
    renderWorkspaceEditor();
  }

  function renderWorkspaceEditor() {
    const el = document.getElementById('workspaceEditor');
    if (!el) return;
    const ws = core.getActiveWorkspace();
    if (!ws) { el.innerHTML = '<p class="panel-desc">请先在 API 设置中保存配置。</p>'; return; }
    const perm = ws.permission || 'readwrite';
    const hasHandle = !!workspaceHandles[ws.id];
    el.innerHTML = `<div class="form-group"><label for="wsEditLabel">名称</label><input type="text" id="wsEditLabel" value="${core.escapeHtml(ws.label || '')}"></div>
      <div class="form-group"><label>文件夹</label><div class="folder-picker-row"><button id="wsPickFolderBtn" class="btn btn-sm">📁 选择文件夹</button><span id="wsFolderDisplay" class="folder-name">${core.escapeHtml(ws.folderName || '（未选择）')}</span></div></div>
      <div class="form-group"><label for="wsEditPermission">权限</label><select id="wsEditPermission"><option value="readwrite" ${perm === 'readwrite' ? 'selected' : ''}>可读可写</option><option value="readonly" ${perm === 'readonly' ? 'selected' : ''}>只读</option></select></div>
      <div class="form-group"><label for="wsEditDescription">说明</label><textarea id="wsEditDescription" rows="4">${core.escapeHtml(ws.description || '')}</textarea></div>
      <div class="workspace-info" id="workspaceInfo"></div>
      <div class="file-tree" id="fileTree"></div>`;
    // 名称和说明自动保存
    ['wsEditLabel','wsEditDescription','wsEditPermission'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', debouncedSaveWorkspace);
        el.addEventListener('change', debouncedSaveWorkspace);
      }
    });
    // 选择文件夹按钮
    document.getElementById('wsPickFolderBtn')?.addEventListener('click', async function() {
      const ws = core.getActiveWorkspace();
      if (!ws) return;
      if (!('showDirectoryPicker' in window)) { alert('浏览器不支持文件夹选择'); return; }
      await clearWorkspaceHandle(ws.id);
      try {
        const handle = await window.showDirectoryPicker({ mode: ws.permission === 'readonly' ? 'read' : 'readwrite' });
        await saveWorkspaceHandle(handle);
        await applyWorkspaceHandle(handle);
        // 更新UI显示的文件夹名
        const display = document.getElementById('wsFolderDisplay');
        if (display) display.textContent = handle.name;
        renderWorkspaceStatus();
        renderFileTree();
      } catch (err) { if (err.name !== 'AbortError') alert('授权失败: ' + err.message); }
    });
    // 权限变更 → 重新授权
    document.getElementById('wsEditPermission')?.addEventListener('change', async function() {
      readWorkspaceFormIntoActive();
      core.saveConfig();
      const ws = core.getActiveWorkspace();
      // 尝试用新模式重新请求权限
      if (ws && workspaceHandles[ws.id]) {
        try {
          const newPerm = await workspaceHandles[ws.id].requestPermission({ mode: ws.permission === 'readonly' ? 'read' : 'readwrite' });
          if (newPerm !== 'granted') {
            await clearWorkspaceHandle(ws.id);
            renderWorkspaceStatus();
            renderFileTree();
          }
        } catch {}
      }
      renderWorkspaceStatus();
      renderFileTree();
    });
    renderWorkspaceStatus();
    renderFileTree();
  }

  function debouncedSaveWorkspace() {
    clearTimeout(window.__wsSaveTimer);
    window.__wsSaveTimer = setTimeout(() => { readWorkspaceFormIntoActive(); core.saveConfig(); }, 400);
  }

  function readWorkspaceFormIntoActive() {
    const ws = core.getActiveWorkspace();
    if (!ws) return;
    const label = document.getElementById('wsEditLabel');
    if (!label) return;
    ws.label = label.value.trim() || '工作区';
    ws.description = document.getElementById('wsEditDescription')?.value || '';
    ws.permission = document.getElementById('wsEditPermission')?.value || 'readwrite';
  }

  function renderWorkspaceStatus() {
    const info = document.getElementById('workspaceInfo');
    if (!info) return;
    const ws = core.getActiveWorkspace();
    if (!ws) return;
    const hasHandle = !!workspaceHandles[ws.id];
    const permClass = ws.permission === 'readwrite' ? 'ws-perm-rw' : 'ws-perm-ro';
    const folderInfo = ws.folderName ? `<p>文件夹: <code>${core.escapeHtml(ws.folderName)}</code></p>` : '';
    info.innerHTML = `<div><p>权限: <strong class="ws-perm-badge ${permClass}">${core.escapeHtml(core.WS_PERMISSION_LABELS[ws.permission] || ws.permission)}</strong></p><p>授权状态: ${hasHandle ? '<span style="color:var(--success)">✅ 已授权</span>' : '<span style="color:var(--warning)">⚠️ 未授权</span>'}</p>${folderInfo}</div>`;
  }

  async function applyWorkspaceHandle(handle) {
    workspaceHandle = handle;
    const ws = core.getActiveWorkspace();
    if (ws) { ws.folderName = handle.name; workspaceHandles[ws.id] = handle; }
    core.saveConfig();
    renderWorkspaceStatus();
  }

  // 清除工作区的授权句柄（内存 + IndexedDB）
  async function clearWorkspaceHandle(id) {
    delete workspaceHandles[id];
    if (workspaceHandle && core.getActiveWorkspace()?.id === id) workspaceHandle = null;
    try {
      const db = await openWorkspaceDb();
      const tx = db.transaction(core.WS_STORE || 'handles', 'readwrite');
      tx.objectStore(core.WS_STORE || 'handles').delete(id);
    } catch {}
  }

  async function restoreWorkspace() {
    workspaceHandle = null;
    const ws = core.getActiveWorkspace();
    if (!ws || !('showDirectoryPicker' in window)) { renderWorkspaceStatus(); renderFileTree(); return; }
    const stored = await loadWorkspaceHandleById(ws.id);
    if (!stored) { renderWorkspaceStatus(); renderFileTree(); return; }
    try {
      const perm = await stored.queryPermission({ mode: ws.permission === 'readonly' ? 'read' : 'readwrite' });
      if (perm === 'granted') {
        workspaceHandles[ws.id] = stored;
        workspaceHandle = stored;
        renderWorkspaceStatus();
        renderFileTree();
        return;
      }
    } catch {}
    // 权限不是 granted（可能是 prompt/denied），尝试重新请求
    try {
      const newPerm = await stored.requestPermission({ mode: ws.permission === 'readonly' ? 'read' : 'readwrite' });
      if (newPerm === 'granted') {
        workspaceHandles[ws.id] = stored;
        workspaceHandle = stored;
        renderWorkspaceStatus();
        renderFileTree();
        return;
      }
    } catch (err) {
      if (err.name !== 'AbortError') console.warn('权限请求失败:', err.message);
    }
    renderWorkspaceStatus();
    renderFileTree();
  }

  async function pickWorkspace() {
    const ws = core.getActiveWorkspace();
    if (!ws) { alert('请先保存 API 设置'); return; }
    if (!('showDirectoryPicker' in window)) { alert('浏览器不支持'); return; }
    try {
      workspaceHandle = await window.showDirectoryPicker({ mode: ws.permission === 'readonly' ? 'read' : 'readwrite' });
      await saveWorkspaceHandle(workspaceHandle);
      await applyWorkspaceHandle(workspaceHandle);
    } catch (err) { if (err.name !== 'AbortError') alert('授权失败: ' + err.message); }
  }

  async function saveWorkspaceHandle(handle) {
    const ws = core.getActiveWorkspace();
    if (!ws) { const nws = core.createDefaultWorkspace({ id: core.safeId(), label: handle.name, folderName: handle.name }); core.getConfig().workspaces.push(nws); core.getConfig().activeWorkspaceId = nws.id; }
    else { ws.folderName = handle.name; if (!ws.label || ws.label === '默认工作区') ws.label = handle.name; }
    const db = await openWorkspaceDb();
    const tx = db.transaction(core.WS_STORE || 'handles', 'readwrite');
    tx.objectStore(core.WS_STORE || 'handles').put(handle, core.getActiveWorkspace().id);
    workspaceHandles[core.getActiveWorkspace().id] = handle;
    if (core.getActiveWorkspace().id) workspaceHandle = handle;
    core.saveConfig();
  }

  async function renderFileTree() {
    const el = document.getElementById('fileTree');
    if (!workspaceHandle) { if (el) el.innerHTML = ''; return; }
    if (!el) return;
    el.innerHTML = '<p>加载中...</p>';
    try {
      const entries = [];
      for await (const [name, handle] of workspaceHandle.entries()) entries.push({ name, kind: handle.kind });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      el.innerHTML = entries.map((e) => `<div>${e.kind === 'directory' ? '📁' : '📄'} ${core.escapeHtml(e.name)}</div>`).join('') || '<p>空目录</p>';
    } catch (err) { el.innerHTML = `<p>读取失败: ${core.escapeHtml(err.message)}</p>`; }
  }

  window.__agentWorkspace = { getHandle, getBrowserHandleForWorkspace };
  window.__agentPanelsWorkspace = { getHandle, getBrowserHandleForWorkspace, renderWorkspacePanel, renderWorkspaceEditor, readWorkspaceFormIntoActive, renderWorkspaceStatus, restoreWorkspace, pickWorkspace, renderFileTree };
})();
