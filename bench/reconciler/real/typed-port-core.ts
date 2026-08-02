// Typed port of the react-reconciler (18.3.1) hot path — shermes -typed.
// Structures and control flow follow the React source: ReactFiber,
// ReactFiberBeginWork, ReactFiberCompleteWork, ReactFiberCommitWork,
// ReactChildFiber, ReactFiberHooks, ReactFiberWorkLoop. Reduced feature set:
// FunctionComponent, SimpleMemoComponent, HostRoot, HostComponent, HostText;
// useState/useCallback; sync lane only; mutation mode. Equivalence with the
// real reconciler is asserted on the recording host config's op counts and
// rolling checksum.

// ---- work tags ----
const FunctionComponent = 0;
const HostRoot = 3;
const HostComponent = 5;
const HostText = 6;
const Fragment = 7;
const ContextProvider = 10;
const ForwardRef = 11;
const SuspenseComponent = 13;
const MemoComponent = 14;
const SimpleMemoComponent = 15;
const LazyComponent = 16;
const OffscreenComponent = 22;

// ---- flags ----
const NoFlags = 0;
const Placement = 2;
const Update = 4;
const ChildDeletion = 16;
const DidCapture = 128;
const Ref = 512;
const Passive = 2048;
const Visibility = 8192;
const Incomplete = 32768;
const ShouldCapture = 65536;
const ForceUpdateForLegacySuspense = 131072;
const HostEffectMask = 32767;
const MutationMask = Placement | Update | ChildDeletion | Ref | Visibility;
const LayoutMask = Update | Ref | Visibility;
const PassiveMask = Passive | ChildDeletion;
const LifecycleEffectMask = Passive | Update | Ref;

// ---- hook effect tags (HookFlags) ----
const HookHasEffect = 1;
const HookInsertion = 2;
const HookLayout = 4;
const HookPassive = 8;

// ---- lanes ----
// ---- lanes (ReactFiberLane, 18.3.1 bit values) ----
const TotalLanes = 31;
const NoLanes = 0;
const NoLane = 0;
const SyncLane = 1;
const InputContinuousHydrationLane = 2;
const InputContinuousLane = 4;
const DefaultHydrationLane = 8;
const DefaultLane = 16;
const TransitionHydrationLane = 32;
const TransitionLane1 = 64;
const TransitionLanes = 4194240;
const RetryLane1 = 4194304;
const RetryLanes = 130023424;
const SelectiveHydrationLane = 134217728;
const NonIdleLanes = 268435455;
const IdleHydrationLane = 268435456;
const IdleLane = 536870912;
const OffscreenLane = 1073741824;
const NoTimestamp = -1;

// ---- fiber mode / root tags ----
const NoMode = 0;
const ConcurrentMode = 1;
const LegacyRoot = 0;
const ConcurrentRoot = 1;

// ---- event priorities (opaque: lanes) ----
const DiscreteEventPriority = SyncLane;
const ContinuousEventPriority = InputContinuousLane;
const DefaultEventPriority = DefaultLane;
const IdleEventPriority = IdleLane;

// ---- execution context ----
const NoContext = 0;
const BatchedContext = 1;
const RenderContext = 2;
const CommitContext = 4;

// ---- root exit status ----
const RootInProgress = 0;
const RootFatalErrored = 1;
const RootErrored = 2;
const RootSuspended = 3;
const RootSuspendedWithDelay = 4;
const RootCompleted = 5;
const RootDidNotComplete = 6;

// ---- scheduler priorities (Scheduler.js) ----
const ImmediateSchedPriority = 1;
const UserBlockingSchedPriority = 2;
const NormalSchedPriority = 3;
const IdleSchedPriority = 5;

// ---- pure lane math ----
function getHighestPriorityLane(lanes: number): number {
  return lanes & -lanes;
}

function getHighestPriorityLanes(lanes: number): number {
  const lane = getHighestPriorityLane(lanes);
  if ((lane & TransitionLanes) !== NoLanes) {
    return lanes & TransitionLanes;
  }
  if ((lane & RetryLanes) !== NoLanes) {
    return lanes & RetryLanes;
  }
  // all other lanes render alone
  return lane;
}

function pickArbitraryLaneIndex(lanes: number): number {
  // 31 - clz32(lanes) without clz32
  let idx = 0;
  let l = lanes >>> 1;
  while (l !== 0) {
    l = l >>> 1;
    idx = idx + 1;
  }
  return idx;
}

function laneToIndex(lane: number): number {
  return pickArbitraryLaneIndex(lane);
}

function includesSomeLane(a: number, b: number): boolean {
  return (a & b) !== NoLanes;
}

function isSubsetOfLanes(set: number, subset: number): boolean {
  return (set & subset) === subset;
}

function includesSyncLane(lanes: number): boolean {
  return (lanes & SyncLane) !== NoLanes;
}

function includesNonIdleWork(lanes: number): boolean {
  return (lanes & NonIdleLanes) !== NoLanes;
}

function includesOnlyRetries(lanes: number): boolean {
  return (lanes & RetryLanes) === lanes;
}

function includesOnlyNonUrgentLanes(lanes: number): boolean {
  const UrgentLanes = SyncLane | InputContinuousLane | DefaultLane;
  return (lanes & UrgentLanes) === NoLanes;
}

function includesOnlyTransitions(lanes: number): boolean {
  return (lanes & TransitionLanes) === lanes;
}

function includesBlockingLane(lanes: number): boolean {
  const SyncDefaultLanes = InputContinuousHydrationLane | InputContinuousLane | DefaultHydrationLane | DefaultLane;
  return (lanes & SyncDefaultLanes) !== NoLanes;
}

function isTransitionLane(lane: number): boolean {
  return (lane & TransitionLanes) !== NoLanes;
}

let nextTransitionLane = TransitionLane1;
let nextRetryLane = RetryLane1;

function claimNextTransitionLane(): number {
  const lane = nextTransitionLane;
  nextTransitionLane = nextTransitionLane << 1;
  if ((nextTransitionLane & TransitionLanes) === NoLanes) {
    nextTransitionLane = TransitionLane1;
  }
  return lane;
}

function claimNextRetryLane(): number {
  const lane = nextRetryLane;
  nextRetryLane = nextRetryLane << 1;
  if ((nextRetryLane & RetryLanes) === NoLanes) {
    nextRetryLane = RetryLane1;
  }
  return lane;
}

function computeExpirationTime(lane: number, currentTime: number): number {
  if ((lane & (SyncLane | InputContinuousHydrationLane | InputContinuousLane)) !== NoLanes) {
    return currentTime + 250;
  }
  if ((lane & (DefaultHydrationLane | DefaultLane | TransitionHydrationLane | TransitionLanes)) !== NoLanes) {
    return currentTime + 5000;
  }
  // retries and idle-or-lower never expire
  return NoTimestamp;
}

function higherEventPriority(a: number, b: number): number {
  return a !== 0 && a < b ? a : b;
}

function lowerEventPriority(a: number, b: number): number {
  return a === 0 || a > b ? a : b;
}

function isHigherEventPriority(a: number, b: number): boolean {
  return a !== 0 && a < b;
}

function lanesToEventPriority(lanes: number): number {
  const lane = getHighestPriorityLane(lanes);
  if (!isHigherEventPriority(DiscreteEventPriority, lane)) {
    return DiscreteEventPriority;
  }
  if (!isHigherEventPriority(ContinuousEventPriority, lane)) {
    return ContinuousEventPriority;
  }
  if (includesNonIdleWork(lane)) {
    return DefaultEventPriority;
  }
  return IdleEventPriority;
}

let currentUpdatePriority = NoLane;

function getCurrentUpdatePriority(): number {
  return currentUpdatePriority;
}

function setCurrentUpdatePriority(newPriority: number): void {
  currentUpdatePriority = newPriority;
}

// host environment priority: RN/recording hosts report DefaultEventPriority
function getCurrentEventPriority(): number {
  return DefaultEventPriority;
}

// ---- deterministic scheduler (typed mirror of det-scheduler.cjs) ----
// Same frozen clock / explicit pump / yield budget semantics, and the same
// __schedTrace rolling checksum so the schedule/cancel/run/yield sequence is
// directly comparable against the real reconciler on the real scheduler shim.
class SchedTask {
  id: number;
  callback: any;
  priorityLevel: number;
  expirationTime: number;
  sortIndex: number;

  constructor(id: number, callback: any, priorityLevel: number, expirationTime: number) {
    this.id = id;
    this.callback = callback;
    this.priorityLevel = priorityLevel;
    this.expirationTime = expirationTime;
    this.sortIndex = expirationTime;
  }
}

let schedNow = 0;
let schedIdCounter = 0;
const schedTasks: any = new G.Array();
let schedYieldBudget = 1000000000;
let schedTraceCache: any = null;

function schedTrace(): any {
  if (schedTraceCache === null) {
    const g: any = G;
    if (g.__schedTrace === undefined || g.__schedTrace === null) {
      const t: any = mkObj();
      t.sum = 0;
      t.schedules = 0;
      t.cancels = 0;
      t.runs = 0;
      t.continuations = 0;
      t.yields = 0;
      g.__schedTrace = t;
    }
    schedTraceCache = g.__schedTrace;
  }
  return schedTraceCache;
}

function schedTrMix(n: number): void {
  const t: any = schedTrace();
  t.sum = ((t.sum * 31 + (n | 0)) | 0) >>> 0 | 0;
}

function schedTimeoutForPriority(priorityLevel: number): number {
  if (priorityLevel === ImmediateSchedPriority) {
    return -1;
  }
  if (priorityLevel === UserBlockingSchedPriority) {
    return 250;
  }
  if (priorityLevel === 4) {
    return 10000;
  }
  if (priorityLevel === IdleSchedPriority) {
    return 1073741823;
  }
  return 5000;
}

function schedInsertTask(task: SchedTask): void {
  let i: number = schedTasks.length;
  while (i > 0) {
    const prev: SchedTask = schedTasks[i - 1];
    if (prev.sortIndex < task.sortIndex || (prev.sortIndex === task.sortIndex && prev.id < task.id)) {
      break;
    }
    i = i - 1;
  }
  schedTasks.splice(i, 0, task);
}

function schedDropCancelledHead(): void {
  while (schedTasks.length > 0) {
    const head: SchedTask = schedTasks[0];
    if (head.callback !== null) {
      break;
    }
    schedTasks.shift();
  }
}

function scheduleSchedulerCallback(priorityLevel: number, callback: any): SchedTask {
  schedIdCounter = schedIdCounter + 1;
  const id = schedIdCounter;
  const expirationTime = schedNow + schedTimeoutForPriority(priorityLevel);
  const task = new SchedTask(id, callback, priorityLevel, expirationTime);
  schedInsertTask(task);
  const t: any = schedTrace();
  t.schedules = t.schedules + 1;
  schedTrMix(11);
  schedTrMix(priorityLevel);
  schedTrMix(id);
  return task;
}

function cancelSchedulerCallback(taskAny: any): void {
  const task: SchedTask = taskAny;
  const t: any = schedTrace();
  t.cancels = t.cancels + 1;
  schedTrMix(12);
  schedTrMix(task.id);
  task.callback = null;
}

function schedShouldYield(): boolean {
  const t: any = schedTrace();
  t.yields = t.yields + 1;
  schedTrMix(15);
  schedYieldBudget = schedYieldBudget - 1;
  return schedYieldBudget <= 0;
}

function schedFlushOne(budget: number): boolean {
  schedDropCancelledHead();
  if (schedTasks.length === 0) {
    return false;
  }
  const task: SchedTask = schedTasks[0];
  schedYieldBudget = budget < 0 ? 1000000000 : budget;
  const didTimeout = task.expirationTime <= schedNow;
  const callback: any = task.callback;
  task.callback = null;
  const t: any = schedTrace();
  t.runs = t.runs + 1;
  schedTrMix(13);
  schedTrMix(task.id);
  schedTrMix(didTimeout ? 1 : 0);
  const continuation: any = callback(didTimeout);
  if (typeof continuation === 'function') {
    task.callback = continuation;
    t.continuations = t.continuations + 1;
    schedTrMix(14);
    schedTrMix(task.id);
    schedTrMix(1);
  } else {
    if (schedTasks.length > 0) {
      const head2: SchedTask = schedTasks[0];
      if (head2 === task) {
        schedTasks.shift();
      }
    }
    schedTrMix(14);
    schedTrMix(task.id);
    schedTrMix(0);
  }
  schedDropCancelledHead();
  return schedTasks.length > 0;
}

function schedFlushAll(): void {
  let guard = 0;
  while (schedFlushOne(-1)) {
    guard = guard + 1;
    if (guard > 1000000) {
      throw new Error('typed det-scheduler: flushAll did not drain');
    }
  }
}

function schedAdvance(ms: number): void {
  schedNow = schedNow + ms;
}

function schedGetNow(): number {
  return schedNow;
}

function schedHasTasks(): boolean {
  schedDropCancelledHead();
  return schedTasks.length > 0;
}

// ---- host mode (React gates these same paths on its host config) ----
const supportsMutation = true;
const supportsPersistence = false;

function objectIs(x: any, y: any): boolean {
  if (x === y) {
    return x !== 0 || y !== 0 || 1 / x === 1 / y;
  }
  return x !== x && y !== y;
}

function shallowEqual(objA: any, objB: any): boolean {
  if (objectIs(objA, objB)) {
    return true;
  }
  if (typeof objA !== 'object' || objA === null || typeof objB !== 'object' || objB === null) {
    return false;
  }
  const keysA: any = G.Object.keys(objA);
  const keysB: any = G.Object.keys(objB);
  if (keysA.length !== keysB.length) {
    return false;
  }
  for (let i = 0; i < keysA.length; i++) {
    const k: any = keysA[i];
    if (!G.Object.prototype.hasOwnProperty.call(objB, k) || !objectIs(objA[k], objB[k])) {
      return false;
    }
  }
  return true;
}

// ---- elements ----
class El {
  $$el: boolean;
  type: any;
  key: any;
  ref: any;
  props: any;

  constructor(type: any, key: any, ref: any, props: any) {
    this.$$el = true;
    this.type = type;
    this.key = key;
    this.ref = ref;
    this.props = props;
  }
}

class MemoT {
  $$memo: boolean;
  render: any;
  compare: any;

  constructor(render: any, compare: any) {
    this.$$memo = true;
    this.render = render;
    this.compare = compare;
  }
}

function memoImpl(render: any, compare: any): any {
  return new MemoT(render, compare === undefined ? null : compare);
}

function forwardRefImpl(render: any): any {
  const t: any = mkObj();
  t.$$forwardRef = true;
  t.render = render;
  return t;
}

// React.lazy: payload statuses -1 uninitialized / 0 pending / 1 resolved /
// 2 rejected; the initializer throws the thenable while pending.
function lazyInitializer(payload: any): any {
  if (payload._status === -1) {
    const ctor: any = payload._result;
    const thenable: any = ctor();
    thenable.then(
      function (moduleObject: any): void {
        if (payload._status === 0 || payload._status === -1) {
          payload._status = 1;
          payload._result = moduleObject;
        }
      },
      function (error: any): void {
        if (payload._status === 0 || payload._status === -1) {
          payload._status = 2;
          payload._result = error;
        }
      }
    );
    if (payload._status === -1) {
      payload._status = 0;
      payload._result = thenable;
    }
  }
  if (payload._status === 1) {
    const moduleObject2: any = payload._result;
    return moduleObject2.default;
  }
  throw payload._result;
}

function lazyImpl(ctor: any): any {
  const payload: any = mkObj();
  payload._status = -1;
  payload._result = ctor;
  const t: any = mkObj();
  t.$$lazy = true;
  t._payload = payload;
  t._init = lazyInitializer;
  return t;
}

const SuspenseType: any = mkObj();
SuspenseType.$$suspense = true;

function createElementImpl(type: any, config: any, c1: any, c2: any, c3: any): any {
  const props: any = new G.Object();
  let key: any = null;
  let ref: any = null;
  if (config !== null && config !== undefined) {
    for (const k in config) {
      if (k !== 'key' && k !== 'ref') {
        props[k] = config[k];
      }
    }
    if (config.key !== undefined) {
      key = '' + config.key;
    }
    if (config.ref !== undefined && config.ref !== null) {
      ref = config.ref;
    }
  }
  if (c2 === undefined && c3 === undefined) {
    if (c1 !== undefined) {
      props.children = c1;
    }
  } else {
    const arr: any = new G.Array();
    if (c1 !== undefined) {
      arr.push(c1);
    }
    if (c2 !== undefined) {
      arr.push(c2);
    }
    if (c3 !== undefined) {
      arr.push(c3);
    }
    props.children = arr;
  }
  return new El(type, key, ref, props);
}

// ---- fiber ----
class FiberNode {
  tag: number;
  key: any;
  elementType: any;
  type: any;
  stateNode: any;
  ret: FiberNode | null;
  child: FiberNode | null;
  sibling: FiberNode | null;
  index: number;
  ref: any;
  pendingProps: any;
  memoizedProps: any;
  updateQueue: any;
  memoizedState: any;
  dependencies: any;
  mode: number;
  lanes: number;
  childLanes: number;
  alternate: FiberNode | null;
  flags: number;
  subtreeFlags: number;
  deletions: any;

  constructor(tag: number, pendingProps: any, key: any, mode: number) {
    this.tag = tag;
    this.key = key;
    this.mode = mode;
    this.elementType = null;
    this.type = null;
    this.stateNode = null;
    this.ret = null;
    this.child = null;
    this.sibling = null;
    this.index = 0;
    this.ref = null;
    this.pendingProps = pendingProps;
    this.memoizedProps = null;
    this.updateQueue = null;
    this.memoizedState = null;
    this.dependencies = null;
    this.lanes = NoLanes;
    this.childLanes = NoLanes;
    this.alternate = null;
    this.flags = NoFlags;
    this.subtreeFlags = NoFlags;
    this.deletions = null;
  }
}

class FiberRootNode {
  tag: number;
  containerInfo: any;
  current: FiberNode;
  finishedWork: FiberNode | null;
  finishedLanes: number;
  pendingChildren: any;
  pendingLanes: number;
  suspendedLanes: number;
  pingedLanes: number;
  expiredLanes: number;
  entangledLanes: number;
  entanglements: any;
  eventTimes: any;
  expirationTimes: any;
  callbackNode: any;
  callbackPriority: number;
  timeoutHandle: number;
  pingCache: any;

  constructor(containerInfo: any, current: FiberNode, tag: number) {
    this.tag = tag;
    this.containerInfo = containerInfo;
    this.current = current;
    this.finishedWork = null;
    this.finishedLanes = NoLanes;
    this.pendingChildren = null;
    this.pendingLanes = NoLanes;
    this.suspendedLanes = NoLanes;
    this.pingedLanes = NoLanes;
    this.expiredLanes = NoLanes;
    this.entangledLanes = NoLanes;
    this.entanglements = createLaneMap();
    this.eventTimes = createLaneMap();
    this.expirationTimes = createLaneMapNoTimestamp();
    this.callbackNode = null;
    this.callbackPriority = NoLane;
    this.timeoutHandle = -1;
    this.pingCache = null;
  }
}

function createLaneMap(): any {
  const laneMap: any = new G.Array();
  for (let i = 0; i < TotalLanes; i++) {
    laneMap.push(NoLanes);
  }
  return laneMap;
}

function createLaneMapNoTimestamp(): any {
  const laneMap: any = new G.Array();
  for (let i = 0; i < TotalLanes; i++) {
    laneMap.push(NoTimestamp);
  }
  return laneMap;
}

