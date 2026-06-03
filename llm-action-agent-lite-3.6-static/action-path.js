(() => {
  'use strict';

  function normalizePath(path) {
    return (path || '').replace(/^\.\//, '').replace(/\\/g, '/').trim();
  }

  function splitPathParts(subPath) {
    const normalized = normalizePath(subPath);
    if (!normalized || normalized === '.') return [];
    return normalized.split('/').filter((p) => p && p !== '.' && p !== '..');
  }

  function getWorkspaceRoot(ctx, ws) {
    const target = ws || ctx.getDefaultWorkspace?.();
    return normalizePath(target?.path || '').replace(/\/$/, '');
  }

  function resolveBackendPath(ctx, path, ws) {
    const normalized = normalizePath(path);
    if (!normalized) throw new Error('path 不能为空');
    const root = getWorkspaceRoot(ctx, ws);
    if (!root) throw new Error('工作区未配置根目录路径');

    const rootWin = root.replace(/\//g, '\\');
    const rootLower = rootWin.toLowerCase();

    if (/^[a-zA-Z]:/.test(normalized)) {
      const abs = normalized.replace(/\//g, '\\');
      if (!abs.toLowerCase().startsWith(rootLower)) {
        throw new Error(`路径「${path}」超出工作区根目录「${root}」`);
      }
      return abs;
    }

    const parts = splitPathParts(normalized);
    const joined = parts.join('/').replace(/\//g, '\\');
    return joined ? rootWin + '\\' + joined : rootWin;
  }

  window.AgentActionPath = {
    normalizePath,
    splitPathParts,
    getWorkspaceRoot,
    resolveBackendPath,
  };
})();
