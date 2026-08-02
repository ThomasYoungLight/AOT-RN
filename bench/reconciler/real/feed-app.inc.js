// The feed app + interaction driver — shared verbatim by the real
// react-reconciler baseline and the typed port. `RA` (React API) must provide
// createElement, useState, useCallback, memo, useReducer, useMemo, useRef,
// useEffect, useLayoutEffect, createContext, useContext.
// `flushInteraction(fn)` wraps one interaction in a sync flush;
// `flushPassive()` flushes pending passive effects (React.flushPassiveEffects
// / the port's flushPassiveEffectsImpl) — called by the driver after each
// interaction so passive timing is pinned identically on both sides.
//
// Every effect create/destroy and every useMemo recompute feeds `fx`, an
// app-level rolling checksum: equal fx on both reconcilers means effect and
// memo ORDERING is identical, not just the host-mutation stream.
// Written in the dynamic style of ordinary app code (object-literal props):
// the reconciler is what gets typed, not the app.

function installFeedApp(RA) {
  var h = RA.createElement;
  var exposed = mkObj();
  exposed.onToggle = null;
  exposed.setPosts = null;
  exposed.setVersion = null;
  exposed.setTheme = null;
  exposed.bumpHeader = null;
  var fx = mkObj();
  fx.sum = 0;
  exposed.fx = fx;
  var fxTrace = mkList();
  exposed.fxTrace = fxTrace;
  var fxTraceOn = anyVal(false);
  var gfx = anyVal(typeof globalThis !== 'undefined' ? globalThis : null);
  if (gfx !== null && gfx.__FX_TRACE !== undefined) {
    fxTraceOn = true;
  }
  function fxMix(n) {
    fx.sum = ((fx.sum * 31 + coerceInt(n)) | 0) >>> 0 | 0;
    if (fxTraceOn) {
      fxTrace.push(coerceInt(n));
    }
  }

  var ThemeContext = RA.createContext('light');

  // Synchronous thenable: resolution fires callbacks INLINE (not as a
  // microtask), so lazy/data suspensions resolve deterministically inside
  // the measured loop on both reconcilers (React accepts any thenable).
  function makeSyncThenable() {
    var t = mkObj();
    t.status = 0;
    t.value = null;
    t.callbacks = mkList();
    t.then = function (onFulfilled, onRejected) {
      if (t.status === 1) {
        onFulfilled(t.value);
      } else {
        t.callbacks.push(onFulfilled);
      }
    };
    t.resolve = function (v) {
      if (t.status === 1) {
        return;
      }
      t.status = 1;
      t.value = v;
      var cbs = t.callbacks;
      t.callbacks = mkList();
      for (var ci = 0; ci < cbs.length; ci++) {
        cbs[ci](v);
      }
    };
    return t;
  }

  // suspense data resource for the trends panel
  var trendsData = mkObj();
  trendsData.thenable = null;
  trendsData.value = null;
  function readTrendsData() {
    if (trendsData.value !== null) {
      return trendsData.value;
    }
    if (trendsData.thenable === null) {
      trendsData.thenable = makeSyncThenable();
    }
    throw trendsData.thenable;
  }
  exposed.invalidateTrendsData = function () {
    trendsData.value = null;
    trendsData.thenable = null;
  };
  exposed.resolveTrendsData = function (v) {
    trendsData.value = v;
    if (trendsData.thenable !== null) {
      trendsData.thenable.resolve(v);
    }
  };

  function TrendsBody(props) {
    var data = readTrendsData();
    fxMix(41);
    RA.useEffect(function () {
      fxMix(42);
      return function () { fxMix(43); };
    }, mkList());
    return h('view-trends', {id: -3, background: '#eef'},
      h('text-trend', {id: -3, fontSize: 12}, 'trends: ' + data + ' v' + props.version));
  }

  var trendsLoadThenable = makeSyncThenable();
  exposed.resolveTrendsModule = function () {
    var mod = mkObj();
    mod.default = TrendsBody;
    trendsLoadThenable.resolve(mod);
  };
  var LazyTrends = RA.lazy(function () {
    return trendsLoadThenable;
  });

  var FancyBanner = RA.forwardRef(function (props, ref) {
    fxMix(51);
    return h('view-banner', {id: -5, ref: ref, height: 20, label: props.label}, props.label);
  });

  function statsCompare(prev, next) {
    return prev.version === next.version; // deliberately ignores `noise`
  }
  function StatsPanel(props) {
    fxMix(61);
    return h('view-stats', {id: -6, height: 24}, 'stats v' + props.version + ' n' + props.noise);
  }
  var MemoStatsPanel = RA.memo(StatsPanel, statsCompare);

  function makePost(id, author, ts, content, likes, liked) {
    return {id: id, author: author, ts: ts, content: content, likes: likes, liked: liked};
  }

  function headerReducer(s, n) {
    return coerceInt((s * 3 + n + 1) % 997);
  }

  function Header(props) {
    var hr = RA.useReducer(headerReducer, 0);
    var bumps = hr[0];
    exposed.bumpHeader = hr[1];
    var deps1 = mkList();
    deps1.push(props.title);
    deps1.push(bumps);
    var deco = RA.useMemo(function () {
      fxMix(31);
      return props.title + ' [' + bumps + ']';
    }, deps1);
    var headerRef = RA.useRef(null);
    var deps2 = mkList();
    deps2.push(props.title);
    RA.useEffect(function () {
      fxMix(headerRef.current !== null ? 100 + coerceInt(headerRef.current.id) : -100);
      return function () { fxMix(-101); };
    }, deps2);
    return h('view-header', {id: -1, ref: headerRef, title: deco, height: 56, background: '#fafafa'}, deco);
  }
  var MemoHeader = RA.memo(Header);

  function PostCard(props) {
    var theme = RA.useContext(ThemeContext);
    var depsL = mkList();
    RA.useLayoutEffect(function () {
      fxMix(2000 + props.id);
      return function () { fxMix(-(2000 + props.id)); };
    }, depsL);
    var depsE = mkList();
    depsE.push(props.liked);
    RA.useEffect(function () {
      fxMix(3000 + props.id);
      return function () { fxMix(-(3000 + props.id)); };
    }, depsE);
    return h('view-card', {id: props.id, padding: 12, margin: 8, background: theme === 'dark' ? '#222' : '#fff', borderRadius: 12},
      h('text-title', {id: props.id, title: props.title, fontSize: 16, color: theme === 'dark' ? '#eee' : '#111'}, props.title),
      h('text-body', {id: props.id, body: props.body, fontSize: 13, color: '#333'}, props.body),
      h('button', {
        id: props.id,
        likes: props.likes,
        liked: props.liked,
        background: props.liked ? '#e33' : (theme === 'dark' ? '#444' : '#eee'),
        borderRadius: 6,
        onPress: props.onToggle,
      }, 'Like ' + props.likes)
    );
  }
  var MemoPostCard = RA.memo(PostCard);

  function Footer(props) {
    return h('view-footer', {id: -2, ref: props.hostRef, likes: props.likes, height: 48},
      'total ' + props.likes + ' e' + props.echo + ' p' + props.passiveEcho);
  }
  var MemoFooter = RA.memo(Footer);

  function App(props) {
    var st = RA.useState(props.initialPosts);
    var posts = st[0];
    var setPosts = st[1];
    var vt = RA.useState(0);
    var version = vt[0];
    var setVersion = vt[1];
    var th = RA.useState('light');
    var theme = th[0];
    var setTheme = th[1];
    var ec = RA.useState(0);
    var echo = ec[0];
    var setEcho = ec[1];
    var pc = RA.useState(0);
    var passiveEcho = pc[0];
    var setPassiveEcho = pc[1];
    var st2 = RA.useState(false);
    var showTrends = st2[0];
    var setShowTrends = st2[1];
    exposed.setPosts = setPosts;
    exposed.setVersion = setVersion;
    exposed.setTheme = setTheme;
    exposed.setShowTrends = setShowTrends;

    var onToggle = RA.useCallback(function (id) {
      setPosts(function (ps) {
        var next = ps.slice();
        for (var j = 0; j < next.length; j++) {
          if (next[j].id === id) {
            var p = next[j];
            next[j] = makePost(p.id, p.author, p.ts, p.content, p.liked ? p.likes - 1 : p.likes + 1, !p.liked);
            break;
          }
        }
        return next;
      });
    }, mkList());
    exposed.onToggle = onToggle;

    // layout effect: fires in the commit's layout phase; the conditional
    // setState exercises React's synchronous flush of layout-effect updates
    // at the end of commitRootImpl.
    var depsV = mkList();
    depsV.push(version);
    depsV.push(echo);
    RA.useLayoutEffect(function () {
      fxMix(11);
      if (version > 0 && version % 7 === 3 && echo !== version) {
        setEcho(version);
      }
      return function () { fxMix(12); };
    }, depsV);

    // passive effect: the conditional setState exercises the sync flush at
    // the end of flushPassiveEffects.
    var depsP = mkList();
    depsP.push(version);
    RA.useEffect(function () {
      fxMix(13);
      if (version > 0 && version % 5 === 2 && passiveEcho !== version) {
        setPassiveEcho(version);
      }
      return function () { fxMix(14); };
    }, depsP);

    var depsPosts = mkList();
    depsPosts.push(posts);
    RA.useEffect(function () {
      fxMix(15);
      return function () { fxMix(16); };
    }, depsPosts);

    // stable function ref on the footer host element
    var footerRef = RA.useCallback(function (inst) {
      fxMix(inst === null ? -77 : 77);
    }, mkList());

    var depsI = mkList();
    depsI.push(version);
    RA.useInsertionEffect(function () {
      fxMix(71);
      return function () { fxMix(72); };
    }, depsI);

    var bannerRef = RA.useRef(null);
    var depsB = mkList();
    RA.useEffect(function () {
      fxMix(bannerRef.current !== null ? 80 + coerceInt(bannerRef.current.id) : -80);
      return function () { fxMix(-81); };
    }, depsB);

    var children = mkList();
    children.push(h(MemoHeader, {key: 1000000, title: 'Feed v' + version}));
    var totalLikes = anyVal(0);
    for (var i = anyVal(0); i < posts.length; i++) {
      var post = posts[i];
      totalLikes += post.likes;
      children.push(h(MemoPostCard, {
        key: post.id,
        id: post.id,
        title: post.author + ' · ' + post.ts,
        body: post.content,
        likes: post.likes,
        liked: post.liked,
        onToggle: onToggle,
      }));
    }
    children.push(h(FancyBanner, {key: 1000003, label: 'Feed banner v' + version, ref: bannerRef}));
    children.push(h(MemoStatsPanel, {key: 1000004, version: version, noise: totalLikes}));
    if (showTrends) {
      children.push(h(RA.Suspense, {
        key: 1000002,
        fallback: h('view-loading', {id: -4, height: 30}, 'loading trends…'),
      }, h(LazyTrends, {version: version})));
    }
    children.push(h(MemoFooter, {
      key: 1000001,
      likes: totalLikes,
      echo: echo,
      passiveEcho: passiveEcho,
      hostRef: footerRef,
    }));
    return h('view-root', {flex: 1, direction: 'column'},
      h(ThemeContext.Provider, {value: theme}, children));
  }

  return {App: App, exposed: exposed, makePost: makePost};
}

