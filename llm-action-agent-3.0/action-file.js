(() => {
  'use strict';

  const { register, fileTypes } = window.AgentActionRegistry;
  const { normalizePath, splitPathParts } = window.AgentActionPath;

  const DEFS = [
    {
      type: 'write_file',
      label: '写入文件',
      scope: 'file',
      dangerous: false,
      desc: '写入或覆盖工作区/本地文件；可选 workspace 指定工作区名称',
      example: { type: 'write_file', workspace: '项目A', path: 'notes/hello.txt', content: 'Hello' },
    },
    {
      type: 'append_file',
      label: '追加文件',
      scope: 'file',
      dangerous: false,
      desc: '向文件末尾追加内容；可选 workspace',
      example: { type: 'append_file', workspace: '项目A', path: 'log.txt', content: 'new line\n' },
    },
    {
      type: 'delete_file',
      label: '删除文件',
      scope: 'file',
      dangerous: true,
      desc: '删除指定文件或空目录；可选 workspace',
      example: { type: 'delete_file', workspace: '项目A', path: 'temp.txt' },
    },
    {
      type: 'list_dir',
      label: '列出目录',
      scope: 'file',
      dangerous: false,
      desc: '列出目录内容；可选 workspace',
      example: { type: 'list_dir', workspace: '项目A', path: '.' },
    },
    {
      type: 'mkdir',
      label: '创建目录',
      scope: 'file',
      dangerous: false,
      desc: '创建目录；可选 workspace',
      example: { type: 'mkdir', workspace: '项目A', path: 'src/components' },
    },
  ];

  for (const def of DEFS) {
    register(def, { file: true, backend: true, dangerous: def.dangerous });
  }

  async function getDirHandle(ctx, subPath, create, rootHandle) {
    let dir = rootHandle || ctx.workspaceHandle;
    if (!dir) throw new Error('无工作区目录句柄');
    const parts = splitPathParts(subPath);
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create });
    }
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

  async function executeViaWorkspace(action, ws, rootHandle, ctx) {
    const path = normalizePath(action.path);
    const wsLabel = ws?.label || rootHandle.name;

    switch (action.type) {
      case 'write_file': {
        const file = await getFileHandle(ctx, path, true, rootHandle);
        const w = await file.createWritable();
        const content = action.content || '';
        await w.write(content);
        await w.close();
        if (typeof window.__agentCore?.onContextFileWritten === 'function') {
          window.__agentCore.onContextFileWritten(path, false, content);
        }
        return { workspace: wsLabel, path, written: content.length };
      }
      case 'append_file': {
        const file = await getFileHandle(ctx, path, true, rootHandle);
        const existing = await (await file.getFile()).text();
        const w = await file.createWritable();
        const newContent = existing + (action.content || '');
        await w.write(newContent);
        await w.close();
        if (typeof window.__agentCore?.onContextFileWritten === 'function') {
          window.__agentCore.onContextFileWritten(path, false, newContent);
        }
        return { workspace: wsLabel, path, appended: (action.content || '').length };
      }
      case 'delete_file': {
        const parts = splitPathParts(path);
        const name = parts.pop();
        const dir = await getDirHandle(ctx, parts.join('/'), false, rootHandle);
        await dir.removeEntry(name, { recursive: action.recursive || false });
        if (typeof window.__agentCore?.onContextFileWritten === 'function') {
          window.__agentCore.onContextFileWritten(path, true);
        }
        return { workspace: wsLabel, path, deleted: true };
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
      default:
        throw new Error('工作区不支持: ' + action.type);
    }
  }

  /** 文件动作完整路由：浏览器工作区 → 后端 → 报错 */
  async function executeFileAction(action, ctx) {
    const ws = ctx.resolveWorkspaceFromAction(action);
    if (!ws) throw new Error('无可用工作区，请在工作区面板添加');
    ctx.assertWorkspaceFilePermission(action, ws);
    // 优先使用多工作区句柄管理
    let handle = null;
    if (typeof ctx.getWorkspaceHandle === 'function') {
      handle = ctx.getWorkspaceHandle(ws.id);
    }
    if (!handle && typeof ctx.getBrowserHandleForWorkspace === 'function') {
      handle = await ctx.getBrowserHandleForWorkspace(ws);
    }
    if (handle) {
      return executeViaWorkspace(action, ws, handle, ctx);
    }
    if (ctx.canUseBackendForFiles(ws) && (await ctx.isBackendOnline())) {
      return ctx.executeViaBackend(action, ws);
    }
    if ('showDirectoryPicker' in window) {
      throw new Error(
        `工作区「${ws.label}」未授权浏览器文件夹。请在工作区面板授权，或开启后端访问并配置路径。`
      );
    }
    if (ctx.canUseBackendForFiles(ws) && (await ctx.isBackendOnline())) {
      return ctx.executeViaBackend(action, ws);
    }
    throw new Error(`工作区「${ws.label}」请配置路径并授权浏览器或开启后端文件访问`);
  }

  window.AgentActionFile = {
    DEFS,
    FILE_TYPES: [...fileTypes],
    executeFileAction,
    executeViaWorkspace,
    getDirHandle,
    getFileHandle,
  };
})();