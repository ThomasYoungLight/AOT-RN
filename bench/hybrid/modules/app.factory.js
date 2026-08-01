function (global, require, module, exports) {
  'use strict';
  var log = typeof print !== 'undefined' ? print : console.log;

  log('=== hybrid AOT/OTA prototype ===');
  log(global.__describeBindings());
  log('');

  var util = require('util');
  var core = require('core');

  // --- correctness: prove which implementation is actually executing ---
  log('util.tag()          = ' + util.tag());
  log('util.checksum(1e6)  = ' + util.checksum(1000000));
  log('core.impl           = ' + core.impl);
  log('');

  // --- boundary cost: 5M tiny cross-module calls into util.add ---
  var acc = 0;
  var t0 = Date.now();
  for (var i = 0; i < 5000000; i++) {
    acc = (acc + util.add(i, 3)) | 0;
  }
  var t1 = Date.now();
  log('5M cross-module util.add calls: ' + (t1 - t0) + ' ms  (' +
    ((t1 - t0) / 5).toFixed(1) + ' ns/call, acc=' + acc + ')');

  // --- ring 0 workload: reconciler, 300 commits ---
  var t2 = Date.now();
  var effects = core.runCommits(300, 30);
  var t3 = Date.now();
  log('core.runCommits(300 commits): effects=' + effects + '  ' +
    (t3 - t2) + ' ms  (' + ((t3 - t2) / 300).toFixed(3) + ' ms/commit)');

  module.exports = {};
}
