(() => {
  'use strict';

  const reg = window.AgentActionRegistry;
  if (!reg) { console.error('action-browser.js: AgentActionRegistry not available'); return; }
  const { register } = reg;

  const DEFS = [
    { type: 'notify', label: '系统通知', scope: 'browser', dangerous: false, desc: '显示浏览器系统通知', example: { type: 'notify', title: '提醒', body: '任务完成' } },
    { type: 'clipboard', label: '剪贴板', scope: 'browser', dangerous: false, desc: '读取或写入剪贴板', example: { type: 'clipboard', action: 'write', text: 'copied text' } },
    { type: 'open_url', label: '打开链接', scope: 'browser', dangerous: false, desc: '在新标签页打开 URL', example: { type: 'open_url', url: 'https://example.com' } },
    { type: 'download', label: '下载文件', scope: 'browser', dangerous: false, desc: '触发浏览器下载文本内容', example: { type: 'download', filename: 'data.txt', content: 'file content' } },
    { type: 'local_storage', label: '本地存储', scope: 'browser', dangerous: false, desc: '读写 localStorage', example: { type: 'local_storage', action: 'set', key: 'myKey', value: 'myValue' } },
    { type: 'alert', label: '弹窗提示', scope: 'browser', dangerous: false, desc: '显示 alert 对话框', example: { type: 'alert', message: '操作已完成' } },
    { type: 'rename_conversation', label: '重命名对话', scope: 'browser', dangerous: false, desc: '重命名当前对话', example: { type: 'rename_conversation', title: '新对话标题' } },
  ];

  async function executeNotify(action) {
    if (!('Notification' in window)) throw new Error('浏览器不支持通知');
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission !== 'granted') throw new Error('通知权限被拒绝');
    new Notification(action.title || 'Action Agent', { body: action.body || '' });
    return { notified: true };
  }

  async function executeClipboard(action) {
    if (action.action === 'read') { const text = await navigator.clipboard.readText(); return { text }; }
    await navigator.clipboard.writeText(action.text || '');
    return { written: action.text || '' };
  }

  async function executeOpenUrl(action) {
    window.open(action.url, '_blank', 'noopener');
    return { opened: action.url };
  }

  async function executeDownload(action) {
    const blob = new Blob([action.content || ''], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = action.filename || 'download.txt';
    a.click();
    URL.revokeObjectURL(a.href);
    return { downloaded: action.filename };
  }

  async function executeLocalStorage(action) {
    if (action.action === 'get') return { key: action.key, value: localStorage.getItem(action.key) };
    if (action.action === 'remove') { localStorage.removeItem(action.key); return { removed: action.key }; }
    localStorage.setItem(action.key, action.value ?? '');
    return { key: action.key, value: action.value };
  }

  async function executeAlert(action) {
    alert(action.message || '');
    return { shown: true };
  }

  async function executeRenameConversation(action) {
    const core = window.__agentCore;
    if (!core) throw new Error('app-core 未就绪');
    const conv = core.getActiveConversation();
    if (!conv) throw new Error('没有活跃对话');
    const title = (action.title || '').trim();
    if (!title) return { reason: '忽略空标题', title: conv.title };
    const sliced = title.slice(0, 15);
    if (conv.title === sliced) return { unchanged: true, title: sliced };
    conv.title = sliced;
    conv.titleAuto = true;
    core.saveConversationsStore();
    if (typeof window.__agentChatUI?.updateChatTitle === 'function') window.__agentChatUI.updateChatTitle();
    if (typeof window.__agentPanelsConv?.renderConversationList === 'function') window.__agentPanelsConv.renderConversationList();
    return { renamed: sliced };
  }

  function executeAddContextFile(action) {
    var core = window.__agentCore;
    if (!core) throw new Error('app-core 未就绪');
    var path = action.path;
    var content = action.content || '';
    var fromLine = action.fromLine;
    var toLine = action.toLine;
    if (typeof core.addContextFile === 'function') {
      core.addContextFile(path, content, fromLine, toLine);
      return { added: true, path: path, length: content.length, lineRange: (fromLine != null || toLine != null) ? fromLine + '-' + toLine : undefined };
    }
    throw new Error('addContextFile 未实现');
  }

  function executeRemoveContextFile(action) {
    var core = window.__agentCore;
    if (!core) throw new Error('app-core 未就绪');
    var path = action.path;
    if (typeof core.removeContextFile === 'function') {
      var removed = core.removeContextFile(path);
      return { removed: removed, path: path };
    }
    throw new Error('removeContextFile 未实现');
  }

  function executeListContextFiles(action) {
    var core = window.__agentCore;
    if (!core) throw new Error('app-core 未就绪');
    if (typeof core.getContextFiles === 'function') {
      var files = core.getContextFiles();
      return { files: files, total: files.length, summary: { total: files.length, stale: files.filter(function(f) { return f.stale; }).length } };
    }
    throw new Error('getContextFiles 未实现');
  }

  const HANDLERS = {
    notify: executeNotify,
    clipboard: executeClipboard,
    open_url: executeOpenUrl,
    download: executeDownload,
    local_storage: executeLocalStorage,
    alert: executeAlert,
    rename_conversation: executeRenameConversation,
    add_file_to_context: executeAddContextFile,
    remove_file_from_context: executeRemoveContextFile,
    list_context_files: executeListContextFiles,
  };

  for (const def of DEFS) {
    register(def, { execute: HANDLERS[def.type] });
  }

  // 上下文文件池动作（如果还未被 register 注册，则补充注册）
  var CTX_DEFS = [
    { type: 'add_file_to_context', label: '添加上下文文件', scope: 'browser', dangerous: false, desc: '将文件内容加入当前对话的上下文池，供 AI 直接引用', example: { type: 'add_file_to_context', path: 'notes/hello.txt', content: '文件内容' } },
    { type: 'remove_file_from_context', label: '移除上下文文件', scope: 'browser', dangerous: false, desc: '从当前对话的上下文池中移除指定文件', example: { type: 'remove_file_from_context', path: 'notes/hello.txt' } },
    { type: 'list_context_files', label: '列出上下文文件', scope: 'browser', dangerous: false, desc: '列出当前上下文池中的所有文件及状态', example: { type: 'list_context_files' } },
  ];
  for (var ci = 0; ci < CTX_DEFS.length; ci++) {
    register(CTX_DEFS[ci], { execute: HANDLERS[CTX_DEFS[ci].type] });
  }

  window.AgentActionBrowser = {
    DEFS: DEFS.concat(CTX_DEFS),
    executeBrowserAction: async function(action) {
      const fn = HANDLERS[action.type];
      if (!fn) throw new Error('无法执行: ' + action.type);
      return fn(action);
    },
  };
})();