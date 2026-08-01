'use strict';
// Typed port of the React fiber reconciler's hot path (shermes -typed).
//
// Faithful to React's architecture: function components with a persistent
// hooks list, memo bailouts that reuse the current subtree, two-pass keyed
// child reconciliation, host-prop diffing in completeWork, a child/sibling/
// return work loop, and a separate commit phase walking effect flags.
// Feature surface is reduced (single sync lane; no context/suspense/refs) —
// this is the hot path that burns frame time, restructured for static shapes.
//
// Parity contract with mini-react-dynamic.js: identical algorithm, seeded
// interactions, and stats (renders/bailouts/placements/updates/deletions,
// commit checksum).

const G: any = globalThis;

// ---------- host props: fixed shape (RN-ish subset) ----------
class Props {
  id: number;
  title: string | null;
  body: string | null;
  likes: number;
  liked: boolean;
  width: number;
  height: number;
  padding: number;
  margin: number;
  flex: number;
  color: string | null;
  background: string | null;
  fontSize: number;
  direction: string | null;
  opacity: number;
  borderRadius: number;
  onPress: any;

  constructor() {
    this.id = 0;
    this.title = null;
    this.body = null;
    this.likes = 0;
    this.liked = false;
    this.width = 0;
    this.height = 0;
    this.padding = 0;
    this.margin = 0;
    this.flex = 0;
    this.color = null;
    this.background = null;
    this.fontSize = 0;
    this.direction = null;
    this.opacity = 0;
    this.borderRadius = 0;
    this.onPress = null;
  }
}

function equalProps(a: Props, b: Props): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.body === b.body &&
    a.likes === b.likes &&
    a.liked === b.liked &&
    a.width === b.width &&
    a.height === b.height &&
    a.padding === b.padding &&
    a.margin === b.margin &&
    a.flex === b.flex &&
    a.color === b.color &&
    a.background === b.background &&
    a.fontSize === b.fontSize &&
    a.direction === b.direction &&
    a.opacity === b.opacity &&
    a.borderRadius === b.borderRadius &&
    a.onPress === b.onPress
  );
}

// ---------- elements ----------
const TAG_HOST = 0;
const TAG_FC = 1;
const TAG_TEXT = 2;

class Element {
  tag: number;
  type: string;
  render: any; // component function for TAG_FC
  memo: boolean;
  key: number;
  props: Props;
  children: Element[] | null;
  text: string | null;

  constructor(tag: number, type: string, key: number, props: Props) {
    this.tag = tag;
    this.type = type;
    this.render = null;
    this.memo = false;
    this.key = key;
    this.props = props;
    this.children = null;
    this.text = null;
  }
}

function host(type: string, key: number, props: Props, children: Element[] | null): Element {
  const e = new Element(TAG_HOST, type, key, props);
  e.children = children;
  return e;
}

function text(key: number, value: string): Element {
  const e = new Element(TAG_TEXT, 'raw', key, EMPTY_PROPS);
  e.text = value;
  return e;
}

function component(render: any, memo: boolean, key: number, props: Props): Element {
  const e = new Element(TAG_FC, 'fc', key, props);
  e.render = render;
  e.memo = memo;
  return e;
}

const EMPTY_PROPS = new Props();

// ---------- fibers & hooks ----------
class Hook {
  state: any;
  set: any; // setter closure, created once
  dirty: boolean;
  next: Hook | null;

  constructor(initial: any) {
    this.state = initial;
    this.set = null;
    this.dirty = false;
    this.next = null;
  }
}

class Fiber {
  tag: number;
  type: string;
  render: any;
  memo: boolean;
  key: number;
  props: Props | null;
  text: string | null;
  child: Fiber | null;
  sibling: Fiber | null;
  parent: Fiber | null;
  alternate: Fiber | null;
  hooks: Hook | null; // persistent across renders (shared with alternate)
  flags: number; // 1 update, 2 placement
  subtreeFlags: number;

