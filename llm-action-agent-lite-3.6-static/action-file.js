(() => {
  'use strict';

  const { register, fileTypes } = window.AgentActionRegistry;
  const { normalizePath, splitPathParts } = window.AgentActionPath;

  const DEFS = [
    { type: 'write_file', label: '写入文件', scope: 'file', dangerous: false,
      desc: '写入或覆盖工作区/本地文件；可选 workspace 指定工作区名称',
      example: { type: 'write_file', workspace: '项目A', path: 'notes/hello.txt', content: 'Hello' } },
    { type: 'read_file', label: '读取文件', scope: 'file', dangerous: false,
      desc: '读取工作区文件；可选 workspace 指定工作区，省略则用默认',
      example: { type: 'read_file', workspace: '项目A', path: 'notes/hello.txt' } },
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
  ];

  for (const def of DEFS) register(def, { file: true, backend: true, dangerous: def.dangerous });

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

  async function executeViaWorkspace(action, ws, rootHandle, ctx) {
    const path = normalizePath(action.path);
    const wsLabel = ws?.label || rootHandle.name;
    switch (action.type) {
      case 'read_file': {
        if (!path) throw new Error('read_file 缺少 path 参数');
        let file;
        try { file = await getFileHandle(ctx, path, false, rootHandle); }
        catch (err) {
          if (err.name === 'NotFoundError')
            throw new Error(`在工作区「${wsLabel}」中找不到「${path}」。请确认文件名与扩展名完全一致，或先用 list_dir 查看目录。`);
          throw err;
        }
        const fileObj = await file.getFile();
        const content = await fileObj.text();
        return { workspace: wsLabel, path, content, size: content.length };
      }
      case 'write_file': {
        const file = await getFileHandle(ctx, path, true, rootHandle);
        const w = await file.createWritable();
        await w.write(action.content || '');
        await w.close();
        return { workspace: wsLabel, path, written: (action.content || '').length };
      }
      case 'append_file': {
        const file = await getFileHandle(ctx, path, true, rootHandle);
        const existing = await (await file.getFile()).text();
        const w = await file.createWritable();
        await w.write(existing + (action.content || ''));
        await w.close();
        return { workspace: wsLabel, path, appended: (action.content || '').length };
      }
      case 'delete_file': {
        const parts = splitPathParts(path);
        const name = parts.pop();
        const dir = await getDirHandle(ctx, parts.join('/'), false, rootHandle);
        await dir.removeEntry(name, { recursive: action.recursive || false });
        return { workspace: wsLabel, path, deleted: true };
      }
      case 'list_dir': {
        const dir = await getDirHandle(ctx, path || '.', false, rootHandle);
        const entries = [];
        for await (const [name, handle] of dir.entries()) entries.push({ name, type: handle.kind });
        entries.sort((a, b) => a.name.localeCompare(b.name));
        return { workspace: wsLabel, path: path || '.', entries };
      }
      case 'mkdir': {
        await getDirHandle(ctx, path, true, rootHandle);
        return { workspace: wsLabel, path, created: true };
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
  };
})();
