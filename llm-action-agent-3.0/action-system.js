(() => {
  'use strict';

  const reg = window.AgentActionRegistry;
  if (!reg) { console.error('action-system.js: AgentActionRegistry not available'); return; }
  const { register } = reg;
  const { resolveBackendPath } = window.AgentActionPath || {};

  const DEFS = [
    { type: 'run_command', label: '\u8fd0\u884c\u547d\u4ee4', scope: 'system', dangerous: true, desc: '\u6267\u884c Shell \u547d\u4ee4\uff08\u9700\u672c\u5730\u540e\u7aef\uff09', example: { type: 'run_command', command: 'dir', cwd: '.' } },
    { type: 'http_request', label: 'HTTP \u8bf7\u6c42', scope: 'system', dangerous: false, desc: '\u53d1\u8d77 HTTP \u8bf7\u6c42\uff08\u9700\u672c\u5730\u540e\u7aef\u4ee3\u7406\uff09', example: { type: 'http_request', url: 'https://api.example.com/data', method: 'GET' } },
    { type: 'tencent_search', label: '\u817e\u8baf\u4e91\u8054\u7f51\u641c\u7d22', scope: 'system', dangerous: false, desc: '\u901a\u8fc7\u817e\u8baf\u4e91 WSA SearchPro API \u8054\u7f51\u641c\u7d22\uff08\u9700\u914d\u7f6e\u5bc6\u94a5\uff09', example: { type: 'tencent_search', query: '\u641c\u7d22\u5173\u952e\u8bcd', mode: 0, cnt: 10 } },
  ];

  for (const def of DEFS) {
    register(def, { backend: true, dangerous: def.dangerous });
  }

  async function executeViaBackend(action, ctx, ws) {
    const payload = { ...action };
    delete payload.workspace;
    delete payload.workspaceId;
    delete payload.workspaceName;
    if (payload.path && typeof resolveBackendPath === 'function') {
      payload.path = resolveBackendPath(ctx, payload.path, ws);
    }
    if (payload.cwd && typeof resolveBackendPath === 'function') {
      payload.cwd = resolveBackendPath(ctx, payload.cwd, ws);
    }

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
    DEFS,
    BACKEND_ONLY_TYPES: DEFS.map(function(d) { return d.type; }),
    executeViaBackend,
  };
})();