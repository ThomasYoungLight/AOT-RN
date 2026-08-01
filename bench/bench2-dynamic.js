'use strict';
// bench2 (dynamic variant): realistic reconciler workload — social feed app.
// - Component functions building a ~2,800-node tree (150 post cards)
// - Per-post element cache -> reference-equal elements -> React-style bailouts
// - Keyed child reconciliation (positional fast path + keyed scan fallback)
// - subtreeFlags so the commit walk skips clean subtrees
// - 400 interactions: 70% like-toggle, 20% comments-toggle, 10% prepend post
// - GC stats via HermesInternal.getInstrumentedStats() when available

var log = typeof print !== 'undefined' ? print : console.log;

// ---- deterministic PRNG ----
var _seed = 987654321;
function rand() {
  _seed = (_seed * 1103515245 + 12345) % 2147483648;
  return _seed;
}

// ---- elements ----
function h(type, key, props, children) {
  return { type: type, key: key, props: props, children: children };
}

// ---- app state (parallel arrays; identical structure in typed variant) ----
var MAX_POSTS = 150;
var postIds = [];
var postAuthors = [];
var postTs = [];
var postContents = [];
var postLikes = [];
var postLiked = [];
var postShowComments = [];
var postVersions = [];
var nextPostId = 0;
var unreadCount = 3;
var activeTab = 0;

function makePost() {
  var id = nextPostId++;
  postIds.push(id);
  postAuthors.push('user_' + (id % 37));
  postTs.push('2h ago');
  postContents.push('This is post number ' + id + ' with some feed content to render.');
  postLikes.push(id % 50);
  postLiked.push(false);
  postShowComments.push(false);
  postVersions.push(0);
}

function prependPost() {
  var id = nextPostId++;
  if (postIds.length >= MAX_POSTS) {
    postIds.pop(); postAuthors.pop(); postTs.pop(); postContents.pop();
    postLikes.pop(); postLiked.pop(); postShowComments.pop(); postVersions.pop();
  }
  // manual shift (kept identical to the typed variant)
  postIds.push(0); postAuthors.push(''); postTs.push(''); postContents.push('');
  postLikes.push(0); postLiked.push(false); postShowComments.push(false); postVersions.push(0);
  for (var i = postIds.length - 1; i > 0; i--) {
    postIds[i] = postIds[i - 1];
    postAuthors[i] = postAuthors[i - 1];
    postTs[i] = postTs[i - 1];
    postContents[i] = postContents[i - 1];
    postLikes[i] = postLikes[i - 1];
    postLiked[i] = postLiked[i - 1];
    postShowComments[i] = postShowComments[i - 1];
    postVersions[i] = postVersions[i - 1];
  }
  postIds[0] = id;
  postAuthors[0] = 'user_' + (id % 37);
  postTs[0] = 'now';
  postContents[0] = 'Fresh post ' + id + ' just arrived in the feed.';
  postLikes[0] = 0;
  postLiked[0] = false;
  postShowComments[0] = false;
  postVersions[0] = 0;
}

// ---- element cache: unchanged posts return the SAME element object ----
var cacheIds = [];
var cacheVersions = [];
var cacheElements = [];

function lookupCache(id, version) {
  for (var i = 0; i < cacheIds.length; i++) {
    if (cacheIds[i] === id) {
      if (cacheVersions[i] === version) return cacheElements[i];
      return null;
    }
  }
  return null;
}

function storeCache(id, version, el) {
  for (var i = 0; i < cacheIds.length; i++) {
    if (cacheIds[i] === id) {
      cacheVersions[i] = version;
      cacheElements[i] = el;
      return;
    }
  }
  cacheIds.push(id);
  cacheVersions.push(version);
  cacheElements.push(el);
}

// ---- components ----
function renderAvatar(author) {
  return h('image', 0, { src: 'https://cdn.example.com/' + author + '.png', size: 40 }, null);
}

