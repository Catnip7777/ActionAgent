(() => {
  'use strict';

  const { register } = window.AgentActionRegistry;

  // 系统动作预留，此处不注册任何前端动作（后端文件操作由 action-file.js 处理）
  // executeViaBackend 保留给文件操作使用

  async function executeViaBackend(action, ctx, ws) {
    const { resolveBackendPath } = window.AgentActionPath;
    const payload = { ...action };
    if (ws) payload.workspace = ws.id;
    delete payload.workspaceId;
    delete payload.workspaceName;
    if (payload.path) payload.path = resolveBackendPath(ctx, payload.path, ws);
    if (payload.cwd) payload.cwd = resolveBackendPath(ctx, payload.cwd, ws);

    const res = await fetch(ctx.config.backendUrl.replace(/\/$/, '') + '/action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + ctx.config.backendToken,
        'X-Action-Token': ctx.config.backendToken,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Backend error');
    return data.result;
  }

  window.AgentActionSystem = {
    DEFS: [],
    BACKEND_ONLY_TYPES: [],
    executeViaBackend,
  };
})();
