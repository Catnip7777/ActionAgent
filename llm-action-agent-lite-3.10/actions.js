(() => {
  'use strict';

  const registry = window.AgentActionRegistry;

  function getCoreDefs() {
    return registry.getDefs();
  }

  function getFileActions() { return [...registry.fileTypes]; }
  function getBackendActions() { const set = new Set(registry.backendTypes); for (const t of registry.fileTypes) set.add(t); return [...set]; }
  function getDangerousActions() { return [...registry.dangerousTypes]; }

  async function execute(action, ctx) {
    if (action.type === '_parse_error') throw new Error('动作 JSON 解析失败: ' + action.raw);
    // list_context_files 不依赖文件系统，直接在 handle 前处理
    if (action.type === 'list_context_files') {
      const core = window.__agentCore;
      if (!core || !core.getContextFiles) return { files: [], count: 0 };
      const pool = core.getContextFiles();
      const files = pool.map(f => ({
        path: f.path,
        sizeKB: (f.fullLength / 1024).toFixed(1),
        stale: f.content === '___STALE___',
        addedAt: new Date(f.addedAt).toISOString()
      }));
      return { files, count: files.length };
    }
    if (registry.fileTypes.has(action.type)) return window.AgentActionFile.executeFileAction(action, ctx);
    if (registry.backendTypes.has(action.type) && (await ctx.isBackendOnline())) {
      const ws = ctx.resolveWorkspaceFromAction(action);
      return window.AgentActionSystem.executeViaBackend(action, ctx, ws);
    }
    const handler = registry.getHandler(action.type);
    if (handler) return handler(action, ctx);
    return window.AgentActionBrowser.executeBrowserAction(action);
  }

  window.AgentActions = {
    getCoreDefs, getFileActions, getBackendActions, getDangerousActions, execute,
    register: registry.register.bind(registry),
  };
})();
