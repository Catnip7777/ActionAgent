(() => {
  'use strict';

  /** @type {Array<object>} */
  const defs = [];
  /** @type {Map<string, function>} */
  const handlers = new Map();
  const fileTypes = new Set();
  const backendTypes = new Set();
  const dangerousTypes = new Set();

  /**
   * 注册一个动作。
   * @param {object} actionDef - { type, label, scope, dangerous, desc, example }
   * @param {object} [options]
   * @param {function} [options.execute] - async (action, ctx) => result
   * @param {boolean} [options.file] - 走工作区文件路由
   * @param {boolean} [options.backend] - 可走 server.py /action
   */
  function register(actionDef, options = {}) {
    if (!actionDef?.type) throw new Error('\u52a8\u4f5c\u7f3a\u5c11 type');
    defs.push(actionDef);
    if (typeof options.execute === 'function') {
      handlers.set(actionDef.type, options.execute);
    }
    if (options.file) fileTypes.add(actionDef.type);
    if (options.backend) backendTypes.add(actionDef.type);
    if (options.dangerous || actionDef.dangerous) dangerousTypes.add(actionDef.type);
  }

  function getDefs() { return defs.slice(); }
  function getHandler(type) { return handlers.get(type); }
  function getCoreDefs() { return getDefs(); }

  // \u2014\u2014 \u6ce8\u518c\u57fa\u7840\u52a8\u4f5c \u2014\u2014
  var CTX_FILE_ACTIONS = [
    { type: 'add_file_to_context', label: '\u6dfb\u52a0\u4e0a\u4e0b\u6587\u6587\u4ef6', scope: 'file', dangerous: false, desc: '\u5c06\u6587\u4ef6\u5185\u5bb9\u52a0\u5165\u5f53\u524d\u5bf9\u8bdd\u7684\u4e0a\u4e0b\u6587\u6c60\uff0c\u4f9b AI \u76f4\u63a5\u5f15\u7528', example: { type: 'add_file_to_context', path: 'notes/hello.txt', content: '\u6587\u4ef6\u5185\u5bb9' } },
    { type: 'remove_file_from_context', label: '\u79fb\u9664\u4e0a\u4e0b\u6587\u6587\u4ef6', scope: 'file', dangerous: false, desc: '\u4ece\u5f53\u524d\u5bf9\u8bdd\u7684\u4e0a\u4e0b\u6587\u6c60\u4e2d\u79fb\u9664\u6307\u5b9a\u6587\u4ef6', example: { type: 'remove_file_from_context', path: 'notes/hello.txt' } },
    { type: 'list_context_files', label: '\u5217\u51fa\u4e0a\u4e0b\u6587\u6587\u4ef6', scope: 'file', dangerous: false, desc: '\u5217\u51fa\u5f53\u524d\u4e0a\u4e0b\u6587\u6c60\u4e2d\u7684\u6240\u6709\u6587\u4ef6\u53ca\u72b6\u6001\uff08\u5927\u5c0f\u3001\u662f\u5426\u5df2\u8fc7\u65f6\uff09', example: { type: 'list_context_files' } },
  ];

  const BASE_ACTIONS = [
    { type: 'clipboard', label: '\u526a\u8d34\u677f', scope: 'browser', dangerous: false, desc: '\u8bfb\u53d6\u6216\u5199\u5165\u526a\u8d34\u677f', example: { type: 'clipboard', action: 'write', text: 'copied text' } },
    { type: 'open_url', label: '\u6253\u5f00\u94fe\u63a5', scope: 'browser', dangerous: false, desc: '\u5728\u65b0\u6807\u7b7e\u9875\u6253\u5f00 URL', example: { type: 'open_url', url: 'https://example.com' } },
    { type: 'download', label: '\u4e0b\u8f7d\u6587\u4ef6', scope: 'browser', dangerous: false, desc: '\u89e6\u53d1\u6d4f\u89c8\u5668\u4e0b\u8f7d\u6587\u672c\u5185\u5bb9', example: { type: 'download', filename: 'data.txt', content: 'file content' } },
    { type: 'local_storage', label: '\u672c\u5730\u5b58\u50a8', scope: 'browser', dangerous: false, desc: '\u8bfb\u5199 localStorage', example: { type: 'local_storage', action: 'set', key: 'myKey', value: 'myValue' } },
    { type: 'echo_message', label: '\u56de\u58f0\uff08\u793a\u4f8b\uff09', scope: 'custom', dangerous: false, desc: '\u3010\u793a\u4f8b\u52a8\u4f5c\u3011\u5c06 message \u539f\u6837\u8fd4\u56de\uff0c\u6f14\u793a\u81ea\u5b9a\u4e49\u52a8\u4f5c\u6ce8\u518c\u65b9\u5f0f', example: { type: 'echo_message', message: 'Hello from custom action' } },
  ];

  for (const a of BASE_ACTIONS) register(a, { dangerous: a.dangerous });
  for (var ci = 0; ci < CTX_FILE_ACTIONS.length; ci++) register(CTX_FILE_ACTIONS[ci], { dangerous: false });

  // \u6ce8\u518c\u4e0a\u4e0b\u6587\u6587\u4ef6\u6c60\u52a8\u4f5c\u7684\u6267\u884c\u5668
  register({ type: 'add_file_to_context', label: '\u6dfb\u52a0\u4e0a\u4e0b\u6587\u6587\u4ef6', scope: 'file', dangerous: false, desc: '\u5c06\u6587\u4ef6\u5185\u5bb9\u52a0\u5165\u5f53\u524d\u5bf9\u8bdd\u7684\u4e0a\u4e0b\u6587\u6c60\uff0c\u4f9b AI \u76f4\u63a5\u5f15\u7528', example: { type: 'add_file_to_context', path: 'notes/hello.txt', content: '\u6587\u4ef6\u5185\u5bb9' } }, {
    execute: function(action, ctx) {
      var core = window.__agentCore;
      core.addContextFile({
        name: action.name || (action.path || '').split('/').pop() || 'unknown',
        path: action.path || '',
        workspace: action.workspace || '',
        content: action.content,
        size: action.content ? action.content.length : null,
        addedAt: Date.now(),
      });
      return { added: true, path: action.path, convContextFiles: core.getContextFiles().length };
    }
  });
  register({ type: 'remove_file_from_context', label: '\u79fb\u9664\u4e0a\u4e0b\u6587\u6587\u4ef6', scope: 'file', dangerous: false, desc: '\u4ece\u5f53\u524d\u5bf9\u8bdd\u7684\u4e0a\u4e0b\u6587\u6c60\u4e2d\u79fb\u9664\u6307\u5b9a\u6587\u4ef6', example: { type: 'remove_file_from_context', path: 'notes/hello.txt' } }, {
    execute: function(action, ctx) {
      var core = window.__agentCore;
      core.removeContextFile(action.path);
      return { removed: true, path: action.path, convContextFiles: core.getContextFiles().length };
    }
  });

  window.AgentActionRegistry = {
    register,
    getDefs,
    getHandler,
    fileTypes,
    backendTypes,
    dangerousTypes,
    getCoreDefs,
  };
  // \u624b\u52a8\u89e6\u53d1\u52a8\u4f5c\u914d\u7f6e\u521d\u59cb\u5316\uff08\u5982\u679c\u6709\uff09
  if (typeof window.AgentActions !== 'undefined' && window.AgentActions) {
    try { window.AgentActions.getCoreDefs(); } catch(e) {}
  }
})();