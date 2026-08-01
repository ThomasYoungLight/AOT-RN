// Typed-port harness: same shared feed app + recording host config, driven by
// the typed reconciler port instead of the real react-reconciler.

function typedMain(): void {
  const RA: any = new G.Object();
  RA.createElement = createElementImpl;
  RA.useState = useStateImpl;
  RA.useCallback = useCallbackImpl;
  RA.memo = memoImpl;

  const appApi: any = installFeedApp(RA);
  const driver: any = runFeedDriver(appApi, flushSyncImpl, print);

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

  const gcs0: any =
    typeof HermesInternal !== 'undefined' && HermesInternal.getInstrumentedStats
      ? HermesInternal.getInstrumentedStats()
      : null;
  const res: any = driver.run();

  print('typed-port-reconciler(18.3-port): ' + String(res.ticks) + ' interactions, ' + String(res.posts) + ' posts');
  print(hostStatsLine());
  print('TOTAL: ' + String(res.ms) + ' ms  (' + String(res.ms / res.ticks) + ' ms/interaction)');
  if (gcs0 !== null) {
    const gcs1: any = HermesInternal.getInstrumentedStats();
    print('GC: numGCs=' + String(gcs1.js_numGCs - gcs0.js_numGCs) +
      ' gcTime=' + String(1000 * (gcs1.js_gcTime - gcs0.js_gcTime)) + 'ms' +
      ' allocated=' + String((gcs1.js_totalAllocatedBytes - gcs0.js_totalAllocatedBytes) / 1048576) + 'MB');
  }
}

typedMain();
