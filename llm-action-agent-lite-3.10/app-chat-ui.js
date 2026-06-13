(() => {
  'use strict';

  const core = window.__agentCore;
  const fmt = window.__agentFormat;
  const executor = window.__agentExecutor;
  const llm = window.__agentLLM;
  if (!core || !fmt || !executor || !llm) throw new Error('missing deps');

  function renderMarkdown(text) {
    if (!text) return '';
    if (typeof marked !== 'undefined') { try { return marked.parse(text, { breaks: true, gfm: true }); } catch {} }
    let result = '';
    const lines = text.split('\n');
    let inCodeBlock = false, codeLines = [], inList = false, listLines = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('```')) {
        if (inCodeBlock) { result += '<pre><code>' + codeLines.join('\n') + '</code></pre>\n'; codeLines = []; inCodeBlock = false; } else { inCodeBlock = true; }
        continue;
      }
      if (inCodeBlock) { codeLines.push(core.escapeHtml(line)); continue; }
      if (line.trim() === '') { if (inList) { result += '<ul>' + listLines.join('') + '</ul>\n'; listLines = []; inList = false; } result += '<br>\n'; continue; }
      const lm = line.match(/^[-*]\s+(.+)$/);
      if (lm) { if (!inList) { inList = true; listLines = []; } listLines.push('<li>' + _inlineMd(core.escapeHtml(lm[1])) + '</li>\n'); continue; }
      if (inList) { result += '<ul>' + listLines.join('') + '</ul>'; listLines = []; inList = false; }
      result += '<p>' + _inlineMd(core.escapeHtml(line)) + '</p>\n';
    }
    if (inCodeBlock) result += '<pre><code>' + codeLines.join('\n') + '</code></pre>\n';
    if (inList) result += '<ul>' + listLines.join('') + '</ul>\n';
    return result.trim();
  }
  function _inlineMd(s) { s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'); s = s.replace(/`([^`]+)`/g, '<code>$1</code>'); return s; }

  let scrollFollow = true;
  function _initScroll() {
    const c = document.getElementById('chatMessages');
    if (c) c.addEventListener('scroll', () => { const el = document.getElementById('chatMessages'); if (el) scrollFollow = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }, { passive: true });
  }
  function _scrollDown(force) {
    if (!force && !scrollFollow) return;
    requestAnimationFrame(() => { const el = document.getElementById('chatMessages'); if (el) { el.scrollTop = el.scrollHeight; scrollFollow = true; } });
  }

  let isStreaming = false;
  let chatAbortController = null;
  let chatAbortRequested = false;
  let streamingContent = '';
  let streamingReasoning = '';
  let streamingEl = null;
  let pendingQueue = [];
  let pendingReturnCallback = null;
  let lastActionResultsForUi = null;
  let taskBoardVisible = false;

  const OCIRC = '\u25cb', OCIRCLE = '\u25c9', CHECK = '\u2713', CROSS = '\u2715';

  function renderToolbarTasks() {
    const el = document.getElementById('chatToolbarTasks');
    if (!el) return;
    if (!window.AgentTasks) { el.innerHTML = ''; return; }
    const conv = core.getActiveConversation();
    var tasks = (conv && conv.tasks) ? JSON.parse(JSON.stringify(conv.tasks)) : [];
    const topTasks = tasks.filter(t => !t.parentId);
    if (!topTasks.length) { el.innerHTML = '<span class=\"toolbar-empty\">任务板为空</span>'; return; }
    const icon = { pending: OCIRC, in_progress: OCIRCLE, done: CHECK, cancelled: CROSS };
    el.innerHTML = topTasks.map(t => '<span class=\"toolbar-task-preview\"><span class=\"toolbar-task-icon\">' + (icon[t.status] || OCIRC) + '</span><span class=\"toolbar-task-text\">' + core.escapeHtml(t.title) + '</span></span>').join('');
  }

  function toggleTaskBoard() {
    const el = document.getElementById('taskBoardFloat');
    if (!el) return;
    taskBoardVisible = !taskBoardVisible;
    el.classList.toggle('hidden', !taskBoardVisible);
    if (taskBoardVisible) renderTaskBoardUI();
  }
  function closeTaskBoard() { taskBoardVisible = false; const el = document.getElementById('taskBoardFloat'); if (el) el.classList.add('hidden'); }

  function renderFileBlockHtml(fb) {
    if (!fb?.length) return '';
    return fb.map(f => '<div class=\"file-block\"><div class=\"file-block-header\">\ud83d\udcc4 ' + core.escapeHtml(f.path) + '</div><pre class=\"file-content-scroll\">' + core.escapeHtml(f.content) + '</pre></div>').join('');
  }

  function renderActionChips(results) {
    if (!results?.length) return '';
    return '<div class=\"message-actions\">' + results.map(r => {
      const cls = r.ok ? 'success' : 'error';
      const title = core.escapeHtml(r.error || JSON.stringify(r.result || ''));
      return '<span class=\"action-chip ' + cls + '\" title=\"' + title + '\">' + r.action.type + (r.ok ? ' ' + CHECK : ' ' + CROSS) + '</span>';
    }).join('') + '</div>';
  }

  function renderReasoningHtml(reasoning, streaming) {
    if (!core.getConfig().showReasoning || !reasoning?.trim()) return '';
    const openAttr = streaming ? ' open' : '';
    return '<details class=\"reasoning-block' + (streaming ? ' streaming' : '') + '\"' + openAttr + '><summary>' + (streaming ? '思考过程...' : '思考过程（点击展开/收起）') + '</summary><pre class=\"reasoning-content-scroll\">' + core.escapeHtml(reasoning) + '</pre></details>';
  }

  function appendMessage(role, content, actionResults, meta) {
    const container = document.getElementById('chatMessages');
    if (!container) return null;
    const el = document.createElement('div');
    el.className = 'message ' + role;
    const m = meta || {};
    const fb = m.fileBlocks || (actionResults ? actionResults.filter(r => r.ok && r.action.type === 'read_file').map(r => ({ path: r.action.path, content: r.result.content })) : null);
    const fbHtml = renderFileBlockHtml(fb);
    const actionsHtml = renderActionChips(actionResults);
    const roleLabel = role === 'user' ? '你' : role === 'assistant' ? '助手' : '系统';
    let bubbleContent;
    if (role === 'assistant') {
      const stripped = fmt.stripActionBlocks(content);
      bubbleContent = renderMarkdown(stripped || '(无文本内容)');
      bubbleContent = renderReasoningHtml(m.reasoning, false) + '<div class=\"message-bubble\">' + bubbleContent + '</div>' + (m.usage ? executor.renderUsageHtml(m.usage, m._showConvStats === true) : '');
    } else {
      const displayContent = content || '';
      bubbleContent = displayContent.startsWith('以下是动作执行结果')
        ? '<div class=\"message-bubble\">' + (fbHtml ? core.escapeHtml('（动作执行结果，见下方文件/详情）') : core.escapeHtml(displayContent)) + '</div>'
        : '<div class=\"message-bubble\">' + core.escapeHtml(displayContent || '(无文本内容)') + '</div>';
    }
    el.innerHTML = '<div class=\"message-role\">' + roleLabel + '</div>' + bubbleContent + fbHtml + actionsHtml;
    container.appendChild(el);
    _scrollDown();
    return el;
  }

  function renderChatMessages() {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    container.innerHTML = '';
    const msgs = core.getMessages();
    if (!msgs.length) {
      appendMessage('assistant', '欢迎使用 Action Agent Lite！\n\n**快速开始**\n1. 点击侧栏「⚙️ API 设置」，填写 API 地址、Key 和模型\n2. 点击「📁 工作区」配置工作目录\n3. 返回「💬 对话」，开始输入消息\n\n**核心功能**\n- **文件操作**：读写、编辑、删除、列出目录\n- **浏览器动作**：通知、剪贴板、打开链接、下载\n- **任务板**：AI 可自动分解复杂任务逐步执行\n\nAI 回复中若含 <action_fix>{JSON}</action_fix> 动作块会自动执行并回传结果。');
      return;
    }
    var lastAssistantIdx = -1;
    for (var i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant' && !msgs[i].hidden) { lastAssistantIdx = i; break; }
    }
    for (const m of msgs) {
      if (m.hidden) continue;
      let displayContent = m.content;
      if (m.role === 'user' && m.actionResults && m.actionResults.length) {
        const files = m.fileBlocks || [];
        var okCount = m.actionResults.filter(function(r) { return r.ok; }).length;
        displayContent = files.length ? '已执行动作，结果见下方文件块' : '已执行 ' + okCount + '/' + m.actionResults.length + ' 个动作';
      }
      var meta = { fileBlocks: m.fileBlocks, reasoning: m.reasoning, usage: m.usage };
      if (msgs.indexOf(m) === lastAssistantIdx) meta._showConvStats = true;
      appendMessage(m.role, displayContent, m.actionResults, meta);
    }
    _scrollDown(true);
  }

  function updateChatTitle() {
    const conv = core.getActiveConversation();
    const title = conv?.title || '对话';
    const el = document.getElementById('chatTitle');
    if (el) el.textContent = title;
    document.title = title + ' — Action Agent Lite';
  }

  function updateSendBtn() {
    const input = document.getElementById('chatInput');
    const btn = document.getElementById('sendBtn');
    if (!input || !btn) return;
    if (isStreaming) {
      btn.disabled = false; btn.classList.add('btn-stop');
      btn.innerHTML = '<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><rect x=\"6\" y=\"6\" width=\"12\" height=\"12\" rx=\"1\"/></svg>';
      btn.title = '中止生成'; return;
    }
    btn.classList.remove('btn-stop'); btn.title = '发送';
    btn.innerHTML = '<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z\"/></svg>';
    btn.disabled = !input.value.trim();
  }

  function endStreaming() { isStreaming = false; chatAbortRequested = false; chatAbortController = null; updateSendBtn(); }
  function abortChatGeneration() { chatAbortRequested = true; chatAbortController?.abort(); }

  function finishStreamAbort() {
    const text = streamingContent.trim();
    if (text) {
      const content = text + '\n\n（生成已中止）';
      const usage = executor.estimateUsageForReply(content, streamingReasoning);
      core.pushMessage({ role: 'assistant', content, reasoning: streamingReasoning || undefined, usage });
      finalizeStreamingBubble(content, [], streamingReasoning, usage);
    } else if (streamingEl) { streamingEl.remove(); streamingEl = null; }
    streamingContent = ''; streamingReasoning = '';
    appendMessage('system', '对话已中止');
    endStreaming();
  }

  function reportOutputTruncated(finishReason) {
    if (finishReason !== 'length') return;
    appendMessage('system', '回复因达到最大 Token 被 API 截断，请在 API 设置中提高该值。');
  }

  async function continueConversation() {
    isStreaming = true; updateSendBtn(); showTyping();
    streamingContent = ''; streamingReasoning = '';
    chatAbortRequested = false; chatAbortController = new AbortController();
    const { signal } = chatAbortController;
    let skipFinallyReset = false;
    try {
      const { content: reply, reasoning, finishReason, usage } = await llm.callLLMFromHistory({ signal });
      if (chatAbortRequested) { finishStreamAbort(); return; }
      core.pushMessage({ role: 'assistant', content: reply, reasoning: reasoning || undefined, usage });
      reportOutputTruncated(finishReason);
      const actions = fmt.parseActionsFromTexts(reply, reasoning);
      if (actions.length && core.getConfig().autoExecute) {
        const actionResults = await executor.runActions(actions);
        if (chatAbortRequested) { finalizeStreamingBubble(reply, actionResults, reasoning); appendMessage('system', '对话已中止'); endStreaming(); return; }
        if (!core.getConfig().confirmBeforeReturn) skipFinallyReset = true;
        await processAfterActions(reply, actionResults, reasoning);
        if (skipFinallyReset) return;
      } else if (actions.length) { finalizeStreamingBubble(reply, [], reasoning); showPendingActions(actions); }
      else { finalizeStreamingBubble(reply, [], reasoning); }
    } catch (err) {
      if (err?.name === 'AbortError') { finishStreamAbort(); return; }
      if (streamingEl) { streamingEl.remove(); streamingEl = null; }
      appendMessage('system', '回传错误: ' + err.message);
    } finally { if (!skipFinallyReset) endStreaming(); }
  }

  async function sendMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text || isStreaming) return;
    if (!core.getConfig().apiKey) { appendMessage('system', '请先在「API 设置」中配置 API Key'); switchPanel('settings'); return; }
    scrollFollow = true;
    input.value = ''; input.style.height = 'auto'; updateSendBtn();
    var _conv = core.getActiveConversation();
    if (_conv) { _conv.updatedAt = Date.now(); }
    core.saveConversationsStore();
    core.pushMessage({ role: 'user', content: text });
    appendMessage('user', text);
    isStreaming = true; updateSendBtn(); showTyping();
    streamingContent = ''; streamingReasoning = '';
    chatAbortRequested = false; chatAbortController = new AbortController();
    const { signal } = chatAbortController;
    let skipFinallyReset = false;
    try {
      const { content: reply, reasoning, finishReason, usage } = await llm.callLLM(text, { signal });
      if (chatAbortRequested) { finishStreamAbort(); return; }
      core.pushMessage({ role: 'assistant', content: reply, reasoning: reasoning || undefined, usage });
      reportOutputTruncated(finishReason);
      const actions = fmt.parseActionsFromTexts(reply, reasoning);
      let actionResults = [];
      if (actions.length && core.getConfig().autoExecute) {
        actionResults = await executor.runActions(actions);
        if (chatAbortRequested) { finalizeStreamingBubble(reply, actionResults, reasoning); appendMessage('system', '对话已中止'); endStreaming(); return; }
        if (!core.getConfig().confirmBeforeReturn) skipFinallyReset = true;
        await processAfterActions(reply, actionResults, reasoning);
        if (skipFinallyReset) return;
      } else if (actions.length) { finalizeStreamingBubble(reply, actionResults, reasoning); showPendingActions(actions); }
      else { /* no actions, show reply */ }
      finalizeStreamingBubble(reply, actionResults, reasoning);
    } catch (err) {
      if (err?.name === 'AbortError') { finishStreamAbort(); return; }
      if (streamingEl) { streamingEl.remove(); streamingEl = null; }
      appendMessage('system', '错误: ' + err.message);
    } finally { if (!skipFinallyReset) endStreaming(); }
  }

  function showTyping() {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    streamingEl = document.createElement('div');
    streamingEl.className = 'message assistant';
    streamingEl.innerHTML = '<div class=\"message-role\">助手</div><div class=\"message-bubble\"><div class=\"typing-indicator\"><span></span><span></span><span></span></div></div>';
    container.appendChild(streamingEl);
    _scrollDown();
  }

  function updateStreamingBubble(text, reasoning) {
    if (!streamingEl) return;
    streamingContent = text;
    streamingReasoning = reasoning || '';
    const stripped = fmt.stripActionBlocks(text);
    streamingEl.innerHTML = '<div class=\"message-role\">助手</div>' + renderReasoningHtml(reasoning, true) + '<div class=\"message-bubble\">' + renderMarkdown(stripped || '...') + '</div>';
    _scrollDown();
  }

  function finalizeStreamingBubble(text, actionResults, reasoning, usage) {
    if (!streamingEl) return;
    const usageData = usage || executor.getLastAssistantUsage();
    const stripped = fmt.stripActionBlocks(text);
    const inner = renderMarkdown(stripped || '(无文本内容)');
    const fb = actionResults ? actionResults.filter(r => r.ok && r.action.type === 'read_file').map(r => ({ path: r.action.path, content: r.result.content })) : null;
    streamingEl.innerHTML = '<div class=\"message-role\">助手</div>' + renderReasoningHtml(reasoning, false) + '<div class=\"message-bubble\">' + inner + '</div>' + renderFileBlockHtml(fb) + renderActionChips(actionResults) + (usageData ? executor.renderUsageHtml(usageData) : '');
    streamingEl = null;
    _scrollDown();
  }

  function showPendingActions(actions) {
    pendingQueue = actions;
    const el = document.getElementById('pendingActions');
    if (!el) return;
    el.classList.remove('hidden');
    el.innerHTML = '<h4>检测到 ' + actions.length + ' 个待执行动作（自动执行已关闭）</h4><pre class=\"code-preview\">' + core.escapeHtml(JSON.stringify(actions, null, 2)) + '</pre><button type=\"button\" class=\"btn-primary btn-sm\" id=\"executePending\">全部执行</button>';
    document.getElementById('executePending')?.addEventListener('click', async () => {
      const results = await executor.runActions(pendingQueue);
      el.classList.add('hidden'); pendingQueue = [];
      appendMessage('system', '已执行 ' + results.filter(r => r.ok).length + '/' + results.length + ' 个动作');
      reportActionFailures(results);
      await offerReturnToLLM(results);
    });
  }

  function reportActionFailures(results) { const failed = results.filter(r => !r.ok); if (failed.length) appendMessage('system', failed.map(r => r.action.type + ' 失败: ' + r.error).join('\n')); }

  function hideFeedbackPanel() { const el = document.getElementById('feedbackReturn'); if (el) el.classList.add('hidden'); pendingReturnCallback = null; }

  function showFeedbackPanel(feedbackText, onConfirm) {
    const el = document.getElementById('feedbackReturn');
    if (!el) return;
    document.getElementById('feedbackPreview').textContent = feedbackText;
    el.classList.remove('hidden');
    pendingReturnCallback = onConfirm;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function offerReturnToLLM(actionResults) {
    if (!actionResults.length) return;
    storeActionResults(actionResults);
    const fb = executor.buildFeedbackMessage(actionResults);
    const doReturn = async () => {
      hideFeedbackPanel();
      const files = (lastActionResultsForUi || []).filter(r => r.ok && r.action.type === 'read_file' && r.result?.content != null).map(r => ({ path: r.action.path, content: r.result.content }));
      const summaryText = files.length ? '已执行动作，结果见下方文件块' : '已执行 ' + actionResults.filter(r => r.ok).length + '/' + actionResults.length + ' 个动作';
      // 存储完整反馈给 LLM，UI 显示摘要
      core.pushMessage({ role: 'user', content: fb, actionResults, fileBlocks: files.length ? files : undefined });
      appendMessage('user', summaryText, actionResults, { fileBlocks: files.length ? files : undefined });
      appendMessage('system', '正在将执行结果回传给大模型...');
      await continueConversation();
    };
    if (core.getConfig().confirmBeforeReturn) window.__agentChatUI.showFeedbackPanel(fb, doReturn);
    else await doReturn();
  }

  function storeActionResults(actionResults) {
    // 将 actionResults 和 fileBlocks 持久化到最后一条 assistant 消息
    const msgs = core.getMessages();
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') {
        msgs[i].actionResults = actionResults;
        const files = (actionResults || []).filter(r => r.ok && r.action.type === 'read_file' && r.result?.content != null).map(r => ({ path: r.action.path, content: r.result.content }));
        msgs[i].fileBlocks = files.length ? files : undefined;
        break;
      }
    }
  }

  async function processAfterActions(reply, actionResults, reasoning) {
    storeActionResults(actionResults);
    lastActionResultsForUi = actionResults;
    finalizeStreamingBubble(reply, actionResults, reasoning, executor.getLastAssistantUsage());
    reportActionFailures(actionResults);
    await offerReturnToLLM(actionResults);
  }

  function clearContext() {
    if (!core.getMessages().length) { appendMessage('system', '当前没有可清空的上下文。'); return; }
    if (!confirm('确定清空上下文？当前对话的所有消息将被删除。')) return;
    core.setMessages([]); core.syncMessagesToActiveConversation();
    const conv = core.getActiveConversation();
    if (conv) { conv.messages = []; conv.updatedAt = Date.now(); }
    core.saveConversationsStore(); renderChatMessages();
    appendMessage('system', '已清空上下文。');
  }
  function clearChatMessages() {
    if (!confirm('确定删除当前对话的全部消息？')) return;
    core.setMessages([]); core.syncMessagesToActiveConversation(); core.saveConversationsStore(); renderChatMessages();
  }
  function startNewConversation() {
    // 重置对话级 Token 统计
    if (window.__agentLLM && typeof window.__agentLLM.resetConversationStats === 'function') {
      window.__agentLLM.resetConversationStats();
    }
    core.syncMessagesToActiveConversation();
    const conv = core.createConversation();
    const store = core.getConvStore();
    store.conversations.unshift(conv); store.activeId = conv.id;
    core.setConvStore(store); core.setMessages([]); core.saveConversationsStore();
    renderChatMessages(); updateChatTitle();
    if (window.__agentPanels?.renderConversationList) window.__agentPanels.renderConversationList();
    closeTaskBoard(); switchPanel('chat');
  }

  function renderTaskBoardUI() {
    if (!window.AgentTasks) return;
    const conv = core.getActiveConversation();
    const tasks = conv?.tasks || [];
    const board = document.getElementById('chatTaskBoard');
    if (!board) return;
    const topTasks = tasks.filter(t => !t.parentId);
    if (!topTasks.length) { board.innerHTML = '<p class=\"task-empty\">无任务</p>'; return; }
    const icon = { pending: OCIRC, in_progress: OCIRCLE, done: CHECK, cancelled: CROSS };
    let html = '<ul class=\"task-compact-list\">';
    for (const t of topTasks) {
      html += '<li class=\"task-compact-item status-' + t.status + '\"><span class=\"task-icon\">' + (icon[t.status] || OCIRC) + '</span><span class=\"task-text\">' + core.escapeHtml(t.title) + '</span></li>';
      for (const c of tasks.filter(x => x.parentId === t.id))
        html += '<li class=\"task-compact-item status-' + c.status + '\" style=\"margin-left:16px\"><span class=\"task-icon\">' + (icon[c.status] || OCIRC) + '</span><span class=\"task-text\">' + core.escapeHtml(c.title) + '</span></li>';
    }
    html += '</ul>';
    board.innerHTML = html;
    renderToolbarTasks();
  }

  function switchPanel(name) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.panel === name));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
    if (name === 'chat') {
      renderToolbarTasks();
    }
    const c = core.getConfig(); c.ui = c.ui || {}; c.ui.lastPanel = name; core.saveConfig();
  }

  function bindTaskBoardToggle() {
    document.getElementById('taskBoardToggleBtn')?.addEventListener('click', toggleTaskBoard);
    document.getElementById('taskBoardFloatClose')?.addEventListener('click', closeTaskBoard);
  }

  window.__agentChatUI = {
    appendMessage, renderChatMessages, updateChatTitle,
    showTyping, updateStreamingBubble, finalizeStreamingBubble,
    sendMessage, continueConversation, abortChatGeneration,
    isStreaming: () => isStreaming, endStreaming, updateSendBtn,
    renderTaskBoardUI, switchPanel,
    showPendingActions, showFeedbackPanel, hideFeedbackPanel,
    clearContext, clearChatMessages, startNewConversation,
    toggleTaskBoard, closeTaskBoard, bindTaskBoardToggle, renderToolbarTasks,
    _initScroll, confirmReturnToLLM: null,
  };
})();