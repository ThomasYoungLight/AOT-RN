// The feed app + interaction driver — shared verbatim by the real
// react-reconciler baseline and the typed port. `RA` (React API) must provide
// createElement, useState, useCallback, memo. `flushInteraction(fn)` wraps one
// interaction in a sync flush. Written in the dynamic style of ordinary app
// code (object-literal props): the reconciler is what gets typed, not the app.

function installFeedApp(RA) {
  var h = RA.createElement;
  var exposed = mkObj();
  exposed.onToggle = null;
  exposed.setPosts = null;
  exposed.setVersion = null;

  function makePost(id, author, ts, content, likes, liked) {
    return {id: id, author: author, ts: ts, content: content, likes: likes, liked: liked};
  }

  function Header(props) {
    return h('view-header', {id: -1, title: props.title, height: 56, background: '#fafafa'}, props.title);
  }
  var MemoHeader = RA.memo(Header);

  function PostCard(props) {
    return h('view-card', {id: props.id, padding: 12, margin: 8, background: '#fff', borderRadius: 12},
      h('text-title', {id: props.id, title: props.title, fontSize: 16, color: '#111'}, props.title),
      h('text-body', {id: props.id, body: props.body, fontSize: 13, color: '#333'}, props.body),
      h('button', {
        id: props.id,
        likes: props.likes,
        liked: props.liked,
        background: props.liked ? '#e33' : '#eee',
        borderRadius: 6,
        onPress: props.onToggle,
      }, 'Like ' + props.likes)
    );
  }
  var MemoPostCard = RA.memo(PostCard);

  function Footer(props) {
    return h('view-footer', {id: -2, likes: props.likes, height: 48}, 'total ' + props.likes);
  }
  var MemoFooter = RA.memo(Footer);

  function App(props) {
    var st = RA.useState(props.initialPosts);
    var posts = st[0];
    var setPosts = st[1];
    var vt = RA.useState(0);
    var version = vt[0];
    var setVersion = vt[1];
    exposed.setPosts = setPosts;
    exposed.setVersion = setVersion;

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
    children.push(h(MemoFooter, {key: 1000001, likes: totalLikes}));
    return h('view-root', {flex: 1, direction: 'column'}, children);
  }

  return {App: App, exposed: exposed, makePost: makePost};
}

// ---- deterministic driver ----
function runFeedDriver(app, flushInteraction, log) {
  var POSTS = anyVal(150);
  var WARMUP = anyVal(50);
  var TICKS = anyVal(2000);
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
    var r = rand(100);
    if (r < 70) {
      var id = ids[rand(ids.length)];
      flushInteraction(function () {
        exposed.onToggle(id);
      });
    } else if (r < 90) {
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
    } else {
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
      var t0 = anyVal(Date.now());
      for (var t = anyVal(0); t < TICKS; t++) {
        interact(t + WARMUP);
      }
      return {ms: Date.now() - t0, ticks: TICKS, posts: ids.length};
    },
  };
}
