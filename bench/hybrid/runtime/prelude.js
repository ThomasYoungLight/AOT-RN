(function (global) {
  'use strict';
  // Mini Metro runtime with hash-keyed native dispatch.
  // __d(factory, id, hash): if the app binary registered a native factory for
  // this module id AND its content hash matches the hash embedded in the
  // bundle, bind the native factory; otherwise use the bundle's JS factory.
  var modules = {};
  var native = global.__nativeModules || {};

  global.__d = function (factory, id, hash) {
    var n = native[id];
    var useNative = !!(n && n.hash === hash);
    modules[id] = {
      factory: useNative ? n.factory : factory,
      native: useNative,
      hash: hash,
      exports: null,
      initialized: false
    };
  };

  global.__r = function (id) {
    var m = modules[id];
    if (!m) throw new Error('module not found: ' + id);
    if (!m.initialized) {
      m.initialized = true;
      var mod = { exports: {} };
      m.factory(global, global.__r, mod, mod.exports);
      m.exports = mod.exports;
    }
    return m.exports;
  };

  global.__describeBindings = function () {
    var out = [];
    for (var id in modules) {
      var m = modules[id];
      var n = native[id];
      var why;
      if (m.native) {
        why = 'NATIVE       (hash ' + m.hash.slice(0, 10) + ' matched)';
      } else if (n) {
        why = 'INTERPRETED  (bundle hash ' + m.hash.slice(0, 10) +
          ' != native hash ' + n.hash.slice(0, 10) + ' -> OTA-changed, shadowed)';
      } else {
        why = 'INTERPRETED  (no native build for this module)';
      }
      out.push('  ' + id + ': ' + why);
    }
    return out.join('\n');
  };
})(globalThis);
