(() => {
  'use strict';

  // ============================================================
  // Format Parser Module
  // Parses action blocks from LLM replies
  // Depends on: window.__agentCore (config)
  // ============================================================

  const core = window.__agentCore;
  if (!core) throw new Error('app-format.js requires app-core.js');

  // ── Escaping ──

  function isActionBlockEscaped(text, startIndex) {
    const prefix = core.getConfig().format.escapePrefix ?? '\\';
    if (!prefix || startIndex <= 0) return false;
    if (prefix.length === 1) return text[startIndex - 1] === prefix;
    const from = startIndex - prefix.length;
    return from >= 0 && text.slice(from, startIndex) === prefix;
  }

  /** 仅接受含 type 的合法 JSON；避免截断在字符串内的结束标签导致 _parse_error */
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

  /** 从最后一个结束标签向前尝试 JSON.parse，匹配 JSON 内含结束标签字面量的情况 */
  function collectXmlTagBlocks(text, startTag, endTag) {
    const blocks = [];
    let pos = 0;
    while (pos < text.length) {
      const startIdx = text.indexOf(startTag, pos);
      if (startIdx === -1) break;
      if (isActionBlockEscaped(text, startIdx)) {
        blocks.push({
          inner: '',
          escaped: true,
          start: startIdx,
          end: startIdx + startTag.length,
        });
        pos = startIdx + startTag.length;
        continue;
      }
      const contentStart = startIdx + startTag.length;
      const endPositions = findTagPositions(text, endTag, contentStart);
      let matched = false;
      for (let i = endPositions.length - 1; i >= 0; i--) {
        const inner = text.slice(contentStart, endPositions[i]).trim();
        if (tryParseActionInner(inner)) {
          blocks.push({
            inner,
            escaped: false,
            start: startIdx,
            end: endPositions[i] + endTag.length,
          });
          pos = endPositions[i] + endTag.length;
          matched = true;
          break;
        }
      }
      if (!matched) pos = startIdx + startTag.length;
    }
    return blocks;
  }

  function collectMarkdownFenceBlocks(text, fenceLang) {
    const open = '```' + (fenceLang || 'action');
    const blocks = [];
    let pos = 0;
    while (pos < text.length) {
      const startIdx = text.indexOf(open, pos);
      if (startIdx === -1) break;
      if (isActionBlockEscaped(text, startIdx)) {
        blocks.push({
          inner: '',
          escaped: true,
          start: startIdx,
          end: startIdx + open.length,
        });
        pos = startIdx + open.length;
        continue;
      }
      const lineEnd = text.indexOf('\n', startIdx);
      if (lineEnd === -1) break;
      const contentStart = lineEnd + 1;
      const endPositions = findTagPositions(text, '```', contentStart);
      let matched = false;
      for (let i = endPositions.length - 1; i >= 0; i--) {
        const inner = text.slice(contentStart, endPositions[i]).trim();
        if (tryParseActionInner(inner)) {
          blocks.push({
            inner,
            escaped: false,
            start: startIdx,
            end: endPositions[i] + 3,
          });
          pos = endPositions[i] + 3;
          matched = true;
          break;
        }
      }
      if (!matched) pos = startIdx + open.length;
    }
    return blocks;
  }

  function collectFormatBlocks(text) {
    const fmt = core.getConfig().format;
    const blocks = [];

    if (fmt.formatType === 'xml_tag') {
      return collectXmlTagBlocks(text, fmt.startTag, fmt.endTag);
    }

    if (fmt.formatType === 'markdown_fence') {
      return collectMarkdownFenceBlocks(text, fmt.fenceLang || 'action');
    }

    try {
      const re = new RegExp(fmt.customRegex, 'gi');
      let m;
      while ((m = re.exec(text)) !== null) {
        const startIdx = m.index;
        const inner = (m[1] || m[0]).trim();
        if (!tryParseActionInner(inner) && !isActionBlockEscaped(text, startIdx)) continue;
        blocks.push({
          inner,
          escaped: isActionBlockEscaped(text, startIdx),
          start: startIdx,
          end: startIdx + m[0].length,
        });
      }
    } catch { /* invalid regex */ }
    return blocks;
  }

  function parseActions(text) {
    const actions = [];
    for (const { inner, escaped } of collectFormatBlocks(text)) {
      if (escaped) continue;
      const parsed = tryParseActionInner(inner);
      if (parsed) actions.push(parsed);
    }
    return actions;
  }

  /** 检测疑似动作块但 JSON 无效（用于提示，不执行） */
  function findUnparsedActionBlocks(text) {
    const fmt = core.getConfig().format;
    const warnings = [];
    if (fmt.formatType === 'xml_tag') {
      const startTag = fmt.startTag;
      const endTag = fmt.endTag;
      let pos = 0;
      while (pos < text.length) {
        const startIdx = text.indexOf(startTag, pos);
        if (startIdx === -1) break;
        if (isActionBlockEscaped(text, startIdx)) {
          pos = startIdx + startTag.length;
          continue;
        }
        const contentStart = startIdx + startTag.length;
        const endIdx = text.indexOf(endTag, contentStart);
        if (endIdx === -1) break;
        const inner = text.slice(contentStart, endIdx).trim();
        if (inner && !tryParseActionInner(inner)) {
          warnings.push(inner.slice(0, 120));
        }
        pos = endIdx + endTag.length;
      }
    }
    return warnings;
  }

  function formatActionBlock(obj) {
    const json = JSON.stringify(obj, null, 2);
    const fmt = core.getConfig().format;
    if (fmt.formatType === 'xml_tag') {
      return `${fmt.startTag}\n${json}\n${fmt.endTag}`;
    }
    if (fmt.formatType === 'markdown_fence') {
      return '```' + (fmt.fenceLang || 'action') + '\n' + json + '\n```';
    }
    return json;
  }

  function stripActionBlocks(text) {
    if (!text) return text;
    const fmt = core.getConfig().format;
    const parts = collectFormatBlocks(text);
    if (!parts.length) return text;

    if (fmt.formatType === 'xml_tag') {
      let result = '';
      let pos = 0;
      for (const p of parts) {
        result += text.slice(pos, p.escaped ? p.start - 1 : p.start);
        if (p.escaped) result += text.slice(p.start, p.end);
        pos = p.end;
      }
      return (result + text.slice(pos)).trim();
    }

    let result = text;
    for (const p of [...parts].sort((a, b) => b.start - a.start)) {
      if (p.escaped) {
        const prefix = fmt.escapePrefix ?? '\\';
        result = result.slice(0, p.start - prefix.length) + result.slice(p.start);
      } else {
        result = result.slice(0, p.start) + result.slice(p.end);
      }
    }
    return result.trim();
  }

  function getFormatPreview() {
    const ex = { type: 'write_file', path: 'example.txt', content: 'hello' };
    const fmt = core.getConfig().format;
    if (fmt.formatType === 'xml_tag') {
      return `${fmt.startTag}\n${JSON.stringify(ex, null, 2)}\n${fmt.endTag}`;
    }
    if (fmt.formatType === 'markdown_fence') {
      return '```' + (fmt.fenceLang || 'action') + '\n' + JSON.stringify(ex, null, 2) + '\n```';
    }
    return JSON.stringify(ex, null, 2);
  }

function parseActionsFromTexts() {
    var allActions = [];
    var seen = {};
    for (var i = 0; i < arguments.length; i++) {
      var text = arguments[i];
      if (!text || typeof text !== 'string') continue;
      var actions = parseActions(text);
      for (var j = 0; j < actions.length; j++) {
        var key = JSON.stringify(actions[j]);
        if (!seen[key]) { seen[key] = true; allActions.push(actions[j]); }
      }
    }
    return allActions;
  }

const escapeRegexStr = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // ── Public API ──

  window.__agentFormat = {
    isActionBlockEscaped,
    tryParseActionInner,
    findTagPositions,
    collectXmlTagBlocks,
    collectMarkdownFenceBlocks,
    collectFormatBlocks,
    parseActions, parseActionsFromTexts,
    findUnparsedActionBlocks,
    formatActionBlock,
    stripActionBlocks,
    getFormatPreview,
    escapeRegexStr,
  };
})();
