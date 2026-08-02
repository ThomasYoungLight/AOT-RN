'use strict';
// JS twin for the RN hybrid ring 0: the REAL react-reconciler running the
// shared feed benchmark, exposed as a Metro module {impl, run}. This is what
// the bundle carries; the app binary registers the typed port under this
// module's content hash.
var React = require('react');
var Reconciler = require('react-reconciler');

var HostConfig = {
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: false,
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
  hideInstance: function (i) { hcHideInstance(i); },
  unhideInstance: function (i, p) { hcUnhideInstance(i, p); },
  hideTextInstance: function (i) { hcHideTextInstance(i); },
  unhideTextInstance: function (i, t) { hcUnhideTextInstance(i, t); },
  clearContainer: function (c) { c.children = mkList(); },
  detachDeletedInstance: function () {},
  getCurrentEventPriority: function () { return 16; },
  getInstanceFromNode: function () { return null; },
  beforeActiveInstanceBlur: function () {},
  afterActiveInstanceBlur: function () {},
  prepareScopeUpdate: function () {},
  getInstanceFromScope: function () { return null; },
};

function runBenchmark() {
  hcResetAll();
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
    useInsertionEffect: React.useInsertionEffect,
    forwardRef: React.forwardRef,
    lazy: React.lazy,
    Suspense: React.Suspense,
  });
  var flushPassive = function () { R.flushPassiveEffects(); };
  var driver = runFeedDriver(appApi, function (fn) { R.flushSync(fn); }, flushPassive, null);
  var rootContainer = {id: 0, type: 'root', children: mkList()};
  var root = R.createContainer(
    rootContainer, 0 /* LegacyRoot */, null, false, null, '',
    function () {}, null
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
  var res = driver.run();
  return {
    label: 'real-react-reconciler(18.3.1)',
    ms: res.ms,
    ticks: res.ticks,
    posts: res.posts,
    host: hostStatsLine() + ' fx=' + res.fx,
  };
}

module.exports = {impl: 'interpreted-real-react-18.3.1', run: runBenchmark};
