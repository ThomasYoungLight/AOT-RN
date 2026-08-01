'use strict';
// The REAL RN algorithm: ReactNativeAttributePayload.diff + flattenStyle +
// deepDiffer, transcribed verbatim from the react-native sources with Flow
// types stripped (Libraries/ReactNative/ReactFabricPublicInstance/
// ReactNativeAttributePayload.js @ RN main 2026-07-31).

var log = typeof print !== 'undefined' ? print : console.log;

var emptyObject = {};
var removedKeys = null;
var removedKeyCount = 0;
var deepDifferOptions = {unsafelyIgnoreFunctions: true};

function deepDiffer(one, two, maxDepthOrOptions, maybeOptions) {
  var options = typeof maxDepthOrOptions === 'number' ? maybeOptions : maxDepthOrOptions;
  var maxDepth = typeof maxDepthOrOptions === 'number' ? maxDepthOrOptions : -1;
  if (maxDepth === 0) {
    return true;
  }
  if (one === two) {
    return false;
  }
  if (typeof one === 'function' && typeof two === 'function') {
    var unsafelyIgnoreFunctions = options ? options.unsafelyIgnoreFunctions : undefined;
    if (unsafelyIgnoreFunctions == null) {
      unsafelyIgnoreFunctions = true;
    }
    return !unsafelyIgnoreFunctions;
  }
  if (typeof one !== 'object' || one === null) {
    return one !== two;
  }
  if (typeof two !== 'object' || two === null) {
    return true;
  }
  if (one.constructor !== two.constructor) {
    return true;
  }
  if (Array.isArray(one)) {
    var len = one.length;
    if (two.length !== len) {
      return true;
    }
    for (var ii = 0; ii < len; ii++) {
      if (deepDiffer(one[ii], two[ii], maxDepth - 1, options)) {
        return true;
      }
    }
  } else {
    for (var key in one) {
      if (deepDiffer(one[key], two[key], maxDepth - 1, options)) {
        return true;
      }
    }
    for (var twoKey in two) {
      if (one[twoKey] === undefined && two[twoKey] !== undefined) {
        return true;
      }
    }
  }
  return false;
}

function flattenStyleArrayInto(result, styles) {
  for (var i = 0, styleLength = styles.length; i < styleLength; ++i) {
    var style = styles[i];
    if (style === null || typeof style !== 'object') {
      continue;
    }
    if (Array.isArray(style)) {
      flattenStyleArrayInto(result, style);
      continue;
    }
    for (var key in style) {
      result[key] = style[key];
    }
  }
}

function flattenStyle(style) {
  if (style === null || typeof style !== 'object') {
    return undefined;
  }
  if (!Array.isArray(style)) {
    return style;
  }
  var result = {};
  flattenStyleArrayInto(result, style);
  return result;
}

function defaultDiffer(prevProp, nextProp) {
  if (typeof nextProp !== 'object' || nextProp === null) {
    return true;
  } else {
    return deepDiffer(prevProp, nextProp, deepDifferOptions);
  }
}

function restoreDeletedValuesInNestedArray(updatePayload, node, validAttributes) {
  if (Array.isArray(node)) {
    var i = node.length;
    while (i-- && removedKeyCount > 0) {
      restoreDeletedValuesInNestedArray(updatePayload, node[i], validAttributes);
    }
  } else if (node && removedKeyCount > 0) {
    var obj = node;
    for (var propKey in removedKeys) {
      if (!removedKeys[propKey]) {
        continue;
      }
      var nextProp = obj[propKey];
      if (nextProp === undefined) {
        continue;
      }
      var attributeConfig = validAttributes[propKey];
      if (!attributeConfig) {
        continue;
      }
      if (typeof nextProp === 'function') {
        nextProp = true;
      }
      if (typeof nextProp === 'undefined') {
        nextProp = null;
      }
      if (typeof attributeConfig !== 'object') {
        updatePayload[propKey] = nextProp;
      } else if (
        typeof attributeConfig.diff === 'function' ||
        typeof attributeConfig.process === 'function'
      ) {
        var nextValue = typeof attributeConfig.process === 'function'
          ? attributeConfig.process(nextProp)
          : nextProp;
        updatePayload[propKey] = nextValue;
      }
      removedKeys[propKey] = false;
      removedKeyCount--;
    }
  }
}

