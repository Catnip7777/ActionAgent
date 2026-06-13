(() => {
  'use strict';

  // ============================================================
  // Workspace Panel Module — 多工作区版本
  // 每个工作区独立授权文件夹，支持多个工作区并行管理
  // Depends on: window.__agentCore, __agentPanelsUtils
  // ============================================================

  const core = window.__agentCore;
  const utils = window.__agentPanelsUtils;
  if (!core || !utils) throw new Error('app-panels-workspace.js missing dependencies');

  let workspaceHandles = {};

  // ── 句柄管理 ──

  function getAllHandles() { return workspaceHandles; }

  async function getBrowserHandleForWorkspace(ws) {
    if (!ws || !('showDirectoryPicker' in window)) return null;
    // 优先从内存获取
    if (workspaceHandles[ws.id]) {
      try {
        const mode = core.getBrowserPickerMode(ws);
        const perm = await workspaceHandles[ws.id].queryPermission({ mode });
        if (perm === 'granted') return workspaceHandles[ws.id];
      } catch { /* fall through */ }
    }
    // 从 IndexedDB 加载
    const handle = await loadWorkspaceHandleById(ws.id);
    if (!handle) return null;
    try {
      const mode = core.getBrowserPickerMode(ws);
      const perm = await handle.queryPermission({ mode });
      if (perm === 'granted') {
        workspaceHandles[ws.id] = handle;
        return handle;
      }
    } catch { /* ignore */ }
    return null;
  }

  async function openWorkspaceDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(core.WS_DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(core.WS_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveWorkspaceHandle(wsId, handle) {
    workspaceHandles[wsId] = handle;
    const db = await openWorkspaceDb();
    const tx = db.transaction(core.WS_STORE, 'readwrite');
    tx.objectStore(core.WS_STORE).put(handle, wsId);
  }

  async function removeWorkspaceHandle(wsId) {
    delete workspaceHandles[wsId];
    try {
      const db = await openWorkspaceDb();
      const tx = db.transaction(core.WS_STORE, 'readwrite');
      tx.objectStore(core.WS_STORE).delete(wsId);
    } catch {}
  }

  async function loadWorkspaceHandleById(id) {
    if (!id) return null;
    // 内存优先
    if (workspaceHandles[id]) return workspaceHandles[id];
    try {
      const db = await openWorkspaceDb();
      return new Promise((resolve, reject) => {
        const store = db.transaction(core.WS_STORE).objectStore(core.WS_STORE);
        const req = store.get(id);
        req.onsuccess = () => {
          if (req.result) {
            workspaceHandles[id] = req.result;
            resolve(req.result);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      });
    } catch { return null; }
  }

  // ── 工作区授权 ──

  async function pickWorkspaceFor(wsId) {
    const ws = core.getConfig().workspaces.find(w => w.id === wsId);
    if (!ws) { alert('工作区不存在'); return; }
    if (!('showDirectoryPicker' in window)) { alert('浏览器不支持文件夹选择'); return; }
    try {
      const handle = await window.showDirectoryPicker({
        mode: core.getBrowserPickerMode(ws)
      });
      // 更新工作区名称（如果尚无自定义名称）
      if (!ws.label || ws.label === '工作区' || !ws.folderName) {
        ws.folderName = handle.name;
        if (!ws.label || ws.label === '工作区') ws.label = handle.name;
      }
      ws.folderName = handle.name;
      await saveWorkspaceHandle(wsId, handle);
      core.saveConfig();
      renderWorkspacePanel();
    } catch (err) {
      if (err.name !== 'AbortError') alert('授权失败: ' + err.message);
    }
  }

  async function unlinkWorkspace(wsId) {
    if (!confirm('确定取消此工作区的文件夹授权？')) return;
    await removeWorkspaceHandle(wsId);
    const ws = core.getConfig().workspaces.find(w => w.id === wsId);
    if (ws) ws.folderName = '';
    core.saveConfig();
    renderWorkspacePanel();
  }

  // ── 渲染工作区列表（左栏） ──

  function renderWorkspaceListUI(skipEditor) {
    const ul = document.getElementById('workspaceList');
    if (!ul) return;
    core.migrateWorkspaces();
    const config = core.getConfig();
    if (!config.workspaces.length) {
      ul.innerHTML = '<li class="panel-desc">暂无工作区</li>';
      return;
    }

    ul.innerHTML = config.workspaces.map((w) => {
      const permLabel = core.WS_PERMISSION_LABELS[w.permission] || w.permission;
      const hasHandle = !!workspaceHandles[w.id];
      const hasPath = !!(w.path?.trim());
      const isActive = w.id === config.activeWorkspaceId;

      // 授权状态图标
      let authIcon, authClass;
      if (hasHandle) {
        authIcon = '✅';
        authClass = 'ws-auth-granted';
      } else if (hasPath) {
        authIcon = '⚠️';
        authClass = 'ws-auth-missing';
      } else {
        authIcon = '⚪';
        authClass = 'ws-auth-none';
      }

      // 权限等级颜色标签
      let permClass;
      if (w.permission === 'readwrite') permClass = 'ws-perm-rw';
      else if (w.permission === 'readonly') permClass = 'ws-perm-ro';
      else permClass = 'ws-perm-none';

      return `<li class="workspace-item ${isActive ? 'active' : ''}" data-ws-id="${w.id}">
  <div class="workspace-item-main">
    <span class="workspace-item-label">${core.escapeHtml(w.label || '')}</span>
    <span class="workspace-item-path">${core.escapeHtml(w.path || '')}</span>
  </div>
  <div class="workspace-item-meta">
    <span class="${authClass}" title="${hasHandle ? '已授权文件夹' : hasPath ? '未授权文件夹' : '未配置路径'}">${authIcon}</span>
    <span class="ws-perm-badge ${permClass}">${core.escapeHtml(permLabel)}</span>
    <button type="button" class="btn-ghost btn-sm ws-pick-btn" data-ws-id="${w.id}" title="授权文件夹">📁</button>
  </div>
  <button type="button" class="btn-ghost btn-sm ws-remove" data-ws-id="${w.id}" title="删除工作区">×</button>
</li>`;
    }).join('');

    // 事件绑定：点击选择工作区
    ul.querySelectorAll('.workspace-item').forEach((li) => {
      li.addEventListener('click', (e) => {
        if (e.target.closest('.ws-remove') || e.target.closest('.ws-pick-btn')) return;
        setActiveWorkspaceId(li.dataset.wsId);
      });
    });

    // 事件绑定：授权按钮
    ul.querySelectorAll('.ws-pick-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        pickWorkspaceFor(btn.dataset.wsId);
      });
    });

    // 事件绑定：删除按钮
    ul.querySelectorAll('.ws-remove').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const wsId = btn.dataset.wsId;
        if (core.getConfig().workspaces.length <= 1) {
          alert('至少保留一个工作区');
          return;
        }
        if (!confirm('移除工作区配置？')) return;
        const config = core.getConfig();
        config.workspaces = config.workspaces.filter((w) => w.id !== wsId);
        if (config.activeWorkspaceId === wsId) {
          config.activeWorkspaceId = config.workspaces[0]?.id || null;
        }
        removeWorkspaceHandle(wsId);
        core.migrateWorkspaces();
        core.saveConfig();
        renderWorkspacePanel();
      });
    });

    if (!skipEditor) renderWorkspaceEditor();
  }

  // ── 渲染编辑面板（右栏） ──

  function renderWorkspaceEditor() {
    const el = document.getElementById('workspaceEditor');
    if (!el) return;
    const ws = core.getActiveWorkspace();
    if (!ws) {
      el.innerHTML = '<p class="panel-desc">选择左侧工作区进行编辑</p>';
      return;
    }

    const hasHandle = !!workspaceHandles[ws.id];
    const perm = ws.permission || 'readwrite';

    el.innerHTML = `
      <div class="form-group">
        <label for="wsEditLabel">名称</label>
        <input type="text" id="wsEditLabel" value="${core.escapeHtml(ws.label || '')}">
      </div>
      <div class="form-group">
        <label>文件夹</label>
        <div class="folder-picker-row">
          <button type="button" class="btn btn-sm" id="wsPickFolderBtn">📁 选择文件夹</button>
          <span id="wsFolderDisplay" class="folder-name">${core.escapeHtml(ws.folderName || '（未选择）')}</span>
        </div>
      </div>
      <div class="form-group">
        <label for="wsEditPermission">权限</label>
        <select id="wsEditPermission">
          <option value="readwrite" ${perm === 'readwrite' ? 'selected' : ''}>可读可写</option>
          <option value="readonly" ${perm === 'readonly' ? 'selected' : ''}>只读</option>
          <option value="none" ${perm === 'none' ? 'selected' : ''}>禁用文件访问</option>
        </select>
      </div>
      <div class="form-group">
        <label class="toggle-label">
          <input type="checkbox" id="wsEditBackendAccess" ${ws.backendFileAccess ? 'checked' : ''}> 允许后端
        </label>
      </div>
      <div class="form-group">
        <label for="wsEditDescription">说明</label>
        <textarea id="wsEditDescription" rows="4">${core.escapeHtml(ws.description || '')}</textarea>
      </div>
      <div class="workspace-editor-actions">
        <button type="button" class="btn-primary btn-sm" id="wsSaveBtn">保存</button>
        <button type="button" class="btn-ghost btn-sm" id="wsRefreshBtn">刷新文件树</button>
        <button type="button" class="btn-ghost btn-sm" id="wsUnlinkBtn">取消授权</button>
      </div>
      <div class="workspace-info" id="workspaceInfo"></div>
      <div class="file-tree" id="fileTree"></div>
    `;

    // 编辑事件
    ['wsEditLabel','wsEditDescription','wsEditPermission'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) { el.addEventListener('input', debouncedSaveWorkspace); el.addEventListener('change', debouncedSaveWorkspace); }
    });
    document.getElementById('wsEditBackendAccess')?.addEventListener('change', debouncedSaveWorkspace);

    // 保存按钮
    document.getElementById('wsSaveBtn')?.addEventListener('click', () => {
      readWorkspaceFormIntoActive();
      core.saveConfig();
      renderWorkspaceListUI(true);
    });

    // 选择文件夹按钮
    document.getElementById('wsPickFolderBtn')?.addEventListener('click', () => pickWorkspaceFor(ws.id));

    // 刷新文件树
    document.getElementById('wsRefreshBtn')?.addEventListener('click', renderFileTree);

    // 取消授权
    document.getElementById('wsUnlinkBtn')?.addEventListener('click', () => unlinkWorkspace(ws.id));

    renderWorkspaceStatus();
    renderFileTree();
  }

  function debouncedSaveWorkspace() {
    clearTimeout(window.__wsSaveTimer);
    window.__wsSaveTimer = setTimeout(() => {
      readWorkspaceFormIntoActive();
      core.saveConfig();
      renderWorkspaceListUI(true);
    }, 400);
  }

  function readWorkspaceFormIntoActive() {
    const ws = core.getActiveWorkspace();
    if (!ws) return;
    const label = document.getElementById('wsEditLabel');
    if (!label) return;
    ws.label = label.value.trim() || '工作区';
    ws.path = document.getElementById('wsEditPath')?.value.trim() || '';
    ws.description = document.getElementById('wsEditDescription')?.value || '';
    ws.permission = document.getElementById('wsEditPermission')?.value || 'readwrite';
    ws.backendFileAccess = !!document.getElementById('wsEditBackendAccess')?.checked;
    core.migrateWorkspaces();
  }

  function renderWorkspaceStatus() {
    const info = document.getElementById('workspaceInfo');
    if (!info) return;
    const ws = core.getActiveWorkspace();
    if (!ws) return;
    const hasHandle = !!workspaceHandles[ws.id];
    const hasPath = !!(ws.path?.trim());

    let authStatus;
    if (hasHandle) {
      authStatus = '<span style="color:var(--success)">✅ 已授权文件夹</span>';
    } else if (hasPath) {
      authStatus = '<span style="color:var(--warning)">⚠️ 未授权文件夹 — 点击「选择文件夹」授权此目录</span>';
    } else {
      authStatus = '<span style="color:var(--text-muted)">⚪ 未配置路径（可授权任意文件夹）</span>';
    }

    const permClass = ws.permission === 'readwrite' ? 'ws-perm-rw'
      : ws.permission === 'readonly' ? 'ws-perm-ro' : 'ws-perm-none';

    info.innerHTML = `<div>
      <p>权限: <strong class="ws-perm-badge ${permClass}">${core.escapeHtml(core.WS_PERMISSION_LABELS[ws.permission] || ws.permission)}</strong></p>
      <p>授权状态: ${authStatus}</p>
      <p>后端访问: ${ws.backendFileAccess ? '✅ 允许' : '❌ 禁用'}</p>
    </div>`;
  }

  // ── 文件树 ──

  async function renderFileTree() {
    const el = document.getElementById('fileTree');
    const ws = core.getActiveWorkspace();
    if (!ws || !el) return;
    const handle = workspaceHandles[ws.id];
    if (!handle) {
      el.innerHTML = '<p class="panel-desc">请先授权文件夹以查看文件列表</p>';
      return;
    }
    el.innerHTML = '<p>加载中…</p>';
    try {
      const entries = [];
      for await (const [name, entry] of handle.entries()) {
        entries.push({ name, kind: handle.kind });
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      el.innerHTML = entries.map((e) =>
        `<div>${e.kind === 'directory' ? '📁' : '📄'} ${core.escapeHtml(e.name)}</div>`
      ).join('') || '<p>空目录</p>';
    } catch (err) {
      el.innerHTML = `<p>读取失败: ${core.escapeHtml(err.message)}</p>`;
    }
  }

  // ── 工作区切换 ──

  function setActiveWorkspaceId(id) {
    core.migrateWorkspaces();
    if (!core.getConfig().workspaces.some((w) => w.id === id)) return;
    readWorkspaceFormIntoActive();
    core.getConfig().activeWorkspaceId = id;
    core.migrateWorkspaces();
    core.saveConfig();
    renderWorkspacePanel();
  }

  function addWorkspaceEntry() {
    core.migrateWorkspaces();
    const n = core.getConfig().workspaces.length + 1;
    const ws = core.createDefaultWorkspace({
      label: '工作区 ' + n,
      folderName: ''
    });
    core.getConfig().workspaces.push(ws);
    core.getConfig().activeWorkspaceId = ws.id;
    core.saveConfig();
    renderWorkspacePanel();
  }

  // ── 主渲染入口 ──

  function renderWorkspacePanel() {
    renderWorkspaceListUI(true);
    renderWorkspaceEditor();
  }

  // ── 启动时恢复 ──

  async function restoreWorkspace() {
    const config = core.getConfig();
    if (!config.workspaces.length || !('showDirectoryPicker' in window)) {
      renderWorkspacePanel();
      return;
    }
    // 逐一加载工作区的已授权句柄
    for (const ws of config.workspaces) {
      const handle = await loadWorkspaceHandleById(ws.id);
      if (handle) {
        try {
          const perm = await handle.queryPermission({ mode: core.getBrowserPickerMode(ws) });
          if (perm === 'granted') {
            workspaceHandles[ws.id] = handle;
          }
        } catch {}
      }
    }
    // 处理工作区文件夹名更新
    for (const ws of config.workspaces) {
      const handle = workspaceHandles[ws.id];
      if (handle && (!ws.folderName || ws.folderName === handle.name)) {
        ws.folderName = handle.name;
      }
    }
    renderWorkspacePanel();
  }

  // ── 公共 API ──

  window.__agentWorkspace = {
    getHandle: () => {
      const active = core.getActiveWorkspace();
      return active ? workspaceHandles[active.id] : null;
    },
    getBrowserHandleForWorkspace: getBrowserHandleForWorkspace,
    getAllHandles: getAllHandles,
  };

  window.__agentPanelsWorkspace = {
    getHandle: () => {
      const active = core.getActiveWorkspace();
      return active ? workspaceHandles[active.id] : null;
    },
    getBrowserHandleForWorkspace: getBrowserHandleForWorkspace,
    getAllHandles: getAllHandles,
    renderWorkspacePanel: renderWorkspacePanel,
    renderWorkspaceListUI: renderWorkspaceListUI,
    readWorkspaceFormIntoActive: readWorkspaceFormIntoActive,
    renderWorkspaceEditor: renderWorkspaceEditor,
    renderWorkspaceStatus: renderWorkspaceStatus,
    restoreWorkspace: restoreWorkspace,
    pickWorkspaceFor: pickWorkspaceFor,
    setActiveWorkspaceId: setActiveWorkspaceId,
    addWorkspaceEntry: addWorkspaceEntry,
    renderFileTree: renderFileTree,
  };
})();