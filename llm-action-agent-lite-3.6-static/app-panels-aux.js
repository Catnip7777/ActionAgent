(() => {
  'use strict';

  const core = window.__agentCore;
  if (!core) console.warn('app-panels-aux.js: dependencies missing');

  function readAllConfigFromUI() {
    const apiBase = document.getElementById('apiBaseUrl');
    if (!apiBase) return;
    const config = core.getConfig();
    config.apiBaseUrl = core.normalizeApiBaseUrl(apiBase.value.trim());
    config.apiKey = document.getElementById('apiKey').value.trim();
    config.modelName = document.getElementById('modelName').value.trim();
    config.temperature = parseFloat(document.getElementById('temperature').value);
    config.maxTokens = parseInt(document.getElementById('maxTokens').value, 10);
    config.backendUrl = document.getElementById('backendUrl').value.trim();
    config.backendToken = document.getElementById('backendToken').value.trim();
  }

  function populateSettingsUI() {
    const config = core.getConfig();
    const utils = window.__agentPanelsUtils;
    if (!utils) return;
    utils.setEl('apiBaseUrl', config.apiBaseUrl);
    utils.setEl('apiKey', config.apiKey);
    utils.setEl('modelName', config.modelName);
    utils.setEl('temperature', config.temperature);
    utils.setElText('temperatureValue', config.temperature);
    utils.setEl('maxTokens', config.maxTokens);
    utils.setEl('backendUrl', config.backendUrl);
    utils.setEl('backendToken', config.backendToken);
  }

  window.__agentPanelsAux = { readAllConfigFromUI, populateSettingsUI };
})();