// ---- root lane bookkeeping (ReactFiberLane, root-parameterized) ----
function getNextLanes(root: FiberRootNode, wipLanes: number): number {
  const pendingLanes = root.pendingLanes;
  if (pendingLanes === NoLanes) {
    return NoLanes;
  }
  let nextLanes = NoLanes;
  const suspendedLanes = root.suspendedLanes;
  const pingedLanes = root.pingedLanes;
  const nonIdlePendingLanes = pendingLanes & NonIdleLanes;
  if (nonIdlePendingLanes !== NoLanes) {
    const nonIdleUnblockedLanes = nonIdlePendingLanes & ~suspendedLanes;
    if (nonIdleUnblockedLanes !== NoLanes) {
      nextLanes = getHighestPriorityLanes(nonIdleUnblockedLanes);
    } else {
      const nonIdlePingedLanes = nonIdlePendingLanes & pingedLanes;
      if (nonIdlePingedLanes !== NoLanes) {
        nextLanes = getHighestPriorityLanes(nonIdlePingedLanes);
      }
    }
  } else {
    const unblockedLanes = pendingLanes & ~suspendedLanes;
    if (unblockedLanes !== NoLanes) {
      nextLanes = getHighestPriorityLanes(unblockedLanes);
    } else {
      if (pingedLanes !== NoLanes) {
        nextLanes = getHighestPriorityLanes(pingedLanes);
      }
    }
  }
  if (nextLanes === NoLanes) {
    return NoLanes;
  }
  if (wipLanes !== NoLanes && wipLanes !== nextLanes && (wipLanes & suspendedLanes) === NoLanes) {
    const nextLane = getHighestPriorityLane(nextLanes);
    const wipLane = getHighestPriorityLane(wipLanes);
    if (nextLane >= wipLane || (nextLane === DefaultLane && (wipLane & TransitionLanes) !== NoLanes)) {
      return wipLanes;
    }
  }
  if ((nextLanes & InputContinuousLane) !== NoLanes) {
    nextLanes |= pendingLanes & DefaultLane;
  }
  const entangledLanes = root.entangledLanes;
  if (entangledLanes !== NoLanes) {
    const entanglements: any = root.entanglements;
    let lanes = nextLanes & entangledLanes;
    while (lanes > 0) {
      const index = pickArbitraryLaneIndex(lanes);
      const lane = 1 << index;
      nextLanes |= coerceInt(entanglements[index]);
      lanes &= ~lane;
    }
  }
  return nextLanes;
}

function getMostRecentEventTime(root: FiberRootNode, lanes: number): number {
  const eventTimes: any = root.eventTimes;
  let mostRecentEventTime = NoTimestamp;
  let l = lanes;
  while (l > 0) {
    const index = pickArbitraryLaneIndex(l);
    const lane = 1 << index;
    const eventTime = coerceInt(eventTimes[index]);
    if (eventTime > mostRecentEventTime) {
      mostRecentEventTime = eventTime;
    }
    l &= ~lane;
  }
  return mostRecentEventTime;
}

function markStarvedLanesAsExpired(root: FiberRootNode, currentTime: number): void {
  const pendingLanes = root.pendingLanes;
  const suspendedLanes = root.suspendedLanes;
  const pingedLanes = root.pingedLanes;
  const expirationTimes: any = root.expirationTimes;
  let lanes = pendingLanes;
  while (lanes > 0) {
    const index = pickArbitraryLaneIndex(lanes);
    const lane = 1 << index;
    const expirationTime = coerceInt(expirationTimes[index]);
    if (expirationTime === NoTimestamp) {
      if ((lane & suspendedLanes) === NoLanes || (lane & pingedLanes) !== NoLanes) {
        expirationTimes[index] = computeExpirationTime(lane, currentTime);
      }
    } else if (expirationTime <= currentTime) {
      root.expiredLanes |= lane;
    }
    lanes &= ~lane;
  }
}

function includesExpiredLane(root: FiberRootNode, lanes: number): boolean {
  return (lanes & root.expiredLanes) !== NoLanes;
}

function markRootUpdated(root: FiberRootNode, updateLane: number, eventTime: number): void {
  root.pendingLanes |= updateLane;
  if (updateLane !== IdleLane) {
    root.suspendedLanes = NoLanes;
    root.pingedLanes = NoLanes;
  }
  const eventTimes: any = root.eventTimes;
  const index = laneToIndex(updateLane);
  eventTimes[index] = eventTime;
}

function markRootSuspendedBase(root: FiberRootNode, suspendedLanes: number): void {
  root.suspendedLanes |= suspendedLanes;
  root.pingedLanes &= ~suspendedLanes;
  const expirationTimes: any = root.expirationTimes;
  let lanes = suspendedLanes;
  while (lanes > 0) {
    const index = pickArbitraryLaneIndex(lanes);
    const lane = 1 << index;
    expirationTimes[index] = NoTimestamp;
    lanes &= ~lane;
  }
}

function markRootPinged(root: FiberRootNode, pingedLanes: number): void {
  root.pingedLanes |= root.suspendedLanes & pingedLanes;
}

function markRootFinished(root: FiberRootNode, remainingLanes: number): void {
  const noLongerPendingLanes = root.pendingLanes & ~remainingLanes;
  root.pendingLanes = remainingLanes;
  root.suspendedLanes = NoLanes;
  root.pingedLanes = NoLanes;
  root.expiredLanes &= remainingLanes;
  root.entangledLanes &= remainingLanes;
  const entanglements: any = root.entanglements;
  const eventTimes: any = root.eventTimes;
  const expirationTimes: any = root.expirationTimes;
  let lanes = noLongerPendingLanes;
  while (lanes > 0) {
    const index = pickArbitraryLaneIndex(lanes);
    const lane = 1 << index;
    entanglements[index] = NoLanes;
    eventTimes[index] = NoTimestamp;
    expirationTimes[index] = NoTimestamp;
    lanes &= ~lane;
  }
}

function markRootEntangled(root: FiberRootNode, entangledLanes: number): void {
  root.entangledLanes |= entangledLanes;
  const rootEntangledLanes = root.entangledLanes;
  const entanglements: any = root.entanglements;
  let lanes = rootEntangledLanes;
  while (lanes !== 0) {
    const index = pickArbitraryLaneIndex(lanes);
    const lane = 1 << index;
    if ((lane & entangledLanes) !== 0 || (coerceInt(entanglements[index]) & entangledLanes) !== 0) {
      entanglements[index] = coerceInt(entanglements[index]) | entangledLanes;
    }
    lanes &= ~lane;
  }
}

function createWorkInProgress(current: FiberNode, pendingProps: any): FiberNode {
  let workInProgress = current.alternate;
  if (workInProgress === null) {
    workInProgress = new FiberNode(current.tag, pendingProps, current.key, current.mode);
    workInProgress.elementType = current.elementType;
    workInProgress.type = current.type;
    workInProgress.stateNode = current.stateNode;
    workInProgress.alternate = current;
    current.alternate = workInProgress;
  } else {
    workInProgress.pendingProps = pendingProps;
    workInProgress.type = current.type;
    workInProgress.flags = NoFlags;
    workInProgress.subtreeFlags = NoFlags;
    workInProgress.deletions = null;
  }
  workInProgress.childLanes = current.childLanes;
  workInProgress.lanes = current.lanes;
  workInProgress.child = current.child;
  workInProgress.memoizedProps = current.memoizedProps;
  workInProgress.memoizedState = current.memoizedState;
  workInProgress.updateQueue = current.updateQueue;
  const currentDependencies: any = current.dependencies;
  workInProgress.dependencies =
    currentDependencies === null ? null : createDependencies(currentDependencies.lanes, currentDependencies.firstContext);
  workInProgress.sibling = current.sibling;
  workInProgress.index = current.index;
  workInProgress.ref = current.ref;
  workInProgress.stateNode = current.stateNode;
  return workInProgress;
}

function createFiberFromElement(element: any, mode: number, lanes: number): FiberNode {
  const type: any = element.type;
  let tag = FunctionComponent;
  let resolvedType: any = type;
  if (typeof type === 'string') {
    tag = HostComponent;
  } else if (type !== null && typeof type === 'object' && type.$$memo === true) {
    // React: SimpleMemoComponent only for a plain function with the default
    // comparer; a custom compare gets the MemoComponent wrapper fiber.
    if (type.compare === null && typeof type.render === 'function') {
      tag = SimpleMemoComponent;
      resolvedType = type.render;
    } else {
      tag = MemoComponent;
    }
  } else if (type !== null && typeof type === 'object' && type.$$provider === true) {
    tag = ContextProvider;
  } else if (type !== null && typeof type === 'object' && type.$$forwardRef === true) {
    tag = ForwardRef;
  } else if (type !== null && typeof type === 'object' && type.$$lazy === true) {
    tag = LazyComponent;
    resolvedType = null;
  } else if (type !== null && typeof type === 'object' && type.$$suspense === true) {
    tag = SuspenseComponent;
  }
  const fiber = new FiberNode(tag, element.props, element.key, mode);
  fiber.elementType = type;
  fiber.type = resolvedType;
  fiber.ref = element.ref;
  fiber.lanes = lanes;
  return fiber;
}

function createFiberFromFragmentChildren(children: any, mode: number, lanes: number): FiberNode {
  const fiber = new FiberNode(Fragment, children, null, mode);
  fiber.lanes = lanes;
  return fiber;
}

function createFiberFromOffscreen(pendingProps: any, mode: number, lanes: number): FiberNode {
  const fiber = new FiberNode(OffscreenComponent, pendingProps, null, mode);
  fiber.lanes = lanes;
  return fiber;
}

function createFiberFromText(content: any, mode: number, lanes: number): FiberNode {
  const fiber = new FiberNode(HostText, content, null, mode);
  fiber.lanes = lanes;
  return fiber;
}

// ---- context (ReactFiberNewContext) ----
// dynamic objects, not classes: _currentValue / firstContext / next are
// mutated through any-references (push/popProvider, prepareToReadContext),
// which the typed system can't see — class fields would freeze.
function createContextDependency(context: any, memoizedValue: any): any {
  const d: any = mkObj();
  d.context = context;
  d.memoizedValue = memoizedValue;
  d.next = null;
  return d;
}

function createDependencies(lanes: number, firstContext: any): any {
  const dl: any = mkObj();
  dl.lanes = lanes;
  dl.firstContext = firstContext;
  return dl;
}

function createContextImpl(defaultValue: any): any {
  const ctx: any = mkObj();
  ctx.$$context = true;
  ctx._currentValue = defaultValue;
  const provider: any = mkObj();
  provider.$$provider = true;
  provider._context = ctx;
  ctx.Provider = provider;
  return ctx;
}

const ctxValueStack: any = new G.Array();
let lastContextDependency: any = null;

function pushProvider(providerFiber: FiberNode, context: any, nextValue: any): void {
  ctxValueStack.push(context._currentValue);
  context._currentValue = nextValue;
}

function popProvider(context: any, providerFiber: FiberNode): void {
  context._currentValue = ctxValueStack.pop();
}

function prepareToReadContext(workInProgress: FiberNode, renderLanes: number): void {
  lastContextDependency = null;
  const dependencies: any = workInProgress.dependencies;
  if (dependencies !== null) {
    if (dependencies.firstContext !== null) {
      if ((dependencies.lanes & renderLanes) !== NoLanes) {
        didReceiveUpdate = true;
      }
      dependencies.firstContext = null;
    }
  }
}

function readContext(context: any): any {
  const value: any = context._currentValue;
  const contextItem: any = createContextDependency(context, value);
  const f = currentlyRenderingFiber;
  if (lastContextDependency === null) {
    if (f === null) {
      throw new Error('context read outside render');
    }
    lastContextDependency = contextItem;
    f.dependencies = createDependencies(NoLanes, contextItem);
  } else {
    lastContextDependency.next = contextItem;
    lastContextDependency = contextItem;
  }
  return value;
}

function useContextImpl(context: any): any {
  return readContext(context);
}

function scheduleContextWorkOnParentPath(parent: FiberNode | null, renderLanes: number, propagationRoot: FiberNode): void {
  let node = parent;
  while (node !== null) {
    const alternate = node.alternate;
    if ((node.childLanes & renderLanes) !== renderLanes) {
      node.childLanes |= renderLanes;
      if (alternate !== null) {
        alternate.childLanes |= renderLanes;
      }
    } else if (alternate !== null && (alternate.childLanes & renderLanes) !== renderLanes) {
      alternate.childLanes |= renderLanes;
    }
    if (node === propagationRoot) {
      break;
    }
    node = node.ret;
  }
}

function propagateContextChange(workInProgress: FiberNode, context: any, renderLanes: number): void {
  let fiber = workInProgress.child;
  if (fiber !== null) {
    fiber.ret = workInProgress;
  }
  while (fiber !== null) {
    let nextFiber: FiberNode | null = null;
    const list: any = fiber.dependencies;
    if (list !== null) {
      nextFiber = fiber.child;
      let dependency: any = list.firstContext;
      while (dependency !== null) {
        if (dependency.context === context) {
          fiber.lanes |= renderLanes;
          const alternate = fiber.alternate;
          if (alternate !== null) {
            alternate.lanes |= renderLanes;
          }
          scheduleContextWorkOnParentPath(fiber.ret, renderLanes, workInProgress);
          list.lanes |= renderLanes;
          break;
        }
        dependency = dependency.next;
      }
    } else if (fiber.tag === ContextProvider) {
      nextFiber = fiber.type === workInProgress.type ? null : fiber.child;
    } else {
      nextFiber = fiber.child;
    }
    if (nextFiber !== null) {
      nextFiber.ret = fiber;
    } else {
      nextFiber = fiber;
      while (nextFiber !== null) {
        if (nextFiber === workInProgress) {
          nextFiber = null;
          break;
        }
        const sibling: FiberNode | null = nextFiber.sibling;
        if (sibling !== null) {
          sibling.ret = nextFiber.ret;
          nextFiber = sibling;
          break;
        }
        nextFiber = nextFiber.ret;
      }
    }
    fiber = nextFiber;
  }
}

// ---- hooks ----
class Hook {
  memoizedState: any;
  baseState: any;
  baseQueue: any;
  queue: any;
  next: Hook | null;

  constructor() {
    this.memoizedState = null;
    this.baseState = null;
    this.baseQueue = null;
    this.queue = null;
    this.next = null;
  }
}

class HookQueue {
  pending: any;
  interleaved: any;
  lanes: number;
  dispatch: any;
  lastRenderedReducer: any;
  lastRenderedState: any;

  constructor() {
    this.pending = null;
    this.interleaved = null;
    this.lanes = NoLanes;
    this.dispatch = null;
    this.lastRenderedReducer = null;
    this.lastRenderedState = null;
  }
}

class HookUpdate {
  lane: number;
  action: any;
  hasEagerState: boolean;
  eagerState: any;
  next: any;

  constructor(lane: number, action: any) {
    this.lane = lane;
    this.action = action;
    this.hasEagerState = false;
    this.eagerState = null;
    this.next = null;
  }
}

// ---- concurrent update queue (ReactFiberConcurrentUpdates, 18.3 interleaved model) ----
const concurrentQueues: any = new G.Array();

function pushConcurrentUpdateQueue(queue: HookQueue): void {
  concurrentQueues.push(queue);
}

// Transfer interleaved updates onto the main pending queues. Called when a
// fresh render stack is prepared.
function finishQueueingConcurrentUpdates(): void {
  if (concurrentQueues.length > 0) {
    for (let i = 0; i < concurrentQueues.length; i++) {
      const queue: HookQueue = concurrentQueues[i];
      const lastInterleavedAny: any = queue.interleaved;
      if (lastInterleavedAny !== null) {
        const lastInterleavedUpdate: HookUpdate = lastInterleavedAny;
        queue.interleaved = null;
        const firstInterleavedUpdate: any = lastInterleavedUpdate.next;
        const lastPendingAny: any = queue.pending;
        if (lastPendingAny !== null) {
          const lastPendingUpdate: HookUpdate = lastPendingAny;
          const firstPendingUpdate: any = lastPendingUpdate.next;
          lastPendingUpdate.next = firstInterleavedUpdate;
          lastInterleavedUpdate.next = firstPendingUpdate;
        }
        queue.pending = lastInterleavedUpdate;
      }
    }
    concurrentQueues.length = 0;
  }
}

function markUpdateLaneFromFiberToRoot(sourceFiber: FiberNode, lane: number): FiberRootNode | null {
  sourceFiber.lanes |= lane;
  let alternate = sourceFiber.alternate;
  if (alternate !== null) {
    alternate.lanes |= lane;
  }
  let node: FiberNode = sourceFiber;
  let parent = sourceFiber.ret;
  while (parent !== null) {
    parent.childLanes |= lane;
    alternate = parent.alternate;
    if (alternate !== null) {
      alternate.childLanes |= lane;
    }
    node = parent;
    parent = parent.ret;
  }
  if (node.tag === HostRoot) {
    return node.stateNode;
  }
  return null;
}

function enqueueConcurrentHookUpdate(fiber: FiberNode, queue: HookQueue, update: HookUpdate, lane: number): FiberRootNode | null {
  const interleaved: any = queue.interleaved;
  if (interleaved === null) {
    update.next = update;
    pushConcurrentUpdateQueue(queue);
  } else {
    const interleavedU: HookUpdate = interleaved;
    update.next = interleavedU.next;
    interleavedU.next = update;
  }
  queue.interleaved = update;
  return markUpdateLaneFromFiberToRoot(fiber, lane);
}

function enqueueConcurrentHookUpdateAndEagerlyBailout(fiber: FiberNode, queue: HookQueue, update: HookUpdate, lane: number): void {
  const interleaved: any = queue.interleaved;
  if (interleaved === null) {
    update.next = update;
    pushConcurrentUpdateQueue(queue);
  } else {
    const interleavedU: HookUpdate = interleaved;
    update.next = interleavedU.next;
    interleavedU.next = update;
  }
  queue.interleaved = update;
}

function enqueueConcurrentRenderForLane(fiber: FiberNode, lane: number): FiberRootNode | null {
  return markUpdateLaneFromFiberToRoot(fiber, lane);
}

let currentlyRenderingFiber: FiberNode | null = null;
let currentHook: Hook | null = null;
let workInProgressHook: Hook | null = null;
let isMountPhase = false;
let didReceiveUpdate = false;
// the lanes of the in-flight render, as seen by the hooks (React: module-
// level `renderLanes` in ReactFiberHooks, set by renderWithHooks)
let hooksRenderLanes = NoLanes;
// ReactCurrentBatchConfig.transition
let currentBatchTransition: any = null;

function requestCurrentTransition(): any {
  return currentBatchTransition;
}

function basicStateReducer(state: any, action: any): any {
  return typeof action === 'function' ? action(state) : action;
}

function mountWorkInProgressHook(): Hook {
  const hook = new Hook();
  const f = currentlyRenderingFiber;
  if (f === null) {
    throw new Error('hooks outside render');
  }
  if (workInProgressHook === null) {
    f.memoizedState = hook;
  } else {
    workInProgressHook.next = hook;
  }
  workInProgressHook = hook;
  return hook;
}