  constructor(tag: number, type: string, key: number) {
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
}

// stats
let statRenders = 0;
let statBailouts = 0;
let statPlacements = 0;
let statUpdates = 0;
let statDeletions = 0;
let checksum = 0;

// hooks runtime
let hookFiber: Fiber | null = null;
let hookCursor: Hook | null = null;
let hookNeedsFlush = false;

function useState(initial: any): Hook {
  const owner = hookFiber;
  if (owner === null) {
    throw new Error('useState outside render');
  }
  let hook: Hook;
  if (hookCursor === null) {
    if (owner.hooks === null) {
      hook = new Hook(initial);
      hook.set = function (v: any): void {
        hook.state = v;
        hook.dirty = true;
        hookNeedsFlush = true;
      };
      owner.hooks = hook;
    } else {
      hook = owner.hooks;
    }
  } else {
    const cur = hookCursor;
    if (cur.next === null) {
      hook = new Hook(initial);
      hook.set = function (v: any): void {
        hook.state = v;
        hook.dirty = true;
        hookNeedsFlush = true;
      };
      cur.next = hook;
    } else {
      hook = cur.next;
    }
  }
  hookCursor = hook;
  return hook;
}

function hooksDirty(fiber: Fiber): boolean {
  let h = fiber.hooks;
  while (h !== null) {
    if (h.dirty) {
      return true;
    }
    h = h.next;
  }
  return false;
}

function clearHookDirty(fiber: Fiber): void {
  let h = fiber.hooks;
  while (h !== null) {
    h.dirty = false;
    h = h.next;
  }
}

// ---------- reconciliation ----------
function createFiberFromElement(el: Element): Fiber {
  const f = new Fiber(el.tag, el.type, el.key);
  f.render = el.render;
  f.memo = el.memo;
  f.props = el.props;
  f.text = el.text;
  f.flags = 2; // placement
  statPlacements++;
  return f;
}

function cloneFiber(current: Fiber, el: Element): Fiber {
  const f = new Fiber(current.tag, current.tag === TAG_FC ? 'fc' : el.type, el.key);
  f.render = el.render;
  f.memo = el.memo;
  f.props = el.props;
  f.text = el.text;
  f.alternate = current;
  f.hooks = current.hooks; // persistent hooks list shared via alternate chain
  return f;
}

function sameType(f: Fiber, el: Element): boolean {
  if (f.tag !== el.tag) {
    return false;
  }
  if (f.tag === TAG_FC) {
    return f.render === el.render;
  }
  return f.type === el.type;
}

// Two-pass keyed reconciliation (React's reconcileChildrenArray, reduced).
function reconcileChildren(wip: Fiber, elements: Element[] | null): void {
  if (elements === null) {
    let drop: Fiber | null = wip.alternate !== null ? wip.alternate.child : null;
    while (drop !== null) {
      statDeletions++;
      drop = drop.sibling;
    }
    return;
  }
  let old: Fiber | null = wip.alternate !== null ? wip.alternate.child : null;
  let prev: Fiber | null = null;
  let i = 0;

  // Pass 1: walk while position+key+type line up.
  while (old !== null && i < elements.length) {
    const el = elements[i];
    if (old.key !== el.key) {
      break;
    }
    const f = sameType(old, el) ? cloneFiber(old, el) : createFiberFromElement(el);
    if (!sameType(old, el)) {
      statDeletions++;
    }
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
    // remaining old children are deletions
    while (old !== null) {
      statDeletions++;
      old = old.sibling;
    }
    return;
  }

  // Pass 2: map remaining old children by key.
  const map: any = new G.Map();
  let rest = old;
  while (rest !== null) {
    map.set(rest.key, rest);
    rest = rest.sibling;
  }
  for (; i < elements.length; i++) {
    const el = elements[i];
    const match: any = map.get(el.key);
    let f: Fiber;
    if (match !== undefined && sameType(match, el)) {
      f = cloneFiber(match, el);
      map.delete(el.key);
    } else {
      f = createFiberFromElement(el);
      if (match !== undefined) {
        map.delete(el.key);
        statDeletions++;
      }
    }
    f.parent = wip;
    if (prev === null) {
      wip.child = f;
    } else {
      prev.sibling = f;
    }
    prev = f;
  }
  statDeletions += map.size;
}

// Reuse the current subtree untouched (React's bailoutOnAlreadyFinishedWork).
function bailout(wip: Fiber): void {
  statBailouts++;
  const current = wip.alternate;
  wip.child = current !== null ? current.child : null;
  let c = wip.child;
  while (c !== null) {
    c.parent = wip;
    c = c.sibling;
  }
}

function beginWork(wip: Fiber): boolean {
  if (wip.tag === TAG_FC) {
    const current = wip.alternate;
    if (
      wip.memo &&
      current !== null &&
      current.props !== null &&
      wip.props !== null &&
      !hooksDirty(wip) &&
      equalProps(current.props, wip.props)
    ) {
      bailout(wip);
      return false; // do not descend into the reused subtree
    }
    clearHookDirty(wip);
    statRenders++;
    hookFiber = wip;
    hookCursor = null;
    const rendered: any = wip.render(wip.props);
    hookFiber = null;
    const kids: Element[] = [rendered];
    reconcileChildren(wip, kids);
    return true;
  }
  if (wip.tag === TAG_HOST) {
    // host prop diff decides the update flag (React does this in completeWork;
    // doing it here keeps a single walk — same comparisons).
    const current = wip.alternate;
    if (current !== null) {
      const oldProps = current.props;
      const newProps = wip.props;
      if (oldProps !== null && newProps !== null && !equalProps(oldProps, newProps)) {
        wip.flags |= 1;
        statUpdates++;
      }
    }
    // reconcile host children from the element tree captured at render time
    reconcileChildren(wip, hostChildrenOf(wip));
    return true;
  }
  // TAG_TEXT
  const current = wip.alternate;
  if (current !== null && current.text !== wip.text) {
    wip.flags |= 1;
    statUpdates++;
  }
  return true;
}

// Host fibers carry their element children through a side table captured
// during the parent component's render (element identity keyed).
const hostChildrenMap: any = new G.Map();

function hostChildrenOf(f: Fiber): Element[] | null {
  const kids: any = hostChildrenMap.get(f.props);
  return kids === undefined ? null : kids;
}

function registerHostChildren(el: Element): void {
  if (el.tag === TAG_HOST && el.children !== null) {
    hostChildrenMap.set(el.props, el.children);
    for (let i = 0; i < el.children.length; i++) {
      registerHostChildren(el.children[i]);
    }
  }
}

// ---------- work loop ----------
function workLoop(root: Fiber): void {
  let node: Fiber | null = root;
  while (node !== null) {
    const descend = beginWork(node);
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
function commit(root: Fiber): number {
  let effects = 0;
  let node: Fiber | null = root;
  while (node !== null) {
    if (node.flags !== 0) {
      effects++;
      const p = node.props;
      if (p !== null) {
        checksum = (checksum + p.id + p.likes + (p.liked ? 7 : 1) + p.fontSize) | 0;
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
class Post {
  id: number;
  author: string;
  ts: number;
  content: string;
  likes: number;
  liked: boolean;

  constructor(id: number, author: string, ts: number, content: string, likes: number) {
    this.id = id;
    this.author = author;
    this.ts = ts;
    this.content = content;
    this.likes = likes;
    this.liked = false;
  }
}

let pressHandlers: any[] = [];

function PostCard(props: Props): Element {
  const rows: Element[] = [];
  const titleProps = new Props();
  titleProps.id = props.id;
  titleProps.title = props.title;
  titleProps.fontSize = 16;
  titleProps.color = '#111';
  rows.push(host('text-title', 1, titleProps, [text(1, props.title !== null ? props.title : '')]));

  const bodyProps = new Props();
  bodyProps.id = props.id;
  bodyProps.body = props.body;
  bodyProps.fontSize = 13;
  bodyProps.color = '#333';
  rows.push(host('text-body', 2, bodyProps, [text(1, props.body !== null ? props.body : '')]));

  const likeProps = new Props();
  likeProps.id = props.id;
  likeProps.likes = props.likes;
  likeProps.liked = props.liked;
  likeProps.background = props.liked ? '#e33' : '#eee';
  likeProps.borderRadius = 6;
  likeProps.onPress = props.onPress;
  rows.push(host('button', 3, likeProps, [text(1, 'Like ' + String(props.likes))]));

  const cardProps = new Props();
  cardProps.id = props.id;
  cardProps.padding = 12;
  cardProps.margin = 8;
  cardProps.background = '#fff';
  cardProps.borderRadius = 12;
  const card = host('view-card', 0, cardProps, rows);
  registerHostChildren(card);
  return card;
}

function Header(props: Props): Element {
  const hp = new Props();
  hp.id = -1;
  hp.title = props.title;
  hp.height = 56;
  hp.background = '#fafafa';
  const h = host('view-header', 0, hp, [text(1, props.title !== null ? props.title : '')]);
  registerHostChildren(h);
  return h;
}

function Footer(props: Props): Element {
  const fp = new Props();
  fp.id = -2;
  fp.likes = props.likes; // total likes displayed
  fp.height = 48;
  const f = host('view-footer', 0, fp, [text(1, 'total ' + String(props.likes))]);
  registerHostChildren(f);
  return f;
}

function App(props: Props): Element {
  const postsHook = useState(null);
  const versionHook = useState(0);
  const posts: Post[] = postsHook.state;

  pressHandlers = [];
  const children: Element[] = [];

  const headerProps = new Props();
  headerProps.title = 'Feed v' + String(versionHook.state);
  children.push(component(Header, true, 1000000, headerProps));

  let totalLikes = 0;
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    totalLikes += post.likes;
    const p = new Props();
    p.id = post.id;
    p.title = post.author + ' · ' + String(post.ts);
    p.body = post.content;
    p.likes = post.likes;
    p.liked = post.liked;
    p.onPress = makePressHandler(postsHook, posts, i);
    pressHandlers.push(p.onPress);
    children.push(component(PostCard, true, post.id, p));
  }

  const footerProps = new Props();
  footerProps.likes = totalLikes;
  children.push(component(Footer, true, 1000001, footerProps));

  const rootProps = new Props();
  rootProps.flex = 1;
  rootProps.direction = 'column';
  const rootEl = host('view-root', 0, rootProps, children);
  registerHostChildren(rootEl);
  return rootEl;
}

// Handler identity: recreated only when the post's slice changes — mirrors
// a memoized callback keyed by (post identity, index).
const handlerCache: any = new G.Map();

function makePressHandler(postsHook: Hook, posts: Post[], index: number): any {
  const post = posts[index];
  const postId = post.id;
  const cacheKey = postId * 1048576 + post.likes * 2 + (post.liked ? 1 : 0);
  const cached: any = handlerCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const handler = function (): void {
    // functional update: read current state, locate by id (indices shift)
    const cur: Post[] = postsHook.state;
    const next: Post[] = cur.slice();
    for (let j = 0; j < next.length; j++) {
      const p = next[j];
      if (p.id === postId) {
        const np = new Post(p.id, p.author, p.ts, p.content, p.liked ? p.likes - 1 : p.likes + 1);
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
let currentRoot: Fiber | null = null;
const appRender: any = App;

function renderRoot(): number {
  hostChildrenMap.clear();
  const rootProps = new Props();
  const appEl = component(appRender, false, 0, rootProps);
  let wip: Fiber;
  if (currentRoot === null) {
    wip = createFiberFromElement(appEl);
  } else {
    wip = cloneFiber(currentRoot, appEl);
  }
  workLoop(wip);
  const effects = commit(wip);
  currentRoot = wip;
  hookNeedsFlush = false;
  return effects;
}

// ---------- driver ----------
let seed = 987654321;
function rand(n: number): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed % n;
}

function main(): void {
  const POSTS = 150;
  const WARMUP = 50;
  const TICKS = 2000;

  const initialPosts: Post[] = [];
  for (let i = 0; i < POSTS; i++) {
    initialPosts.push(
      new Post(i + 1, 'user' + String(i % 17), 1700000000 + i, 'post content ' + String(i), i % 23)
    );
  }
  let nextPostId = POSTS + 1;

  // initial mount: seed the root hook before first render
  const bootFiber = new Fiber(TAG_FC, 'fc', 0);
  hookFiber = bootFiber;
  hookCursor = null;
  const rootPostsHook = useState(initialPosts);
  const rootVersionHook = useState(0);
  hookFiber = null;
  // graft the boot hooks into the app root by pre-creating it
  const rootProps0 = new Props();
  const appEl0 = component(appRender, false, 0, rootProps0);
  const rootFiber = createFiberFromElement(appEl0);
  rootFiber.hooks = bootFiber.hooks;
  hostChildrenMap.clear();
  workLoop(rootFiber);
  commit(rootFiber);
  currentRoot = rootFiber;

  let totalEffects = 0;

  function interact(tick: number): void {
    const r = rand(100);
    if (r < 70) {
      const idx = rand(pressHandlers.length);
      const h: any = pressHandlers[idx];
      h();
    } else if (r < 90) {
      const posts: Post[] = rootPostsHook.state;
      const idx = rand(posts.length);
      const next: Post[] = posts.slice();
      const p = posts[idx];
      const np = new Post(p.id, p.author, p.ts, p.content + '!', p.likes);
      np.liked = p.liked;
      next[idx] = np;
      rootPostsHook.set(next);
    } else {
      const posts: Post[] = rootPostsHook.state;
      const next: Post[] = posts.slice();
      const np = new Post(nextPostId, 'user' + String(tick % 17), 1700000000 + tick, 'new post ' + String(tick), 0);
      nextPostId++;
      if (next.length >= 200) {
        next.pop();
      }
      next.unshift(np);
      rootPostsHook.set(next);
      rootVersionHook.set(rootVersionHook.state + 1);
    }
    totalEffects += renderRoot();
  }

  for (let w = 0; w < WARMUP; w++) {
    interact(w);
  }

  statRenders = 0;
  statBailouts = 0;
  statPlacements = 0;
  statUpdates = 0;
  statDeletions = 0;
  checksum = 0;

  const gcs0: any =
    typeof HermesInternal !== 'undefined' && HermesInternal.getInstrumentedStats
      ? HermesInternal.getInstrumentedStats()
      : null;
  const t0 = Date.now();
  for (let t = 0; t < TICKS; t++) {
    interact(t + WARMUP);
  }
  const total = Date.now() - t0;

  print('mini-react-typed: ' + String(TICKS) + ' interactions, ' + String(rootPostsHook.state.length) + ' posts');
  print('renders=' + String(statRenders) + ' bailouts=' + String(statBailouts) +
    ' placements=' + String(statPlacements) + ' updates=' + String(statUpdates) +
    ' deletions=' + String(statDeletions) + ' effects=' + String(totalEffects) +
    ' checksum=' + String(checksum));
  print('TOTAL: ' + String(total) + ' ms  (' + String(total / TICKS) + ' ms/interaction)');
  if (gcs0 !== null) {
    const gcs1: any = HermesInternal.getInstrumentedStats();
    print('GC: numGCs=' + String(gcs1.js_numGCs - gcs0.js_numGCs) +
      ' gcTime=' + String(1000 * (gcs1.js_gcTime - gcs0.js_gcTime)) + 'ms' +
      ' allocated=' + String((gcs1.js_totalAllocatedBytes - gcs0.js_totalAllocatedBytes) / 1048576) + 'MB');
  }
}

try {
  main();
} catch (e: any) {
  print('CRASH: ' + String(e.message));
  print(String(e.stack));
}
