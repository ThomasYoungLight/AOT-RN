'use strict';
// Concurrent baseline driver: the REAL react-reconciler (npm) on a
// ConcurrentRoot, pumped by the deterministic scheduler (det-scheduler.cjs,
// aliased over `scheduler` at bundle time), running the shared concurrent
// workload against the shared recording host config.
var React = require('react');
var Reconciler = require('react-reconciler');

var log = typeof print !== 'undefined' ? print : console.log;
var g = globalThis;

var HostConfig = {
  supportsMutation: false,
  supportsPersistence: true,
  supportsHydration: false,
  isPrimaryRenderer: true,
  noTimeout: -1,
  scheduleTimeout: function () { g.__timeouts = (g.__timeouts || 0) + 1; return -1; },
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
  getCurrentEventPriority: function () { return 16; }, // DefaultEventPriority
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
  cloneHiddenInstance: function (instance, type, props, handle) {
    return hcCloneHiddenInstance(instance, type, props);
  },
  cloneHiddenTextInstance: function (instance, text, handle) {
    return hcCloneHiddenTextInstance(instance, text);
  },
};

var R = Reconciler(HostConfig);

var appApi = installConcurrentApp({
  createElement: React.createElement,
  useState: React.useState,
  useEffect: React.useEffect,
  useLayoutEffect: React.useLayoutEffect,
  memo: React.memo,
  useTransition: React.useTransition,
  useDeferredValue: React.useDeferredValue,
  lazy: React.lazy,
  Suspense: React.Suspense,
  useSyncExternalStore: React.useSyncExternalStore,
});

var ctl = {
  discrete: function (fn) { R.discreteUpdates(fn); },
  flushAll: function () { g.__sched.flushAll(); },
  step: function (n) { g.__sched.flushOne(n); },
  advance: function (ms) { g.__sched.advance(ms); },
};

var driver = runConcurrentDriver(appApi, ctl, log);

var rootContainer = {id: 0, type: 'root', children: []};
var root = R.createContainer(
  rootContainer, 1 /* ConcurrentRoot */, null, false, null, '',
  function (e) { log('recoverableError: ' + e); }, null
);
R.updateContainer(
  React.createElement(appApi.App, {initialItems: driver.initialItems}),
  root, null, null
);
ctl.flushAll();

driver.warmup();
hostStatsReset();
g.__schedTrace.sum = 0;

var gcs0 = (typeof HermesInternal !== 'undefined' && HermesInternal.getInstrumentedStats)
  ? HermesInternal.getInstrumentedStats() : null;
var res = driver.run();

log('real-react-reconciler-concurrent-persistent(18.3.1): ' + res.ticks + ' interactions, ' + res.rows + ' rows');
log(hostStatsLine() + ' fx=' + res.fx + ' sched=' + (g.__schedTrace.sum >>> 0));
log('hostTimeouts: ' + (g.__timeouts || 0));
log('schedStats: schedules=' + g.__schedTrace.schedules + ' cancels=' + g.__schedTrace.cancels +
  ' runs=' + g.__schedTrace.runs + ' continuations=' + g.__schedTrace.continuations +
  ' yields=' + g.__schedTrace.yields);
log('TOTAL: ' + res.ms + ' ms  (' + (res.ms / res.ticks).toFixed(4) + ' ms/interaction)');
if (gcs0 !== null) {
  var gcs1 = HermesInternal.getInstrumentedStats();
  log('GC: numGCs=' + (gcs1.js_numGCs - gcs0.js_numGCs) +
    ' gcTime=' + (1000 * (gcs1.js_gcTime - gcs0.js_gcTime)).toFixed(1) + 'ms' +
    ' allocated=' + ((gcs1.js_totalAllocatedBytes - gcs0.js_totalAllocatedBytes) / 1048576).toFixed(1) + 'MB');
}
