// Web Worker for App Agent
// Handles data-intensive operations off the main thread

// ── Configurable format tags (synced from main thread) ──
let startTag = '<action_fix>';
let endTag = '</action_fix>';
let escapePrefix = '\\';

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Smart stripping logic (mirrored from app-format.js) ──

function isActionBlockEscaped(text, startIndex) {
  if (!escapePrefix || startIndex <= 0) return false;
  if (escapePrefix.length === 1) return text[startIndex - 1] === escapePrefix;
  const from = startIndex - escapePrefix.length;
  return from >= 0 && text.slice(from, startIndex) === escapePrefix;
}

function tryParseActionInner(inner) {
  const trimmed = (inner || '').trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && parsed.type) return parsed;
  } catch { /* invalid */ }
  return null;
}

function findTagPositions(text, tag, fromIndex) {
  const positions = [];
  let search = fromIndex;
  while (search < text.length) {
    const idx = text.indexOf(tag, search);
    if (idx === -1) break;
    if (!isActionBlockEscaped(text, idx)) positions.push(idx);
    search = idx + tag.length;
  }
  return positions;
}

/** 从最后一个结束标签向前尝试 JSON.parse */
function collectXmlTagBlocks(text, st, et) {
  const blocks = [];
  let pos = 0;
  while (pos < text.length) {
    const startIdx = text.indexOf(st, pos);
    if (startIdx === -1) break;
    if (isActionBlockEscaped(text, startIdx)) {
      blocks.push({ inner: '', escaped: true, start: startIdx, end: startIdx + st.length });
      pos = startIdx + st.length;
      continue;
    }
    const contentStart = startIdx + st.length;
    const endPositions = findTagPositions(text, et, contentStart);
    let matched = false;
    for (let i = endPositions.length - 1; i >= 0; i--) {
      const inner = text.slice(contentStart, endPositions[i]).trim();
      if (tryParseActionInner(inner)) {
        blocks.push({ inner, escaped: false, start: startIdx, end: endPositions[i] + et.length });
        pos = endPositions[i] + et.length;
        matched = true;
        break;
      }
    }
    if (!matched) pos = startIdx + st.length;
  }
  return blocks;
}

/** 改进的 stripActionBlocks — 使用智能区块收集 */
function stripActionBlocks(text) {
  if (!text) return text;
  const blocks = collectXmlTagBlocks(text, startTag, endTag);
  if (!blocks.length) return text.trim();
  let result = '';
  let pos = 0;
  for (const p of blocks) {
    result += text.slice(pos, p.escaped ? p.start - 1 : p.start);
    if (p.escaped) result += text.slice(p.start, p.end);
    pos = p.end;
  }
  return (result + text.slice(pos)).trim();
}

// ── HTML escaping (inlined for worker) ──
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTokenNum(n) {
  const v = Number(n) || 0;
  if (v >= 10000) return (v / 1000).toFixed(1) + 'k';
  return String(v);
}

function formatUsageLabel(usage) {
  if (!usage) return '';
  const parts = [
    `\u8f93\u5165 ${formatTokenNum(usage.promptTokens)}`,
    `\u8f93\u51fa ${formatTokenNum(usage.completionTokens)}`,
  ];
  if (usage.reasoningTokens > 0) {
    parts.push(`\u601d\u8003 ${formatTokenNum(usage.reasoningTokens)}`);
  }
  parts.push(`\u5171 ${formatTokenNum(usage.totalTokens)}`);
  if (usage.estimated) parts.push('\u4f30\u7b97');
  return parts.join(' \u00b7 ');
}

// ── Build assistant bubble HTML ──
function buildAssistantBubbleHtml(content, reasoning, actionResults, fileBlocks, streaming, usage) {
  const reasoningHtml = renderReasoningHtml(reasoning, streaming);
  const answerInner = formatMessageBubbleHtml('assistant', content, actionResults, fileBlocks);
  const stripped = stripActionBlocks(content || '');
  const answerHtml = `<div class="message-bubble">${answerInner || escapeHtml(stripped || '(\u65e0\u6587\u672c\u5185\u5bb9)')}</div>`;
  const usageHtml = streaming ? '' : renderUsageHtml(usage);
  return reasoningHtml + answerHtml + usageHtml;
}

function renderReasoningHtml(reasoning, streaming) {
  if (!reasoning?.trim()) return '';
  const openAttr = streaming ? ' open' : '';
  const summary = streaming ? '\u601d\u8003\u8fc7\u7a0b\u2026' : '\u601d\u8003\u8fc7\u7a0b\uff08\u70b9\u51fb\u5c55\u5f00/\u6536\u8d77\uff09';
  return `
    <details class="reasoning-block${streaming ? ' streaming' : ''}"${openAttr}>
      <summary>${summary}</summary>
      <pre class="reasoning-content-scroll">${escapeHtml(reasoning)}</pre>
    </details>
  `;
}

function renderUsageHtml(usage) {
  if (!usage) return '';
  const cls = usage.estimated ? 'message-usage estimated' : 'message-usage';
  return `<div class="${cls}">${escapeHtml(formatUsageLabel(usage))}</div>`;
}

function isLongContent(text) {
  return text && (text.length > 1200 || (text.match(/\n/g) || []).length > 30);
}

