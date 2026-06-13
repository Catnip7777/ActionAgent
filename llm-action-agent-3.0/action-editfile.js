(() => {
  'use strict';
  if (!window.AgentActionRegistry) { console.warn('edit_file skip'); return; }

  const R = window.AgentActionRegistry;

  const D = {
    type: 'edit_file', label: '编辑文件（安全）', scope: 'file', dangerous: false,
    desc: '灵活编辑文件（基于浏览器文件系统，无需后端）：replace/replaceAll/insertLines/removeLines/replaceLines/prepend/append',
    example: { type: 'edit_file', path: 'notes/hello.txt', op: 'replaceAll', pattern: '旧文本', replacement: '新文本' },
  };

  async function getFileHandle(ctx, subPath, create) {
    const ws = ctx.resolveWorkspaceFromAction({});
    const handle = await ctx.getBrowserHandleForWorkspace(ws);
    if (!handle) throw new Error('未授权文件夹，请先在「工作区」面板授权浏览器文件夹');
    const pathUtil = window.AgentActionPath;
    const parts = pathUtil.splitPathParts(subPath || '');
    if (!parts.length) throw new Error('path 不能为空');
    const name = parts.pop();
    let dir = handle;
    for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: create || false });
    return dir.getFileHandle(name, { create: create || false });
  }

  async function readFile(ctx, path) {
    const file = await getFileHandle(ctx, path, false);
    const obj = await file.getFile();
    return { content: await obj.text() };
  }

  async function writeFile(ctx, path, content) {
    const file = await getFileHandle(ctx, path, true);
    const w = await file.createWritable();
    await w.write(content);
    await w.close();
  }

  function splitLines(text) { return text.split('\n'); }

  function findLineIndex(lines, text, startFrom) {
    startFrom = startFrom || 0;
    for (let i = startFrom; i < lines.length; i++) { if (lines[i].includes(text)) return i; }
    return -1;
  }

  function findExactLineIndex(lines, text, startFrom) {
    startFrom = startFrom || 0;
    for (let i = startFrom; i < lines.length; i++) { if (lines[i] === text) return i; }
    return -1;
  }

  function getContent(A) { return A.text ?? A.content; }

  async function E(A, C) {
    const p = A.path;
    if (!p) throw new Error('need path');
    const ws = C.resolveWorkspaceFromAction(A);
    C.assertWorkspaceFilePermission(A, ws);
    const r = await readFile(C, p);
    let c = r.content;
    const o = A.op || 'replace';
    switch (o) {
      case 'replaceAll': { if (A.pattern == null) throw new Error('need pattern'); c = c.split(A.pattern).join(A.replacement || ''); break; }
      case 'replace': { if (A.pattern == null) throw new Error('need pattern'); if (A.flags && A.flags.includes('g')) c = c.split(A.pattern).join(A.replacement || ''); else c = c.replace(A.pattern, A.replacement || ''); break; }
      case 'replaceLines': {
        const lines = splitLines(c); let from, to;
        if (A.from != null) { from = A.from; to = A.to != null ? A.to : from + 1; }
        else if (A.pattern != null) { let idx = findExactLineIndex(lines, A.pattern); if (idx === -1) idx = findLineIndex(lines, A.pattern); if (idx === -1) throw new Error('未找到匹配的行: ' + A.pattern); from = idx; to = A.to != null ? A.to : from + 1; } else throw new Error('需要 from+to 或 pattern');
        if (from < 0 || to > lines.length || from >= to) throw new Error('无效的行范围');
        const replacementLines = (A.replacement || '').split('\n');
        lines.splice(from, to - from, ...replacementLines); c = lines.join('\n'); break;
      }
      case 'insertLines': {
        const lines = splitLines(c); let at;
        if (A.at != null) at = A.at;
        else if (A.pattern != null) { const where = A.where || 'before'; let idx = findExactLineIndex(lines, A.pattern); if (idx === -1) idx = findLineIndex(lines, A.pattern); if (idx === -1) throw new Error('未找到匹配的行: ' + A.pattern); at = where === 'after' ? idx + 1 : idx; } else throw new Error('需要 at 或 pattern');
        if (at < 0 || at > lines.length) throw new Error('at 超出范围');
        const insertContent = getContent(A); if (insertContent == null) throw new Error('insertLines 需要 text 或 content');
        const insertLines = insertContent.split('\n'); lines.splice(at, 0, ...insertLines); c = lines.join('\n'); break;
      }
      case 'removeLines': {
        const lines = splitLines(c); let from, to;
        if (A.from != null) { from = A.from; to = A.to != null ? A.to : from + 1; }
        else if (A.pattern != null) { let idx = findExactLineIndex(lines, A.pattern); if (idx === -1) idx = findLineIndex(lines, A.pattern); if (idx === -1) throw new Error('未找到匹配的行: ' + A.pattern); from = idx; to = A.to != null ? A.to : from + 1; } else throw new Error('需要 from+to 或 pattern');
        if (from < 0 || to > lines.length || from >= to) throw new Error('无效的行范围');
        lines.splice(from, to - from); c = lines.join('\n'); break;
      }
      case 'prepend': { const t = getContent(A); if (t == null) throw new Error('prepend 需要 text 或 content'); c = t + c; break; }
      case 'append': { const t = getContent(A); if (t == null) throw new Error('append 需要 text 或 content'); c = c + t; break; }
      default: throw new Error('unknown op ' + o);
    }
    await writeFile(C, p, c);
    if (typeof window.__agentCore?.onContextFileWritten === 'function') {
      window.__agentCore.onContextFileWritten(p, false, c);
    }
    return { path: p, op: o, lengthBefore: r.content.length, lengthAfter: c.length, changed: r.content !== c };
  }

  R.register(D, { execute: E, dangerous: false });
  window.AgentActionEditFile = { DEFS: [D] };

  // 自动启用 edit_file
  const KEY = 'llm_action_agent_config';
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const cfg = JSON.parse(raw);
      const acts = cfg.enabledActions || [];
      if (!acts.includes('edit_file')) { acts.push('edit_file'); cfg.enabledActions = acts; localStorage.setItem(KEY, JSON.stringify(cfg)); }
    }
  } catch (e) {}
})();