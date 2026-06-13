(() => {
  'use strict';

  const core = window.__agentCore;
  if (!core) throw new Error('app-executor.js requires app-core.js');

  function normalizeUsage(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const reasoning = raw.completion_tokens_details?.reasoning_tokens ?? raw.prompt_tokens_details?.reasoning_tokens ?? raw.reasoning_tokens ?? 0;
    const promptTokens = raw.prompt_tokens ?? 0;
    const completionTokens = raw.completion_tokens ?? 0;
    const totalTokens = raw.total_tokens ?? (promptTokens + completionTokens);
    if (!promptTokens && !completionTokens && !totalTokens) return null;
    return {
      promptTokens, completionTokens, reasoningTokens: reasoning, totalTokens, estimated: false,
      cacheHit: raw._cacheHit === true,
      cacheMiss: raw._cacheMiss === true,
      _cacheHitTokens: raw._cacheHitTokens || 0,
      _cacheMissTokens: raw._cacheMissTokens || 0
    };
  }

  function estimateUsageForReply(reply, reasoning) {
    const sys = core.getSystemPromptContent();
    const messages = core.getMessages();
    const visible = messages.filter((m) => !m.hidden && m.role !== 'system');
    const histChars = visible.reduce((s, m) => s + (m.content || '').length, 0);
    const promptTokens = Math.ceil((sys.length + histChars) / 3);
    const reasoningText = reasoning || '';
    const completionTokens = Math.ceil(((reply || '').length + reasoningText.length) / 3);
    return { promptTokens, completionTokens, reasoningTokens: Math.ceil(reasoningText.length / 3), totalTokens: promptTokens + completionTokens, estimated: true };
  }

  function resolveUsage(apiUsage, reply, reasoning) { return normalizeUsage(apiUsage) || estimateUsageForReply(reply, reasoning); }
  function formatTokenNum(n) { const v = Number(n) || 0; return v >= 10000 ? (v / 1000).toFixed(1) + 'k' : String(v); }

  function formatUsageLabel(usage) {
    if (!usage) return '';
    const parts = ['输入 ' + formatTokenNum(usage.promptTokens), '输出 ' + formatTokenNum(usage.completionTokens)];
    if (usage.reasoningTokens > 0) parts.push('思考 ' + formatTokenNum(usage.reasoningTokens));
    parts.push('共 ' + formatTokenNum(usage.totalTokens));
    if (usage.estimated) parts.push('估算');
    return parts.join(' · ');
  }

  function renderUsageHtml(usage, showConvStats) {
    if (!usage) return '';
    var html = '<div class="' + (usage.estimated ? 'message-usage estimated' : 'message-usage') + '">' + core.escapeHtml(formatUsageLabel(usage)) + '</div>';
    if (showConvStats !== false) {
      try {
        var llm = window.__agentLLM;
        if (llm && typeof llm.getConversationStats === 'function') {
          var stats = llm.getConversationStats();
          if (stats && stats.requestCount > 0) {
            var label = '对话总计：输入 ' + formatTokenNum(stats.totalInput) + ' · 输出 ' + formatTokenNum(stats.totalOutput) + ' · 共 ' + formatTokenNum(stats.totalTokens) + ' · 请求 ' + stats.requestCount + '次';
            if (stats.totalCachedInput > 0 || stats.totalNonCachedInput > 0) {
              label += ' · 缓存 Token：' + formatTokenNum(stats.totalCachedInput) + '/' + formatTokenNum(stats.totalCachedInput + stats.totalNonCachedInput) + ' (' + stats.tokenHitRate + '%)';
            }
            html += '<div class="message-usage conversation-stats">' + core.escapeHtml(label) + '</div>';
          }
        }
      } catch(e) {}
    }
    return html;
  }

  function getLastAssistantUsage() {
    var messages = core.getMessages();
    for (var i = messages.length - 1; i >= 0; i--) { if (messages[i].role === 'assistant' && messages[i].usage) return messages[i].usage; }
    return null;
  }

  function buildActionContext() {
    return {
      config: core.getConfig(),
      workspaceHandle: null,
      getDefaultWorkspace: core.getDefaultWorkspace,
      resolveWorkspaceFromAction: core.resolveWorkspaceFromAction,
      assertWorkspaceFilePermission: core.assertWorkspaceFilePermission,
      getBrowserHandleForWorkspace: function(ws) { return window.__agentPanels?.getBrowserHandleForWorkspace ? window.__agentPanels.getBrowserHandleForWorkspace(ws) : null; },
    };
  }

  function refreshTaskDisplay() {
    if (window.__agentChatUI) {
      window.__agentChatUI.renderTaskBoardUI();
      window.__agentChatUI.renderToolbarTasks();
    }
  }

  async function executeAction(action) {
    if (window.AgentTasks && window.AgentTasks.TASK_ACTIONS.indexOf(action.type) >= 0) {
      return window.AgentTasks.executeAction(action, getTaskDeps());
    }
    var ctx = buildActionContext();
    return window.AgentActions.execute(action, ctx);
  }

  function getTaskDeps() {
    return {
      config: core.getConfig(),
      getActiveConversation: core.getActiveConversation,
      onTasksChanged: function() {
        refreshTaskDisplay();
        core.saveConversationsStore();
        core.debouncedSaveConfig();
      }
    };
  }

  async function runActions(actions, autoConfirm) {
    var results = [];
    for (var i = 0; i < actions.length; i++) {
      var action = actions[i];
      var needsConfirm = core.DANGEROUS_ACTIONS.indexOf(action.type) >= 0 && !autoConfirm;
      if (needsConfirm) {
        var ok = await showConfirm(action);
        if (!ok) { results.push({ action: action, ok: false, error: '用户取消' }); addLog(action, false, '用户取消'); continue; }
      }
      try {
        var result = await executeAction(action);
        results.push({ action: action, ok: true, result: result });
        addLog(action, true, result);
        if (action.type === 'task_list' || action.type === 'task_add' || action.type === 'task_update' ||
            action.type === 'task_delete' || action.type === 'task_decompose' || action.type === 'task_check') {
          refreshTaskDisplay();
        }
      } catch (err) {
        results.push({ action: action, ok: false, error: err.message });
        addLog(action, false, err.message);
      }
    }
    return results;
  }

  function showConfirm(action) {
    return new Promise(function(resolve) {
      var modal = document.getElementById('confirmModal');
      if (!modal) { resolve(false); return; }
      var preview = document.getElementById('confirmActionPreview');
      var okBtn = document.getElementById('confirmOk');
      var cancelBtn = document.getElementById('confirmCancel');
      if (!preview || !okBtn || !cancelBtn) { resolve(false); return; }
      preview.textContent = JSON.stringify(action, null, 2);
      var cleanup = function() { modal.close(); okBtn.removeEventListener('click', onOk); cancelBtn.removeEventListener('click', onCancel); modal.removeEventListener('close', onClose); };
      var onOk = function() { cleanup(); resolve(true); };
      var onCancel = function() { cleanup(); resolve(false); };
      var onClose = function() { cleanup(); resolve(false); };
      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      modal.addEventListener('close', onClose);
      modal.showModal();
    });
  }

  function addLog(action, ok, result) {
    core.addLogEntry({ time: new Date(), action: action, ok: ok, result: result });
  }

  function buildFeedbackMessage(actionResults) {
    var parts = actionResults.map(function(r) {
      var status = r.ok ? '成功' : '失败';
      if (!r.ok) return '[' + r.action.type + '] ' + status + '\n请求: ' + JSON.stringify(r.action) + '\n错误: ' + r.error;
      var resultStr;
      if (r.action.type === 'add_file_to_context' && r.ok) {
        resultStr = '已将 ' + r.result.path + ' 加入上下文池（大小 ' + r.result.length + ' 字符）';
      } else if (r.action.type === 'remove_file_from_context' && r.ok) {
        resultStr = '已将 ' + r.result.path + ' 从上下文池移除';
      } else {
        resultStr = JSON.stringify(r.result, null, 2);
      }
      return '[' + r.action.type + '] ' + status + '\n请求: ' + JSON.stringify(r.action) + '\n结果:\n' + resultStr;
    });
    return '以下是动作执行结果，请根据结果继续处理用户的请求：\n\n' + parts.join('\n\n---\n\n');
  }

  window.__agentExecutor = {
    normalizeUsage: normalizeUsage,
    estimateUsageForReply: estimateUsageForReply,
    resolveUsage: resolveUsage,
    formatUsageLabel: formatUsageLabel,
    renderUsageHtml: renderUsageHtml,
    getLastAssistantUsage: getLastAssistantUsage,
    executeAction: executeAction,
    runActions: runActions,
    showConfirm: showConfirm,
    addLog: addLog,
    buildFeedbackMessage: buildFeedbackMessage
  };
})();