function updateWorkInProgressHook(): Hook {
  const f = currentlyRenderingFiber;
  if (f === null) {
    throw new Error('hooks outside render');
  }
  let nextCurrentHook: Hook | null;
  if (currentHook === null) {
    const current = f.alternate;
    nextCurrentHook = current !== null ? (current.memoizedState as Hook | null) : null;
  } else {
    nextCurrentHook = currentHook.next;
  }
  if (nextCurrentHook === null) {
    throw new Error('rendered more hooks than previous render');
  }
  currentHook = nextCurrentHook;
  const newHook = new Hook();
  newHook.memoizedState = currentHook.memoizedState;
  newHook.baseState = currentHook.baseState;
  newHook.baseQueue = currentHook.baseQueue;
  newHook.queue = currentHook.queue;
  if (workInProgressHook === null) {
    f.memoizedState = newHook;
  } else {
    workInProgressHook.next = newHook;
  }
  workInProgressHook = newHook;
  return newHook;
}

function isRenderPhaseUpdate(fiber: FiberNode): boolean {
  const alternate = fiber.alternate;
  return fiber === currentlyRenderingFiber || (alternate !== null && alternate === currentlyRenderingFiber);
}

function entangleTransitionUpdate(root: FiberRootNode, queue: HookQueue, lane: number): void {
  if (isTransitionLane(lane)) {
    let queueLanes = queue.lanes;
    queueLanes &= root.pendingLanes;
    const newQueueLanes = queueLanes | lane;
    queue.lanes = newQueueLanes;
    markRootEntangled(root, newQueueLanes);
  }
}

function dispatchSetState(fiber: FiberNode, queue: HookQueue, action: any): void {
  const lane = requestUpdateLane(fiber);
  const update = new HookUpdate(lane, action);
  if (isRenderPhaseUpdate(fiber)) {
    throw new Error('render-phase hook updates are not ported');
  }
  const alt = fiber.alternate;
  if (fiber.lanes === NoLanes && (alt === null || alt.lanes === NoLanes)) {
    const lastRenderedReducer: any = queue.lastRenderedReducer;
    if (lastRenderedReducer !== null) {
      const currentState: any = queue.lastRenderedState;
      const eagerState: any = lastRenderedReducer(currentState, action);
      update.hasEagerState = true;
      update.eagerState = eagerState;
      if (objectIs(eagerState, currentState)) {
        enqueueConcurrentHookUpdateAndEagerlyBailout(fiber, queue, update, lane);
        return;
      }
    }
  }
  const root = enqueueConcurrentHookUpdate(fiber, queue, update, lane);
  if (root !== null) {
    const eventTime = requestEventTime();
    scheduleUpdateOnFiber(root, fiber, lane, eventTime);
    entangleTransitionUpdate(root, queue, lane);
  }
}

// React: dispatchReducerAction — no eager-state computation.
function dispatchReducerAction(fiber: FiberNode, queue: HookQueue, action: any): void {
  const lane = requestUpdateLane(fiber);
  const update = new HookUpdate(lane, action);
  if (isRenderPhaseUpdate(fiber)) {
    throw new Error('render-phase hook updates are not ported');
  }
  const root = enqueueConcurrentHookUpdate(fiber, queue, update, lane);
  if (root !== null) {
    const eventTime = requestEventTime();
    scheduleUpdateOnFiber(root, fiber, lane, eventTime);
    entangleTransitionUpdate(root, queue, lane);
  }
}

// shared update path (React: updateReducer); useState uses basicStateReducer.
// Lane-aware: updates outside hooksRenderLanes are skipped and become the new
// base queue (rebase); skipped lanes re-mark the fiber and the root.
function updateReducerImpl(reducer: any): any {
  const hook = updateWorkInProgressHook();
  const queue: HookQueue = hook.queue;
  queue.lastRenderedReducer = reducer;
  const currentH: Hook = currentHook !== null ? currentHook : hook;
  let baseQueue: any = currentH.baseQueue;
  const pendingQueue: any = queue.pending;
  if (pendingQueue !== null) {
    if (baseQueue !== null) {
      const baseLast: HookUpdate = baseQueue;
      const pendingLast: HookUpdate = pendingQueue;
      const baseFirst: any = baseLast.next;
      const pendingFirst: any = pendingLast.next;
      baseLast.next = pendingFirst;
      pendingLast.next = baseFirst;
    }
    // the merged queue lives on the CURRENT hook so an interrupted render
    // that restarts still sees the pending updates
    currentH.baseQueue = pendingQueue;
    baseQueue = pendingQueue;
    queue.pending = null;
  }
  if (baseQueue !== null) {
    const firstU: any = baseQueue.next;
    let newState: any = currentH.baseState;
    let newBaseState: any = null;
    let newBaseQueueFirst: any = null;
    let newBaseQueueLast: any = null;
    let updateAny: any = firstU;
    while (true) {
      const update: HookUpdate = updateAny;
      const updateLane = update.lane;
      if (!isSubsetOfLanes(hooksRenderLanes, updateLane)) {
        // insufficient priority: skip, keep in the new base queue
        const clone = new HookUpdate(updateLane, update.action);
        clone.hasEagerState = update.hasEagerState;
        clone.eagerState = update.eagerState;
        if (newBaseQueueLast === null) {
          newBaseQueueFirst = clone;
          newBaseQueueLast = clone;
          newBaseState = newState;
        } else {
          const lastClone: HookUpdate = newBaseQueueLast;
          lastClone.next = clone;
          newBaseQueueLast = clone;
        }
        const crf = currentlyRenderingFiber;
        if (crf !== null) {
          crf.lanes |= updateLane;
        }
        markSkippedUpdateLanes(updateLane);
      } else {
        if (newBaseQueueLast !== null) {
          // committed updates after a skipped one are cloned at NoLane so a
          // rebase render can never skip them
          const clone2 = new HookUpdate(NoLane, update.action);
          clone2.hasEagerState = update.hasEagerState;
          clone2.eagerState = update.eagerState;
          const lastClone2: HookUpdate = newBaseQueueLast;
          lastClone2.next = clone2;
          newBaseQueueLast = clone2;
        }
        if (update.hasEagerState) {
          newState = update.eagerState;
        } else {
          newState = reducer(newState, update.action);
        }
      }
      updateAny = update.next;
      if (updateAny === null || updateAny === firstU) {
        break;
      }
    }
    if (newBaseQueueLast === null) {
      newBaseState = newState;
    } else {
      const lastClone3: HookUpdate = newBaseQueueLast;
      lastClone3.next = newBaseQueueFirst;
    }
    if (!objectIs(newState, hook.memoizedState)) {
      didReceiveUpdate = true;
    }
    hook.memoizedState = newState;
    hook.baseState = newBaseState;
    hook.baseQueue = newBaseQueueLast;
    queue.lastRenderedState = newState;
  }
  // interleaved updates are not processed this render but their lanes must
  // remain marked on the fiber and root
  const lastInterleaved: any = queue.interleaved;
  if (lastInterleaved !== null) {
    let interleavedAny: any = lastInterleaved;
    while (true) {
      const interleavedU: HookUpdate = interleavedAny;
      const interleavedLane = interleavedU.lane;
      const crf2 = currentlyRenderingFiber;
      if (crf2 !== null) {
        crf2.lanes |= interleavedLane;
      }
      markSkippedUpdateLanes(interleavedLane);
      interleavedAny = interleavedU.next;
      if (interleavedAny === lastInterleaved) {
        break;
      }
    }
  } else if (baseQueue === null) {
    // queue.lanes is used for entangling transitions; reset once empty
    queue.lanes = NoLanes;
  }
  const r: any = new G.Array();
  r.push(hook.memoizedState);
  r.push(queue.dispatch);
  return r;
}

function useReducerImpl(reducer: any, initialArg: any, init: any): any {
  if (isMountPhase) {
    const hook = mountWorkInProgressHook();
    const initialState: any = init !== undefined && init !== null ? init(initialArg) : initialArg;
    hook.memoizedState = initialState;
    hook.baseState = initialState;
    const queue = new HookQueue();
    queue.lastRenderedReducer = reducer;
    queue.lastRenderedState = initialState;
    hook.queue = queue;
    const owner: FiberNode = currentlyRenderingFiber !== null ? currentlyRenderingFiber : new FiberNode(-1, null, null, NoMode);
    const dispatch: any = function (action: any): void {
      dispatchReducerAction(owner, queue, action);
    };
    queue.dispatch = dispatch;
    const r: any = new G.Array();
    r.push(hook.memoizedState);
    r.push(dispatch);
    return r;
  }
  return updateReducerImpl(reducer);
}

function useStateImpl(initialState: any): any {
  if (isMountPhase) {
    const hook = mountWorkInProgressHook();
    const init: any = typeof initialState === 'function' ? initialState() : initialState;
    hook.memoizedState = init;
    hook.baseState = init;
    const queue = new HookQueue();
    queue.lastRenderedReducer = basicStateReducer;
    queue.lastRenderedState = init;
    hook.queue = queue;
    const owner: FiberNode = currentlyRenderingFiber !== null ? currentlyRenderingFiber : new FiberNode(-1, null, null, NoMode);
    const dispatch: any = function (action: any): void {
      dispatchSetState(owner, queue, action);
    };
    queue.dispatch = dispatch;
    const r: any = new G.Array();
    r.push(hook.memoizedState);
    r.push(dispatch);
    return r;
  }
  return updateReducerImpl(basicStateReducer);
}

function areHookInputsEqual(nextDeps: any, prevDeps: any): boolean {
  if (prevDeps === null) {
    return false;
  }
  if (nextDeps.length !== prevDeps.length) {
    return false;
  }
  for (let i = 0; i < nextDeps.length; i++) {
    if (!objectIs(nextDeps[i], prevDeps[i])) {
      return false;
    }
  }
  return true;
}

class CallbackPair {
  cb: any;
  deps: any;

  constructor(cb: any, deps: any) {
    this.cb = cb;
    this.deps = deps;
  }
}

function useCallbackImpl(callback: any, deps: any): any {
  const nextDeps: any = deps === undefined ? null : deps;
  if (isMountPhase) {
    const hook = mountWorkInProgressHook();
    hook.memoizedState = new CallbackPair(callback, nextDeps);
    return callback;
  }
  const hook = updateWorkInProgressHook();
  const prev: any = hook.memoizedState;
  if (prev !== null && nextDeps !== null && areHookInputsEqual(nextDeps, prev.deps)) {
    hook.memoizedState = prev;
    return prev.cb;
  }
  hook.memoizedState = new CallbackPair(callback, nextDeps);
  return callback;
}

class MemoPair {
  value: any;
  deps: any;

  constructor(value: any, deps: any) {
    this.value = value;
    this.deps = deps;
  }
}

function useMemoImpl(nextCreate: any, deps: any): any {
  const nextDeps: any = deps === undefined ? null : deps;
  if (isMountPhase) {
    const hook = mountWorkInProgressHook();
    const nextValue: any = nextCreate();
    hook.memoizedState = new MemoPair(nextValue, nextDeps);
    return nextValue;
  }
  const hook = updateWorkInProgressHook();
  const prevState: any = hook.memoizedState;
  if (prevState !== null && nextDeps !== null && areHookInputsEqual(nextDeps, prevState.deps)) {
    return prevState.value;
  }
  const nextValue2: any = nextCreate();
  hook.memoizedState = new MemoPair(nextValue2, nextDeps);
  return nextValue2;
}

function useRefImpl(initialValue: any): any {
  if (isMountPhase) {
    const hook = mountWorkInProgressHook();
    // dynamic object: ref.current is written by app code and commitAttachRef
    // through any-references.
    const box: any = mkObj();
    box.current = initialValue;
    hook.memoizedState = box;
    return box;
  }
  const hook = updateWorkInProgressHook();
  return hook.memoizedState;
}

// ---- transitions (ReactFiberHooks: mount/updateTransition, startTransition) ----
function startTransitionImpl(setPending: any, callback: any): void {
  const previousPriority = getCurrentUpdatePriority();
  setCurrentUpdatePriority(higherEventPriority(previousPriority, ContinuousEventPriority));
  setPending(true);
  const prevTransition: any = currentBatchTransition;
  currentBatchTransition = mkObj();
  try {
    setPending(false);
    callback();
  } finally {
    setCurrentUpdatePriority(previousPriority);
    currentBatchTransition = prevTransition;
  }
}

function useTransitionImpl(): any {
  const st: any = useStateImpl(false);
  const isPending: any = st[0];
  const setPending: any = st[1];
  if (isMountPhase) {
    const start: any = function (callback: any): void {
      startTransitionImpl(setPending, callback);
    };
    const hook = mountWorkInProgressHook();
    hook.memoizedState = start;
    const r: any = new G.Array();
    r.push(isPending);
    r.push(start);
    return r;
  }
  const hook2 = updateWorkInProgressHook();
  const start2: any = hook2.memoizedState;
  const r2: any = new G.Array();
  r2.push(isPending);
  r2.push(start2);
  return r2;
}

// ---- useDeferredValue (ReactFiberHooks: mount/updateDeferredValue) ----
function useDeferredValueImpl(value: any): any {
  if (isMountPhase) {
    const hook = mountWorkInProgressHook();
    hook.memoizedState = value;
    return value;
  }
  const hook2 = updateWorkInProgressHook();
  const prevHook: Hook | null = currentHook;
  const prevValue: any = prevHook !== null ? prevHook.memoizedState : null;
  const shouldDeferValue = !includesOnlyNonUrgentLanes(hooksRenderLanes);
  if (shouldDeferValue) {
    // urgent render: keep the previous value and spawn a deferred render
    if (!objectIs(value, prevValue)) {
      const deferredLane = claimNextTransitionLane();
      const crf = currentlyRenderingFiber;
      if (crf !== null) {
        crf.lanes |= deferredLane;
      }
      markSkippedUpdateLanes(deferredLane);
      // baseState reused as the "rendered value is stale" bit (React does
      // the same field reuse)
      hook2.baseState = true;
    }
    return prevValue;
  }
  if (hook2.baseState) {
    hook2.baseState = false;
    didReceiveUpdate = true;
  }
  hook2.memoizedState = value;
  return value;
}

// ---- effect hooks (ReactFiberHooks: pushEffect / mount/updateEffectImpl) ----
// dynamic objects, not classes: `next` forms a circular list and `destroy`
// is rewritten from commit code through any-references, which the typed
// system can't see — class fields would freeze (see catalog).
function createEffectNode(tag: number, create: any, destroy: any, deps: any): any {
  const e: any = mkObj();
  e.tag = tag;
  e.create = create;
  e.destroy = destroy;
  e.deps = deps;
  e.next = null;
  return e;
}

// dynamic object, not a class: its only typed-visible field write would be
// the null initializer, which shermes freezes as null-type (see catalog).
function createFCUpdateQueue(): any {
  const q: any = mkObj();
  q.lastEffect = null;
  return q;
}

function pushEffect(tag: number, create: any, destroy: any, deps: any): any {
  const effect: any = createEffectNode(tag, create, destroy, deps);
  const f = currentlyRenderingFiber;
  if (f === null) {
    throw new Error('effect outside render');
  }
  let componentUpdateQueue: any = f.updateQueue;
  if (componentUpdateQueue === null) {
    componentUpdateQueue = createFCUpdateQueue();
    f.updateQueue = componentUpdateQueue;
    effect.next = effect;
    componentUpdateQueue.lastEffect = effect;
  } else {
    const lastEffect: any = componentUpdateQueue.lastEffect;
    if (lastEffect === null) {
      effect.next = effect;
      componentUpdateQueue.lastEffect = effect;
    } else {
      const firstEffect: any = lastEffect.next;
      lastEffect.next = effect;
      effect.next = firstEffect;
      componentUpdateQueue.lastEffect = effect;
    }
  }
  return effect;
}

function mountEffectImpl(fiberFlags: number, hookFlags: number, create: any, deps: any): void {
  const hook = mountWorkInProgressHook();
  const nextDeps: any = deps === undefined ? null : deps;
  const f = currentlyRenderingFiber;
  if (f !== null) {
    f.flags |= fiberFlags;
  }
  hook.memoizedState = pushEffect(HookHasEffect | hookFlags, create, undefined, nextDeps);
}

function updateEffectImpl(fiberFlags: number, hookFlags: number, create: any, deps: any): void {
  const hook = updateWorkInProgressHook();
  const nextDeps: any = deps === undefined ? null : deps;
  let destroy: any = undefined;
  if (currentHook !== null) {
    const prevEffect: any = currentHook.memoizedState;
    destroy = prevEffect.destroy;
    if (nextDeps !== null) {
      const prevDeps: any = prevEffect.deps;
      if (areHookInputsEqual(nextDeps, prevDeps)) {
        hook.memoizedState = pushEffect(hookFlags, create, destroy, nextDeps);
        return;
      }
    }
  }
  const f = currentlyRenderingFiber;
  if (f !== null) {
    f.flags |= fiberFlags;
  }
  hook.memoizedState = pushEffect(HookHasEffect | hookFlags, create, destroy, nextDeps);
}

function useEffectImpl(create: any, deps: any): void {
  if (isMountPhase) {
    mountEffectImpl(Passive, HookPassive, create, deps);
  } else {
    updateEffectImpl(Passive, HookPassive, create, deps);
  }
}

function useLayoutEffectImpl(create: any, deps: any): void {
  if (isMountPhase) {
    mountEffectImpl(Update, HookLayout, create, deps);
  } else {
    updateEffectImpl(Update, HookLayout, create, deps);
  }
}

function useInsertionEffectImpl(create: any, deps: any): void {
  if (isMountPhase) {
    mountEffectImpl(Update, HookInsertion, create, deps);
  } else {
    updateEffectImpl(Update, HookInsertion, create, deps);
  }
}

function renderWithHooks(current: FiberNode | null, workInProgress: FiberNode, Component: any, props: any, secondArg: any, nextRenderLanes: number): any {
  hooksRenderLanes = nextRenderLanes;
  currentlyRenderingFiber = workInProgress;
  workInProgress.memoizedState = null;
  workInProgress.updateQueue = null;
  workInProgress.lanes = NoLanes;
  isMountPhase = current === null || current.memoizedState === null;
  currentHook = null;
  workInProgressHook = null;
  const children: any = Component(props, secondArg);
  hooksRenderLanes = NoLanes;
  currentlyRenderingFiber = null;
  currentHook = null;
  workInProgressHook = null;
  return children;
}

// render threw: reset the hooks module state (React: resetHooksAfterThrow).
// The legacy pre-render state restore lives in resetSuspendedComponent.
function resetHooksAfterThrow(): void {
  hooksRenderLanes = NoLanes;
  currentlyRenderingFiber = null;
  currentHook = null;
  workInProgressHook = null;
}

// ---- child reconciliation (ReactChildFiber, mutation mode) ----
function deleteChild(returnFiber: FiberNode, childToDelete: FiberNode, track: boolean): void {
  if (!track) {
    return;
  }
  let deletions: any = returnFiber.deletions;
  if (deletions === null) {
    deletions = new G.Array();
    returnFiber.deletions = deletions;
    returnFiber.flags |= ChildDeletion;
  }
  deletions.push(childToDelete);
}

function deleteRemainingChildren(returnFiber: FiberNode, currentFirstChild: FiberNode | null, track: boolean): null {
  if (!track) {
    return null;
  }
  let childToDelete = currentFirstChild;
  while (childToDelete !== null) {
    deleteChild(returnFiber, childToDelete, track);
    childToDelete = childToDelete.sibling;
  }
  return null;
}

function useFiber(fiber: FiberNode, pendingProps: any): FiberNode {
  const clone = createWorkInProgress(fiber, pendingProps);
  clone.index = 0;
  clone.sibling = null;
  return clone;
}

