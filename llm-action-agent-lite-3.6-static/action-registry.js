(() => {
  'use strict';

  const defs = [];
  const handlers = new Map();
  const fileTypes = new Set();
  const backendTypes = new Set();
  const dangerousTypes = new Set();

  function register(actionDef, options = {}) {
    if (!actionDef?.type) throw new Error('动作缺少 type');
    defs.push(actionDef);
    if (typeof options.execute === 'function') {
      handlers.set(actionDef.type, options.execute);
    }
    if (options.file) fileTypes.add(actionDef.type);
    if (options.backend) backendTypes.add(actionDef.type);
    if (options.dangerous || actionDef.dangerous) dangerousTypes.add(actionDef.type);
  }

  function getDefs() {
    return defs.slice();
  }

  function getHandler(type) {
    return handlers.get(type);
  }

  window.AgentActionRegistry = {
    register,
    getDefs,
    getHandler,
    fileTypes,
    backendTypes,
    dangerousTypes,
  };
})();
