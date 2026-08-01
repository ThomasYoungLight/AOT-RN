'use strict';
// Reconciler-shaped benchmark (typed/static-shape variant for `shermes -typed`).
// Same algorithm as bench-dynamic.js, but props are a fixed-shape class and
// the diff compares fixed fields — the restructuring typed AOT requires.

class Props {
  key: number;
  content: string | null;
  color: string | null;
  fontSize: number;
  direction: string | null;
  padding: number;
  flex: number;
  margin: number;
  background: string | null;
  opacity: number;
  width: number;
  height: number;
  overflow: string | null;

  constructor() {
    this.key = 0;
    this.content = null;
    this.color = null;
    this.fontSize = 0;
    this.direction = null;
    this.padding = 0;
    this.flex = 0;
    this.margin = 0;
    this.background = null;
    this.opacity = 0;
    this.width = 0;
    this.height = 0;
    this.overflow = null;
  }
}

class Element {
  type: string;
  props: Props;
  children: Element[] | null;

  constructor(type: string, props: Props, children: Element[] | null) {
    this.type = type;
    this.props = props;
    this.children = children;
  }
}

class Fiber {
  type: string;
  props: Props | null;
  child: Fiber | null;
  sibling: Fiber | null;
  parent: Fiber | null;
  alternate: Fiber | null;
  flags: number;

  constructor(type: string) {
    this.type = type;
    this.props = null;
    this.child = null;
    this.sibling = null;
    this.parent = null;
    this.alternate = null;
    this.flags = 0;
  }
}

function renderNode(
  level: number,
  depth: number,
  breadth: number,
  tick: number,
  index: number
): Element {
  if (level >= depth) {
    const changing: boolean = index % 10 === 0;
    const p = new Props();
    p.key = index;
    p.content = changing
      ? 'item ' + String(index) + ' t' + String(tick)
      : 'item ' + String(index);
    p.color = index % 3 === 0 ? 'red' : 'blue';
    p.fontSize = 12 + (index % 4);
    return new Element('text', p, null);
  }
  const children: Element[] = [];
  for (let i = 0; i < breadth; i++) {
    children.push(renderNode(level + 1, depth, breadth, tick, index * breadth + i));
  }
  const props = new Props();
  props.key = index;
  if (level % 3 === 0) {
    props.direction = 'column';
    props.padding = 4;
    props.flex = 1;
  } else if (level % 3 === 1) {
    props.direction = 'row';
    props.margin = 2;
    props.background = '#fff';
    props.opacity = 1;
  } else {
    props.width = 100 + level;
    props.height = 50 + level;
    props.overflow = 'hidden';
  }
  return new Element(level % 2 === 0 ? 'view' : 'stack', props, children);
}

function diffProps(oldProps: Props, newProps: Props): number {
  let changed = 0;
  if (oldProps.key !== newProps.key) changed++;
  if (oldProps.content !== newProps.content) changed++;
  if (oldProps.color !== newProps.color) changed++;
  if (oldProps.fontSize !== newProps.fontSize) changed++;
  if (oldProps.direction !== newProps.direction) changed++;
  if (oldProps.padding !== newProps.padding) changed++;
  if (oldProps.flex !== newProps.flex) changed++;
  if (oldProps.margin !== newProps.margin) changed++;
  if (oldProps.background !== newProps.background) changed++;
  if (oldProps.opacity !== newProps.opacity) changed++;
  if (oldProps.width !== newProps.width) changed++;
  if (oldProps.height !== newProps.height) changed++;
  if (oldProps.overflow !== newProps.overflow) changed++;
  return changed;
}

function reconcile(current: Fiber | null, element: Element, parent: Fiber | null): Fiber {
  const wip = new Fiber(element.type);
  if (current !== null && current.type === element.type) {
    wip.alternate = current;
    const oldProps = current.props;
    const changed: number = oldProps !== null ? diffProps(oldProps, element.props) : 99;
    wip.props = element.props;
    wip.flags = changed > 0 ? 1 : 0;
  } else {
    wip.props = element.props;
    wip.flags = 2;
  }
  wip.parent = parent;
  const elChildren = element.children;
  if (elChildren !== null) {
    let prevSibling: Fiber | null = null;
    let oldChild: Fiber | null = current !== null ? current.child : null;
    for (let i = 0; i < elChildren.length; i++) {
      const childFiber = reconcile(oldChild, elChildren[i], wip);
      if (i === 0) {
        wip.child = childFiber;
      } else if (prevSibling !== null) {
        prevSibling.sibling = childFiber;
      }
      prevSibling = childFiber;
      oldChild = oldChild !== null ? oldChild.sibling : null;
    }
  }
  return wip;
}

function commit(root: Fiber): number {
  let effects = 0;
  let node: Fiber | null = root;
  while (node !== null) {
    if (node.flags !== 0) effects++;
    if (node.child !== null) {
      node = node.child;
      continue;
    }
    while (node !== null && node.sibling === null) {
      node = node.parent;
    }
    if (node !== null) {
      node = node.sibling;
    }
  }
  return effects;
}

function main(): void {
  const DEPTH = 7;
  const BREADTH = 3;
  const WARMUP = 30;
  const COMMITS = 300;

  let current: Fiber | null = null;
  let totalEffects = 0;

  for (let w = 0; w < WARMUP; w++) {
    const wTree = renderNode(0, DEPTH, BREADTH, w, 0);
    const wWip = reconcile(current, wTree, null);
    totalEffects += commit(wWip);
    current = wWip;
  }

  const gcs0: any =
    typeof HermesInternal !== 'undefined' && HermesInternal.getInstrumentedStats
      ? HermesInternal.getInstrumentedStats()
      : null;
  let renderTime = 0,
    reconcileTime = 0,
    commitTime = 0;
  const tStart = Date.now();
  for (let tick = 0; tick < COMMITS; tick++) {
    const t0 = Date.now();
    const tree = renderNode(0, DEPTH, BREADTH, tick + WARMUP, 0);
    const t1 = Date.now();
    const wip = reconcile(current, tree, null);
    const t2 = Date.now();
    totalEffects += commit(wip);
    const t3 = Date.now();
    renderTime += t1 - t0;
    reconcileTime += t2 - t1;
    commitTime += t3 - t2;
    current = wip;
  }
  const total = Date.now() - tStart;

  print(
    'bench-typed: ' + String(COMMITS) + ' commits, tree ~3280 nodes, effects=' +
      String(totalEffects)
  );
  print('render(alloc):   ' + String(renderTime) + ' ms');
  print('reconcile(diff): ' + String(reconcileTime) + ' ms');
  print('commit(walk):    ' + String(commitTime) + ' ms');
  print('TOTAL:           ' + String(total) + ' ms  (' + String(total / COMMITS) + ' ms/commit)');
  if (gcs0 !== null) {
    const gcs1: any = HermesInternal.getInstrumentedStats();
    print('GC: numGCs=' + String(gcs1.js_numGCs - gcs0.js_numGCs) +
      ' gcTime=' + String(1000 * (gcs1.js_gcTime - gcs0.js_gcTime)) + 'ms' +
      ' gcCPU=' + String(1000 * (gcs1.js_gcCPUTime - gcs0.js_gcCPUTime)) + 'ms' +
      ' allocated=' + String((gcs1.js_totalAllocatedBytes - gcs0.js_totalAllocatedBytes) / 1048576) + 'MB' +
      ' heapSize=' + String(gcs1.js_heapSize / 1048576) + 'MB');
  }
}

main();
