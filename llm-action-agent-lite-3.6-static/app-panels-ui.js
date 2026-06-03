(() => {
  'use strict';

  function getFn(namespace, fnName) {
    const ns = window[namespace];
    return (ns && typeof ns[fnName] === 'function') ? ns[fnName] : function() { console.warn(namespace + '.' + fnName + ' not available'); };
  }

  window.__agentPanels = {
    get setEl() { return getFn('__agentPanelsUtils', 'setEl'); },
    get setElText() { return getFn('__agentPanelsUtils', 'setElText'); },
    get setChecked() { return getFn('__agentPanelsUtils', 'setChecked'); },
    get checkBackendStatus() { return getFn('__agentPanelsUtils', 'checkBackendStatus'); },
    get setSidebarCollapsed() { return getFn('__agentPanelsUtils', 'setSidebarCollapsed'); },
    get bindAutoSave() { return getFn('__agentPanelsUtils', 'bindAutoSave'); },
    get bindTitleEdit() { return getFn('__agentPanelsUtils', 'bindTitleEdit'); },
    get getHandle() { return getFn('__agentPanelsWorkspace', 'getHandle'); },
    get getBrowserHandleForWorkspace() { return getFn('__agentPanelsWorkspace', 'getBrowserHandleForWorkspace'); },
    get renderWorkspacePanel() { return getFn('__agentPanelsWorkspace', 'renderWorkspacePanel'); },
    get restoreWorkspace() { return getFn('__agentPanelsWorkspace', 'restoreWorkspace'); },
    get renderConversationList() { return getFn('__agentPanelsConv', 'renderConversationList'); },
    get setActiveConversation() { return getFn('__agentPanelsConv', 'setActiveConversation'); },
    get deleteConversationById() { return getFn('__agentPanelsConv', 'deleteConversationById'); },
    get initConversations() { return getFn('__agentPanelsConv', 'initConversations'); },
    get readAllConfigFromUI() { return getFn('__agentPanelsAux', 'readAllConfigFromUI'); },
    get populateSettingsUI() { return getFn('__agentPanelsAux', 'populateSettingsUI'); },
  };
})();