function renderPostCard(index) {
  var id = postIds[index];
  var version = postVersions[index];
  var cached = lookupCache(id, version);
  if (cached !== null) return cached;

  var headerRow = h('row', 0, { padding: 8 }, [
    renderAvatar(postAuthors[index]),
    h('column', 1, { flex: 1 }, [
      h('text', 0, { content: postAuthors[index], fontSize: 14, color: '#111' }, null),
      h('text', 1, { content: postTs[index], fontSize: 11, color: '#888' }, null)
    ])
  ]);
  var body = h('text', 1, { content: postContents[index], fontSize: 13, color: '#222' }, null);
  var likeLabel = postLiked[index] ? 'Liked' : 'Like';
  var actions = h('row', 2, { padding: 4 }, [
    h('button', 0, { label: likeLabel, count: postLikes[index], active: postLiked[index] }, null),
    h('button', 1, { label: 'Comment', count: 2, active: false }, null),
    h('button', 2, { label: 'Share', count: 0, active: false }, null)
  ]);
  var children = [headerRow, body, actions];
  if (postShowComments[index]) {
    children.push(h('column', 3, { padding: 12, background: '#f7f7f7' }, [
      h('text', 0, { content: 'Great point about post ' + id + '!', fontSize: 12, color: '#333' }, null),
      h('text', 1, { content: 'I disagree with post ' + id + ' entirely.', fontSize: 12, color: '#333' }, null)
    ]));
  }
  var card = h('card', id, { margin: 6, background: '#fff', borderRadius: 8 }, children);
  storeCache(id, version, card);
  return card;
}

function renderHeader() {
  return h('row', 0, { height: 56, background: '#4a76d0' }, [
    h('text', 0, { content: 'FeedApp', fontSize: 20, color: '#fff' }, null),
    h('badge', 1, { count: unreadCount, color: '#e33' }, null),
    h('button', 2, { label: 'Search', count: 0, active: false }, null),
    h('button', 3, { label: 'Inbox', count: unreadCount, active: false }, null)
  ]);
}

function renderFooter() {
  var tabs = [];
  for (var i = 0; i < 5; i++) {
    tabs.push(h('button', i, { label: 'Tab' + i, count: 0, active: i === activeTab }, null));
  }
  return h('row', 2, { height: 48, background: '#eee' }, tabs);
}

function renderApp() {
  var cards = [];
  for (var i = 0; i < postIds.length; i++) {
    cards.push(renderPostCard(i));
  }
  return h('root', 0, { flex: 1 }, [
    renderHeader(),
    h('scroll', 1, { flex: 1 }, cards),
    renderFooter()
  ]);
}

// ---- fibers ----
function Fiber(type, key) {
  this.type = type;
  this.key = key;
  this.props = null;
  this.element = null;
  this.child = null;
  this.sibling = null;
  this.parent = null;
  this.alternate = null;
  this.flags = 0;
  this.subtreeFlags = 0;
}

var statClones = 0;
var statBailouts = 0;
var statEffects = 0;

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
  if (current !== null && current.element === element) {
    // React-style bailout: reference-identical element -> reuse whole subtree
    statBailouts++;
    current.parent = parent;
    current.flags = 0;
    current.subtreeFlags = 0;
    return current;
  }
  var wip = new Fiber(element.type, element.key);
  wip.element = element;
  statClones++;
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
    var oldFirstChild = (current !== null && current.type === element.type) ? current.child : null;
    var prevSibling = null;
    var oldChild = oldFirstChild;
    var subtree = 0;
    for (var i = 0; i < elChildren.length; i++) {
      var el = elChildren[i];
      var match = null;
      if (oldChild !== null && oldChild.key === el.key && oldChild.type === el.type) {
        match = oldChild;
        oldChild = oldChild.sibling;
      } else {
        var scan = oldFirstChild;
        while (scan !== null) {
          if (scan.key === el.key && scan.type === el.type) { match = scan; break; }
          scan = scan.sibling;
        }
      }
      var childFiber = reconcile(match, el, wip);
      subtree = subtree | childFiber.flags | childFiber.subtreeFlags;
      if (i === 0) {
        wip.child = childFiber;
      } else {
        prevSibling.sibling = childFiber;
      }
      childFiber.sibling = null;
      prevSibling = childFiber;
    }
    wip.subtreeFlags = subtree;
  }
  return wip;
}