function renderActionFileBlocks(actionResults) {
  if (!actionResults?.length) return '';
  return actionResults
    .filter((r) => r.ok && r.action.type === 'read_file' && r.result?.content != null)
    .map((r) => `
      <div class="file-block">
        <div class="file-block-header">\ud83d\udcc4 ${escapeHtml(r.action.path || 'file')}</div>
        <pre class="file-content-scroll">${escapeHtml(r.result.content)}</pre>
      </div>
    `).join('');
}

function formatMessageBubbleHtml(role, content, actionResults, fileBlocks) {
  const displayContent = role === 'assistant' ? stripActionBlocks(content) : content;
  const blocks = fileBlocks || renderActionFileBlocks(actionResults);
  const summary = escapeHtml(
    displayContent?.startsWith('\u4ee5\u4e0b\u662f\u52a8\u4f5c\u6267\u884c\u7ed3\u679c')
      ? '(\u52a8\u4f5c\u6267\u884c\u7ed3\u679c\uff0c\u89c1\u4e0b\u65b9\u6587\u4ef6/\u8be6\u60c5)'
      : (displayContent || '(\u65e0\u6587\u672c\u5185\u5bb9)')
  );
  const scrollClass = isLongContent(displayContent) && !blocks ? ' message-bubble-scroll' : '';
  const bubbleInner = blocks
    ? (displayContent && !displayContent.startsWith('\u4ee5\u4e0b\u662f\u52a8\u4f5c\u6267\u884c\u7ed3\u679c')
        ? `<div>${summary}</div>${blocks}`
        : blocks + (displayContent && displayContent.length < 500
          ? `<div style="margin-top:8px;font-size:12px;color:var(--text-muted)">${summary}</div>` : ''))
    : `<div class="${scrollClass ? 'message-bubble-scroll' : ''}">${summary}</div>`;
  return bubbleInner;
}

// ── Action JSON parsing (uses configurable tags) ──
function parseActions(text) {
  const actions = [];
  if (!text) return actions;
  const s = escapeRegex(startTag);
  const e = escapeRegex(endTag);
  const blockRegex = new RegExp(s + '([\\s\\S]*?)' + e, 'g');
  let match;
  while ((match = blockRegex.exec(text)) !== null) {
    const inner = match[1].trim();
    if (!inner) continue;
    try {
      const parsed = JSON.parse(inner);
      if (parsed && typeof parsed === 'object' && parsed.type) {
        actions.push(parsed);
      }
    } catch { /* invalid json, skip */ }
  }
  return actions;
}

// ── Message handler ──
self.onmessage = function(e) {
  const { type, data, id } = e.data;
  
  try {
    switch (type) {
      case 'init':
      case 'setConfig': {
        if (data.startTag) startTag = data.startTag;
        if (data.endTag) endTag = data.endTag;
        if (data.escapePrefix != null) escapePrefix = data.escapePrefix;
        self.postMessage({ type: 'configUpdated', id });
        break;
      }

      case 'buildMessageHtml': {
        const html = buildAssistantBubbleHtml(
          data.content,
          data.reasoning,
          data.actionResults || null,
          data.fileBlocks || null,
          data.streaming || false,
          data.usage || null
        );
        self.postMessage({ type: 'messageHtml', html, id, msgId: data.msgId });
        break;
      }
      
      case 'buildFeedbackHtml': {
        const parts = (data.actionResults || []).map((r) => {
          const status = r.ok ? '\u6210\u529f' : '\u5931\u8d25';
          if (!r.ok) {
            return `[${r.action.type}] ${status}\\n\u8bf7\u6c42: ${JSON.stringify(r.action)}\\n\u9519\u8bef: ${r.error}`;
          }
          let resultStr;
          if (r.action.type === 'read_file' && r.result?.content != null) {
            resultStr = r.result.content;
          } else {
            resultStr = JSON.stringify(r.result, null, 2);
          }
          return `[${r.action.type}] ${status}\\n\u8bf7\u6c42: ${JSON.stringify(r.action)}\\n\u7ed3\u679c:\\n${resultStr}`;
        });
        const feedback = `\u4ee5\u4e0b\u662f\u52a8\u4f5c\u6267\u884c\u7ed3\u679c\uff0c\u8bf7\u6839\u636e\u7ed3\u679c\u7ee7\u7eed\u5904\u7406\u7528\u6237\u7684\u8bf7\u6c42\uff1a\\n\\n${parts.join('\\n\\n---\\n\\n')}`;
        self.postMessage({ type: 'feedbackHtml', feedback, id });
        break;
      }
      
      case 'parseActions': {
        const actions = parseActions(data.text);
        self.postMessage({ type: 'parsedActions', actions, id });
        break;
      }
      
      case 'buildReasoningHtml': {
        const html = renderReasoningHtml(data.reasoning, data.streaming || false);
        self.postMessage({ type: 'reasoningHtml', html, id });
        break;
      }
      
      case 'stripActions': {
        const result = stripActionBlocks(data.text);
        self.postMessage({ type: 'strippedText', text: result, id });
        break;
      }
      
      case 'ping': {
        self.postMessage({ type: 'pong', id });
        break;
      }
      
      default:
        self.postMessage({ type: 'error', error: `Unknown type: ${type}`, id });
    }
  } catch (err) {
    self.postMessage({ type: 'error', error: err.message, id });
  }
};