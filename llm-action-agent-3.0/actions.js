(() => {
  'use strict';

  const registry = window.AgentActionRegistry;

  function getCoreDefs() {
    return registry.getDefs();
  }

  function getFileActions() {
    return [...registry.fileTypes];
  }

  function getBackendActions() {
    const set = new Set(registry.backendTypes);
    for (const t of registry.fileTypes) set.add(t);
    return [...set];
  }

  function getDangerousActions() {
    return [...registry.dangerousTypes];
  }

  /**
   * 执行动作（核心 + 自定义注册表）。
   * 记忆 / 插件 / 任务 由 app.js 在外层委托。
   */
  async function execute(action, ctx) {
    if (action.type === '_parse_error') {
      throw new Error('动作 JSON 解析失败: ' + action.raw);
    }

    if (registry.fileTypes.has(action.type)) {
      return window.AgentActionFile.executeFileAction(action, ctx);
    }

    if (registry.backendTypes.has(action.type) && (await ctx.isBackendOnline())) {
      const ws = ctx.resolveWorkspaceFromAction(action);
      return window.AgentActionSystem.executeViaBackend(action, ctx, ws);
    }

    const handler = registry.getHandler(action.type);
    if (handler) {
      return handler(action, ctx);
    }

    return window.AgentActionBrowser.executeBrowserAction(action);
  }

  window.AgentActions = {
    getCoreDefs,
    getFileActions,
    getBackendActions,
    getDangerousActions,
    execute,
    register: registry.register.bind(registry),
  };
})();
