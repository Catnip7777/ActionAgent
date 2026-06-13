(() => {
  'use strict';

  // ============================================================
  // Core Module: Config, Conversations, Workspace, Prompts
  // Exposes public API via window.__agentCore
  // ============================================================

  const STORAGE_KEY = 'llm_action_agent_config';
  const CONVERSATIONS_KEY = 'llm_action_agent_conversations';
  const LEGACY_MEMORY_KEY = 'llm_action_agent_memory';
  const WS_DB_NAME = 'llm-action-agent-ws';
  const WS_STORE = 'handles';
  const CONV_DB_NAME = 'llm-action-agent-conv';
  const CONV_DB_STORE = 'conversations';
  const CONV_DB_VERSION = 2;
  let VERSION = '3.0';
  const MAX_CONVERSATIONS = 200;
  const BUILTIN_PROMPT_ID = '__builtin__';

  // ── Shared state ──
  let config = null;
  let workspaceHandles = {};
  let convStore = null;
  let messages = [];
  let cachedPluginSummaries = [];
  let cachedMemorySummaries = [];
  let selectedPluginName = null;
  let selectedMemoryName = null;
  let selectedPromptId = BUILTIN_PROMPT_ID;
  let logs = [];
  let convDbInstance = null;
  let pendingDbSave = null;

  // ── Helper ──
  function getVersion() { try { const c = getConfig(); if (c && c.version) VERSION = c.version; } catch {} return VERSION; }
  function setVersion(v) {
    VERSION = String(v).trim() || '1.0';
    const c = getConfig(); if (c) { c.version = VERSION; saveConfig(); }
    const el = document.getElementById('versionDisplay'); if (el) el.textContent = VERSION;
  }
  function getWorkspaceHandle(id) { return workspaceHandles[id] || null; }
  function setWorkspaceHandle(id, h) { workspaceHandles[id] = h; return h; }
  function removeWorkspaceHandle(id) { if (workspaceHandles[id]) delete workspaceHandles[id]; }
  function getAllWorkspaceHandles() { return workspaceHandles; }
  function getConfig() { return config; }
  function setConfig(c) { config = c; }
  function getConvStore() { return convStore; }
  function setConvStore(c) { convStore = c; }
  function getMessages() { return messages; }
  function setMessages(m) { messages = m; }
  function pushMessage(msg) {
    if (msg.role === 'assistant' && !msg.ts) msg.ts = Date.now();
    messages.push(msg);
    if (window.__agentExecutor) window.__agentExecutor.recordAssistantStats(msg);
    clearTimeout(window.__agentDebounceTimers?.saveConv);
    if (!window.__agentDebounceTimers) window.__agentDebounceTimers = {};
    window.__agentDebounceTimers.saveConv = setTimeout(() => {
      syncMessagesToActiveConversation();
      saveConversationsStore();
      if (window.__agentLLM) window.__agentLLM.syncConfigToFiles();
    }, 300);
  }
  function getLogs() { return logs; }
  function setLogs(l) { logs = l; }
  function addLogEntry(entry) { logs.unshift(entry); if (logs.length > 200) logs.pop(); }
  function getCachedPluginSummaries() { return cachedPluginSummaries; }
  function setCachedPluginSummaries(s) { cachedPluginSummaries = s; }
  function getCachedMemorySummaries() { return cachedMemorySummaries; }
  function setCachedMemorySummaries(s) { cachedMemorySummaries = s; }
  function getSelectedPluginName() { return selectedPluginName; }
  function setSelectedPluginName(n) { selectedPluginName = n; }
  function getSelectedMemoryName() { return selectedMemoryName; }
  function setSelectedMemoryName(n) { selectedMemoryName = n; }
  function getSelectedPromptId() { return selectedPromptId; }
  function setSelectedPromptId(id) { selectedPromptId = id; }

  // ── Constants ──
  const WS_PERMISSION_LABELS = { readwrite: '可读可写', readonly: '只读', none: '禁用文件访问' };
  const FILE_WRITE_ACTIONS = ['write_file', 'append_file', 'delete_file', 'mkdir'];

  // ── IndexedDB ──
  function openConvDb() {
    if (convDbInstance) return Promise.resolve(convDbInstance);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(CONV_DB_NAME, CONV_DB_VERSION);
      req.onupgradeneeded = (e) => { const db = e.target.result; if (!db.objectStoreNames.contains(CONV_DB_STORE)) db.createObjectStore(CONV_DB_STORE, { keyPath: 'id' }); };
      req.onsuccess = () => { convDbInstance = req.result; resolve(convDbInstance); };
      req.onerror = () => reject(req.error);
    });
  }
  async function saveConversationsToDb(store) {
    try {
      const db = await openConvDb();
      const tx = db.transaction(CONV_DB_STORE, 'readwrite');
      tx.objectStore(CONV_DB_STORE).put({ id: '__store__', data: store });
      return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    } catch (e) { console.warn('IndexedDB save failed:', e); }
  }
  async function loadConversationsFromDb() {
    try {
      const db = await openConvDb();
      const tx = db.transaction(CONV_DB_STORE, 'readonly');
      return new Promise((resolve) => {
        const req = tx.objectStore(CONV_DB_STORE).get('__store__');
        req.onsuccess = () => resolve(req.result ? req.result.data : null);
        req.onerror = () => resolve(null);
      });
    } catch { return null; }
  }
  async function migrateConversationsToDb() {
    const local = loadConversationsStore();
    if (!local.conversations.length) return;
    const existing = await loadConversationsFromDb();
    if (!existing) { await saveConversationsToDb(local); console.log('Conversations migrated to IndexedDB'); }
  }

  // ── Config ──
  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(getDefaultSettings());
      const saved = JSON.parse(raw);
      const merged = { ...getDefaultSettings(), ...saved };
      if (saved.format) merged.format = { ...getDefaultFormat(), ...saved.format };
      if (saved.enabledActions?.length > 0) merged.enabledActions = saved.enabledActions.slice();
      if (saved.ui) merged.ui = { ...getDefaultSettings().ui, ...saved.ui };
      if (merged.workspaces) merged.workspaces = merged.workspaces.map(function(w) { return normalizeWorkspaceEntry(w, saved); });
      if (merged.enabledActions && merged.enabledActions.includes('write_memory')) {
        merged.enabledActions = merged.enabledActions.filter(function(t) { return t !== 'write_memory'; });
        if (!merged.enabledActions.includes('save_memory')) merged.enabledActions.push('save_memory');
      }
      migrateWorkspaces(merged);
      migratePrompts(merged);
      return merged;
    } catch { return structuredClone(getDefaultSettings()); }
  }
  function saveConfig() { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); if (window.__agentLLM) window.__agentLLM.syncConfigToFiles(); }
  let debouncedSaveTimer = null;
  function debouncedSaveConfig() {
    clearTimeout(debouncedSaveTimer);
    debouncedSaveTimer = setTimeout(() => { saveConfig(); }, 300);
  }
  function getDefaultSettings() {
    return {
      apiBaseUrl: 'https://api.openai.com/v1', apiKey: '', modelName: 'gpt-4o',
      temperature: 0.7, maxTokens: 4096, backendUrl: 'http://127.0.0.1:8765', backendToken: 'llm-agent-fixed-token',
      workspaces: [], activeWorkspaceId: null, autoExecute: true, confirmBeforeReturn: true,
      autoNameConversation: true, showReasoning: true, customSystemPrompt: '', version: '1.3',
      prompts: [], activePromptId: '__builtin__',
      enabledActions: (function(){ var r=window.AgentActionRegistry; if(r&&typeof r.getDefs==='function'){var d=r.getDefs();if(d&&d.length)return d.map(function(a){return a.type;});} return []; })(),
      format: { ...getDefaultFormat() },
      ui: { sidebarCollapsed: false, lastPanel: 'chat' },
    };
  }
  function getDefaultFormat() {
    return { formatType: 'xml_tag', startTag: '<action_fix>', endTag: '</action_fix>', fenceLang: 'action', customRegex: '<action_fix>([\\s\\S]*?)<\\/action_fix>', escapePrefix: '\\' };
  }
  function getActionDefs() {
    if (window.AgentActionRegistry && typeof window.AgentActionRegistry.getDefs === 'function') {
      const defs = window.AgentActionRegistry.getDefs();
      if (defs && defs.length > 0) return defs;
    }
    if (window.AgentActions && typeof window.AgentActions.getCoreDefs === 'function') return window.AgentActions.getCoreDefs() || [];
    return [];
  }
  const DANGEROUS_ACTIONS = [...(window.AgentActions?.getDangerousActions() || ['delete_file', 'run_command']), 'delete_plugin', 'delete_memory'];
  function exportSettingsForFile() {
    const { customSystemPrompt, format, enabledActions, ui, ...rest } = config;
    migrateWorkspaces(); migratePrompts();
    return { ...rest, enabledActions, format, ui, prompts: config.prompts, activePromptId: config.activePromptId, workspaces: config.workspaces, activeWorkspaceId: config.activeWorkspaceId };
  }

  function migratePrompts(cfg) {
    cfg = cfg || config;
    if (!Array.isArray(cfg.prompts)) cfg.prompts = [];
    if (!cfg.activePromptId) cfg.activePromptId = BUILTIN_PROMPT_ID;
    const legacy = (cfg.customSystemPrompt || '').trim();
    if (legacy && !cfg.prompts.length) {
      const id = crypto.randomUUID();
      cfg.prompts.push({ id, name: '迁移的自定义', content: legacy, updatedAt: Date.now() });
      cfg.activePromptId = id; cfg.customSystemPrompt = '';
    }
    if (cfg.activePromptId !== BUILTIN_PROMPT_ID && !cfg.prompts.some((p) => p.id === cfg.activePromptId)) cfg.activePromptId = BUILTIN_PROMPT_ID;
  }
  function getActivePromptEntry(cfg) {
    cfg = cfg || config;
    migratePrompts(cfg);
    if (cfg.activePromptId === BUILTIN_PROMPT_ID) return null;
    return cfg.prompts.find((p) => p.id === cfg.activePromptId) || null;
  }

  function normalizeWorkspaceEntry(ws, legacy) {
    legacy = legacy || {};
    const w = { ...ws };
    if (!w.permission) w.permission = 'readwrite';
    if (w.description == null) w.description = '';
    if (w.backendFileAccess == null) w.backendFileAccess = legacy.backendFileFallback !== false;
    if (!w.label) w.label = w.folderName || '工作区';
    return w;
  }
  function createDefaultWorkspace(overrides) {
    overrides = overrides || {};
    return normalizeWorkspaceEntry({ id: crypto.randomUUID(), label: '默认工作区', path: '', folderName: '', description: '', permission: 'readwrite', backendFileAccess: true, ...overrides });
  }
  function migrateWorkspaces(cfg) {
    cfg = cfg || config;
    if (!Array.isArray(cfg.workspaces)) cfg.workspaces = [];
    cfg.workspaces = cfg.workspaces.map((w) => normalizeWorkspaceEntry(w, cfg));
    if (!cfg.workspaces.length) {
      const path = cfg.workspacePath || cfg.backendRoot || '';
      if (path || cfg.workspaceFolderName) {
        const id = cfg.activeWorkspaceId || crypto.randomUUID();
        cfg.workspaces.push(normalizeWorkspaceEntry({ id, label: cfg.workspaceFolderName || path.split(/[/\\]/).filter(Boolean).pop() || '默认工作区', path, folderName: cfg.workspaceFolderName || '', description: '', permission: 'readwrite', backendFileAccess: cfg.backendFileFallback !== false }, cfg));
        cfg.activeWorkspaceId = id;
      }
    }
    if (!cfg.activeWorkspaceId && cfg.workspaces.length) cfg.activeWorkspaceId = cfg.workspaces[0].id;
    cfg.workspaces = cfg.workspaces.map((w) => normalizeWorkspaceEntry(w, cfg));
  }
  function getBrowserPickerMode(ws) { return ws?.permission === 'readonly' ? 'read' : 'readwrite'; }
  function getDefaultWorkspace() { migrateWorkspaces(); return getActiveWorkspace() || config.workspaces[0] || null; }
  function getActiveWorkspace(cfg) {
    cfg = cfg || config; migrateWorkspaces(cfg);
    return cfg.workspaces.find((w) => w.id === cfg.activeWorkspaceId) || cfg.workspaces[0] || null;
  }
  function resolveWorkspaceFromAction(action) {
    const key = action.workspace ?? action.workspaceId ?? action.workspaceName;
    migrateWorkspaces();
    if (!key) return getDefaultWorkspace();
    const exact = config.workspaces.find((w) => w.id === key || w.label === key);
    if (exact) return exact;
    const lower = String(key).toLowerCase();
    const partial = config.workspaces.find((w) => w.label.toLowerCase() === lower || w.label.toLowerCase().includes(lower));
    if (partial) return partial;
    throw new Error('未找到工作区「' + key + '」。可用: ' + config.workspaces.map((w) => w.label).join('、') || '（无）');
  }
  function assertWorkspaceFilePermission(action, ws) {
    const target = ws || getDefaultWorkspace();
    if (!target) throw new Error('请先在工作区面板添加工作区');
    if (target.permission === 'none') throw new Error('工作区「' + target.label + '」已禁用文件访问');
    if (target.permission === 'readonly' && FILE_WRITE_ACTIONS.includes(action.type)) throw new Error('工作区「' + target.label + '」为只读，无法执行 ' + action.type);
  }
  function canUseBackendForFiles(ws) { const target = ws || getDefaultWorkspace(); return !!(target?.backendFileAccess && normalizePath(target?.path)); }

  // ── Conversations ──
  function loadConversationsStore() {
    try {
      const raw = localStorage.getItem(CONVERSATIONS_KEY);
      if (!raw) return { conversations: [], groups: [], activeId: null, logs: [] };
      const data = JSON.parse(raw);
      const conversations = (data.conversations || []).map(function(c) {
        if (!Array.isArray(c.tasks)) c.tasks = [];
        if (!Array.isArray(c.contextFiles)) c.contextFiles = [];
        return c;
      });
      return { conversations, groups: data.groups || [], activeId: data.activeId || null, logs: data.logs || [] };
    } catch { return { conversations: [], groups: [], activeId: null, logs: [] }; }
  }
  function saveConversationsStore() {
    if (convStore.conversations.length > MAX_CONVERSATIONS) {
      convStore.conversations.sort((a, b) => b.updatedAt - a.updatedAt);
      convStore.conversations = convStore.conversations.slice(0, MAX_CONVERSATIONS);
    }
    convStore.logs = logs.slice(0, 200);
    try { localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(convStore)); } catch (e) {
      console.warn('localStorage quota exceeded, trimming conversations', e);
      while (convStore.conversations.length > 50) {
        convStore.conversations.sort((a, b) => a.updatedAt - b.updatedAt);
        convStore.conversations.pop();
      }
      try { localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(convStore)); } catch {}
    }
    if (!pendingDbSave) {
      pendingDbSave = Promise.resolve().then(() => { pendingDbSave = null; return saveConversationsToDb(convStore); });
    }
  }
  async function loadConversationsStoreAsync() {
    const dbData = await loadConversationsFromDb();
    if (dbData) {
      const conversations = (dbData.conversations || []).map(function(c) { if (!Array.isArray(c.tasks)) c.tasks = []; return c; });
      const store = { conversations, groups: dbData.groups || [], activeId: dbData.activeId || null, logs: dbData.logs || [] };
      try { localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(store)); } catch {}
      return store;
    }
    return loadConversationsStore();
  }
  function ensureConvGroups() {
    if (!convStore) convStore = { conversations: [], groups: [], activeId: null, logs: [] };
    if (!Array.isArray(convStore.groups)) convStore.groups = [];
  }
  function createConvGroup(name) {
    ensureConvGroups();
    const group = { id: crypto.randomUUID(), name: (name || '新分组').slice(0, 30), collapsed: false, createdAt: Date.now() };
    convStore.groups.push(group); saveConversationsStore(); return group;
  }
  function createConversation(title, groupId) {
    return { id: crypto.randomUUID(), title: title || '新对话', groupId: groupId || null, messages: [], tasks: [], contextFiles: [], stats: { totalInput:0, totalOutput:0, totalReasoning:0, totalCachedInput:0, totalNonCachedInput:0, requestCount:0, cacheHitCount:0, cacheMissCount:0 }, createdAt: Date.now(), updatedAt: Date.now(), titleAuto: false };
  }
  function getActiveConversation() { return convStore?.conversations.find((c) => c.id === convStore.activeId) || null; }
  function syncMessagesToActiveConversation() {
    const conv = getActiveConversation();
    if (!conv) return;
    conv.messages = messages; conv.updatedAt = Date.now();
  }

  // ── 上下文文件池（对话隔离） ──
  // 使用对话对象上的 contextFiles 数组，每个条目含 path, content, fullLength, totalLines, displayContent, lineRange, addedAt, updatedAt

  function getContextFiles() {
    var conv = getActiveConversation();
    return (conv && Array.isArray(conv.contextFiles)) ? conv.contextFiles : [];
  }

  /** addContextFile(path, content, fromLine?, toLine?) — 支持按行读取 */
  function addContextFile(path, content, fromLine, toLine) {
    var conv = getActiveConversation();
    if (!conv) return;
    if (!Array.isArray(conv.contextFiles)) conv.contextFiles = [];
    var lines = content.split('\n');
    var totalLines = lines.length;
    var displayLines = lines;
    var rangeDesc = '';
    var fl = fromLine != null ? Math.max(0, fromLine) : null;
    var tl = toLine != null ? Math.min(totalLines - 1, toLine) : null;
    if (fl != null || tl != null) {
      var start = fl || 0;
      var end = tl != null ? tl : totalLines - 1;
      if (start <= end && start >= 0 && end < totalLines) { displayLines = lines.slice(start, end + 1); rangeDesc = '行' + start + '-' + end; }
    }
    var displayContent = displayLines.join('\n');
    var entry = {
      path: path,
      content: content,
      displayContent: displayContent,
      fullLength: content.length,
      totalLines: totalLines,
      lineRange: rangeDesc || null,
      addedAt: Date.now(),
      updatedAt: Date.now(),
    };
    var existing = -1;
    for (var i = 0; i < conv.contextFiles.length; i++) {
      if (conv.contextFiles[i].path === path) { existing = i; break; }
    }
    if (existing >= 0) conv.contextFiles[existing] = entry;
    else conv.contextFiles.push(entry);
    conv.updatedAt = Date.now();
    saveConversationsStore();
  }

  function removeContextFile(path) {
    var conv = getActiveConversation();
    if (!conv || !Array.isArray(conv.contextFiles)) return;
    conv.contextFiles = conv.contextFiles.filter(function(f) { return f.path !== path; });
    conv.updatedAt = Date.now();
    saveConversationsStore();
  }

  function clearContextFiles() {
    var conv = getActiveConversation();
    if (!conv) return;
    conv.contextFiles = [];
    conv.updatedAt = Date.now();
    saveConversationsStore();
  }

  /** onContextFileWritten — 写文件后自动更新上下文池内容 */
  function onContextFileWritten(path, deleted, newContent) {
    var conv = getActiveConversation();
    if (!conv || !Array.isArray(conv.contextFiles)) return;
    var idx = -1;
    for (var i = 0; i < conv.contextFiles.length; i++) {
      if (conv.contextFiles[i].path === path) { idx = i; break; }
    }
    if (idx < 0) return;
    if (deleted) {
      conv.contextFiles.splice(idx, 1);
    } else if (newContent != null) {
      var lines = newContent.split('\n');
      var totalLines = lines.length;
      var entry = conv.contextFiles[idx];
      var rangeDesc = entry.lineRange;
      var displayContent = newContent;
      if (rangeDesc) {
        var m = rangeDesc.match(/行(\d+)-(\d+)/);
        if (m) {
          var start = parseInt(m[1], 10);
          var end = parseInt(m[2], 10);
          if (start >= 0 && end < totalLines && start <= end) displayContent = lines.slice(start, end + 1).join('\n');
        }
      }
      entry.content = newContent;
      entry.displayContent = displayContent;
      entry.fullLength = newContent.length;
      entry.totalLines = totalLines;
      entry.updatedAt = Date.now();
    }
    conv.updatedAt = Date.now();
    saveConversationsStore();
  }

  /** getFileContextSection — 生成上下文文件池的提示词段落 */
  function getFileContextSection() {
    var cf = getContextFiles();
    if (!cf.length) return '';
    var parts = ['\n\n## 文件上下文池\n以下文件已加入上下文池。每个文件内容前标有行号，你可以指定行号范围来引用特定部分。文件内容在写入后会**自动更新**。\n'];
    var sorted = cf.slice().sort(function(a, b) { return a.path.localeCompare(b.path); });
    for (var fi = 0; fi < sorted.length; fi++) {
      var f = sorted[fi];
      var sizeKB = (f.fullLength / 1024).toFixed(1);
      var rangeInfo = f.lineRange ? ' (已限定' + f.lineRange + ')' : '';
      parts.push('- **' + f.path + '** (' + sizeKB + 'KB, 共' + f.totalLines + '行' + rangeInfo + ')\n');
      var showContent = f.lineRange ? f.displayContent : f.content;
      var showLines = showContent.split('\n');
      var offset = 0;
      if (f.lineRange) {
        var m = f.lineRange.match(/行(\d+)/);
        if (m) offset = parseInt(m[1], 10);
      }
      parts.push('```\n');
      for (var li = 0; li < showLines.length; li++) {
        parts.push(String(offset + li).padStart(4, ' ') + ' | ' + showLines[li] + '\n');
      }
      parts.push('```\n');
    }
    return parts.join('');
  }

  // ── Prompt building ──
  function getSystemPromptCore() {
    const entry = getActivePromptEntry();
    if (entry?.content?.trim()) return String(entry.content).trim();
    const fmt = config.format;
    const defs = getActionDefs();
    const enabled = defs.filter((a) => config.enabledActions.includes(a.type));
    const examples = enabled.map((a) => config.format.startTag + JSON.stringify(a.example) + config.format.endTag).join('\n');
    let formatDesc;
    if (fmt.formatType === 'xml_tag') formatDesc = '使用 ' + fmt.startTag + ' ... ' + fmt.endTag + ' 包裹 JSON 动作，可在一轮回复中包含多个动作块。';
    else if (fmt.formatType === 'markdown_fence') formatDesc = '使用 Markdown 代码块 ```' + fmt.fenceLang + '\n{JSON}\n``` 格式输出动作。';
    else formatDesc = '使用自定义格式输出 JSON 动作。';
    return '你是一个可以执行本地操作的 AI 助手。当用户请求需要实际操作（读写文件、运行命令、打开链接等）时，你必须输出动作块。\n\n## 动作格式\n' + formatDesc + '\n\n每个动作块内是单个 JSON 对象，必须包含 "type" 字段。\n\n## 可用动作\n' + enabled.map((a) => '- ' + a.type + ': ' + a.desc).join('\n') + '\n\n## 示例\n' + examples + '\n\n## 规则\n1. 普通对话直接回复文字，不需要动作块。\n2. 需要执行操作时，先简要说明，再输出动作块。\n3. JSON 必须合法，字符串用双引号。\n4. 文件 path 为相对于工作区根目录的路径。\n5. 同一轮可输出多个动作块。\n6. 不确定文件名时，先 list_dir。\n7. 读取文件后根据内容继续回答用户。\n8. 危险操作需要用户确认。\n9. 遵守工作区权限。';
  }

  // 纯静态 system prompt（不含动态环境信息，可用于缓存优化）
  function buildSystemPromptCore() {
    return getSystemPromptCore();
  }

  // 获取动态环境信息（工作区、任务板、文件上下文）
  function getDynamicEnvSection() {
    var parts = [];
    var ws = getDefaultWorkspace();
    var wsInfo = ws ? '文件动作的 path 相对于工作区根目录。\n- 名称：' + (ws.label || '默认') + '\n- 文件夹：' + (ws.path || '未设置') + '\n- 权限：' + (ws.readOnly ? '只读' : '可读可写') : '';
    if (wsInfo) parts.push('## 工作区\n' + wsInfo);
    var conv = getActiveConversation();
    var tasks = conv?.tasks || [];
    var taskSummary = { total: tasks.length, counts: { pending: tasks.filter(function(t) { return t.status === 'pending' || !t.status; }).length, in_progress: tasks.filter(function(t) { return t.status === 'in_progress'; }).length, done: tasks.filter(function(t) { return t.status === 'done'; }).length, cancelled: tasks.filter(function(t) { return t.status === 'cancelled'; }).length } };
    if (tasks.length) {
      parts.push('## 任务板\n使用 task_add/task_update/task_delete/task_decompose/task_check/task_list 管理任务。\nstatus: pending | in_progress | done | cancelled。\n当前对话任务：共 ' + taskSummary.total + ' 项');
    }
    var ctxSection = getFileContextSection();
    if (ctxSection.trim()) parts.push(ctxSection.trim());
    return parts.join('\n\n');
  }

  function getSystemPromptContent() {
    var content = getSystemPromptCore();
    var env = getDynamicEnvSection();
    if (env.trim()) content += '\n\n' + env;
    return content;
  }

  // ── Utility ──
  function normalizeApiBaseUrl(url) {
    if (!url) return '';
    return url.replace(/\/+$/, '');
  }

  function normalizePath(path) { return window.AgentActionPath?.normalizePath(path) ?? (path || '').replace(/^\.\//, '').replace(/\\/g, '/').trim(); }
  function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // ── Public API ──
  window.__agentCore = {
    STORAGE_KEY, CONVERSATIONS_KEY, LEGACY_MEMORY_KEY,
    WS_DB_NAME, WS_STORE, CONV_DB_NAME, CONV_DB_STORE, CONV_DB_VERSION,
    MAX_CONVERSATIONS, BUILTIN_PROMPT_ID,
    getVersion, setVersion,
    getWorkspaceHandle, setWorkspaceHandle, removeWorkspaceHandle, getAllWorkspaceHandles,
    WS_PERMISSION_LABELS, FILE_WRITE_ACTIONS,
    getConfig, setConfig, getConvStore, setConvStore,
    getMessages, setMessages, pushMessage,
    getLogs, setLogs, addLogEntry,
    getCachedPluginSummaries, setCachedPluginSummaries,
    getCachedMemorySummaries, setCachedMemorySummaries,
    getSelectedPluginName, setSelectedPluginName,
    getSelectedMemoryName, setSelectedMemoryName,
    getSelectedPromptId, setSelectedPromptId,
    loadConfig, saveConfig, debouncedSaveConfig, getDefaultSettings, getDefaultFormat,
    getActionDefs, DANGEROUS_ACTIONS, exportSettingsForFile,
    migratePrompts, getActivePromptEntry,
    normalizeWorkspaceEntry, createDefaultWorkspace, migrateWorkspaces,
    getBrowserPickerMode, getDefaultWorkspace, getActiveWorkspace,
    resolveWorkspaceFromAction, assertWorkspaceFilePermission, canUseBackendForFiles,
    loadConversationsStore, loadConversationsStoreAsync, saveConversationsStore, ensureConvGroups,
    createConvGroup, createConversation, getActiveConversation, syncMessagesToActiveConversation,
    migrateConversationsToDb, openConvDb, saveConversationsToDb, loadConversationsFromDb,
    getSystemPromptCore, buildSystemPromptCore, getDynamicEnvSection, getSystemPromptContent,
    normalizeApiBaseUrl,
    getContextFiles, addContextFile, removeContextFile, clearContextFiles,
    onContextFileWritten, getFileContextSection,
    normalizePath, escapeHtml,
  };
})();

