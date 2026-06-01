// 安全生成唯一ID，兼容旧浏览器（crypto.randomUUID 在 Edge 88-92 不支持）
function safeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // 降级方案：时间戳 + 随机数（足够唯一）
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

(() => {
  'use strict';

  const STORAGE_KEY = 'llm_action_agent_config';
  const CONVERSATIONS_KEY = 'llm_action_agent_conversations';
  const WS_DB_NAME = 'llm-action-agent-ws';
  const WS_STORE = 'handles';
  const CONV_DB_NAME = 'llm-action-agent-conv';
  const CONV_DB_STORE = 'conversations';
  const CONV_DB_VERSION = 2;
  let VERSION = '1.0';

  const DEFAULT_FORMAT = {
    formatType: 'xml_tag',
    startTag: '<action_fix>',
    endTag: '</action_fix>',
    escapePrefix: '\\',
    fenceLang: 'action',
    customRegex: ''
  };

  function getVersion() {
    try { const cfg = getConfig(); if (cfg && cfg.version) VERSION = cfg.version; } catch {}
    return VERSION;
  }

  function setVersion(v) {
    VERSION = String(v).trim() || '1.0';
    const cfg = getConfig();
    if (cfg) { cfg.version = VERSION; saveConfig(); }
    const el = document.getElementById('versionDisplay');
    if (el) el.textContent = VERSION;
  }

  const MAX_CONVERSATIONS = 200;

  // 工作区字段去除了 backendFileAccess、path，统一由文件夹选择决定

  let config = null;
  let convStore = null;
  let messages = [];
  let logs = [];
  let convDbInstance = null;
  let pendingDbSave = null;

  function openConvDb() {
    if (convDbInstance) return Promise.resolve(convDbInstance);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(CONV_DB_NAME, CONV_DB_VERSION);
      req.onupgradeneeded = (e) => { if (!e.target.result.objectStoreNames.contains(CONV_DB_STORE)) e.target.result.createObjectStore(CONV_DB_STORE, { keyPath: 'id' }); };
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
      return new Promise((resolve) => { const req = tx.objectStore(CONV_DB_STORE).get('__store__'); req.onsuccess = () => resolve(req.result ? req.result.data : null); req.onerror = () => resolve(null); });
    } catch { return null; }
  }

  async function migrateConversationsToDb() {
    const local = loadConversationsStore();
    if (!local.conversations.length) return;
    const existing = await loadConversationsFromDb();
    if (!existing) { await saveConversationsToDb(local); }
  }

  const getConfig = () => config;
  const setConfig = (c) => { config = c; };
  const getConvStore = () => convStore;
  const setConvStore = (c) => { convStore = c; };
  const getMessages = () => messages;
  const setMessages = (m) => { messages = m; };
  const __convChangeCallbacks = [];
  function onConvChange(fn) { __convChangeCallbacks.push(fn); }
  function triggerConvChange() { __convChangeCallbacks.forEach(fn => { try { fn(); } catch(e) { console.warn('convChange callback error', e); }}); }

  const pushMessage = (msg) => {
    if (msg.role === 'assistant' && !msg.ts) msg.ts = Date.now();
    messages.push(msg);
    clearTimeout(window.__agentDebounceTimers?.saveConv);
    if (!window.__agentDebounceTimers) window.__agentDebounceTimers = {};
    window.__agentDebounceTimers.saveConv = setTimeout(() => {
      syncMessagesToActiveConversation();
      saveConversationsStore();
      triggerConvChange();
    }, 300);
  };
  const getLogs = () => logs;
  const setLogs = (l) => { logs = l; };
  const addLogEntry = (entry) => { logs.unshift(entry); if (logs.length > 200) logs.pop(); };

  const WS_PERMISSION_LABELS = { readwrite: '可读可写', readonly: '只读' };
  const FILE_WRITE_ACTIONS = ['write_file', 'append_file', 'delete_file', 'mkdir'];

  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(getDefaultSettings());
      const saved = JSON.parse(raw);
      const merged = { ...structuredClone(getDefaultSettings()), ...saved };
      // 确保 format 字段存在：若缺省则用默认值填充
      if (!merged.format || typeof merged.format !== 'object') {
        merged.format = { ...DEFAULT_FORMAT };
      } else {
        // 补全缺失的子字段
        merged.format = { ...DEFAULT_FORMAT, ...merged.format };
      }
      if (!Array.isArray(merged.workspaces)) merged.workspaces = [];
      if (merged.workspaces.length) merged.workspaces = merged.workspaces.map((w) => {
        // 迁移：移除旧字段 path、backendFileAccess，使用 folderName
        const { path, backendFileAccess, ...rest } = w;
        return { ...rest, permission: rest.permission || 'readwrite', folderName: rest.folderName || '' };
      });
      if (!merged.workspaces.length) merged.workspaces.push(createDefaultWorkspace());
      if (!merged.activeWorkspaceId) merged.activeWorkspaceId = merged.workspaces[0].id;
      // 保留 backendUrl/backendToken（仅用于状态检测，文件操作不走后端）
      return merged;
    } catch { return structuredClone(getDefaultSettings()); }
  }

  function saveConfig() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }

  function getDefaultSettings() {
    return {
      apiBaseUrl: 'https://api.openai.com/v1', apiKey: '', modelName: 'gpt-4o', temperature: 0.7, maxTokens: 4096,
      backendUrl: 'http://127.0.0.1:8765', backendToken: '',
      format: { ...DEFAULT_FORMAT },
      workspaces: [createDefaultWorkspace()], activeWorkspaceId: null,
      autoExecute: true, confirmBeforeReturn: true, autoNameConversation: true, showReasoning: true,
      version: '1.0',
      ui: { sidebarCollapsed: false, lastPanel: 'chat' },
    };
  }

  function getActionDefs() {
    return window.AgentActions?.getCoreDefs() || [];
  }

  const DANGEROUS_ACTIONS = ['delete_file'];

  function exportSettingsForFile() {
    const { ui, ...rest } = config;
    return { ...rest, workspaces: config.workspaces, activeWorkspaceId: config.activeWorkspaceId };
  }

  function createDefaultWorkspace(overrides) {
    overrides = overrides || {};
    return { id: safeId(), label: '默认工作区', folderName: '', description: '', permission: 'readwrite', ...overrides };
  }

  function getActiveWorkspace() {
    return config.workspaces.find((w) => w.id === config.activeWorkspaceId) || config.workspaces[0] || null;
  }

  function resolveWorkspaceFromAction(action) {
    // 如果动作指定了 workspace（名称/id），优先匹配，否则用当前激活的
    if (action.workspace) {
      const target = action.workspace;
      const matched = config.workspaces.find(w => w.id === target || w.label === target);
      if (matched) return matched;
      var list = config.workspaces.map(function(w) { return '「' + w.label + '」'; }).join('、');
      throw new Error('未找到工作区「' + target + '」。可用工作区：' + list + '。请使用正确的名称或省略 workspace 使用当前激活工作区。');
    }
    return getActiveWorkspace();
  }

  function assertWorkspaceFilePermission(action, ws) {
    var target = ws || getActiveWorkspace();
    if (!target) throw new Error('请先在工作区面板添加工作区');
    if (target.permission === 'readonly' && FILE_WRITE_ACTIONS.indexOf(action.type) >= 0) {
      throw new Error('工作区"' + target.label + '"为只读，无法执行 ' + action.type);
    }
  }

  // canUseBackendForFiles 已移除 - lite版固定使用浏览器文件系统

  function loadConversationsStore() {
    try {
      var raw = localStorage.getItem(CONVERSATIONS_KEY);
      if (!raw) return { conversations: [], groups: [], activeId: null, logs: [] };
      var data = JSON.parse(raw);
      var convs = (data.conversations || []).map(function(c) { if (!Array.isArray(c.tasks)) c.tasks = []; return c; });
      return { conversations: convs, groups: data.groups || [], activeId: data.activeId || null, logs: data.logs || [] };
    } catch(e) { return { conversations: [], groups: [], activeId: null, logs: [] }; }
  }

  function saveConversationsStore() {
    if (convStore.conversations.length > MAX_CONVERSATIONS) {
      convStore.conversations.sort(function(a,b){return b.updatedAt-a.updatedAt;});
      convStore.conversations = convStore.conversations.slice(0, MAX_CONVERSATIONS);
    }
    convStore.logs = logs.slice(0, 200);
    try { localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(convStore)); } catch (e) {
      while (convStore.conversations.length > 50) {
        convStore.conversations.sort(function(a,b){return a.updatedAt-b.updatedAt;});
        convStore.conversations.pop();
      }
      try { localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(convStore)); } catch {}
    }
    if (!pendingDbSave) pendingDbSave = Promise.resolve().then(function() { pendingDbSave = null; return saveConversationsToDb(convStore); });
  }

  async function loadConversationsStoreAsync() {
    var dbData = await loadConversationsFromDb();
    if (dbData) {
      var store = {
        conversations: (dbData.conversations || []).map(function(c) { if (!Array.isArray(c.tasks)) c.tasks = []; return c; }),
        groups: dbData.groups || [], activeId: dbData.activeId || null, logs: dbData.logs || []
      };
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
    var group = { id: safeId(), name: (name || '新分组').slice(0, 30), collapsed: false, createdAt: Date.now() };
    convStore.groups.push(group);
    saveConversationsStore();
    return group;
  }

  function createConversation(title, groupId) {
    return { id: safeId(), title: title || '新对话', groupId: groupId || null, messages: [], tasks: [], createdAt: Date.now(), updatedAt: Date.now(), titleAuto: false };
  }

  function getActiveConversation() { return convStore.conversations.find(function(c) { return c.id === convStore.activeId; }) || null; }
  function syncMessagesToActiveConversation() {
    var conv = getActiveConversation();
    if (!conv) return;
    conv.messages = messages;
    conv.updatedAt = Date.now();
  }

  function getSystemPromptContent() {
    return buildSystemPromptCore() + getWorkspacePromptSection() + getTasksPromptSection();
  }

  function buildSystemPromptCore() {
    var defs = getActionDefs();
    var examples = defs.map(function(a) { return JSON.stringify(a.example); }).join('\n');
    var actionList = defs.map(function(a) { return '- ' + a.type + ': ' + a.desc; }).join('\n');
    return '你是一个可以执行本地操作的 AI 助手。当用户请求需要实际操作（读写文件、打开链接等）时，你必须输出动作块。\n\n## 动作格式\n使用 <action_fix> ... </action_fix> 包裹 JSON 动作，可在一轮回复中包含多个动作块。\n\n每个动作块内是单个 JSON 对象，必须包含 "type" 字段。\n' + '在完成用户的要求后，最后一条消息不应该包含动作。在反复出现失败或无法解决的问题应该停下告知用户。\n\n' + '## 可用动作\n' + actionList + '\n\n## 示例\n' + examples + '\n\n## 规则\n1. 普通对话直接回复文字，不需要动作块。\n2. 需要执行操作时，先简要说明，再输出动作块。\n3. JSON 必须合法，字符串用双引号。\n4. 文件 path 为相对于工作区根目录的路径。\n5. 同一轮可输出多个动作块，并行操作。\n6. 不确定文件名时，先 list_dir 再 read_file。\n7. 读取文件后根据内容继续回答用户。\n8. 危险操作（delete_file等）会在执行前请求用户确认。\n9. 遵守工作区权限：只读禁止写入/删除/建目录。\n\n## 编码原则\n1.先读取项目的全部代码，理解用户提到功能的完整实现。\n2.找到问题或需要修改的地方。\n3.根据用户需要进行全面考虑，设计合理的功能实现，如果有旧的数据要做好迁移，如果旧的架构设计更好，就尽可能保持一致。\n4.修改，并保证规范的代码，清晰的架构。\n5.进行必要的检查和运行测试，保证代码的正确性\n6.完成后说明修改的内容和方式，等待用户回应，展示时尽可能便于用户使用和验证。\n\n## edit_file 动作的正确用法\n\n\n### 支持的操作类型 (op)\n\n1. **replaceAll** — 用 replacement 替换所有匹配到的 pattern（字符串匹配）\n   - pattern: 要匹配的字符串\n   - replacement: 替换后的内容\n\n2. **replace** — 替换首个匹配的 pattern；当 flags 包含 g 时行为同 replaceAll\n   - pattern: 要匹配的字符串\n   - replacement: 替换后的内容\n   - flags: 可选，如 g 全局替换\n\n3. **replaceLines** — 替换指定行范围的内容\n   - from: 起始行号（0-based）/ 或 pattern 字符串定位\n   - to: 结束行号（可选）\n   - replacement: 替换为新内容\n\n4. **insertLines** — 在指定位置插入内容\n   - at: 行号（0-based）/ 或 pattern 定位\n   - where: before(默认) 或 after\n   - text / content: 要插入的内容\n\n5. **removeLines** — 删除指定行范围\n   - from: 起始行号（0-based）/ 或 pattern 定位\n   - to: 结束行号（可选）\n\n6. **prepend** — 在文件开头添加内容\n   - text / content: 要添加的内容\n\n7. **append** — 在文件末尾追加内容\n   - text / content: 要追加的内容\n\n### 使用建议\n- 操作前先用 read_file 确认当前内容\n- 优先使用 replaceAll 模式（字符串匹配，不依赖行号）\n- 涉及整文件替换时用 write_file 更安全\n- replaceLines / insertLines / removeLines 尽量配合 pattern 参数而非行号，避免行号偏移';
  }

  function getTasksPromptSection() {
    if (!window.AgentTasks) return '';
    var conv = getActiveConversation();
    var taskSummary = conv && conv.tasks && conv.tasks.length ? window.AgentTasks.summarizeTasks(conv.tasks) : { total: 0, counts: { pending: 0, in_progress: 0, done: 0, cancelled: 0 } };
    return '\n\n## 任务板\n使用 task_add/task_update/task_delete/task_decompose/task_check/task_list 管理任务。\nstatus: pending | in_progress | done | cancelled。\n当前对话任务：共 ' + taskSummary.total + ' 项';
  }

  function getWorkspacePromptSection() {
    var ws = getActiveWorkspace();
    if (!ws) return '\n\n## 工作区\n（未配置）';
    var s = '\n\n## 工作区\n文件动作的 path 相对于工作区根目录。\n';
    s += '- 名称：' + (ws.label || '未命名') + '\n- 文件夹：' + (ws.folderName || '（未授权）') + '\n- 权限：' + (WS_PERMISSION_LABELS[ws.permission] || ws.permission) + '\n';
    if (ws.description && ws.description.trim()) s += '- 说明：' + ws.description.trim() + '\n';
    return s;
  }

  function normalizePath(path) { return (path || '').replace(/^\//, '').replace(/\\/g, '/').trim(); }

  function normalizeApiBaseUrl(url) {
    var u = (url || '').trim().replace(/\/+$/, '');
    if (!u) return u;
    if (u.endsWith('/v1')) return u;
    return u;
  }

  function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function debouncedSaveConfig() {
    clearTimeout(window.__agentDebounceTimers && window.__agentDebounceTimers.saveConfig);
    if (!window.__agentDebounceTimers) window.__agentDebounceTimers = {};
    window.__agentDebounceTimers.saveConfig = setTimeout(function() { saveConfig(); }, 400);
  }

  window.__agentCore = {
    safeId: safeId,
    DEFAULT_FORMAT: DEFAULT_FORMAT,
    STORAGE_KEY: STORAGE_KEY, CONVERSATIONS_KEY: CONVERSATIONS_KEY,
    WS_DB_NAME: WS_DB_NAME, WS_STORE: WS_STORE, CONV_DB_NAME: CONV_DB_NAME,
    CONV_DB_STORE: CONV_DB_STORE, CONV_DB_VERSION: CONV_DB_VERSION,
    MAX_CONVERSATIONS: MAX_CONVERSATIONS, VERSION: VERSION,
    WS_PERMISSION_LABELS: WS_PERMISSION_LABELS, FILE_WRITE_ACTIONS: FILE_WRITE_ACTIONS,
    getConfig: getConfig, setConfig: setConfig,
    getConvStore: getConvStore, setConvStore: setConvStore,
    getMessages: getMessages, setMessages: setMessages, pushMessage: pushMessage,
    onConvChange: onConvChange, triggerConvChange: triggerConvChange,
    getLogs: getLogs, setLogs: setLogs, addLogEntry: addLogEntry,
    loadConfig: loadConfig, saveConfig: saveConfig,
    getDefaultSettings: getDefaultSettings, getActionDefs: getActionDefs,
    DANGEROUS_ACTIONS: DANGEROUS_ACTIONS,
    exportSettingsForFile: exportSettingsForFile,
    createDefaultWorkspace: createDefaultWorkspace,
    getDefaultWorkspace: getActiveWorkspace,
    getActiveWorkspace: getActiveWorkspace,
    resolveWorkspaceFromAction: resolveWorkspaceFromAction,
    assertWorkspaceFilePermission: assertWorkspaceFilePermission,
    loadConversationsStore: loadConversationsStore,
    loadConversationsStoreAsync: loadConversationsStoreAsync,
    saveConversationsStore: saveConversationsStore,
    ensureConvGroups: ensureConvGroups,
    createConvGroup: createConvGroup, createConversation: createConversation,
    getActiveConversation: getActiveConversation,
    syncMessagesToActiveConversation: syncMessagesToActiveConversation,
    migrateConversationsToDb: migrateConversationsToDb,
    openConvDb: openConvDb, saveConversationsToDb: saveConversationsToDb,
    loadConversationsFromDb: loadConversationsFromDb,
    getSystemPromptContent: getSystemPromptContent,
    getWorkspacePromptSection: getWorkspacePromptSection,
    getTasksPromptSection: getTasksPromptSection,
    normalizePath: normalizePath, normalizeApiBaseUrl: normalizeApiBaseUrl,
    escapeHtml: escapeHtml, debouncedSaveConfig: debouncedSaveConfig,
    getVersion: getVersion, setVersion: setVersion,
  };
})();
