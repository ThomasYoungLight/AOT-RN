'use strict';
// JS twin for the live-Fabric ring 0: the REAL react-reconciler (18.3.1) in
// persistence mode driving global.nativeFabricUIManager through the shared
// fabric host layer. The app binary registers the typed port under this
// module's content hash; when this module changes (OTA), this interpreted
// twin drives the very same live surface.
var React = require('react');
var Reconciler = require('react-reconciler');

var HostConfig = {
  supportsMutation: false,
  supportsPersistence: true,
  supportsHydration: false,
  isPrimaryRenderer: true,
  noTimeout: -1,
  scheduleTimeout: function () { return -1; },
  cancelTimeout: function () {},
  getRootHostContext: function () { return null; },
  getChildHostContext: function () { return null; },
  getPublicInstance: function (i) { return i; },
  prepareForCommit: function () { return null; },
  resetAfterCommit: function () {},
  preparePortalMount: function () {},
  createInstance: function (type, props, rootContainer, hostContext, handle) {
    return hcCreateInstance(type, props, handle);
  },
  createTextInstance: function (text, rootContainer, hostContext, handle) {
    return hcCreateTextInstance(text, handle);
  },
  appendInitialChild: function (p, c) { hcAppendChild(p, c); },
  finalizeInitialChildren: function () { return false; },
  prepareUpdate: function (inst, type, oldProps, newProps) {
    return diffHostProps(oldProps, newProps, inst);
  },
  shouldSetTextContent: function () { return false; },
  getCurrentEventPriority: function () { return 16; },
  getInstanceFromNode: function () { return null; },
  beforeActiveInstanceBlur: function () {},
  afterActiveInstanceBlur: function () {},
  prepareScopeUpdate: function () {},
  getInstanceFromScope: function () { return null; },
  detachDeletedInstance: function () {},
  // persistence
  cloneInstance: function (instance, updatePayload, type, oldProps, newProps, handle, keepChildren) {
    return hcCloneInstance(instance, updatePayload, type, newProps, keepChildren);
  },
  createContainerChildSet: function () { return hcCreateContainerChildSet(); },
  appendChildToContainerChildSet: function (childSet, child) { hcAppendChildToContainerChildSet(childSet, child); },
  finalizeContainerChildren: function (container, childSet) { hcFinalizeContainerChildren(container, childSet); },
  replaceContainerChildren: function (container, childSet) { hcReplaceContainerChildren(container, childSet); },
  cloneHiddenInstance: function (instance) { return instance; },
  cloneHiddenTextInstance: function (instance) { return instance; },
};

var R = null;
var appApi = null;
var rootHandle = null;

function start(env) {
  fhInit(env);
  R = Reconciler(HostConfig);
  appApi = installFabricApp({
    createElement: React.createElement,
    useState: React.useState,
    useCallback: React.useCallback,
    memo: React.memo,
  });
  var containerInfo = {containerTag: env.rootTag};
  rootHandle = R.createContainer(
    containerInfo, 0 /* LegacyRoot */, null, false, null, '',
    function (e) { env.log('[FabricTwin] recoverableError: ' + e); }, null
  );
  R.flushSync(function () {
    R.updateContainer(
      React.createElement(appApi.App, {
        banner: env.banner,
        insetTop: env.insetTop,
        insetBottom: env.insetBottom,
      }),
      rootHandle, null, null
    );
  });
  env.log('[FabricTwin] mounted: ' + fhStatsLine());
}

function measure(warmupTicks, ticks) {
  var flush = function (fn) { R.flushSync(fn); };
  runFabricMeasure(appApi.exposed, flush, warmupTicks);
  fhResetStats();
  var res = runFabricMeasure(appApi.exposed, flush, ticks);
  return {ms: res.ms, ticks: res.ticks, host: fhStatsLine()};
}

function tickOnce() {
  R.flushSync(function () {
    appApi.exposed.setTick(function (tk) { return tk + 1; });
  });
}

var responderSystem = createResponderSystem(function (fn) { R.flushSync(fn); }, null);

function dispatchTouch(target, eventType, nativeEvent) {
  responderSystem.handleEvent(target, eventType, nativeEvent);
}

module.exports = {
  impl: 'interpreted-real-react-18.3.1-fabric',
  start: start,
  measure: measure,
  tickOnce: tickOnce,
  dispatchTouch: dispatchTouch,
};
