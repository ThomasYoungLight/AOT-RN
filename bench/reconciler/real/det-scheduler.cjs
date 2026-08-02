'use strict';
// Deterministic drop-in replacement for the `scheduler` package (esbuild
// --alias). Three properties make concurrent React reproducible under it:
//   1. Frozen clock: unstable_now() only advances when the driver calls
//      __sched.advance(ms). No wall-clock leaks into lane expiration,
//      fallback throttling, or render-target times.
//   2. Explicit pump: tasks run only from __sched.flushOne(budget)/flushAll().
//      Ordering is (expirationTime, taskId) — identical to the real
//      scheduler's min-heap under a frozen clock.
//   3. Yield budget: unstable_shouldYield() returns true after `budget`
//      calls, so workLoopConcurrent yields at driver-chosen unit counts.
// Every observable scheduler event feeds __schedTrace.sum, a rolling
// checksum: equal sums on the real reconciler and the typed port mean the
// schedule/cancel/run/yield sequences — including per-render work-unit
// counts — are identical, not just the committed host trees.
var g = globalThis;

var S = {
  now: 0,
  idCounter: 0,
  tasks: [],
  yieldBudget: 1000000000,
};

g.__schedTrace = g.__schedTrace || {sum: 0, schedules: 0, cancels: 0, runs: 0, continuations: 0, yields: 0};
function trMix(n) {
  var t = g.__schedTrace;
  t.sum = ((t.sum * 31 + (n | 0)) | 0) >>> 0 | 0;
}

var ImmediatePriority = 1;
var UserBlockingPriority = 2;
var NormalPriority = 3;
var LowPriority = 4;
var IdlePriority = 5;

// Same timeouts as scheduler/src/forks/Scheduler.js
function timeoutForPriority(priorityLevel) {
  switch (priorityLevel) {
    case ImmediatePriority:
      return -1;
    case UserBlockingPriority:
      return 250;
    case LowPriority:
      return 10000;
    case IdlePriority:
      return 1073741823; // maxSigned31BitInt
    default:
      return 5000;
  }
}

function insertTask(task) {
  var arr = S.tasks;
  var i = arr.length;
  while (i > 0) {
    var prev = arr[i - 1];
    if (prev.sortIndex < task.sortIndex || (prev.sortIndex === task.sortIndex && prev.id < task.id)) {
      break;
    }
    i--;
  }
  arr.splice(i, 0, task);
}

function dropCancelledHead() {
  while (S.tasks.length > 0 && S.tasks[0].callback === null) {
    S.tasks.shift();
  }
}

exports.unstable_ImmediatePriority = ImmediatePriority;
exports.unstable_UserBlockingPriority = UserBlockingPriority;
exports.unstable_NormalPriority = NormalPriority;
exports.unstable_LowPriority = LowPriority;
exports.unstable_IdlePriority = IdlePriority;

exports.unstable_now = function () {
  return S.now;
};

exports.unstable_scheduleCallback = function (priorityLevel, callback) {
  var id = ++S.idCounter;
  var expirationTime = S.now + timeoutForPriority(priorityLevel);
  var task = {
    id: id,
    callback: callback,
    priorityLevel: priorityLevel,
    expirationTime: expirationTime,
    sortIndex: expirationTime,
  };
  insertTask(task);
  g.__schedTrace.schedules++;
  trMix(11);
  trMix(priorityLevel);
  trMix(id);
  return task;
};

exports.unstable_cancelCallback = function (task) {
  g.__schedTrace.cancels++;
  trMix(12);
  trMix(task.id);
  task.callback = null;
};

exports.unstable_shouldYield = function () {
  g.__schedTrace.yields++;
  trMix(15);
  S.yieldBudget--;
  return S.yieldBudget <= 0;
};

exports.unstable_requestPaint = function () {};
exports.unstable_getCurrentPriorityLevel = function () {
  return NormalPriority;
};
exports.unstable_forceFrameRate = function () {};

g.__sched = {
  advance: function (ms) {
    S.now += ms;
  },
  now: function () {
    return S.now;
  },
  hasTasks: function () {
    dropCancelledHead();
    return S.tasks.length > 0;
  },
  // Run one task invocation with the given yield budget (unlimited if
  // omitted). A continuation keeps the task queued at its original
  // (sortIndex, id) — the real scheduler's behavior.
  flushOne: function (budget) {
    dropCancelledHead();
    if (S.tasks.length === 0) {
      return false;
    }
    var task = S.tasks[0];
    S.yieldBudget = budget === undefined || budget === null ? 1000000000 : budget;
    var didTimeout = task.expirationTime <= S.now;
    var callback = task.callback;
    task.callback = null;
    g.__schedTrace.runs++;
    trMix(13);
    trMix(task.id);
    trMix(didTimeout ? 1 : 0);
    var continuation = callback(didTimeout);
    if (typeof continuation === 'function') {
      task.callback = continuation;
      g.__schedTrace.continuations++;
      trMix(14);
      trMix(task.id);
      trMix(1);
    } else {
      if (S.tasks[0] === task) {
        S.tasks.shift();
      }
      trMix(14);
      trMix(task.id);
      trMix(0);
    }
    dropCancelledHead();
    return S.tasks.length > 0;
  },
  flushAll: function () {
    var guard = 0;
    while (g.__sched.flushOne(undefined)) {
      if (++guard > 1000000) {
        throw new Error('det-scheduler: flushAll did not drain');
      }
    }
  },
  reset: function () {
    S.now = 0;
    S.idCounter = 0;
    S.tasks = [];
    S.yieldBudget = 1000000000;
    g.__schedTrace.sum = 0;
  },
};
