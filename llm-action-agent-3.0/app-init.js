(() => {
  'use strict';

  const core = window.__agentCore;
  const fmt = window.__agentFormat;
  const executor = window.__agentExecutor;
  const llm = window.__agentLLM;
  const chatUI = window.__agentChatUI;
  const panels = window.__agentPanels;

  if (!core || !fmt || !executor || !llm || !chatUI || !panels) {
    const missing = [
      !core && 'app-core', !fmt && 'app-format', !executor && 'app-executor',
      !llm && 'app-llm', !chatUI && 'app-chat-ui', !panels && 'app-panels-ui',
    ].filter(Boolean).join(', ');
    console.error('init failed: missing modules:', missing);
    return;
  }

  let worker = null;
  function setupWorker(cfg) {
    try {
      worker = new Worker('app-worker.js');
      window.__agentWorker = worker;
      const fmtConfig = cfg?.format || {};
      worker.postMessage({ type: 'setConfig', data: { startTag: fmtConfig.startTag || '<action_fix>', endTag: fmtConfig.endTag || '</action_fix>', escapePrefix: fmtConfig.escapePrefix || '\\' } });
      worker.onmessage = function(e) {
        const { type, id, html, actions, msgId, feedback } = e.data;
        if (type === 'messageHtml' && window.__agentWorkerCallbacks?.[id]) { window.__agentWorkerCallbacks[id](html, msgId); delete window.__agentWorkerCallbacks[id]; }
        else if (type === 'parsedActions' && window.__agentWorkerCallbacks?.[id]) { window.__agentWorkerCallbacks[id](actions); delete window.__agentWorkerCallbacks[id]; }
        else if (type === 'feedbackHtml' && window.__agentWorkerCallbacks?.[id]) { window.__agentWorkerCallbacks[id](feedback); delete window.__agentWorkerCallbacks[id]; }
      };
      window.__agentWorkerCallbacks = {};
    } catch (e) { console.warn('Worker init failed, falling back to main thread:', e.message); }
  }

  async function init() {
    const cfg = core.loadConfig();
    core.setConfig(cfg);
    const savedVersion = core.getVersion();
    const versionDisplay = document.getElementById('versionDisplay');
    if (versionDisplay) versionDisplay.textContent = savedVersion;
    setupWorker(cfg);
    const loadedFromFiles = await llm.loadConfigFromFiles().catch(() => false);
    panels.populateSettingsUI();
    panels.renderActionCards();
    panels.renderLogs();
    panels.renderPromptPanelUI();

    await core.migrateConversationsToDb();
    const convData = await core.loadConversationsStoreAsync();
    core.setConvStore(convData);
    panels.initConversations();

    if (window.AgentStats) {
      window.AgentStats.migrateFromConversations(core.getConvStore().conversations);
      window.AgentStats.bindPanel({ escapeHtml: core.escapeHtml, getConversations: () => core.getConvStore().conversations });
    }

    await panels.refreshMemoryCache();
    await panels.refreshPluginCache();
    chatUI.renderTaskBoardUI();
    panels.renderPluginPanelUI();
    panels.migrateLegacyMemory();

    core.migrateWorkspaces();
    const config = core.getConfig();
    if (!config.workspaces.length) {
      const ws = core.createDefaultWorkspace();
      config.workspaces.push(ws);
      config.activeWorkspaceId = ws.id;
      core.saveConfig();
    }
    panels.renderWorkspacePanel();

    let backendWasOnline = await llm.isBackendOnline();
    if (loadedFromFiles) backendWasOnline = true;
    panels.checkBackendStatus();
    panels.restoreWorkspace();
    panels.bindAutoSave();
    panels.bindTitleEdit();

    if (config.ui?.sidebarCollapsed) panels.setSidebarCollapsed(true);
    const lastPanel = config.ui?.lastPanel === 'tasks' ? 'chat' : (config.ui?.lastPanel || 'chat');
    chatUI.switchPanel(lastPanel);
    setInterval(panels.checkBackendStatus, 15000);

    const statusText = document.getElementById('backendStatusText');
    const statusDot = document.getElementById('backendStatus');
    if (statusText) { statusText.style.cursor = 'pointer'; statusText.title = '点击检测后端连接'; statusText.addEventListener('click', panels.checkBackendStatus); }
    if (statusDot) { statusDot.style.cursor = 'pointer'; statusDot.addEventListener('click', panels.checkBackendStatus); }

    if (chatUI._initScroll) chatUI._initScroll();
    if (chatUI.bindTaskBoardToggle) chatUI.bindTaskBoardToggle();
    bindGlobalEvents();
    bindChatEvents();
    bindPromptEvents();
    bindFormatEvents();
    bindPluginMemoryEvents();
    bindWorkspaceButtons();
    bindTaskEvents();
    bindLogEvents();
    bindStatsEvents();
    bindContextPoolEvents();
  }

  function bindGlobalEvents() {
    document.querySelectorAll('.nav-item').forEach((btn) => { btn.addEventListener('click', () => chatUI.switchPanel(btn.dataset.panel)); });
    const versionBadge = document.getElementById('versionBadge');
  }

  function bindContextPoolEvents() {
    document.getElementById('toggleContextPool')?.addEventListener('click', function() {
      if (window.__agentChatUI?.toggleContextPool) window.__agentChatUI.toggleContextPool();
    });
    document.getElementById('closeContextPool')?.addEventListener('click', function() {
      var panel = document.getElementById('contextPoolFloat');
      if (panel) panel.classList.add('hidden');
    });
  }

  function bindLogEvents() {
    document.getElementById('clearContext')?.addEventListener('click', chatUI.clearContext);
    document.getElementById('clearChat')?.addEventListener('click', chatUI.clearChatMessages);
    document.getElementById('exportChat')?.addEventListener('click', () => { const blob = new Blob([JSON.stringify(core.getMessages(), null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'chat-export.json'; a.click(); });
  }

  function bindChatEvents() {
    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
      chatInput.addEventListener('input', () => { chatInput.style.height = 'auto'; chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + 'px'; chatUI.updateSendBtn(); });
      chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatUI.sendMessage(); } });
    }
    document.getElementById('sendBtn')?.addEventListener('click', () => { if (chatUI.isStreaming()) chatUI.abortChatGeneration(); else chatUI.sendMessage(); });
    document.getElementById('newConversation')?.addEventListener('click', chatUI.startNewConversation);
    document.getElementById('toggleManualAction')?.addEventListener('click', panels.toggleManualActionPanel);
    document.getElementById('closeManualAction')?.addEventListener('click', () => { document.getElementById('manualActionPanel')?.classList.add('hidden'); });
    document.getElementById('manualActionType')?.addEventListener('change', (e) => { panels.fillManualActionExample(e.target.value); });
    document.getElementById('runManualAction')?.addEventListener('click', panels.runManualActionFromPanel);
    const attachModes = { 'quickPlugin': 'plugin', 'quickMemory': 'memory', 'quickFile': 'file', 'quickTask': 'task' };
    Object.entries(attachModes).forEach(([id, mode]) => { document.getElementById(id)?.addEventListener('click', () => panels.openChatAttachPanel(mode)); });
    document.getElementById('closeChatAttach')?.addEventListener('click', panels.closeChatAttachPanel);
    document.getElementById('attachToInput')?.addEventListener('click', panels.handleAttachToInput);
    document.getElementById('attachRunNow')?.addEventListener('click', panels.handleAttachRunNow);
    document.getElementById('confirmReturnToLLM')?.addEventListener('click', async () => { if (window.__agentChatUI?.confirmReturnToLLM) await window.__agentChatUI.confirmReturnToLLM(); });
    document.getElementById('dismissFeedback')?.addEventListener('click', chatUI.hideFeedbackPanel);
    document.getElementById('autoExecute')?.addEventListener('change', (e) => { core.getConfig().autoExecute = e.target.checked; core.saveConfig(); });
    document.getElementById('confirmBeforeReturn')?.addEventListener('change', (e) => { core.getConfig().confirmBeforeReturn = e.target.checked; core.saveConfig(); });
    document.getElementById('autoNameConversation')?.addEventListener('change', (e) => { core.getConfig().autoNameConversation = e.target.checked; core.saveConfig(); });
    document.getElementById('showReasoning')?.addEventListener('change', (e) => { core.getConfig().showReasoning = e.target.checked; core.saveConfig(); chatUI.renderChatMessages(); });
  }

  function bindPromptEvents() {
    document.getElementById('newPrompt')?.addEventListener('click', panels.newPromptFromUI);
    document.getElementById('duplicatePrompt')?.addEventListener('click', panels.duplicatePromptFromUI);
    document.getElementById('savePrompt')?.addEventListener('click', panels.savePromptFromUI);
    document.getElementById('deletePrompt')?.addEventListener('click', panels.deletePromptFromUI);
    document.getElementById('applyPrompt')?.addEventListener('click', panels.applySelectedPrompt);
  }

  function bindFormatEvents() {
    document.getElementById('formatType')?.addEventListener('change', panels.updateFormatUI);
    ['startTag', 'endTag', 'fenceLang', 'customRegex'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', () => {
        const config = core.getConfig();
        config.format[id === 'startTag' ? 'startTag' : id === 'endTag' ? 'endTag' : id === 'fenceLang' ? 'fenceLang' : 'customRegex'] = document.getElementById(id).value;
        const preview = document.getElementById('formatPreview');
        if (preview) preview.textContent = fmt.getFormatPreview();
      });
    });
    document.getElementById('saveFormat')?.addEventListener('click', () => { panels.readAllConfigFromUI(); core.saveConfig(); if (core.getSelectedPromptId() === core.BUILTIN_PROMPT_ID) panels.fillPromptEditor(); });
    document.getElementById('testFormatParse')?.addEventListener('click', () => { panels.readAllConfigFromUI(); const text = document.getElementById('formatTestInput').value; const actions = fmt.parseActions(text); document.getElementById('formatTestResult').textContent = actions.length ? JSON.stringify(actions, null, 2) : '未解析到任何动作'; });
  }

  function bindPluginMemoryEvents() {
    document.getElementById('refreshPlugins')?.addEventListener('click', panels.refreshPluginCache);
    document.getElementById('newPlugin')?.addEventListener('click', panels.clearPluginEditor);
    document.getElementById('savePlugin')?.addEventListener('click', panels.savePluginFromUI);
    document.getElementById('deletePlugin')?.addEventListener('click', panels.deletePluginFromUI);
    document.getElementById('newMemory')?.addEventListener('click', panels.clearMemoryEditor);
    document.getElementById('refreshMemories')?.addEventListener('click', panels.refreshMemoryCache);
    document.getElementById('saveMemory')?.addEventListener('click', panels.saveMemoryFromUI);
    document.getElementById('deleteMemory')?.addEventListener('click', panels.deleteMemoryFromUI);
  }

  function bindWorkspaceButtons() { document.getElementById('addWorkspace')?.addEventListener('click', panels.addWorkspaceEntry); }
  function bindTaskEvents() {
    document.getElementById('clearChatTasks')?.addEventListener('click', () => {
      const conv = core.getActiveConversation();
      if (!conv?.tasks?.length) return;
      if (!confirm('确定清空当前对话的任务板？')) return;
      conv.tasks = [];
      core.saveConversationsStore();
      chatUI.renderTaskBoardUI();
    });
  }
  function bindLogEvents() { document.getElementById('clearLogs')?.addEventListener('click', panels.clearLogs); }
  function bindStatsEvents() {
    document.getElementById('refreshStats')?.addEventListener('click', () => { window.AgentStats?.renderPanel({ escapeHtml: core.escapeHtml, getConversations: () => core.getConvStore().conversations }); });
    document.getElementById('clearStats')?.addEventListener('click', () => { if (!confirm('确定清空所有统计数据？')) return; window.AgentStats?.clearAll(); });
    document.getElementById('statsPeriod')?.addEventListener('change', () => { window.AgentStats?.renderPanel({ escapeHtml: core.escapeHtml, getConversations: () => core.getConvStore().conversations }); });
  }

  chatUI.confirmReturnToLLM = async () => { const cb = window.__agentPendingReturnCallback; if (cb) { window.__agentPendingReturnCallback = null; await cb(); } };
  const origShowFeedback = chatUI.showFeedbackPanel;
  chatUI.showFeedbackPanel = function(feedbackText, onConfirm) { window.__agentPendingReturnCallback = onConfirm; origShowFeedback.call(this, feedbackText, onConfirm); };

  init().catch((err) => {
    console.error('init failed', err);
    const banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.85);color:#fff;padding:24px;font:14px/1.5 sans-serif;overflow:auto';
    banner.innerHTML = '<h2 style="margin:0 0 12px">页面初始化失败</h2><pre style="white-space:pre-wrap"></pre><p style="margin-top:16px">请刷新页面；若仍失败，打开浏览器控制台查看详情。</p>';
    banner.querySelector('pre').textContent = err?.stack || String(err);
    document.body.appendChild(banner);
  });
})();