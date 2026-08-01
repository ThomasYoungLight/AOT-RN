'use strict';
// Ring 1: product module compiled as-is (untyped) into an SHUnit. The factory
// source below is textually identical to what the bundle carries; the hash is
// computed from that source by the build script.
(function () {
  var g = globalThis;
  var manifest = g.__nativeModules || (g.__nativeModules = {});
  manifest['util'] = {
    hash: '__UTIL_HASH__',
    factory: __UTIL_FACTORY__
  };
})();
