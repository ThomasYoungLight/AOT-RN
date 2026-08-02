// The concurrent workload + deterministic driver — shared verbatim by the
// real react-reconciler baseline (ConcurrentRoot) and the typed port.
// `RA` must provide createElement, useState, useEffect, useLayoutEffect,
// memo, useTransition, useDeferredValue.
// `ctl` (from the harness) drives the deterministic scheduler:
//   ctl.discrete(fn)  — run fn at discrete (sync-lane) priority
//   ctl.flushAll()    — drain the scheduler task queue
//   ctl.step(n)       — run ONE task with a yield budget of n work units
//   ctl.advance(ms)   — advance the frozen scheduler clock
//
// Three equivalence accumulators observe a run:
//   host checksum (host-config.inc.js) — committed mutation stream
//   fx — app-level render/effect/memo ordering (includes renders that are
//        later thrown away by an interruption: both reconcilers must
//        restart at the same points)
//   __schedTrace.sum — schedule/cancel/run/yield sequence

function installConcurrentApp(RA) {
  var h = RA.createElement;
  var exposed = mkObj();
  exposed.setQuery = null;
  exposed.setTicker = null;
  exposed.setCounter = null;
  exposed.applyMarks = null;
  var fx = mkObj();
  fx.sum = 0;
  exposed.fx = fx;
  var fxTrace = mkList();
  exposed.fxTrace = fxTrace;
  var fxTraceOn = anyVal(false);
  var gfx = anyVal(typeof globalThis !== 'undefined' ? globalThis : null);
  if (gfx !== null && gfx.__FX_TRACE !== undefined) {
    fxTraceOn = true;
  }
  function fxMix(n) {
    fx.sum = ((fx.sum * 31 + coerceInt(n)) | 0) >>> 0 | 0;
    if (fxTraceOn) {
      fxTrace.push(coerceInt(n));
    }
  }

  function makeItem(id, tag) {
    return {id: id, tag: tag};
  }

  // Synchronous thenable: resolution fires callbacks INLINE so pings and
  // retries land deterministically inside the driver's flush sequence.
  function makeSyncThenable() {
    var t = mkObj();
    t.status = 0;
    t.value = null;
    t.callbacks = mkList();
    t.then = function (onFulfilled, onRejected) {
      if (t.status === 1) {
        onFulfilled(t.value);
      } else {
        t.callbacks.push(onFulfilled);
      }
    };
    t.resolve = function (v) {
      if (t.status === 1) {
        return;
      }
      t.status = 1;
      t.value = v;
      var cbs = t.callbacks;
      t.callbacks = mkList();
      for (var ci = 0; ci < cbs.length; ci++) {
        cbs[ci](v);
      }
    };
    return t;
  }

  // suspense data resource for the lazy panel
  var panelData = mkObj();
  panelData.thenable = null;
  panelData.value = null;
  function readPanelData() {
    if (panelData.value !== null) {
      return panelData.value;
    }
    if (panelData.thenable === null) {
      panelData.thenable = makeSyncThenable();
    }
    throw panelData.thenable;
  }
  exposed.invalidatePanelData = function () {
    panelData.value = null;
    panelData.thenable = null;
  };
  exposed.resolvePanelData = function (v) {
    panelData.value = v;
    if (panelData.thenable !== null) {
      panelData.thenable.resolve(v);
    }
  };

  function PanelBody(props) {
    var data = readPanelData();
    fxMix(401);
    var depsL = mkList();
    depsL.push(data);
    RA.useLayoutEffect(function () {
      fxMix(402);
      return function () { fxMix(403); };
    }, depsL);
    var depsE = mkList();
    depsE.push(props.version);
    RA.useEffect(function () {
      fxMix(404);
      return function () { fxMix(405); };
    }, depsE);
    return h('view-panel', {id: -7, height: 40, v: props.version},
      h('text-panel', {id: -7, fontSize: 12}, 'panel ' + data + ' v' + props.version));
  }

  var panelLoadThenable = makeSyncThenable();
  exposed.resolvePanelModule = function () {
    var mod = mkObj();
    mod.default = PanelBody;
    panelLoadThenable.resolve(mod);
  };
  var LazyPanel = RA.lazy(function () {
    return panelLoadThenable;
  });

  // external store (useSyncExternalStore)
  var extStore = mkObj();
  extStore.value = 0;
  extStore.listeners = mkList();
  function storeSubscribe(cb) {
    extStore.listeners.push(cb);
    return function () {
      var idx = extStore.listeners.indexOf(cb);
      if (idx !== -1) {
        extStore.listeners.splice(idx, 1);
      }
    };
  }
  function storeGetSnapshot() {
    return extStore.value;
  }
  exposed.mutateStore = function (v) {
    extStore.value = v;
    var ls = extStore.listeners.slice();
    for (var li = 0; li < ls.length; li++) {
      ls[li]();
    }
  };
  // deliberately does NOT notify: only the pre-commit consistency check (or
  // the passive updateStoreInstance re-check) can catch this
  exposed.silentMutateStore = function (v) {
    extStore.value = v;
  };

  // NOT memoized and takes the transition-driven seed, so it re-renders
  // inside transition renders and pushes consistency checks there
  function StoreBadge(props) {
    var snap = RA.useSyncExternalStore(storeSubscribe, storeGetSnapshot);
    fxMix(4500 + coerceInt(snap));
    return h('view-store', {id: -9, s: snap, seed: props.seed, height: 18}, 'store ' + snap);
  }

  function Row(props) {
    fxMix(9);
    var depsE = mkList();
    depsE.push(props.marked);
    RA.useEffect(function () {
      fxMix(500 + props.id);
      return function () { fxMix(-(500 + props.id)); };
    }, depsE);
    return h('view-row', {id: props.id, marked: props.marked, height: 20},
      props.tag + props.id + (props.marked ? ' *' : ''));
  }
  var MemoRow = RA.memo(Row);

  function Preview(props) {
    fxMix(21);
    var depsP = mkList();
    depsP.push(props.dq);
    RA.useLayoutEffect(function () {
      fxMix(22);
      return function () { fxMix(23); };
    }, depsP);
    return h('view-preview', {id: -2, q: props.dq, height: 30}, 'preview ' + props.dq);
  }
  var MemoPreview = RA.memo(Preview);

  function StatusBar(props) {
    fxMix(25);
    return h('view-status', {id: -1, pending: props.pending, height: 24},
      'c' + props.counter + ' t' + props.ticker + ' e' + props.echo + (props.pending ? ' pending' : ''));
  }
  var MemoStatus = RA.memo(StatusBar);

  function App(props) {
    fxMix(7);
    var qs = RA.useState('');
    var query = qs[0];
    var setQuery = qs[1];
    var ks = RA.useState(0);
    var ticker = ks[0];
    var setTicker = ks[1];
    var cs = RA.useState(0);
    var counter = cs[0];
    var setCounter = cs[1];
    var ms = RA.useState(0);
    var markSeed = ms[0];
    var setMarkSeed = ms[1];
    var es = RA.useState(0);
    var echo = es[0];
    var setEcho = es[1];
    var rs = RA.useState(props.initialItems);
    var rows = rs[0];
    var setRows = rs[1];
    var sp = RA.useState(false);
    var showPanel = sp[0];
    var setShowPanel = sp[1];
    var pv = RA.useState(0);
    var panelVersion = pv[0];
    var setPanelVersion = pv[1];
    var tr = RA.useTransition();
    var isPending = tr[0];
    var startT = tr[1];
    var deferredQuery = RA.useDeferredValue(query);

    exposed.setQuery = setQuery;
    exposed.setTicker = setTicker;
    exposed.setCounter = setCounter;
    exposed.setShowPanel = setShowPanel;
    exposed.setPanelVersion = setPanelVersion;
    exposed.applyMarks = function (seed) {
      startT(function () {
        setMarkSeed(seed);
      });
    };
    // structural change inside a transition: placements/deletions must
    // survive interruption + restart without leaking into the host tree
    exposed.addRow = function (id, tag) {
      startT(function () {
        setRows(function (rw) {
          var next = rw.slice();
          var np = makeItem(id, tag);
          if (next.length >= 70) {
            next.pop();
          }
          next.unshift(np);
          return next;
        });
      });
    };
    exposed.bumpPanelT = function () {
      startT(function () {
        setPanelVersion(function (v) { return v + 1; });
      });
    };
    exposed.removeRow = function () {
      startT(function () {
        setRows(function (rw) {
          if (rw.length <= 40) {
            return rw;
          }
          var next = rw.slice();
          next.splice(5, 1);
          return next;
        });
      });
    };

    var depsQ = mkList();
    depsQ.push(query);
    RA.useEffect(function () {
      fxMix(31);
      return function () { fxMix(-32); };
    }, depsQ);

    var depsC = mkList();
    depsC.push(counter);
    RA.useLayoutEffect(function () {
      fxMix(33);
      return function () { fxMix(-34); };
    }, depsC);

    // passive-effect setState: exercises the passive flush scheduling a new
    // default-lane render (and the sync flush when the commit was discrete)
    var depsT = mkList();
    depsT.push(ticker);
    RA.useEffect(function () {
      fxMix(35);
      if (ticker > 0 && ticker % 7 === 3 && echo !== ticker) {
        setEcho(ticker);
      }
      return function () { fxMix(-36); };
    }, depsT);

    var items = rows;
    var children = mkList();
    children.push(h(MemoStatus, {
      key: 1000000,
      counter: counter,
      ticker: ticker,
      echo: echo,
      pending: isPending,
    }));
    children.push(h(MemoPreview, {key: 1000001, dq: deferredQuery}));
    children.push(h(StoreBadge, {key: 1000005, seed: markSeed}));
    if (showPanel) {
      children.push(h(RA.Suspense, {
        key: 1000002,
        fallback: h('view-ploading', {id: -8, height: 30}, 'loading panel\u2026'),
      }, h(LazyPanel, {version: panelVersion})));
    }
    for (var i = anyVal(0); i < items.length; i++) {
      var item = items[i];
      var marked = markSeed > 0 && (item.id * 31 + markSeed) % 5 === 0;
      children.push(h(MemoRow, {
        key: item.id,
        id: item.id,
        tag: item.tag,
        marked: marked,
      }));
    }
    return h('view-root', {flex: 1, direction: 'column'}, children);
  }

  return {App: App, exposed: exposed, makeItem: makeItem};
}

