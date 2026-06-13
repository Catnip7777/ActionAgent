(() => {
  'use strict';

  const core = window.__agentCore;

  function setEl(id, value) { const el = document.getElementById(id); if (el) el.value = value; }
  function setElText(id, value) { const el = document.getElementById(id); if (el) el.textContent = value; }
  function setChecked(id, checked) { const el = document.getElementById(id); if (el) el.checked = !!checked; }

  let backendWasOnline = false;

  async function checkBackendStatus() {
    const online = await (window.__agentLLM?.isBackendOnline() || Promise.resolve(false));
    const dot = document.getElementById('backendStatus');
    const txt = document.getElementById('backendStatusText');
    if (dot) dot.classList.toggle('online', online);
    if (txt) txt.textContent = online ? '后端在线' : '后端离线';
    backendWasOnline = online;
  }

  function setSidebarCollapsed(collapsed) {
    const sb = document.getElementById('sidebar');
    const expand = document.getElementById('sidebarExpand');
    const toggle = document.getElementById('toggleSidebar');
    if (!sb) return;
    sb.classList.toggle('collapsed', collapsed);
    if (expand) expand.hidden = !collapsed;
    if (toggle) { toggle.textContent = collapsed ? '▶' : '◀'; toggle.title = collapsed ? '展开' : '收起'; }
    const config = core.getConfig();
    config.ui = config.ui || {};
    config.ui.sidebarCollapsed = collapsed;
    core.saveConfig();
  }

  function bindAutoSave() {
    const saveWithRead = () => {
      if (window.__agentPanelsAux?.readAllConfigFromUI) {
        window.__agentPanelsAux.readAllConfigFromUI();
      }
      core.debouncedSaveConfig();
    };
    ['apiBaseUrl','apiKey','modelName','temperature','maxTokens'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', saveWithRead);
      document.getElementById(id)?.addEventListener('change', saveWithRead);
    });
    document.getElementById('temperature')?.addEventListener('input', (e) => { document.getElementById('temperatureValue').textContent = e.target.value; saveWithRead(); });
  }

  function bindTitleEdit() {
    const h1 = document.getElementById('chatTitle');
    const input = document.getElementById('chatTitleInput');
    if (!h1 || !input) return;
    h1.addEventListener('dblclick', () => {
      const conv = core.getActiveConversation();
      if (!conv) return;
      input.value = conv.title || '';
      h1.style.display = 'none';
      input.classList.remove('hidden');
      input.focus();
      input.select();
    });
    input.addEventListener('blur', () => {
      const conv = core.getActiveConversation();
      if (conv) { conv.title = input.value.trim() || '新对话'; conv.titleAuto = true; conv.updatedAt = Date.now(); core.saveConversationsStore(); h1.textContent = conv.title; }
      input.classList.add('hidden');
      h1.style.display = '';
      if (window.__agentPanels && window.__agentPanels.renderConversationList) {
        window.__agentPanels.renderConversationList();
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.classList.add('hidden'); h1.style.display = ''; }
    });
  }

  window.__agentPanelsUtils = { setEl, setElText, setChecked, checkBackendStatus, setSidebarCollapsed, bindAutoSave, bindTitleEdit, get backendWasOnline() { return backendWasOnline; }, set backendWasOnline(v) { backendWasOnline = v; } };
})();
