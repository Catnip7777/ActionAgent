(() => {
  'use strict';

  const { register } = window.AgentActionRegistry;

  const ECHO_DEF = {
    type: 'echo_message',
    label: '回声（示例）',
    scope: 'custom',
    dangerous: false,
    desc: '【示例动作】将 message 原样返回，演示自定义动作注册方式',
    example: { type: 'echo_message', message: 'Hello from custom action' },
  };

  async function executeEcho(action, ctx) {
    const message = action.message ?? action.text ?? '';
    return { echo: message, length: message.length, at: new Date().toISOString(), hint: '这是示例动作 echo_message 的返回值' };
  }

  register(ECHO_DEF, { execute: executeEcho });
  window.AgentActionExample = { DEFS: [ECHO_DEF] };
})();
