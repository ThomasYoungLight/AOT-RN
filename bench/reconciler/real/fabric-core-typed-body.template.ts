// Ring-0 registration wrapper for the LIVE Fabric surface: the typed
// persistent reconciler bound to nativeFabricUIManager, keyed to the
// HybridFabricCore twin's module id + content hash. Exposes the same
// {impl, start, measure, tickOnce, dispatchTouch} API as the twin.

const fabricState: any = new G.Object();

function makeTypedFabricExports(): any {
  const api: any = new G.Object();
  api.impl = 'native-typed-port-fabric';

  api.start = function (env: any): void {
    fhInit(env);
    const RA: any = new G.Object();
    RA.createElement = createElementImpl;
    RA.useState = useStateImpl;
    RA.useCallback = useCallbackImpl;
    RA.memo = memoImpl;
    const appApi: any = installFabricApp(RA);
    fabricState.appApi = appApi;
    const containerInfo: any = new G.Object();
    containerInfo.containerTag = env.rootTag;
    const root = createRootImpl(containerInfo);
    fabricState.root = root;
    const rootProps: any = new G.Object();
    rootProps.banner = env.banner;
    rootProps.insetTop = env.insetTop;
    rootProps.insetBottom = env.insetBottom;
    flushSyncImpl(function (): void {
      renderIntoRoot(root, createElementImpl(appApi.App, rootProps, undefined, undefined, undefined));
    });
    env.log('[FabricTyped] mounted: ' + fhStatsLine());
  };

  api.measure = function (warmupTicks: any, ticks: any): any {
    const exposed: any = fabricState.appApi.exposed;
    runFabricMeasure(exposed, flushSyncImpl, warmupTicks);
    fhResetStats();
    const res: any = runFabricMeasure(exposed, flushSyncImpl, ticks);
    const out: any = new G.Object();
    out.ms = res.ms;
    out.ticks = res.ticks;
    out.host = fhStatsLine();
    return out;
  };

  api.tickOnce = function (): void {
    flushSyncImpl(function (): void {
      fabricState.appApi.exposed.setTick(function (tk: any): any { return tk + 1; });
    });
  };

  api.dispatchTouch = function (target: any, eventType: any, nativeEvent: any): void {
    if (eventType !== 'topTouchEnd') {
      return;
    }
    let f: any = target;
    let guard = 0;
    while (f !== null && f !== undefined && guard < 100) {
      const p: any = f.memoizedProps;
      if (p !== null && p !== undefined && typeof p.onPress === 'function') {
        const cb: any = p.onPress;
        const arg: any = p.rowId;
        flushSyncImpl(function (): void { cb(arg); });
        return;
      }
      f = f.ret;
      guard++;
    }
  };

  return api;
}

(function (): void {
  const g: any = globalThis;
  const manifest: any = g.__nativeModules || (g.__nativeModules = {});
  const entry: any = new G.Object();
  entry.hash = '__FABRIC_HASH__';
  entry.path = '__FABRIC_PATH__';
  entry.factory = function (
    global: any,
    require: any,
    importDefault: any,
    importAll: any,
    module: any,
    exports: any,
    dependencyMap: any
  ): void {
    module.exports = makeTypedFabricExports();
  };
  manifest[__FABRIC_ID__] = entry;
})();
