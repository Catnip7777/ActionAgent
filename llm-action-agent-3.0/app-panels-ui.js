(() => {
  'use strict';

  // ============================================================
  // Panels UI Module - Aggregator
  // Directly references functions from window.__agentPanels*
  // This ensures resilience even if sub-modules load with delay
  // ============================================================

  // Helper: safely get function from namespace
  function getFn(namespace, fnName) {
    const ns = window[namespace];
    return (ns && typeof ns[fnName] === 'function') ? ns[fnName] : function() { console.warn(namespace + '.' + fnName + ' not available'); };
  }

  window.__agentPanels = {
    // ── Utils (from window.__agentPanelsUtils) ──
    get setEl() { return getFn('__agentPanelsUtils', 'setEl'); },
    get setElText() { return getFn('__agentPanelsUtils', 'setElText'); },
    get setChecked() { return getFn('__agentPanelsUtils', 'setChecked'); },
    get insertIntoChatInput() { return getFn('__agentPanelsUtils', 'insertIntoChatInput'); },
    get updateFormatUI() { return getFn('__agentPanelsUtils', 'updateFormatUI'); },
    get checkBackendStatus() { return getFn('__agentPanelsUtils', 'checkBackendStatus'); },
    get setSidebarCollapsed() { return getFn('__agentPanelsUtils', 'setSidebarCollapsed'); },
    get bindAutoSave() { return getFn('__agentPanelsUtils', 'bindAutoSave'); },
    get bindTitleEdit() { return getFn('__agentPanelsUtils', 'bindTitleEdit'); },
    get backendWasOnline() { const u = window.__agentPanelsUtils; return u ? u.backendWasOnline : false; },
    set backendWasOnline(v) { const u = window.__agentPanelsUtils; if (u) u.backendWasOnline = v; },

    // ── Actions (from window.__agentPanelsAux) ──
    get renderActionCards() { return getFn('__agentPanelsAux', 'renderActionCards'); },

    // ── Workspace (from window.__agentPanelsWorkspace) ──
    get getHandle() { return getFn('__agentPanelsWorkspace', 'getHandle'); },
    get getBrowserHandleForWorkspace() { return getFn('__agentPanelsWorkspace', 'getBrowserHandleForWorkspace'); },
    get renderWorkspacePanel() { return getFn('__agentPanelsWorkspace', 'renderWorkspacePanel'); },
    get renderWorkspaceListUI() { return getFn('__agentPanelsWorkspace', 'renderWorkspaceListUI'); },
    get readWorkspaceFormIntoActive() { return getFn('__agentPanelsWorkspace', 'readWorkspaceFormIntoActive'); },
    get renderWorkspaceEditor() { return getFn('__agentPanelsWorkspace', 'renderWorkspaceEditor'); },
    get renderWorkspaceStatus() { return getFn('__agentPanelsWorkspace', 'renderWorkspaceStatus'); },
    get restoreWorkspace() { return getFn('__agentPanelsWorkspace', 'restoreWorkspace'); },
    get pickWorkspace() { return getFn('__agentPanelsWorkspace', 'pickWorkspace'); },
    get renderFileTree() { return getFn('__agentPanelsWorkspace', 'renderFileTree'); },
    get setActiveWorkspaceId() { return getFn('__agentPanelsWorkspace', 'setActiveWorkspaceId'); },
    get addWorkspaceEntry() { return getFn('__agentPanelsWorkspace', 'addWorkspaceEntry'); },

    // ── Conversation (from window.__agentPanelsConv) ──
    get renderConversationList() { return getFn('__agentPanelsConv', 'renderConversationList'); },
    get setActiveConversation() { return getFn('__agentPanelsConv', 'setActiveConversation'); },
    get deleteConversationById() { return getFn('__agentPanelsConv', 'deleteConversationById'); },
    get initConversations() { return getFn('__agentPanelsConv', 'initConversations'); },

    // ── Auxiliary (from window.__agentPanelsAux) ──
    get readAllConfigFromUI() { return getFn('__agentPanelsAux', 'readAllConfigFromUI'); },
    get populateSettingsUI() { return getFn('__agentPanelsAux', 'populateSettingsUI'); },
    get renderPromptPanelUI() { return getFn('__agentPanelsAux', 'renderPromptPanelUI'); },
    get selectPrompt() { return getFn('__agentPanelsAux', 'selectPrompt'); },
    get fillPromptEditor() { return getFn('__agentPanelsAux', 'fillPromptEditor'); },
    get readPromptEditorIntoConfig() { return getFn('__agentPanelsAux', 'readPromptEditorIntoConfig'); },
    get applySelectedPrompt() { return getFn('__agentPanelsAux', 'applySelectedPrompt'); },
    get newPromptFromUI() { return getFn('__agentPanelsAux', 'newPromptFromUI'); },
    get duplicatePromptFromUI() { return getFn('__agentPanelsAux', 'duplicatePromptFromUI'); },
    get savePromptFromUI() { return getFn('__agentPanelsAux', 'savePromptFromUI'); },
    get deletePromptFromUI() { return getFn('__agentPanelsAux', 'deletePromptFromUI'); },
    get updatePromptPanelStatus() { return getFn('__agentPanelsAux', 'updatePromptPanelStatus'); },
    get renderPromptList() { return getFn('__agentPanelsAux', 'renderPromptList'); },
    get refreshPluginCache() { return getFn('__agentPanelsAux', 'refreshPluginCache'); },
    get renderPluginPanelUI() { return getFn('__agentPanelsAux', 'renderPluginPanelUI'); },
    get selectPluginForEdit() { return getFn('__agentPanelsAux', 'selectPluginForEdit'); },
    get clearPluginEditor() { return getFn('__agentPanelsAux', 'clearPluginEditor'); },
    get savePluginFromUI() { return getFn('__agentPanelsAux', 'savePluginFromUI'); },
    get deletePluginFromUI() { return getFn('__agentPanelsAux', 'deletePluginFromUI'); },
    get refreshMemoryCache() { return getFn('__agentPanelsAux', 'refreshMemoryCache'); },
    get renderMemoryPanelUI() { return getFn('__agentPanelsAux', 'renderMemoryPanelUI'); },
    get selectMemoryForEdit() { return getFn('__agentPanelsAux', 'selectMemoryForEdit'); },
    get clearMemoryEditor() { return getFn('__agentPanelsAux', 'clearMemoryEditor'); },
    get saveMemoryFromUI() { return getFn('__agentPanelsAux', 'saveMemoryFromUI'); },
    get deleteMemoryFromUI() { return getFn('__agentPanelsAux', 'deleteMemoryFromUI'); },
    get migrateLegacyMemory() { return getFn('__agentPanelsAux', 'migrateLegacyMemory'); },
    get renderLogs() { return getFn('__agentPanelsAux', 'renderLogs'); },
    get clearLogs() { return getFn('__agentPanelsAux', 'clearLogs'); },
    get openChatAttachPanel() { return getFn('__agentPanelsAux', 'openChatAttachPanel'); },
    get closeChatAttachPanel() { return getFn('__agentPanelsAux', 'closeChatAttachPanel'); },
    get handleAttachToInput() { return getFn('__agentPanelsAux', 'handleAttachToInput'); },
    get handleAttachRunNow() { return getFn('__agentPanelsAux', 'handleAttachRunNow'); },
    get toggleManualActionPanel() { return getFn('__agentPanelsAux', 'toggleManualActionPanel'); },
    get runManualActionFromPanel() { return getFn('__agentPanelsAux', 'runManualActionFromPanel'); },
    get populateManualActionSelect() { return getFn('__agentPanelsAux', 'populateManualActionSelect'); },
    get fillManualActionExample() { return getFn('__agentPanelsAux', 'fillManualActionExample'); },
  };
})();
