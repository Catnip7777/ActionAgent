// Web Worker for LLM Action Agent Lite
// Handles data-intensive operations off the main thread

let startTag = '<action_fix>';
let endTag = '</action_fix>';
let escapePrefix = '\\';

function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function isActionBlockEscaped(text, startIndex) {
  if (!escapePrefix || startIndex <= 0) return false;
  if (escapePrefix.length === 1) return text[startIndex - 1] === escapePrefix;
  const from = startIndex - escapePrefix.length;
  return from >= 0 && text.slice(from, startIndex) === escapePrefix;
}

function tryParseActionInner(inner) {
  const trimmed = (inner || '').trim();
  if (!trimmed) return null;
  try { const parsed = JSON.parse(trimmed); if (parsed && typeof parsed === 'object' && parsed.type) return parsed; } catch {}
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

function collectXmlTagBlocks(text, st, et) {
  const blocks = [];
  let pos = 0;
  while (pos < text.length) {
    const startIdx = text.indexOf(st, pos);
    if (startIdx === -1) break;
    if (isActionBlockEscaped(text, startIdx)) { blocks.push({ inner: '', escaped: true, start: startIdx, end: startIdx + st.length }); pos = startIdx + st.length; continue; }
    const contentStart = startIdx + st.length;
    const endPositions = findTagPositions(text, et, contentStart);
    let matched = false;
    for (let i = endPositions.length - 1; i >= 0; i--) {
      const inner = text.slice(contentStart, endPositions[i]).trim();
      if (tryParseActionInner(inner)) { blocks.push({ inner, escaped: false, start: startIdx, end: endPositions[i] + et.length }); pos = endPositions[i] + et.length; matched = true; break; }
    }
    if (!matched) pos = startIdx + st.length;
  }
  return blocks;
}

function stripActionBlocks(text) {
  if (!text) return text;
  const blocks = collectXmlTagBlocks(text, startTag, endTag);
  if (!blocks.length) return text.trim();
  let result = '';
  let pos = 0;
  for (const p of blocks) { result += text.slice(pos, p.escaped ? p.start - 1 : p.start); if (p.escaped) result += text.slice(p.start, p.end); pos = p.end; }
  return (result + text.slice(pos)).trim();
}

function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function formatTokenNum(n) { const v = Number(n) || 0; return v >= 10000 ? (v / 1000).toFixed(1) + 'k' : String(v); }

function formatUsageLabel(usage) {
  if (!usage) return '';
  const parts = [`输入 ${formatTokenNum(usage.promptTokens)}`, `输出 ${formatTokenNum(usage.completionTokens)}`];
  if (usage.reasoningTokens > 0) parts.push(`思考 ${formatTokenNum(usage.reasoningTokens)}`);
  parts.push(`共 ${formatTokenNum(usage.totalTokens)}`);
  if (usage.estimated) parts.push('估算');
  return parts.join(' · ');
}

function buildAssistantBubbleHtml(content, reasoning, actionResults, fileBlocks, streaming, usage) {
  const rc = reasoningHtml(reasoning, streaming);
  const stripped = stripActionBlocks(content || '');
  const answerInner = `<div class="message-bubble">${escapeHtml(stripped || '(无文本内容)')}</div>`;
  const usageHtml = streaming ? '' : renderUsageHtml(usage);
  return rc + answerInner + usageHtml;
}

function reasoningHtml(reasoning, streaming) {
  if (!reasoning?.trim()) return '';
  const openAttr = streaming ? ' open' : '';
  return `<details class="reasoning-block${streaming ? ' streaming' : ''}"${openAttr}><summary>${streaming ? '思考过程...' : '思考过程（点击展开/收起）'}</summary><pre class="reasoning-content-scroll">${escapeHtml(reasoning)}</pre></details>`;
}

function renderUsageHtml(usage) {
  if (!usage) return '';
  return `<div class="${usage.estimated ? 'message-usage estimated' : 'message-usage'}">${escapeHtml(formatUsageLabel(usage))}</div>`;
}

self.onmessage = function(e) {
  const { type, data, id } = e.data;
  try {
    switch (type) {
      case 'setConfig': {
        if (data.startTag) startTag = data.startTag;
        if (data.endTag) endTag = data.endTag;
        if (data.escapePrefix != null) escapePrefix = data.escapePrefix;
        self.postMessage({ type: 'configUpdated', id });
        break;
      }
      case 'buildMessageHtml': {
        const html = buildAssistantBubbleHtml(data.content, data.reasoning, data.actionResults || null, data.fileBlocks || null, data.streaming || false, data.usage || null);
        self.postMessage({ type: 'messageHtml', html, id, msgId: data.msgId });
        break;
      }
      case 'parseActions': {
        const s = escapeRegex(startTag);
        const e = escapeRegex(endTag);
        const re = new RegExp(s + '([\\s\\S]*?)' + e, 'g');
        const actions = [];
        let m;
        while ((m = re.exec(data.text)) !== null) {
          try { const p = JSON.parse(m[1].trim()); if (p && p.type) actions.push(p); } catch {}
        }
        self.postMessage({ type: 'parsedActions', actions, id });
        break;
      }
      case 'stripActions': {
        self.postMessage({ type: 'strippedText', text: stripActionBlocks(data.text), id });
        break;
      }
      case 'ping':
        self.postMessage({ type: 'pong', id });
        break;
      default:
        self.postMessage({ type: 'error', error: 'Unknown type: ' + type, id });
    }
  } catch (err) {
    self.postMessage({ type: 'error', error: err.message, id });
  }
};
