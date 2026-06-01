(() => {
  'use strict';

  const { register } = window.AgentActionRegistry;

  const DEFS = [
    { type: 'notify', label: '系统通知', scope: 'browser', dangerous: false,
      desc: '显示浏览器系统通知', example: { type: 'notify', title: '提醒', body: '任务完成' } },
    { type: 'clipboard', label: '剪贴板', scope: 'browser', dangerous: false,
      desc: '读取或写入剪贴板', example: { type: 'clipboard', action: 'write', text: 'copied text' } },
    { type: 'open_url', label: '打开链接', scope: 'browser', dangerous: false,
      desc: '在新标签页打开 URL', example: { type: 'open_url', url: 'https://example.com' } },
    { type: 'download', label: '下载文件', scope: 'browser', dangerous: false,
      desc: '触发浏览器下载文本内容', example: { type: 'download', filename: 'data.txt', content: 'file content' } },
    { type: 'local_storage', label: '本地存储', scope: 'browser', dangerous: false,
      desc: '读写 localStorage', example: { type: 'local_storage', action: 'set', key: 'myKey', value: 'myValue' } },
    { type: 'alert', label: '弹窗提示', scope: 'browser', dangerous: false,
      desc: '显示 alert 对话框', example: { type: 'alert', message: '操作已完成' } },
  ];

  async function executeNotify(action) {
    if (!('Notification' in window)) throw new Error('浏览器不支持通知');
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission !== 'granted') throw new Error('通知权限被拒绝');
    new Notification(action.title || 'Action Agent', { body: action.body || '' });
    return { notified: true };
  }

  async function executeClipboard(action) {
    if (action.action === 'read') return { text: await navigator.clipboard.readText() };
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

  const HANDLERS = { notify: executeNotify, clipboard: executeClipboard, open_url: executeOpenUrl, download: executeDownload, local_storage: executeLocalStorage, alert: executeAlert };

  for (const def of DEFS) register(def, { execute: HANDLERS[def.type] });

  async function executeBrowserAction(action) {
    const fn = HANDLERS[action.type];
    if (!fn) throw new Error('无法执行: ' + action.type);
    return fn(action);
  }

  window.AgentActionBrowser = { DEFS, executeBrowserAction };
})();