function diffNestedArrayProperty(updatePayload, prevArray, nextArray, validAttributes) {
  var minLength = prevArray.length < nextArray.length ? prevArray.length : nextArray.length;
  var i;
  for (i = 0; i < minLength; i++) {
    updatePayload = diffNestedProperty(updatePayload, prevArray[i], nextArray[i], validAttributes);
  }
  for (; i < prevArray.length; i++) {
    updatePayload = clearNestedProperty(updatePayload, prevArray[i], validAttributes);
  }
  for (; i < nextArray.length; i++) {
    var nextProp = nextArray[i];
    if (!nextProp) {
      continue;
    }
    updatePayload = addNestedProperty(updatePayload, nextProp, validAttributes);
  }
  return updatePayload;
}

function diffNestedProperty(updatePayload, prevProp, nextProp, validAttributes) {
  if (!updatePayload && prevProp === nextProp) {
    return updatePayload;
  }
  if (!prevProp || !nextProp) {
    if (nextProp) {
      return addNestedProperty(updatePayload, nextProp, validAttributes);
    }
    if (prevProp) {
      return clearNestedProperty(updatePayload, prevProp, validAttributes);
    }
    return updatePayload;
  }
  if (!Array.isArray(prevProp) && !Array.isArray(nextProp)) {
    return diffProperties(updatePayload, prevProp, nextProp, validAttributes);
  }
  if (Array.isArray(prevProp) && Array.isArray(nextProp)) {
    return diffNestedArrayProperty(updatePayload, prevProp, nextProp, validAttributes);
  }
  if (Array.isArray(prevProp)) {
    return diffProperties(updatePayload, flattenStyle(prevProp), nextProp, validAttributes);
  }
  return diffProperties(updatePayload, prevProp, flattenStyle(nextProp), validAttributes);
}

function clearNestedProperty(updatePayload, prevProp, validAttributes) {
  if (!prevProp) {
    return updatePayload;
  }
  if (!Array.isArray(prevProp)) {
    return clearProperties(updatePayload, prevProp, validAttributes);
  }
  for (var i = 0; i < prevProp.length; i++) {
    updatePayload = clearNestedProperty(updatePayload, prevProp[i], validAttributes);
  }
  return updatePayload;
}

