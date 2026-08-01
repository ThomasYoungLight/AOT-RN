'use strict';
// bench2 (typed variant for `shermes -typed`): same feed-app workload as
// bench2-dynamic.js — component functions, element cache/bailouts, keyed
// reconciliation, dirty-subtree commit — with static shapes throughout.

// ---- deterministic PRNG ----
let _seed = 987654321;
function rand(): number {
  _seed = (_seed * 1103515245 + 12345) % 2147483648;
  return _seed;
}

// ---- elements ----
class Props {
  src: string | null;
  size: number;
  content: string | null;
  fontSize: number;
  color: string | null;
  label: string | null;
  count: number;
  active: boolean;
  padding: number;
  margin: number;
  flex: number;
  height: number;
  background: string | null;
  borderRadius: number;

  constructor() {
    this.src = null;
    this.size = 0;
    this.content = null;
    this.fontSize = 0;
    this.color = null;
    this.label = null;
    this.count = 0;
    this.active = false;
    this.padding = 0;
    this.margin = 0;
    this.flex = 0;
    this.height = 0;
    this.background = null;
    this.borderRadius = 0;
  }
}

class Element {
  type: string;
  key: number;
  props: Props;
  children: Element[] | null;

  constructor(type: string, key: number, props: Props, children: Element[] | null) {
    this.type = type;
    this.key = key;
    this.props = props;
    this.children = children;
  }
}

// ---- app state (parallel arrays, same as dynamic variant) ----
const MAX_POSTS = 150;
const postIds: number[] = [];
const postAuthors: string[] = [];
const postTs: string[] = [];
const postContents: string[] = [];
const postLikes: number[] = [];
const postLiked: boolean[] = [];
const postShowComments: boolean[] = [];
const postVersions: number[] = [];
let nextPostId = 0;
let unreadCount = 3;
let activeTab = 0;

function makePost(): void {
  const id = nextPostId;
  nextPostId = nextPostId + 1;
  postIds.push(id);
  postAuthors.push('user_' + String(id % 37));
  postTs.push('2h ago');
  postContents.push('This is post number ' + String(id) + ' with some feed content to render.');
  postLikes.push(id % 50);
  postLiked.push(false);
  postShowComments.push(false);
  postVersions.push(0);
}

