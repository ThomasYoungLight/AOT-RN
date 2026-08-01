// Shared workload for the diffProperties differential: ViewConfig-shaped
// validAttributes (nested style config, custom process/diff attributes) and a
// seeded prev/next prop-pair generator exercising identity-equal styles,
// changed leaves, style-array growth/shrink, and removed keys.

function dpProcessColor(c) {
  if (typeof c !== 'string') {
    return c;
  }
  var h = 0;
  var n = coerceInt(c.length);
  for (var i = 0; i < n; i++) {
    h = (h * 31 + coerceInt(c.charCodeAt(i))) | 0;
  }
  return h;
}

function dpTransformDiff(a, b) {
  if (a === b) {
    return false;
  }
  if (!a || !b || a.length !== b.length) {
    return true;
  }
  for (var i = 0; i < a.length; i++) {
    var ka = a[i];
    var kb = b[i];
    if (ka.translateX !== kb.translateX || ka.scale !== kb.scale) {
      return true;
    }
  }
  return false;
}

function dpMakeValidAttributes() {
  var styleConfig = mkObj();
  styleConfig.opacity = true;
  styleConfig.width = true;
  styleConfig.height = true;
  styleConfig.margin = true;
  styleConfig.padding = true;
  styleConfig.flex = true;
  styleConfig.flexDirection = true;
  styleConfig.borderRadius = true;
  var bg = mkObj();
  bg.process = dpProcessColor;
  styleConfig.backgroundColor = bg;
  var tf = mkObj();
  tf.diff = dpTransformDiff;
  styleConfig.transform = tf;

  var va = mkObj();
  va.opacity = true;
  va.testID = true;
  va.accessible = true;
  va.onLayout = true;
  va.onPress = true;
  var bg2 = mkObj();
  bg2.process = dpProcessColor;
  va.backgroundColor = bg2;
  var tf2 = mkObj();
  tf2.diff = dpTransformDiff;
  va.transform = tf2;
  va.style = styleConfig;
  return va;
}

// deterministic deep hash of an update payload
function dpHashDeep(v, acc) {
  if (v === null) {
    return (acc * 31 + 3) | 0;
  }
  if (v === undefined) {
    return (acc * 31 + 5) | 0;
  }
  var t = typeof v;
  if (t === 'number') {
    return (acc * 31 + coerceInt(v)) | 0;
  }
  if (t === 'boolean') {
    return (acc * 31 + (v ? 7 : 11)) | 0;
  }
  if (t === 'string') {
    var h = acc;
    var n = coerceInt(v.length);
    for (var i = 0; i < n; i++) {
      h = (h * 33 + coerceInt(v.charCodeAt(i))) | 0;
    }
    return h;
  }
  if (t === 'function') {
    return (acc * 31 + 13) | 0;
  }
  var h2 = (acc * 31 + 17) | 0;
  if (v.length !== undefined && typeof v.length === 'number') {
    for (var j = 0; j < v.length; j++) {
      h2 = dpHashDeep(v[j], h2);
    }
    return h2;
  }
  for (var k in v) {
    var n2 = coerceInt(k.length);
    for (var m = 0; m < n2; m++) {
      h2 = (h2 * 33 + coerceInt(k.charCodeAt(m))) | 0;
    }
    h2 = dpHashDeep(v[k], h2);
  }
  return h2;
}

// seeded pair generator
function dpMakePairs(count) {
  var seed = 424242;
  function rnd(n) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  }
  var onPressA = function () {};
  var onPressB = function () {};
  var baseStyle = mkObj();
  baseStyle.flex = 1;
  baseStyle.flexDirection = 'column';
  baseStyle.padding = 8;

  function makeTransform(x, s) {
    var t1 = mkObj();
    t1.translateX = x;
    var t2 = mkObj();
    t2.scale = s;
    var arr = mkList();
    arr.push(t1);
    arr.push(t2);
    return arr;
  }

  function makeProps(id, variant) {
    var p = mkObj();
    p.opacity = variant === 2 ? 0.5 : 1;
    p.testID = 'card-' + String(id);
    p.accessible = true;
    p.onLayout = onPressA;
    p.onPress = variant === 3 ? onPressB : onPressA;
    p.notNative = 'ignored-' + String(variant);
    var dyn = mkObj();
    dyn.opacity = variant === 2 ? 0.8 : 1;
    dyn.width = variant === 1 ? 100 + (id % 40) : 100;
    dyn.transform = makeTransform(variant === 1 ? id % 10 : 0, 1);
    if (variant !== 4) {
      dyn.backgroundColor = variant === 2 ? '#e33' : '#fff';
    }
    var styleArr = mkList();
    styleArr.push(baseStyle);
    styleArr.push(dyn);
    if (variant === 5) {
      var extra = mkObj();
      extra.margin = 4;
      extra.borderRadius = 12;
      styleArr.push(extra);
    }
    p.style = styleArr;
    return p;
  }

  var pairs = mkList();
  for (var i = 0; i < count; i++) {
    var r = rnd(100);
    var prevVariant = 0;
    var nextVariant;
    if (r < 35) {
      nextVariant = 0; // unchanged
    } else if (r < 55) {
      nextVariant = 1; // layout/transform change
    } else if (r < 75) {
      nextVariant = 2; // opacity/color change
    } else if (r < 85) {
      nextVariant = 3; // handler identity change
    } else if (r < 93) {
      nextVariant = 4; // key removal (backgroundColor dropped)
    } else {
      nextVariant = 5; // style array grows
    }
    var pair = mkObj();
    pair.prev = makeProps(i, prevVariant);
    pair.next = nextVariant === 0 ? pair.prev : makeProps(i, nextVariant);
    pairs.push(pair);
  }
  return pairs;
}

function dpRunWorkload(diffFn, label, log) {
  var PAIRS = 200;
  var ITER = 500;
  var va = dpMakeValidAttributes();
  var pairs = dpMakePairs(PAIRS);

  // warmup + checksum
  var checksum = 0;
  var nonNull = 0;
  for (var i = 0; i < pairs.length; i++) {
    var payload = diffFn(pairs[i].prev, pairs[i].next, va);
    if (payload !== null) {
      nonNull++;
      checksum = dpHashDeep(payload, checksum);
    } else {
      checksum = (checksum * 31 + 23) | 0;
    }
  }

  var t0 = anyVal(Date.now());
  for (var it = 0; it < ITER; it++) {
    for (var j = 0; j < pairs.length; j++) {
      diffFn(pairs[j].prev, pairs[j].next, va);
    }
  }
  var ms = Date.now() - t0;
  var total = PAIRS * ITER;
  log(label + ': ' + String(total) + ' diffs, nonNull=' + String(nonNull) +
    ' checksum=' + String(checksum >>> 0));
  log('TOTAL: ' + String(ms) + ' ms  (' + String((ms * 1000) / total) + ' us/diff)');
}
