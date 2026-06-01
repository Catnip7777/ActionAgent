(() => {
  'use strict';

  const core = window.__agentCore;
  if (!core) throw new Error('app-llm.js requires app-core.js');

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
    const sysContent = core.getSystemPromptContent();
    const messages = core.getMessages();
    const apiMessages = [{ role: 'system', content: sysContent }, ...messages.map((m) => ({ role: m.role, content: m.content }))];
    if (userMessage) apiMessages.push({ role: 'user', content: userMessage });
    const body = { model: core.getConfig().modelName, messages: apiMessages, temperature: core.getConfig().temperature, max_tokens: core.getConfig().maxTokens, stream: true, stream_options: { include_usage: true } };
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
          if (chunk.usage) usageRaw = chunk.usage;
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
    return { content: full, reasoning: reasoningFull.trim() || null, finishReason, usage };
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
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + core.getConfig().apiKey },
      body: JSON.stringify({
        model: core.getConfig().modelName,
        messages: [{ role: 'system', content: '根据对话内容生成简短中文标题，不超过20个字。只输出标题本身，不要引号、标点或解释。' }, { role: 'user', content: snippet }],
        temperature: 0.3, max_tokens: 40, stream: false,
      }),
    });
    if (!res.ok) { const errText = await res.text().catch(() => ''); throw new Error('命名请求失败' + (errText ? `: ${errText.slice(0, 120)}` : '')); }
    const data = await res.json();
    return (data.choices?.[0]?.message?.content || '').trim().replace(/^["'\u201C\u2018]|["'\u201D\u2019]$/g, '');
  }

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



  window.__agentLLM = { isBackendOnline, callLLM, callLLMFromHistory, readStream, extractReasoningFromPart, callLLMForTitle, testConnection, syncConfigToFiles, loadConfigFromFiles };
})();
