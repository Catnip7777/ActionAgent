(() => {
  'use strict';

  const core = window.__agentCore;
  const fmt = window.__agentFormat;
  const executor = window.__agentExecutor;
  const llm = window.__agentLLM;
  if (!core || !fmt || !executor || !llm) throw new Error('app-chat-ui.js missing dependencies');

  const worker = window.__agentWorker;
  let workerIdCounter = 0;
  function getWorkerId() { return '_w' + (++workerIdCounter); }
  function callWorker(type, data) {
    return new Promise((resolve, reject) => {
      if (!worker) { reject(new Error('no worker')); return; }
      const id = getWorkerId();
      if (!window.__agentWorkerCallbacks) window.__agentWorkerCallbacks = {};
      window.__agentWorkerCallbacks[id] = (result) => resolve(result);
      worker.postMessage({ type, data, id });
      setTimeout(() => {
        if (window.__agentWorkerCallbacks?.[id]) {
          delete window.__agentWorkerCallbacks[id];
          reject(new Error('worker timeout'));
        }
      }, 5000);
    });
  }

  // ── 上下文文件池 UI ──
  // 这些函数在外部定义，不会被删除
  function renderContextPool() {
    var core = window.__agentCore;
    if (!core) return;
    var files = typeof core.getContextFiles === 'function' ? core.getContextFiles() : [];
    var body = document.getElementById('contextPoolBody');
    var countEl = document.getElementById('contextPoolCount');
    if (!body) return;
    if (countEl) countEl.textContent = files.length;
    if (!files.length) {
      body.innerHTML = '<p class="empty-hint">尚未添加任何文件到上下文池</p>';
      return;
    }
    var html = '';
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var sizeKB = (f.fullLength / 1024).toFixed(1);
      html += '<div class="ctx-file-item">';
      html += '<span class="ctx-file-name">' + core.escapeHtml(f.path) + '</span>';
      html += '<span class="ctx-file-meta">' + sizeKB + 'KB</span>';
      html += '</div>';
    }
    body.innerHTML = html;
  }

  function toggleContextPool() {
    var panel = document.getElementById('contextPoolFloat');
    if (!panel) return;
    var isHidden = panel.classList.contains('hidden');
    if (isHidden) {
      renderContextPool();
      panel.classList.remove('hidden');
    } else {
      panel.classList.add('hidden');
    }
  }

  // ── Markdown rendering ──
  function renderMarkdown(text) {
    if (!text) return '';
    if (typeof marked !== 'undefined') {
      try { return marked.parse(text, { breaks: true, gfm: true }); } catch (e) { console.warn('marked.parse failed, using fallback', e); }
    }
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

  function renderToolbarTasks() {
    const el = document.getElementById('chatToolbarTasks');
    if (!el) return;
    if (!window.AgentPluginsTasks) { el.innerHTML = ''; return; }
    const conv = core.getActiveConversation();
    const tasks = conv?.tasks || [];
    const topTasks = tasks.filter(t => !t.parentId);
    if (!topTasks.length) { el.innerHTML = '<span class="toolbar-empty">任务板为空</span>'; return; }
    const icon = { pending: '\u25cb', in_progress: '\u25c9', done: '\u2713', cancelled: '\u2715' };
    let html = '';
    for (const t of topTasks) {
      html += '<span class="toolbar-task-preview"><span class="toolbar-task-icon">' + (icon[t.status] || '\u25cb') + '</span><span class="toolbar-task-text">' + core.escapeHtml(t.title) + '</span></span>';
    }
    el.innerHTML = html;
  }

  function toggleTaskBoard() {
    const el = document.getElementById('taskBoardFloat');
    if (!el) return;
    taskBoardVisible = !taskBoardVisible;
    el.classList.toggle('hidden', !taskBoardVisible);
    if (taskBoardVisible) renderTaskBoardUI();
  }
  function closeTaskBoard() { taskBoardVisible = false; const el = document.getElementById('taskBoardFloat'); if (el) el.classList.add('hidden'); }

  function renderFileBlockHtml(fileBlocks) {
    if (!fileBlocks?.length) return '';
    return fileBlocks.map(f => '<div class="file-block"><div class="file-block-header">\ud83d\udcc4 ' + core.escapeHtml(f.path) + '</div><pre class="file-content-scroll">' + core.escapeHtml(f.content) + '</pre></div>').join('');
  }
  function renderActionChips(actionResults) {
    if (!actionResults?.length) return '';
    return '<div class="message-actions">' + actionResults.map(r => { const cls = r.ok ? 'success' : 'error'; const title = core.escapeHtml(r.error || JSON.stringify(r.result || '')); return '<span class="action-chip ' + cls + '" title="' + title + '">' + r.action.type + (r.ok ? ' \u2713' : ' \u2715') + '</span>'; }).join('') + '</div>';
  }
  function renderReasoningHtml(reasoning, streaming) {
    if (!core.getConfig().showReasoning || !reasoning?.trim()) return '';
    const openAttr = streaming ? ' open' : '';
    const summary = streaming ? '思考过程\u2026' : '思考过程（点击展开/收起）';
    return '<details class="reasoning-block' + (streaming ? ' streaming' : '') + '"' + openAttr + '><summary>' + summary + '</summary><pre class="reasoning-content-scroll">' + core.escapeHtml(reasoning) + '</pre></details>';
  }

  function appendMessage(role, content, actionResults, meta) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'message ' + role;
    const m = meta || {};
    const fb = m.fileBlocks || (actionResults ? actionResults.filter(r => r.ok && r.action.type === 'read_file').map(r => ({ path: r.action.path, content: r.result.content })) : null);
    const fbHtml = renderFileBlockHtml(fb);
    const actionsHtml = renderActionChips(actionResults);
    const roleLabel = role === 'user' ? '\u4f60' : role === 'assistant' ? '\u52a9\u624b' : '\u7cfb\u7edf';
    let bubbleContent;
    if (role === 'assistant') {
      const stripped = fmt.stripActionBlocks(content);
      bubbleContent = renderMarkdown(stripped || '(\u65e0\u6587\u672c\u5185\u5bb9)');
      bubbleContent = renderReasoningHtml(m.reasoning, false) + '<div class="message-bubble">' + bubbleContent + '</div>' + (m.usage ? executor.renderUsageHtml(m.usage, meta._showConvStats === true) : '');
    } else {
      const displayContent = content || '';
      if (displayContent.startsWith('\u4ee5\u4e0b\u662f\u52a8\u4f5c\u6267\u884c\u7ed3\u679c')) {
        bubbleContent = '<div class="message-bubble">' + (fbHtml ? core.escapeHtml('\uff08\u52a8\u4f5c\u6267\u884c\u7ed3\u679c\uff0c\u89c1\u4e0b\u65b9\u6587\u4ef6/\u8be6\u60c5\uff09') : core.escapeHtml(displayContent)) + '</div>';
      } else {
        bubbleContent = '<div class="message-bubble">' + core.escapeHtml(displayContent || '(\u65e0\u6587\u672c\u5185\u5bb9)') + '</div>';
      }
    }
    el.innerHTML = '<div class="message-role">' + roleLabel + '</div>' + bubbleContent + fbHtml + actionsHtml;
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
      appendMessage('assistant', '\u4f60\u597d\uff01\u6211\u662f Action Agent.\n\n\u914d\u7f6e API \u4e0e\u5de5\u4f5c\u533a\u540e\u5373\u53ef\u5f00\u59cb\u3002\u4fa7\u680f\u53ef\u5207\u6362\u5386\u53f2\u5bf9\u8bdd\u3002');
      return;
    }
    var lastAssistantIdx = -1;
    for (var idx = msgs.length - 1; idx >= 0; idx--) {
      if (msgs[idx].role === 'assistant' && !msgs[idx].hidden) { lastAssistantIdx = idx; break; }
    }
    for (const m of msgs) {
      if (m.hidden) continue;
      let displayContent = m.content;
      if (m.role === 'user' && m.actionResults && m.actionResults.length) {
        const files = m.fileBlocks || [];
        const okCount = m.actionResults.filter(r => r.ok).length;
        displayContent = files.length ? '\u5df2\u6267\u884c\u52a8\u4f5c\uff0c\u7ed3\u679c\u89c1\u4e0b\u65b9\u6587\u4ef6\u5757' : '\u5df2\u6267\u884c ' + okCount + '/' + m.actionResults.length + ' \u4e2a\u52a8\u4f5c';
      }
      let meta = { fileBlocks: m.fileBlocks, reasoning: m.reasoning, usage: m.usage };
      // 只对最后一条 assistant 消息显示对话总计
      if (msgs.indexOf(m) === lastAssistantIdx) meta._showConvStats = true;
      appendMessage(m.role, displayContent, m.actionResults, meta);
    }
    _scrollDown(true);
  }

  function updateChatTitle() {
    const conv = core.getActiveConversation();
    const title = conv?.title || '\u5bf9\u8bdd';
    const el = document.getElementById('chatTitle');
    if (el) el.textContent = title;
    document.title = title + ' \u2014 Action Agent';
  }

  function showTyping() {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    streamingEl = document.createElement('div');
    streamingEl.className = 'message assistant';
    streamingEl.innerHTML = '<div class="message-role">\u52a9\u624b</div><div class="message-bubble"><div class="typing-indicator"><span></span><span></span><span></span></div></div>';
    container.appendChild(streamingEl);
    _scrollDown();
  }
  function updateStreamingBubble(text, reasoning) {
    if (!streamingEl) return;
    streamingContent = text;
    streamingReasoning = reasoning || '';
    const stripped = fmt.stripActionBlocks(text);
    const inner = renderMarkdown(stripped || '\u2026');
    streamingEl.innerHTML = '<div class="message-role">\u52a9\u624b</div>' + renderReasoningHtml(reasoning, true) + '<div class="message-bubble">' + inner + '</div>';
    _scrollDown();
  }
  function finalizeStreamingBubble(text, actionResults, reasoning, usage) {
    if (!streamingEl) return;
    const usageData = usage || executor.getLastAssistantUsage();
    const stripped = fmt.stripActionBlocks(text);
    const inner = renderMarkdown(stripped || '(\u65e0\u6587\u672c\u5185\u5bb9)');
    const fb = actionResults ? actionResults.filter(r => r.ok && r.action.type === 'read_file').map(r => ({ path: r.action.path, content: r.result.content })) : null;
    streamingEl.innerHTML = '<div class="message-role">\u52a9\u624b</div>' + renderReasoningHtml(reasoning, false) + '<div class="message-bubble">' + inner + '</div>' + renderFileBlockHtml(fb) + renderActionChips(actionResults) + (usageData ? executor.renderUsageHtml(usageData) : '');
    streamingEl = null;
    _scrollDown();
  }

  function updateSendBtn() {
    const input = document.getElementById('chatInput');
    const btn = document.getElementById('sendBtn');
    if (!input || !btn) return;
    if (isStreaming) {
      btn.disabled = false; btn.classList.add('btn-stop'); btn.title = '\u4e2d\u6b62\u751f\u6210';
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>'; return;
    }
    btn.classList.remove('btn-stop'); btn.title = '\u53d1\u9001';
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>';
    btn.disabled = !input.value.trim();
  }

  function endStreaming() { isStreaming = false; chatAbortRequested = false; chatAbortController = null; updateSendBtn(); refreshConversationList(); }

  async function maybeAutoNameConversation() {
    const conv = core.getActiveConversation();
    if (!conv || conv.titleAuto) return;
    if (conv.title && conv.title !== '\u65b0\u5bf9\u8bdd') return;
    const msgs = core.getMessages();
    const hasUser = msgs.some(m => m.role === 'user' && !(m.content || '').startsWith('\u4ee5\u4e0b\u662f'));
    const hasAssistant = msgs.some(m => m.role === 'assistant');
    if (!hasUser || !hasAssistant) return;
    try {
      const snippet = msgs.filter(m => m.role === 'user' || m.role === 'assistant').slice(0, 8).map(m => m.role + ': ' + (m.content || '').slice(0, 300)).join('\n');
      if (!snippet.trim()) return;
      const title = await llm.callLLMForTitle(snippet);
      if (title) { conv.title = title.slice(0, 40); conv.titleAuto = true; core.saveConversationsStore(); if (window.__agentChatUI?.updateChatTitle) window.__agentChatUI.updateChatTitle(); if (window.__agentPanelsConv?.renderConversationList) window.__agentPanelsConv.renderConversationList(); }
    } catch (err) { console.warn('auto naming failed', err); }
  }

  function refreshConversationList() {
    if (window.__agentPanelsConv && typeof window.__agentPanelsConv.renderConversationList === 'function') { window.__agentPanelsConv.renderConversationList(); }
  }
  function abortChatGeneration() { chatAbortRequested = true; chatAbortController?.abort(); }
  function isAbortError(err) { return err?.name === 'AbortError'; }

  function finishStreamAbort() {
    const text = streamingContent.trim();
    if (text) {
      const content = text + '\n\n\uff08\u751f\u6210\u5df2\u4e2d\u6b62\uff09';
      const usage = executor.estimateUsageForReply(content, streamingReasoning);
      core.pushMessage({ role: 'assistant', content, reasoning: streamingReasoning || undefined, usage });
      finalizeStreamingBubble(content, [], streamingReasoning, usage);
    } else if (streamingEl) { streamingEl.remove(); streamingEl = null; }
    streamingContent = ''; streamingReasoning = '';
    appendMessage('system', '\u5bf9\u8bdd\u5df2\u4e2d\u6b62');
    endStreaming();
  }

  function reportOutputTruncated(finishReason) {
    if (finishReason !== 'length') return;
    appendMessage('system', '\u56de\u590d\u56e0\u8fbe\u5230\u300c\u6700\u5927 Token\u300d' + core.getConfig().maxTokens + ' \u88ab API \u622a\u65ad\u3002\u8f93\u51fa\u5927\u6bb5\u4ee3\u7801\u65f6\u8bf7\u5728 API \u8bbe\u7f6e\u4e2d\u63d0\u9ad8\u8be5\u503c\uff08\u5982 8192\uff5e32768\uff09\uff0c\u6216\u8ba9\u6a21\u578b\u5206\u5757 write_file / \u591a\u6b21\u8f93\u51fa\u3002');
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
        if (chatAbortRequested) { finalizeStreamingBubble(reply, actionResults, reasoning); appendMessage('system', '\u5bf9\u8bdd\u5df2\u4e2d\u6b62'); endStreaming(); return; }
        if (!core.getConfig().confirmBeforeReturn) skipFinallyReset = true;
        await processAfterActions(reply, actionResults, reasoning);
        if (skipFinallyReset) return;
      } else if (actions.length) { finalizeStreamingBubble(reply, [], reasoning); showPendingActions(actions); }
      else { finalizeStreamingBubble(reply, [], reasoning); reportActionParseWarnings(reply); }
    } catch (err) {
      if (isAbortError(err)) { finishStreamAbort(); return; }
      if (streamingEl) { streamingEl.remove(); streamingEl = null; }
      appendMessage('system', '\u56de\u4f20\u9519\u8bef: ' + err.message);
    } finally { if (!skipFinallyReset) endStreaming(); }
  }

  async function sendMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text || isStreaming) return;
    if (!core.getConfig().apiKey) { appendMessage('system', '\u8bf7\u5148\u5728\u300cAPI \u8bbe\u7f6e\u300d\u4e2d\u914d\u7f6e API Key'); switchPanel('settings'); return; }
    scrollFollow = true;
    input.value = ''; input.style.height = 'auto'; updateSendBtn();
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
        if (chatAbortRequested) { finalizeStreamingBubble(reply, actionResults, reasoning); appendMessage('system', '\u5bf9\u8bdd\u5df2\u4e2d\u6b62'); endStreaming(); return; }
        if (!core.getConfig().confirmBeforeReturn) skipFinallyReset = true;
        await processAfterActions(reply, actionResults, reasoning);
        if (skipFinallyReset) return;
      } else if (actions.length) { finalizeStreamingBubble(reply, actionResults, reasoning); showPendingActions(actions); }
      else { reportActionParseWarnings(reply); }
      finalizeStreamingBubble(reply, actionResults, reasoning);
      await maybeAutoNameConversation();
    } catch (err) {
      if (isAbortError(err)) { finishStreamAbort(); return; }
      if (streamingEl) { streamingEl.remove(); streamingEl = null; }
      appendMessage('system', '\u9519\u8bef: ' + err.message);
    } finally { if (!skipFinallyReset) endStreaming(); }
  }

  function showPendingActions(actions) {
    pendingQueue = actions;
    const el = document.getElementById('pendingActions');
    if (!el) return;
    el.classList.remove('hidden');
    el.innerHTML = '<h4>\u68c0\u6d4b\u5230 ' + actions.length + ' \u4e2a\u5f85\u6267\u884c\u52a8\u4f5c\uff08\u81ea\u52a8\u6267\u884c\u5df2\u5173\u95ed\uff09</h4><pre class="code-preview">' + core.escapeHtml(JSON.stringify(actions, null, 2)) + '</pre><button type="button" class="btn-primary btn-sm" id="executePending">\u5168\u90e8\u6267\u884c</button>';
    document.getElementById('executePending')?.addEventListener('click', async () => {
      const results = await executor.runActions(pendingQueue);
      el.classList.add('hidden'); pendingQueue = [];
      appendMessage('system', '\u5df2\u6267\u884c ' + results.filter(r => r.ok).length + '/' + results.length + ' \u4e2a\u52a8\u4f5c');
      reportActionFailures(results);
      await offerReturnToLLM(results);
    });
  }

  function reportActionFailures(actionResults) { const failed = actionResults.filter(r => !r.ok); if (failed.length) appendMessage('system', failed.map(r => r.action.type + ' \u5931\u8d25: ' + r.error).join('\n')); }

  function reportActionParseWarnings(reply) {
    const bad = fmt.findUnparsedActionBlocks(reply);
    if (!bad.length) return;
    const et = core.getConfig().format.endTag || '';
    appendMessage('system', '\u68c0\u6d4b\u5230 ' + bad.length + ' \u5904\u7591\u4f3c\u52a8\u4f5c\u5757\u4f46 JSON \u65e0\u6548\uff0c\u5df2\u8df3\u8fc7\u6267\u884c\u3002\u8bf7\u68c0\u67e5 JSON \u8bed\u6cd5\uff1b\u82e5\u5b57\u6bb5\u503c\u5185\u542b\u7ed3\u675f\u6807\u7b7e ' + et + '\uff0c\u8bf7\u5237\u65b0\u9875\u9762\u4ee5\u4f7f\u7528\u6539\u8fdb\u540e\u7684\u89e3\u6790\u5668\u3002');
  }

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
    const fb = executor.buildFeedbackMessage(actionResults);
    const doReturn = async () => {
      hideFeedbackPanel();
      const files = (lastActionResultsForUi || []).filter(r => r.ok && r.action.type === 'read_file' && r.result?.content != null).map(r => ({ path: r.action.path, content: r.result.content }));
      core.pushMessage({ role: 'user', content: fb, fileBlocks: files.length ? files : undefined });
      const summaryText = files.length ? '\u5df2\u6267\u884c\u52a8\u4f5c\uff0c\u7ed3\u679c\u89c1\u4e0b\u65b9\u6587\u4ef6\u5757' : '\u5df2\u6267\u884c ' + actionResults.filter(r => r.ok).length + '/' + actionResults.length + ' \u4e2a\u52a8\u4f5c';
      appendMessage('user', summaryText, actionResults, { fileBlocks: files.length ? files : undefined });
      appendMessage('system', '\u6b63\u5728\u5c06\u6267\u884c\u7ed3\u679c\u56de\u4f20\u7ed9\u5927\u6a21\u578b\u2026');
      await continueConversation();
    };
    if (core.getConfig().confirmBeforeReturn) window.__agentChatUI.showFeedbackPanel(fb, doReturn);
    else await doReturn();
  }

  async function processAfterActions(reply, actionResults, reasoning) {
    lastActionResultsForUi = actionResults;
    finalizeStreamingBubble(reply, actionResults, reasoning, executor.getLastAssistantUsage());
    reportActionFailures(actionResults);
    await offerReturnToLLM(actionResults);
    await maybeAutoNameConversation();
  }

  function clearContext() {
    if (!core.getMessages().length) { appendMessage('system', '\u5f53\u524d\u6ca1\u6709\u53ef\u6e05\u7a7a\u7684\u4e0a\u4e0b\u6587\u3002'); return; }
    if (!confirm('\u786e\u5b9a\u6e05\u7a7a\u4e0a\u4e0b\u6587\uff1f\u5f53\u524d\u5bf9\u8bdd\u7684\u6240\u6709\u6d88\u606f\u5c06\u88ab\u5220\u9664\u3002')) return;
    core.setMessages([]); core.syncMessagesToActiveConversation();
    const conv = core.getActiveConversation();
    if (conv) { conv.messages = []; conv.updatedAt = Date.now(); }
    core.saveConversationsStore(); renderChatMessages();
    appendMessage('system', '\u5df2\u6e05\u7a7a\u4e0a\u4e0b\u6587\u3002');
  }
  function clearChatMessages() {
    if (!confirm('\u786e\u5b9a\u5220\u9664\u5f53\u524d\u5bf9\u8bdd\u7684\u5168\u90e8\u6d88\u606f\uff1f')) return;
    core.setMessages([]); core.syncMessagesToActiveConversation(); core.saveConversationsStore(); renderChatMessages();
  }
  function startNewConversation() {
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
    if (!window.AgentPluginsTasks) return;
    const conv = core.getActiveConversation();
    const tasks = conv?.tasks || [];
    const board = document.getElementById('chatTaskBoard');
    if (!board) return;
    const topTasks = tasks.filter(t => !t.parentId);
    if (!topTasks.length) { board.innerHTML = '<p class="task-empty">\u65e0\u4efb\u52a1</p>'; }
    else {
      const icon = { pending: '\u25cb', in_progress: '\u25c9', done: '\u2713', cancelled: '\u2715' };
      let html = '<ul class="task-compact-list">';
      for (const t of topTasks) {
        html += '<li class="task-compact-item status-' + t.status + '"><span class="task-icon">' + (icon[t.status] || '\u25cb') + '</span><span class="task-text">' + core.escapeHtml(t.title) + '</span></li>';
        for (const c of tasks.filter(x => x.parentId === t.id))
          html += '<li class="task-compact-item status-' + c.status + '" style="margin-left:16px"><span class="task-icon">' + (icon[c.status] || '\u25cb') + '</span><span class="task-text">' + core.escapeHtml(c.title) + '</span></li>';
      }
      html += '</ul>';
      board.innerHTML = html;
    }
    renderToolbarTasks();
  }

  function switchPanel(name) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.panel === name));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
    if (name === 'prompts' && window.__agentPanels?.renderPromptPanelUI) window.__agentPanels.renderPromptPanelUI();
    if (name === 'stats' && window.AgentStats) window.AgentStats.renderPanel({ escapeHtml: core.escapeHtml, getConversations: () => core.getConvStore().conversations });
    const c = core.getConfig(); c.ui = c.ui || {}; c.ui.lastPanel = name; core.saveConfig();
  }

  function bindTaskBoardToggle() {
    document.getElementById('taskBoardToggleBtn')?.addEventListener('click', toggleTaskBoard);
    document.getElementById('taskBoardFloatClose')?.addEventListener('click', closeTaskBoard);
  }

  window.__agentChatUI = {
    renderContextPool,
    toggleContextPool,
    appendMessage, renderChatMessages, updateChatTitle,
    showTyping, updateStreamingBubble, finalizeStreamingBubble,
    sendMessage, continueConversation, abortChatGeneration,
    isStreaming: () => isStreaming, endStreaming, updateSendBtn,
    renderTaskBoardUI, switchPanel,
    showPendingActions, showFeedbackPanel, hideFeedbackPanel,
    clearContext, clearChatMessages, startNewConversation,
    toggleTaskBoard, closeTaskBoard, bindTaskBoardToggle, renderToolbarTasks,
    _initScroll,
  };
})();