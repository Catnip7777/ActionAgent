(() => {
  'use strict';

  // ============================================================
  // Panels Utils Module
  // Shared utility functions for all panels
  // Depends on: window.__agentCore, __agentFormat
  // ============================================================

  const core = window.__agentCore;
  const fmt = window.__agentFormat;

  // ── Utility state ──
  let saveWorkspaceTimer = null;

  // ── UI helpers ──

  function setEl(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  }

  function setElText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function setChecked(id, checked) {
    const el = document.getElementById(id);
    if (el) el.checked = !!checked;
  }

  function insertIntoChatInput(text) {
    const ta = document.getElementById('chatInput');
    if (!ta || !text) return;
    const start = ta.selectionStart;
    const before = ta.value.substring(0, start);
    const after = ta.value.substring(ta.selectionEnd);
    ta.value = before + (before.trim() ? '\n\n' : '') + text + (after ? '\n\n' + after : '');
    ta.selectionStart = ta.selectionEnd = ta.value.length;
    ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ── Format UI ──

  function updateFormatUI() {
    const type = document.getElementById('formatType').value;
    document.getElementById('startTagGroup')?.classList.toggle('hidden', type !== 'xml_tag');
    document.getElementById('endTagGroup')?.classList.toggle('hidden', type !== 'xml_tag');
    document.getElementById('fenceLangGroup')?.classList.toggle('hidden', type !== 'markdown_fence');
    document.getElementById('regexGroup')?.classList.toggle('hidden', type !== 'regex');
    core.getConfig().format.formatType = type;
    const preview = document.getElementById('formatPreview');
    if (preview) preview.textContent = fmt.getFormatPreview();
    core.debouncedSaveConfig();
  }

  // renderActionCards moved to app-panels-aux.js (full version with checkboxes)

  // ── Backend / Sidebar ──

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

  // ── Bind helpers ──

  function readApiSettingsToConfig() {
    var cfg = core.getConfig();
    cfg.apiBaseUrl = core.normalizeApiBaseUrl(document.getElementById('apiBaseUrl')?.value || '');
    cfg.apiKey = document.getElementById('apiKey')?.value || '';
    cfg.modelName = document.getElementById('modelName')?.value || '';
    cfg.temperature = parseFloat(document.getElementById('temperature')?.value) || 0.7;
    cfg.maxTokens = parseInt(document.getElementById('maxTokens')?.value, 10) || 4096;
    cfg.backendUrl = document.getElementById('backendUrl')?.value || '';
    cfg.backendToken = document.getElementById('backendToken')?.value || '';
  }

  function handleApiInputChange() {
    readApiSettingsToConfig();
    core.saveConfig();
    // 显示已保存提示（可选）
    var hint = document.getElementById('apiSaveHint');
    if (hint) {
      hint.textContent = '✓ 已保存';
      clearTimeout(hint._timer);
      hint._timer = setTimeout(function() { hint.textContent = ''; }, 2000);
    }
  }

  function bindAutoSave() {
    const ids = ['apiBaseUrl','apiKey','modelName','temperature','maxTokens','backendUrl','backendToken','formatType','startTag','endTag','fenceLang','customRegex','escapePrefix','formatTestInput'];
    ids.forEach((id) => {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', handleApiInputChange);
        el.addEventListener('change', handleApiInputChange);
        el.addEventListener('blur', handleApiInputChange);
      }
    });
    document.getElementById('temperature')?.addEventListener('input', (e) => {
      document.getElementById('temperatureValue').textContent = e.target.value;
    });
    // 页面关闭前强制保存一次
    window.addEventListener('beforeunload', function() {
      readApiSettingsToConfig();
      core.saveConfig();
    });
  }

  function bindTitleEdit() {
    const h1 = document.getElementById('chatTitle');
    const input = document.getElementById('chatTitleInput');
    if (!h1 || !input) return;
    h1.addEventListener('click', () => {
      input.value = core.getActiveConversation()?.title || '';
      h1.classList.add('hidden'); input.classList.remove('hidden'); input.focus();
    });
    input.addEventListener('blur', () => {
      const conv = core.getActiveConversation();
      if (conv) { conv.title = input.value.trim() || '新对话'; conv.titleAuto = true; core.saveConversationsStore(); }
      input.classList.add('hidden'); h1.classList.remove('hidden');
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { input.classList.add('hidden'); h1.classList.remove('hidden'); }
    });
  }

  // ── Public API ──

  window.__agentPanelsUtils = {
    setEl, setElText, setChecked, insertIntoChatInput,
    updateFormatUI,
    checkBackendStatus, setSidebarCollapsed,
    bindAutoSave, bindTitleEdit,
    get backendWasOnline() { return backendWasOnline; },
    set backendWasOnline(v) { backendWasOnline = v; },
  };
})();
