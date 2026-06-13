(() => {
  'use strict';

  const STATS_KEY = 'llm_action_agent_stats';
  const MAX_TOKEN_EVENTS = 6000;
  const MAX_OP_EVENTS = 8000;

  const MEMORY_TYPES = new Set([
    'list_memories', 'read_memory', 'save_memory', 'append_memory', 'delete_memory', 'write_memory',
  ]);
  const PLUGIN_TYPES = new Set([
    'list_plugins', 'read_plugin', 'save_plugin', 'delete_plugin',
  ]);
  const TASK_TYPES = new Set([
    'task_list', 'task_add', 'task_update', 'task_delete', 'task_decompose', 'task_check',
  ]);

  let store = loadStore();

  function loadStore() {
    try {
      const raw = localStorage.getItem(STATS_KEY);
      if (!raw) return { tokenEvents: [], opEvents: [], migratedFromConv: false };
      const data = JSON.parse(raw);
      return {
        tokenEvents: data.tokenEvents || [],
        opEvents: data.opEvents || [],
        migratedFromConv: !!data.migratedFromConv,
      };
    } catch {
      return { tokenEvents: [], opEvents: [], migratedFromConv: false };
    }
  }

  function saveStore() {
    localStorage.setItem(STATS_KEY, JSON.stringify(store));
  }

  function trimStore() {
    if (store.tokenEvents.length > MAX_TOKEN_EVENTS) {
      store.tokenEvents = store.tokenEvents.slice(-MAX_TOKEN_EVENTS);
    }
    if (store.opEvents.length > MAX_OP_EVENTS) {
      store.opEvents = store.opEvents.slice(-MAX_OP_EVENTS);
    }
  }

  function categorizeOp(type) {
    if (!type || type === 'chat_turn') return 'chat';
    if (MEMORY_TYPES.has(type)) return 'memory';
    if (PLUGIN_TYPES.has(type)) return 'plugin';
    if (TASK_TYPES.has(type)) return 'task';
    return 'action';
  }

  function recordToken({ convId, convTitle, usage, ts = Date.now() }) {
    if (!usage) return;
    store.tokenEvents.push({
      ts,
      convId: convId || '',
      convTitle: convTitle || '对话',
      promptTokens: usage.promptTokens || 0,
      completionTokens: usage.completionTokens || 0,
      reasoningTokens: usage.reasoningTokens || 0,
      totalTokens: usage.totalTokens || 0,
      estimated: !!usage.estimated,
    });
    store.opEvents.push({
      ts,
      type: 'chat_turn',
      ok: true,
      category: 'chat',
      convId: convId || '',
    });
    trimStore();
    saveStore();
  }

  function recordOp({ type, ok, convId, ts = Date.now() }) {
    if (!type || type === 'chat_turn') return;
    store.opEvents.push({
      ts,
      type,
      ok: !!ok,
      category: categorizeOp(type),
      convId: convId || '',
    });
    trimStore();
    saveStore();
  }

  function migrateFromConversations(conversations) {
    if (store.migratedFromConv) return;
    for (const conv of conversations || []) {
      const tsBase = conv.updatedAt || conv.createdAt || Date.now();
      for (const m of conv.messages || []) {
        if (m.role === 'assistant' && m.usage) {
          store.tokenEvents.push({
            ts: m.ts || tsBase,
            convId: conv.id,
            convTitle: conv.title || '对话',
            promptTokens: m.usage.promptTokens || 0,
            completionTokens: m.usage.completionTokens || 0,
            reasoningTokens: m.usage.reasoningTokens || 0,
            totalTokens: m.usage.totalTokens || 0,
            estimated: !!m.usage.estimated,
          });
        }
      }
    }
    store.migratedFromConv = true;
    trimStore();
    saveStore();
  }

  function bucketKey(ts, period) {
    const d = new Date(ts);
    if (period === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (period === 'year') return String(d.getFullYear());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function formatBucketLabel(key, period) {
    if (period === 'year') return key;
    if (period === 'month') return key;
    return key.slice(5);
  }

  function aggregateTokensByPeriod(period, limit = 30) {
    const buckets = new Map();
    for (const e of store.tokenEvents) {
      const k = bucketKey(e.ts, period);
      if (!buckets.has(k)) {
        buckets.set(k, { total: 0, prompt: 0, completion: 0, reasoning: 0, count: 0 });
      }
      const b = buckets.get(k);
      b.total += e.totalTokens || 0;
      b.prompt += e.promptTokens || 0;
      b.completion += e.completionTokens || 0;
      b.reasoning += e.reasoningTokens || 0;
      b.count += 1;
    }
    const keys = [...buckets.keys()].sort().slice(-limit);
    return keys.map((k) => ({
      key: k,
      label: formatBucketLabel(k, period),
      ...buckets.get(k),
    }));
  }

  function sumTokens(events) {
    return events.reduce(
      (s, e) => {
        s.promptTokens += e.promptTokens || 0;
        s.completionTokens += e.completionTokens || 0;
        s.reasoningTokens += e.reasoningTokens || 0;
        s.totalTokens += e.totalTokens || 0;
        s.turns += 1;
        return s;
      },
      { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, totalTokens: 0, turns: 0 }
    );
  }

  function sumOps(events) {
    const byCat = { chat: 0, action: 0, memory: 0, task: 0, plugin: 0 };
    const byType = {};
    let success = 0;
    let fail = 0;
    for (const e of events) {
      const cat = e.category || categorizeOp(e.type);
      if (byCat[cat] != null) byCat[cat] += 1;
      if (e.type && e.type !== 'chat_turn') {
        byType[e.type] = (byType[e.type] || 0) + 1;
      }
      if (e.ok) success += 1;
      else fail += 1;
    }
    const topTypes = Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 12);
    return { byCat, topTypes, success, fail, total: events.length };
  }

  function aggregateByConversation() {
    const map = new Map();
    for (const e of store.tokenEvents) {
      const id = e.convId || 'unknown';
      if (!map.has(id)) {
        map.set(id, { convId: id, title: e.convTitle || '对话', ...sumTokens([]) });
      }
      const row = map.get(id);
      row.promptTokens += e.promptTokens || 0;
      row.completionTokens += e.completionTokens || 0;
      row.reasoningTokens += e.reasoningTokens || 0;
      row.totalTokens += e.totalTokens || 0;
      row.turns += 1;
      if (e.convTitle) row.title = e.convTitle;
    }
    return [...map.values()].sort((a, b) => b.totalTokens - a.totalTokens);
  }

  function isToday(ts) {
    const d = new Date(ts);
    const n = new Date();
    return d.getFullYear() === n.getFullYear()
      && d.getMonth() === n.getMonth()
      && d.getDate() === n.getDate();
  }

  function drawBarChart(canvas, data, opts = {}) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 600;
    const cssH = opts.height || 220;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    if (!data.length) {
      ctx.fillStyle = '#8b8b9a';
      ctx.font = '13px sans-serif';
      ctx.fillText('暂无数据', 16, 32);
      return;
    }

    const padL = 44;
    const padR = 12;
    const padT = 16;
    const padB = 36;
    const chartW = cssW - padL - padR;
    const chartH = cssH - padT - padB;
    const max = Math.max(...data.map((d) => d.total || d.value || 0), 1);
    const barGap = 4;
    const barW = Math.max(6, (chartW - barGap * (data.length - 1)) / data.length);

    ctx.strokeStyle = '#2a2a35';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + chartH);
    ctx.lineTo(padL + chartW, padT + chartH);
    ctx.stroke();

    data.forEach((d, i) => {
      const val = d.total || d.value || 0;
      const h = (val / max) * chartH;
      const x = padL + i * (barW + barGap);
      const y = padT + chartH - h;
      ctx.fillStyle = 'rgba(99, 102, 241, 0.85)';
      ctx.fillRect(x, y, barW, h);
      if (data.length <= 20) {
        ctx.fillStyle = '#8b8b9a';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(d.label, x + barW / 2, padT + chartH + 14);
        ctx.textAlign = 'left';
      }
    });

    ctx.fillStyle = '#8b8b9a';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(formatNum(max), padL - 6, padT + 10);
    ctx.fillText('0', padL - 6, padT + chartH);
    ctx.textAlign = 'left';
  }

  function formatNum(n) {
    const v = Number(n) || 0;
    if (v >= 10000) return (v / 1000).toFixed(1) + 'k';
    return String(v);
  }

  function renderPanel(deps) {
    const escapeHtml = deps.escapeHtml || ((s) => String(s));
    const periodEl = document.getElementById('statsPeriod');
    const period = periodEl?.value || 'day';
    const tokenAll = sumTokens(store.tokenEvents);
    const tokenToday = sumTokens(store.tokenEvents.filter((e) => isToday(e.ts)));
    const opsAll = sumOps(store.opEvents);
    const convRows = aggregateByConversation();
    const chartData = aggregateTokensByPeriod(period, period === 'day' ? 14 : period === 'month' ? 12 : 5);

    const cards = document.getElementById('statsSummaryCards');
    if (cards) {
      cards.innerHTML = `
        <div class="stats-card"><span class="stats-card-label">累计 Token</span><span class="stats-card-val">${formatNum(tokenAll.totalTokens)}</span></div>
        <div class="stats-card"><span class="stats-card-label">今日 Token</span><span class="stats-card-val">${formatNum(tokenToday.totalTokens)}</span></div>
        <div class="stats-card"><span class="stats-card-label">LLM 回复次数</span><span class="stats-card-val">${tokenAll.turns}</span></div>
        <div class="stats-card"><span class="stats-card-label">动作执行</span><span class="stats-card-val">${opsAll.byCat.action}</span></div>
        <div class="stats-card"><span class="stats-card-label">记忆操作</span><span class="stats-card-val">${opsAll.byCat.memory}</span></div>
        <div class="stats-card"><span class="stats-card-label">任务操作</span><span class="stats-card-val">${opsAll.byCat.task}</span></div>
        <div class="stats-card"><span class="stats-card-label">插件操作</span><span class="stats-card-val">${opsAll.byCat.plugin}</span></div>
        <div class="stats-card"><span class="stats-card-label">操作成功/失败</span><span class="stats-card-val">${opsAll.success}/${opsAll.fail}</span></div>
      `;
    }

    drawBarChart(document.getElementById('statsTokenChart'), chartData, { height: 220 });

    const tokenDetail = document.getElementById('statsTokenDetail');
    if (tokenDetail) {
      tokenDetail.textContent = `输入 ${formatNum(tokenAll.promptTokens)} · 输出 ${formatNum(tokenAll.completionTokens)}`
        + (tokenAll.reasoningTokens ? ` · 思考 ${formatNum(tokenAll.reasoningTokens)}` : '');
    }

    const catEl = document.getElementById('statsOpCategories');
    if (catEl) {
      const cats = [
        ['对话 (LLM)', opsAll.byCat.chat],
        ['动作', opsAll.byCat.action],
        ['记忆', opsAll.byCat.memory],
        ['任务板', opsAll.byCat.task],
        ['插件', opsAll.byCat.plugin],
      ];
      const maxCat = Math.max(...cats.map((c) => c[1]), 1);
      catEl.innerHTML = cats.map(([label, count]) => `
        <div class="stats-bar-row">
          <span class="stats-bar-label">${escapeHtml(label)}</span>
          <div class="stats-bar-track"><div class="stats-bar-fill" style="width:${(count / maxCat) * 100}%"></div></div>
          <span class="stats-bar-val">${count}</span>
        </div>
      `).join('');
    }

    const topEl = document.getElementById('statsTopActions');
    if (topEl) {
      topEl.innerHTML = opsAll.topTypes.length
        ? `<table class="stats-table"><thead><tr><th>动作类型</th><th>次数</th></tr></thead><tbody>`
          + opsAll.topTypes.map(([t, c]) =>
            `<tr><td><code>${escapeHtml(t)}</code></td><td>${c}</td></tr>`
          ).join('')
          + '</tbody></table>'
        : '<p class="panel-desc">暂无动作记录</p>';
    }

    const convEl = document.getElementById('statsConvTable');
    if (convEl) {
      convEl.innerHTML = convRows.length
        ? `<table class="stats-table stats-table-wide"><thead><tr>
            <th>对话</th><th>回复次数</th><th>输入</th><th>输出</th><th>合计</th>
          </tr></thead><tbody>`
          + convRows.map((r) => `
            <tr>
              <td title="${escapeHtml(r.convId)}">${escapeHtml(r.title)}</td>
              <td>${r.turns}</td>
              <td>${formatNum(r.promptTokens)}</td>
              <td>${formatNum(r.completionTokens)}</td>
              <td><strong>${formatNum(r.totalTokens)}</strong></td>
            </tr>
          `).join('')
          + '</tbody></table>'
        : '<p class="panel-desc">暂无对话 Token 记录</p>';
    }

    const periodHint = document.getElementById('statsPeriodHint');
    if (periodHint) {
      const labels = { day: '最近 14 天', month: '最近 12 个月', year: '按年' };
      periodHint.textContent = labels[period] || '';
    }
  }

  function clearStats() {
    store = { tokenEvents: [], opEvents: [], migratedFromConv: false };
    saveStore();
  }

  function bindPanel(deps) {
    document.getElementById('statsPeriod')?.addEventListener('change', () => renderPanel(deps));
    document.getElementById('refreshStats')?.addEventListener('click', () => {
      migrateFromConversations(deps.getConversations?.());
      renderPanel(deps);
    });
    document.getElementById('clearStats')?.addEventListener('click', () => {
      if (!confirm('确定清空所有统计数据？此操作不可恢复。')) return;
      clearStats();
      renderPanel(deps);
    });
    window.addEventListener('resize', () => renderPanel(deps));
  }

  window.AgentStats = {
    recordToken,
    recordOp,
    migrateFromConversations,
    renderPanel,
    bindPanel,
    clearStats,
    getStore: () => store,
  };
})();
