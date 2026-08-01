// The live Fabric demo app — shared verbatim by the JS twin (real
// react-reconciler) and the typed port. Renders real RCTView/RCTText nodes;
// raw text only ever appears inside RCTText. Each tick moves a highlighted
// row and rewrites the header text; row presses toggle a selection. `RA` must
// provide createElement, useState, useCallback, memo.

function installFabricApp(RA) {
  var h = RA.createElement;
  var exposed = mkObj();
  exposed.setTick = anyNull();
  exposed.setSelected = anyNull();

  var ROW_COUNT = 30;
  var rowTitles = mkList();
  for (var t = 0; t < ROW_COUNT; t++) {
    rowTitles.push('Row ' + String(t) + '  ·  hybrid AOT reconciler');
  }

  function Row(props) {
    var outer = mkObj();
    outer.height = 34;
    outer.marginHorizontal = 12;
    outer.marginVertical = 2;
    outer.borderRadius = 8;
    outer.paddingLeft = 14;
    outer.justifyContent = 'center';
    outer.backgroundColor = props.selected ? '#2a6df4' : (props.hot ? '#ffd27f' : '#ffffff');
    var label = mkObj();
    label.fontSize = 13;
    label.color = props.selected ? '#ffffff' : '#222222';
    return h('RCTView', {style: outer, onPress: props.onPress, rowId: props.id},
      h('RCTText', {style: label}, props.title)
    );
  }
  var MemoRow = RA.memo(Row);

  function App(props) {
    var st = RA.useState(0);
    var tick = st[0];
    var setTick = st[1];
    var se = RA.useState(-1);
    var selected = se[0];
    var setSelected = se[1];
    exposed.setTick = setTick;
    exposed.setSelected = setSelected;

    var onRowPress = RA.useCallback(function (id) {
      setSelected(function (s) { return s === id ? -1 : id; });
    }, mkList());

    var hot = tick % ROW_COUNT;

    var rows = mkList();
    for (var i = 0; i < ROW_COUNT; i++) {
      rows.push(h(MemoRow, {
        key: i,
        id: i,
        title: rowTitles[i],
        hot: i === hot,
        selected: i === selected,
        onPress: onRowPress,
      }));
    }

    var headerStyle = mkObj();
    headerStyle.fontSize = 16;
    headerStyle.fontWeight = 'bold';
    headerStyle.color = '#111111';
    headerStyle.marginHorizontal = 12;
    headerStyle.marginBottom = 8;
    var headerText = String(props.banner) + '  ·  tick ' + String(tick) +
      (selected >= 0 ? '  ·  selected ' + String(selected) : '');
    var header = h('RCTText', {style: headerStyle}, headerText);

    var listStyle = mkObj();
    listStyle.flex = 1;
    var list = h('RCTView', {style: listStyle}, rows);

    var rootStyle = mkObj();
    rootStyle.flex = 1;
    rootStyle.backgroundColor = '#eef1f6';
    rootStyle.paddingTop = 70;
    return h('RCTView', {style: rootStyle}, header, list);
  }

  var api = mkObj();
  api.App = App;
  api.exposed = exposed;
  return api;
}

function runFabricMeasure(exposed, flushInteraction, ticks) {
  var t0 = anyVal(Date.now());
  for (var i = 0; i < ticks; i++) {
    flushInteraction(function () {
      exposed.setTick(function (tk) { return tk + 1; });
    });
  }
  var out = mkObj();
  out.ms = Date.now() - t0;
  out.ticks = ticks;
  return out;
}
