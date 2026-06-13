(() => {
  'use strict';

  const core = window.__agentCore;
  const fmt = window.__agentFormat;
  const executor = window.__agentExecutor;
  const llm = window.__agentLLM;
  const chatUI = window.__agentChatUI;
  const panels = window.__agentPanels;

  if (!core || !fmt || !executor || !llm || !chatUI || !panels) {
    const missing = [!core && 'app-core', !fmt && 'app-format', !executor && 'app-executor', !llm && 'app-llm', !chatUI && 'app-chat-ui', !panels && 'app-panels-ui'].filter(Boolean).join(', ');
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
        const { type, id, html, actions } = e.data;
        if (type === 'messageHtml' && window.__agentWorkerCallbacks?.[id]) { window.__agentWorkerCallbacks[id](html); delete window.__agentWorkerCallbacks[id]; }
        else if (type === 'parsedActions' && window.__agentWorkerCallbacks?.[id]) { window.__agentWorkerCallbacks[id](actions); delete window.__agentWorkerCallbacks[id]; }
      };
      window.__agentWorkerCallbacks = {};
    } catch (e) { console.warn('Worker init failed:', e.message); }
  }

  async function init() {
    const cfg = core.loadConfig();
    core.setConfig(cfg);
    const savedVersion = core.getVersion();
    const versionDisplay = document.getElementById('versionDisplay');
    if (versionDisplay) versionDisplay.textContent = savedVersion;
    setupWorker(cfg);
    await llm.loadConfigFromFiles().catch(() => false);
    panels.populateSettingsUI();

    await core.migrateConversationsToDb();
    const convData = await core.loadConversationsStoreAsync();
    core.setConvStore(convData);

    panels.initConversations();
    chatUI.renderTaskBoardUI();

    const config = core.getConfig();
    if (!config.workspaces.length) { const ws = core.createDefaultWorkspace(); config.workspaces.push(ws); config.activeWorkspaceId = ws.id; core.saveConfig(); }
    panels.renderWorkspacePanel();

    panels.restoreWorkspace();

    panels.bindAutoSave();
    panels.bindTitleEdit();

    if (config.ui?.sidebarCollapsed) panels.setSidebarCollapsed(true);

    const lastPanel = config.ui?.lastPanel === 'tasks' ? 'chat' : (config.ui?.lastPanel || 'chat');
    chatUI.switchPanel(lastPanel);

    if (chatUI._initScroll) chatUI._initScroll();
    if (chatUI.bindTaskBoardToggle) chatUI.bindTaskBoardToggle();
    bindGlobalEvents();
    bindChatEvents();
    bindTaskEvents();
  }

  function bindGlobalEvents() {
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        chatUI.switchPanel(btn.dataset.panel);
        if (btn.dataset.panel === 'workspace') {
          panels.renderWorkspacePanel();
        }
      });
    });

    const versionBadge = document.getElementById('versionBadge');
    const versionDisplay = document.getElementById('versionDisplay');
    const versionInput = document.getElementById('versionInput');
    if (versionBadge && versionDisplay && versionInput) {
      function cancelVersionEdit() { versionInput.classList.add('hidden'); versionDisplay.classList.remove('hidden'); versionInput.value = versionDisplay.textContent; }
      function confirmVersionEdit() { const v = versionInput.value.trim() || versionDisplay.textContent; if (v !== versionDisplay.textContent) core.setVersion(v); cancelVersionEdit(); }
      versionBadge.addEventListener('dblclick', (e) => { e.stopPropagation(); versionInput.value = versionDisplay.textContent; versionDisplay.classList.add('hidden'); versionInput.classList.remove('hidden'); versionInput.focus(); versionInput.select(); });
      versionInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmVersionEdit(); } if (e.key === 'Escape') { e.preventDefault(); cancelVersionEdit(); } });
      versionInput.addEventListener('blur', cancelVersionEdit);
    }

    document.getElementById('toggleSidebar')?.addEventListener('click', () => { const collapsed = !document.getElementById('sidebar').classList.contains('collapsed'); panels.setSidebarCollapsed(collapsed); });
    document.getElementById('sidebarExpand')?.addEventListener('click', () => panels.setSidebarCollapsed(false));
    document.getElementById('newConversation')?.addEventListener('click', chatUI.startNewConversation);
    document.getElementById('newConvGroup')?.addEventListener('click', () => { const name = prompt('分组名称', '新分组'); if (name == null) return; core.createConvGroup(name.trim() || '新分组'); core.saveConversationsStore(); panels.renderConversationList(); });
    document.getElementById('renameConversation')?.addEventListener('click', () => { alert('请在对话中告诉 AI 你想把对话改成什么名字，AI 会自动执行 rename_conversation 动作。'); });
    document.getElementById('clearContext')?.addEventListener('click', chatUI.clearContext);
    document.getElementById('clearChat')?.addEventListener('click', chatUI.clearChatMessages);

    // 已移除立即保存按钮（改动即保存）

    document.getElementById('exportChat')?.addEventListener('click', () => { const blob = new Blob([JSON.stringify(core.getMessages(), null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'chat-export.json'; a.click(); });
  }

  function bindChatEvents() {
    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
      chatInput.addEventListener('input', () => { chatInput.style.height = 'auto'; chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + 'px'; chatUI.updateSendBtn(); });
      chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatUI.sendMessage(); } });
    }
    document.getElementById('sendBtn')?.addEventListener('click', () => { if (chatUI.isStreaming()) chatUI.abortChatGeneration(); else chatUI.sendMessage(); });

    document.getElementById('confirmReturnToLLM')?.addEventListener('click', async () => { if (window.__agentChatUI?.confirmReturnToLLM) await window.__agentChatUI.confirmReturnToLLM(); });
    document.getElementById('dismissFeedback')?.addEventListener('click', chatUI.hideFeedbackPanel);

    document.getElementById('autoExecute')?.addEventListener('change', (e) => { core.getConfig().autoExecute = e.target.checked; core.saveConfig(); });
    document.getElementById('confirmBeforeReturn')?.addEventListener('change', (e) => { core.getConfig().confirmBeforeReturn = e.target.checked; core.saveConfig(); });
    document.getElementById('showReasoning')?.addEventListener('change', (e) => { core.getConfig().showReasoning = e.target.checked; core.saveConfig(); chatUI.renderChatMessages(); });
  }

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

  chatUI.confirmReturnToLLM = async () => {
    const cb = window.__agentPendingReturnCallback;
    if (cb) { window.__agentPendingReturnCallback = null; await cb(); }
  };

  const origShowFeedback = chatUI.showFeedbackPanel;
  chatUI.showFeedbackPanel = function(feedbackText, onConfirm) {
    window.__agentPendingReturnCallback = onConfirm;
    origShowFeedback.call(this, feedbackText, onConfirm);
  };

  init().catch((err) => {
    console.error('init failed', err);
    const banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.85);color:#fff;padding:24px;font:14px/1.5 sans-serif;overflow:auto';
    banner.innerHTML = '<h2 style="margin:0 0 12px">页面初始化失败</h2><pre style="white-space:pre-wrap"></pre><p style="margin-top:16px">请刷新页面；若仍失败，打开浏览器控制台查看详情。</p>';
    banner.querySelector('pre').textContent = err?.stack || String(err);
    document.body.appendChild(banner);
  });
})();
