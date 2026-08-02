// Concurrent harness for the typed port: ConcurrentRoot + the shared
// concurrent workload, pumped through the typed deterministic scheduler.
function runConcurrentHarness(): void {
  const RA: any = new G.Object();
  RA.createElement = createElementImpl;
  RA.useState = useStateImpl;
  RA.useEffect = useEffectImpl;
  RA.useLayoutEffect = useLayoutEffectImpl;
  RA.memo = memoImpl;
  RA.useTransition = useTransitionImpl;
  RA.useDeferredValue = useDeferredValueImpl;
  RA.lazy = lazyImpl;
  RA.Suspense = SuspenseType;
  RA.useSyncExternalStore = useSyncExternalStoreImpl;

  const appApi: any = installConcurrentApp(RA);

  const ctl: any = new G.Object();
  ctl.discrete = function (fn: any): void {
    discreteUpdatesImpl(fn);
  };
  ctl.flushAll = function (): void {
    schedFlushAll();
  };
  ctl.step = function (n: number): void {
    schedFlushOne(n);
  };
  ctl.advance = function (ms: number): void {
    schedAdvance(ms);
  };

  const driver: any = runConcurrentDriver(appApi, ctl, print);

  const container: any = new G.Object();
  container.id = 0;
  container.type = 'root';
  container.children = new G.Array();
  const root = createConcurrentRootImpl(container);
  const rootProps: any = new G.Object();
  rootProps.initialItems = driver.initialItems;
  renderIntoRoot(root, createElementImpl(appApi.App, rootProps, undefined, undefined, undefined));
  schedFlushAll();

  driver.warmup();
  hostStatsReset();
  const trace: any = schedTrace();
  trace.sum = 0;

  const hi: any = anyVal(typeof HermesInternal !== 'undefined' ? HermesInternal : null);
  const gcs0: any = hi !== null && hi.getInstrumentedStats !== undefined ? hi.getInstrumentedStats() : null;
  const res: any = driver.run();

  print('typed-port-reconciler-concurrent(18.3-port): ' + String(res.ticks) + ' interactions, ' + String(res.rows) + ' rows');
  print(hostStatsLine() + ' fx=' + String(res.fx) + ' sched=' + String(trace.sum >>> 0));
  print('schedStats: schedules=' + String(trace.schedules) + ' cancels=' + String(trace.cancels) +
    ' runs=' + String(trace.runs) + ' continuations=' + String(trace.continuations) +
    ' yields=' + String(trace.yields));
  print('TOTAL: ' + String(res.ms) + ' ms  (' + String(res.ms / res.ticks) + ' ms/interaction)');
  if (gcs0 !== null) {
    const gcs1: any = hi.getInstrumentedStats();
    print('GC: numGCs=' + String(gcs1.js_numGCs - gcs0.js_numGCs) +
      ' gcTime=' + String(1000 * (gcs1.js_gcTime - gcs0.js_gcTime)) + 'ms' +
      ' allocated=' + String((gcs1.js_totalAllocatedBytes - gcs0.js_totalAllocatedBytes) / 1048576) + 'MB');
  }
}

runConcurrentHarness();
