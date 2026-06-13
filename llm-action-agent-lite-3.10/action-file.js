// RESTORE
(() => {
  'use strict';

  const { register, fileTypes } = window.AgentActionRegistry;
  const { normalizePath, splitPathParts } = window.AgentActionPath;

  const DEFS = [
    { type: 'write_file', label: '写入文件', scope: 'file', dangerous: false,
      desc: '写入或覆盖工作区/本地文件；可选 workspace 指定工作区名称，创建新文件优先使用',
      example: { type: 'write_file', workspace: '项目A', path: 'notes/hello.txt', content: 'Hello' } },
    { type: 'append_file', label: '追加文件', scope: 'file', dangerous: false,
      desc: '向文件末尾追加内容；可选 workspace',
      example: { type: 'append_file', workspace: '项目A', path: 'log.txt', content: 'new line\\n' } },
    { type: 'delete_file', label: '删除文件', scope: 'file', dangerous: true,
      desc: '删除指定文件或空目录；可选 workspace',
      example: { type: 'delete_file', workspace: '项目A', path: 'temp.txt' } },
    { type: 'list_dir', label: '列出目录', scope: 'file', dangerous: false,
      desc: '列出目录内容；可选 workspace',
      example: { type: 'list_dir', workspace: '项目A', path: '.' } },
    { type: 'mkdir', label: '创建目录', scope: 'file', dangerous: false,
      desc: '创建目录；可选 workspace',
      example: { type: 'mkdir', workspace: '项目A', path: 'src/components' } },
    { type: 'add_file_to_context', label: '添加文件到上下文', scope: 'file', dangerous: false,
      desc: '读取文件并将内容加入上下文池，便于 LLM 持续引用，无需重复读取',
      example: { type: 'add_file_to_context', path: 'src/core.js' } },
    { type: 'remove_file_from_context', label: '从上下文移除文件', scope: 'file', dangerous: false,
      desc: '从上下文池移除已添加的文件',
      example: { type: 'remove_file_from_context', path: 'src/core.js' } },
    { type: 'list_context_files', label: '列出上下文池', scope: 'file', dangerous: false,
      desc: '列出当前上下文池中的所有文件及状态（大小、是否已过时）',
      example: { type: 'list_context_files' } },
  ];

  for (const def of DEFS) {
    if (def.type === 'delete_file') {
      register(def, { file: true, backend: true, dangerous: true });
    } else if (def.type === 'add_file_to_context' || def.type === 'remove_file_from_context') {
      register(def, { file: true, backend: false, dangerous: false });
    } else if (def.type === 'list_context_files') {
      register(def, { dangerous: false });
    } else {
      register(def, { file: true, backend: true, dangerous: false });
    }
  }

  function getCore() { return window.__agentCore; }

  async function getDirHandle(ctx, subPath, create, rootHandle) {
    let dir = rootHandle || ctx.workspaceHandle;
    if (!dir) throw new Error('无工作区目录句柄');
    const parts = splitPathParts(subPath);
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
    return dir;
  }

  async function getFileHandle(ctx, subPath, create, rootHandle) {
    if (!subPath) throw new Error('文件路径不能为空');
    const parts = splitPathParts(subPath);
    if (!parts.length) throw new Error('无效的文件路径: ' + subPath);
    const name = parts.pop();
    const dir = await getDirHandle(ctx, parts.join('/'), create, rootHandle);
    return dir.getFileHandle(name, { create });
  }

  async function readFileContent(ctx, path, rootHandle) {
    if (!path) throw new Error('缺少 path 参数');
    let file;
    const ws = ctx.resolveWorkspaceFromAction({ path });
    const wsLabel = ws?.label || '工作区';
    try { file = await getFileHandle(ctx, path, false, rootHandle); }
    catch (err) {
      if (err.name === 'NotFoundError')
        throw new Error(`在工作区「${wsLabel}」中找不到「${path}」。请确认文件名与扩展名完全一致，或先用 list_dir 查看目录。`);
      throw err;
    }
    const fileObj = await file.getFile();
    return await fileObj.text();
  }

  // 自动刷新上下文池：仅成功写入后，若文件在池中则刷新内容
  async function refreshContextFileIfNeeded(path, ctx, rootHandle) {
    const core = getCore();
    if (!core || !core.getContextFiles || !core.addContextFile) return false;
    const pool = core.getContextFiles();
    const inPool = pool.some(f => f.path === path);
    if (!inPool) return false;
    try {
      const content = await readFileContent(ctx, path, rootHandle);
      core.addContextFile(path, content);
      return true;
    } catch (e) {
      console.warn('自动刷新上下文池失败:', path, e.message);
      return false;
    }
  }

  async function executeViaWorkspace(action, ws, rootHandle, ctx) {
    const core = getCore();
    const path = normalizePath(action.path);
    const wsLabel = ws?.label || rootHandle.name;
    switch (action.type) {
      case 'write_file': {
        const file = await getFileHandle(ctx, path, true, rootHandle);
        const w = await file.createWritable();
        await w.write(action.content || '');
        await w.close();
        const refreshed = await refreshContextFileIfNeeded(path, ctx, rootHandle);
        return { workspace: wsLabel, path, written: (action.content || '').length, contextRefreshed: refreshed };
      }
      case 'append_file': {
        const file = await getFileHandle(ctx, path, true, rootHandle);
        const existing = await (await file.getFile()).text();
        const w = await file.createWritable();
        await w.write(existing + (action.content || ''));
        await w.close();
        const refreshed = await refreshContextFileIfNeeded(path, ctx, rootHandle);
        return { workspace: wsLabel, path, appended: (action.content || '').length, contextRefreshed: refreshed };
      }
      case 'delete_file': {
        const parts = splitPathParts(path);
        const name = parts.pop();
        const dir = await getDirHandle(ctx, parts.join('/'), false, rootHandle);
        await dir.removeEntry(name, { recursive: action.recursive || false });
        let contextRemoved = false;
        if (core && core.removeContextFile) {
          contextRemoved = core.removeContextFile(path);
        }
        return { workspace: wsLabel, path, deleted: true, contextRemoved };
      }
      case 'list_dir': {
        const dir = await getDirHandle(ctx, path || '.', false, rootHandle);
        const entries = [];
        for await (const [name, handle] of dir.entries()) {
          entries.push({ name, type: handle.kind });
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));
        return { workspace: wsLabel, path: path || '.', entries };
      }
      case 'mkdir': {
        await getDirHandle(ctx, path, true, rootHandle);
        return { workspace: wsLabel, path, created: true };
      }
      case 'add_file_to_context': {
        const content = await readFileContent(ctx, path, rootHandle);
        if (core && core.addContextFile) core.addContextFile(path, content, action.fromLine, action.toLine);
        return { workspace: wsLabel, path, length: content.length, added: true };
      }
      case 'remove_file_from_context': {
        if (!core || !core.removeContextFile) throw new Error('核心模块未加载');
        const removed = core.removeContextFile(path);
        if (!removed) throw new Error(`文件「${path}」不在上下文池中`);
        return { workspace: wsLabel, path, removed: true };
      }
      case 'list_context_files': {
        const files = core && core.getContextFiles ? core.getContextFiles() : [];
        const fileList = files.map(f => ({
          path: f.path,
          fullLength: f.fullLength,
          addedAt: f.addedAt,
          stale: f.content === '___STALE___'
        }));
        return { workspace: wsLabel, files: fileList, total: fileList.length };
      }
      default: throw new Error('工作区不支持: ' + action.type);
    }
  }

  async function executeFileAction(action, ctx) {
    const ws = ctx.resolveWorkspaceFromAction(action);
    if (!ws) throw new Error('无可用工作区，请在工作区面板添加');
    ctx.assertWorkspaceFilePermission(action, ws);
    const handle = await ctx.getBrowserHandleForWorkspace(ws);
    if (!handle) {
      if ('showDirectoryPicker' in window)
        throw new Error(`工作区「${ws.label}」未授权文件夹。请在工作区面板点击「选择文件夹」授权。`);
      else
        throw new Error('浏览器不支持文件夹选择，请使用最新版 Chrome/Edge。');
    }
    return executeViaWorkspace(action, ws, handle, ctx);
  }

  window.AgentActionFile = {
    DEFS, FILE_TYPES: [...fileTypes], executeFileAction, executeViaWorkspace, getDirHandle, getFileHandle,
    refreshContextFileIfNeeded,
  };
})();