// ---- deterministic driver ----
function runFeedDriver(app, flushInteraction, flushPassive, log) {
  var POSTS = anyVal(150);
  var WARMUP = anyVal(50);
  var TICKS = anyVal(2000);
  var gdrv = anyVal(typeof globalThis !== 'undefined' ? globalThis : null);
  if (gdrv !== null && gdrv.__FEED_TICKS !== undefined) {
    TICKS = coerceInt(gdrv.__FEED_TICKS);
  }
  if (gdrv !== null && gdrv.__FEED_WARMUP !== undefined) {
    WARMUP = coerceInt(gdrv.__FEED_WARMUP);
  }
  if (gdrv !== null && gdrv.__FEED_POSTS !== undefined) {
    POSTS = coerceInt(gdrv.__FEED_POSTS);
  }
  var exposed = app.exposed;
  var makePost = app.makePost;

  var seed = anyVal(987654321);
  function rand(n) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  }

  // driver-side mirror of post ids (drives which post gets poked)
  var ids = mkList();
  var initialPosts = mkList();
  for (var i = anyVal(0); i < POSTS; i++) {
    initialPosts.push(makePost(i + 1, 'user' + (i % 17), 1700000000 + i, 'post content ' + i, i % 23, false));
    ids.push(i + 1);
  }
  var nextPostId = anyVal(POSTS + 1);

  function interact(tick) {
    // deterministic Suspense lifecycle (in the measured window; WARMUP=50):
    if (tick === 60) {
      // mount-suspend: lazy module pending -> fallback; resolve module ->
      // retry -> data pending -> fallback; resolve data -> content
      flushInteraction(function () {
        exposed.setShowTrends(function () { return true; });
      });
      if (flushPassive !== null && flushPassive !== undefined) { flushPassive(); }
      exposed.resolveTrendsModule();
      flushInteraction(function () {}); // flush the scheduled retry
      if (flushPassive !== null && flushPassive !== undefined) { flushPassive(); }
      exposed.resolveTrendsData('hot-items-1');
      flushInteraction(function () {});
      if (flushPassive !== null && flushPassive !== undefined) { flushPassive(); }
      return;
    }
    if (tick === 90 || tick === 800) {
      // update-suspend: committed primary gets HIDDEN (legacy semantics),
      // fallback shows; resolve -> retry -> unhide
      exposed.invalidateTrendsData();
      flushInteraction(function () {
        exposed.setVersion(function (v) { return v + 1; });
      });
      if (flushPassive !== null && flushPassive !== undefined) { flushPassive(); }
      exposed.resolveTrendsData(tick === 90 ? 'hot-items-2' : 'hot-items-3');
      flushInteraction(function () {}); // flush the scheduled retry
      if (flushPassive !== null && flushPassive !== undefined) { flushPassive(); }
      return;
    }
    if (tick === 1500) {
      // unmount the whole suspense subtree (deletion effects incl. passive)
      flushInteraction(function () {
        exposed.setShowTrends(function () { return false; });
      });
      if (flushPassive !== null && flushPassive !== undefined) { flushPassive(); }
      return;
    }
    var r = rand(100);
    if (r < 60) {
      var id = ids[rand(ids.length)];
      flushInteraction(function () {
        exposed.onToggle(id);
      });
    } else if (r < 78) {
      var editId = ids[rand(ids.length)];
      flushInteraction(function () {
        exposed.setPosts(function (ps) {
          var next = ps.slice();
          for (var j = 0; j < next.length; j++) {
            if (next[j].id === editId) {
              var p = next[j];
              next[j] = makePost(p.id, p.author, p.ts, p.content + '!', p.likes, p.liked);
              break;
            }
          }
          return next;
        });
      });
    } else if (r < 88) {
      var newId = nextPostId++;
      var author = 'user' + (tick % 17);
      var ts = 1700000000 + tick;
      var content = 'new post ' + tick;
      if (ids.length >= 200) {
        ids.pop();
      }
      ids.unshift(newId);
      flushInteraction(function () {
        exposed.setPosts(function (ps) {
          var next = ps.slice();
          var np = makePost(newId, author, ts, content, 0, false);
          if (next.length >= 200) {
            next.pop();
          }
          next.unshift(np);
          return next;
        });
        exposed.setVersion(function (v) {
          return v + 1;
        });
      });
    } else if (r < 94) {
      flushInteraction(function () {
        exposed.setTheme(function (t) {
          return t === 'light' ? 'dark' : 'light';
        });
      });
    } else {
      var n = tick % 5;
      flushInteraction(function () {
        exposed.bumpHeader(n);
      });
    }
    if (flushPassive !== null && flushPassive !== undefined) {
      flushPassive();
    }
  }

  return {
    initialPosts: initialPosts,
    warmup: function () {
      for (var w = anyVal(0); w < WARMUP; w++) {
        interact(w);
      }
    },
    run: function () {
      exposed.fx.sum = 0;
      var t0 = anyVal(Date.now());
      for (var t = anyVal(0); t < TICKS; t++) {
        interact(t + WARMUP);
      }
      var out = mkObj();
      out.ms = Date.now() - t0;
      out.ticks = TICKS;
      out.posts = ids.length;
      out.fx = exposed.fx.sum;
      out.trace = exposed.fxTrace;
      return out;
    },
  };
}
