// Ring-0 registration wrapper: the typed reconciler port exposed through a
// Metro-signature factory, keyed to the JS twin's module id + content hash.

function makeTypedCoreExports(): any {
  const api: any = new G.Object();
  api.impl = 'native-typed-port';
  api.run = function (): any {
    hcResetAll();
    const RA: any = new G.Object();
    RA.createElement = createElementImpl;
    RA.useState = useStateImpl;
    RA.useCallback = useCallbackImpl;
    RA.memo = memoImpl;
    const appApi: any = installFeedApp(RA);
    const driver: any = runFeedDriver(appApi, flushSyncImpl, null);
    const container: any = new G.Object();
    container.id = 0;
    container.type = 'root';
    container.children = new G.Array();
    const root = createRootImpl(container);
    const rootProps: any = new G.Object();
    rootProps.initialPosts = driver.initialPosts;
    flushSyncImpl(function (): void {
      renderIntoRoot(root, createElementImpl(appApi.App, rootProps, undefined, undefined, undefined));
    });
    driver.warmup();
    hostStatsReset();
    const res: any = driver.run();
    const out: any = new G.Object();
    out.label = 'typed-port-reconciler(18.3-port)';
    out.ms = res.ms;
    out.ticks = res.ticks;
    out.posts = res.posts;
    out.host = hostStatsLine();
    return out;
  };
  return api;
}

(function (): void {
  const g: any = globalThis;
  const manifest: any = g.__nativeModules || (g.__nativeModules = {});
  const entry: any = new G.Object();
  entry.hash = '__CORE_HASH__';
  entry.path = '__CORE_PATH__';
  entry.factory = function (
    global: any,
    require: any,
    importDefault: any,
    importAll: any,
    module: any,
    exports: any,
    dependencyMap: any
  ): void {
    module.exports = makeTypedCoreExports();
  };
  manifest[__CORE_ID__] = entry;
})();
