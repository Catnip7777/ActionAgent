(() => {
  'use strict';

  const reg = window.AgentActionRegistry;

  const TASK_ACTION_DEFS = [
    { type: 'task_list', label: '列出任务', scope: 'task', dangerous: false, desc: '列出任务板上的任务，可按 status/parentId 过滤', example: { type: 'task_list' } },
    { type: 'task_add', label: '添加任务', scope: 'task', dangerous: false, desc: '在任务板添加任务，可选 parentId 作为子任务', example: { type: 'task_add', title: '完成报告', description: '整理本周数据' } },
    { type: 'task_update', label: '更新任务', scope: 'task', dangerous: false, desc: '更新任务标题、描述、状态或父任务', example: { type: 'task_update', id: '...', status: 'in_progress' } },
    { type: 'task_delete', label: '删除任务', scope: 'task', dangerous: false, desc: '删除任务，recursive:true 时连同子任务删除', example: { type: 'task_delete', id: '...' } },
    { type: 'task_decompose', label: '分解任务', scope: 'task', dangerous: false, desc: '将任务分解为多个子任务并添加到任务板', example: { type: 'task_decompose', id: '...', subtasks: [{ title: '步骤1' }, { title: '步骤2' }] } },
    { type: 'task_check', label: '检查任务', scope: 'task', dangerous: false, desc: '检查并标记任务完成，可附检查备注', example: { type: 'task_check', id: '...', note: '已验证通过' } },
  ];

  for (const d of TASK_ACTION_DEFS) reg.register(d);

  const TASK_ACTIONS = TASK_ACTION_DEFS.map((a) => a.type);

  function ensureTasks(deps) {
    const conv = deps.getActiveConversation();
    if (!conv) throw new Error('无活动对话');
    if (!Array.isArray(conv.tasks)) conv.tasks = [];
    return conv.tasks;
  }

  function findTask(tasks, id) { return tasks.find((t) => t.id === id); }

  function collectDescendants(tasks, id) {
    const ids = [id];
    let changed = true;
    while (changed) { changed = false; for (const t of tasks) { if (t.parentId && ids.includes(t.parentId) && !ids.includes(t.id)) { ids.push(t.id); changed = true; } } }
    return ids;
  }

  function taskList(deps, action) {
    let tasks = ensureTasks(deps);
    if (action.status) tasks = tasks.filter((t) => t.status === action.status);
    if (action.parentId !== undefined) tasks = tasks.filter((t) => (t.parentId || null) === (action.parentId || null));
    return { tasks: tasks.map((t) => ({ ...t })), total: tasks.length, summary: summarizeTasks(ensureTasks(deps)) };
  }

  function taskAdd(deps, action) {
    const tasks = ensureTasks(deps);
    if (!action.title?.trim()) throw new Error('task_add 缺少 title');
    if (action.parentId && !findTask(tasks, action.parentId)) throw new Error('父任务不存在: ' + action.parentId);
    const task = { id: window.__agentCore.safeId(), title: action.title.trim(), description: (action.description || '').trim(), status: action.status || 'pending', parentId: action.parentId || null, checked: false, checkNote: '', createdAt: Date.now(), updatedAt: Date.now() };
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
    const removeIds = action.recursive ? collectDescendants(tasks, action.id) : [action.id];
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
      created.push(taskAdd(deps, { title: st.title, description: st.description || '', parentId: parent.id, status: st.status || 'pending' }).task);
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
      case 'task_list': return taskList(deps, action);
      case 'task_add': return taskAdd(deps, action);
      case 'task_update': return taskUpdate(deps, action);
      case 'task_delete': return taskDelete(deps, action);
      case 'task_decompose': return taskDecompose(deps, action);
      case 'task_check': return taskCheck(deps, action);
      default: throw new Error('未知动作类型: ' + action.type);
    }
  }

  window.AgentTasks = {
    TASK_ACTION_DEFS,
    TASK_ACTIONS,
    executeAction,
    summarizeTasks,
  };
})();
