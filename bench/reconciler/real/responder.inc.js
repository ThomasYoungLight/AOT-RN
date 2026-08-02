// Gesture responder system for the direct-Fabric takeover path — a scoped
// port of RN's ResponderEventPlugin semantics over the live fiber tree:
// capture/bubble negotiation (onStartShouldSetResponder(Capture),
// onMoveShouldSetResponder(Capture)), responder transfer with
// onResponderTerminationRequest / onResponderTerminate / onResponderReject,
// and onResponderStart/Move/End/Release delivery to the active responder.
//
// Handlers are read from fiber.memoizedProps: instanceHandles are the fibers
// passed to createNode, which persist across clones (the C++ event emitter
// keeps the original handle), so handler-bearing fibers may be one commit
// generation stale — handlers must therefore be referentially stable
// (useCallback), exactly like touch handlers under ReactFabric.
//
// Each native touch event is dispatched inside one flushInteraction (sync
// batch), matching RN's discrete-event batching. Single-gesture semantics:
// the primary touch sequence drives negotiation (multi-touch responder
// hand-off is out of scope).

function createResponderSystem(flushInteraction, log) {
  var sys = mkObj();
  sys.responder = null;
  sys.startPageX = 0;
  sys.startPageY = 0;

  function fiberParent(f) {
    if (f === null || f === undefined) {
      return null;
    }
    // the typed port names the return pointer `ret`; the real reconciler
    // names it `return`
    if (f.ret !== undefined && f.ret !== null) {
      return f.ret;
    }
    var viaReturn = f['return'];
    if (viaReturn !== undefined && viaReturn !== null) {
      return viaReturn;
    }
    return null;
  }

  function handlerOf(fiber, name) {
    var p = fiber.memoizedProps;
    if (p !== null && p !== undefined && typeof p[name] === 'function') {
      return p[name];
    }
    return null;
  }

  function eventPoint(nativeEvent) {
    var t = nativeEvent;
    if (nativeEvent !== null && nativeEvent !== undefined &&
        nativeEvent.changedTouches !== null && nativeEvent.changedTouches !== undefined &&
        nativeEvent.changedTouches.length > 0) {
      t = nativeEvent.changedTouches[0];
    }
    var pt = mkObj();
    pt.pageX = t !== null && t !== undefined && t.pageX !== undefined ? t.pageX : 0;
    pt.pageY = t !== null && t !== undefined && t.pageY !== undefined ? t.pageY : 0;
    return pt;
  }

  function makeEvent(type, targetFiber, nativeEvent) {
    var pt = eventPoint(nativeEvent);
    var e = mkObj();
    e.type = type;
    e.target = targetFiber;
    e.nativeEvent = nativeEvent;
    e.pageX = pt.pageX;
    e.pageY = pt.pageY;
    e.gestureDX = pt.pageX - sys.startPageX;
    e.gestureDY = pt.pageY - sys.startPageY;
    return e;
  }

  function pathOf(target) {
    var path = mkList(); // deepest first
    var f = target;
    var guard = 0;
    while (f !== null && guard < 200) {
      if (f.memoizedProps !== null && f.memoizedProps !== undefined) {
        path.push(f);
      }
      f = fiberParent(f);
      guard++;
    }
    return path;
  }

  // ResponderEventPlugin: with no responder, the two-phase shouldSet
  // negotiation runs over the touch target's path. Once a responder exists,
  // it runs over the RESPONDER'S ANCESTORS (accumulateTwoPhaseDispatches
  // SkipTarget from the responder) — this is how a scroll container steals
  // an in-flight gesture from a pressed child.
  function findWantingResponder(phase, target, ev) {
    var path;
    if (sys.responder === null) {
      path = pathOf(target);
    } else {
      var parent = fiberParent(sys.responder);
      path = parent !== null ? pathOf(parent) : mkList();
    }
    if (path.length === 0) {
      return null;
    }
    var captureName = phase === 'start' ? 'onStartShouldSetResponderCapture' : 'onMoveShouldSetResponderCapture';
    var bubbleName = phase === 'start' ? 'onStartShouldSetResponder' : 'onMoveShouldSetResponder';
    // capture phase: shallowest -> deepest
    for (var i = path.length - 1; i >= 0; i--) {
      var hC = handlerOf(path[i], captureName);
      if (hC !== null && hC(ev) === true) {
        return path[i];
      }
    }
    // bubble phase: deepest -> shallowest
    for (var j = 0; j < path.length; j++) {
      var hB = handlerOf(path[j], bubbleName);
      if (hB !== null && hB(ev) === true) {
        return path[j];
      }
    }
    return null;
  }

  function callResponder(name, ev) {
    if (sys.responder === null) {
      return;
    }
    var fn = handlerOf(sys.responder, name);
    if (fn !== null) {
      fn(ev);
    }
  }

  function grantTo(fiber, ev) {
    sys.responder = fiber;
    var fn = handlerOf(fiber, 'onResponderGrant');
    if (fn !== null) {
      fn(ev);
    }
  }

  function negotiate(phase, target, ev) {
    var wanting = findWantingResponder(phase, target, ev);
    if (wanting === null || wanting === sys.responder) {
      return;
    }
    if (sys.responder === null) {
      grantTo(wanting, ev);
      return;
    }
    // transfer request: RN's default is to ALLOW the transfer
    var reqFn = handlerOf(sys.responder, 'onResponderTerminationRequest');
    var allow = true;
    if (reqFn !== null) {
      allow = reqFn(ev) !== false;
    }
    if (allow) {
      var termFn = handlerOf(sys.responder, 'onResponderTerminate');
      if (termFn !== null) {
        termFn(ev);
      }
      grantTo(wanting, ev);
    } else {
      var rejFn = handlerOf(wanting, 'onResponderReject');
      if (rejFn !== null) {
        rejFn(ev);
      }
    }
  }

  sys.handleEvent = function (target, eventType, nativeEvent) {
    flushInteraction(function () {
      if (eventType === 'topTouchStart') {
        var pt = eventPoint(nativeEvent);
        if (sys.responder === null) {
          // fresh gesture: reset the origin used for gestureDX/DY
          sys.startPageX = pt.pageX;
          sys.startPageY = pt.pageY;
        }
        var evS = makeEvent('touchStart', target, nativeEvent);
        negotiate('start', target, evS);
        callResponder('onResponderStart', evS);
        return;
      }
      if (eventType === 'topTouchMove') {
        var evM = makeEvent('touchMove', target, nativeEvent);
        negotiate('move', target, evM);
        callResponder('onResponderMove', evM);
        return;
      }
      if (eventType === 'topTouchEnd') {
        var evE = makeEvent('touchEnd', target, nativeEvent);
        var remaining = 0;
        if (nativeEvent !== null && nativeEvent !== undefined &&
            nativeEvent.touches !== null && nativeEvent.touches !== undefined) {
          remaining = nativeEvent.touches.length;
        }
        if (remaining === 0) {
          callResponder('onResponderRelease', evE);
          sys.responder = null;
        } else {
          callResponder('onResponderEnd', evE);
        }
        return;
      }
      if (eventType === 'topTouchCancel') {
        var evC = makeEvent('touchCancel', target, nativeEvent);
        callResponder('onResponderTerminate', evC);
        sys.responder = null;
        return;
      }
    });
  };

  return sys;
}
