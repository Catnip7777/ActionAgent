(() => {
  'use strict';

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

  async function isBackendOnline() { return false; }

  async function syncConfigToFiles() { return { ok: false, reason: 'lite版无后端' }; }

  async function loadConfigFromFiles() { return false; }

  async function testConnection() {
    const url = core.normalizeApiBaseUrl(core.getConfig().apiBaseUrl) + '/chat/completions';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + core.getConfig().apiKey },
      body: JSON.stringify({ model: core.getConfig().modelName, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 5 }),
    });
    if (!res.ok) { const t = await res.text(); throw new Error(`连接失败 (${res.status}): ${t.slice(0, 200)}`); }
    return true;
  }

  async function callLLM(userMessage, { signal } = {}) {
    const url = core.normalizeApiBaseUrl(core.getConfig().apiBaseUrl) + '/chat/completions';
    
    // [缓存优化] 系统提示只包含静态部分（messages[0]永远不变）
    const staticSys = core.buildSystemPromptCore();
    // 动态环境信息（工作区、任务板、文件上下文）拼接到用户消息前面
    const dynamicEnv = core.getDynamicEnvSection();
    
    const messages = core.getMessages();
    let actualUserMsg = userMessage || '';
    if (dynamicEnv && dynamicEnv.trim()) {
      actualUserMsg = dynamicEnv.trim() + '\n\n---\n\n' + actualUserMsg;
    }

    const historyMsgs = messages.map((m) => ({ role: m.role, content: m.content }));
    const apiMessages = [
      { role: 'system', content: staticSys },
      ...historyMsgs
    ];
    if (actualUserMsg.trim()) apiMessages.push({ role: 'user', content: actualUserMsg });

    const body = {
      model: core.getConfig().modelName,
      messages: apiMessages,
      temperature: core.getConfig().temperature,
      max_tokens: core.getConfig().maxTokens,
      stream: true,
      stream_options: { include_usage: true }
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + core.getConfig().apiKey },
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

  async function callLLMFromHistory(options = {}) { return callLLM(null, options); }

  async function readStream(res, signal) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    let reasoningFull = '';
    let buffer = '';
    let finishReason = null;
    let usageRaw = null;

    while (true) {
      if (signal?.aborted) { await reader.cancel().catch(() => {}); throw new DOMException('Aborted', 'AbortError'); }
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
            if (rc) { reasoningFull += rc; if (window.__agentChatUI?.updateStreamingBubble) window.__agentChatUI.updateStreamingBubble(full, reasoningFull); }
            if (delta.content) { full += delta.content; if (window.__agentChatUI?.updateStreamingBubble) window.__agentChatUI.updateStreamingBubble(full, reasoningFull); }
          } else if (message) {
            const rc = extractReasoningFromPart(message);
            if (rc) reasoningFull += rc;
            if (message.content) full += message.content;
            if (window.__agentChatUI?.updateStreamingBubble) window.__agentChatUI.updateStreamingBubble(full, reasoningFull);
          }
        } catch {}
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
        var hitTk = usage._cacheHitTokens || 0;
        var missTk = usage._cacheMissTokens || 0;
        s.totalCachedInput += hitTk;
        s.totalNonCachedInput += missTk;
        if (hitTk > 0) s.cacheHitCount++;
        if (missTk > 0) s.cacheMissCount++;
      } else {
        s.totalNonCachedInput += usage.promptTokens || 0;
        s.cacheMissCount++;
      }
      // 立即持久化到 localStorage
      var conv = core.getActiveConversation();
      if (conv) { conv.updatedAt = Date.now(); core.saveConversationsStore(); }
    }

    return { content: full, reasoning: reasoningFull.trim() || null, finishReason, usage };
  }

  function extractReasoningFromPart(part) {
    if (!part || typeof part !== 'object') return null;
    const v = part.reasoning_content ?? part.reasoning ?? part.thought ?? null;
    return v != null && v !== '' ? String(v) : null;
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

  window.__agentLLM = {
    isBackendOnline, callLLM, callLLMFromHistory, readStream,
    extractReasoningFromPart, testConnection, syncConfigToFiles, loadConfigFromFiles,
    getConversationStats, resetConversationStats
  };
})();