// ---- deterministic driver ----
function runConcurrentDriver(app, ctl, log) {
  var ROWS = anyVal(60);
  var WARMUP = anyVal(40);
  var TICKS = anyVal(800);
  var gdrv = anyVal(typeof globalThis !== 'undefined' ? globalThis : null);
  if (gdrv !== null && gdrv.__CC_TICKS !== undefined) {
    TICKS = coerceInt(gdrv.__CC_TICKS);
  }
  if (gdrv !== null && gdrv.__CC_WARMUP !== undefined) {
    WARMUP = coerceInt(gdrv.__CC_WARMUP);
  }
  var exposed = app.exposed;
  var makeItem = app.makeItem;

  var seed = anyVal(123456789);
  function rand(n) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  }

  var initialItems = mkList();
  for (var i = anyVal(0); i < ROWS; i++) {
    initialItems.push(makeItem(i + 1, 'item'));
  }
  var nextRowId = anyVal(ROWS + 1);

  function bumpCounter() {
    exposed.setCounter(function (c) { return c + 1; });
  }

  function interact(tick) {
    // deterministic concurrent-Suspense lifecycle (WARMUP=40; all in the
    // measured window)
    if (tick === 100) {
      // mount-suspend at default lane: fallback commits; the resolved module
      // retries and suspends on data (advance past the retry throttle);
      // second fallback commit; data resolves; content commits
      exposed.setShowPanel(function () { return true; });
      ctl.flushAll();
      exposed.resolvePanelModule();
      ctl.advance(600);
      ctl.flushAll();
      exposed.resolvePanelData('panel-1');
      ctl.advance(600);
      ctl.flushAll();
      ctl.advance(100);
      return;
    }
    if (tick === 200 || tick === 600) {
      // update-suspend at default lane: visible content gets hidden, so the
      // just-noticeable-difference delay applies; advance the clock into the
      // commit window before flushing
      exposed.invalidatePanelData();
      exposed.setPanelVersion(function (v) { return v + 1; });
      ctl.advance(119);
      ctl.flushAll();
      exposed.resolvePanelData(tick === 200 ? 'panel-2' : 'panel-3');
      ctl.advance(600);
      ctl.flushAll();
      ctl.advance(100);
      return;
    }
    if (tick === 300 || tick === 500) {
      // store tearing: the transition render reads a snapshot that CHANGED
      // since the last commit (so a consistency check is armed), then the
      // store mutates again while the render is yielded — the completed
      // concurrent render fails the pre-commit check and is re-rendered
      // synchronously
      exposed.applyMarks(tick % 79 + 1);
      ctl.step(40); // urgent isPending render (blocking, renders sync)
      exposed.silentMutateStore(tick % 11 + 1); // badge will read this...
      ctl.step(12); // ...in the transition render, which then yields
      exposed.silentMutateStore(tick % 11 + 2); // ...and this tears it
      ctl.flushAll();
      ctl.advance(100);
      return;
    }
    if (tick === 400) {
      // transition-suspend: a suspended transition never commits a fallback;
      // it waits (isPending stays true) until the data ping reschedules it
      exposed.invalidatePanelData();
      exposed.bumpPanelT();
      ctl.flushAll();
      exposed.resolvePanelData('panel-4');
      ctl.flushAll();
      ctl.advance(100);
      return;
    }
    if (tick === 700) {
      // unmount the whole suspense subtree (deletion effects incl. passive)
      exposed.setShowPanel(function () { return false; });
      ctl.flushAll();
      ctl.advance(100);
      return;
    }
    var r = rand(100);
    if (r < 18) {
      // discrete update: sync lane, flushed from the Immediate task
      ctl.discrete(bumpCounter);
      ctl.flushAll();
    } else if (r < 38) {
      // two default-lane updates in one event: automatic batching, one
      // concurrent render run to completion
      exposed.setTicker(tick);
      exposed.setQuery('q' + (tick % 23));
      ctl.flushAll();
    } else if (r < 54) {
      // sliced default render interrupted mid-flight by a discrete update:
      // sync render preempts (skipping the default update -> rebase), then
      // the default render restarts and applies both
      exposed.setTicker(tick + 100000);
      ctl.step(7);
      ctl.discrete(bumpCounter);
      ctl.flushAll();
    } else if (r < 70) {
      // urgent query + transition marks in the same event: urgent render
      // (isPending flips, preview deferred) then transition render
      exposed.setQuery('s' + (tick % 19));
      exposed.applyMarks(tick % 97 + 1);
      ctl.flushAll();
    } else if (r < 80) {
      // two transitions in the same event share one transition lane; the
      // second one is structural (placement/deletion)
      exposed.applyMarks(tick % 89 + 1);
      if (tick % 3 === 0) {
        exposed.removeRow();
      } else {
        exposed.addRow(nextRowId++, 'new');
      }
      ctl.flushAll();
    } else if (r < 90) {
      // transition render interrupted by a discrete update: the urgent
      // pending render commits first, the transition render restarts after
      // the sync commit. Alternate marks-only and structural transitions so
      // thrown-away placements/deletions are exercised.
      if (tick % 2 === 0) {
        exposed.applyMarks(tick % 83 + 1);
      } else {
        exposed.addRow(nextRowId++, 'mid');
      }
      ctl.step(40); // finish the urgent isPending render (blocking lanes render sync)
      ctl.step(3); // start the transition render, yield after 3 units
      ctl.discrete(bumpCounter);
      ctl.flushAll();
    } else {
      // urgent query change alone: preview lags one render behind
      // (useDeferredValue spawns a transition-lane catch-up render);
      // every other time, also a notifying external-store update
      exposed.setQuery('qq' + (tick % 31));
      if (tick % 2 === 0) {
        exposed.mutateStore(tick % 13);
      }
      ctl.flushAll();
    }
    ctl.advance(100);
  }

  return {
    initialItems: initialItems,
    warmup: function () {
      for (var w = anyVal(0); w < WARMUP; w++) {
        interact(w);
      }
    },
    run: function () {
      exposed.fx.sum = 0;
      var t0 = anyVal(Date.now());
      for (var t = anyVal(0); t < TICKS; t++) {
        interact(t + WARMUP);
      }
      var out = mkObj();
      out.ms = Date.now() - t0;
      out.ticks = TICKS;
      out.rows = ROWS;
      out.fx = exposed.fx.sum;
      out.trace = exposed.fxTrace;
      return out;
    },
  };
}
