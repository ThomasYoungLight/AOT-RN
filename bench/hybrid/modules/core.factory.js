function (global, require, module, exports) {
  'use strict';
  // "Ring 0" fallback: the reconciler in idiomatic dynamic JS. This is the
  // implementation the bundle always carries; the app binary carries a typed
  // native port registered under the same module id + hash.
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
      wip.flags = changed > 0 ? 1 : 0;
    } else {
      wip.props = element.props;
      wip.flags = 2;
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

  function runCommits(commits, warmup) {
    var DEPTH = 7;
    var BREADTH = 3;
    var current = null;
    var totalEffects = 0;
    for (var t = 0; t < warmup + commits; t++) {
      var tree = renderNode(0, DEPTH, BREADTH, t, 0);
      var wip = reconcile(current, tree, null);
      var e = commit(wip);
      if (t >= warmup) totalEffects += e;
      current = wip;
    }
    return totalEffects;
  }

  module.exports = { runCommits: runCommits, impl: 'interpreted-dynamic' };
}
