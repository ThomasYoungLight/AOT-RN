'use strict';
// Ring 0: typed native port of the reconciler, compiled with `shermes -typed`
// into an SHUnit. Registered under module id 'core' keyed by the content hash
// of the *bundle's* JS implementation (core.factory.js) — equivalence of the
// typed port is established at build time, hash equality gates dispatch.

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

function runCommits(commits: number, warmup: number): number {
  const DEPTH = 7;
  const BREADTH = 3;
  let current: Fiber | null = null;
  let totalEffects = 0;
  for (let t = 0; t < warmup + commits; t++) {
    const tree = renderNode(0, DEPTH, BREADTH, t, 0);
    const wip = reconcile(current, tree, null);
    const e = commit(wip);
    if (t >= warmup) totalEffects += e;
    current = wip;
  }
  return totalEffects;
}

(function (): void {
  const g: any = globalThis;
  const manifest: any = g.__nativeModules || (g.__nativeModules = {});
  const entry: any = {};
  entry.hash = '__CORE_HASH__';
  entry.factory = function (global: any, require: any, module: any, exports: any): void {
    const api: any = {};
    api.runCommits = runCommits;
    api.impl = 'native-typed';
    module.exports = api;
  };
  manifest['core'] = entry;
})();
