// Typed port of ReactNativeAttributePayload.diff + flattenStyle + deepDiffer.
// The algorithm is inherently dynamic-object traversal (arbitrary app props,
// ViewConfig attribute configs), so values stay `any`; the port contributes
// typed control flow, module state, and native compilation. Verified against
// the verbatim real implementation on the identical seeded workload.

const dpEmptyObject: any = new G.Object();
let dpRemovedKeys: any = null;
let dpRemovedKeyCount = 0;
const dpDeepDifferOptions: any = new G.Object();
dpDeepDifferOptions.unsafelyIgnoreFunctions = true;

function tDeepDiffer(one: any, two: any, maxDepth: number, options: any): boolean {
  if (maxDepth === 0) {
    return true;
  }
  if (one === two) {
    return false;
  }
  if (typeof one === 'function' && typeof two === 'function') {
    let unsafelyIgnoreFunctions: any = options !== null && options !== undefined ? options.unsafelyIgnoreFunctions : undefined;
    if (unsafelyIgnoreFunctions === null || unsafelyIgnoreFunctions === undefined) {
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
  if (G.Array.isArray(one)) {
    const len: any = one.length;
    if (two.length !== len) {
      return true;
    }
    for (let ii = 0; ii < len; ii++) {
      if (tDeepDiffer(one[ii], two[ii], maxDepth - 1, options)) {
        return true;
      }
    }
  } else {
    for (const key in one) {
      if (tDeepDiffer(one[key], two[key], maxDepth - 1, options)) {
        return true;
      }
    }
    for (const twoKey in two) {
      if (one[twoKey] === undefined && two[twoKey] !== undefined) {
        return true;
      }
    }
  }
  return false;
}

function tFlattenStyleArrayInto(result: any, styles: any): void {
  const styleLength: any = styles.length;
  for (let i = 0; i < styleLength; ++i) {
    const style: any = styles[i];
    if (style === null || typeof style !== 'object') {
      continue;
    }
    if (G.Array.isArray(style)) {
      tFlattenStyleArrayInto(result, style);
      continue;
    }
    for (const key in style) {
      result[key] = style[key];
    }
  }
}

function tFlattenStyle(style: any): any {
  if (style === null || typeof style !== 'object') {
    return undefined;
  }
  if (!G.Array.isArray(style)) {
    return style;
  }
  const result: any = new G.Object();
  tFlattenStyleArrayInto(result, style);
  return result;
}

function tDefaultDiffer(prevProp: any, nextProp: any): boolean {
  if (typeof nextProp !== 'object' || nextProp === null) {
    return true;
  }
  return tDeepDiffer(prevProp, nextProp, -1, dpDeepDifferOptions);
}

function tRestoreDeletedValuesInNestedArray(updatePayload: any, node: any, validAttributes: any): void {
  if (G.Array.isArray(node)) {
    let i: number = coerceInt(node.length);
    while (i-- !== 0 && dpRemovedKeyCount > 0) {
      tRestoreDeletedValuesInNestedArray(updatePayload, node[i], validAttributes);
    }
  } else if (node !== null && node !== undefined && node !== false && dpRemovedKeyCount > 0) {
    const obj: any = node;
    for (const propKey in dpRemovedKeys) {
      if (!dpRemovedKeys[propKey]) {
        continue;
      }
      let nextProp: any = obj[propKey];
      if (nextProp === undefined) {
        continue;
      }
      const attributeConfig: any = validAttributes[propKey];
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
        const nextValue: any =
          typeof attributeConfig.process === 'function'
            ? attributeConfig.process(nextProp)
            : nextProp;
        updatePayload[propKey] = nextValue;
      }
      dpRemovedKeys[propKey] = false;
      dpRemovedKeyCount--;
    }
  }
}

function tDiffNestedArrayProperty(updatePayload: any, prevArray: any, nextArray: any, validAttributes: any): any {
  const prevLen: any = prevArray.length;
  const nextLen: any = nextArray.length;
  const minLength: any = prevLen < nextLen ? prevLen : nextLen;
  let i: any = 0;
  for (; i < minLength; i++) {
    updatePayload = tDiffNestedProperty(updatePayload, prevArray[i], nextArray[i], validAttributes);
  }
  for (; i < prevLen; i++) {
    updatePayload = tClearNestedProperty(updatePayload, prevArray[i], validAttributes);
  }
  for (; i < nextLen; i++) {
    const nextProp: any = nextArray[i];
    if (!nextProp) {
      continue;
    }
    updatePayload = tAddNestedProperty(updatePayload, nextProp, validAttributes);
  }
  return updatePayload;
}

function tDiffNestedProperty(updatePayload: any, prevProp: any, nextProp: any, validAttributes: any): any {
  if (!updatePayload && prevProp === nextProp) {
    return updatePayload;
  }
  if (!prevProp || !nextProp) {
    if (nextProp) {
      return tAddNestedProperty(updatePayload, nextProp, validAttributes);
    }
    if (prevProp) {
      return tClearNestedProperty(updatePayload, prevProp, validAttributes);
    }
    return updatePayload;
  }
  const prevIsArray: boolean = G.Array.isArray(prevProp);
  const nextIsArray: boolean = G.Array.isArray(nextProp);
  if (!prevIsArray && !nextIsArray) {
    return tDiffProperties(updatePayload, prevProp, nextProp, validAttributes);
  }
  if (prevIsArray && nextIsArray) {
    return tDiffNestedArrayProperty(updatePayload, prevProp, nextProp, validAttributes);
  }
  if (prevIsArray) {
    return tDiffProperties(updatePayload, tFlattenStyle(prevProp), nextProp, validAttributes);
  }
  return tDiffProperties(updatePayload, prevProp, tFlattenStyle(nextProp), validAttributes);
}

function tClearNestedProperty(updatePayload: any, prevProp: any, validAttributes: any): any {
  if (!prevProp) {
    return updatePayload;
  }
  if (!G.Array.isArray(prevProp)) {
    return tClearProperties(updatePayload, prevProp, validAttributes);
  }
  const n: any = prevProp.length;
  for (let i = 0; i < n; i++) {
    updatePayload = tClearNestedProperty(updatePayload, prevProp[i], validAttributes);
  }
  return updatePayload;
}

function tDiffProperties(updatePayload: any, prevProps: any, nextProps: any, validAttributes: any): any {
  let attributeConfig: any;
  let nextProp: any;
  let prevProp: any;

  for (const propKey in nextProps) {
    attributeConfig = validAttributes[propKey];
    if (!attributeConfig) {
      continue;
    }
    prevProp = prevProps[propKey];
    nextProp = nextProps[propKey];
    if (typeof nextProp === 'function') {
      const attributeConfigHasProcess: boolean =
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
    if (dpRemovedKeys !== null) {
      dpRemovedKeys[propKey] = false;
    }
    if (updatePayload && updatePayload[propKey] !== undefined) {
      if (typeof attributeConfig !== 'object') {
        updatePayload[propKey] = nextProp;
      } else if (
        typeof attributeConfig.diff === 'function' ||
        typeof attributeConfig.process === 'function'
      ) {
        const nextValue0: any =
          typeof attributeConfig.process === 'function'
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
      if (tDefaultDiffer(prevProp, nextProp)) {
        if (!updatePayload) {
          updatePayload = new G.Object();
        }
        updatePayload[propKey] = nextProp;
      }
    } else if (
      typeof attributeConfig.diff === 'function' ||
      typeof attributeConfig.process === 'function'
    ) {
      const shouldUpdate: boolean =
        prevProp === undefined ||
        (typeof attributeConfig.diff === 'function'
          ? attributeConfig.diff(prevProp, nextProp)
          : tDefaultDiffer(prevProp, nextProp));
      if (shouldUpdate) {
        const nextValue: any =
          typeof attributeConfig.process === 'function'
            ? attributeConfig.process(nextProp)
            : nextProp;
        if (!updatePayload) {
          updatePayload = new G.Object();
        }
        updatePayload[propKey] = nextValue;
      }
    } else {
      dpRemovedKeys = null;
      dpRemovedKeyCount = 0;
      updatePayload = tDiffNestedProperty(updatePayload, prevProp, nextProp, attributeConfig);
      if (dpRemovedKeyCount > 0 && updatePayload) {
        tRestoreDeletedValuesInNestedArray(updatePayload, nextProp, attributeConfig);
        dpRemovedKeys = null;
      }
    }
  }

  for (const propKey2 in prevProps) {
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
      if (!updatePayload) {
        updatePayload = new G.Object();
      }
      updatePayload[propKey2] = null;
      if (dpRemovedKeys === null) {
        dpRemovedKeys = new G.Object();
      }
      if (!dpRemovedKeys[propKey2]) {
        dpRemovedKeys[propKey2] = true;
        dpRemovedKeyCount++;
      }
    } else {
      updatePayload = tClearNestedProperty(updatePayload, prevProp, attributeConfig);
    }
  }
  return updatePayload;
}

function tAddNestedProperty(payload: any, props: any, validAttributes: any): any {
  if (G.Array.isArray(props)) {
    const n: any = props.length;
    for (let i = 0; i < n; i++) {
      payload = tAddNestedProperty(payload, props[i], validAttributes);
    }
    return payload;
  }
  for (const propKey in props) {
    const prop: any = props[propKey];
    const attributeConfig: any = validAttributes[propKey];
    if (attributeConfig === null || attributeConfig === undefined) {
      continue;
    }
    let newValue: any = undefined;
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
        payload = new G.Object();
      }
      payload[propKey] = newValue;
      continue;
    }
    payload = tAddNestedProperty(payload, prop, attributeConfig);
  }
  return payload;
}

function tClearProperties(updatePayload: any, prevProps: any, validAttributes: any): any {
  return tDiffProperties(updatePayload, prevProps, dpEmptyObject, validAttributes);
}

function tRnDiff(prevProps: any, nextProps: any, validAttributes: any): any {
  return tDiffProperties(null, prevProps, nextProps, validAttributes);
}

dpRunWorkload(tRnDiff, 'diffProperties-TYPED-PORT', print);
