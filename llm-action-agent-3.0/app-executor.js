(() => {
  'use strict';

  // ============================================================
  // Action Executor Module
  // Executes actions, manages Token usage, logs
  // Depends on: window.__agentCore
  // ============================================================

  const core = window.__agentCore;
  if (!core) throw new Error('app-executor.js requires app-core.js');

  // ── Token usage ──

  function normalizeUsage(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const reasoning = raw.completion_tokens_details?.reasoning_tokens
      ?? raw.prompt_tokens_details?.reasoning_tokens
      ?? raw.reasoning_tokens
      ?? 0;
    const promptTokens = raw.prompt_tokens ?? 0;
    const completionTokens = raw.completion_tokens ?? 0;
    const totalTokens = raw.total_tokens ?? (promptTokens + completionTokens);
    if (!promptTokens && !completionTokens && !totalTokens) return null;
    return {
      promptTokens,
      completionTokens,
      reasoningTokens: reasoning,
      totalTokens,
      estimated: false,
      cacheHit: raw._cacheHit === true,
      cacheMiss: raw._cacheMiss === true,
      _cacheHitTokens: raw._cacheHitTokens || 0,
      _cacheMissTokens: raw._cacheMissTokens || 0,
    };
  }

  function estimateUsageForReply(reply, reasoning) {
    const core = window.__agentCore;
    const sys = core.getSystemPromptContent();
    const messages = core.getMessages();
    const visible = messages.filter((m) => !m.hidden && m.role !== 'system');
    const histChars = visible.reduce((s, m) => s + (m.content || '').length, 0);
    const promptTokens = Math.ceil((sys.length + histChars) / 3);
    const reasoningText = reasoning || '';
    const completionTokens = Math.ceil(((reply || '').length + reasoningText.length) / 3);
    const reasoningTokens = Math.ceil(reasoningText.length / 3);
    return {
      promptTokens,
      completionTokens,
      reasoningTokens,
      totalTokens: promptTokens + completionTokens,
      estimated: true,
    };
  }

  function resolveUsage(apiUsage, reply, reasoning) {
    return normalizeUsage(apiUsage) || estimateUsageForReply(reply, reasoning);
  }

  function formatTokenNum(n) {
    const v = Number(n) || 0;
    if (v >= 10000) return (v / 1000).toFixed(1) + 'k';
    return String(v);
  }

  function formatUsageLabel(usage) {
    if (!usage) return '';
    const parts = [
      `输入 ${formatTokenNum(usage.promptTokens)}`,
      `输出 ${formatTokenNum(usage.completionTokens)}`,
    ];
    if (usage.reasoningTokens > 0) {
      parts.push(`思考 ${formatTokenNum(usage.reasoningTokens)}`);
    }
    parts.push(`共 ${formatTokenNum(usage.totalTokens)}`);
    if (usage.estimated) parts.push('估算');
    return parts.join(' · ');
  }

  function renderUsageHtml(usage, showConvStats) {
    if (!usage) return '';
    const cls = usage.estimated ? 'message-usage estimated' : 'message-usage';
    var html = '<div class="' + cls + '">' + core.escapeHtml(formatUsageLabel(usage)) + '</div>';
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
    const messages = core.getMessages();
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'assistant' && m.usage) return m.usage;
    }
    return null;
  }

  function recordAssistantStats(msg) {
    if (!window.AgentStats || msg.role !== 'assistant' || !msg.usage) return;
    const conv = core.getActiveConversation();
    window.AgentStats.recordToken({
      convId: conv?.id,
      convTitle: conv?.title,
      usage: msg.usage,
      ts: msg.ts || Date.now(),
    });
  }

  // ── Action Execution ──

  function buildActionContext() {
    return {
      config: core.getConfig(),
      workspaceHandle: (typeof core.getWorkspaceHandle === 'function')
        ? core.getWorkspaceHandle(core.getActiveWorkspace()?.id) : null,
      isBackendOnline: () => window.__agentLLM?.isBackendOnline() || Promise.resolve(false),
      getDefaultWorkspace: core.getDefaultWorkspace,
      resolveWorkspaceFromAction: core.resolveWorkspaceFromAction,
      assertWorkspaceFilePermission: core.assertWorkspaceFilePermission,
      getBrowserHandleForWorkspace: window.__agentWorkspace?.getBrowserHandleForWorkspace || null,
      getWorkspaceHandle: (typeof core.getWorkspaceHandle === 'function')
        ? core.getWorkspaceHandle : undefined,
      canUseBackendForFiles: core.canUseBackendForFiles,
      appendMessage: (role, content, results, meta) => window.__agentChatUI?.appendMessage(role, content, results, meta),
    };
  }

  async function returnCallbackForExecutor(ctx) {
    ctx.executeViaBackend = (action, ws) =>
      window.AgentActionSystem.executeViaBackend(action, ctx, ws);
    return ctx;
  }

  async function executeAction(action) {
    if (action.type === 'write_memory') {
      action = { ...action, type: 'save_memory', name: action.name || 'general' };
    }

    const defs = core.getActionDefs();
    const def = defs.find((a) => a.type === action.type);
    if (!def) throw new Error('未知动作类型: ' + action.type);
    if (!core.getConfig().enabledActions.includes(action.type)) {
      throw new Error('动作已禁用: ' + action.type);
    }

    if (window.AgentMemories?.MEMORY_ACTIONS.includes(action.type)) {
      return AgentMemories.executeAction(action, getMemoryDeps());
    }

    if (window.AgentPluginsTasks?.PLUGIN_TASK_ACTIONS.includes(action.type)) {
      return AgentPluginsTasks.executeAction(action, getPluginTaskDeps());
    }

    const ctx = buildActionContext();
    await returnCallbackForExecutor(ctx);
    return window.AgentActions.execute(action, ctx);
  }

  function getMemoryDeps() {
    return {
      config: core.getConfig(),
      isBackendOnline: () => window.__agentLLM?.isBackendOnline() || Promise.resolve(false),
      onMemoriesChanged: () => {
        try {
          window.__agentCore.setCachedMemorySummaries([]);
        } catch (e) {
          console.warn('记忆缓存刷新失败', e);
        }
      },
    };
  }

  function getPluginTaskDeps() {
    return {
      config: core.getConfig(),
      isBackendOnline: () => window.__agentLLM?.isBackendOnline() || Promise.resolve(false),
      getActiveConversation: core.getActiveConversation,
      onTasksChanged: () => {
        if (window.__agentChatUI?.renderTaskBoardUI) window.__agentChatUI.renderTaskBoardUI();
        core.debouncedSaveConfig();
      },
      onPluginsChanged: () => {
        try {
          if (window.__agentCore?.setCachedPluginSummaries) {
            window.__agentCore.setCachedPluginSummaries([]);
          }
        } catch (e) {
          console.warn('插件缓存刷新失败', e);
        }
      },
    };
  }

  async function runActions(actions, autoConfirm) {
    const results = [];
    for (const action of actions) {
      const needsConfirm = core.DANGEROUS_ACTIONS.includes(action.type) && !autoConfirm;
      if (needsConfirm) {
        const ok = await showConfirm(action);
        if (!ok) {
          results.push({ action, ok: false, error: '用户取消' });
          addLog(action, false, '用户取消');
          continue;
        }
      }
      try {
        const result = await executeAction(action);
        results.push({ action, ok: true, result });
        addLog(action, true, result);
      } catch (err) {
        results.push({ action, ok: false, error: err.message });
        addLog(action, false, err.message);
      }
    }
    return results;
  }

  function showConfirm(action) {
    return new Promise((resolve) => {
      const modal = document.getElementById('confirmModal');
      const preview = document.getElementById('confirmActionPreview');
      const okBtn = document.getElementById('confirmOk');
      const cancelBtn = document.getElementById('confirmCancel');
      if (!modal || !preview || !okBtn || !cancelBtn) { resolve(false); return; }
      preview.textContent = JSON.stringify(action, null, 2);
      const cleanup = () => {
        modal.close();
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        modal.removeEventListener('close', onClose);
      };
      const onOk = () => { cleanup(); resolve(true); };
      const onCancel = () => { cleanup(); resolve(false); };
      const onClose = () => { cleanup(); resolve(false); };
      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      modal.addEventListener('close', onClose);
      modal.showModal();
    });
  }

  // ── Logging ──

  function addLog(action, ok, result) {
    const entry = { time: new Date(), action, ok, result };
    core.addLogEntry(entry);
    if (window.__agentPanels?.renderLogs) window.__agentPanels.renderLogs();
    const conv = core.getActiveConversation();
    window.AgentStats?.recordOp({
      type: action?.type,
      ok,
      convId: conv?.id,
    });
  }

  function renderLogs() {
    // This is just a stub; real rendering is in app-panels.js
  }

  // ── Build feedback message (for return to LLM) ──

  function buildFeedbackMessage(actionResults) {
    const parts = actionResults.map((r) => {
      const status = r.ok ? '成功' : '失败';
      if (!r.ok) {
        return `[${r.action.type}] ${status}\n请求: ${JSON.stringify(r.action)}\n错误: ${r.error}`;
      }
      let resultStr;
      if (r.action.type === 'read_file' && r.result?.content != null) {
        resultStr = r.result.content;
      } else {
        resultStr = JSON.stringify(r.result, null, 2);
      }
      return `[${r.action.type}] ${status}\n请求: ${JSON.stringify(r.action)}\n结果:\n${resultStr}`;
    });
    return `以下是动作执行结果，请根据结果继续处理用户的请求：\n\n${parts.join('\n\n---\n\n')}`;
  }

  // ── Public API ──

  window.__agentExecutor = {
    normalizeUsage,
    estimateUsageForReply,
    resolveUsage,
    formatUsageLabel,
    renderUsageHtml,
    getLastAssistantUsage,
    recordAssistantStats,
    executeAction,
    runActions,
    showConfirm,
    addLog,
    buildFeedbackMessage,
  };
})();