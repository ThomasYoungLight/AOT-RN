// Recording host config — shared verbatim by the real react-reconciler
// baseline and the typed port. Every host mutation feeds a rolling checksum;
// equivalence of the two reconcilers is asserted on (opCounts, checksum).
// Prop diffing lives here (as in React Native's ViewConfig diffing).

var hostStats = {
  creates: 0,
  textCreates: 0,
  appends: 0,
  inserts: 0,
  removes: 0,
  updates: 0,
  textUpdates: 0,
  clones: 0,
  childSets: 0,
  replaces: 0,
  hides: 0,
  unhides: 0,
  hiddenClones: 0,
  checksum: 0,
};
var nextInstanceId = 1;

function mix(n) {
  var ni = coerceInt(n);
  hostStats.checksum = ((hostStats.checksum * 31 + ni) | 0) >>> 0 | 0;
}

function hashStr(s) {
  var h = 0;
  var n = coerceInt(s.length);
  for (var i = 0; i < n; i++) {
    h = (h * 33 + coerceInt(s.charCodeAt(i))) | 0;
  }
  return h;
}

function hashVal(v) {
  if (v === null || v === undefined) return 3;
  if (typeof v === 'number') return coerceInt(v);
  if (typeof v === 'boolean') return v ? 7 : 11;
  if (typeof v === 'string') return hashStr(v);
  return 13; // functions/objects: identity not hashable, count as opaque
}

// `inst`/`fiber` params below exist for host-config interface parity with the
// fabric host (which needs validAttributes and the instanceHandle); the
// recording host ignores them.
function diffHostProps(oldProps, newProps, inst) {
  var payload = anyNull();
  for (var k in oldProps) {
    if (k === 'children') continue;
    if (!(k in newProps)) {
      if (payload === null) payload = mkList();
      payload.push(k, null);
    }
  }
  for (var k2 in newProps) {
    if (k2 === 'children') continue;
    if (oldProps[k2] !== newProps[k2]) {
      if (payload === null) payload = mkList();
      payload.push(k2, newProps[k2]);
    }
  }
  return payload;
}

function hcCreateInstance(type, props, fiber) {
  hostStats.creates++;
  var inst = {id: nextInstanceId++, type: type, props: props, children: mkList()};
  mix(1);
  mix(hashStr(type));
  return inst;
}

function hcCreateTextInstance(txt, fiber) {
  hostStats.textCreates++;
  var inst = {id: nextInstanceId++, type: '#text', text: txt, children: null};
  mix(2);
  mix(hashStr(txt));
  return inst;
}

function hcAppendChild(parent, child) {
  hostStats.appends++;
  var idx = parent.children.indexOf(child);
  if (idx !== -1) parent.children.splice(idx, 1);
  parent.children.push(child);
  mix(4);
  mix(child.id);
}

function hcInsertBefore(parent, child, beforeChild) {
  hostStats.inserts++;
  var idx = parent.children.indexOf(child);
  if (idx !== -1) parent.children.splice(idx, 1);
  var at = parent.children.indexOf(beforeChild);
  parent.children.splice(at, 0, child);
  mix(5);
  mix(child.id);
  mix(beforeChild.id);
}

function hcRemoveChild(parent, child) {
  hostStats.removes++;
  var idx = parent.children.indexOf(child);
  if (idx !== -1) parent.children.splice(idx, 1);
  mix(6);
  mix(child.id);
}

function hcCommitUpdate(inst, payload, newProps) {
  hostStats.updates++;
  inst.props = newProps;
  mix(7);
  mix(inst.id);
  for (var i = 0; i < payload.length; i += 2) {
    mix(hashStr(payload[i]));
    mix(hashVal(payload[i + 1]));
  }
}

function hcCommitTextUpdate(inst, oldText, newText) {
  hostStats.textUpdates++;
  inst.text = newText;
  mix(8);
  mix(inst.id);
  mix(hashStr(newText));
}

// ---- persistence-mode (Fabric-shaped) host ops ----
function hcCloneInstance(instance, updatePayload, type, newProps, keepChildren) {
  hostStats.clones++;
  var children = keepChildren ? instance.children.slice() : mkList();
  var inst = {id: nextInstanceId++, type: instance.type, props: newProps, children: children};
  mix(9);
  mix(coerceInt(instance.id));
  mix(keepChildren ? 21 : 22);
  if (updatePayload !== null && updatePayload !== undefined) {
    for (var pi = 0; pi < updatePayload.length; pi += 2) {
      mix(hashStr(updatePayload[pi]));
      mix(hashVal(updatePayload[pi + 1]));
    }
  }
  return inst;
}

function hcCreateContainerChildSet() {
  hostStats.childSets++;
  mix(10);
  return {children: mkList()};
}

function hcAppendChildToContainerChildSet(childSet, child) {
  childSet.children.push(child);
  mix(11);
  mix(coerceInt(child.id));
}

function hcFinalizeContainerChildren(container, childSet) {
  mix(12);
}

function hcReplaceContainerChildren(container, childSet) {
  hostStats.replaces++;
  container.children = childSet.children;
  mix(13);
}

// ---- Suspense visibility ops ----
function hcHideInstance(inst) {
  hostStats.hides++;
  mix(17);
  mix(coerceInt(inst.id));
}

function hcUnhideInstance(inst, props) {
  hostStats.unhides++;
  mix(18);
  mix(coerceInt(inst.id));
}

function hcHideTextInstance(inst) {
  hostStats.hides++;
  mix(19);
  mix(coerceInt(inst.id));
}

function hcUnhideTextInstance(inst, text) {
  hostStats.unhides++;
  mix(20);
  mix(coerceInt(inst.id));
  mix(hashStr(text));
}

function hcCloneHiddenInstance(instance, type, props) {
  hostStats.hiddenClones++;
  var inst = {id: nextInstanceId++, type: instance.type, props: props, children: instance.children.slice()};
  mix(23);
  mix(coerceInt(instance.id));
  return inst;
}

function hcCloneHiddenTextInstance(instance, text) {
  hostStats.hiddenClones++;
  var inst = {id: nextInstanceId++, type: '#text', text: text, children: null};
  mix(24);
  mix(coerceInt(instance.id));
  return inst;
}

function hostStatsLine() {
  return (
    'host: creates=' + String(hostStats.creates) +
    ' textCreates=' + String(hostStats.textCreates) +
    ' appends=' + String(hostStats.appends) +
    ' inserts=' + String(hostStats.inserts) +
    ' removes=' + String(hostStats.removes) +
    ' updates=' + String(hostStats.updates) +
    ' textUpdates=' + String(hostStats.textUpdates) +
    ' clones=' + String(hostStats.clones) +
    ' childSets=' + String(hostStats.childSets) +
    ' replaces=' + String(hostStats.replaces) +
    ' hides=' + String(hostStats.hides) +
    ' unhides=' + String(hostStats.unhides) +
    ' hiddenClones=' + String(hostStats.hiddenClones) +
    ' checksum=' + String(hostStats.checksum >>> 0)
  );
}

function hcResetAll() {
  nextInstanceId = 1;
  hostStatsReset();
}

function hostStatsReset() {
  hostStats.clones = 0;
  hostStats.childSets = 0;
  hostStats.replaces = 0;
  hostStats.hides = 0;
  hostStats.unhides = 0;
  hostStats.hiddenClones = 0;
  hostStats.creates = 0;
  hostStats.textCreates = 0;
  hostStats.appends = 0;
  hostStats.inserts = 0;
  hostStats.removes = 0;
  hostStats.updates = 0;
  hostStats.textUpdates = 0;
  hostStats.checksum = 0;
}
