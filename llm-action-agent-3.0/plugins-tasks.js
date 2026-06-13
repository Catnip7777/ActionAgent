(() => {
  'use strict';

  const MARKER_INFO = '===INFO===';
  const MARKER_USE = '===USE===';
  const PLUGINS_LOCAL_KEY = 'llm_action_agent_plugins_local';

  const PLUGIN_TASK_ACTION_DEFS = [
    {
      type: 'list_plugins',
      label: '列出插件',
      scope: 'plugin',
      dangerous: false,
      desc: '列出 config/plugins/ 下可用插件及用法摘要',
      example: { type: 'list_plugins' },
    },
    {
      type: 'read_plugin',
      label: '读取插件',
      scope: 'plugin',
      dangerous: false,
      desc: '读取插件完整流程信息与用法说明',
      example: { type: 'read_plugin', name: 'example-workflow' },
    },
    {
      type: 'save_plugin',
      label: '保存插件',
      scope: 'plugin',
      dangerous: false,
      desc: '创建或更新插件（name/title/info/use 或 raw）',
      example: { type: 'save_plugin', name: 'my-flow', title: '流程', info: '步骤…', use: '何时使用' },
    },
    {
      type: 'delete_plugin',
      label: '删除插件',
      scope: 'plugin',
      dangerous: true,
      desc: '删除指定名称的插件',
      example: { type: 'delete_plugin', name: 'my-flow' },
    },
    {
      type: 'task_list',
      label: '列出任务',
      scope: 'task',
      dangerous: false,
      desc: '列出任务板上的任务，可按 status/parentId 过滤',
      example: { type: 'task_list' },
    },
    {
      type: 'task_add',
      label: '添加任务',
      scope: 'task',
      dangerous: false,
      desc: '在任务板添加任务，可选 parentId 作为子任务',
      example: { type: 'task_add', title: '完成报告', description: '整理本周数据' },
    },
    {
      type: 'task_update',
      label: '更新任务',
      scope: 'task',
      dangerous: false,
      desc: '更新任务标题、描述、状态或父任务',
      example: { type: 'task_update', id: '…', status: 'in_progress' },
    },
    {
      type: 'task_delete',
      label: '删除任务',
      scope: 'task',
      dangerous: false,
      desc: '删除任务，recursive:true 时连同子任务删除',
      example: { type: 'task_delete', id: '…' },
    },
    {
      type: 'task_decompose',
      label: '分解任务',
      scope: 'task',
      dangerous: false,
      desc: '将任务分解为多个子任务并添加到任务板',
      example: {
        type: 'task_decompose',
        id: '…',
        subtasks: [{ title: '步骤1' }, { title: '步骤2' }],
      },
    },
    {
      type: 'task_check',
      label: '检查任务',
      scope: 'task',
      dangerous: false,
      desc: '检查并标记任务完成，可附检查备注',
      example: { type: 'task_check', id: '…', note: '已验证通过' },
    },
  ];

  const PLUGIN_TASK_ACTIONS = PLUGIN_TASK_ACTION_DEFS.map((a) => a.type);

  function getLocalPluginsStore() {
    try {
      return JSON.parse(localStorage.getItem(PLUGINS_LOCAL_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function setLocalPluginsStore(store) {
    localStorage.setItem(PLUGINS_LOCAL_KEY, JSON.stringify(store));
  }

  function localPluginToSummary(p) {
    const usePreview = (p.use || '').trim().split('\n')[0]?.slice(0, 120) || '';
    return {
      name: p.name,
      title: p.title || p.name,
      usePreview,
      filename: p.filename || (p.name + '.txt'),
      source: 'local',
    };
  }

  function parsePluginFile(text, fallbackName) {
    const raw = String(text || '');
    let name = fallbackName || 'unknown';
    let title = name;

    const metaName = raw.match(/^@name:\s*(.+)$/m);
    const metaTitle = raw.match(/^@title:\s*(.+)$/m);
    if (metaName) name = metaName[1].trim();
    if (metaTitle) title = metaTitle[1].trim();

    const infoIdx = raw.indexOf(MARKER_INFO);
    const useIdx = raw.indexOf(MARKER_USE);

    if (infoIdx >= 0 && useIdx >= 0 && useIdx > infoIdx) {
      const info = raw.slice(infoIdx + MARKER_INFO.length, useIdx).trim();
      const use = raw.slice(useIdx + MARKER_USE.length).trim();
      return { name, title, info, use, raw };
    }

    if (infoIdx >= 0) {
      const info = raw.slice(infoIdx + MARKER_INFO.length).trim();
      return { name, title, info, use: '', raw };
    }

    const lines = raw.trim().split('\n');
    if (lines.length >= 2) {
      return {
        name,
        title,
        info: lines.slice(0, -1).join('\n').trim(),
        use: lines[lines.length - 1].trim(),
        raw,
      };
    }

    return { name, title, info: raw.trim(), use: '', raw };
  }

  function buildPluginFileContent({ name, title, info, use, raw }) {
    if (raw) return raw;
    return [
      `@name: ${name}`,
      `@title: ${title || name}`,
      '',
      MARKER_INFO,
      info || '',
      MARKER_USE,
      use || '',
    ].join('\n');
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

  function mergePluginLists(serverList, localStore) {
    const byName = new Map();
    for (const p of serverList || []) byName.set(p.name, { ...p, source: 'server' });
    for (const p of Object.values(localStore || {})) {
      const summary = localPluginToSummary(p);
      if (!byName.has(summary.name)) byName.set(summary.name, summary);
    }
    return [...byName.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  async function listPlugins(deps) {
    const localStore = getLocalPluginsStore();
    let serverList = [];
    if (await deps.isBackendOnline()) {
      try {
        const data = await apiFetch(deps, '/plugins', { method: 'GET' });
        serverList = data.plugins || [];
        return {
          plugins: mergePluginLists(serverList, localStore),
          pluginsDir: data.pluginsDir,
          source: 'server',
        };
      } catch (err) {
        if (!Object.keys(localStore).length) throw err;
      }
    }
    if (!Object.keys(localStore).length) {
      throw new Error('列出插件需要本地后端在线（server.py），或先在界面创建本地插件');
    }
    return {
      plugins: mergePluginLists([], localStore),
      source: 'local',
    };
  }

  async function readPlugin(deps, name) {
    if (!name) throw new Error('read_plugin 缺少 name');
    if (await deps.isBackendOnline()) {
      try {
        const data = await apiFetch(deps, '/plugins/' + encodeURIComponent(name), { method: 'GET' });
        return data.plugin;
      } catch (err) {
        const local = getLocalPluginsStore()[name];
        if (local) return local;
        throw err;
      }
    }
    const local = getLocalPluginsStore()[name];
    if (local) return local;
    throw new Error('读取插件需要后端在线或本地已缓存该插件');
  }

  async function savePlugin(deps, action) {
    const name = (action.name || '').trim();
    if (!name) throw new Error('save_plugin 缺少 name');
    const plugin = parsePluginFile(
      action.raw || buildPluginFileContent(action),
      name
    );
    plugin.updatedAt = Date.now();

    const store = getLocalPluginsStore();
    store[name] = plugin;
    setLocalPluginsStore(store);
    deps.onPluginsChanged?.();

    if (await deps.isBackendOnline()) {
      try {
        const data = await apiFetch(deps, '/plugins', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(plugin),
        });
        return { plugin: data.plugin || plugin, savedTo: 'server+local' };
      } catch (err) {
        return { plugin, savedTo: 'local', warning: err.message };
      }
    }
    return { plugin, savedTo: 'local' };
  }

  async function deletePlugin(deps, action) {
    const name = (action.name || '').trim();
    if (!name) throw new Error('delete_plugin 缺少 name');
    const store = getLocalPluginsStore();
    delete store[name];
    setLocalPluginsStore(store);
    deps.onPluginsChanged?.();

    if (await deps.isBackendOnline()) {
      try {
        await apiFetch(deps, '/plugins/' + encodeURIComponent(name) + '/delete', { method: 'POST' });
        return { deleted: name, removedFrom: 'server+local' };
      } catch (err) {
        return { deleted: name, removedFrom: 'local', warning: err.message };
      }
    }
    return { deleted: name, removedFrom: 'local' };
  }

  function ensureTasks(deps) {
    const conv = deps.getActiveConversation();
    if (!conv) throw new Error('无活动对话，无法操作任务板');
    if (!Array.isArray(conv.tasks)) conv.tasks = [];
    return conv.tasks;
  }

  function findTask(tasks, id) {
    return tasks.find((t) => t.id === id);
  }

  function collectDescendants(tasks, id) {
    const ids = [id];
    let changed = true;
    while (changed) {
      changed = false;
      for (const t of tasks) {
        if (t.parentId && ids.includes(t.parentId) && !ids.includes(t.id)) {
          ids.push(t.id);
          changed = true;
        }
      }
    }
    return ids;
  }

  function taskList(deps, action) {
    let tasks = ensureTasks(deps);
    if (action.status) tasks = tasks.filter((t) => t.status === action.status);
    if (action.parentId !== undefined) {
      tasks = tasks.filter((t) => (t.parentId || null) === (action.parentId || null));
    }
    return {
      tasks: tasks.map((t) => ({ ...t })),
      total: tasks.length,
      summary: summarizeTasks(ensureTasks(deps)),
    };
  }

  function taskAdd(deps, action) {
    const tasks = ensureTasks(deps);
    if (!action.title?.trim()) throw new Error('task_add 缺少 title');
    if (action.parentId && !findTask(tasks, action.parentId)) {
      throw new Error('父任务不存在: ' + action.parentId);
    }
    const task = {
      id: crypto.randomUUID(),
      title: action.title.trim(),
      description: (action.description || '').trim(),
      status: action.status || 'pending',
      parentId: action.parentId || null,
      checked: false,
      checkNote: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    tasks.push(task);
    deps.onTasksChanged();
    return { task, summary: summarizeTasks(tasks) };
  }

  function taskUpdate(deps, action) {
    const tasks = ensureTasks(deps);
    const task = findTask(tasks, action.id);
    if (!task) throw new Error('任务不存在: ' + action.id);
    if (action.title != null) task.title = String(action.title).trim();
    if (action.description != null) task.description = String(action.description).trim();
    if (action.status != null) task.status = action.status;
    if (action.parentId !== undefined) task.parentId = action.parentId || null;
    task.updatedAt = Date.now();
    deps.onTasksChanged();
    return { task, summary: summarizeTasks(tasks) };
  }

  function taskDelete(deps, action) {
    const tasks = ensureTasks(deps);
    if (!action.id) throw new Error('task_delete 缺少 id');
    const removeIds = action.recursive
      ? collectDescendants(tasks, action.id)
      : [action.id];
    if (!findTask(tasks, action.id)) throw new Error('任务不存在: ' + action.id);
    const before = tasks.length;
    deps.getActiveConversation().tasks = tasks.filter((t) => !removeIds.includes(t.id));
    deps.onTasksChanged();
    return { deleted: removeIds, removed: before - deps.getActiveConversation().tasks.length };
  }

  function taskDecompose(deps, action) {
    const tasks = ensureTasks(deps);
    const parent = findTask(tasks, action.id);
    if (!parent) throw new Error('任务不存在: ' + action.id);
    const subtasks = action.subtasks || [];
    if (!subtasks.length) throw new Error('task_decompose 缺少 subtasks');
    const created = [];
    for (const st of subtasks) {
      const r = taskAdd(deps, {
        title: st.title,
        description: st.description || '',
        parentId: parent.id,
        status: st.status || 'pending',
      });
      created.push(r.task);
    }
    parent.updatedAt = Date.now();
    deps.onTasksChanged();
    return { parentId: parent.id, subtasks: created, summary: summarizeTasks(tasks) };
  }

  function taskCheck(deps, action) {
    const tasks = ensureTasks(deps);
    const task = findTask(tasks, action.id);
    if (!task) throw new Error('任务不存在: ' + action.id);
    task.checked = action.checked !== false;
    task.checkNote = (action.note || action.checkNote || '').trim();
    task.status = action.status || (task.checked ? 'done' : task.status);
    task.updatedAt = Date.now();
    deps.onTasksChanged();
    return { task, summary: summarizeTasks(tasks) };
  }

  function summarizeTasks(tasks) {
    const counts = { pending: 0, in_progress: 0, done: 0, cancelled: 0 };
    for (const t of tasks) counts[t.status] = (counts[t.status] || 0) + 1;
    return { total: tasks.length, counts };
  }

  async function executeAction(action, deps) {
    switch (action.type) {
      case 'list_plugins': return listPlugins(deps);
      case 'read_plugin': return readPlugin(deps, action.name);
      case 'save_plugin': return savePlugin(deps, action);
      case 'delete_plugin': return deletePlugin(deps, action);
      case 'task_list': return taskList(deps, action);
      case 'task_add': return taskAdd(deps, action);
      case 'task_update': return taskUpdate(deps, action);
      case 'task_delete': return taskDelete(deps, action);
      case 'task_decompose': return taskDecompose(deps, action);
      case 'task_check': return taskCheck(deps, action);
      default: throw new Error('未知插件/任务动作: ' + action.type);
    }
  }

  function buildPromptSection(pluginSummaries, taskSummary) {
    let s = '\n\n## 插件系统\n';
    s += '插件为文本文件，含 ===INFO===（流程信息）与 ===USE===（使用方法）。\n';
    s += '需要时先 list_plugins，再 read_plugin 加载后按 INFO 执行；可用 save_plugin 更新。\n';
    if (pluginSummaries?.length) {
      s += '已发现插件：\n' + pluginSummaries.map((p) =>
        `- ${p.name}: ${p.title} — ${p.usePreview || '（见 read_plugin）'}`
      ).join('\n');
    }
    s += '\n\n## 任务板\n';
    s += '使用 task_add/task_update/task_delete/task_decompose/task_check/task_list 管理任务。\n';
    s += 'status: pending | in_progress | done | cancelled。分解任务用 task_decompose，检查完成用 task_check。\n';
    if (taskSummary) {
      s += `当前对话任务：共 ${taskSummary.total} 项（待办 ${taskSummary.counts.pending}，进行中 ${taskSummary.counts.in_progress}，完成 ${taskSummary.counts.done}）\n`;
    }
    return s;
  }

  function renderTaskBoardHtml(tasks) {
    if (!tasks?.length) {
      return '<p class="panel-desc">任务板为空。大模型可通过 task_add 添加任务，或通过对话描述让 AI 创建。</p>';
    }
    const columns = [
      { key: 'pending', label: '待办' },
      { key: 'in_progress', label: '进行中' },
      { key: 'done', label: '已完成' },
    ];
    function renderTask(t, depth) {
      const children = tasks.filter((c) => c.parentId === t.id);
      const check = t.checked ? ' ✓' : '';
      const indent = depth ? `style="margin-left:${depth * 16}px"` : '';
      let html = `<div class="task-card status-${t.status}" ${indent}>`;
      html += `<div class="task-card-title">${escapeHtml(t.title)}${check}</div>`;
      if (t.description) html += `<div class="task-card-desc">${escapeHtml(t.description)}</div>`;
      if (t.checkNote) html += `<div class="task-card-note">${escapeHtml(t.checkNote)}</div>`;
      html += `<div class="task-card-meta">${t.status} · ${new Date(t.updatedAt).toLocaleString()}</div>`;
      html += '</div>';
      for (const c of children) html += renderTask(c, depth + 1);
      return html;
    }
    return columns.map((col) => {
      const colTasks = tasks.filter((t) => t.status === col.key && !t.parentId);
      return `
        <div class="task-column">
          <h3>${col.label} (${colTasks.length})</h3>
          <div class="task-column-body">${colTasks.map((t) => renderTask(t, 0)).join('') || '<p class="task-empty">无</p>'}</div>
        </div>`;
    }).join('');
  }

  function renderPluginListHtml(plugins, activeName) {
    if (!plugins?.length) {
      return '<p class="panel-desc">暂无插件。点击「新建插件」或启动 server.py 后从 config/plugins/ 加载。</p>';
    }
    return plugins.map((p) => `
      <button type="button" class="plugin-card ${p.name === activeName ? 'active' : ''}" data-plugin-name="${escapeHtml(p.name)}">
        <h3>${escapeHtml(p.title || p.name)}</h3>
        <code class="plugin-name">${escapeHtml(p.name)}</code>
        <p class="plugin-use">${escapeHtml(p.usePreview || p.use || '')}</p>
        ${p.source === 'local' ? '<span class="plugin-badge">本地</span>' : ''}
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

  const PLUGIN_FORMAT_HELP = `插件文本格式示例：

@name: my-plugin
@title: 我的流程插件

===INFO===
1. 第一步操作说明
2. 第二步注意事项
===USE===
当用户需要 XXX 时，先 read_plugin 加载本插件，再按 INFO 中的步骤调用文件/命令动作。`;

  window.AgentPluginsTasks = {
    PLUGIN_TASK_ACTION_DEFS,
    PLUGIN_TASK_ACTIONS,
    PLUGINS_LOCAL_KEY,
    MARKER_INFO,
    MARKER_USE,
    parsePluginFile,
    buildPluginFileContent,
    getLocalPluginsStore,
    executeAction,
    buildPromptSection,
    renderTaskBoardHtml,
    renderPluginListHtml,
    PLUGIN_FORMAT_HELP,
    summarizeTasks,
  };
})();
