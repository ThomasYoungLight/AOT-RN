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
const NoLanes = 0;
const SyncLane = 1;

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
  lanes: number;
  childLanes: number;
  alternate: FiberNode | null;
  flags: number;
  subtreeFlags: number;
  deletions: any;

  constructor(tag: number, pendingProps: any, key: any) {
    this.tag = tag;
    this.key = key;
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
  containerInfo: any;
  current: FiberNode;
  finishedWork: FiberNode | null;
  pendingChildren: any;

  constructor(containerInfo: any, current: FiberNode) {
    this.containerInfo = containerInfo;
    this.current = current;
    this.finishedWork = null;
    this.pendingChildren = null;
  }
}

function createWorkInProgress(current: FiberNode, pendingProps: any): FiberNode {
  let workInProgress = current.alternate;
  if (workInProgress === null) {
    workInProgress = new FiberNode(current.tag, pendingProps, current.key);
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

function createFiberFromElement(element: any, lanes: number): FiberNode {
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
  const fiber = new FiberNode(tag, element.props, element.key);
  fiber.elementType = type;
  fiber.type = resolvedType;
  fiber.ref = element.ref;
  fiber.lanes = lanes;
  return fiber;
}

function createFiberFromFragmentChildren(children: any, lanes: number): FiberNode {
  const fiber = new FiberNode(Fragment, children, null);
  fiber.lanes = lanes;
  return fiber;
}

function createFiberFromOffscreen(pendingProps: any, lanes: number): FiberNode {
  const fiber = new FiberNode(OffscreenComponent, pendingProps, null);
  fiber.lanes = lanes;
  return fiber;
}

function createFiberFromText(content: any, lanes: number): FiberNode {
  const fiber = new FiberNode(HostText, content, null);
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
  dispatch: any;
  lastRenderedReducer: any;
  lastRenderedState: any;

  constructor() {
    this.pending = null;
    this.dispatch = null;
    this.lastRenderedReducer = null;
    this.lastRenderedState = null;
  }
}

class HookUpdate {
  action: any;
  hasEagerState: boolean;
  eagerState: any;
  next: any;

  constructor(action: any) {
    this.action = action;
    this.hasEagerState = false;
    this.eagerState = null;
    this.next = null;
  }
}

let currentlyRenderingFiber: FiberNode | null = null;
let currentHook: Hook | null = null;
let workInProgressHook: Hook | null = null;
let isMountPhase = false;
let didReceiveUpdate = false;

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

function enqueueUpdate(queue: HookQueue, update: HookUpdate): void {
  const pending: any = queue.pending;
  if (pending === null) {
    update.next = update;
  } else {
    update.next = pending.next;
    pending.next = update;
  }
  queue.pending = update;
}

function dispatchSetState(fiber: FiberNode, queue: HookQueue, action: any): void {
  const update = new HookUpdate(action);
  const alt = fiber.alternate;
  if (fiber.lanes === NoLanes && (alt === null || alt.lanes === NoLanes)) {
    const currentState: any = queue.lastRenderedState;
    const eagerState: any = basicStateReducer(currentState, action);
    update.hasEagerState = true;
    update.eagerState = eagerState;
    if (objectIs(eagerState, currentState)) {
      enqueueUpdate(queue, update);
      return;
    }
  }
  enqueueUpdate(queue, update);
  scheduleUpdateOnFiber(fiber);
}

// React: dispatchReducerAction — no eager-state computation.
function dispatchReducerAction(fiber: FiberNode, queue: HookQueue, action: any): void {
  const update = new HookUpdate(action);
  enqueueUpdate(queue, update);
  scheduleUpdateOnFiber(fiber);
}

// shared update path (React: updateReducer); useState uses basicStateReducer
function updateReducerImpl(reducer: any): any {
  const hook = updateWorkInProgressHook();
  const queue: HookQueue = hook.queue;
  queue.lastRenderedReducer = reducer;
  let baseQueue: any = hook.baseQueue;
  const pendingQueue: any = queue.pending;
  if (pendingQueue !== null) {
    if (baseQueue !== null) {
      const baseFirst: any = baseQueue.next;
      const pendingFirst: any = pendingQueue.next;
      baseQueue.next = pendingFirst;
      pendingQueue.next = baseFirst;
    }
    hook.baseQueue = pendingQueue;
    baseQueue = pendingQueue;
    queue.pending = null;
  }
  if (baseQueue !== null) {
    const first: any = baseQueue.next;
    let newState: any = hook.baseState;
    let update: any = first;
    while (true) {
      newState = update.hasEagerState ? update.eagerState : reducer(newState, update.action);
      update = update.next;
      if (update === first) {
        break;
      }
    }
    if (!objectIs(newState, hook.memoizedState)) {
      didReceiveUpdate = true;
    }
    hook.memoizedState = newState;
    hook.baseState = newState;
    hook.baseQueue = null;
    queue.lastRenderedState = newState;
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
    const owner: FiberNode = currentlyRenderingFiber !== null ? currentlyRenderingFiber : new FiberNode(-1, null, null);
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
    const owner: FiberNode = currentlyRenderingFiber !== null ? currentlyRenderingFiber : new FiberNode(-1, null, null);
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

function renderWithHooks(current: FiberNode | null, workInProgress: FiberNode, Component: any, props: any, secondArg: any): any {
  currentlyRenderingFiber = workInProgress;
  workInProgress.memoizedState = null;
  workInProgress.updateQueue = null;
  isMountPhase = current === null || current.memoizedState === null;
  currentHook = null;
  workInProgressHook = null;
  const children: any = Component(props, secondArg);
  currentlyRenderingFiber = null;
  currentHook = null;
  workInProgressHook = null;
  return children;
}

// render threw: reset hooks module state (React: resetHooksAfterThrow) and,
// in legacy mode, restore the source fiber's pre-render hook state so the
// incomplete fiber can be committed as-is (resetSuspendedComponent).
function resetHooksAfterThrow(sourceFiber: FiberNode): void {
  currentlyRenderingFiber = null;
  currentHook = null;
  workInProgressHook = null;
  const tag = sourceFiber.tag;
  if (tag === FunctionComponent || tag === ForwardRef || tag === SimpleMemoComponent) {
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
    const created = createFiberFromText(textContent, lanes);
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
  const created = createFiberFromElement(element, lanes);
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
    const created = createFiberFromText('' + newChild, lanes);
    created.ret = returnFiber;
    return created;
  }
  if (newChild !== null && typeof newChild === 'object' && newChild.$$el === true) {
    const created2 = createFiberFromElement(newChild, lanes);
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
  const created = createFiberFromText(textContent, lanes);
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
  const created = createFiberFromElement(element, lanes);
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
  const nextChildren: any = renderWithHooks(current, workInProgress, Component, nextProps, undefined);
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
  const nextChildren: any = renderWithHooks(current, workInProgress, render, nextProps, ref);
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
    const child = createFiberFromElement(innerEl, renderLanes);
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
SUSPENDED_MARKER.retryLane = SyncLane;

function mountSuspenseOffscreenState(): any {
  const s: any = mkObj();
  s.baseLanes = NoLanes;
  return s;
}

function mountSuspensePrimaryChildren(workInProgress: FiberNode, primaryChildren: any, renderLanes: number): FiberNode {
  const primaryChildProps: any = mkObj();
  primaryChildProps.mode = 'visible';
  primaryChildProps.children = primaryChildren;
  const primaryChildFragment = createFiberFromOffscreen(primaryChildProps, renderLanes);
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
  if (progressedPrimaryFragment !== null) {
    primaryChildFragment = progressedPrimaryFragment;
    primaryChildFragment.childLanes = NoLanes;
    primaryChildFragment.pendingProps = primaryChildProps;
  } else {
    primaryChildFragment = createFiberFromOffscreen(primaryChildProps, renderLanes);
  }
  const fallbackChildFragment = createFiberFromFragmentChildren(fallbackChildren, renderLanes);
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
  // legacy mode forces the primary tree to re-render
  primaryChildFragment.lanes = renderLanes;
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
  if (workInProgress.child !== currentPrimaryChildFragment && workInProgress.child !== null) {
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
    fallbackChildFragment = createFiberFromFragmentChildren(fallbackChildren, renderLanes);
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
  let showFallback = false;
  const didSuspend = (workInProgress.flags & DidCapture) !== NoFlags;
  if (didSuspend) {
    showFallback = true;
    workInProgress.flags &= ~DidCapture;
  }
  if (current === null) {
    const nextPrimaryChildren: any = nextProps.children;
    const nextFallbackChildren: any = nextProps.fallback;
    if (showFallback) {
      const fallbackFragment = mountSuspenseFallbackChildren(workInProgress, nextPrimaryChildren, nextFallbackChildren, renderLanes);
      const primaryChildFragment = workInProgress.child;
      if (primaryChildFragment !== null) {
        primaryChildFragment.memoizedState = mountSuspenseOffscreenState();
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
        prevOffscreenState === null ? mountSuspenseOffscreenState() : prevOffscreenState;
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
  if (nextProps.mode === 'hidden') {
    // legacy mode: no deferral — render children hidden
    const nextState: any = mkObj();
    nextState.baseLanes = NoLanes;
    workInProgress.memoizedState = nextState;
  } else {
    workInProgress.memoizedState = null;
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
        // React: attemptEarlyBailoutIfNoScheduledUpdate re-pushes stack
        // frames for stackful fiber types before bailing out.
        if (workInProgress.tag === ContextProvider) {
          const bailCtx: any = workInProgress.type._context;
          pushProvider(workInProgress, bailCtx, workInProgress.memoizedProps.value);
        }
        return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
      }
      didReceiveUpdate = false;
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

function throwException(returnFiber: FiberNode | null, sourceFiber: FiberNode, value: any): void {
  sourceFiber.flags |= Incomplete;
  if (value !== null && typeof value === 'object' && typeof value.then === 'function') {
    const wakeable: any = value;
    resetHooksAfterThrow(sourceFiber);
    const suspenseBoundary = getNearestSuspenseBoundaryToCapture(returnFiber);
    if (suspenseBoundary !== null) {
      // legacy (NoMode) capture: markSuspenseBoundaryShouldCapture
      if (suspenseBoundary === returnFiber) {
        suspenseBoundary.flags |= ShouldCapture;
      } else {
        suspenseBoundary.flags |= DidCapture;
        sourceFiber.flags |= ForceUpdateForLegacySuspense;
        // commit the incomplete fiber as-is
        sourceFiber.flags &= ~(LifecycleEffectMask | Incomplete);
        sourceFiber.lanes |= SyncLane;
      }
      attachRetryListener(suspenseBoundary, wakeable);
      return;
    }
    throw new Error('a component suspended with no Suspense boundary above it');
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
    const flags = workInProgress.flags;
    if ((flags & ShouldCapture) !== NoFlags) {
      workInProgress.flags = (flags & ~ShouldCapture) | DidCapture;
      return workInProgress;
    }
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
    const nextState: any = workInProgress.memoizedState;
    if ((workInProgress.flags & DidCapture) !== NoFlags) {
      // legacy: the boundary captured mid-complete — re-render it to show
      // the fallback. Don't bubble; don't reset the effect list.
      workInProgress.lanes = SyncLane;
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
    const nextStateO: any = workInProgress.memoizedState;
    const nextIsHidden = nextStateO !== null;
    if (current !== null) {
      const prevIsHidden = current.memoizedState !== null;
      if (prevIsHidden !== nextIsHidden) {
        workInProgress.flags |= Visibility;
      }
    }
    // legacy mode always bubbles
    bubbleProperties(workInProgress);
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
  if (tag === HostComponent || tag === HostText) {
    if (tag === HostComponent) {
      safelyDetachRef(deletedFiber);
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
    commitDeletionHookEffects(deletedFiber);
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
    if ((finishedWork.flags & Update) !== NoFlags) {
      attachSuspenseRetryListeners(finishedWork);
    }
    return;
  }
  if (tag === OffscreenComponent) {
    if ((finishedWork.flags & Visibility) !== NoFlags) {
      const isHidden = finishedWork.memoizedState !== null;
      if (supportsMutation) {
        hideOrUnhideAllChildren(finishedWork, isHidden);
      }
    }
    return;
  }
}

// ---- Suspense commit (retry listeners + visibility) ----
function retryTimedOutBoundary(boundaryFiber: FiberNode): void {
  scheduleRetryOnFiber(boundaryFiber);
}

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
          retryTimedOutBoundary(finishedWork);
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
function commitLayoutEffects(finishedWork: FiberNode): void {
  if ((finishedWork.subtreeFlags & LayoutMask) !== NoFlags) {
    let child = finishedWork.child;
    while (child !== null) {
      commitLayoutEffects(child);
      child = child.sibling;
    }
  }
  if ((finishedWork.flags & LayoutMask) !== NoFlags) {
    const tag = finishedWork.tag;
    if (tag === FunctionComponent || tag === SimpleMemoComponent || tag === ForwardRef) {
      commitHookEffectListMount(HookLayout | HookHasEffect, finishedWork);
    } else if (tag === HostComponent) {
      if ((finishedWork.flags & Ref) !== NoFlags) {
        commitAttachRef(finishedWork);
      }
    }
  }
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

// ---- work loop ----
let workInProgress: FiberNode | null = null;
let isBatching = false;
let isRendering = false;
let pendingRoot: FiberRootNode | null = null;
let rootWithPendingPassive: FiberRootNode | null = null;

// React: flushPassiveEffectsImpl — unmount pass then mount pass over the
// committed tree; sync updates scheduled by passive effects flush at the end
// (flushSyncCallbacks).
function flushPassiveEffectsImpl(): boolean {
  const root = rootWithPendingPassive;
  if (root === null) {
    return false;
  }
  rootWithPendingPassive = null;
  const wasBatching = isBatching;
  isBatching = true;
  commitPassiveUnmountOnTree(root.current);
  commitPassiveMountOnTree(root.current);
  isBatching = wasBatching;
  if (!wasBatching) {
    const r = pendingRoot;
    pendingRoot = null;
    if (r !== null) {
      performSyncWorkOnRoot(r);
    }
  }
  return true;
}

function markUpdateLaneFromFiberToRoot(fiber: FiberNode): FiberRootNode | null {
  fiber.lanes |= SyncLane;
  let alt = fiber.alternate;
  if (alt !== null) {
    alt.lanes |= SyncLane;
  }
  let node: FiberNode = fiber;
  let parent = fiber.ret;
  while (parent !== null) {
    parent.childLanes |= SyncLane;
    alt = parent.alternate;
    if (alt !== null) {
      alt.childLanes |= SyncLane;
    }
    node = parent;
    parent = parent.ret;
  }
  if (node.tag === HostRoot) {
    return node.stateNode;
  }
  return null;
}

function scheduleUpdateOnFiber(fiber: FiberNode): void {
  const root = markUpdateLaneFromFiberToRoot(fiber);
  if (root !== null) {
    if (isBatching || isRendering) {
      pendingRoot = root;
    } else {
      performSyncWorkOnRoot(root);
    }
  }
}

// React: retryTimedOutBoundary goes through ensureRootIsScheduled — the
// retry render is DEFERRED to the next sync flush, never performed inline
// from the wakeable resolution.
function scheduleRetryOnFiber(fiber: FiberNode): void {
  const root = markUpdateLaneFromFiberToRoot(fiber);
  if (root !== null) {
    pendingRoot = root;
  }
}

function flushSyncImpl(fn: any): void {
  // React: flushSync flushes pending passive effects before the update.
  flushPassiveEffectsImpl();
  isBatching = true;
  fn();
  isBatching = false;
  const r = pendingRoot;
  pendingRoot = null;
  if (r !== null) {
    performSyncWorkOnRoot(r);
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
        throw new Error('render did not complete at the root');
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
}

function performUnitOfWork(unitOfWork: FiberNode): void {
  const current = unitOfWork.alternate;
  const next = beginWork(current, unitOfWork, SyncLane);
  unitOfWork.memoizedProps = unitOfWork.pendingProps;
  if (next === null) {
    completeUnitOfWork(unitOfWork);
  } else {
    workInProgress = next;
  }
}

// React: handleError — route thrown thenables to the nearest Suspense
// boundary, then complete the errored unit (which may take the unwind path).
function handleThrow(erroredWork: FiberNode, thrownValue: any): void {
  throwException(erroredWork.ret, erroredWork, thrownValue);
  completeUnitOfWork(erroredWork);
}

function performSyncWorkOnRoot(root: FiberRootNode): void {
  // React: performSyncWorkOnRoot flushes pending passive effects first.
  flushPassiveEffectsImpl();
  isRendering = true;
  const rootWip = createWorkInProgress(root.current, null);
  workInProgress = rootWip;
  while (workInProgress !== null) {
    try {
      performUnitOfWork(workInProgress);
    } catch (thrownValue) {
      const erroredWork = workInProgress;
      if (erroredWork === null) {
        throw thrownValue;
      }
      handleThrow(erroredWork, thrownValue);
    }
  }
  isRendering = false;
  // Commit. Updates scheduled by layout effects are deferred and flushed at
  // the end (React: flushSyncCallbacks at the end of commitRootImpl); passive
  // effects stay pending until flushPassiveEffectsImpl.
  const wasBatching = isBatching;
  isBatching = true;
  commitMutationEffectsOnFiber(rootWip, root);
  root.current = rootWip;
  commitLayoutEffects(rootWip);
  if (((rootWip.flags | rootWip.subtreeFlags) & PassiveMask) !== NoFlags) {
    rootWithPendingPassive = root;
  }
  isBatching = wasBatching;
  if (!wasBatching) {
    const r = pendingRoot;
    pendingRoot = null;
    if (r !== null) {
      performSyncWorkOnRoot(r);
    }
  }
}

// ---- public API ----
class RootState {
  element: any;

  constructor(element: any) {
    this.element = element;
  }
}

function createRootImpl(containerInfo: any): FiberRootNode {
  const rootFiber = new FiberNode(HostRoot, null, null);
  const root = new FiberRootNode(containerInfo, rootFiber);
  rootFiber.stateNode = root;
  rootFiber.memoizedState = new RootState(null);
  return root;
}

function renderIntoRoot(root: FiberRootNode, element: any): void {
  root.current.memoizedState = new RootState(element);
  scheduleUpdateOnFiber(root.current);
}