function diffProperties(updatePayload, prevProps, nextProps, validAttributes) {
  var attributeConfig;
  var nextProp;
  var prevProp;

  for (var propKey in nextProps) {
    attributeConfig = validAttributes[propKey];
    if (!attributeConfig) {
      continue;
    }
    prevProp = prevProps[propKey];
    nextProp = nextProps[propKey];
    if (typeof nextProp === 'function') {
      var attributeConfigHasProcess =
        typeof attributeConfig === 'object' && typeof attributeConfig.process === 'function';
      if (!attributeConfigHasProcess) {
        nextProp = true;
        if (typeof prevProp === 'function') {
          prevProp = true;
        }
      }
    }
    if (typeof nextProp === 'undefined') {
      nextProp = null;
      if (typeof prevProp === 'undefined') {
        prevProp = null;
      }
    }
    if (removedKeys) {
      removedKeys[propKey] = false;
    }
    if (updatePayload && updatePayload[propKey] !== undefined) {
      if (typeof attributeConfig !== 'object') {
        updatePayload[propKey] = nextProp;
      } else if (
        typeof attributeConfig.diff === 'function' ||
        typeof attributeConfig.process === 'function'
      ) {
        var nextValue0 = typeof attributeConfig.process === 'function'
          ? attributeConfig.process(nextProp)
          : nextProp;
        updatePayload[propKey] = nextValue0;
      }
      continue;
    }
    if (prevProp === nextProp) {
      continue;
    }
    if (typeof attributeConfig !== 'object') {
      if (defaultDiffer(prevProp, nextProp)) {
        (updatePayload || (updatePayload = {}))[propKey] = nextProp;
      }
    } else if (
      typeof attributeConfig.diff === 'function' ||
      typeof attributeConfig.process === 'function'
    ) {
      var shouldUpdate =
        prevProp === undefined ||
        (typeof attributeConfig.diff === 'function'
          ? attributeConfig.diff(prevProp, nextProp)
          : defaultDiffer(prevProp, nextProp));
      if (shouldUpdate) {
        var nextValue = typeof attributeConfig.process === 'function'
          ? attributeConfig.process(nextProp)
          : nextProp;
        (updatePayload || (updatePayload = {}))[propKey] = nextValue;
      }
    } else {
      removedKeys = null;
      removedKeyCount = 0;
      updatePayload = diffNestedProperty(updatePayload, prevProp, nextProp, attributeConfig);
      if (removedKeyCount > 0 && updatePayload) {
        restoreDeletedValuesInNestedArray(updatePayload, nextProp, attributeConfig);
        removedKeys = null;
      }
    }
  }

  for (var propKey2 in prevProps) {
    if (nextProps[propKey2] !== undefined) {
      continue;
    }
    attributeConfig = validAttributes[propKey2];
    if (!attributeConfig) {
      continue;
    }
    if (updatePayload && updatePayload[propKey2] !== undefined) {
      continue;
    }
    prevProp = prevProps[propKey2];
    if (prevProp === undefined) {
      continue;
    }
    if (
      typeof attributeConfig !== 'object' ||
      typeof attributeConfig.diff === 'function' ||
      typeof attributeConfig.process === 'function'
    ) {
      (updatePayload || (updatePayload = {}))[propKey2] = null;
      if (!removedKeys) {
        removedKeys = {};
      }
      if (!removedKeys[propKey2]) {
        removedKeys[propKey2] = true;
        removedKeyCount++;
      }
    } else {
      updatePayload = clearNestedProperty(updatePayload, prevProp, attributeConfig);
    }
  }
  return updatePayload;
}

function addNestedProperty(payload, props, validAttributes) {
  if (Array.isArray(props)) {
    for (var i = 0; i < props.length; i++) {
      payload = addNestedProperty(payload, props[i], validAttributes);
    }
    return payload;
  }
  for (var propKey in props) {
    var prop = props[propKey];
    var attributeConfig = validAttributes[propKey];
    if (attributeConfig == null) {
      continue;
    }
    var newValue;
    if (prop === undefined) {
      if (payload && payload[propKey] !== undefined) {
        newValue = null;
      } else {
        continue;
      }
    } else if (typeof attributeConfig === 'object') {
      if (typeof attributeConfig.process === 'function') {
        newValue = attributeConfig.process(prop);
      } else if (typeof attributeConfig.diff === 'function') {
        newValue = prop;
      }
    } else {
      if (typeof prop === 'function') {
        newValue = true;
      } else {
        newValue = prop;
      }
    }
    if (newValue !== undefined) {
      if (!payload) {
        payload = {};
      }
      payload[propKey] = newValue;
      continue;
    }
    payload = addNestedProperty(payload, prop, attributeConfig);
  }
  return payload;
}

function clearProperties(updatePayload, prevProps, validAttributes) {
  return diffProperties(updatePayload, prevProps, emptyObject, validAttributes);
}

function rnDiff(prevProps, nextProps, validAttributes) {
  return diffProperties(null, prevProps, nextProps, validAttributes);
}

dpRunWorkload(rnDiff, 'diffProperties-REAL(RN main)', log);
