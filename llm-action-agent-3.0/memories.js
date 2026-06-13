(() => {
  'use strict';

  const MARKER_CONTENT = '===CONTENT===';
  const MEMORIES_LOCAL_KEY = 'llm_action_agent_memories_local';

  const MEMORY_ACTION_DEFS = [
    {
      type: 'list_memories',
      label: '列出记忆',
      scope: 'memory',
      dangerous: false,
      desc: '列出所有持久记忆文档及摘要',
      example: { type: 'list_memories' },
    },
    {
      type: 'read_memory',
      label: '读取记忆',
      scope: 'memory',
      dangerous: false,
      desc: '按 name 读取一篇记忆的全文',
      example: { type: 'read_memory', name: 'user-prefs' },
    },
    {
      type: 'save_memory',
      label: '保存记忆',
      scope: 'memory',
      dangerous: false,
      desc: '创建或更新记忆（name/title/desc/content 或 raw）',
      example: { type: 'save_memory', name: 'user-prefs', title: '用户偏好', content: '…' },
    },
    {
      type: 'append_memory',
      label: '追加记忆',
      scope: 'memory',
      dangerous: false,
      desc: '向指定 name 的记忆末尾追加内容',
      example: { type: 'append_memory', name: 'user-prefs', content: '\n新条目…' },
    },
    {
      type: 'delete_memory',
      label: '删除记忆',
      scope: 'memory',
      dangerous: true,
      desc: '删除指定 name 的记忆文档',
      example: { type: 'delete_memory', name: 'old-notes' },
    },
  ];

  const MEMORY_ACTIONS = MEMORY_ACTION_DEFS.map((a) => a.type);

  function getLocalMemoriesStore() {
    try {
      return JSON.parse(localStorage.getItem(MEMORIES_LOCAL_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function setLocalMemoriesStore(store) {
    localStorage.setItem(MEMORIES_LOCAL_KEY, JSON.stringify(store));
  }

  function parseMemoryFile(text, fallbackName) {
    const raw = String(text || '');
    let name = fallbackName || 'memory';
    let title = name;
    let desc = '';

    const metaName = raw.match(/^@name:\s*(.+)$/m);
    const metaTitle = raw.match(/^@title:\s*(.+)$/m);
    const metaDesc = raw.match(/^@desc:\s*(.+)$/m);
    if (metaName) name = metaName[1].trim();
    if (metaTitle) title = metaTitle[1].trim();
    if (metaDesc) desc = metaDesc[1].trim();

    const contentIdx = raw.indexOf(MARKER_CONTENT);
    let content = '';
    if (contentIdx >= 0) {
      content = raw.slice(contentIdx + MARKER_CONTENT.length).trim();
    } else {
      content = raw.trim();
    }

    return { name, title, desc, content, raw };
  }

  function buildMemoryFileContent({ name, title, desc, content, raw }) {
    if (raw) return raw;
    return [
      `@name: ${name}`,
      `@title: ${title || name}`,
      `@desc: ${desc || ''}`,
      '',
      MARKER_CONTENT,
      content || '',
    ].join('\n');
  }

  function localMemoryToSummary(m) {
    const preview = (m.content || '').trim().split('\n')[0]?.slice(0, 100) || m.desc || '';
    return {
      name: m.name,
      title: m.title || m.name,
      desc: m.desc || '',
      contentPreview: preview,
      filename: m.filename || (m.name + '.txt'),
      source: 'local',
    };
  }

  async function apiFetch(deps, path, options) {
    const url = deps.config.backendUrl.replace(/\/$/, '') + path;
    const headers = {
      ...(options?.headers || {}),
      Authorization: 'Bearer ' + deps.config.backendToken,
      'X-Action-Token': deps.config.backendToken,
    };
    const res = await fetch(url, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '请求失败 ' + res.status);
    return data;
  }

  function mergeMemoryLists(serverList, localStore) {
    const byName = new Map();
    for (const m of serverList || []) byName.set(m.name, { ...m, source: 'server' });
    for (const m of Object.values(localStore || {})) {
      const summary = localMemoryToSummary(m);
      if (!byName.has(summary.name)) byName.set(summary.name, summary);
    }
    return [...byName.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  async function listMemories(deps) {
    const localStore = getLocalMemoriesStore();
    if (await deps.isBackendOnline()) {
      try {
        const data = await apiFetch(deps, '/memories', { method: 'GET' });
        return {
          memories: mergeMemoryLists(data.memories || [], localStore),
          memoriesDir: data.memoriesDir,
          source: 'server',
        };
      } catch (err) {
        if (!Object.keys(localStore).length) throw err;
      }
    }
    if (!Object.keys(localStore).length) {
      throw new Error('列出记忆需要后端在线（server.py），或先在界面创建本地记忆');
    }
    return {
      memories: mergeMemoryLists([], localStore),
      source: 'local',
    };
  }

  async function readMemory(deps, name) {
    if (!name) throw new Error('read_memory 缺少 name');
    if (await deps.isBackendOnline()) {
      try {
        const data = await apiFetch(deps, '/memories/' + encodeURIComponent(name), { method: 'GET' });
        return data.memory;
      } catch (err) {
        const local = getLocalMemoriesStore()[name];
        if (local) return local;
        throw err;
      }
    }
    const local = getLocalMemoriesStore()[name];
    if (local) return local;
    throw new Error('读取记忆需要后端在线或本地已缓存该记忆');
  }

  async function saveMemory(deps, action) {
    const name = (action.name || '').trim();
    if (!name) throw new Error('save_memory 缺少 name');
    let memory;
    if (action.content != null && !action.raw) {
      memory = { name, title: action.title || name, desc: action.desc || '', content: action.content };
    } else {
      memory = parseMemoryFile(
        action.raw || buildMemoryFileContent(action),
        name
      );
    }
    memory.updatedAt = Date.now();

    const store = getLocalMemoriesStore();
    store[name] = memory;
    setLocalMemoriesStore(store);
    deps.onMemoriesChanged?.();

    if (await deps.isBackendOnline()) {
      try {
        const data = await apiFetch(deps, '/memories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(memory),
        });
        return { memory: data.memory || memory, savedTo: 'server+local' };
      } catch (err) {
        return { memory, savedTo: 'local', warning: err.message };
      }
    }
    return { memory, savedTo: 'local' };
  }

  async function appendMemory(deps, action) {
    const name = (action.name || '').trim();
    if (!name) throw new Error('append_memory 缺少 name');
    const existing = await readMemory(deps, name);
    const content = (existing.content || '') + (action.content ?? '');
    return saveMemory(deps, {
      name,
      title: existing.title,
      desc: existing.desc,
      content,
    });
  }

  async function deleteMemory(deps, action) {
    const name = (action.name || '').trim();
    if (!name) throw new Error('delete_memory 缺少 name');
    const store = getLocalMemoriesStore();
    delete store[name];
    setLocalMemoriesStore(store);
    deps.onMemoriesChanged?.();

    if (await deps.isBackendOnline()) {
      try {
        await apiFetch(deps, '/memories/' + encodeURIComponent(name) + '/delete', { method: 'POST' });
        return { deleted: name, removedFrom: 'server+local' };
      } catch (err) {
        return { deleted: name, removedFrom: 'local', warning: err.message };
      }
    }
    return { deleted: name, removedFrom: 'local' };
  }

  function migrateLegacySingleMemory(deps, legacyText) {
    const text = (legacyText || '').trim();
    if (!text) return false;
    const store = getLocalMemoriesStore();
    if (Object.keys(store).length) return false;
    const memory = {
      name: 'general',
      title: '通用记忆',
      desc: '从旧版单条记忆迁移',
      content: text,
      updatedAt: Date.now(),
    };
    store.general = memory;
    setLocalMemoriesStore(store);
    deps.onMemoriesChanged?.();
    return true;
  }

  async function executeAction(action, deps) {
    switch (action.type) {
      case 'list_memories': return listMemories(deps);
      case 'read_memory': return readMemory(deps, action.name);
      case 'save_memory': return saveMemory(deps, action);
      case 'append_memory': return appendMemory(deps, action);
      case 'delete_memory': return deleteMemory(deps, action);
      default: throw new Error('未知记忆动作: ' + action.type);
    }
  }

  function buildPromptSection(summaries) {
    let s = '\n\n## 持久记忆\n';
    s += '记忆为多篇独立文档，存于 config/memories/。先 list_memories 查看，再 read_memory 按需加载；用 save_memory / append_memory 更新，delete_memory 删除。\n';
    s += '**不会自动注入全文**，避免占满上下文；需要时再 read_memory。\n';
    if (summaries?.length) {
      s += '已有记忆：\n' + summaries.map((m) =>
        `- ${m.name}: ${m.title}${m.desc ? ' — ' + m.desc : ''}${m.contentPreview ? ' · ' + m.contentPreview : ''}`
      ).join('\n') + '\n';
    } else {
      s += '（暂无记忆文档）\n';
    }
    return s;
  }

  function renderMemoryListHtml(memories, activeName) {
    if (!memories?.length) {
      return '<p class="panel-desc">暂无记忆。点击「新建」创建，或启动 server.py 后从 config/memories/ 加载。</p>';
    }
    return memories.map((m) => `
      <button type="button" class="plugin-card memory-card ${m.name === activeName ? 'active' : ''}" data-memory-name="${escapeHtml(m.name)}">
        <h3>${escapeHtml(m.title || m.name)}</h3>
        <code class="plugin-name">${escapeHtml(m.name)}</code>
        ${m.desc ? `<p class="memory-desc">${escapeHtml(m.desc)}</p>` : ''}
        <p class="plugin-use">${escapeHtml(m.contentPreview || m.desc || '')}</p>
        ${m.source === 'local' ? '<span class="plugin-badge">本地</span>' : ''}
      </button>
    `).join('');
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const MEMORY_FORMAT_HELP = `记忆文本格式示例：

@name: user-prefs
@title: 用户偏好
@desc: 用户习惯、默认选项、禁忌操作

===CONTENT===
用户喜欢简洁回复…
项目使用 TypeScript…`;

  window.AgentMemories = {
    MEMORY_ACTION_DEFS,
    MEMORY_ACTIONS,
    MEMORIES_LOCAL_KEY,
    MARKER_CONTENT,
    parseMemoryFile,
    buildMemoryFileContent,
    getLocalMemoriesStore,
    migrateLegacySingleMemory,
    executeAction,
    buildPromptSection,
    renderMemoryListHtml,
    MEMORY_FORMAT_HELP,
  };
})();
