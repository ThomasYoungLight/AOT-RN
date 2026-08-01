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
const SimpleMemoComponent = 15;

// ---- flags ----
const NoFlags = 0;
const Placement = 2;
const Update = 4;
const ChildDeletion = 16;
const MutationMask = Placement | Update | ChildDeletion;

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
  props: any;

  constructor(type: any, key: any, props: any) {
    this.$$el = true;
    this.type = type;
    this.key = key;
    this.props = props;
  }
}

class MemoT {
  $$memo: boolean;
  render: any;

  constructor(render: any) {
    this.$$memo = true;
    this.render = render;
  }
}

function memoImpl(render: any): any {
  return new MemoT(render);
}

function createElementImpl(type: any, config: any, c1: any, c2: any, c3: any): any {
  const props: any = new G.Object();
  let key: any = null;
  if (config !== null && config !== undefined) {
    for (const k in config) {
      if (k !== 'key') {
        props[k] = config[k];
      }
    }
    if (config.key !== undefined) {
      key = '' + config.key;
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
  return new El(type, key, props);
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
  pendingProps: any;
  memoizedProps: any;
  updateQueue: any;
  memoizedState: any;
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
    this.pendingProps = pendingProps;
    this.memoizedProps = null;
    this.updateQueue = null;
    this.memoizedState = null;
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
  workInProgress.sibling = current.sibling;
  workInProgress.index = current.index;
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
    tag = SimpleMemoComponent;
    resolvedType = type.render;
  }
  const fiber = new FiberNode(tag, element.props, element.key);
  fiber.elementType = type;
  fiber.type = resolvedType;
  fiber.lanes = lanes;
  return fiber;
}

function createFiberFromText(content: any, lanes: number): FiberNode {
  const fiber = new FiberNode(HostText, content, null);
  fiber.lanes = lanes;
  return fiber;
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
  lastRenderedState: any;

  constructor() {
    this.pending = null;
    this.dispatch = null;
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

function useStateImpl(initialState: any): any {
  if (isMountPhase) {
    const hook = mountWorkInProgressHook();
    const init: any = typeof initialState === 'function' ? initialState() : initialState;
    hook.memoizedState = init;
    hook.baseState = init;
    const queue = new HookQueue();
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
  // update path (updateReducer with basicStateReducer)
  const hook = updateWorkInProgressHook();
  const queue: HookQueue = hook.queue;
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
      newState = update.hasEagerState ? update.eagerState : basicStateReducer(newState, update.action);
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
  const r2: any = new G.Array();
  r2.push(hook.memoizedState);
  r2.push(queue.dispatch);
  return r2;
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

function renderWithHooks(current: FiberNode | null, workInProgress: FiberNode, Component: any, props: any): any {
  currentlyRenderingFiber = workInProgress;
  workInProgress.memoizedState = null;
  workInProgress.updateQueue = null;
  isMountPhase = current === null || current.memoizedState === null;
  currentHook = null;
  workInProgressHook = null;
  const children: any = Component(props);
  currentlyRenderingFiber = null;
  currentHook = null;
  workInProgressHook = null;
  return children;
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
  const nextChildren: any = renderWithHooks(current, workInProgress, Component, nextProps);
  if (current !== null && !didReceiveUpdate) {
    // bailoutHooks
    current.lanes = current.lanes & ~renderLanes;
    return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
  }
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
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
      if ((current.lanes & renderLanes) === NoLanes) {
        didReceiveUpdate = false;
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
  throw new Error('unknown tag ' + String(tag));
}

// ---- complete work ----
function appendAllChildren(parent: any, workInProgress: FiberNode): void {
  let node = workInProgress.child;
  while (node !== null) {
    if (node.tag === HostComponent || node.tag === HostText) {
      hcAppendChild(parent, node.stateNode);
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

function appendAllChildrenToContainer(childSet: any, workInProgress: FiberNode): void {
  let node = workInProgress.child;
  while (node !== null) {
    if (node.tag === HostComponent || node.tag === HostText) {
      hcAppendChildToContainerChildSet(childSet, node.stateNode);
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
    appendAllChildrenToContainer(newChildSet, workInProgress);
    root.pendingChildren = newChildSet;
    workInProgress.flags |= Update;
    hcFinalizeContainerChildren(container, newChildSet);
  }
}

function bubbleProperties(completedWork: FiberNode): void {
  let newChildLanes = NoLanes;
  let subtreeFlags = NoFlags;
  let child = completedWork.child;
  while (child !== null) {
    newChildLanes = newChildLanes | child.lanes | child.childLanes;
    subtreeFlags = subtreeFlags | child.subtreeFlags | child.flags;
    child.ret = completedWork;
    child = child.sibling;
  }
  completedWork.subtreeFlags |= subtreeFlags;
  completedWork.childLanes = newChildLanes;
}

function completeWork(current: FiberNode | null, workInProgress: FiberNode): void {
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
              appendAllChildren(newInstance, workInProgress);
            }
          }
        }
      }
    } else {
      const instance: any = hcCreateInstance(workInProgress.type, newProps, workInProgress);
      appendAllChildren(instance, workInProgress);
      workInProgress.stateNode = instance;
    }
    bubbleProperties(workInProgress);
    return;
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
    return;
  }
  if (tag === HostRoot) {
    if (supportsPersistence) {
      updateHostContainer(current, workInProgress);
    }
    bubbleProperties(workInProgress);
    return;
  }
  bubbleProperties(workInProgress);
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

function commitDeletionEffectsOnFiber(deletedFiber: FiberNode, hostParent: any): void {
  if (deletedFiber.tag === HostComponent || deletedFiber.tag === HostText) {
    if (hostParent !== null) {
      hcRemoveChild(hostParent, deletedFiber.stateNode);
    }
    let inner = deletedFiber.child;
    while (inner !== null) {
      commitDeletionEffectsOnFiber(inner, null);
      inner = inner.sibling;
    }
    return;
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
    commitPlacement(finishedWork);
    finishedWork.flags &= ~Placement;
  }
}

function commitMutationEffectsOnFiber(finishedWork: FiberNode, root: FiberRootNode): void {
  // recursivelyTraverseMutationEffects
  const deletions: any = finishedWork.deletions;
  if (deletions !== null) {
    for (let i = 0; i < deletions.length; i++) {
      commitDeletionEffects(root, finishedWork, deletions[i]);
    }
    finishedWork.deletions = null;
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
  if (tag === HostComponent) {
    if ((finishedWork.flags & Update) !== NoFlags) {
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
    if ((finishedWork.flags & Update) !== NoFlags) {
      const current = finishedWork.alternate;
      const oldText: any = current !== null ? current.memoizedProps : '';
      hcCommitTextUpdate(finishedWork.stateNode, oldText, finishedWork.memoizedProps);
      finishedWork.flags &= ~Update;
    }
    return;
  }
}

// ---- work loop ----
let workInProgress: FiberNode | null = null;
let isBatching = false;
let isRendering = false;
let pendingRoot: FiberRootNode | null = null;

function scheduleUpdateOnFiber(fiber: FiberNode): void {
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
    const root: FiberRootNode = node.stateNode;
    if (isBatching || isRendering) {
      pendingRoot = root;
    } else {
      performSyncWorkOnRoot(root);
    }
  }
}

function flushSyncImpl(fn: any): void {
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
    completeWork(current, completedWork);
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

function performSyncWorkOnRoot(root: FiberRootNode): void {
  isRendering = true;
  const rootWip = createWorkInProgress(root.current, null);
  workInProgress = rootWip;
  while (workInProgress !== null) {
    performUnitOfWork(workInProgress);
  }
  isRendering = false;
  if (supportsPersistence) {
    if ((rootWip.flags & Update) !== NoFlags) {
      hcReplaceContainerChildren(root.containerInfo, root.pendingChildren);
      rootWip.flags &= ~Update;
    }
  } else {
    commitMutationEffectsOnFiber(rootWip, root);
  }
  root.current = rootWip;
  // updates scheduled during render/commit would be in pendingRoot; none in
  // this app (no useEffect / render-phase updates).
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
