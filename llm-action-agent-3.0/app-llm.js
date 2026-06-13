(() => {
  'use strict';

  // ============================================================
  // LLM API Module
  // Calls OpenAI-compatible LLM APIs with streaming
  // Depends on: window.__agentCore, window.__agentExecutor
  // ============================================================

  const core = window.__agentCore;
  if (!core) throw new Error('app-llm.js requires app-core.js');

  // ── 对话级 Token 消耗统计（持久化到 conv.stats，按对话隔离） ──
  function getDefaultStats() {
    return {
      totalInput: 0, totalOutput: 0, totalReasoning: 0,
      totalCachedInput: 0, totalNonCachedInput: 0,
      requestCount: 0, cacheHitCount: 0, cacheMissCount: 0
    };
  }

  function getConvStats() {
    var conv = core.getActiveConversation();
    if (!conv) return getDefaultStats();
    if (!conv.stats) conv.stats = getDefaultStats();
    return conv.stats;
  }

  function saveConvStats() {
    var conv = core.getActiveConversation();
    if (!conv) return;
    conv.updatedAt = Date.now();
    core.saveConversationsStore();
  }

  function getConversationStats() {
    var s = getConvStats();
    var totalCacheTokens = s.totalCachedInput + s.totalNonCachedInput;
    var tokenHitRate = totalCacheTokens > 0
      ? ((s.totalCachedInput / totalCacheTokens) * 100).toFixed(1)
      : '0.0';
    var reqHitRate = s.requestCount > 0
      ? ((s.cacheHitCount / s.requestCount) * 100).toFixed(1)
      : '0.0';
    return {
      totalInput: s.totalInput,
      totalOutput: s.totalOutput,
      totalReasoning: s.totalReasoning,
      totalTokens: s.totalInput + s.totalOutput,
      totalCachedInput: s.totalCachedInput,
      totalNonCachedInput: s.totalNonCachedInput,
      requestCount: s.requestCount,
      cacheHitCount: s.cacheHitCount,
      cacheMissCount: s.cacheMissCount,
      tokenHitRate: tokenHitRate,
      reqHitRate: reqHitRate
    };
  }

  function resetConversationStats() {
    var conv = core.getActiveConversation();
    if (!conv) return;
    conv.stats = getDefaultStats();
    core.saveConversationsStore();
  }

  // ── Backend status ──

  async function isBackendOnline() {
    const cfg = core.getConfig();
    if (!cfg) return false;
    const url = cfg.backendUrl;
    if (!url) return false;
    try {
      const res = await fetch(url.replace(/\/$/, '') + '/health', { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── LLM API calls ──

  async function callLLM(userMessage, { signal } = {}) {
    const url = core.normalizeApiBaseUrl(core.getConfig().apiBaseUrl) + '/chat/completions';
    
    // [缓存优化] 系统提示只包含静态部分（可被 API 缓存）
    const staticSys = core.buildSystemPromptCore();
    // 动态环境信息（工作区、任务板、文件上下文）拼接到用户消息前面
    const dynamicEnv = core.getDynamicEnvSection();
    
    const messages = core.getMessages();
    let actualUserMsg = userMessage || '';
    if (dynamicEnv && dynamicEnv.trim()) {
      actualUserMsg = dynamicEnv.trim() + '\n\n---\n\n' + actualUserMsg;
    }

    const apiMessages = [
      { role: 'system', content: staticSys },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    if (actualUserMsg.trim()) {
      apiMessages.push({ role: 'user', content: actualUserMsg });
    }

    const body = {
      model: core.getConfig().modelName,
      messages: apiMessages,
      temperature: core.getConfig().temperature,
      max_tokens: core.getConfig().maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + core.getConfig().apiKey,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      let msg = `API 错误 ${res.status}`;
      try { msg = JSON.parse(errText).error?.message || msg; } catch { msg += ': ' + errText.slice(0, 200); }
      throw new Error(msg);
    }

    return readStream(res, signal);
  }

  async function callLLMFromHistory(options = {}) {
    return callLLM(null, options);
  }

  async function readStream(res, signal) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    let reasoningFull = '';
    let buffer = '';
    let finishReason = null;
    let usageRaw = null;

    while (true) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => {});
        throw new DOMException('Aborted', 'AbortError');
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const chunk = JSON.parse(data);
          if (chunk.usage) {
            usageRaw = chunk.usage;
            // 捕获缓存命中信息，保存具体数值
            usageRaw._cacheHitTokens = chunk.usage.prompt_cache_hit_tokens || 0;
            usageRaw._cacheMissTokens = chunk.usage.prompt_cache_miss_tokens || 0;
            if (usageRaw._cacheHitTokens > 0) usageRaw._cacheHit = true;
            if (usageRaw._cacheMissTokens > 0) usageRaw._cacheMiss = true;
          }
          const choice = chunk.choices?.[0];
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          const delta = choice?.delta;
          const message = choice?.message;

          if (delta) {
            const rc = extractReasoningFromPart(delta);
            if (rc) {
              reasoningFull += rc;
              if (window.__agentChatUI?.updateStreamingBubble) {
                window.__agentChatUI.updateStreamingBubble(full, reasoningFull);
              }
            }
            if (delta.content) {
              full += delta.content;
              if (window.__agentChatUI?.updateStreamingBubble) {
                window.__agentChatUI.updateStreamingBubble(full, reasoningFull);
              }
            }
          } else if (message) {
            const rc = extractReasoningFromPart(message);
            if (rc) reasoningFull += rc;
            if (message.content) full += message.content;
            if (window.__agentChatUI?.updateStreamingBubble) {
              window.__agentChatUI.updateStreamingBubble(full, reasoningFull);
            }
          }
        } catch { /* skip malformed chunks */ }
      }
    }
    const executor = window.__agentExecutor;
    const usage = executor ? executor.resolveUsage(usageRaw, full, reasoningFull.trim() || null) : null;

    // 更新对话级统计（写入 conv.stats 实现持久化 + 对话隔离）
    if (usage) {
      var s = getConvStats();
      s.totalInput += usage.promptTokens || 0;
      s.totalOutput += usage.completionTokens || 0;
      s.totalReasoning += usage.reasoningTokens || 0;
      s.requestCount++;
      if (usage.cacheHit || usage.cacheMiss) {
        var hitTokens = usage._cacheHitTokens || 0;
        var missTokens = usage._cacheMissTokens || 0;
        s.totalCachedInput += hitTokens;
        s.totalNonCachedInput += missTokens;
        if (hitTokens > 0) s.cacheHitCount++;
        if (missTokens > 0) s.cacheMissCount++;
      } else {
        s.totalNonCachedInput += usage.promptTokens || 0;
        s.cacheMissCount++;
      }
      // 立即持久化到 localStorage
      var conv = core.getActiveConversation();
      if (conv) { conv.updatedAt = Date.now(); core.saveConversationsStore(); }
    }

    return {
      content: full,
      reasoning: reasoningFull.trim() || null,
      finishReason,
      usage,
    };
  }

  function extractReasoningFromPart(part) {
    if (!part || typeof part !== 'object') return null;
    const v = part.reasoning_content ?? part.reasoning ?? part.thought ?? null;
    return v != null && v !== '' ? String(v) : null;
  }

  async function callLLMForTitle(snippet) {
    const url = core.normalizeApiBaseUrl(core.getConfig().apiBaseUrl) + '/chat/completions';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + core.getConfig().apiKey,
      },
      body: JSON.stringify({
        model: core.getConfig().modelName,
        messages: [
          { role: 'system', content: '根据对话内容生成简短中文标题，不超过20个字。只输出标题本身，不要引号、标点或解释。' },
          { role: 'user', content: snippet },
        ],
        temperature: 0.3,
        max_tokens: 40,
        stream: false,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error('命名请求失败' + (errText ? `: ${errText.slice(0, 120)}` : ''));
    }
    const data = await res.json();
    return (data.choices?.[0]?.message?.content || '').trim().replace(/^["'「『]|["'」』]$/g, '');
  }

  async function testConnection() {
    const url = core.normalizeApiBaseUrl(core.getConfig().apiBaseUrl) + '/chat/completions';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + core.getConfig().apiKey,
      },
      body: JSON.stringify({
        model: core.getConfig().modelName,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`连接失败 (${res.status}): ${t.slice(0, 200)}`);
    }
    return true;
  }

  // ── Config sync (backend file) ──

  async function syncConfigToFiles() {
    if (!(await isBackendOnline())) return { ok: false, reason: 'offline' };
    core.migrateWorkspaces();
    const config = core.getConfig();
    try {
      const res = await fetch(config.backendUrl.replace(/\/$/, '') + '/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + config.backendToken,
          'X-Action-Token': config.backendToken,
        },
        body: JSON.stringify({
          settings: core.exportSettingsForFile(),
          systemPrompt: core.getSystemPromptCore(),
          prompts: config.prompts,
          activePromptId: config.activePromptId,
          apiKey: config.apiKey || '',
          format: config.format,
          conversations: core.getConvStore(),
          workspaces: {
            workspaces: config.workspaces,
            activeWorkspaceId: config.activeWorkspaceId,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || res.status };
      return { ok: true, saved: data.saved, configDir: data.configDir };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async function loadConfigFromFiles() {
    if (!(await isBackendOnline())) return false;
    const config = core.getConfig();
    try {
      const res = await fetch(config.backendUrl.replace(/\/$/, '') + '/config', {
        headers: {
          Authorization: 'Bearer ' + config.backendToken,
          'X-Action-Token': config.backendToken,
        },
      });
      if (!res.ok) return false;
      const data = await res.json();
      // 仅读取后端特有字段，不覆盖用户在前端修改的配置
      if (data.settings && typeof data.settings === 'object') {
        if (data.settings.backendToken) {
          config.backendToken = data.settings.backendToken;
        }
        if (Array.isArray(data.settings.workspaces)) {
          config.workspaces = data.settings.workspaces;
          config.activeWorkspaceId = data.settings.activeWorkspaceId || config.activeWorkspaceId;
        }
      }
      // 后端只补充前端没有的字段，不覆盖前端已有设置（前端是权威）
      if (data.format && typeof data.format === 'object') {
        // 只合并格式中的后端特有字段，不覆盖前端已保存的动作格式
        if (!document.getElementById('startTag')?.value) {
          config.format = { ...core.getDefaultFormat(), ...data.format };
        }
      }
      if (data.conversations && typeof data.conversations === 'object') {
        const convStore = {
          conversations: data.conversations.conversations || [],
          groups: data.conversations.groups || [],
          activeId: data.conversations.activeId || null,
          logs: data.conversations.logs || [],
        };
        core.setConvStore(convStore);
        core.setLogs(convStore.logs || []);
        localStorage.setItem(core.CONVERSATIONS_KEY, JSON.stringify(convStore));
      }
      if (data.workspaces && typeof data.workspaces === 'object') {
        if (Array.isArray(data.workspaces.workspaces)) {
          config.workspaces = data.workspaces.workspaces;
          config.activeWorkspaceId = data.workspaces.activeWorkspaceId || null;
        } else if (Array.isArray(data.workspaces)) {
          config.workspaces = data.workspaces;
        }
        core.migrateWorkspaces();
      }
      localStorage.setItem(core.STORAGE_KEY, JSON.stringify(config));
      // 后端写入的 config 中的 prompts 和 activePromptId 不可信，强制从 localStorage 恢复前端维护的值
      var savedCfg = JSON.parse(localStorage.getItem(core.STORAGE_KEY) || '{}');
      if (Array.isArray(savedCfg.prompts) && savedCfg.prompts.length) {
        config.prompts = savedCfg.prompts;
        config.activePromptId = savedCfg.activePromptId || core.BUILTIN_PROMPT_ID;
        localStorage.setItem(core.STORAGE_KEY, JSON.stringify(config));
      }
      return true;
    } catch {
      return false;
    }
  }

  // ── Public API ──

  window.__agentLLM = {
    isBackendOnline,
    callLLM,
    callLLMFromHistory,
    readStream,
    extractReasoningFromPart,
    callLLMForTitle,
    testConnection,
    syncConfigToFiles,
    loadConfigFromFiles,
    getConversationStats,
    resetConversationStats,
  };
})();
