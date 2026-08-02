// Fabric host layer — the same hc* interface the recording host exposes, but
// bound to global.nativeFabricUIManager (RN Fabric's C++ UIManager binding).
// Instances wrap immutable ShadowNodes; persistence-mode ops clone nodes and
// commit whole-root child sets via completeRoot. `fhDiff(prev, next, va)` and
// `fhCreate(props, va)` are supplied by the including harness (the real
// ReactNativeAttributePayload in the JS twin, the typed port in the unit) —
// both checksum-verified payload-identical.

var FH = mkObj();
FH.ui = anyNull();
FH.rootTag = 0;
FH.getViewConfig = anyNull();
FH.nextTag = 2;
FH.vcCache = anyNull();
FH.stats = anyNull();

function fhResetStats() {
  var s = mkObj();
  s.creates = 0;
  s.textCreates = 0;
  s.appends = 0;
  s.clones = 0;
  s.childSets = 0;
  s.setAppends = 0;
  s.completeRoots = 0;
  FH.stats = s;
}

function fhInit(env) {
  FH.ui = env.ui;
  FH.rootTag = coerceInt(env.rootTag);
  FH.getViewConfig = env.getViewConfig;
  FH.nextTag = 2;
  FH.vcCache = mkObj();
  fhResetStats();
}

function fhViewConfig(type) {
  var vc = FH.vcCache[type];
  if (vc === undefined) {
    vc = FH.getViewConfig(type);
    FH.vcCache[type] = vc;
  }
  return vc;
}

// React passes the completing fiber as createNode's instanceHandle; the C++
// event emitter hands it back to the registered event handler on touches.
function hcCreateInstance(type, props, fiber) {
  FH.stats.creates++;
  var vc = fhViewConfig(type);
  var tag = FH.nextTag;
  FH.nextTag += 2;
  var payload = fhCreate(props, vc.validAttributes);
  var inst = mkObj();
  inst.node = FH.ui.createNode(coerceInt(tag), vc.uiViewClassName, FH.rootTag, payload, fiber);
  inst.va = vc.validAttributes;
  return inst;
}

function hcCreateTextInstance(txt, fiber) {
  FH.stats.textCreates++;
  var tag = FH.nextTag;
  FH.nextTag += 2;
  var payload = mkObj();
  payload.text = txt;
  var inst = mkObj();
  inst.node = FH.ui.createNode(coerceInt(tag), 'RCTRawText', FH.rootTag, payload, fiber);
  inst.va = anyNull();
  return inst;
}

function hcAppendChild(parent, child) {
  FH.stats.appends++;
  FH.ui.appendChild(parent.node, child.node);
}

function hcCloneInstance(instance, updatePayload, type, newProps, keepChildren) {
  FH.stats.clones++;
  var node = anyNull();
  if (keepChildren) {
    if (updatePayload !== null && updatePayload !== undefined) {
      node = FH.ui.cloneNodeWithNewProps(instance.node, updatePayload);
    } else {
      node = FH.ui.cloneNode(instance.node);
    }
  } else {
    if (updatePayload !== null && updatePayload !== undefined) {
      node = FH.ui.cloneNodeWithNewChildrenAndProps(instance.node, updatePayload);
    } else {
      node = FH.ui.cloneNodeWithNewChildren(instance.node);
    }
  }
  var inst = mkObj();
  inst.node = node;
  inst.va = instance.va;
  return inst;
}

// passChildrenWhenCloningPersistedNodes contract: children as plain JS
// arrays of shadow nodes; the deprecated createChildSet/appendChildToSet
// bindings are not used on this path.
function hcCloneInstancePassChildren(instance, updatePayload, type, newProps, children) {
  var childNodes = mkList();
  for (var ci = 0; ci < children.length; ci++) {
    childNodes.push(children[ci].node);
  }
  var node = anyNull();
  if (updatePayload !== null && updatePayload !== undefined) {
    node = FH.ui.cloneNodeWithNewChildrenAndProps(instance.node, childNodes, updatePayload);
  } else {
    node = FH.ui.cloneNodeWithNewChildren(instance.node, childNodes);
  }
  var inst = mkObj();
  inst.node = node;
  inst.va = instance.va;
  return inst;
}

function hcCompleteRootPassChildren(container, childArray) {
  FH.stats.completeRoots++;
  var childNodes = mkList();
  for (var ci = 0; ci < childArray.length; ci++) {
    childNodes.push(childArray[ci].node);
  }
  FH.ui.completeRoot(coerceInt(container.containerTag), childNodes);
}

function hcCreateContainerChildSet() {
  FH.stats.childSets++;
  return FH.ui.createChildSet();
}

function hcAppendChildToContainerChildSet(childSet, child) {
  FH.stats.setAppends++;
  FH.ui.appendChildToSet(childSet, child.node);
}

function hcFinalizeContainerChildren(container, childSet) {}

function hcReplaceContainerChildren(container, childSet) {
  FH.stats.completeRoots++;
  FH.ui.completeRoot(coerceInt(container.containerTag), childSet);
}

function diffHostProps(oldProps, newProps, inst) {
  return fhDiff(oldProps, newProps, inst.va);
}

function fhUnsupported(name) {
  throw new G.Error('fabric host: mutation op called in persistence mode: ' + name);
}

function hcInsertBefore(parent, child, beforeChild) { fhUnsupported('insertBefore'); }
function hcRemoveChild(parent, child) { fhUnsupported('removeChild'); }
function hcCommitUpdate(inst, payload, newProps) { fhUnsupported('commitUpdate'); }
function hcCommitTextUpdate(inst, oldText, newText) { fhUnsupported('commitTextUpdate'); }

// Suspense visibility ops. Mutation-only hide/unhide never run in
// persistence mode; hidden text clones are unsupported (the fabric demo app
// has no Suspense) and would need an RCTRawText re-create.
function hcHideInstance(inst) { fhUnsupported('hideInstance'); }
function hcUnhideInstance(inst, props) { fhUnsupported('unhideInstance'); }
function hcHideTextInstance(inst) { fhUnsupported('hideTextInstance'); }
function hcUnhideTextInstance(inst, text) { fhUnsupported('unhideTextInstance'); }

function hcCloneHiddenInstance(instance, type, props) {
  var hiddenProps = mkObj();
  var st = mkObj();
  st.display = 'none';
  hiddenProps.style = st;
  var payload = fhCreate(hiddenProps, instance.va);
  var inst = mkObj();
  inst.node = FH.ui.cloneNodeWithNewProps(instance.node, payload);
  inst.va = instance.va;
  return inst;
}

function hcCloneHiddenTextInstance(instance, text) {
  fhUnsupported('cloneHiddenTextInstance');
}

function fhStatsLine() {
  var s = FH.stats;
  return 'fabric-host: creates=' + String(s.creates) +
    ' textCreates=' + String(s.textCreates) +
    ' appends=' + String(s.appends) +
    ' clones=' + String(s.clones) +
    ' childSets=' + String(s.childSets) +
    ' setAppends=' + String(s.setAppends) +
    ' completeRoots=' + String(s.completeRoots);
}
