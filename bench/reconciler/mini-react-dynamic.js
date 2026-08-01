'use strict';
// Dynamic twin of mini-react-typed.ts: identical fiber architecture and
// algorithm, written the way reconciler code is written today — object-literal
// sparse props, for-in shallow equality, plain-object fibers/hooks/elements.
// Parity: identical seeded interactions and stats (renders/bailouts/
// placements/updates/deletions/effects, commit checksum).

var log = typeof print !== 'undefined' ? print : console.log;

// ---------- props ----------
function equalProps(a, b) {
  for (var k in a) {
    if (a[k] !== b[k]) return false;
  }
  for (var k2 in b) {
    if (!(k2 in a)) return false;
  }
  return true;
}

var EMPTY_PROPS = {};

// ---------- elements ----------
var TAG_HOST = 0;
var TAG_FC = 1;
var TAG_TEXT = 2;

function host(type, key, props, children) {
  return {tag: TAG_HOST, type: type, render: null, memo: false, key: key, props: props, children: children, text: null};
}

function text(key, value) {
  return {tag: TAG_TEXT, type: 'raw', render: null, memo: false, key: key, props: EMPTY_PROPS, children: null, text: value};
}

function component(render, memo, key, props) {
  return {tag: TAG_FC, type: 'fc', render: render, memo: memo, key: key, props: props, children: null, text: null};
}

// ---------- fibers & hooks ----------
function Fiber(tag, type, key) {
  this.tag = tag;
  this.type = type;
  this.render = null;
  this.memo = false;
  this.key = key;
  this.props = null;
  this.text = null;
  this.child = null;
  this.sibling = null;
  this.parent = null;
  this.alternate = null;
  this.hooks = null;
  this.flags = 0;
  this.subtreeFlags = 0;
}

var statRenders = 0;
var statBailouts = 0;
var statPlacements = 0;
var statUpdates = 0;
var statDeletions = 0;
var checksum = 0;

var hookFiber = null;
var hookCursor = null;
var hookNeedsFlush = false;

function useState(initial) {
  var owner = hookFiber;
  if (owner === null) throw new Error('useState outside render');
  var hook;
  if (hookCursor === null) {
    if (owner.hooks === null) {
      hook = makeHook(initial);
      owner.hooks = hook;
    } else {
      hook = owner.hooks;
    }
  } else {
    if (hookCursor.next === null) {
      hook = makeHook(initial);
      hookCursor.next = hook;
    } else {
      hook = hookCursor.next;
    }
  }
  hookCursor = hook;
  return hook;
}

function makeHook(initial) {
  var hook = {state: initial, set: null, dirty: false, next: null};
  hook.set = function (v) {
    hook.state = v;
    hook.dirty = true;
    hookNeedsFlush = true;
  };
  return hook;
}

function hooksDirty(fiber) {
  var h = fiber.hooks;
  while (h !== null) {
    if (h.dirty) return true;
    h = h.next;
  }
  return false;
}

function clearHookDirty(fiber) {
  var h = fiber.hooks;
  while (h !== null) {
    h.dirty = false;
    h = h.next;
  }
}

// ---------- reconciliation ----------
function createFiberFromElement(el) {
  var f = new Fiber(el.tag, el.type, el.key);
  f.render = el.render;
  f.memo = el.memo;
  f.props = el.props;
  f.text = el.text;
  f.flags = 2;
  statPlacements++;
  return f;
}

function cloneFiber(current, el) {
  var f = new Fiber(current.tag, current.tag === TAG_FC ? 'fc' : el.type, el.key);
  f.render = el.render;
  f.memo = el.memo;
  f.props = el.props;
  f.text = el.text;
  f.alternate = current;
  f.hooks = current.hooks;
  return f;
}

function sameType(f, el) {
  if (f.tag !== el.tag) return false;
  if (f.tag === TAG_FC) return f.render === el.render;
  return f.type === el.type;
}

function reconcileChildren(wip, elements) {
  if (elements === null) {
    var drop = wip.alternate !== null ? wip.alternate.child : null;
    while (drop !== null) {
      statDeletions++;
      drop = drop.sibling;
    }
    return;
  }
  var old = wip.alternate !== null ? wip.alternate.child : null;
  var prev = null;
  var i = 0;

  while (old !== null && i < elements.length) {
    var el = elements[i];
    if (old.key !== el.key) break;
    var same = sameType(old, el);
    var f = same ? cloneFiber(old, el) : createFiberFromElement(el);
    if (!same) statDeletions++;
    f.parent = wip;
    if (prev === null) {
      wip.child = f;
    } else {
      prev.sibling = f;
    }
    prev = f;
    old = old.sibling;
    i++;
  }

  if (i === elements.length) {
    while (old !== null) {
      statDeletions++;
      old = old.sibling;
    }
    return;
  }

  var map = new Map();
  var rest = old;
  while (rest !== null) {
    map.set(rest.key, rest);
    rest = rest.sibling;
  }
  for (; i < elements.length; i++) {
    var el2 = elements[i];
    var match = map.get(el2.key);
    var f2;
    if (match !== undefined && sameType(match, el2)) {
      f2 = cloneFiber(match, el2);
      map.delete(el2.key);
    } else {
      f2 = createFiberFromElement(el2);
      if (match !== undefined) {
        map.delete(el2.key);
        statDeletions++;
      }
    }
    f2.parent = wip;
    if (prev === null) {
      wip.child = f2;
    } else {
      prev.sibling = f2;
    }
    prev = f2;
  }
  statDeletions += map.size;
}