function prependPost(): void {
  const id = nextPostId;
  nextPostId = nextPostId + 1;
  if (postIds.length >= MAX_POSTS) {
    postIds.pop(); postAuthors.pop(); postTs.pop(); postContents.pop();
    postLikes.pop(); postLiked.pop(); postShowComments.pop(); postVersions.pop();
  }
  postIds.push(0); postAuthors.push(''); postTs.push(''); postContents.push('');
  postLikes.push(0); postLiked.push(false); postShowComments.push(false); postVersions.push(0);
  for (let i = postIds.length - 1; i > 0; i--) {
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
  postAuthors[0] = 'user_' + String(id % 37);
  postTs[0] = 'now';
  postContents[0] = 'Fresh post ' + String(id) + ' just arrived in the feed.';
  postLikes[0] = 0;
  postLiked[0] = false;
  postShowComments[0] = false;
  postVersions[0] = 0;
}

// ---- element cache ----
const cacheIds: number[] = [];
const cacheVersions: number[] = [];
const cacheElements: Element[] = [];

function lookupCache(id: number, version: number): Element | null {
  for (let i = 0; i < cacheIds.length; i++) {
    if (cacheIds[i] === id) {
      if (cacheVersions[i] === version) return cacheElements[i];
      return null;
    }
  }
  return null;
}

function storeCache(id: number, version: number, el: Element): void {
  for (let i = 0; i < cacheIds.length; i++) {
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
function renderAvatar(author: string): Element {
  const p = new Props();
  p.src = 'https://cdn.example.com/' + author + '.png';
  p.size = 40;
  return new Element('image', 0, p, null);
}

function textEl(key: number, content: string, fontSize: number, color: string): Element {
  const p = new Props();
  p.content = content;
  p.fontSize = fontSize;
  p.color = color;
  return new Element('text', key, p, null);
}

function buttonEl(key: number, label: string, count: number, active: boolean): Element {
  const p = new Props();
  p.label = label;
  p.count = count;
  p.active = active;
  return new Element('button', key, p, null);
}

function renderPostCard(index: number): Element {
  const id = postIds[index];
  const version = postVersions[index];
  const cached = lookupCache(id, version);
  if (cached !== null) return cached;

  const rowP = new Props();
  rowP.padding = 8;
  const colP = new Props();
  colP.flex = 1;
  const headerRow = new Element('row', 0, rowP, [
    renderAvatar(postAuthors[index]),
    new Element('column', 1, colP, [
      textEl(0, postAuthors[index], 14, '#111'),
      textEl(1, postTs[index], 11, '#888')
    ])
  ]);
  const body = textEl(1, postContents[index], 13, '#222');
  const likeLabel = postLiked[index] ? 'Liked' : 'Like';
  const actionsP = new Props();
  actionsP.padding = 4;
  const actions = new Element('row', 2, actionsP, [
    buttonEl(0, likeLabel, postLikes[index], postLiked[index]),
    buttonEl(1, 'Comment', 2, false),
    buttonEl(2, 'Share', 0, false)
  ]);
  const children: Element[] = [headerRow, body, actions];
  if (postShowComments[index]) {
    const comP = new Props();
    comP.padding = 12;
    comP.background = '#f7f7f7';
    children.push(new Element('column', 3, comP, [
      textEl(0, 'Great point about post ' + String(id) + '!', 12, '#333'),
      textEl(1, 'I disagree with post ' + String(id) + ' entirely.', 12, '#333')
    ]));
  }
  const cardP = new Props();
  cardP.margin = 6;
  cardP.background = '#fff';
  cardP.borderRadius = 8;
  const card = new Element('card', id, cardP, children);
  storeCache(id, version, card);
  return card;
}

function renderHeader(): Element {
  const hp = new Props();
  hp.height = 56;
  hp.background = '#4a76d0';
  const titleP = new Props();
  titleP.content = 'FeedApp';
  titleP.fontSize = 20;
  titleP.color = '#fff';
  const badgeP = new Props();
  badgeP.count = unreadCount;
  badgeP.color = '#e33';
  return new Element('row', 0, hp, [
    new Element('text', 0, titleP, null),
    new Element('badge', 1, badgeP, null),
    buttonEl(2, 'Search', 0, false),
    buttonEl(3, 'Inbox', unreadCount, false)
  ]);
}

function renderFooter(): Element {
  const tabs: Element[] = [];
  for (let i = 0; i < 5; i++) {
    tabs.push(buttonEl(i, 'Tab' + String(i), 0, i === activeTab));
  }
  const fp = new Props();
  fp.height = 48;
  fp.background = '#eee';
  return new Element('row', 2, fp, tabs);
}

function renderApp(): Element {
  const cards: Element[] = [];
  for (let i = 0; i < postIds.length; i++) {
    cards.push(renderPostCard(i));
  }
  const rootP = new Props();
  rootP.flex = 1;
  const scrollP = new Props();
  scrollP.flex = 1;
  return new Element('root', 0, rootP, [
    renderHeader(),
    new Element('scroll', 1, scrollP, cards),
    renderFooter()
  ]);
}

// ---- fibers ----
class Fiber {
  type: string;
  key: number;
  props: Props | null;
  element: Element | null;
  child: Fiber | null;
  sibling: Fiber | null;
  parent: Fiber | null;
  alternate: Fiber | null;
  flags: number;
  subtreeFlags: number;

  constructor(type: string, key: number) {
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
}

let statClones = 0;
let statBailouts = 0;
let statEffects = 0;

function diffProps(oldProps: Props, newProps: Props): number {
  let changed = 0;
  if (oldProps.src !== newProps.src) changed++;
  if (oldProps.size !== newProps.size) changed++;
  if (oldProps.content !== newProps.content) changed++;
  if (oldProps.fontSize !== newProps.fontSize) changed++;
  if (oldProps.color !== newProps.color) changed++;
  if (oldProps.label !== newProps.label) changed++;
  if (oldProps.count !== newProps.count) changed++;
  if (oldProps.active !== newProps.active) changed++;
  if (oldProps.padding !== newProps.padding) changed++;
  if (oldProps.margin !== newProps.margin) changed++;
  if (oldProps.flex !== newProps.flex) changed++;
  if (oldProps.height !== newProps.height) changed++;
  if (oldProps.background !== newProps.background) changed++;
  if (oldProps.borderRadius !== newProps.borderRadius) changed++;
  return changed;
}

function reconcile(current: Fiber | null, element: Element, parent: Fiber | null): Fiber {
  if (current !== null && current.element === element) {
    statBailouts++;
    current.parent = parent;
    current.flags = 0;
    current.subtreeFlags = 0;
    return current;
  }
  const wip = new Fiber(element.type, element.key);
  wip.element = element;
  statClones++;
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
    const oldFirstChild: Fiber | null =
      current !== null && current.type === element.type ? current.child : null;
    let prevSibling: Fiber | null = null;
    let oldChild: Fiber | null = oldFirstChild;
    let subtree = 0;
    for (let i = 0; i < elChildren.length; i++) {
      const el = elChildren[i];
      let match: Fiber | null = null;
      if (oldChild !== null && oldChild.key === el.key && oldChild.type === el.type) {
        match = oldChild;
        oldChild = oldChild.sibling;
      } else {
        let scan: Fiber | null = oldFirstChild;
        while (scan !== null) {
          if (scan.key === el.key && scan.type === el.type) {
            match = scan;
            break;
          }
          scan = scan.sibling;
        }
      }
      const childFiber = reconcile(match, el, wip);
      subtree = subtree | childFiber.flags | childFiber.subtreeFlags;
      if (i === 0) {
        wip.child = childFiber;
      } else if (prevSibling !== null) {
        prevSibling.sibling = childFiber;
      }
      childFiber.sibling = null;
      prevSibling = childFiber;
    }
    wip.subtreeFlags = subtree;
  }
  return wip;
}

// ---- commit ----
function commit(root: Fiber): void {
  let node: Fiber | null = root;
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
function applyInteraction(): void {
  const r = rand() % 100;
  if (r < 70) {
    const i = rand() % postIds.length;
    postLiked[i] = !postLiked[i];
    postLikes[i] = postLikes[i] + (postLiked[i] ? 1 : -1);
    postVersions[i] = postVersions[i] + 1;
  } else if (r < 90) {
    const j = rand() % postIds.length;
    postShowComments[j] = !postShowComments[j];
    postVersions[j] = postVersions[j] + 1;
  } else {
    prependPost();
    unreadCount = unreadCount + 1;
  }
}

// ---- GC stats ----
function gcStats(): any {
  if (typeof HermesInternal !== 'undefined' && HermesInternal.getInstrumentedStats) {
    return HermesInternal.getInstrumentedStats();
  }
  return null;
}

// ---- main ----
function main(): void {
  const WARMUP = 50;
  const TICKS = 2000;

  for (let p = 0; p < MAX_POSTS; p++) makePost();

  let current: Fiber = reconcile(null, renderApp(), null);
  commit(current);
  for (let w = 0; w < WARMUP; w++) {
    applyInteraction();
    const wWip = reconcile(current, renderApp(), null);
    commit(wWip);
    current = wWip;
  }

  statClones = 0;
  statBailouts = 0;
  statEffects = 0;
  const s0: any = gcStats();
  let renderTime = 0,
    reconcileTime = 0,
    commitTime = 0;
  const tStart = Date.now();
  for (let tick = 0; tick < TICKS; tick++) {
    applyInteraction();
    const t0 = Date.now();
    const tree = renderApp();
    const t1 = Date.now();
    const wip = reconcile(current, tree, null);
    const t2 = Date.now();
    commit(wip);
    const t3 = Date.now();
    renderTime += t1 - t0;
    reconcileTime += t2 - t1;
    commitTime += t3 - t2;
    current = wip;
  }
  const total = Date.now() - tStart;
  const s1: any = gcStats();

  print('bench2-typed: ' + String(TICKS) + ' interactions, ' + String(postIds.length) + ' posts');
  print('clones=' + String(statClones) + ' bailouts=' + String(statBailouts) + ' effects=' + String(statEffects));
  print('render(components): ' + String(renderTime) + ' ms');
  print('reconcile(keyed):   ' + String(reconcileTime) + ' ms');
  print('commit(dirty-walk): ' + String(commitTime) + ' ms');
  print('TOTAL:              ' + String(total) + ' ms  (' + String(total / TICKS) + ' ms/interaction)');
  if (s0 !== null && s1 !== null) {
    print('GC: numGCs=' + String(s1.js_numGCs - s0.js_numGCs) +
      ' gcTime=' + String(1000 * (s1.js_gcTime - s0.js_gcTime)) + 'ms' +
      ' gcCPU=' + String(1000 * (s1.js_gcCPUTime - s0.js_gcCPUTime)) + 'ms');
    print('GC: allocated=' + String((s1.js_totalAllocatedBytes - s0.js_totalAllocatedBytes) / 1048576) + 'MB' +
      ' heapSize=' + String(s1.js_heapSize / 1048576) + 'MB');
  } else {
    print('GC: HermesInternal.getInstrumentedStats not available');
  }
}

main();