function placeChild(newFiber: FiberNode, lastPlacedIndex: number, newIndex: number, track: boolean): number {
  newFiber.index = newIndex;
  if (!track) {
    return lastPlacedIndex;
  }
  const current = newFiber.alternate;
  if (current !== null) {
    const oldIndex = current.index;
    if (oldIndex < lastPlacedIndex) {
      newFiber.flags |= Placement;
      return lastPlacedIndex;
    }
    return oldIndex;
  }
  newFiber.flags |= Placement;
  return lastPlacedIndex;
}

function placeSingleChild(newFiber: FiberNode, track: boolean): FiberNode {
  if (track && newFiber.alternate === null) {
    newFiber.flags |= Placement;
  }
  return newFiber;
}

function updateTextNode(returnFiber: FiberNode, current: FiberNode | null, textContent: any, lanes: number): FiberNode {
  if (current === null || current.tag !== HostText) {
    const created = createFiberFromText(textContent, returnFiber.mode, lanes);
    created.ret = returnFiber;
    return created;
  }
  const existing = useFiber(current, textContent);
  existing.ret = returnFiber;
  return existing;
}

function updateElement(returnFiber: FiberNode, current: FiberNode | null, element: any, lanes: number): FiberNode {
  if (current !== null && current.elementType === element.type) {
    const existing = useFiber(current, element.props);
    existing.ref = element.ref;
    existing.ret = returnFiber;
    return existing;
  }
  const created = createFiberFromElement(element, returnFiber.mode, lanes);
  created.ret = returnFiber;
  return created;
}

function updateSlot(returnFiber: FiberNode, oldFiber: FiberNode | null, newChild: any, lanes: number): FiberNode | null {
  const key = oldFiber !== null ? oldFiber.key : null;
  if (typeof newChild === 'string' || typeof newChild === 'number') {
    if (key !== null) {
      return null;
    }
    return updateTextNode(returnFiber, oldFiber, '' + newChild, lanes);
  }
  if (newChild !== null && typeof newChild === 'object' && newChild.$$el === true) {
    if (newChild.key === key) {
      return updateElement(returnFiber, oldFiber, newChild, lanes);
    }
    return null;
  }
  return null;
}

function createChild(returnFiber: FiberNode, newChild: any, lanes: number): FiberNode | null {
  if (typeof newChild === 'string' || typeof newChild === 'number') {
    const created = createFiberFromText('' + newChild, returnFiber.mode, lanes);
    created.ret = returnFiber;
    return created;
  }
  if (newChild !== null && typeof newChild === 'object' && newChild.$$el === true) {
    const created2 = createFiberFromElement(newChild, returnFiber.mode, lanes);
    created2.ret = returnFiber;
    return created2;
  }
  return null;
}

function mapRemainingChildren(currentFirstChild: FiberNode): any {
  const existingChildren: any = new G.Map();
  let existingChild: FiberNode | null = currentFirstChild;
  while (existingChild !== null) {
    if (existingChild.key !== null) {
      existingChildren.set(existingChild.key, existingChild);
    } else {
      existingChildren.set(existingChild.index, existingChild);
    }
    existingChild = existingChild.sibling;
  }
  return existingChildren;
}

function updateFromMap(existingChildren: any, returnFiber: FiberNode, newIdx: number, newChild: any, lanes: number): FiberNode | null {
  if (typeof newChild === 'string' || typeof newChild === 'number') {
    const matched: any = existingChildren.get(newIdx);
    const matchedFiber: FiberNode | null = matched === undefined ? null : matched;
    return updateTextNode(returnFiber, matchedFiber, '' + newChild, lanes);
  }
  if (newChild !== null && typeof newChild === 'object' && newChild.$$el === true) {
    const mapKey: any = newChild.key !== null ? newChild.key : newIdx;
    const matched2: any = existingChildren.get(mapKey);
    const matchedFiber2: FiberNode | null = matched2 === undefined ? null : matched2;
    return updateElement(returnFiber, matchedFiber2, newChild, lanes);
  }
  return null;
}

function reconcileChildrenArray(returnFiber: FiberNode, currentFirstChild: FiberNode | null, newChildren: any, lanes: number, track: boolean): FiberNode | null {
  let resultingFirstChild: FiberNode | null = null;
  let previousNewFiber: FiberNode | null = null;
  let oldFiber = currentFirstChild;
  let lastPlacedIndex = 0;
  let newIdx = 0;
  let nextOldFiber: FiberNode | null = null;

  for (; oldFiber !== null && newIdx < newChildren.length; newIdx++) {
    if (oldFiber.index > newIdx) {
      nextOldFiber = oldFiber;
      oldFiber = null;
    } else {
      nextOldFiber = oldFiber.sibling;
    }
    const newFiber = updateSlot(returnFiber, oldFiber, newChildren[newIdx], lanes);
    if (newFiber === null) {
      if (oldFiber === null) {
        oldFiber = nextOldFiber;
      }
      break;
    }
    if (track) {
      if (oldFiber !== null && newFiber.alternate === null) {
        deleteChild(returnFiber, oldFiber, track);
      }
    }
    lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx, track);
    if (previousNewFiber === null) {
      resultingFirstChild = newFiber;
    } else {
      previousNewFiber.sibling = newFiber;
    }
    previousNewFiber = newFiber;
    oldFiber = nextOldFiber;
  }

  if (newIdx === newChildren.length) {
    deleteRemainingChildren(returnFiber, oldFiber, track);
    return resultingFirstChild;
  }

  if (oldFiber === null) {
    for (; newIdx < newChildren.length; newIdx++) {
      const newFiber2 = createChild(returnFiber, newChildren[newIdx], lanes);
      if (newFiber2 === null) {
        continue;
      }
      lastPlacedIndex = placeChild(newFiber2, lastPlacedIndex, newIdx, track);
      if (previousNewFiber === null) {
        resultingFirstChild = newFiber2;
      } else {
        previousNewFiber.sibling = newFiber2;
      }
      previousNewFiber = newFiber2;
    }
    return resultingFirstChild;
  }

  const existingChildren: any = mapRemainingChildren(oldFiber);
  for (; newIdx < newChildren.length; newIdx++) {
    const newFiber3 = updateFromMap(existingChildren, returnFiber, newIdx, newChildren[newIdx], lanes);
    if (newFiber3 !== null) {
      if (track) {
        if (newFiber3.alternate !== null) {
          const delKey: any = newFiber3.key !== null ? newFiber3.key : newIdx;
          existingChildren.delete(delKey);
        }
      }
      lastPlacedIndex = placeChild(newFiber3, lastPlacedIndex, newIdx, track);
      if (previousNewFiber === null) {
        resultingFirstChild = newFiber3;
      } else {
        previousNewFiber.sibling = newFiber3;
      }
      previousNewFiber = newFiber3;
    }
  }
  if (track) {
    existingChildren.forEach(function (child: any): void {
      deleteChild(returnFiber, child, true);
    });
  }
  return resultingFirstChild;
}

function reconcileSingleTextNode(returnFiber: FiberNode, currentFirstChild: FiberNode | null, textContent: any, lanes: number, track: boolean): FiberNode {
  if (currentFirstChild !== null && currentFirstChild.tag === HostText) {
    deleteRemainingChildren(returnFiber, currentFirstChild.sibling, track);
    const existing = useFiber(currentFirstChild, textContent);
    existing.ret = returnFiber;
    return existing;
  }
  deleteRemainingChildren(returnFiber, currentFirstChild, track);
  const created = createFiberFromText(textContent, returnFiber.mode, lanes);
  created.ret = returnFiber;
  return created;
}

function reconcileSingleElement(returnFiber: FiberNode, currentFirstChild: FiberNode | null, element: any, lanes: number, track: boolean): FiberNode {
  const key = element.key;
  let child = currentFirstChild;
  while (child !== null) {
    if (child.key === key) {
      if (child.elementType === element.type) {
        deleteRemainingChildren(returnFiber, child.sibling, track);
        const existing = useFiber(child, element.props);
        existing.ref = element.ref;
        existing.ret = returnFiber;
        return existing;
      }
      deleteRemainingChildren(returnFiber, child, track);
      break;
    } else {
      deleteChild(returnFiber, child, track);
    }
    child = child.sibling;
  }
  const created = createFiberFromElement(element, returnFiber.mode, lanes);
  created.ret = returnFiber;
  return created;
}

function reconcileChildFibers(returnFiber: FiberNode, currentFirstChild: FiberNode | null, newChild: any, lanes: number, track: boolean): FiberNode | null {
  if (newChild !== null && typeof newChild === 'object') {
    if (newChild.$$el === true) {
      return placeSingleChild(reconcileSingleElement(returnFiber, currentFirstChild, newChild, lanes, track), track);
    }
    if (G.Array.isArray(newChild)) {
      return reconcileChildrenArray(returnFiber, currentFirstChild, newChild, lanes, track);
    }
  }
  if (typeof newChild === 'string' || typeof newChild === 'number') {
    return placeSingleChild(reconcileSingleTextNode(returnFiber, currentFirstChild, '' + newChild, lanes, track), track);
  }
  return deleteRemainingChildren(returnFiber, currentFirstChild, track);
}

function reconcileChildren(current: FiberNode | null, workInProgress: FiberNode, nextChildren: any, renderLanes: number): void {
  if (current === null) {
    workInProgress.child = reconcileChildFibers(workInProgress, null, nextChildren, renderLanes, false);
  } else {
    workInProgress.child = reconcileChildFibers(workInProgress, current.child, nextChildren, renderLanes, true);
  }
}

function cloneChildFibers(workInProgress: FiberNode): void {
  if (workInProgress.child === null) {
    return;
  }
  let currentChild = workInProgress.child;
  let newChild = createWorkInProgress(currentChild, currentChild.pendingProps);
  workInProgress.child = newChild;
  newChild.ret = workInProgress;
  while (currentChild.sibling !== null) {
    currentChild = currentChild.sibling;
    const next = createWorkInProgress(currentChild, currentChild.pendingProps);
    newChild.sibling = next;
    next.ret = workInProgress;
    newChild = next;
  }
  newChild.sibling = null;
}

// ---- begin work ----
function bailoutOnAlreadyFinishedWork(current: FiberNode | null, workInProgress: FiberNode, renderLanes: number): FiberNode | null {
  if ((workInProgress.childLanes & renderLanes) === NoLanes) {
    return null;
  }
  cloneChildFibers(workInProgress);
  return workInProgress.child;
}