function bailout(wip) {
  statBailouts++;
  var current = wip.alternate;
  wip.child = current !== null ? current.child : null;
  var c = wip.child;
  while (c !== null) {
    c.parent = wip;
    c = c.sibling;
  }
}

var hostChildrenMap = new Map();

function hostChildrenOf(f) {
  var kids = hostChildrenMap.get(f.props);
  return kids === undefined ? null : kids;
}

function registerHostChildren(el) {
  if (el.tag === TAG_HOST && el.children !== null) {
    hostChildrenMap.set(el.props, el.children);
    for (var i = 0; i < el.children.length; i++) {
      registerHostChildren(el.children[i]);
    }
  }
}

function beginWork(wip) {
  if (wip.tag === TAG_FC) {
    var current = wip.alternate;
    if (
      wip.memo &&
      current !== null &&
      current.props !== null &&
      wip.props !== null &&
      !hooksDirty(wip) &&
      equalProps(current.props, wip.props)
    ) {
      bailout(wip);
      return false;
    }
    clearHookDirty(wip);
    statRenders++;
    hookFiber = wip;
    hookCursor = null;
    var rendered = wip.render(wip.props);
    hookFiber = null;
    reconcileChildren(wip, [rendered]);
    return true;
  }
  if (wip.tag === TAG_HOST) {
    var cur = wip.alternate;
    if (cur !== null) {
      if (cur.props !== null && wip.props !== null && !equalProps(cur.props, wip.props)) {
        wip.flags |= 1;
        statUpdates++;
      }
    }
    reconcileChildren(wip, hostChildrenOf(wip));
    return true;
  }
  var curT = wip.alternate;
  if (curT !== null && curT.text !== wip.text) {
    wip.flags |= 1;
    statUpdates++;
  }
  return true;
}

