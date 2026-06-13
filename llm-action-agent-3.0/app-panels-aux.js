(() => {
  'use strict';

  const core = window.__agentCore;
  const fmt = window.__agentFormat;
  const executor = window.__agentExecutor;
  const llm = window.__agentLLM;
  const chatUI = window.__agentChatUI;
  const utils = window.__agentPanelsUtils;
  if (!core || !fmt || !executor || !llm || !chatUI || !utils) {
    console.warn('app-panels-aux.js: some dependencies missing, will try to continue');
  }

  let attachPanelState = null;

  function readAllConfigFromUI() {
    const apiBase = document.getElementById('apiBaseUrl');
    if (!apiBase) return;
    const config = core.getConfig();
    config.apiBaseUrl = core.normalizeApiBaseUrl(apiBase.value.trim());
    config.apiKey = document.getElementById('apiKey').value.trim();
    config.modelName = document.getElementById('modelName').value.trim();
    config.temperature = parseFloat(document.getElementById('temperature').value);
    config.maxTokens = parseInt(document.getElementById('maxTokens').value, 10);
    config.backendUrl = document.getElementById('backendUrl').value.trim();
    config.backendToken = document.getElementById('backendToken').value.trim();
    readPromptEditorIntoConfig();
    const ae = document.getElementById('autoExecute');
    const cr = document.getElementById('confirmBeforeReturn');
    const an = document.getElementById('autoNameConversation');
    const sr = document.getElementById('showReasoning');
    if (ae) config.autoExecute = ae.checked;
    if (cr) config.confirmBeforeReturn = cr.checked;
    if (an) config.autoNameConversation = an.checked;
    if (sr) config.showReasoning = sr.checked;
    config.format = {
      formatType: document.getElementById('formatType').value,
      startTag: document.getElementById('startTag').value,
      endTag: document.getElementById('endTag').value,
      fenceLang: document.getElementById('fenceLang').value,
      customRegex: document.getElementById('customRegex').value,
      escapePrefix: document.getElementById('escapePrefix')?.value ?? '\\',
    };
    const wsMod = window.__agentPanelsWorkspace;
    if (wsMod) wsMod.readWorkspaceFormIntoActive();
  }

  function populateSettingsUI() {
    const config = core.getConfig();
    utils.setEl('apiBaseUrl', config.apiBaseUrl);
    utils.setEl('apiKey', config.apiKey);
    utils.setEl('modelName', config.modelName);
    utils.setEl('temperature', config.temperature);
    utils.setElText('temperatureValue', config.temperature);
    utils.setEl('maxTokens', config.maxTokens);
    utils.setEl('backendUrl', config.backendUrl);
    utils.setEl('backendToken', config.backendToken);
    utils.setChecked('autoExecute', config.autoExecute);
    utils.setChecked('confirmBeforeReturn', config.confirmBeforeReturn !== false);
    const an = document.getElementById('autoNameConversation');
    if (an) an.checked = config.autoNameConversation !== false;
    const sr = document.getElementById('showReasoning');
    if (sr) sr.checked = config.showReasoning !== false;
    utils.setEl('formatType', config.format.formatType);
    utils.setEl('startTag', config.format.startTag);
    utils.setEl('endTag', config.format.endTag);
    utils.setEl('fenceLang', config.format.fenceLang);
    utils.setEl('customRegex', config.format.customRegex);
    const ee = document.getElementById('escapePrefix');
    if (ee) ee.value = config.format.escapePrefix ?? '\\';
    utils.updateFormatUI();
    core.migrateWorkspaces();
    if (!config.workspaces.length) {
      const ws = core.createDefaultWorkspace();
      config.workspaces.push(ws);
      config.activeWorkspaceId = ws.id;
      core.saveConfig();
    }
    const wsMod = window.__agentPanelsWorkspace;
    if (wsMod) wsMod.renderWorkspacePanel();
  }

  function renderPromptPanelUI() {
    core.migratePrompts();
    const config = core.getConfig();
    if (!config.prompts.some((p) => p.id === core.getSelectedPromptId()) && core.getSelectedPromptId() !== core.BUILTIN_PROMPT_ID)
      core.setSelectedPromptId(core.BUILTIN_PROMPT_ID);
    if (config.activePromptId) core.setSelectedPromptId(config.activePromptId);
    renderPromptList();
    fillPromptEditor();
  }

  function renderPromptList() {
    const list = document.getElementById('promptList');
    if (!list) return;
    const config = core.getConfig();
    core.migratePrompts();
    const builtinActive = config.activePromptId === core.BUILTIN_PROMPT_ID;
    let html = '<button type="button" class="prompt-card ' + (core.getSelectedPromptId() === core.BUILTIN_PROMPT_ID ? 'active' : '') + ' ' + (builtinActive ? 'in-use' : '') + '" data-prompt-id="' + core.BUILTIN_PROMPT_ID + '"><span class="prompt-card-name">内置默认</span><span class="prompt-card-meta">自动生成 · 含动作列表</span></button>';
    const sorted = [...config.prompts].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    html += sorted.map((p) => {
      const inUse = config.activePromptId === p.id;
      const preview = (p.content || '').trim().slice(0, 60).replace(/\s+/g, ' ');
      return '<button type="button" class="prompt-card ' + (p.id === core.getSelectedPromptId() ? 'active' : '') + ' ' + (inUse ? 'in-use' : '') + '" data-prompt-id="' + core.escapeHtml(p.id) + '"><span class="prompt-card-name">' + core.escapeHtml(p.name || '\u672a\u547d\u540d') + '</span><span class="prompt-card-meta">' + (inUse ? '\u4f7f\u7528\u4e2d \u00b7 ' : '') + core.escapeHtml(preview || '\uff08\u7a7a\uff09') + '</span></button>';
    }).join('');
    list.innerHTML = html;
    list.querySelectorAll('.prompt-card').forEach((btn) => btn.addEventListener('click', () => selectPrompt(btn.dataset.promptId)));
    updatePromptPanelStatus();
  }

  function selectPrompt(id) {
    readPromptEditorIntoConfig();
    core.setSelectedPromptId(id || core.BUILTIN_PROMPT_ID);
    renderPromptList();
    fillPromptEditor();
  }

  function fillPromptEditor() {
    const isB = core.getSelectedPromptId() === core.BUILTIN_PROMPT_ID;
    const config = core.getConfig();
    const ne = document.getElementById('promptEditName');
    const ce = document.getElementById('promptEditContent');
    const hint = document.getElementById('promptEditorHint');
    const nameGroup = document.getElementById('promptNameGroup');
    const applyBtn = document.getElementById('applyPrompt');
    const saveBtn = document.getElementById('savePrompt');
    const dupBtn = document.getElementById('duplicatePrompt');
    const delBtn = document.getElementById('deletePrompt');

    if (nameGroup) nameGroup.style.display = isB ? 'none' : 'block';
    if (ne) { ne.disabled = isB; ne.value = isB ? '' : (config.prompts.find((p) => p.id === core.getSelectedPromptId())?.name || ''); }
    if (ce) { ce.readOnly = isB; ce.value = isB ? core.buildSystemPromptCore() : (config.prompts.find((p) => p.id === core.getSelectedPromptId())?.content || ''); }
    if (hint) hint.textContent = isB ? '\u5185\u7f6e\u6a21\u677f\u968f\u300c\u53ef\u7528\u52a8\u4f5c\u300d\u300c\u52a8\u4f5c\u683c\u5f0f\u300d\u53d8\u5316\u3002\u8981\u81ea\u5b9a\u4e49\u8bf7\u70b9\u300c\u65b0\u5efa\u300d\u6216\u300c\u590d\u5236\u4e3a\u65b0\u5efa\u300d\u3002' : '\u7f16\u8f91\u540e\u81ea\u52a8\u4fdd\u5b58\u3002\u70b9\u300c\u8bbe\u4e3a\u5f53\u524d\u300d\u540e\uff0c\u4e0b\u4e00\u6761\u6d88\u606f\u8d77\u4f7f\u7528\u6b64\u63d0\u793a\u8bcd\u3002';
    if (applyBtn) applyBtn.disabled = config.activePromptId === core.getSelectedPromptId();
    if (saveBtn) saveBtn.style.display = isB ? 'none' : 'inline-block';
    if (dupBtn) dupBtn.style.display = 'inline-block';
    if (delBtn) delBtn.style.display = isB ? 'none' : 'inline-block';
    updatePromptPanelStatus();
  }

  function readPromptEditorIntoConfig() {
    if (core.getSelectedPromptId() === core.BUILTIN_PROMPT_ID) return;
    const entry = core.getConfig().prompts.find((p) => p.id === core.getSelectedPromptId());
    if (!entry) return;
    const ne = document.getElementById('promptEditName');
    const ce = document.getElementById('promptEditContent');
    if (ne) entry.name = ne.value.trim() || '\u672a\u547d\u540d';
    if (ce) entry.content = ce.value;
    entry.updatedAt = Date.now();
  }

  function applySelectedPrompt() {
    readPromptEditorIntoConfig();
    core.getConfig().activePromptId = core.getSelectedPromptId();
    core.saveConfig();
    renderPromptList();
    fillPromptEditor();
  }

  function newPromptFromUI() { readPromptEditorIntoConfig(); const id = crypto.randomUUID(); core.getConfig().prompts.unshift({ id, name: '\u65b0\u63d0\u793a\u8bcd', content: core.buildSystemPromptCore(), updatedAt: Date.now() }); core.setSelectedPromptId(id); core.saveConfig(); renderPromptList(); fillPromptEditor(); }
  function duplicatePromptFromUI() { readPromptEditorIntoConfig(); const src = core.getSelectedPromptId() === core.BUILTIN_PROMPT_ID ? { name: '\u526f\u672c', content: core.buildSystemPromptCore() } : core.getConfig().prompts.find((p) => p.id === core.getSelectedPromptId()); if (!src) return; const id = crypto.randomUUID(); core.getConfig().prompts.unshift({ id, name: (src.name || '') + '\uff08\u526f\u672c\uff09', content: src.content || '', updatedAt: Date.now() }); core.setSelectedPromptId(id); core.saveConfig(); renderPromptList(); fillPromptEditor(); }
  function savePromptFromUI() { if (core.getSelectedPromptId() === core.BUILTIN_PROMPT_ID) return; readPromptEditorIntoConfig(); core.saveConfig(); renderPromptList(); }
  function deletePromptFromUI() { if (core.getSelectedPromptId() === core.BUILTIN_PROMPT_ID || !confirm('\u5220\u9664\uff1f')) return; const config = core.getConfig(); const idx = config.prompts.findIndex((p) => p.id === core.getSelectedPromptId()); if (idx === -1) return; config.prompts.splice(idx, 1); if (config.activePromptId === core.getSelectedPromptId()) config.activePromptId = core.BUILTIN_PROMPT_ID; core.setSelectedPromptId(core.BUILTIN_PROMPT_ID); core.saveConfig(); renderPromptList(); fillPromptEditor(); }
  function updatePromptPanelStatus() { const el = document.getElementById('promptPanelStatus'); if (!el) return; const config = core.getConfig(); core.migratePrompts(); el.textContent = '\u5f53\u524d\u7528\u4e8e\u5bf9\u8bdd\uff1a' + (config.activePromptId === core.BUILTIN_PROMPT_ID ? '\u5185\u7f6e\u9ed8\u8ba4' : (config.prompts.find((p) => p.id === config.activePromptId)?.name || '\u672a\u77e5')); }

  // Action cards with deduplication by type (last registered wins)
  function renderActionCards() {
    var el = document.getElementById('actionCards');
    if (!el) return;
    var defs = core.getActionDefs();
    var config = core.getConfig();
    var scopeLabels = { browser: '\u6d4f\u89c8\u5668\u64cd\u4f5c', file: '\u6587\u4ef6\u64cd\u4f5c', system: '\u7cfb\u7edf\u64cd\u4f5c', ui: '\u754c\u9762\u64cd\u4f5c', search: '\u641c\u7d22', plugin: '\u63d2\u4ef6', task: '\u4efb\u52a1', network: '\u7f51\u7edc' };
    var scopeIcons = { browser: '\ud83c\udf10', file: '\ud83d\udcc1', system: '\u2699\ufe0f', ui: '\ud83d\udcbb', search: '\ud83d\udd0d', plugin: '\ud83e\udde9', task: '\ud83d\udccb', network: '\ud83c\udf10' };
    var scopeOrder = ['browser', 'file', 'system', 'network', 'search', 'ui', 'plugin', 'task'];
    // Deduplicate by type: only keep the last definition for each type
    var seen = {};
    for (var i = 0; i < defs.length; i++) { seen[defs[i].type] = defs[i]; }
    var unique = [];
    for (var t in seen) { if (seen.hasOwnProperty(t)) unique.push(seen[t]); }
    // Group by scope
    var groups = {};
    for (var j = 0; j < unique.length; j++) {
      var s = unique[j].scope || 'other';
      if (!groups[s]) groups[s] = [];
      groups[s].push(unique[j]);
    }
    var html = '<div class="action-categories">';
    for (var k = 0; k < scopeOrder.length; k++) {
      var g = scopeOrder[k];
      if (!groups[g] || !groups[g].length) continue;
      html += '<div class="action-category"><h3 class="action-category-title"><span class="cat-icon">' + (scopeIcons[g] || '\ud83d\udca1') + '</span>' + (scopeLabels[g] || g) + '<span class="cat-count">' + groups[g].length + ' \u4e2a\u52a8\u4f5c</span></h3><div class="action-category-body">';
      for (var m = 0; m < groups[g].length; m++) {
        var a = groups[g][m];
        var checked = config.enabledActions.indexOf(a.type) !== -1 ? 'checked' : '';
        html += '<div class="action-card"><div class="action-card-header"><h3>' + a.type + '</h3><label class="toggle-label"><input type="checkbox" data-action="' + a.type + '" ' + checked + '> \u542f\u7528</label></div><p>' + a.desc + '</p>' + (a.dangerous ? '<div class="tags"><span class="tag danger">\u5371\u9669</span></div>' : '') + '</div>';
      }
      html += '</div></div>';
    }
    // Uncategorized actions
    var others = [];
    for (var n = 0; n < unique.length; n++) {
      if (scopeOrder.indexOf(unique[n].scope || 'other') === -1) others.push(unique[n]);
    }
    if (others.length) {
      html += '<div class="action-category"><h3 class="action-category-title"><span class="cat-icon">\ud83d\udca1</span>\u5176\u4ed6<span class="cat-count">' + others.length + ' \u4e2a\u52a8\u4f5c</span></h3><div class="action-category-body">';
      for (var p = 0; p < others.length; p++) {
        var a2 = others[p];
        var checked2 = config.enabledActions.indexOf(a2.type) !== -1 ? 'checked' : '';
        html += '<div class="action-card"><div class="action-card-header"><h3>' + a2.type + '</h3><label class="toggle-label"><input type="checkbox" data-action="' + a2.type + '" ' + checked2 + '> \u542f\u7528</label></div><p>' + (a2.desc || '') + '</p>' + (a2.dangerous ? '<div class="tags"><span class="tag danger">\u5371\u9669</span></div>' : '') + '</div>';
      }
      html += '</div></div>';
    }
    html += '</div>';
    el.innerHTML = html;
    var cbs = el.querySelectorAll('input[data-action]');
    for (var q = 0; q < cbs.length; q++) {
      cbs[q].addEventListener('change', function() {
        var type = this.dataset.action;
        if (this.checked) { if (config.enabledActions.indexOf(type) === -1) config.enabledActions.push(type); }
        else { config.enabledActions = config.enabledActions.filter(function(t) { return t !== type; }); }
        core.saveConfig();
        if (core.getSelectedPromptId() === core.BUILTIN_PROMPT_ID && typeof fillPromptEditor === 'function') fillPromptEditor();
      });
    }
  }

  // Plugin Panel
  let cachedPluginList = [];
  let selectedPluginName = null;
  async function refreshPluginCache() {
    if (!window.AgentPluginsTasks) return;
    try {
      const data = await AgentPluginsTasks.executeAction({ type: 'list_plugins' }, getPluginTaskDeps());
      cachedPluginList = data.plugins || [];
      core.setCachedPluginSummaries(cachedPluginList);
    } catch {
      const local = AgentPluginsTasks.getLocalPluginsStore ? AgentPluginsTasks.getLocalPluginsStore() : {};
      cachedPluginList = Object.values(local).map((p) => ({ name: p.name, title: p.title || p.name, usePreview: ((p.use || '').trim().split('\n')[0] || '').slice(0, 120), source: 'local' }));
      core.setCachedPluginSummaries(cachedPluginList);
    }
    renderPluginPanelUI();
  }
  function getPluginTaskDeps() { return { config: core.getConfig(), isBackendOnline: () => llm.isBackendOnline(), getActiveConversation: core.getActiveConversation, onTasksChanged: () => { chatUI.renderTaskBoardUI(); core.saveConversationsStore(); }, onPluginsChanged: () => refreshPluginCache() }; }
  function renderPluginPanelUI() {
    const list = document.getElementById('pluginList'); const help = document.getElementById('pluginFormatHelp');
    if (!window.AgentPluginsTasks) return;
    if (help) help.textContent = AgentPluginsTasks.PLUGIN_FORMAT_HELP || '';
    if (list) {
      list.innerHTML = AgentPluginsTasks.renderPluginListHtml ? AgentPluginsTasks.renderPluginListHtml(cachedPluginList || [], selectedPluginName) : '<p>\u63d2\u4ef6\u5217\u8868</p>';
      list.querySelectorAll('.plugin-card').forEach((btn) => { btn.addEventListener('click', () => selectPluginForEdit(btn.dataset.pluginName)); });
    }
  }
  async function selectPluginForEdit(name) { if (!name || !window.AgentPluginsTasks) return; selectedPluginName = name; core.setSelectedPluginName(name); renderPluginPanelUI(); try { const plugin = await AgentPluginsTasks.executeAction({ type: 'read_plugin', name }, getPluginTaskDeps()); utils.setEl('pluginEditName', plugin.name || name); utils.setEl('pluginEditTitle', plugin.title || ''); const infoEl = document.getElementById('pluginEditInfo'); const useEl = document.getElementById('pluginEditUse'); if (infoEl) infoEl.value = plugin.info || ''; if (useEl) useEl.value = plugin.use || ''; setPluginSaveStatus(''); } catch (err) { setPluginSaveStatus('\u52a0\u8f7d\u5931\u8d25: ' + err.message, true); } }
  function clearPluginEditor() { selectedPluginName = null; core.setSelectedPluginName(null); utils.setEl('pluginEditName', ''); utils.setEl('pluginEditTitle', ''); const ie = document.getElementById('pluginEditInfo'); const ue = document.getElementById('pluginEditUse'); if (ie) ie.value = ''; if (ue) ue.value = ''; renderPluginPanelUI(); setPluginSaveStatus(''); }
  function setPluginSaveStatus(msg, isError) { const el = document.getElementById('pluginSaveStatus'); if (!el) return; el.textContent = msg || ''; el.style.color = isError ? 'var(--danger)' : 'var(--text-muted)'; }
  async function savePluginFromUI() { if (!window.AgentPluginsTasks) return; const name = document.getElementById('pluginEditName')?.value.trim(); if (!name) { setPluginSaveStatus('\u8bf7\u586b\u5199\u540d\u79f0', true); return; } try { const result = await AgentPluginsTasks.executeAction({ type: 'save_plugin', name, title: document.getElementById('pluginEditTitle')?.value.trim() || name, info: document.getElementById('pluginEditInfo')?.value || '', use: document.getElementById('pluginEditUse')?.value || '' }, getPluginTaskDeps()); selectedPluginName = name; await refreshPluginCache(); setPluginSaveStatus('\u5df2\u4fdd\u5b58\u81f3 ' + (result.savedTo || 'local')); } catch (err) { setPluginSaveStatus('\u4fdd\u5b58\u5931\u8d25: ' + err.message, true); } }
  async function deletePluginFromUI() { const name = document.getElementById('pluginEditName')?.value.trim(); if (!name || !confirm('\u786e\u5b9a\u5220\u9664\u63d2\u4ef6\u300c' + name + '\u300d\uff1f')) return; try { await AgentPluginsTasks.executeAction({ type: 'delete_plugin', name }, getPluginTaskDeps()); clearPluginEditor(); await refreshPluginCache(); setPluginSaveStatus('\u5df2\u5220\u9664'); } catch (err) { setPluginSaveStatus('\u5220\u9664\u5931\u8d25: ' + err.message, true); } }

  // Memory Panel
  let cachedMemoryList = [];
  let selectedMemoryName = null;
  async function refreshMemoryCache() {
    if (!window.AgentMemories) return;
    try {
      const data = await AgentMemories.executeAction({ type: 'list_memories' }, getMemoryDeps());
      cachedMemoryList = data.memories || [];
      core.setCachedMemorySummaries(cachedMemoryList);
    } catch {
      const local = AgentMemories.getLocalMemoriesStore ? AgentMemories.getLocalMemoriesStore() : {};
      cachedMemoryList = Object.values(local).map((m) => ({ name: m.name, title: m.title || m.name, desc: m.desc || '', contentPreview: ((m.content || '').trim().split('\n')[0] || '').slice(0, 100), source: 'local' }));
      core.setCachedMemorySummaries(cachedMemoryList);
    }
    renderMemoryPanelUI();
  }
  function getMemoryDeps() { return { config: core.getConfig(), isBackendOnline: () => llm.isBackendOnline(), onMemoriesChanged: () => refreshMemoryCache() }; }
  function renderMemoryPanelUI() {
    const list = document.getElementById('memoryList'); const help = document.getElementById('memoryFormatHelp');
    if (!window.AgentMemories) return;
    if (help) help.textContent = AgentMemories.MEMORY_FORMAT_HELP || '';
    if (list) {
      list.innerHTML = AgentMemories.renderMemoryListHtml ? AgentMemories.renderMemoryListHtml(cachedMemoryList || [], selectedMemoryName) : '<p>\u8bb0\u5fc6\u5217\u8868</p>';
      list.querySelectorAll('.memory-card').forEach((btn) => { btn.addEventListener('click', () => selectMemoryForEdit(btn.dataset.memoryName)); });
    }
  }
  async function selectMemoryForEdit(name) { if (!name || !window.AgentMemories) return; selectedMemoryName = name; core.setSelectedMemoryName(name); renderMemoryPanelUI(); try { const memory = await AgentMemories.executeAction({ type: 'read_memory', name }, getMemoryDeps()); utils.setEl('memoryEditName', memory.name || name); utils.setEl('memoryEditTitle', memory.title || ''); utils.setEl('memoryEditDesc', memory.desc || ''); const ce = document.getElementById('memoryEditContent'); if (ce) ce.value = memory.content || ''; setMemorySaveStatus(''); } catch (err) { setMemorySaveStatus('\u52a0\u8f7d\u5931\u8d25: ' + err.message, true); } }
  function clearMemoryEditor() { selectedMemoryName = null; core.setSelectedMemoryName(null); utils.setEl('memoryEditName', ''); utils.setEl('memoryEditTitle', ''); utils.setEl('memoryEditDesc', ''); const ce = document.getElementById('memoryEditContent'); if (ce) ce.value = ''; renderMemoryPanelUI(); setMemorySaveStatus(''); }
  function setMemorySaveStatus(msg, isError) { const el = document.getElementById('memorySaveStatus'); if (!el) return; el.textContent = msg || ''; el.style.color = isError ? 'var(--danger)' : 'var(--text-muted)'; }
  async function saveMemoryFromUI() { if (!window.AgentMemories) return; const name = document.getElementById('memoryEditName')?.value.trim(); if (!name) { setMemorySaveStatus('\u8bf7\u586b\u5199\u540d\u79f0', true); return; } try { const result = await AgentMemories.executeAction({ type: 'save_memory', name, title: document.getElementById('memoryEditTitle')?.value.trim() || name, desc: document.getElementById('memoryEditDesc')?.value.trim(), content: document.getElementById('memoryEditContent')?.value || '' }, getMemoryDeps()); selectedMemoryName = name; await refreshMemoryCache(); setMemorySaveStatus('\u5df2\u4fdd\u5b58\u81f3 ' + (result.savedTo || 'local')); } catch (err) { setMemorySaveStatus('\u4fdd\u5b58\u5931\u8d25: ' + err.message, true); } }
  async function deleteMemoryFromUI() { const name = document.getElementById('memoryEditName')?.value.trim(); if (!name || !confirm('\u786e\u5b9a\u5220\u9664\u8bb0\u5fc6\u300c' + name + '\u300d\uff1f')) return; try { await AgentMemories.executeAction({ type: 'delete_memory', name }, getMemoryDeps()); clearMemoryEditor(); await refreshPluginCache(); setMemorySaveStatus('\u5df2\u5220\u9664'); } catch (err) { setMemorySaveStatus('\u5220\u9664\u5931\u8d25: ' + err.message, true); } }
  function migrateLegacyMemory() { if (!window.AgentMemories) return; const config = core.getConfig(); const legacy = config.persistentMemory || localStorage.getItem(core.LEGACY_MEMORY_KEY) || ''; if (AgentMemories.migrateLegacySingleMemory && legacy) { if (AgentMemories.migrateLegacySingleMemory(getMemoryDeps(), legacy)) { delete config.persistentMemory; localStorage.removeItem(core.LEGACY_MEMORY_KEY); core.saveConfig(); } } }

  function renderLogs() {
    const el = document.getElementById('logList'); if (!el) return;
    const logs = core.getLogs();
    if (!logs.length) { el.innerHTML = '<p>\u6682\u65e0\u8bb0\u5f55</p>'; return; }
    el.innerHTML = logs.map((l) => {
      const cls = l.ok ? 'success' : 'error';
      const resultStr = typeof l.result === 'object' ? JSON.stringify(l.result, null, 2).slice(0, 500) : String(l.result).slice(0, 500);
      return '<div class="log-entry ' + cls + '"><div class="log-time">' + (l.time ? new Date(l.time).toLocaleString() : '') + '</div><div class="log-action">' + l.action.type + '</div><div class="log-result">' + core.escapeHtml(resultStr) + '</div></div>';
    }).join('');
  }
  function clearLogs() { core.setLogs([]); renderLogs(); core.saveConversationsStore(); }

  function populateManualActionSelect() { const sel = document.getElementById('manualActionType'); if (!sel) return; const enabled = core.getActionDefs().filter((a) => core.getConfig().enabledActions.includes(a.type)); sel.innerHTML = enabled.map((a) => '<option value="' + a.type + '">' + a.type + '</option>').join(''); }
  function fillManualActionExample(type) { const def = core.getActionDefs().find((a) => a.type === type); const ta = document.getElementById('manualActionJson'); if (ta) ta.value = JSON.stringify(def?.example || { type }, null, 2); }
  function toggleManualActionPanel() { const panel = document.getElementById('manualActionPanel'); if (!panel) return; closeChatAttachPanel(); panel.classList.toggle('hidden'); if (!panel.classList.contains('hidden')) { populateManualActionSelect(); fillManualActionExample(document.getElementById('manualActionType')?.value); } }
  async function runManualActionFromPanel() { const ta = document.getElementById('manualActionJson'); if (!ta) return; let action; try { action = JSON.parse(ta.value.trim()); } catch { alert('JSON \u65e0\u6548'); return; } if (!action?.type) { alert('\u9700\u8981 type'); return; } document.getElementById('manualActionPanel')?.classList.add('hidden'); chatUI.appendMessage('system', '\u624b\u52a8\u6267\u884c: ' + action.type); try { const results = await executor.runActions([action]); chatUI.appendMessage('system', results.filter((r) => r.ok).length + '/' + results.length + ' \u6210\u529f'); } catch (err) { chatUI.appendMessage('system', '\u5931\u8d25: ' + err.message); } }

  function openChatAttachPanel(mode) {
    document.getElementById('manualActionPanel')?.classList.add('hidden');
    const panel = document.getElementById('chatAttachPanel');
    const body = document.getElementById('chatAttachBody');
    const titleEl = document.getElementById('chatAttachTitle');
    if (!panel || !body || !titleEl) return;
    const htmls = { plugin: '<div class="form-group"><label>\u64cd\u4f5c</label><select id="attachPlOp"><option value="list">list_plugins</option><option value="read">read_plugin</option></select><label>\u540d\u79f0</label><input type="text" id="attachPlName" placeholder="\u63d2\u4ef6\u540d"></div>', memory: '<div class="form-group"><label>\u64cd\u4f5c</label><select id="attachMemOp"><option value="list">list_memories</option><option value="read">read_memory</option></select><label>\u540d\u79f0</label><input type="text" id="attachMemName" placeholder="\u8bb0\u5fc6\u540d"></div>', file: '<div class="form-group"><label>\u64cd\u4f5c</label><select id="attachFileOp"><option value="read">read_file</option><option value="list">list_dir</option></select><label>\u8def\u5f84</label><input type="text" id="attachFilePath" placeholder="path"></div>', task: '<div class="form-group"><label>\u64cd\u4f5c</label><select id="attachTaskOp"><option value="list">task_list</option><option value="add">task_add</option></select><label>\u6807\u9898</label><input type="text" id="attachTaskTitle" placeholder="\u4efb\u52a1\u6807\u9898"></div>' };
    if (!htmls[mode]) return;
    titleEl.textContent = { plugin: '\u9644\u52a0\u63d2\u4ef6', memory: '\u9644\u52a0\u8bb0\u5fc6', file: '\u9644\u52a0\u6587\u4ef6', task: '\u9644\u52a0\u4efb\u52a1' }[mode];
    body.innerHTML = htmls[mode];
    panel.classList.remove('hidden');
    attachPanelState = { mode };
  }
  function closeChatAttachPanel() { document.getElementById('chatAttachPanel')?.classList.add('hidden'); attachPanelState = null; }
  async function handleAttachToInput() { const mode = attachPanelState?.mode; if (!mode) return; let text = ''; if (mode === 'plugin') { const op = document.getElementById('attachPlOp')?.value; const name = document.getElementById('attachPlName')?.value?.trim(); if (op === 'list') text = fmt.formatActionBlock({ type: 'list_plugins' }); else if (name) text = fmt.formatActionBlock({ type: 'read_plugin', name }); } else if (mode === 'memory') { const op = document.getElementById('attachMemOp')?.value; const name = document.getElementById('attachMemName')?.value?.trim(); if (op === 'list') text = fmt.formatActionBlock({ type: 'list_memories' }); else if (name) text = fmt.formatActionBlock({ type: 'read_memory', name }); } else if (mode === 'file') { const op = document.getElementById('attachFileOp')?.value; const path = document.getElementById('attachFilePath')?.value?.trim() || '.'; if (op === 'list') text = fmt.formatActionBlock({ type: 'list_dir', path }); else text = fmt.formatActionBlock({ type: 'read_file', path }); } else if (mode === 'task') { const op = document.getElementById('attachTaskOp')?.value; if (op === 'list') text = fmt.formatActionBlock({ type: 'task_list' }); else { const title = document.getElementById('attachTaskTitle')?.value?.trim(); if (title) text = fmt.formatActionBlock({ type: 'task_add', title }); } } if (text) { utils.insertIntoChatInput(text); closeChatAttachPanel(); } }
  async function handleAttachRunNow() {
    const mode = attachPanelState?.mode; if (!mode) return;
    let action = null;
    if (mode === 'plugin') { const op = document.getElementById('attachPlOp')?.value; const name = document.getElementById('attachPlName')?.value?.trim(); if (op === 'list') action = { type: 'list_plugins' }; else if (name) action = { type: 'read_plugin', name }; }
    else if (mode === 'memory') { const op = document.getElementById('attachMemOp')?.value; const name = document.getElementById('attachMemName')?.value?.trim(); if (op === 'list') action = { type: 'list_memories' }; else if (name) action = { type: 'read_memory', name }; }
    else if (mode === 'file') { const op = document.getElementById('attachFileOp')?.value; const path = document.getElementById('attachFilePath')?.value?.trim() || '.'; action = op === 'list' ? { type: 'list_dir', path } : { type: 'read_file', path }; }
    else if (mode === 'task') { const op = document.getElementById('attachTaskOp')?.value; if (op === 'list') action = { type: 'task_list' }; else { const title = document.getElementById('attachTaskTitle')?.value?.trim(); if (title) action = { type: 'task_add', title }; } }
    if (!action) return;
    closeChatAttachPanel();
    chatUI.appendMessage('system', '\u6267\u884c: ' + action.type);
    const results = await executor.runActions([action]);
    chatUI.appendMessage('system', results.filter((r) => r.ok).length + '/' + results.length + ' \u6210\u529f');
  }

  window.__agentPanelsAux = {
    readAllConfigFromUI, populateSettingsUI,
    renderPromptPanelUI, selectPrompt, fillPromptEditor,
    readPromptEditorIntoConfig, applySelectedPrompt,
    newPromptFromUI, duplicatePromptFromUI, savePromptFromUI, deletePromptFromUI,
    updatePromptPanelStatus, renderPromptList,
    renderActionCards,
    refreshPluginCache, renderPluginPanelUI,
    selectPluginForEdit, clearPluginEditor,
    savePluginFromUI, deletePluginFromUI,
    refreshMemoryCache, renderMemoryPanelUI,
    selectMemoryForEdit, clearMemoryEditor,
    saveMemoryFromUI, deleteMemoryFromUI,
    migrateLegacyMemory,
    renderLogs, clearLogs,
    openChatAttachPanel, closeChatAttachPanel,
    handleAttachToInput, handleAttachRunNow,
    toggleManualActionPanel, runManualActionFromPanel,
    populateManualActionSelect, fillManualActionExample,
  };
})();