function updateFunctionComponent(current: FiberNode | null, workInProgress: FiberNode, Component: any, nextProps: any, renderLanes: number): FiberNode | null {
  prepareToReadContext(workInProgress, renderLanes);
  const nextChildren: any = renderWithHooks(current, workInProgress, Component, nextProps, undefined, renderLanes);
  if (current !== null && !didReceiveUpdate) {
    // bailoutHooks
    current.lanes = current.lanes & ~renderLanes;
    return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
  }
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

function updateForwardRef(current: FiberNode | null, workInProgress: FiberNode, Component: any, nextProps: any, renderLanes: number): FiberNode | null {
  const render: any = Component.render;
  const ref: any = workInProgress.ref;
  prepareToReadContext(workInProgress, renderLanes);
  const nextChildren: any = renderWithHooks(current, workInProgress, render, nextProps, ref, renderLanes);
  if (current !== null && !didReceiveUpdate) {
    current.lanes = current.lanes & ~renderLanes;
    return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
  }
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

function updateMemoComponent(current: FiberNode | null, workInProgress: FiberNode, Component: any, nextProps: any, renderLanes: number): FiberNode | null {
  if (current === null) {
    const innerEl: any = new El(Component.render, null, workInProgress.ref, nextProps);
    const child = createFiberFromElement(innerEl, workInProgress.mode, renderLanes);
    child.ref = workInProgress.ref;
    child.ret = workInProgress;
    workInProgress.child = child;
    return child;
  }
  const currentChild: FiberNode = current.child !== null ? current.child : workInProgress;
  const hasScheduledUpdate = (current.lanes & renderLanes) !== NoLanes;
  if (!hasScheduledUpdate) {
    const prevProps: any = currentChild.memoizedProps;
    const compare: any = Component.compare !== null ? Component.compare : shallowEqual;
    if (compare(prevProps, nextProps) && current.ref === workInProgress.ref) {
      return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
    }
  }
  const newChild = createWorkInProgress(currentChild, nextProps);
  newChild.ref = workInProgress.ref;
  newChild.ret = workInProgress;
  workInProgress.child = newChild;
  return newChild;
}

// React (legacy mode): a lazy component only MOUNTS here if it suspended in
// an inconsistent state — treat it like a new mount: disconnect the
// alternates and schedule a Placement effect.
function resetSuspendedCurrentOnMountInLegacyMode(current: FiberNode | null, workInProgress: FiberNode): void {
  if ((workInProgress.mode & ConcurrentMode) !== NoMode) {
    return;
  }
  if (current !== null) {
    current.alternate = null;
    workInProgress.alternate = null;
    workInProgress.flags |= Placement;
  }
}

function mountLazyComponent(current: FiberNode | null, workInProgress: FiberNode, renderLanes: number): FiberNode | null {
  resetSuspendedCurrentOnMountInLegacyMode(current, workInProgress);
  const props: any = workInProgress.pendingProps;
  const lazyComponent: any = workInProgress.elementType;
  const payload: any = lazyComponent._payload;
  const init: any = lazyComponent._init;
  const Component: any = init(payload); // throws the thenable while pending
  workInProgress.type = Component;
  if (typeof Component === 'function') {
    workInProgress.tag = FunctionComponent;
    return updateFunctionComponent(null, workInProgress, Component, props, renderLanes);
  }
  if (Component !== null && typeof Component === 'object' && Component.$$forwardRef === true) {
    workInProgress.tag = ForwardRef;
    return updateForwardRef(null, workInProgress, Component, props, renderLanes);
  }
  if (Component !== null && typeof Component === 'object' && Component.$$memo === true) {
    workInProgress.tag = MemoComponent;
    return updateMemoComponent(null, workInProgress, Component, props, renderLanes);
  }
  throw new Error('lazy: unsupported resolved component type');
}

function updateFragment(current: FiberNode | null, workInProgress: FiberNode, renderLanes: number): FiberNode | null {
  reconcileChildren(current, workInProgress, workInProgress.pendingProps, renderLanes);
  return workInProgress.child;
}

function updateContextProvider(current: FiberNode | null, workInProgress: FiberNode, renderLanes: number): FiberNode | null {
  const providerType: any = workInProgress.type;
  const context: any = providerType._context;
  const newProps: any = workInProgress.pendingProps;
  const oldProps: any = current !== null ? current.memoizedProps : null;
  const newValue: any = newProps.value;
  pushProvider(workInProgress, context, newValue);
  if (oldProps !== null) {
    const oldValue: any = oldProps.value;
    if (objectIs(oldValue, newValue)) {
      if (oldProps.children === newProps.children) {
        return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
      }
    } else {
      propagateContextChange(workInProgress, context, renderLanes);
    }
  }
  reconcileChildren(current, workInProgress, newProps.children, renderLanes);
  return workInProgress.child;
}

// ---- Suspense (ReactFiberBeginWork, legacy sync mode only) ----
const SUSPENDED_MARKER: any = mkObj();
SUSPENDED_MARKER.dehydrated = null;
SUSPENDED_MARKER.retryLane = NoLane;

// ---- suspense context stack (ReactFiberSuspenseContext) ----
const SubtreeSuspenseContextMask = 1;
const InvisibleParentSuspenseContext = 1;
const ForceSuspenseFallback = 2;
const suspenseCtxStack: any = new G.Array();
let suspenseCtxCurrent = 0;

function pushSuspenseContext(fiber: FiberNode, newContext: number): void {
  suspenseCtxStack.push(suspenseCtxCurrent);
  suspenseCtxCurrent = newContext;
}

function popSuspenseContext(fiber: FiberNode): void {
  suspenseCtxCurrent = coerceInt(suspenseCtxStack.pop());
}

function shouldRemainOnFallback(suspenseContext: number, current: FiberNode | null): boolean {
  if (current !== null) {
    const suspenseState: any = current.memoizedState;
    if (suspenseState === null) {
      return false;
    }
  }
  return (suspenseContext & ForceSuspenseFallback) !== 0;
}

function mountSuspenseOffscreenState(renderLanes: number): any {
  const s: any = mkObj();
  s.baseLanes = renderLanes;
  return s;
}

function updateSuspenseOffscreenState(prevOffscreenState: any, renderLanes: number): any {
  const s: any = mkObj();
  s.baseLanes = coerceInt(prevOffscreenState.baseLanes) | renderLanes;
  return s;
}

function mountSuspensePrimaryChildren(workInProgress: FiberNode, primaryChildren: any, renderLanes: number): FiberNode {
  const primaryChildProps: any = mkObj();
  primaryChildProps.mode = 'visible';
  primaryChildProps.children = primaryChildren;
  const primaryChildFragment = createFiberFromOffscreen(primaryChildProps, workInProgress.mode, NoLanes);
  primaryChildFragment.ret = workInProgress;
  workInProgress.child = primaryChildFragment;
  return primaryChildFragment;
}

function mountSuspenseFallbackChildren(workInProgress: FiberNode, primaryChildren: any, fallbackChildren: any, renderLanes: number): FiberNode {
  const progressedPrimaryFragment: FiberNode | null = workInProgress.child;
  const primaryChildProps: any = mkObj();
  primaryChildProps.mode = 'hidden';
  primaryChildProps.children = primaryChildren;
  let primaryChildFragment: FiberNode;
  // legacy mode: reuse the progressed primary fragment from the first pass
  if ((workInProgress.mode & ConcurrentMode) === NoMode && progressedPrimaryFragment !== null) {
    primaryChildFragment = progressedPrimaryFragment;
    primaryChildFragment.childLanes = NoLanes;
    primaryChildFragment.pendingProps = primaryChildProps;
  } else {
    primaryChildFragment = createFiberFromOffscreen(primaryChildProps, workInProgress.mode, NoLanes);
  }
  const fallbackChildFragment = createFiberFromFragmentChildren(fallbackChildren, workInProgress.mode, renderLanes);
  primaryChildFragment.ret = workInProgress;
  fallbackChildFragment.ret = workInProgress;
  primaryChildFragment.sibling = fallbackChildFragment;
  workInProgress.child = primaryChildFragment;
  return fallbackChildFragment;
}

function updateSuspensePrimaryChildren(current: FiberNode, workInProgress: FiberNode, primaryChildren: any, renderLanes: number): FiberNode {
  const currentPrimaryChildFragment: FiberNode = current.child !== null ? current.child : workInProgress;
  const currentFallbackChildFragment: FiberNode | null = currentPrimaryChildFragment.sibling;
  const primaryChildProps: any = mkObj();
  primaryChildProps.mode = 'visible';
  primaryChildProps.children = primaryChildren;
  const primaryChildFragment = createWorkInProgress(currentPrimaryChildFragment, primaryChildProps);
  if ((workInProgress.mode & ConcurrentMode) === NoMode) {
    // legacy mode forces the primary tree to re-render
    primaryChildFragment.lanes = renderLanes;
  }
  primaryChildFragment.ret = workInProgress;
  primaryChildFragment.sibling = null;
  if (currentFallbackChildFragment !== null) {
    let deletions: any = workInProgress.deletions;
    if (deletions === null) {
      deletions = new G.Array();
      deletions.push(currentFallbackChildFragment);
      workInProgress.deletions = deletions;
      workInProgress.flags |= ChildDeletion;
    } else {
      deletions.push(currentFallbackChildFragment);
    }
  }
  workInProgress.child = primaryChildFragment;
  return primaryChildFragment;
}

function updateSuspenseFallbackChildren(current: FiberNode, workInProgress: FiberNode, primaryChildren: any, fallbackChildren: any, renderLanes: number): FiberNode {
  const currentPrimaryChildFragment: FiberNode = current.child !== null ? current.child : workInProgress;
  const currentFallbackChildFragment: FiberNode | null = currentPrimaryChildFragment.sibling;
  const primaryChildProps: any = mkObj();
  primaryChildProps.mode = 'hidden';
  primaryChildProps.children = primaryChildren;
  let primaryChildFragment: FiberNode;
  // legacy second pass: the primary fragment already progressed in the first
  // pass — reuse it and drop the deletion that pass recorded.
  if ((workInProgress.mode & ConcurrentMode) === NoMode &&
      workInProgress.child !== currentPrimaryChildFragment && workInProgress.child !== null) {
    primaryChildFragment = workInProgress.child;
    primaryChildFragment.childLanes = NoLanes;
    primaryChildFragment.pendingProps = primaryChildProps;
    workInProgress.deletions = null;
  } else {
    primaryChildFragment = createWorkInProgress(currentPrimaryChildFragment, primaryChildProps);
    primaryChildFragment.subtreeFlags = NoFlags;
  }
  let fallbackChildFragment: FiberNode;
  if (currentFallbackChildFragment !== null) {
    fallbackChildFragment = createWorkInProgress(currentFallbackChildFragment, fallbackChildren);
  } else {
    fallbackChildFragment = createFiberFromFragmentChildren(fallbackChildren, workInProgress.mode, renderLanes);
    fallbackChildFragment.flags |= Placement;
  }
  fallbackChildFragment.ret = workInProgress;
  primaryChildFragment.ret = workInProgress;
  primaryChildFragment.sibling = fallbackChildFragment;
  workInProgress.child = primaryChildFragment;
  return fallbackChildFragment;
}

function updateSuspenseComponent(current: FiberNode | null, workInProgress: FiberNode, renderLanes: number): FiberNode | null {
  const nextProps: any = workInProgress.pendingProps;
  let suspenseContext = suspenseCtxCurrent;
  let showFallback = false;
  const didSuspend = (workInProgress.flags & DidCapture) !== NoFlags;
  if (didSuspend || shouldRemainOnFallback(suspenseContext, current)) {
    showFallback = true;
    workInProgress.flags &= ~DidCapture;
  } else {
    // attempting the main content: mark that an invisible parent could take
    // the fallback if this is a new mount or already showing a fallback
    if (current === null || current.memoizedState !== null) {
      suspenseContext = suspenseContext | InvisibleParentSuspenseContext;
    }
  }
  suspenseContext = suspenseContext & SubtreeSuspenseContextMask;
  pushSuspenseContext(workInProgress, suspenseContext);
  if (current === null) {
    const nextPrimaryChildren: any = nextProps.children;
    const nextFallbackChildren: any = nextProps.fallback;
    if (showFallback) {
      const fallbackFragment = mountSuspenseFallbackChildren(workInProgress, nextPrimaryChildren, nextFallbackChildren, renderLanes);
      const primaryChildFragment = workInProgress.child;
      if (primaryChildFragment !== null) {
        primaryChildFragment.memoizedState = mountSuspenseOffscreenState(renderLanes);
      }
      workInProgress.memoizedState = SUSPENDED_MARKER;
      return fallbackFragment;
    }
    return mountSuspensePrimaryChildren(workInProgress, nextPrimaryChildren, renderLanes);
  }
  if (showFallback) {
    const fallbackChildFragment = updateSuspenseFallbackChildren(current, workInProgress, nextProps.children, nextProps.fallback, renderLanes);
    const primaryChildFragment2 = workInProgress.child;
    const prevOffscreenState: any = current.child !== null ? current.child.memoizedState : null;
    if (primaryChildFragment2 !== null) {
      primaryChildFragment2.memoizedState =
        prevOffscreenState === null
          ? mountSuspenseOffscreenState(renderLanes)
          : updateSuspenseOffscreenState(prevOffscreenState, renderLanes);
      primaryChildFragment2.childLanes = current.childLanes & ~renderLanes;
    }
    workInProgress.memoizedState = SUSPENDED_MARKER;
    return fallbackChildFragment;
  }
  const primaryChildFragment3 = updateSuspensePrimaryChildren(current, workInProgress, nextProps.children, renderLanes);
  workInProgress.memoizedState = null;
  return primaryChildFragment3;
}

function updateOffscreenComponent(current: FiberNode | null, workInProgress: FiberNode, renderLanes: number): FiberNode | null {
  const nextProps: any = workInProgress.pendingProps;
  const nextChildren: any = nextProps.children;
  const prevState: any = current !== null ? current.memoizedState : null;
  if (nextProps.mode === 'hidden') {
    if ((workInProgress.mode & ConcurrentMode) === NoMode) {
      // legacy mode: no deferral — render children hidden now
      const nextState: any = mkObj();
      nextState.baseLanes = NoLanes;
      workInProgress.memoizedState = nextState;
      pushRenderLanes(workInProgress, renderLanes);
    } else if ((renderLanes & OffscreenLane) === NoLanes) {
      // hidden and not rendering at Offscreen priority: schedule this fiber
      // to re-render at Offscreen priority, then bail out
      let nextBaseLanes = renderLanes;
      if (prevState !== null) {
        nextBaseLanes = coerceInt(prevState.baseLanes) | renderLanes;
      }
      workInProgress.lanes = OffscreenLane;
      workInProgress.childLanes = OffscreenLane;
      const nextState2: any = mkObj();
      nextState2.baseLanes = nextBaseLanes;
      workInProgress.memoizedState = nextState2;
      workInProgress.updateQueue = null;
      pushRenderLanes(workInProgress, nextBaseLanes);
      return null;
    } else {
      // second render, at Offscreen priority: resume the hidden tree
      const nextState3: any = mkObj();
      nextState3.baseLanes = NoLanes;
      workInProgress.memoizedState = nextState3;
      const hiddenSubtreeLanes = prevState !== null ? coerceInt(prevState.baseLanes) : renderLanes;
      pushRenderLanes(workInProgress, hiddenSubtreeLanes);
    }
  } else {
    // visible
    let visibleSubtreeLanes = renderLanes;
    if (prevState !== null) {
      // going hidden -> visible: include the lanes skipped while hidden
      visibleSubtreeLanes = coerceInt(prevState.baseLanes) | renderLanes;
      workInProgress.memoizedState = null;
    }
    pushRenderLanes(workInProgress, visibleSubtreeLanes);
  }
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

function markRefHost(current: FiberNode | null, workInProgress: FiberNode): void {
  const ref: any = workInProgress.ref;
  if ((current === null && ref !== null) || (current !== null && current.ref !== ref)) {
    workInProgress.flags |= Ref;
  }
}

function updateSimpleMemoComponent(current: FiberNode | null, workInProgress: FiberNode, Component: any, nextProps: any, renderLanes: number): FiberNode | null {
  if (current !== null) {
    const prevProps: any = current.memoizedProps;
    if (shallowEqual(prevProps, nextProps)) {
      didReceiveUpdate = false;
      workInProgress.pendingProps = prevProps;
      if ((current.lanes & renderLanes) === NoLanes) {
        workInProgress.lanes = current.lanes;
        return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
      }
    }
  }
  return updateFunctionComponent(current, workInProgress, Component, workInProgress.pendingProps, renderLanes);
}

function updateHostRoot(current: FiberNode | null, workInProgress: FiberNode, renderLanes: number): FiberNode | null {
  const nextChildren: any = workInProgress.memoizedState.element;
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

function updateHostComponent(current: FiberNode | null, workInProgress: FiberNode, renderLanes: number): FiberNode | null {
  markRefHost(current, workInProgress);
  const nextProps: any = workInProgress.pendingProps;
  const nextChildren: any = nextProps.children;
  reconcileChildren(current, workInProgress, nextChildren === undefined ? null : nextChildren, renderLanes);
  return workInProgress.child;
}

// React: attemptEarlyBailoutIfNoScheduledUpdate — re-push stack frames for
// stackful fiber types, then bail out (with the Suspense/Offscreen special
// cases that may re-enter the normal update path).
function attemptEarlyBailoutIfNoScheduledUpdate(current: FiberNode, workInProgress: FiberNode, renderLanes: number): FiberNode | null {
  const tag = workInProgress.tag;
  if (tag === ContextProvider) {
    const bailCtx: any = workInProgress.type._context;
    pushProvider(workInProgress, bailCtx, workInProgress.memoizedProps.value);
  } else if (tag === SuspenseComponent) {
    const state: any = workInProgress.memoizedState;
    if (state !== null) {
      // currently timed out: retry the primary children, or skip to the
      // fallback, depending on where the pending work is
      const primaryChildFragment = workInProgress.child;
      const primaryChildLanes = primaryChildFragment !== null ? primaryChildFragment.childLanes : NoLanes;
      if ((renderLanes & primaryChildLanes) !== NoLanes) {
        return updateSuspenseComponent(current, workInProgress, renderLanes);
      }
      pushSuspenseContext(workInProgress, suspenseCtxCurrent & SubtreeSuspenseContextMask);
      const child = bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
      if (child !== null) {
        // work on the fallback, skipping the hidden primary children
        return child.sibling;
      }
      return null;
    }
    pushSuspenseContext(workInProgress, suspenseCtxCurrent & SubtreeSuspenseContextMask);
  } else if (tag === OffscreenComponent) {
    // the deferral decision is identical to the normal update path
    workInProgress.lanes = NoLanes;
    return updateOffscreenComponent(current, workInProgress, renderLanes);
  }
  return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
}

function beginWork(current: FiberNode | null, workInProgress: FiberNode, renderLanes: number): FiberNode | null {
  if (current !== null) {
    const oldProps: any = current.memoizedProps;
    const newProps: any = workInProgress.pendingProps;
    if (oldProps !== newProps) {
      didReceiveUpdate = true;
    } else {
      if ((current.lanes & renderLanes) === NoLanes &&
          (workInProgress.flags & DidCapture) === NoFlags) {
        didReceiveUpdate = false;
        return attemptEarlyBailoutIfNoScheduledUpdate(current, workInProgress, renderLanes);
      }
      if ((current.flags & ForceUpdateForLegacySuspense) !== NoFlags) {
        // legacy suspense forced re-render of the suspended component
        didReceiveUpdate = true;
      } else {
        didReceiveUpdate = false;
      }
    }
  } else {
    didReceiveUpdate = false;
  }
  workInProgress.lanes = NoLanes;

  const tag = workInProgress.tag;
  if (tag === FunctionComponent) {
    return updateFunctionComponent(current, workInProgress, workInProgress.type, workInProgress.pendingProps, renderLanes);
  }
  if (tag === SimpleMemoComponent) {
    return updateSimpleMemoComponent(current, workInProgress, workInProgress.type, workInProgress.pendingProps, renderLanes);
  }
  if (tag === HostRoot) {
    return updateHostRoot(current, workInProgress, renderLanes);
  }
  if (tag === HostComponent) {
    return updateHostComponent(current, workInProgress, renderLanes);
  }
  if (tag === HostText) {
    return null;
  }
  if (tag === ContextProvider) {
    return updateContextProvider(current, workInProgress, renderLanes);
  }
  if (tag === ForwardRef) {
    return updateForwardRef(current, workInProgress, workInProgress.type, workInProgress.pendingProps, renderLanes);
  }
  if (tag === MemoComponent) {
    return updateMemoComponent(current, workInProgress, workInProgress.elementType, workInProgress.pendingProps, renderLanes);
  }
  if (tag === LazyComponent) {
    return mountLazyComponent(current, workInProgress, renderLanes);
  }
  if (tag === Fragment) {
    return updateFragment(current, workInProgress, renderLanes);
  }
  if (tag === SuspenseComponent) {
    return updateSuspenseComponent(current, workInProgress, renderLanes);
  }
  if (tag === OffscreenComponent) {
    return updateOffscreenComponent(current, workInProgress, renderLanes);
  }
  throw new Error('unknown tag ' + String(tag));
}

// ---- throw handling (ReactFiberThrow, legacy sync mode) ----
function shouldCaptureSuspense(fiber: FiberNode): boolean {
  return fiber.memoizedState === null;
}

function getNearestSuspenseBoundaryToCapture(returnFiber: FiberNode | null): FiberNode | null {
  let node = returnFiber;
  while (node !== null) {
    if (node.tag === SuspenseComponent && shouldCaptureSuspense(node)) {
      return node;
    }
    node = node.ret;
  }
  return null;
}

function attachRetryListener(suspenseBoundary: FiberNode, wakeable: any): void {
  let wakeables: any = suspenseBoundary.updateQueue;
  if (wakeables === null) {
    wakeables = new G.Set();
    wakeables.add(wakeable);
    suspenseBoundary.updateQueue = wakeables;
  } else {
    wakeables.add(wakeable);
  }
}

// React: resetSuspendedComponent — legacy quirk: restore the suspended hook
// component's pre-render state so the incomplete fiber commits as-is.
function resetSuspendedComponent(sourceFiber: FiberNode): void {
  const tag = sourceFiber.tag;
  if ((sourceFiber.mode & ConcurrentMode) === NoMode &&
      (tag === FunctionComponent || tag === ForwardRef || tag === SimpleMemoComponent)) {
    const currentSource = sourceFiber.alternate;
    if (currentSource !== null) {
      sourceFiber.updateQueue = currentSource.updateQueue;
      sourceFiber.memoizedState = currentSource.memoizedState;
      sourceFiber.lanes = currentSource.lanes;
    } else {
      sourceFiber.updateQueue = null;
      sourceFiber.memoizedState = null;
    }
  }
}

function markSuspenseBoundaryShouldCapture(suspenseBoundary: FiberNode, returnFiber: FiberNode | null, sourceFiber: FiberNode, root: FiberRootNode, rootRenderLanes: number): FiberNode {
  if ((suspenseBoundary.mode & ConcurrentMode) === NoMode) {
    // legacy: pretend the suspended component rendered null and keep going;
    // the boundary does a second (fallback) pass when it completes
    if (suspenseBoundary === returnFiber) {
      // suspended while reconciling the boundary's inner Offscreen wrapper:
      // nothing partially rendered, use the concurrent capture behavior
      suspenseBoundary.flags |= ShouldCapture;
    } else {
      suspenseBoundary.flags |= DidCapture;
      sourceFiber.flags |= ForceUpdateForLegacySuspense;
      // commit the incomplete fiber as-is (no lifecycles)
      sourceFiber.flags &= ~(LifecycleEffectMask | Incomplete);
      sourceFiber.lanes |= SyncLane;
    }
    return suspenseBoundary;
  }
  // concurrent capture: unwind to the boundary and render the fallback
  suspenseBoundary.flags |= ShouldCapture;
  suspenseBoundary.lanes = rootRenderLanes;
  return suspenseBoundary;
}

// ---- ping listeners (concurrent only) ----
function attachPingListener(root: FiberRootNode, wakeable: any, lanes: number): void {
  let pingCache: any = root.pingCache;
  let threadIDs: any;
  if (pingCache === null) {
    pingCache = new G.Map();
    root.pingCache = pingCache;
    threadIDs = new G.Set();
    pingCache.set(wakeable, threadIDs);
  } else {
    threadIDs = pingCache.get(wakeable);
    if (threadIDs === undefined) {
      threadIDs = new G.Set();
      pingCache.set(wakeable, threadIDs);
    }
  }
  if (!threadIDs.has(lanes)) {
    threadIDs.add(lanes);
    const ping: any = function (): void {
      pingSuspendedRoot(root, wakeable, lanes);
    };
    wakeable.then(ping, ping);
  }
}

function pingSuspendedRoot(root: FiberRootNode, wakeable: any, pingedLanes: number): void {
  const pingCache: any = root.pingCache;
  if (pingCache !== null) {
    pingCache.delete(wakeable);
  }
  const eventTime = requestEventTime();
  markRootPinged(root, pingedLanes);
  if (workInProgressRoot === root && isSubsetOfLanes(workInProgressRootRenderLanes, pingedLanes)) {
    // pinged at the priority we're currently rendering: maybe restart
    if (workInProgressRootExitStatus === RootSuspendedWithDelay ||
        (workInProgressRootExitStatus === RootSuspended &&
         includesOnlyRetries(workInProgressRootRenderLanes) &&
         schedGetNow() - globalMostRecentFallbackTime < FALLBACK_THROTTLE_MS)) {
      prepareFreshStack(root, NoLanes);
    } else {
      workInProgressRootPingedLanes |= pingedLanes;
    }
  }
  ensureRootIsScheduled(root, eventTime);
}

function throwException(root: FiberRootNode, returnFiber: FiberNode | null, sourceFiber: FiberNode, value: any, rootRenderLanes: number): void {
  sourceFiber.flags |= Incomplete;
  if (value !== null && typeof value === 'object' && typeof value.then === 'function') {
    const wakeable: any = value;
    resetSuspendedComponent(sourceFiber);
    const suspenseBoundary = getNearestSuspenseBoundaryToCapture(returnFiber);
    if (suspenseBoundary !== null) {
      markSuspenseBoundaryShouldCapture(suspenseBoundary, returnFiber, sourceFiber, root, rootRenderLanes);
      // ping listeners only in concurrent mode: legacy always commits
      // fallbacks synchronously, so there are no pings
      if ((suspenseBoundary.mode & ConcurrentMode) !== NoMode) {
        attachPingListener(root, wakeable, rootRenderLanes);
      }
      attachRetryListener(suspenseBoundary, wakeable);
      return;
    }
    // no boundary found
    if (!includesSyncLane(rootRenderLanes)) {
      // not a sync update: suspend the whole root, wait for data
      attachPingListener(root, wakeable, rootRenderLanes);
      renderDidSuspendDelayIfPossible();
      return;
    }
    throw new Error('a component suspended while responding to synchronous input with no Suspense boundary above it');
  }
  // no error boundaries in this port
  throw value;
}

function unwindWork(current: FiberNode | null, workInProgress: FiberNode): FiberNode | null {
  const tag = workInProgress.tag;
  if (tag === ContextProvider) {
    popProvider(workInProgress.type._context, workInProgress);
    return null;
  }
  if (tag === SuspenseComponent) {
    popSuspenseContext(workInProgress);
    const flags = workInProgress.flags;
    if ((flags & ShouldCapture) !== NoFlags) {
      workInProgress.flags = (flags & ~ShouldCapture) | DidCapture;
      return workInProgress;
    }
    return null;
  }
  if (tag === OffscreenComponent) {
    popRenderLanes(workInProgress);
    return null;
  }
  return null;
}

// ---- complete work ----
function appendAllChildren(parent: any, workInProgress: FiberNode, needsVisibilityToggle: boolean, isHidden: boolean): void {
  let node = workInProgress.child;
  while (node !== null) {
    if (node.tag === HostComponent) {
      let instance: any = node.stateNode;
      if (needsVisibilityToggle && isHidden) {
        instance = hcCloneHiddenInstance(instance, node.type, node.memoizedProps);
      }
      hcAppendChild(parent, instance);
    } else if (node.tag === HostText) {
      let instance2: any = node.stateNode;
      if (needsVisibilityToggle && isHidden) {
        instance2 = hcCloneHiddenTextInstance(instance2, node.memoizedProps);
      }
      hcAppendChild(parent, instance2);
    } else if (supportsPersistence && node.tag === OffscreenComponent && node.memoizedState !== null) {
      // hidden offscreen subtree (persistent mode): append hidden clones
      const oChild = node.child;
      if (oChild !== null) {
        oChild.ret = node;
      }
      appendAllChildren(parent, node, true, true);
    } else if (node.child !== null) {
      node.child.ret = node;
      node = node.child;
      continue;
    }
    if (node === workInProgress) {
      return;
    }
    while (node.sibling === null) {
      if (node.ret === null || node.ret === workInProgress) {
        return;
      }
      node = node.ret;
    }
    node.sibling.ret = node.ret;
    node = node.sibling;
  }
}

function appendAllChildrenToContainer(childSet: any, workInProgress: FiberNode, needsVisibilityToggle: boolean, isHidden: boolean): void {
  let node = workInProgress.child;
  while (node !== null) {
    if (node.tag === HostComponent) {
      let instance: any = node.stateNode;
      if (needsVisibilityToggle && isHidden) {
        instance = hcCloneHiddenInstance(instance, node.type, node.memoizedProps);
      }
      hcAppendChildToContainerChildSet(childSet, instance);
    } else if (node.tag === HostText) {
      let instance2: any = node.stateNode;
      if (needsVisibilityToggle && isHidden) {
        instance2 = hcCloneHiddenTextInstance(instance2, node.memoizedProps);
      }
      hcAppendChildToContainerChildSet(childSet, instance2);
    } else if (node.tag === OffscreenComponent && node.memoizedState !== null) {
      const oChild = node.child;
      if (oChild !== null) {
        oChild.ret = node;
      }
      appendAllChildrenToContainer(childSet, node, true, true);
    } else if (node.child !== null) {
      node.child.ret = node;
      node = node.child;
      continue;
    }
    if (node === workInProgress) {
      return;
    }
    while (node.sibling === null) {
      if (node.ret === null || node.ret === workInProgress) {
        return;
      }
      node = node.ret;
    }
    node.sibling.ret = node.ret;
    node = node.sibling;
  }
}

// React: hadNoMutationsEffects — children unchanged iff no mutation-mask
// effects in the completed children (bailed-out subtrees keep fiber identity).
function hadNoMutationsEffects(current: FiberNode | null, completedWork: FiberNode): boolean {
  if (current !== null && current.child === completedWork.child) {
    return true;
  }
  if ((completedWork.flags & ChildDeletion) !== NoFlags) {
    return false;
  }
  let child = completedWork.child;
  while (child !== null) {
    if ((child.flags & MutationMask) !== NoFlags || (child.subtreeFlags & MutationMask) !== NoFlags) {
      return false;
    }
    child = child.sibling;
  }
  return true;
}

// persistent-mode host root completion (React: updateHostContainer)
function updateHostContainer(current: FiberNode | null, workInProgress: FiberNode): void {
  const root: FiberRootNode = workInProgress.stateNode;
  const childrenUnchanged = hadNoMutationsEffects(current, workInProgress);
  if (!childrenUnchanged) {
    const container: any = root.containerInfo;
    const newChildSet: any = hcCreateContainerChildSet();
    appendAllChildrenToContainer(newChildSet, workInProgress, false, false);
    root.pendingChildren = newChildSet;
    workInProgress.flags |= Update;
    hcFinalizeContainerChildren(container, newChildSet);
  }
}

function bubbleProperties(completedWork: FiberNode): void {
  // React: when the fiber bailed out (children are the CURRENT fibers, not
  // fresh work-in-progress clones), only static flags bubble — otherwise
  // stale effect flags (Ref/Passive/Update) from previous commits would leak
  // into subtreeFlags and re-fire effects/ref-attaches on bailed subtrees.
  // This port tracks no static flags, so the bailout path bubbles lanes only.
  const alt = completedWork.alternate;
  const didBailout = alt !== null && alt.child === completedWork.child;
  let newChildLanes = NoLanes;
  let subtreeFlags = NoFlags;
  let child = completedWork.child;
  if (didBailout) {
    while (child !== null) {
      newChildLanes = newChildLanes | child.lanes | child.childLanes;
      child.ret = completedWork;
      child = child.sibling;
    }
  } else {
    while (child !== null) {
      newChildLanes = newChildLanes | child.lanes | child.childLanes;
      subtreeFlags = subtreeFlags | child.subtreeFlags | child.flags;
      child.ret = completedWork;
      child = child.sibling;
    }
  }
  completedWork.subtreeFlags |= subtreeFlags;
  completedWork.childLanes = newChildLanes;
}

function completeWork(current: FiberNode | null, workInProgress: FiberNode): FiberNode | null {
  const newProps: any = workInProgress.pendingProps;
  const tag = workInProgress.tag;
  if (tag === HostComponent) {
    if (current !== null && workInProgress.stateNode !== null) {
      if (supportsMutation) {
        const oldProps: any = current.memoizedProps;
        if (oldProps !== newProps) {
          const payload: any = diffHostProps(oldProps, newProps, current.stateNode);
          workInProgress.updateQueue = payload;
          if (payload !== null) {
            workInProgress.flags |= Update;
          }
        }
      } else {
        // persistent (Fabric-shaped): clone instances instead of mutating
        const currentInstance: any = current.stateNode;
        const oldPropsP: any = current.memoizedProps;
        const childrenUnchanged = hadNoMutationsEffects(current, workInProgress);
        if (childrenUnchanged && oldPropsP === newProps) {
          workInProgress.stateNode = currentInstance;
        } else {
          const payloadP: any = oldPropsP !== newProps ? diffHostProps(oldPropsP, newProps, currentInstance) : null;
          if (childrenUnchanged && payloadP === null) {
            workInProgress.stateNode = currentInstance;
          } else {
            const newInstance: any = hcCloneInstance(
              currentInstance, payloadP, workInProgress.type, newProps, childrenUnchanged);
            workInProgress.stateNode = newInstance;
            if (childrenUnchanged) {
              workInProgress.flags |= Update;
            } else {
              appendAllChildren(newInstance, workInProgress, false, false);
            }
          }
        }
      }
    } else {
      const instance: any = hcCreateInstance(workInProgress.type, newProps, workInProgress);
      appendAllChildren(instance, workInProgress, false, false);
      workInProgress.stateNode = instance;
    }
    bubbleProperties(workInProgress);
    return null;
  }
  if (tag === HostText) {
    if (current !== null && workInProgress.stateNode !== null) {
      const oldText: any = current.memoizedProps;
      if (supportsMutation) {
        if (oldText !== newProps) {
          workInProgress.flags |= Update;
        }
      } else {
        if (oldText !== newProps) {
          workInProgress.stateNode = hcCreateTextInstance(newProps, workInProgress);
          workInProgress.flags |= Update;
        } else {
          workInProgress.stateNode = current.stateNode;
        }
      }
    } else {
      workInProgress.stateNode = hcCreateTextInstance(newProps, workInProgress);
    }
    bubbleProperties(workInProgress);
    return null;
  }
  if (tag === HostRoot) {
    if (supportsPersistence) {
      updateHostContainer(current, workInProgress);
    }
    bubbleProperties(workInProgress);
    return null;
  }
  if (tag === ContextProvider) {
    popProvider(workInProgress.type._context, workInProgress);
    bubbleProperties(workInProgress);
    return null;
  }
  if (tag === SuspenseComponent) {
    popSuspenseContext(workInProgress);
    const nextState: any = workInProgress.memoizedState;
    if ((workInProgress.flags & DidCapture) !== NoFlags) {
      // the boundary captured mid-complete — re-render it to show the
      // fallback. Don't bubble; don't reset the effect list.
      workInProgress.lanes = subtreeRenderLanes;
      return workInProgress;
    }
    const nextDidTimeout = nextState !== null;
    const prevDidTimeout = current !== null && current.memoizedState !== null;
    if (nextDidTimeout !== prevDidTimeout) {
      if (nextDidTimeout) {
        const offscreenFiber = workInProgress.child;
        if (offscreenFiber !== null) {
          offscreenFiber.flags |= Visibility;
        }
        if ((workInProgress.mode & ConcurrentMode) !== NoMode) {
          // decide whether the whole render should suspend the commit
          const hasInvisibleChildContext = current === null;
          if (hasInvisibleChildContext ||
              (suspenseCtxCurrent & InvisibleParentSuspenseContext) !== 0) {
            // in an invisible tree or a new render: showing this fallback is ok
            renderDidSuspend();
          } else {
            // we would be hiding visible content: suspend longer if possible
            renderDidSuspendDelayIfPossible();
          }
        }
      }
    }
    if (workInProgress.updateQueue !== null) {
      // wakeables pending: commit attaches retry listeners
      workInProgress.flags |= Update;
    }
    bubbleProperties(workInProgress);
    return null;
  }
  if (tag === OffscreenComponent) {
    popRenderLanes(workInProgress);
    const nextStateO: any = workInProgress.memoizedState;
    const nextIsHidden = nextStateO !== null;
    if (current !== null) {
      const prevIsHidden = current.memoizedState !== null;
      if (prevIsHidden !== nextIsHidden) {
        workInProgress.flags |= Visibility;
      }
    }
    if (!nextIsHidden || (workInProgress.mode & ConcurrentMode) === NoMode) {
      bubbleProperties(workInProgress);
    } else {
      // hidden concurrent tree: only bubble when rendering at Offscreen
      // priority
      if ((subtreeRenderLanes & OffscreenLane) !== NoLanes) {
        bubbleProperties(workInProgress);
        if (supportsMutation) {
          // insertions/updates inside the hidden subtree must be re-hidden
          if ((workInProgress.subtreeFlags & (Placement | Update)) !== NoFlags) {
            workInProgress.flags |= Visibility;
          }
        }
      }
    }
    return null;
  }
  bubbleProperties(workInProgress);
  return null;
}

// ---- commit (mutation phase) ----
function isHostParentFiber(fiber: FiberNode): boolean {
  return fiber.tag === HostComponent || fiber.tag === HostRoot;
}

function getHostParentFiber(fiber: FiberNode): FiberNode {
  let parent = fiber.ret;
  while (parent !== null) {
    if (isHostParentFiber(parent)) {
      return parent;
    }
    parent = parent.ret;
  }
  throw new Error('no host parent');
}

function getHostSibling(fiber: FiberNode): any {
  let node: FiberNode = fiber;
  while (true) {
    while (node.sibling === null) {
      const r = node.ret;
      if (r === null || isHostParentFiber(r)) {
        return null;
      }
      node = r;
    }
    const sib = node.sibling;
    sib.ret = node.ret;
    node = sib;
    let bail = false;
    while (node.tag !== HostComponent && node.tag !== HostText) {
      if ((node.flags & Placement) !== NoFlags) {
        bail = true;
        break;
      }
      const c = node.child;
      if (c === null) {
        bail = true;
        break;
      }
      c.ret = node;
      node = c;
    }
    if (bail) {
      continue;
    }
    if ((node.flags & Placement) === NoFlags) {
      return node.stateNode;
    }
  }
}

function insertOrAppendPlacementNode(node: FiberNode, before: any, parent: any): void {
  if (node.tag === HostComponent || node.tag === HostText) {
    if (before !== null) {
      hcInsertBefore(parent, node.stateNode, before);
    } else {
      hcAppendChild(parent, node.stateNode);
    }
    return;
  }
  let child = node.child;
  while (child !== null) {
    insertOrAppendPlacementNode(child, before, parent);
    child = child.sibling;
  }
}

function commitPlacement(finishedWork: FiberNode): void {
  const parentFiber = getHostParentFiber(finishedWork);
  let parent: any;
  if (parentFiber.tag === HostComponent) {
    parent = parentFiber.stateNode;
  } else {
    parent = parentFiber.stateNode.containerInfo;
  }
  const before: any = getHostSibling(finishedWork);
  insertOrAppendPlacementNode(finishedWork, before, parent);
}

function commitAttachRef(finishedWork: FiberNode): void {
  const ref: any = finishedWork.ref;
  if (ref !== null) {
    const instance: any = finishedWork.stateNode;
    if (typeof ref === 'function') {
      ref(instance);
    } else {
      ref.current = instance;
    }
  }
}

function safelyDetachRef(current: FiberNode): void {
  const ref: any = current.ref;
  if (ref !== null) {
    if (typeof ref === 'function') {
      ref(null);
    } else {
      ref.current = null;
    }
  }
}

function commitHookEffectListUnmount(flags: number, finishedWork: FiberNode): void {
  const updateQueue: any = finishedWork.updateQueue;
  const lastEffect: any = updateQueue !== null ? updateQueue.lastEffect : null;
  if (lastEffect !== null) {
    const firstEffect: any = lastEffect.next;
    let effect: any = firstEffect;
    do {
      if ((effect.tag & flags) === flags) {
        const destroy: any = effect.destroy;
        effect.destroy = undefined;
        if (destroy !== undefined && destroy !== null) {
          destroy();
        }
      }
      effect = effect.next;
    } while (effect !== firstEffect);
  }
}

function commitHookEffectListMount(flags: number, finishedWork: FiberNode): void {
  const updateQueue: any = finishedWork.updateQueue;
  const lastEffect: any = updateQueue !== null ? updateQueue.lastEffect : null;
  if (lastEffect !== null) {
    const firstEffect: any = lastEffect.next;
    let effect: any = firstEffect;
    do {
      if ((effect.tag & flags) === flags) {
        effect.destroy = effect.create();
      }
      effect = effect.next;
    } while (effect !== firstEffect);
  }
}

// Whether the subtree being committed is inside a hidden (or being-hidden)
// Offscreen tree; gates layout-effect mounts, ref attach/detach, and
// deletion-time layout destroys (their effects already disappeared).
let offscreenSubtreeIsHidden = false;
let offscreenSubtreeWasHidden = false;

// React's deletion pass destroys insertion/layout effects inline (parent ->
// child order), WITHOUT clearing effect.destroy — passive destroys for the
// same fibers run later, in the passive-unmount pass.
function commitDeletionHookEffects(deletedFiber: FiberNode): void {
  const updateQueue: any = deletedFiber.updateQueue;
  if (updateQueue !== null) {
    const lastEffect: any = updateQueue.lastEffect;
    if (lastEffect !== null) {
      const firstEffect: any = lastEffect.next;
      let effect: any = firstEffect;
      do {
        const destroy: any = effect.destroy;
        if (destroy !== undefined && destroy !== null) {
          if ((effect.tag & HookInsertion) !== NoFlags) {
            destroy();
          } else if ((effect.tag & HookLayout) !== NoFlags) {
            destroy();
          }
        }
        effect = effect.next;
      } while (effect !== firstEffect);
    }
  }
}

function commitDeletionEffectsOnFiber(deletedFiber: FiberNode, hostParent: any): void {
  const tag = deletedFiber.tag;
  if (tag === OffscreenComponent) {
    if ((deletedFiber.mode & ConcurrentMode) !== NoMode) {
      // if this tree is hidden its effects already disappeared — don't
      // unmount them again below
      const prevWasHiddenDel = offscreenSubtreeWasHidden;
      offscreenSubtreeWasHidden = prevWasHiddenDel || deletedFiber.memoizedState !== null;
      let childDel = deletedFiber.child;
      while (childDel !== null) {
        commitDeletionEffectsOnFiber(childDel, hostParent);
        childDel = childDel.sibling;
      }
      offscreenSubtreeWasHidden = prevWasHiddenDel;
    } else {
      let childDel2 = deletedFiber.child;
      while (childDel2 !== null) {
        commitDeletionEffectsOnFiber(childDel2, hostParent);
        childDel2 = childDel2.sibling;
      }
    }
    return;
  }
  if (tag === HostComponent || tag === HostText) {
    if (tag === HostComponent) {
      if (!offscreenSubtreeWasHidden) {
        safelyDetachRef(deletedFiber);
      }
    }
    if (supportsMutation) {
      let inner = deletedFiber.child;
      while (inner !== null) {
        commitDeletionEffectsOnFiber(inner, null);
        inner = inner.sibling;
      }
      if (hostParent !== null) {
        hcRemoveChild(hostParent, deletedFiber.stateNode);
      }
    } else {
      let inner2 = deletedFiber.child;
      while (inner2 !== null) {
        commitDeletionEffectsOnFiber(inner2, hostParent);
        inner2 = inner2.sibling;
      }
    }
    return;
  }
  if (tag === FunctionComponent || tag === SimpleMemoComponent || tag === ForwardRef) {
    if (!offscreenSubtreeWasHidden) {
      commitDeletionHookEffects(deletedFiber);
    }
  }
  let child = deletedFiber.child;
  while (child !== null) {
    commitDeletionEffectsOnFiber(child, hostParent);
    child = child.sibling;
  }
}

function commitDeletionEffects(root: FiberRootNode, returnFiber: FiberNode, deletedFiber: FiberNode): void {
  let parent: FiberNode | null = returnFiber;
  let hostParent: any = null;
  while (parent !== null) {
    if (parent.tag === HostComponent) {
      hostParent = parent.stateNode;
      break;
    }
    if (parent.tag === HostRoot) {
      hostParent = parent.stateNode.containerInfo;
      break;
    }
    parent = parent.ret;
  }
  commitDeletionEffectsOnFiber(deletedFiber, hostParent);
}

function commitReconciliationEffects(finishedWork: FiberNode): void {
  if ((finishedWork.flags & Placement) !== NoFlags) {
    if (supportsMutation) {
      commitPlacement(finishedWork);
    }
    finishedWork.flags &= ~Placement;
  }
}

function commitMutationEffectsOnFiber(finishedWork: FiberNode, root: FiberRootNode): void {
  const current = finishedWork.alternate;
  // an Offscreen fiber that is (or was) hidden traverses its subtree with
  // offscreenSubtreeWasHidden set, so already-disappeared effects are not
  // unmounted a second time
  const isConcurrentOffscreen = finishedWork.tag === OffscreenComponent &&
    (finishedWork.mode & ConcurrentMode) !== NoMode;
  let savedWasHidden = false;
  if (isConcurrentOffscreen) {
    savedWasHidden = offscreenSubtreeWasHidden;
    offscreenSubtreeWasHidden = savedWasHidden || (current !== null && current.memoizedState !== null);
  }
  // recursivelyTraverseMutationEffects — deletions persist on the fiber for
  // the passive-unmount pass (React clears them during flushPassiveEffects).
  const deletions: any = finishedWork.deletions;
  if (deletions !== null) {
    for (let i = 0; i < deletions.length; i++) {
      commitDeletionEffects(root, finishedWork, deletions[i]);
    }
  }
  if ((finishedWork.subtreeFlags & MutationMask) !== NoFlags) {
    let child = finishedWork.child;
    while (child !== null) {
      commitMutationEffectsOnFiber(child, root);
      child = child.sibling;
    }
  }
  if (isConcurrentOffscreen) {
    offscreenSubtreeWasHidden = savedWasHidden;
  }
  commitReconciliationEffects(finishedWork);
  const tag = finishedWork.tag;
  if (tag === FunctionComponent || tag === SimpleMemoComponent || tag === ForwardRef) {
    if ((finishedWork.flags & Update) !== NoFlags) {
      commitHookEffectListUnmount(HookInsertion | HookHasEffect, finishedWork);
      commitHookEffectListMount(HookInsertion | HookHasEffect, finishedWork);
      // Layout effects are destroyed during the mutation phase so that all
      // destroy functions run before any create functions.
      commitHookEffectListUnmount(HookLayout | HookHasEffect, finishedWork);
    }
    return;
  }
  if (tag === HostComponent) {
    if ((finishedWork.flags & Ref) !== NoFlags && current !== null) {
      safelyDetachRef(current);
    }
    if (supportsMutation && (finishedWork.flags & Update) !== NoFlags) {
      const payload: any = finishedWork.updateQueue;
      finishedWork.updateQueue = null;
      if (payload !== null) {
        hcCommitUpdate(finishedWork.stateNode, payload, finishedWork.memoizedProps);
      }
      finishedWork.flags &= ~Update;
    }
    return;
  }
  if (tag === HostText) {
    if (supportsMutation && (finishedWork.flags & Update) !== NoFlags) {
      const currentText = finishedWork.alternate;
      const oldText: any = currentText !== null ? currentText.memoizedProps : '';
      hcCommitTextUpdate(finishedWork.stateNode, oldText, finishedWork.memoizedProps);
      finishedWork.flags &= ~Update;
    }
    return;
  }
  if (tag === HostRoot) {
    if (supportsPersistence && (finishedWork.flags & Update) !== NoFlags) {
      hcReplaceContainerChildren(root.containerInfo, root.pendingChildren);
      finishedWork.flags &= ~Update;
    }
    return;
  }
  if (tag === SuspenseComponent) {
    const offscreenFiber = finishedWork.child;
    if (offscreenFiber !== null && (offscreenFiber.flags & Visibility) !== NoFlags) {
      const suspIsHidden = offscreenFiber.memoizedState !== null;
      if (suspIsHidden) {
        const suspWasHidden = offscreenFiber.alternate !== null && offscreenFiber.alternate.memoizedState !== null;
        if (!suspWasHidden) {
          // a new fallback committed: start the retry throttle window
          markCommitTimeOfFallback();
        }
      }
    }
    if ((finishedWork.flags & Update) !== NoFlags) {
      attachSuspenseRetryListeners(finishedWork);
    }
    return;
  }
  if (tag === OffscreenComponent) {
    if ((finishedWork.flags & Visibility) !== NoFlags) {
      const isHidden = finishedWork.memoizedState !== null;
      if (isHidden) {
        const wasHidden = current !== null && current.memoizedState !== null;
        if (!wasHidden && (finishedWork.mode & ConcurrentMode) !== NoMode) {
          // going hidden: disconnect the subtree's layout effects and refs
          let oc = finishedWork.child;
          while (oc !== null) {
            disappearLayoutEffectsWalk(oc);
            oc = oc.sibling;
          }
        }
      }
      if (supportsMutation) {
        hideOrUnhideAllChildren(finishedWork, isHidden);
      }
    }
    return;
  }
}

// pre-order unmount of ALL layout effects + host ref detach in a subtree
// that is being hidden (React: disappearLayoutEffects)
function disappearLayoutEffectsWalk(node: FiberNode): void {
  const tag = node.tag;
  if (tag === FunctionComponent || tag === SimpleMemoComponent || tag === ForwardRef || tag === MemoComponent) {
    commitHookEffectListUnmount(HookLayout, node);
  } else if (tag === HostComponent) {
    safelyDetachRef(node);
  } else if (tag === OffscreenComponent) {
    if (node.memoizedState !== null) {
      // nested tree is already hidden: its effects already disappeared
      return;
    }
  }
  let child = node.child;
  while (child !== null) {
    disappearLayoutEffectsWalk(child);
    child = child.sibling;
  }
}

// ---- Suspense commit (retry listeners + visibility) ----
function attachSuspenseRetryListeners(finishedWork: FiberNode): void {
  const wakeables: any = finishedWork.updateQueue;
  if (wakeables !== null) {
    finishedWork.updateQueue = null;
    let retryCache: any = finishedWork.stateNode;
    if (retryCache === null) {
      retryCache = new G.Set();
      finishedWork.stateNode = retryCache;
    }
    wakeables.forEach(function (wakeable: any): void {
      if (!retryCache.has(wakeable)) {
        retryCache.add(wakeable);
        const retry: any = function (): void {
          resolveRetryWakeable(finishedWork, wakeable);
        };
        wakeable.then(retry, retry);
      }
    });
  }
}

function hideOrUnhideAllChildren(finishedWork: FiberNode, isHidden: boolean): void {
  let hostSubtreeRoot: FiberNode | null = null;
  let node: FiberNode = finishedWork;
  while (true) {
    if (node.tag === HostComponent) {
      if (hostSubtreeRoot === null) {
        hostSubtreeRoot = node;
        if (isHidden) {
          hcHideInstance(node.stateNode);
        } else {
          hcUnhideInstance(node.stateNode, node.memoizedProps);
        }
      }
    } else if (node.tag === HostText) {
      if (hostSubtreeRoot === null) {
        if (isHidden) {
          hcHideTextInstance(node.stateNode);
        } else {
          hcUnhideTextInstance(node.stateNode, node.memoizedProps);
        }
      }
    } else if (node.tag === OffscreenComponent && node.memoizedState !== null && node !== finishedWork) {
      // nested hidden offscreen: leave as-is
    } else if (node.child !== null) {
      node.child.ret = node;
      node = node.child;
      continue;
    }
    if (node === finishedWork) {
      return;
    }
    while (node.sibling === null) {
      if (node.ret === null || node.ret === finishedWork) {
        return;
      }
      if (hostSubtreeRoot === node) {
        hostSubtreeRoot = null;
      }
      node = node.ret;
    }
    if (hostSubtreeRoot === node) {
      hostSubtreeRoot = null;
    }
    node.sibling.ret = node.ret;
    node = node.sibling;
  }
}

// ---- commit (layout phase) ----
// post-order remount of ALL layout effects + host ref attach in a subtree
// that is reappearing (React: reappearLayoutEffects)
function reappearLayoutEffectsWalk(node: FiberNode): void {
  const skipChildren = node.tag === OffscreenComponent && node.memoizedState !== null;
  if (!skipChildren) {
    let child = node.child;
    while (child !== null) {
      reappearLayoutEffectsWalk(child);
      child = child.sibling;
    }
  }
  const tag = node.tag;
  if (tag === FunctionComponent || tag === SimpleMemoComponent || tag === ForwardRef) {
    commitHookEffectListMount(HookLayout, node);
  } else if (tag === HostComponent) {
    commitAttachRef(node);
  }
}

function commitLayoutEffectOnFiberPort(finishedWork: FiberNode): void {
  if ((finishedWork.flags & LayoutMask) === NoFlags) {
    return;
  }
  const tag = finishedWork.tag;
  if (tag === FunctionComponent || tag === SimpleMemoComponent || tag === ForwardRef) {
    if (!offscreenSubtreeWasHidden) {
      commitHookEffectListMount(HookLayout | HookHasEffect, finishedWork);
    }
  }
  if (!offscreenSubtreeWasHidden) {
    if ((finishedWork.flags & Ref) !== NoFlags && tag === HostComponent) {
      commitAttachRef(finishedWork);
    }
  }
}

function commitLayoutEffects(finishedWork: FiberNode): void {
  const isModernRoot = (finishedWork.mode & ConcurrentMode) !== NoMode;
  commitLayoutEffectsTree(finishedWork, isModernRoot);
}

function commitLayoutEffectsTree(fiber: FiberNode, isModernRoot: boolean): void {
  if (fiber.tag === OffscreenComponent && isModernRoot) {
    const isHidden = fiber.memoizedState !== null;
    const newIsHidden = isHidden || offscreenSubtreeIsHidden;
    if (newIsHidden) {
      // hidden subtree: skip its layout effects entirely
      commitLayoutEffectOnFiberPort(fiber);
      return;
    }
    const currentO = fiber.alternate;
    const wasHidden = currentO !== null && currentO.memoizedState !== null;
    const newWasHidden = wasHidden || offscreenSubtreeWasHidden;
    const prevIsHidden = offscreenSubtreeIsHidden;
    const prevWasHidden = offscreenSubtreeWasHidden;
    offscreenSubtreeIsHidden = newIsHidden;
    offscreenSubtreeWasHidden = newWasHidden;
    if (offscreenSubtreeWasHidden && !prevWasHidden) {
      // root of a reappearing boundary: turn its layout effects back on
      reappearLayoutEffectsWalk(fiber);
    }
    let childO = fiber.child;
    while (childO !== null) {
      commitLayoutEffectsTree(childO, isModernRoot);
      childO = childO.sibling;
    }
    offscreenSubtreeIsHidden = prevIsHidden;
    offscreenSubtreeWasHidden = prevWasHidden;
    commitLayoutEffectOnFiberPort(fiber);
    return;
  }
  if ((fiber.subtreeFlags & LayoutMask) !== NoFlags) {
    let child = fiber.child;
    while (child !== null) {
      commitLayoutEffectsTree(child, isModernRoot);
      child = child.sibling;
    }
  }
  commitLayoutEffectOnFiberPort(fiber);
}

// ---- commit (passive phase) ----
function commitPassiveUnmountInsideDeletedTree(fiber: FiberNode): void {
  // deletion effects fire in parent -> child order
  if (fiber.tag === FunctionComponent || fiber.tag === SimpleMemoComponent || fiber.tag === ForwardRef) {
    commitHookEffectListUnmount(HookPassive, fiber);
  }
  let child = fiber.child;
  while (child !== null) {
    commitPassiveUnmountInsideDeletedTree(child);
    child = child.sibling;
  }
}

function commitPassiveUnmountOnTree(fiber: FiberNode): void {
  if ((fiber.flags & ChildDeletion) !== NoFlags) {
    const deletions: any = fiber.deletions;
    if (deletions !== null) {
      for (let i = 0; i < deletions.length; i++) {
        commitPassiveUnmountInsideDeletedTree(deletions[i]);
      }
      fiber.deletions = null;
    }
  }
  if ((fiber.subtreeFlags & PassiveMask) !== NoFlags) {
    let child = fiber.child;
    while (child !== null) {
      commitPassiveUnmountOnTree(child);
      child = child.sibling;
    }
  }
  if ((fiber.flags & Passive) !== NoFlags &&
      (fiber.tag === FunctionComponent || fiber.tag === SimpleMemoComponent || fiber.tag === ForwardRef)) {
    commitHookEffectListUnmount(HookPassive | HookHasEffect, fiber);
  }
}

function commitPassiveMountOnTree(fiber: FiberNode): void {
  if ((fiber.subtreeFlags & PassiveMask) !== NoFlags) {
    let child = fiber.child;
    while (child !== null) {
      commitPassiveMountOnTree(child);
      child = child.sibling;
    }
  }
  if ((fiber.flags & Passive) !== NoFlags &&
      (fiber.tag === FunctionComponent || fiber.tag === SimpleMemoComponent || fiber.tag === ForwardRef)) {
    commitHookEffectListMount(HookPassive | HookHasEffect, fiber);
  }
}

// ---- work loop (ReactFiberWorkLoop, both root modes) ----
let executionContext = NoContext;
let workInProgressRoot: FiberRootNode | null = null;
let workInProgress: FiberNode | null = null;
let workInProgressRootRenderLanes = NoLanes;
// renderLanes as seen by begin/complete: differs from the root render lanes
// only inside hidden (Offscreen) subtrees
let subtreeRenderLanes = NoLanes;
const subtreeRenderLanesStack: any = new G.Array();
let workInProgressRootExitStatus = RootInProgress;
let workInProgressRootSkippedLanes = NoLanes;
let workInProgressRootInterleavedUpdatedLanes = NoLanes;
let workInProgressRootPingedLanes = NoLanes;
let globalMostRecentFallbackTime = 0;
const FALLBACK_THROTTLE_MS = 500;
let workInProgressRootRenderTargetTime = 1000000000;
const RENDER_TIMEOUT_MS = 500;
let rootDoesHavePassiveEffects = false;
let rootWithPendingPassiveEffects: FiberRootNode | null = null;
let pendingPassiveEffectsLanes = NoLanes;
let currentEventTime = NoTimestamp;
let currentEventTransitionLane = NoLanes;

function resetRenderTimer(): void {
  workInProgressRootRenderTargetTime = schedGetNow() + RENDER_TIMEOUT_MS;
}

function requestEventTime(): number {
  if ((executionContext & (RenderContext | CommitContext)) !== NoContext) {
    return schedGetNow();
  }
  if (currentEventTime !== NoTimestamp) {
    return currentEventTime;
  }
  currentEventTime = schedGetNow();
  return currentEventTime;
}

function requestUpdateLane(fiber: FiberNode): number {
  const mode = fiber.mode;
  if ((mode & ConcurrentMode) === NoMode) {
    return SyncLane;
  }
  if ((executionContext & RenderContext) !== NoContext && workInProgressRootRenderLanes !== NoLanes) {
    // render-phase update fallback: same thread as the current render
    return getHighestPriorityLane(workInProgressRootRenderLanes);
  }
  const isTransition = requestCurrentTransition() !== null;
  if (isTransition) {
    if (currentEventTransitionLane === NoLane) {
      // all transitions within the same event share a lane
      currentEventTransitionLane = claimNextTransitionLane();
    }
    return currentEventTransitionLane;
  }
  const updateLane = getCurrentUpdatePriority();
  if (updateLane !== NoLane) {
    return updateLane;
  }
  return getCurrentEventPriority();
}

function requestRetryLane(fiber: FiberNode): number {
  const mode = fiber.mode;
  if ((mode & ConcurrentMode) === NoMode) {
    return SyncLane;
  }
  return claimNextRetryLane();
}

// ---- sync callback queue (ReactFiberSyncTaskQueue) ----
let syncQueue: any = null;
let includesLegacySyncCallbacks = false;
let isFlushingSyncQueue = false;

function scheduleSyncCallback(callback: any): void {
  if (syncQueue === null) {
    syncQueue = new G.Array();
  }
  syncQueue.push(callback);
}

function scheduleLegacySyncCallback(callback: any): void {
  includesLegacySyncCallbacks = true;
  scheduleSyncCallback(callback);
}

function flushSyncCallbacksOnlyInLegacyMode(): void {
  if (includesLegacySyncCallbacks) {
    flushSyncCallbacks();
  }
}

function flushSyncCallbacks(): any {
  if (!isFlushingSyncQueue && syncQueue !== null) {
    isFlushingSyncQueue = true;
    let i = 0;
    const previousUpdatePriority = getCurrentUpdatePriority();
    try {
      const queue: any = syncQueue;
      setCurrentUpdatePriority(DiscreteEventPriority);
      for (; i < queue.length; i++) {
        let callback: any = queue[i];
        while (callback !== null) {
          callback = callback(true);
        }
      }
      syncQueue = null;
      includesLegacySyncCallbacks = false;
    } finally {
      setCurrentUpdatePriority(previousUpdatePriority);
      isFlushingSyncQueue = false;
    }
  }
  return null;
}

// ---- render-phase status markers ----
function markSkippedUpdateLanes(lane: number): void {
  workInProgressRootSkippedLanes |= lane;
}

function renderDidSuspend(): void {
  if (workInProgressRootExitStatus === RootInProgress) {
    workInProgressRootExitStatus = RootSuspended;
  }
}

function renderDidSuspendDelayIfPossible(): void {
  if (workInProgressRootExitStatus === RootInProgress ||
      workInProgressRootExitStatus === RootSuspended ||
      workInProgressRootExitStatus === RootErrored) {
    workInProgressRootExitStatus = RootSuspendedWithDelay;
  }
  const wipRoot = workInProgressRoot;
  if (wipRoot !== null &&
      (includesNonIdleWork(workInProgressRootSkippedLanes) || includesNonIdleWork(workInProgressRootInterleavedUpdatedLanes))) {
    markRootSuspendedWip(wipRoot, workInProgressRootRenderLanes);
  }
}

function markCommitTimeOfFallback(): void {
  globalMostRecentFallbackTime = schedGetNow();
}

// markRootSuspended$1: exclude lanes pinged or updated during the render
function markRootSuspendedWip(root: FiberRootNode, suspendedLanes: number): void {
  let sl = suspendedLanes & ~workInProgressRootPingedLanes;
  sl = sl & ~workInProgressRootInterleavedUpdatedLanes;
  markRootSuspendedBase(root, sl);
}

// ---- scheduling ----
function scheduleUpdateOnFiber(root: FiberRootNode, fiber: FiberNode, lane: number, eventTime: number): void {
  markRootUpdated(root, lane, eventTime);
  if ((executionContext & RenderContext) !== NoContext && root === workInProgressRoot) {
    // render-phase update: tracked but unsupported here (hook dispatchers
    // already throw); root updates never dispatch mid-render in this port
    return;
  }
  if (root === workInProgressRoot) {
    if ((executionContext & RenderContext) === NoContext) {
      workInProgressRootInterleavedUpdatedLanes |= lane;
    }
    if (workInProgressRootExitStatus === RootSuspendedWithDelay) {
      // already delayed: this render won't finish; suspend it now so the
      // incoming update interrupts it
      markRootSuspendedWip(root, workInProgressRootRenderLanes);
    }
  }
  ensureRootIsScheduled(root, eventTime);
  if (lane === SyncLane && executionContext === NoContext && (fiber.mode & ConcurrentMode) === NoMode) {
    resetRenderTimer();
    flushSyncCallbacksOnlyInLegacyMode();
  }
}

function ensureRootIsScheduled(root: FiberRootNode, currentTime: number): void {
  const existingCallbackNode: any = root.callbackNode;
  markStarvedLanesAsExpired(root, currentTime);
  const nextLanes = getNextLanes(root, root === workInProgressRoot ? workInProgressRootRenderLanes : NoLanes);
  if (nextLanes === NoLanes) {
    if (existingCallbackNode !== null) {
      cancelSchedulerCallback(existingCallbackNode);
    }
    root.callbackNode = null;
    root.callbackPriority = NoLane;
    return;
  }
  const newCallbackPriority = getHighestPriorityLane(nextLanes);
  const existingCallbackPriority = root.callbackPriority;
  if (existingCallbackPriority === newCallbackPriority) {
    // priority unchanged: reuse the existing task
    return;
  }
  if (existingCallbackNode !== null) {
    cancelSchedulerCallback(existingCallbackNode);
  }
  let newCallbackNode: any = null;
  if (newCallbackPriority === SyncLane) {
    if (root.tag === LegacyRoot) {
      scheduleLegacySyncCallback(function (isSync: any): any {
        performSyncWorkOnRoot(root);
        return null;
      });
    } else {
      scheduleSyncCallback(function (isSync: any): any {
        performSyncWorkOnRoot(root);
        return null;
      });
    }
    // supportsMicrotasks=false: the sync queue is flushed from an Immediate
    // scheduler task (or earlier, by flushSync/commit/passive tails)
    scheduleSchedulerCallback(ImmediateSchedPriority, function (didTimeout: boolean): any {
      flushSyncCallbacks();
      return null;
    });
    newCallbackNode = null;
  } else {
    let schedulerPriorityLevel = NormalSchedPriority;
    const ep = lanesToEventPriority(nextLanes);
    if (ep === DiscreteEventPriority) {
      schedulerPriorityLevel = ImmediateSchedPriority;
    } else if (ep === ContinuousEventPriority) {
      schedulerPriorityLevel = UserBlockingSchedPriority;
    } else if (ep === IdleEventPriority) {
      schedulerPriorityLevel = IdleSchedPriority;
    }
    newCallbackNode = scheduleSchedulerCallback(schedulerPriorityLevel, function (didTimeout: boolean): any {
      return performConcurrentWorkOnRoot(root, didTimeout);
    });
  }
  root.callbackPriority = newCallbackPriority;
  root.callbackNode = newCallbackNode;
}

// ---- concurrent entry point ----
function performConcurrentWorkOnRoot(root: FiberRootNode, didTimeout: boolean): any {
  currentEventTime = NoTimestamp;
  currentEventTransitionLane = NoLanes;
  if ((executionContext & (RenderContext | CommitContext)) !== NoContext) {
    throw new Error('Should not already be working.');
  }
  const originalCallbackNode: any = root.callbackNode;
  const didFlushPassiveEffects = flushPassiveEffectsImpl();
  if (didFlushPassiveEffects) {
    if (root.callbackNode !== originalCallbackNode) {
      // the passive phase canceled this task
      return null;
    }
  }
  const lanes = getNextLanes(root, root === workInProgressRoot ? workInProgressRootRenderLanes : NoLanes);
  if (lanes === NoLanes) {
    return null;
  }
  const shouldTimeSlice = !includesBlockingLane(lanes) && !includesExpiredLane(root, lanes) && !didTimeout;
  const exitStatus = shouldTimeSlice ? renderRootConcurrent(root, lanes) : renderRootSync(root, lanes);
  if (exitStatus !== RootInProgress) {
    if (exitStatus === RootErrored || exitStatus === RootFatalErrored) {
      throw new Error('render errored (error boundaries/recovery not ported)');
    }
    if (exitStatus === RootDidNotComplete) {
      markRootSuspendedWip(root, lanes);
    } else {
      // external-store consistency check skipped (useSyncExternalStore not ported)
      const finishedWork: FiberNode | null = root.current.alternate;
      root.finishedWork = finishedWork;
      root.finishedLanes = lanes;
      finishConcurrentRender(root, exitStatus, lanes);
    }
  }
  ensureRootIsScheduled(root, schedGetNow());
  if (root.callbackNode === originalCallbackNode) {
    // yielded: hand the scheduler a continuation for the same task
    return function (dt: boolean): any {
      return performConcurrentWorkOnRoot(root, dt);
    };
  }
  return null;
}

function jnd(timeElapsed: number): number {
  if (timeElapsed < 120) {
    return 120;
  }
  if (timeElapsed < 480) {
    return 480;
  }
  if (timeElapsed < 1080) {
    return 1080;
  }
  if (timeElapsed < 1920) {
    return 1920;
  }
  if (timeElapsed < 3000) {
    return 3000;
  }
  if (timeElapsed < 4320) {
    return 4320;
  }
  const m: any = G.Math;
  return coerceInt(m.ceil(timeElapsed / 1960)) * 1960;
}

function finishConcurrentRender(root: FiberRootNode, exitStatus: number, lanes: number): void {
  if (exitStatus === RootCompleted) {
    commitRoot(root);
    return;
  }
  if (exitStatus === RootSuspended) {
    markRootSuspendedWip(root, lanes);
    if (includesOnlyRetries(lanes)) {
      const msUntilTimeout = globalMostRecentFallbackTime + FALLBACK_THROTTLE_MS - schedGetNow();
      if (msUntilTimeout > 10) {
        const nextLanes = getNextLanes(root, NoLanes);
        if (nextLanes !== NoLanes) {
          return;
        }
        const suspendedLanes = root.suspendedLanes;
        if (!isSubsetOfLanes(suspendedLanes, lanes)) {
          requestEventTime();
          markRootPinged(root, suspendedLanes);
          return;
        }
        // React arms a host timeout to commit the fallback later. Host
        // timeouts never fire in this harness (scheduleTimeout returns -1 on
        // the twin), so waiting for the data ping IS the behavior.
        return;
      }
    }
    commitRoot(root);
    return;
  }
  if (exitStatus === RootSuspendedWithDelay) {
    markRootSuspendedWip(root, lanes);
    if (includesOnlyTransitions(lanes)) {
      // a suspended transition never commits its fallback: wait for data
      return;
    }
    const mostRecentEventTime = getMostRecentEventTime(root, lanes);
    const timeElapsedMs = schedGetNow() - mostRecentEventTime;
    const msUntilTimeout2 = jnd(timeElapsedMs) - timeElapsedMs;
    if (msUntilTimeout2 > 10) {
      // React arms a host timeout to commit the placeholder after the JND
      // delay. Host timeouts never fire in this harness, so wait for the ping.
      return;
    }
    commitRoot(root);
    return;
  }
  throw new Error('Unknown root exit status ' + String(exitStatus));
}

// ---- sync entry point ----
function performSyncWorkOnRoot(root: FiberRootNode): any {
  if ((executionContext & (RenderContext | CommitContext)) !== NoContext) {
    throw new Error('Should not already be working.');
  }
  flushPassiveEffectsImpl();
  const lanes = getNextLanes(root, NoLanes);
  if (!includesSomeLane(lanes, SyncLane)) {
    // no remaining sync work
    ensureRootIsScheduled(root, schedGetNow());
    return null;
  }
  const exitStatus = renderRootSync(root, lanes);
  if (exitStatus === RootErrored || exitStatus === RootFatalErrored) {
    throw new Error('render errored (error boundaries/recovery not ported)');
  }
  if (exitStatus === RootDidNotComplete) {
    throw new Error('Root did not complete. This is a bug in React.');
  }
  const finishedWork: FiberNode | null = root.current.alternate;
  root.finishedWork = finishedWork;
  root.finishedLanes = lanes;
  commitRoot(root);
  ensureRootIsScheduled(root, schedGetNow());
  return null;
}

// ---- public batching wrappers ----
function flushSyncImpl(fn: any): any {
  // legacy roots flush pending passive effects at the start of the next event
  const pendingPassiveRoot = rootWithPendingPassiveEffects;
  if (pendingPassiveRoot !== null && pendingPassiveRoot.tag === LegacyRoot &&
      (executionContext & (RenderContext | CommitContext)) === NoContext) {
    flushPassiveEffectsImpl();
  }
  const prevExecutionContext = executionContext;
  executionContext |= BatchedContext;
  const prevTransition: any = currentBatchTransition;
  const previousPriority = getCurrentUpdatePriority();
  try {
    currentBatchTransition = null;
    setCurrentUpdatePriority(DiscreteEventPriority);
    if (fn !== null && fn !== undefined) {
      return fn();
    }
    return undefined;
  } finally {
    setCurrentUpdatePriority(previousPriority);
    currentBatchTransition = prevTransition;
    executionContext = prevExecutionContext;
    if ((executionContext & (RenderContext | CommitContext)) === NoContext) {
      flushSyncCallbacks();
    }
  }
}

function discreteUpdatesImpl(fn: any): any {
  const previousPriority = getCurrentUpdatePriority();
  const prevTransition: any = currentBatchTransition;
  try {
    currentBatchTransition = null;
    setCurrentUpdatePriority(DiscreteEventPriority);
    return fn();
  } finally {
    setCurrentUpdatePriority(previousPriority);
    currentBatchTransition = prevTransition;
    if (executionContext === NoContext) {
      resetRenderTimer();
    }
  }
}

// ---- render ----
function pushRenderLanes(fiber: FiberNode, lanes: number): void {
  subtreeRenderLanesStack.push(subtreeRenderLanes);
  subtreeRenderLanes |= lanes;
}

function popRenderLanes(fiber: FiberNode): void {
  subtreeRenderLanes = coerceInt(subtreeRenderLanesStack.pop());
}

function unwindInterruptedWork(current: FiberNode | null, interruptedWork: FiberNode): void {
  const tag = interruptedWork.tag;
  if (tag === ContextProvider) {
    popProvider(interruptedWork.type._context, interruptedWork);
  } else if (tag === SuspenseComponent) {
    popSuspenseContext(interruptedWork);
  } else if (tag === OffscreenComponent) {
    popRenderLanes(interruptedWork);
  }
}

function prepareFreshStack(root: FiberRootNode, lanes: number): FiberNode {
  root.finishedWork = null;
  root.finishedLanes = NoLanes;
  // root.timeoutHandle is never armed in this port (host timeouts unused)
  if (workInProgress !== null) {
    let interruptedWork = workInProgress.ret;
    while (interruptedWork !== null) {
      const cur = interruptedWork.alternate;
      unwindInterruptedWork(cur, interruptedWork);
      interruptedWork = interruptedWork.ret;
    }
  }
  workInProgressRoot = root;
  const rootWorkInProgress = createWorkInProgress(root.current, null);
  workInProgress = rootWorkInProgress;
  workInProgressRootRenderLanes = lanes;
  subtreeRenderLanes = lanes;
  subtreeRenderLanesStack.length = 0;
  suspenseCtxStack.length = 0;
  suspenseCtxCurrent = 0;
  workInProgressRootExitStatus = RootInProgress;
  workInProgressRootSkippedLanes = NoLanes;
  workInProgressRootInterleavedUpdatedLanes = NoLanes;
  workInProgressRootPingedLanes = NoLanes;
  finishQueueingConcurrentUpdates();
  return rootWorkInProgress;
}

// React: handleError — route thrown thenables to the nearest Suspense
// boundary, then complete the errored unit (which may take the unwind path).
function handleThrow(root: FiberRootNode, thrownValue: any): void {
  const erroredWork = workInProgress;
  resetHooksAfterThrow();
  if (erroredWork === null || erroredWork.ret === null) {
    workInProgressRootExitStatus = RootFatalErrored;
    workInProgress = null;
    throw thrownValue;
  }
  throwException(root, erroredWork.ret, erroredWork, thrownValue, workInProgressRootRenderLanes);
  completeUnitOfWork(erroredWork);
}

function renderRootSync(root: FiberRootNode, lanes: number): number {
  const prevExecutionContext = executionContext;
  executionContext |= RenderContext;
  if (workInProgressRoot !== root || workInProgressRootRenderLanes !== lanes) {
    prepareFreshStack(root, lanes);
  }
  while (true) {
    try {
      workLoopSync();
      break;
    } catch (thrownValue) {
      handleThrow(root, thrownValue);
    }
  }
  lastContextDependency = null;
  executionContext = prevExecutionContext;
  if (workInProgress !== null) {
    throw new Error('Cannot commit an incomplete root.');
  }
  workInProgressRoot = null;
  workInProgressRootRenderLanes = NoLanes;
  return workInProgressRootExitStatus;
}

function workLoopSync(): void {
  while (workInProgress !== null) {
    performUnitOfWork(workInProgress);
  }
}

function renderRootConcurrent(root: FiberRootNode, lanes: number): number {
  const prevExecutionContext = executionContext;
  executionContext |= RenderContext;
  if (workInProgressRoot !== root || workInProgressRootRenderLanes !== lanes) {
    resetRenderTimer();
    prepareFreshStack(root, lanes);
  }
  while (true) {
    try {
      workLoopConcurrent();
      break;
    } catch (thrownValue) {
      handleThrow(root, thrownValue);
    }
  }
  lastContextDependency = null;
  executionContext = prevExecutionContext;
  if (workInProgress !== null) {
    // yielded with work remaining
    return RootInProgress;
  }
  workInProgressRoot = null;
  workInProgressRootRenderLanes = NoLanes;
  return workInProgressRootExitStatus;
}

function workLoopConcurrent(): void {
  while (workInProgress !== null && !schedShouldYield()) {
    performUnitOfWork(workInProgress);
  }
}

function performUnitOfWork(unitOfWork: FiberNode): void {
  const current = unitOfWork.alternate;
  const next = beginWork(current, unitOfWork, subtreeRenderLanes);
  unitOfWork.memoizedProps = unitOfWork.pendingProps;
  if (next === null) {
    completeUnitOfWork(unitOfWork);
  } else {
    workInProgress = next;
  }
}

function completeUnitOfWork(unitOfWork: FiberNode): void {
  let completedWork: FiberNode | null = unitOfWork;
  while (completedWork !== null) {
    const current = completedWork.alternate;
    const returnFiber: FiberNode | null = completedWork.ret;
    if ((completedWork.flags & Incomplete) === NoFlags) {
      const next = completeWork(current, completedWork);
      if (next !== null) {
        workInProgress = next;
        return;
      }
    } else {
      // this fiber did not complete: unwind
      const next2 = unwindWork(current, completedWork);
      if (next2 !== null) {
        next2.flags &= HostEffectMask;
        workInProgress = next2;
        return;
      }
      if (returnFiber !== null) {
        returnFiber.flags |= Incomplete;
        returnFiber.subtreeFlags = NoFlags;
        returnFiber.deletions = null;
      } else {
        // unwound past the root
        workInProgressRootExitStatus = RootDidNotComplete;
        workInProgress = null;
        return;
      }
    }
    const siblingFiber = completedWork.sibling;
    if (siblingFiber !== null) {
      workInProgress = siblingFiber;
      return;
    }
    completedWork = returnFiber;
    workInProgress = completedWork;
  }
  // reached the root
  if (workInProgressRootExitStatus === RootInProgress) {
    workInProgressRootExitStatus = RootCompleted;
  }
}

// ---- commit ----
function commitRoot(root: FiberRootNode): any {
  const previousUpdateLanePriority = getCurrentUpdatePriority();
  const prevTransition: any = currentBatchTransition;
  try {
    currentBatchTransition = null;
    setCurrentUpdatePriority(DiscreteEventPriority);
    commitRootImpl(root);
  } finally {
    currentBatchTransition = prevTransition;
    setCurrentUpdatePriority(previousUpdateLanePriority);
  }
  return null;
}

function commitRootImpl(root: FiberRootNode): any {
  // passive effects may schedule more passive effects: drain fully
  while (true) {
    flushPassiveEffectsImpl();
    if (rootWithPendingPassiveEffects === null) {
      break;
    }
  }
  if ((executionContext & (RenderContext | CommitContext)) !== NoContext) {
    throw new Error('Should not already be working.');
  }
  const finishedWork = root.finishedWork;
  const lanes = root.finishedLanes;
  if (finishedWork === null) {
    return null;
  }
  root.finishedWork = null;
  root.finishedLanes = NoLanes;
  if (finishedWork === root.current) {
    throw new Error('Cannot commit the same tree as before.');
  }
  root.callbackNode = null;
  root.callbackPriority = NoLane;
  let remainingLanes = finishedWork.lanes | finishedWork.childLanes;
  markRootFinished(root, remainingLanes);
  if (root === workInProgressRoot) {
    workInProgressRoot = null;
    workInProgress = null;
    workInProgressRootRenderLanes = NoLanes;
  }
  if ((finishedWork.subtreeFlags & PassiveMask) !== NoFlags || (finishedWork.flags & PassiveMask) !== NoFlags) {
    if (!rootDoesHavePassiveEffects) {
      rootDoesHavePassiveEffects = true;
      scheduleSchedulerCallback(NormalSchedPriority, function (didTimeout: boolean): any {
        flushPassiveEffectsImpl();
        return null;
      });
    }
  }
  const subtreeHasEffects = (finishedWork.subtreeFlags & (MutationMask | LayoutMask | PassiveMask)) !== NoFlags;
  const rootHasEffect = (finishedWork.flags & (MutationMask | LayoutMask | PassiveMask)) !== NoFlags;
  if (subtreeHasEffects || rootHasEffect) {
    const prevTransition: any = currentBatchTransition;
    currentBatchTransition = null;
    const previousPriority = getCurrentUpdatePriority();
    setCurrentUpdatePriority(DiscreteEventPriority);
    const prevExecutionContext = executionContext;
    executionContext |= CommitContext;
    commitMutationEffectsOnFiber(finishedWork, root);
    // the work-in-progress tree is now current: after mutation, before layout
    root.current = finishedWork;
    commitLayoutEffects(finishedWork);
    executionContext = prevExecutionContext;
    setCurrentUpdatePriority(previousPriority);
    currentBatchTransition = prevTransition;
  } else {
    root.current = finishedWork;
  }
  if (rootDoesHavePassiveEffects) {
    rootDoesHavePassiveEffects = false;
    rootWithPendingPassiveEffects = root;
    pendingPassiveEffectsLanes = lanes;
  }
  remainingLanes = root.pendingLanes;
  ensureRootIsScheduled(root, schedGetNow());
  // discrete-render passive effects are observable: flush before yielding
  if (includesSomeLane(pendingPassiveEffectsLanes, SyncLane) && root.tag !== LegacyRoot) {
    flushPassiveEffectsImpl();
  }
  // if layout work was scheduled, flush it now
  flushSyncCallbacks();
  return null;
}

// ---- passive effects ----
// React: flushPassiveEffects — priority wrapper around the impl
function flushPassiveEffectsImpl(): boolean {
  if (rootWithPendingPassiveEffects !== null) {
    const renderPriority = lanesToEventPriority(pendingPassiveEffectsLanes);
    const priority = lowerEventPriority(DefaultEventPriority, renderPriority);
    const prevTransition: any = currentBatchTransition;
    const previousPriority = getCurrentUpdatePriority();
    try {
      currentBatchTransition = null;
      setCurrentUpdatePriority(priority);
      return flushPassiveEffectsInner();
    } finally {
      setCurrentUpdatePriority(previousPriority);
      currentBatchTransition = prevTransition;
    }
  }
  return false;
}

// React: flushPassiveEffectsImpl — unmount pass then mount pass over the
// committed tree; sync updates scheduled by passive effects flush at the end
// (flushSyncCallbacks).
function flushPassiveEffectsInner(): boolean {
  const root = rootWithPendingPassiveEffects;
  if (root === null) {
    return false;
  }
  rootWithPendingPassiveEffects = null;
  pendingPassiveEffectsLanes = NoLanes;
  if ((executionContext & (RenderContext | CommitContext)) !== NoContext) {
    throw new Error('Cannot flush passive effects while already rendering.');
  }
  const prevExecutionContext = executionContext;
  executionContext |= CommitContext;
  commitPassiveUnmountOnTree(root.current);
  commitPassiveMountOnTree(root.current);
  executionContext = prevExecutionContext;
  flushSyncCallbacks();
  return true;
}

// ---- suspense retries ----
function retryTimedOutBoundary(boundaryFiber: FiberNode, retryLane: number): void {
  let lane = retryLane;
  if (lane === NoLane) {
    lane = requestRetryLane(boundaryFiber);
  }
  const eventTime = requestEventTime();
  const root = enqueueConcurrentRenderForLane(boundaryFiber, lane);
  if (root !== null) {
    markRootUpdated(root, lane, eventTime);
    ensureRootIsScheduled(root, eventTime);
  }
}

function resolveRetryWakeable(boundaryFiber: FiberNode, wakeable: any): void {
  let retryLane = NoLane;
  const suspenseState: any = boundaryFiber.memoizedState;
  if (suspenseState !== null) {
    retryLane = coerceInt(suspenseState.retryLane);
  }
  retryTimedOutBoundary(boundaryFiber, retryLane);
}

// ---- public API ----
class RootState {
  element: any;

  constructor(element: any) {
    this.element = element;
  }
}

function createRootWithTag(containerInfo: any, tag: number): FiberRootNode {
  const mode = tag === ConcurrentRoot ? ConcurrentMode : NoMode;
  const rootFiber = new FiberNode(HostRoot, null, null, mode);
  const root = new FiberRootNode(containerInfo, rootFiber, tag);
  rootFiber.stateNode = root;
  rootFiber.memoizedState = new RootState(null);
  return root;
}

function createRootImpl(containerInfo: any): FiberRootNode {
  return createRootWithTag(containerInfo, LegacyRoot);
}

function createConcurrentRootImpl(containerInfo: any): FiberRootNode {
  return createRootWithTag(containerInfo, ConcurrentRoot);
}

function renderIntoRoot(root: FiberRootNode, element: any): void {
  const current = root.current;
  const lane = requestUpdateLane(current);
  // single-shot mount: the element is applied eagerly instead of via the
  // HostRoot class update queue (sufficient for one root render per harness)
  current.memoizedState = new RootState(element);
  const eventTime = requestEventTime();
  const updatedRoot = enqueueConcurrentRenderForLane(current, lane);
  if (updatedRoot !== null) {
    scheduleUpdateOnFiber(updatedRoot, current, lane, eventTime);
  }
}