// ---------- work loop ----------
function workLoop(root) {
  var node = root;
  while (node !== null) {
    var descend = beginWork(node);
    if (descend && node.child !== null) {
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
}

// ---------- commit ----------
function commit(root) {
  var effects = 0;
  var node = root;
  while (node !== null) {
    if (node.flags !== 0) {
      effects++;
      var p = node.props;
      if (p !== null) {
        checksum = (checksum + (p.id || 0) + (p.likes || 0) + (p.liked ? 7 : 1) + (p.fontSize || 0)) | 0;
      }
      node.flags = 0;
    }
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

// ---------- app: feed screen ----------
function Post(id, author, ts, content, likes) {
  this.id = id;
  this.author = author;
  this.ts = ts;
  this.content = content;
  this.likes = likes;
  this.liked = false;
}

var pressHandlers = [];

function PostCard(props) {
  var rows = [];
  rows.push(host('text-title', 1, {id: props.id, title: props.title, fontSize: 16, color: '#111'}, [
    text(1, props.title !== null ? props.title : ''),
  ]));
  rows.push(host('text-body', 2, {id: props.id, body: props.body, fontSize: 13, color: '#333'}, [
    text(1, props.body !== null ? props.body : ''),
  ]));
  rows.push(host('button', 3, {
    id: props.id,
    likes: props.likes,
    liked: props.liked,
    background: props.liked ? '#e33' : '#eee',
    borderRadius: 6,
    onPress: props.onPress,
  }, [text(1, 'Like ' + props.likes)]));
  var card = host('view-card', 0, {id: props.id, padding: 12, margin: 8, background: '#fff', borderRadius: 12}, rows);
  registerHostChildren(card);
  return card;
}

function Header(props) {
  var h = host('view-header', 0, {id: -1, title: props.title, height: 56, background: '#fafafa'}, [
    text(1, props.title !== null ? props.title : ''),
  ]);
  registerHostChildren(h);
  return h;
}

function Footer(props) {
  var f = host('view-footer', 0, {id: -2, likes: props.likes, height: 48}, [text(1, 'total ' + props.likes)]);
  registerHostChildren(f);
  return f;
}

function App(props) {
  var postsHook = useState(null);
  var versionHook = useState(0);
  var posts = postsHook.state;

  pressHandlers = [];
  var children = [];

  children.push(component(Header, true, 1000000, {title: 'Feed v' + versionHook.state}));

  var totalLikes = 0;
  for (var i = 0; i < posts.length; i++) {
    var post = posts[i];
    totalLikes += post.likes;
    var p = {
      id: post.id,
      title: post.author + ' · ' + post.ts,
      body: post.content,
      likes: post.likes,
      liked: post.liked,
      onPress: makePressHandler(postsHook, posts, i),
    };
    pressHandlers.push(p.onPress);
    children.push(component(PostCard, true, post.id, p));
  }

  children.push(component(Footer, true, 1000001, {likes: totalLikes}));

  var rootEl = host('view-root', 0, {flex: 1, direction: 'column'}, children);
  registerHostChildren(rootEl);
  return rootEl;
}

var handlerCache = new Map();

function makePressHandler(postsHook, posts, index) {
  var post = posts[index];
  var postId = post.id;
  var cacheKey = postId * 1048576 + post.likes * 2 + (post.liked ? 1 : 0);
  var cached = handlerCache.get(cacheKey);
  if (cached !== undefined) return cached;
  var handler = function () {
    var cur = postsHook.state;
    var next = cur.slice();
    for (var j = 0; j < next.length; j++) {
      var p = next[j];
      if (p.id === postId) {
        var np = new Post(p.id, p.author, p.ts, p.content, p.liked ? p.likes - 1 : p.likes + 1);
        np.liked = !p.liked;
        next[j] = np;
        break;
      }
    }
    postsHook.set(next);
  };
  handlerCache.set(cacheKey, handler);
  return handler;
}

// ---------- render root ----------
var currentRoot = null;

function renderRoot() {
  hostChildrenMap.clear();
  var appEl = component(App, false, 0, {});
  var wip;
  if (currentRoot === null) {
    wip = createFiberFromElement(appEl);
  } else {
    wip = cloneFiber(currentRoot, appEl);
  }
  workLoop(wip);
  var effects = commit(wip);
  currentRoot = wip;
  hookNeedsFlush = false;
  return effects;
}

// ---------- driver ----------
var seed = 987654321;
function rand(n) {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed % n;
}

function main() {
  var POSTS = 150;
  var WARMUP = 50;
  var TICKS = 2000;

  var initialPosts = [];
  for (var i = 0; i < POSTS; i++) {
    initialPosts.push(new Post(i + 1, 'user' + (i % 17), 1700000000 + i, 'post content ' + i, i % 23));
  }
  var nextPostId = POSTS + 1;

  var bootFiber = new Fiber(TAG_FC, 'fc', 0);
  hookFiber = bootFiber;
  hookCursor = null;
  var rootPostsHook = useState(initialPosts);
  var rootVersionHook = useState(0);
  hookFiber = null;
  var appEl0 = component(App, false, 0, {});
  var rootFiber = createFiberFromElement(appEl0);
  rootFiber.hooks = bootFiber.hooks;
  hostChildrenMap.clear();
  workLoop(rootFiber);
  commit(rootFiber);
  currentRoot = rootFiber;

  var totalEffects = 0;

  function interact(tick) {
    var r = rand(100);
    if (r < 70) {
      var idx = rand(pressHandlers.length);
      pressHandlers[idx]();
    } else if (r < 90) {
      var posts = rootPostsHook.state;
      var idx2 = rand(posts.length);
      var next = posts.slice();
      var p = posts[idx2];
      var np = new Post(p.id, p.author, p.ts, p.content + '!', p.likes);
      np.liked = p.liked;
      next[idx2] = np;
      rootPostsHook.set(next);
    } else {
      var posts2 = rootPostsHook.state;
      var next2 = posts2.slice();
      var np2 = new Post(nextPostId, 'user' + (tick % 17), 1700000000 + tick, 'new post ' + tick, 0);
      nextPostId++;
      if (next2.length >= 200) {
        next2.pop();
      }
      next2.unshift(np2);
      rootPostsHook.set(next2);
      rootVersionHook.set(rootVersionHook.state + 1);
    }
    totalEffects += renderRoot();
  }

  for (var w = 0; w < WARMUP; w++) {
    interact(w);
  }

  statRenders = 0;
  statBailouts = 0;
  statPlacements = 0;
  statUpdates = 0;
  statDeletions = 0;
  checksum = 0;

  var gcs0 = (typeof HermesInternal !== 'undefined' && HermesInternal.getInstrumentedStats)
    ? HermesInternal.getInstrumentedStats() : null;
  var t0 = Date.now();
  for (var t = 0; t < TICKS; t++) {
    interact(t + WARMUP);
  }
  var total = Date.now() - t0;

  log('mini-react-dynamic: ' + TICKS + ' interactions, ' + rootPostsHook.state.length + ' posts');
  log('renders=' + statRenders + ' bailouts=' + statBailouts +
    ' placements=' + statPlacements + ' updates=' + statUpdates +
    ' deletions=' + statDeletions + ' effects=' + totalEffects +
    ' checksum=' + checksum);
  log('TOTAL: ' + total + ' ms  (' + (total / TICKS).toFixed(4) + ' ms/interaction)');
  if (gcs0 !== null) {
    var gcs1 = HermesInternal.getInstrumentedStats();
    log('GC: numGCs=' + (gcs1.js_numGCs - gcs0.js_numGCs) +
      ' gcTime=' + (1000 * (gcs1.js_gcTime - gcs0.js_gcTime)).toFixed(1) + 'ms' +
      ' allocated=' + ((gcs1.js_totalAllocatedBytes - gcs0.js_totalAllocatedBytes) / 1048576).toFixed(1) + 'MB');
  }
}

main();
