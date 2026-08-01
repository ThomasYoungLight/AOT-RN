function (global, require, module, exports) {
  'use strict';
  function add(a, b) {
    return a + b;
  }
  function mulAdd(a, b, c) {
    return a * b + c;
  }
  function tag() {
    return 'util-v1';
  }
  function checksum(n) {
    var acc = 0;
    for (var i = 0; i < n; i++) {
      acc = (acc + ((i * 2654435761) % 97)) | 0;
    }
    return acc;
  }
  module.exports = { add: add, mulAdd: mulAdd, tag: tag, checksum: checksum };
}
