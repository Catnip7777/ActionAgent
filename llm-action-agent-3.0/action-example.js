(() => {
  'use strict';

  var reg = window.AgentActionRegistry;
  if (!reg) { console.warn('action-example.js: AgentActionRegistry not available'); return; }

  var ECHO_DEF = {
    type: 'echo_message',
    label: '\u56de\u58f0\uff08\u793a\u4f8b\uff09',
    scope: 'custom',
    dangerous: false,
    desc: '\u3010\u793a\u4f8b\u52a8\u4f5c\u3011\u5c06 message \u539f\u6837\u8fd4\u56de\uff0c\u6f14\u793a\u81ea\u5b9a\u4e49\u52a8\u4f5c\u6ce8\u518c\u65b9\u5f0f',
    example: { type: 'echo_message', message: 'Hello from custom action' },
  };

  async function executeEcho(action, ctx) {
    var message = action.message !== undefined && action.message !== null ? String(action.message) : (action.text || '');
    return {
      echo: message,
      length: message.length,
      at: new Date().toISOString(),
      hint: '\u8fd9\u662f\u793a\u4f8b\u52a8\u4f5c echo_message \u7684\u8fd4\u56de\u503c\uff0c\u53ef\u636e\u6b64\u7f16\u5199\u4f60\u81ea\u5df1\u7684\u52a8\u4f5c',
    };
  }

  reg.register(ECHO_DEF, { execute: executeEcho });

  window.AgentActionExample = {
    DEFS: [ECHO_DEF],
  };
})();