// ---- commit: walk only dirty subtrees ----
function commit(root) {
  var node = root;
  while (node !== null) {
    if (node.flags !== 0) statEffects++;
    if (node.child !== null && node.subtreeFlags !== 0) {
      node = node.child;
      continue;
    }
    while (node !== null && node.sibling === null) {
      node = node.parent;
    }
    if (node !== null) node = node.sibling;
  }
}

// ---- interactions ----
function applyInteraction() {
  var r = rand() % 100;
  if (r < 70) {
    var i = rand() % postIds.length;
    postLiked[i] = !postLiked[i];
    postLikes[i] = postLikes[i] + (postLiked[i] ? 1 : -1);
    postVersions[i] = postVersions[i] + 1;
  } else if (r < 90) {
    var j = rand() % postIds.length;
    postShowComments[j] = !postShowComments[j];
    postVersions[j] = postVersions[j] + 1;
  } else {
    prependPost();
    unreadCount = unreadCount + 1;
  }
}

// ---- GC stats ----
function gcStats() {
  if (typeof HermesInternal !== 'undefined' && HermesInternal.getInstrumentedStats) {
    return HermesInternal.getInstrumentedStats();
  }
  return null;
}

// ---- main ----
function main() {
  var WARMUP = 50;
  var TICKS = 2000;

  for (var p = 0; p < MAX_POSTS; p++) makePost();

  // initial mount + warmup
  var current = reconcile(null, renderApp(), null);
  commit(current);
  for (var w = 0; w < WARMUP; w++) {
    applyInteraction();
    var wWip = reconcile(current, renderApp(), null);
    commit(wWip);
    current = wWip;
  }

  statClones = 0; statBailouts = 0; statEffects = 0;
  var s0 = gcStats();
  var renderTime = 0, reconcileTime = 0, commitTime = 0;
  var tStart = Date.now();
  for (var tick = 0; tick < TICKS; tick++) {
    applyInteraction();
    var t0 = Date.now();
    var tree = renderApp();
    var t1 = Date.now();
    var wip = reconcile(current, tree, null);
    var t2 = Date.now();
    commit(wip);
    var t3 = Date.now();
    renderTime += t1 - t0;
    reconcileTime += t2 - t1;
    commitTime += t3 - t2;
    current = wip;
  }
  var total = Date.now() - tStart;
  var s1 = gcStats();

  log('bench2-dynamic: ' + TICKS + ' interactions, ' + postIds.length + ' posts');
  log('clones=' + statClones + ' bailouts=' + statBailouts + ' effects=' + statEffects);
  log('render(components): ' + renderTime + ' ms');
  log('reconcile(keyed):   ' + reconcileTime + ' ms');
  log('commit(dirty-walk): ' + commitTime + ' ms');
  log('TOTAL:              ' + total + ' ms  (' + (total / TICKS).toFixed(3) + ' ms/interaction)');
  if (s0 !== null && s1 !== null) {
    log('GC: numGCs=' + (s1['js_numGCs'] - s0['js_numGCs']) +
      ' gcTime=' + (1000 * (s1['js_gcTime'] - s0['js_gcTime'])).toFixed(1) + 'ms' +
      ' gcCPU=' + (1000 * (s1['js_gcCPUTime'] - s0['js_gcCPUTime'])).toFixed(1) + 'ms');
    log('GC: allocated=' + ((s1['js_totalAllocatedBytes'] - s0['js_totalAllocatedBytes']) / 1048576).toFixed(1) + 'MB' +
      ' heapSize=' + (s1['js_heapSize'] / 1048576).toFixed(1) + 'MB' +
      ' gcShare=' + (100 * 1000 * (s1['js_gcTime'] - s0['js_gcTime']) / total).toFixed(1) + '%');
  } else {
    log('GC: HermesInternal.getInstrumentedStats not available');
  }
}

main();
