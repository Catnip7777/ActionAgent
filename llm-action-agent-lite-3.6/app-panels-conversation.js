(() => {
  'use strict';

  const core = window.__agentCore;
  const chatUI = window.__agentChatUI;
  if (!core || !chatUI) throw new Error('app-panels-conversation.js missing dependencies');

  function renderConversationList() {
    const convStore = core.getConvStore();
    core.ensureConvGroups();
    const el = document.getElementById('conversationList');
    if (!el) return;
    const sorted = [...convStore.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
    let html = '';
    const ungrouped = sorted.filter((c) => !c.groupId);
    if (ungrouped.length) html += renderConvGroupSection({ id: '', name: '未分组' }, ungrouped, { system: true });
    const groups = [...convStore.groups].sort((a, b) => a.createdAt - b.createdAt);
    for (const g of groups) { const items = sorted.filter((c) => c.groupId === g.id); html += renderConvGroupSection(g, items); }
    el.innerHTML = html || '<p class="conv-empty-hint">暂无对话</p>';
    el.querySelectorAll('.conversation-item').forEach((li) => { li.addEventListener('click', (e) => { if (e.target.closest('.conv-delete, .conv-group-select')) return; setActiveConversation(li.dataset.id); }); });
    el.querySelectorAll('.conv-delete').forEach((btn) => { btn.addEventListener('click', (e) => deleteConversationById(btn.dataset.id, e)); });
    el.querySelectorAll('.conv-group-select').forEach((sel) => { sel.addEventListener('click', (e) => e.stopPropagation()); sel.addEventListener('change', (e) => { moveConversationToGroup(sel.dataset.id, sel.value || null); }); });
    el.querySelectorAll('.conv-group-toggle[data-id]').forEach((btn) => { btn.addEventListener('click', (e) => { e.stopPropagation(); toggleConvGroupCollapsed(btn.dataset.id); }); });
    el.querySelectorAll('.conv-group-rename').forEach((btn) => { btn.addEventListener('click', (e) => { e.stopPropagation(); renameConvGroup(btn.dataset.id); }); });
    el.querySelectorAll('.conv-group-delete').forEach((btn) => { btn.addEventListener('click', (e) => { e.stopPropagation(); deleteConvGroup(btn.dataset.id); }); });
  }

  function renderConvGroupSection(group, convs, { system } = {}) {
    const collapsed = !system && group.collapsed;
    return `<div class="conv-group ${collapsed ? 'collapsed' : ''}">
      <div class="conv-group-header">
        ${system ? '<span>📂</span>' : `<button type="button" class="conv-group-toggle" data-id="${group.id}">${collapsed ? '▶' : '▼'}</button>`}
        <span>${core.escapeHtml(group.name)}</span>
        ${system ? '' : `<button type="button" class="conv-group-rename" data-id="${group.id}">✎</button><button type="button" class="conv-group-delete" data-id="${group.id}">×</button>`}
      </div>
      <ul class="conv-group-list">${convs.map(renderConvListItem).join('')}</ul></div>`;
  }

  function renderConvListItem(c) {
    const convStore = core.getConvStore();
    const hasGroups = (convStore.groups || []).length > 0;
    const groupSelect = hasGroups ? `<select class="conv-group-select" data-id="${c.id}"><option value="" ${!c.groupId ? 'selected' : ''}>未分组</option>${(convStore.groups || []).map((g) => `<option value="${g.id}" ${c.groupId === g.id ? 'selected' : ''}>${core.escapeHtml(g.name)}</option>`).join('')}</select>` : '';
    return `<li class="conversation-item ${c.id === convStore.activeId ? 'active' : ''}" data-id="${c.id}"><span class="conv-title">${core.escapeHtml(c.title)}</span>${groupSelect}<button type="button" class="conv-delete" data-id="${c.id}">×</button></li>`;
  }

  function setActiveConversation(id) {
    const convStore = core.getConvStore();
    const oldConv = convStore.conversations.find(c => c.id === convStore.activeId);
    if (oldConv) oldConv.messages = core.getMessages();
    convStore.activeId = id;
    core.setMessages([...(core.getActiveConversation()?.messages || [])]);
    core.saveConversationsStore();
    chatUI.renderChatMessages();
    chatUI.updateChatTitle();
    renderConversationList();
    chatUI.renderToolbarTasks();
    chatUI.switchPanel('chat');
  }

  function deleteConversationById(id, e) {
    if (e) e.stopPropagation();
    const idx = core.getConvStore().conversations.findIndex((c) => c.id === id);
    if (idx < 0) return;
    if (!confirm('确定删除此对话？')) return;
    core.getConvStore().conversations.splice(idx, 1);
    if (core.getConvStore().activeId === id) {
      if (core.getConvStore().conversations.length) setActiveConversation(core.getConvStore().conversations[0].id);
      else { const conv = core.createConversation(); core.getConvStore().conversations.push(conv); core.getConvStore().activeId = conv.id; core.setMessages([]); chatUI.renderChatMessages(); chatUI.updateChatTitle(); }
    }
    core.saveConversationsStore();
    renderConversationList();
  }

  function renameConvGroup(groupId) {
    const group = core.getConvStore().groups.find((g) => g.id === groupId);
    if (!group) return;
    const name = prompt('分组名称', group.name);
    if (name == null) return;
    group.name = name.trim().slice(0, 30) || group.name;
    core.saveConversationsStore();
    renderConversationList();
  }

  function deleteConvGroup(groupId) {
    const group = core.getConvStore().groups.find((g) => g.id === groupId);
    if (!group || !confirm(`删除分组「${group.name}」？`)) return;
    core.getConvStore().conversations.forEach((c) => { if (c.groupId === groupId) c.groupId = null; });
    core.getConvStore().groups = core.getConvStore().groups.filter((g) => g.id !== groupId);
    core.saveConversationsStore();
    renderConversationList();
  }

  function toggleConvGroupCollapsed(groupId) {
    const group = core.getConvStore().groups.find((g) => g.id === groupId);
    if (!group) return;
    group.collapsed = !group.collapsed;
    core.saveConversationsStore();
    renderConversationList();
  }

  function moveConversationToGroup(convId, groupId) {
    const conv = core.getConvStore().conversations.find((c) => c.id === convId);
    if (!conv) return;
    conv.groupId = groupId || null;
    core.saveConversationsStore();
    renderConversationList();
  }

  function initConversations() {
    core.ensureConvGroups();
    const convStore = core.getConvStore();
    if (!convStore.conversations.length) { const conv = core.createConversation(); convStore.conversations.push(conv); convStore.activeId = conv.id; }
    if (!convStore.activeId || !core.getActiveConversation()) convStore.activeId = convStore.conversations[0].id;
    core.setMessages([...(core.getActiveConversation()?.messages || [])]);
    if (!core.getActiveConversation()?.tasks) core.getActiveConversation().tasks = [];
    core.saveConversationsStore();
    renderConversationList();
    chatUI.renderChatMessages();
    chatUI.renderTaskBoardUI();
    chatUI.updateChatTitle();
    // 注册排序刷新回调：发消息/保存后自动重新渲染对话列表
    core.onConvChange(() => renderConversationList());
  }

  window.__agentPanelsConv = { renderConversationList, setActiveConversation, deleteConversationById, initConversations };
})();