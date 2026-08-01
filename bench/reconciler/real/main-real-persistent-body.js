'use strict';
// Persistence-mode baseline: the REAL react-reconciler with a Fabric-shaped
// host config (clone-based instances + container child sets), same feed app.
var React = require('react');
var Reconciler = require('react-reconciler');

var log = typeof print !== 'undefined' ? print : console.log;

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
  createInstance: function (type, props) { return hcCreateInstance(type, props); },
  createTextInstance: function (text) { return hcCreateTextInstance(text); },
  appendInitialChild: function (p, c) { hcAppendChild(p, c); },
  finalizeInitialChildren: function () { return false; },
  prepareUpdate: function (inst, type, oldProps, newProps) { return diffHostProps(oldProps, newProps); },
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

var R = Reconciler(HostConfig);

var appApi = installFeedApp({
  createElement: React.createElement,
  useState: React.useState,
  useCallback: React.useCallback,
  memo: React.memo,
  useReducer: React.useReducer,
  useMemo: React.useMemo,
  useRef: React.useRef,
  useEffect: React.useEffect,
  useLayoutEffect: React.useLayoutEffect,
  createContext: React.createContext,
  useContext: React.useContext,
});
var flushPassive = function () { R.flushPassiveEffects(); };

var driver = runFeedDriver(appApi, function (fn) { R.flushSync(fn); }, flushPassive, log);

var rootContainer = {id: 0, type: 'root', children: mkList()};
var root = R.createContainer(
  rootContainer, 0 /* LegacyRoot */, null, false, null, '',
  function (e) { log('recoverableError: ' + e); }, null
);
R.flushSync(function () {
  R.updateContainer(
    React.createElement(appApi.App, {initialPosts: driver.initialPosts}),
    root, null, null
  );
});

flushPassive();

driver.warmup();
hostStatsReset();

var gcs0 = (typeof HermesInternal !== 'undefined' && HermesInternal.getInstrumentedStats)
  ? HermesInternal.getInstrumentedStats() : null;
var res = driver.run();

log('real-react-reconciler-persistent(18.3.1): ' + res.ticks + ' interactions, ' + res.posts + ' posts');
log(hostStatsLine() + ' fx=' + res.fx);
log('TOTAL: ' + res.ms + ' ms  (' + (res.ms / res.ticks).toFixed(4) + ' ms/interaction)');
if (gcs0 !== null) {
  var gcs1 = HermesInternal.getInstrumentedStats();
  log('GC: numGCs=' + (gcs1.js_numGCs - gcs0.js_numGCs) +
    ' gcTime=' + (1000 * (gcs1.js_gcTime - gcs0.js_gcTime)).toFixed(1) + 'ms' +
    ' allocated=' + ((gcs1.js_totalAllocatedBytes - gcs0.js_totalAllocatedBytes) / 1048576).toFixed(1) + 'MB');
}
