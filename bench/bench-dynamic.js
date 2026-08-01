'use strict';
// Reconciler-shaped benchmark (dynamic/idiomatic variant).
// Simulates React fiber work per commit:
//   render:    element tree allocation ({type, props, children} literals)
//   reconcile: type check + props diff (for-in over dynamic keys) + fiber clone
//   commit:    child/sibling/parent linked-list walk counting effects
// Deterministic; no Math.random. Portable across node / hermes / shermes.

var log = typeof print !== 'undefined' ? print : console.log;

// ---- element creation (render phase) ----
function h(type, props, children) {
  return { type: type, props: props, children: children };
}

function renderNode(level, depth, breadth, tick, index) {
  if (level >= depth) {
    var changing = (index % 10) === 0;
    return h('text', {
      key: index,
      content: changing ? ('item ' + index + ' t' + tick) : ('item ' + index),
      color: (index % 3 === 0) ? 'red' : 'blue',
      fontSize: 12 + (index % 4)
    }, null);
  }
  var children = [];
  for (var i = 0; i < breadth; i++) {
    children.push(renderNode(level + 1, depth, breadth, tick, index * breadth + i));
  }
  // vary prop shapes by level to induce megamorphic access
  var props;
  if (level % 3 === 0) {
    props = { key: index, direction: 'column', padding: 4, flex: 1 };
  } else if (level % 3 === 1) {
    props = { key: index, direction: 'row', margin: 2, background: '#fff', opacity: 1 };
  } else {
    props = { key: index, width: 100 + level, height: 50 + level, overflow: 'hidden' };
  }
  return h((level % 2 === 0) ? 'view' : 'stack', props, children);
}

// ---- fiber ----
function Fiber(type) {
  this.type = type;
  this.props = null;
  this.child = null;
  this.sibling = null;
  this.parent = null;
  this.alternate = null;
  this.flags = 0;
}

function diffProps(oldProps, newProps) {
  var changed = 0;
  for (var k in newProps) {
    if (oldProps[k] !== newProps[k]) changed++;
  }
  for (var k2 in oldProps) {
    if (!(k2 in newProps)) changed++;
  }
  return changed;
}

function reconcile(current, element, parent) {
  var wip = new Fiber(element.type);
  if (current !== null && current.type === element.type) {
    wip.alternate = current;
    var changed = diffProps(current.props, element.props);
    wip.props = element.props;
    wip.flags = changed > 0 ? 1 : 0; // update
  } else {
    wip.props = element.props;
    wip.flags = 2; // placement
  }
  wip.parent = parent;
  var elChildren = element.children;
  if (elChildren !== null) {
    var prevSibling = null;
    var oldChild = (current !== null) ? current.child : null;
    for (var i = 0; i < elChildren.length; i++) {
      var childFiber = reconcile(oldChild, elChildren[i], wip);
      if (i === 0) {
        wip.child = childFiber;
      } else {
        prevSibling.sibling = childFiber;
      }
      prevSibling = childFiber;
      oldChild = (oldChild !== null) ? oldChild.sibling : null;
    }
  }
  return wip;
}

// ---- commit: linked-list traversal counting effects ----
function commit(root) {
  var effects = 0;
  var node = root;
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

// ---- main ----
function main() {
  var DEPTH = 7;    // 3^7 = 2187 leaves, ~3280 nodes total
  var BREADTH = 3;
  var WARMUP = 30;
  var COMMITS = 300;

  var current = null;
  var totalEffects = 0;

  // warmup
  for (var w = 0; w < WARMUP; w++) {
    var wTree = renderNode(0, DEPTH, BREADTH, w, 0);
    var wWip = reconcile(current, wTree, null);
    totalEffects += commit(wWip);
    current = wWip;
  }

  var gcs0 = (typeof HermesInternal !== 'undefined' && HermesInternal.getInstrumentedStats)
    ? HermesInternal.getInstrumentedStats() : null;
  var renderTime = 0, reconcileTime = 0, commitTime = 0;
  var tStart = Date.now();
  for (var tick = 0; tick < COMMITS; tick++) {
    var t0 = Date.now();
    var tree = renderNode(0, DEPTH, BREADTH, tick + WARMUP, 0);
    var t1 = Date.now();
    var wip = reconcile(current, tree, null);
    var t2 = Date.now();
    totalEffects += commit(wip);
    var t3 = Date.now();
    renderTime += t1 - t0;
    reconcileTime += t2 - t1;
    commitTime += t3 - t2;
    current = wip;
  }
  var total = Date.now() - tStart;

  log('bench-dynamic: ' + COMMITS + ' commits, tree ~3280 nodes, effects=' + totalEffects);
  log('render(alloc):   ' + renderTime + ' ms');
  log('reconcile(diff): ' + reconcileTime + ' ms');
  log('commit(walk):    ' + commitTime + ' ms');
  log('TOTAL:           ' + total + ' ms  (' + (total / COMMITS).toFixed(3) + ' ms/commit)');
  if (gcs0 !== null) {
    var gcs1 = HermesInternal.getInstrumentedStats();
    log('GC: numGCs=' + (gcs1['js_numGCs'] - gcs0['js_numGCs']) +
      ' gcTime=' + (1000 * (gcs1['js_gcTime'] - gcs0['js_gcTime'])).toFixed(1) + 'ms' +
      ' gcCPU=' + (1000 * (gcs1['js_gcCPUTime'] - gcs0['js_gcCPUTime'])).toFixed(1) + 'ms' +
      ' allocated=' + ((gcs1['js_totalAllocatedBytes'] - gcs0['js_totalAllocatedBytes']) / 1048576).toFixed(1) + 'MB' +
      ' heapSize=' + (gcs1['js_heapSize'] / 1048576).toFixed(1) + 'MB' +
      ' gcShare=' + (100 * 1000 * (gcs1['js_gcTime'] - gcs0['js_gcTime']) / total).toFixed(1) + '%');
  }
}

main();
