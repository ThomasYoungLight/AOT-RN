'use strict';
// Baseline driver: the REAL react-reconciler (npm) running the shared feed
// app against the shared recording host config.
var React = require('react');
var Reconciler = require('react-reconciler');

var log = typeof print !== 'undefined' ? print : console.log;

var HostConfig = {
  supportsMutation: true,
  supportsPersistence: false,
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
  appendChild: function (p, c) { hcAppendChild(p, c); },
  appendChildToContainer: function (ctr, c) { hcAppendChild(ctr, c); },
  insertBefore: function (p, c, b) { hcInsertBefore(p, c, b); },
  insertInContainerBefore: function (ctr, c, b) { hcInsertBefore(ctr, c, b); },
  removeChild: function (p, c) { hcRemoveChild(p, c); },
  removeChildFromContainer: function (ctr, c) { hcRemoveChild(ctr, c); },
  resetTextContent: function () {},
  commitTextUpdate: function (i, o, n) { hcCommitTextUpdate(i, o, n); },
  commitMount: function () {},
  commitUpdate: function (inst, payload, type, oldProps, newProps) { hcCommitUpdate(inst, payload, newProps); },
  hideInstance: function () {},
  unhideInstance: function () {},
  hideTextInstance: function () {},
  unhideTextInstance: function () {},
  clearContainer: function (c) { c.children = []; },
  detachDeletedInstance: function () {},
  getCurrentEventPriority: function () { return 16; }, // DefaultEventPriority
  getInstanceFromNode: function () { return null; },
  beforeActiveInstanceBlur: function () {},
  afterActiveInstanceBlur: function () {},
  prepareScopeUpdate: function () {},
  getInstanceFromScope: function () { return null; },
};

var R = Reconciler(HostConfig);

var appApi = installFeedApp({
  createElement: React.createElement,
  useState: React.useState,
  useCallback: React.useCallback,
  memo: React.memo,
});

var driver = runFeedDriver(appApi, function (fn) { R.flushSync(fn); }, log);

var rootContainer = {id: 0, type: 'root', children: []};
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

driver.warmup();
hostStatsReset();

var gcs0 = (typeof HermesInternal !== 'undefined' && HermesInternal.getInstrumentedStats)
  ? HermesInternal.getInstrumentedStats() : null;
var res = driver.run();

log('real-react-reconciler(18.3.1): ' + res.ticks + ' interactions, ' + res.posts + ' posts');
log(hostStatsLine());
log('TOTAL: ' + res.ms + ' ms  (' + (res.ms / res.ticks).toFixed(4) + ' ms/interaction)');
if (gcs0 !== null) {
  var gcs1 = HermesInternal.getInstrumentedStats();
  log('GC: numGCs=' + (gcs1.js_numGCs - gcs0.js_numGCs) +
    ' gcTime=' + (1000 * (gcs1.js_gcTime - gcs0.js_gcTime)).toFixed(1) + 'ms' +
    ' allocated=' + ((gcs1.js_totalAllocatedBytes - gcs0.js_totalAllocatedBytes) / 1048576).toFixed(1) + 'MB');
}
