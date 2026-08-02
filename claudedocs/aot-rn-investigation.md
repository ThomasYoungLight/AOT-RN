# Full-AOT React Native — Investigation Report

**Date:** 2026-08-01
**Repos cloned (shallow) into this directory:**

| Repo | Path | What it is |
|---|---|---|
| PerryTS/perry | `./perry` | TS→native AOT compiler (Rust, SWC→HIR→LLVM-via-clang), v0.5.1275 |
| PerryTS/react | `./perry-react` | React-compatible renderer for Perry (Phase 1 PoC) |
| vercel-labs/scriptc | `./scriptc` | TS→native compiler (tsc/tsgo → typed IR → LLVM/C → clang), v0.0.21 |
| Snapchat/Valdi | `./valdi` | Snap's cross-platform UI framework (8 years in production) |
| facebook/react-native | `./react-native` | RN main @ c7d62a1 |

---

## Headline findings

### 1. RN main already has the full-AOT hook wired in — via Static Hermes

`ReactCommon/react/runtime/ReactInstance.cpp:276-287` prefers a **natively-compiled Static Hermes unit** over evaluating a JS bundle:

```cpp
auto* shUnitAPI = jsi::castInterface<hermes::IHermesSHUnit>(&runtime);
if (shUnitCreator) {
  hermesAPI->evaluateSHUnit(shUnitCreator);   // function pointer into compiled native code
} else {
  runtime.evaluateJavaScript(buffer, sourceURL);
}
```

- Interface: `ReactCommon/jsi/jsi/hermes-interfaces.h` — `SHUnitCreator = SHUnit* (*)()` (a function pointer, not a buffer).
- Committed to the **stable C++ API snapshots** (`scripts/cxx-api/`), so Meta treats it as a real API.
- The shermes compiler and build rules are **not in OSS**. Fantom test runner: `'Static Hermes is not yet supported in OSS'` (`private/react-native-fantom/runner/runner.js:288`). Internal Buck targets `//xplat/shermes/stable:hermesc` exist.
- Caveat: even fully SH-compiled, the app still links the Hermes **runtime** (GC, object model). "No JS engine" is true only in the interpreter sense.

### 2. RN's JS dependency is already narrow

~139k LOC of C++ in ReactCommon vs ~77k LOC runtime JS. Fabric renderer, Yoga layout, diffing, mounting, event loop (`RuntimeScheduler_Modern`), timers/microtasks (native host functions), and C++ Animated are all native. What still needs a JS runtime:

1. **React fiber reconciliation** — `Libraries/Renderer/implementations/ReactFabric-prod.js` (10.7k lines). Its entire native surface is ~13 host functions (`createNode`, `cloneNode*`, `appendChild`, `completeRoot`, …) implemented in `UIManagerBinding.cpp`.
2. **The JSI boundary** — dynamic `jsi::Value` marshalling, even though codegen knows static types on both sides.
3. **Metro's runtime module registry** (`__d`/`__r`).

Fundamentally incompatible with full AOT: **Fast Refresh** (runtime module replacement) and **OTA/CodePush** (`eval` of downloaded bundles → AOT means app-store releases only).

### 3. Perry — the only one that AOT-compiles *unrestricted* JS semantics

- Pipeline: SWC → HIR → monomorphization/passes → **textual LLVM IR → clang**. Cranelift backend deleted at v0.5.0.
- **No static-subset restriction**: NaN-boxed values, hidden classes + inline caches, prototype mutation, Proxy, generators, a generational mark-sweep GC with precise shadow stacks, most of Node's stdlib (~95% compat, Node's own test corpus at ~97%). No interpreter in the binary (V8/QuickJS fallback removed); `new Function` handled by an opt-in tree-walking interpreter feature.
- **React 18 + react-reconciler + scheduler compile through the LLVM pipeline today** (`tests/release/packages/ink-link-smoke/`) — but the fixture stops after link; running hits an open interop bug (`hasOwnProperty is not a function`, issue #348). **Link-verified, not run-verified.**
- **Performance risk is exactly the reconciler shape**: megamorphic property access / method dispatch measured at ~0.01–0.02× Node in the (stale) v0.5.0 benchmark set. NaN-box is the canonical representation; unboxed representation is a draft RFC (`docs/representation-selection-rfc.md`), not shipped.
- Native UI backends already exist: iOS (UIKit, ~40 widgets), Android (JNI), macOS, Windows, GTK4, tvOS/watchOS/visionOS, with compile-time dispatch tables (direct extern calls, no reflection) + iOS/Android bundling and codesigning.
- `perry-react` (separate repo): Phase-1 PoC — full-tree rebuild on every state change, global hook storage (multiple instances of a component share state), no useEffect deps, JSX spread attributes dropped by the compiler (`crates/perry-hir/src/jsx.rs:34-41`).

### 4. scriptc — rigorous static-subset AOT; not a React path

- Real tsc frontend (TS 7 / tsgo) → closed typed IR → textual LLVM IR or C → clang. Refcounting + Bacon–Rajan cycle collector, no GC. ~200KB–4MB binaries, ~2ms startup. Differential-tested **byte-for-byte against Node**; ASan + refcount audit on every change.
- Three tiers: static / dynamic island (embedded **QuickJS**, ~620KB, for `any` and npm code) / rejected (SC diagnostic). `scriptc coverage` reports per-statement tier assignment.
- Blockers for RN: **no JSX at all** (CLI rejects `.tsx`), no prototypes/Proxy/dynamic property access (records are exact structs), **no iOS/Android targets** (and its fiber scheduler uses `ucontext`, removed from the iOS SDK), library mode is `async_free`, and — notably — `Math.sqrt/pow/PI/trig` are **dynamic-only** (require the QuickJS island).
- The interesting artifact: **library mode** — compiles TS to a `.a` with a `model`/`msg`/`init`/`update`/`subscriptions` (Elm-architecture) contract + machine-readable sidecar. A plausible substrate for a *new* "TS logic compiled native, host renders" framework — not for React.

### 5. Valdi — proof that the win is the *render protocol*, not AOT

- **Valdi always ships a JS engine**: JavaScriptCore on iOS (release), QuickJS on Android (with AOT bytecode), Hermes for debug/desktop. "No JS bridge" means no serialized view-update bridge, not no VM.
- It **does** have a real AOT TS→C compiler (**TSN**, `compiler/companion/src/native/` + `tsn/`), but the generated C calls straight into QuickJS's runtime (`typedef JSValue tsn_value`) — it removes interpreter dispatch, keeps the JS object model/GC. Opt-in per module; **iOS output currently disabled**; kills hot reload for that module; after 8 years the default is still bytecode and even `valdi_core` isn't compiled native.
- Where Valdi's speed actually comes from (all transferable *without* AOT):
  - JSX compiles to **imperative stack calls returning `void`** — no element objects allocated per render; static attributes hoisted into module-level `NodePrototype`s.
  - One **binary command buffer** (`ArrayBuffer`, 4-byte-header opcodes) per render pass; strings/attributes/**style objects interned to ints**.
  - **Render bypass**: reference-unchanged viewModel → subtree skipped entirely; independent **slot replay** without re-rendering the owner.
  - **Global view recycling** pool per view class (app-wide, cross-screen) + **viewport-aware inflation** (`limitToViewport`: off-screen nodes get Yoga nodes but no native view) — plain flexbox scrolls without RecyclerView/UICollectionView.
  - JS thread renders; C++ applies layout/mount on main thread — **no JS on the UI thread**; per-module lazy loading via Proxy (~600 `.valdimodule`s at Snap, no monolithic bundle).

---

## Synthesis: can we full-AOT React Native?

**Yes in principle, and Meta is already building the most pragmatic version of it.** Ranked by feasibility:

| Path | What it is | Feasibility | What you keep / lose |
|---|---|---|---|
| **A. Static Hermes native units** | shermes compiles the whole bundle (React included) to native code, loaded via the existing `evaluateSHUnit` hook | **Highest** — the RN-side plumbing is merged; blocked only on shermes OSS availability | Keep full React semantics + ecosystem. Lose Fast Refresh in AOT builds, lose OTA. Hermes runtime (GC/object model) still linked |
| **B. Valdi-style architecture transplant** | Compiler-emitted imperative render calls, binary command buffer, interning, view recycling, viewport inflation | **High-value, orthogonal to AOT** — this is most of Valdi's real advantage over RN | Requires compiler + reconciler redesign; not "React" semantics per-render anymore |
| **C. Perry-style full-semantics AOT** | Compile unrestricted JS (incl. react-reconciler) to native, no interpreter | **Medium** — compiles/links today, doesn't run yet (#348); reconciler-shaped workloads are its measured worst case until the unboxed-representation RFC lands | Keeps React semantics; new toolchain, ~2–4MB runtime, ecosystem risk |
| **D. scriptc-style static subset** | Reject dynamism, compile typed TS to tiny native binaries | **Not viable for React** — React's object model is the rejected dynamism; no JSX, no mobile targets | Only fits a new Elm-style framework |

**Key insight from the four-way comparison:** "RN is slower than Flutter" is not primarily an interpreter problem anymore. Startup/parse is already mitigated by Hermes bytecode; the per-frame cost is React reconciliation in JS + JSI crossings + GC pauses. Two attack vectors compound:

1. **Eliminate the interpreter** (path A) — helps reconciliation throughput and startup.
2. **Eliminate the per-render allocation/marshalling architecture** (path B) — what actually makes Valdi fast, independent of engine.

Flutter has both (Dart AOT + no VDOM-to-native translation layer). RN needs both to close the gap; either alone is partial.

**Recommended next steps:**
1. Track/experiment with Static Hermes: build shermes from `facebook/hermes` `static_h` work, try `-typed` compilation of a reconciler-shaped benchmark; watch for OSS enablement of the `evaluateSHUnit` path.
2. Benchmark a real reconciler commit-phase loop on Perry (its `test-files/` harness + `benchmarks/app-patterns/`) to test the NaN-boxing bottleneck hypothesis.
3. Prototype Valdi-style wins inside RN semantics: interned props/styles, command-buffer mounting (batch the ~13 host-function calls per commit into one buffer), view recycling flags already in RN (`enableViewCulling`, `enableViewRecycling*` in `ReactNativeFeatureFlags.h`).
4. Decide the OTA question early — full AOT forfeits CodePush-style updates; if OTA is a product requirement, the ceiling is "AOT for the stable core + interpreted app modules" (Valdi's mixed-mode is the existence proof).

---

## Experiment 1 (2026-08-01): shermes build + reconciler-shaped benchmark

**Setup.** Built `shermes` from facebook/hermes main (`./hermes`, Release, macOS arm64; targets `shermes hermes hermesc shermes_console{,_a} hermesvm_a`). Benchmark in `./bench/`: 300 commits over a ~3,280-node tree; each commit = element-tree allocation → type check + props diff → fiber clone (alternate tree) → child/sibling/parent commit walk. Two variants of the same algorithm:

- `bench-dynamic.js` — idiomatic dynamic JS (object-literal props, `for-in` diff)
- `bench-typed.ts` — static shapes (typed classes, fixed-field diff) for `shermes -typed`

All variants produce identical effect counts (75,331), so the work is identical.

**Results** (median of 3, ms/commit):

| Runtime | ms/commit | vs Hermes interp |
|---|---|---|
| Hermes bytecode interpreter, `-O` (≈ RN today) | 5.5 | 1.0× |
| shermes **untyped** native (same dynamic JS) | 3.5–3.9 | **~1.5×** |
| shermes **typed** native (static shapes) | 1.4 | **~3.9×** |
| Node 22 / V8 JIT (dynamic variant) | 0.53 | ~10× |
| Node 22 / V8 JIT (typed-shape variant) | 0.41 | ~13× |

Phase breakdown (one full run each): the commit-phase pointer walk gets the biggest native win (27 ms → 6 ms untyped → 4 ms typed, summed over 300 commits); allocation and diffing dominate everywhere.

**SHUnit artifact verified.** `shermes -typed -O -c -exported-unit=bench_typed bench-typed.ts` produces an object file exporting `_sh_export_bench_typed` — the `SHUnit* (*)()` creator function that RN's `evaluateSHUnit` hook (`ReactInstance.cpp:276`) consumes. The full toolchain RN needs exists in OSS today; only RN-side build integration is missing.

**Interpretation.**

1. **Drop-in AOT of dynamic JS buys little (~1.5×).** Compiling untyped JS to native keeps all the hidden-class/dictionary/NaN-box overhead — it only removes interpreter dispatch. This also independently corroborates the Perry risk assessment: full-semantics AOT without type-driven representation change doesn't fix reconciler-shaped workloads.
2. **Typed AOT is the real win (~4× over RN's current engine)** — but it requires the code to be written in the typed subset (static shapes, no `string+number`, fixed-field props). React's actual reconciler is not in that subset today; getting the 4× for RN means Meta (or someone) porting/annotating the reconciler for typed SH — which is plausibly exactly what the internal `evaluateSHUnit` path is for.
3. **V8's warm JIT is still ~3× faster than typed shermes** on this microbench. Irrelevant for iOS (JIT prohibited) and for RN (which ships Hermes), but a useful reminder that "native" ≠ automatically fast; inline-cached JIT on monomorphic code is a high bar.
4. Caveats: microbenchmark; `Date.now()` timer granularity; macOS arm64 desktop, not a phone; the real reconciler is far more polymorphic than this model, so treat the untyped 1.5× as optimistic and the typed 3.9× as the shape of the opportunity, not a promise.

**Artifacts:** `bench/bench-dynamic.js`, `bench/bench-typed.ts`, `bench/bench-typed-node.mjs` (Node shim), binaries `bench/bench-{dynamic,typed}-native`, SHUnit object `bench/bench-typed-shunit.o`. Rebuild: `hermes/build_release/bin/shermes -typed -O bench-typed.ts -o bench-typed-native`.

---

## Experiment 2 (2026-08-01): on-device — Galaxy S23 Ultra (Snapdragon 8 Gen 2, Android 16)

**Setup.** Cross-compiled Hermes for Android arm64 with NDK r27.1 (`hermes/build_android`, `-DHERMES_UNICODE_LITE=ON` to skip ICU, `-DIMPORT_HOST_COMPILERS=build_release/ImportHostCompilers.cmake`). shermes cross-compiles by overriding its driver env:

```bash
CC=$NDK/.../aarch64-linux-android24-clang \
CFLAGS="-O3 -DNDEBUG -fno-strict-aliasing -fno-strict-overflow \
        -I$H/build_android/lib/config -I$H/include" \
LDFLAGS="-L$H/build_android/lib -L$H/build_android/jsi \
         -L$H/build_android/tools/shermes \
         -L$H/build_android/external/boost/boost_1_86_0/libs/context" \
LDLIBS="-lshermes_console_a -ljsi -lboost_context -llog -lc++_static -lc++abi -lm -ldl" \
shermes [-typed] -O -static-link bench.{js,ts} -o bench-android
```

Fully static ELF executables; pushed to `/data/local/tmp/aotbench/` with the Android `hermes` CLI; runs pinned to the performance cluster (`taskset f0`, cpus 4–7; unpinned runs were ±2× noisy from big.LITTLE migration). 5 runs each, median:

| Runtime (on device) | ms/commit | vs Hermes interp |
|---|---|---|
| Hermes bytecode interpreter (≈ RN today) | 7.19 | 1.0× |
| shermes **untyped** native (same dynamic JS) | 6.88 (5.3–6.9) | **~1.05–1.35×** |
| shermes **typed** native (static shapes) | 1.97 | **~3.6×** |

Phase breakdown (one pinned run each, summed over 300 commits):

| Phase | interp | untyped native | typed native |
|---|---|---|---|
| render (alloc) | 1389 ms | 869 ms | 395 ms |
| reconcile (diff) | 675 ms | 840 ms | 181 ms |
| commit (walk) | 34 ms | 8 ms | 4 ms |

**On-device interpretation.**

1. **Untyped AOT is worth almost nothing on the phone (~1.1–1.35×, noisy).** Worse than on the M-series Mac (~1.5×). The dynamic-JS costs that remain (hidden-class lookups, boxing, GC) dominate on mobile cores; notably the untyped *diff* phase got slower than the interpreter's (840 vs 675 ms) while only allocation improved. Removing interpreter dispatch alone does not close the Flutter gap.
2. **Typed AOT holds its win on device: ~3.6× over the Hermes interpreter**, with very low run-to-run variance (1.87–2.01 ms/commit). Diffing is 3.7× faster, allocation 3.5× faster, the commit pointer-walk 8× faster.
3. Together with Experiment 1, the conclusion sharpens: **the speedup comes from static types enabling unboxed representations and direct field access — not from "compiling to native" per se.** For RN this means the `evaluateSHUnit` path only pays off if the hot JS (the reconciler, ideally app components too) is in the typed subset; AOT-compiling today's untyped bundle would deliver a barely measurable win.

**Device artifacts:** `/data/local/tmp/aotbench/{hermes,bench-dynamic-android,bench-typed-android,bench-dynamic.js}` on device <ANDROID-SERIAL>; host binaries `bench/bench-{dynamic,typed}-android`, Android build tree `hermes/build_android/`.

---

## Experiment 3 (2026-08-01): on-device — iPhone 15 Pro Max (A17 Pro, iOS 26.5)

**Setup.** iOS has no adb-style shell, so each variant ships as a signed `.app` whose executable is a plain `main()` binary, launched via `xcrun devicectl device process launch --console` (streams stdout).

- Hermes VM built for iOS arm64: `hermes/build_ios` (`-DCMAKE_SYSTEM_NAME=iOS -DCMAKE_SYSTEM_PROCESSOR=arm64 -DHERMES_ENABLE_TOOLS=OFF -DHERMES_ENABLE_TEST_SUITE=OFF -DHERMES_ENABLE_NAPI=OFF`; the last three because tool/test/napi targets don't configure for iOS).
- **Interpreter baseline** mirrors RN exactly: `hermesc -O -emit-binary` bytecode embedded via `xxd -i`, evaluated through `facebook::hermes::makeHermesRuntime()` + `evaluateJavaScript()` with a `print` host function (`bench/ios/interp_main.cpp`).
- shermes binaries cross-compiled with `CC=clang`, `CFLAGS="-target arm64-apple-ios15.0 -isysroot $SDK …"`, linking `libhermesvm_a.a`, `libjsi.a`, `libboost_context.a`, and a manually iOS-compiled `ConsoleBindings.cpp` (needs `-I external/llvh/include`).
- Signing saga worth recording: the first team's dev cert was **revoked** (OCSP `CSSMERR_TP_CERT_REVOKED` → install error `0xe8008018`), and the second team's wildcard profile didn't include the device. Fix: a throwaway Xcode project (`bench/ios/seed/`) built with `-allowProvisioningUpdates -allowProvisioningDeviceRegistration` (needs a shared scheme + device destination) registered the iPhone and minted a fresh profile; the three apps were then hand-signed with matching `application-identifier` entitlements and installed via `devicectl`.

**Results** (5 runs each, median ms/commit):

| Runtime (iPhone 15 Pro Max) | ms/commit | vs Hermes interp |
|---|---|---|
| Hermes bytecode via `HermesRuntime` (≈ RN today) | 4.92 | 1.0× |
| shermes **untyped** native | 3.08 (first 2 runs 4.4, then stable 3.0–3.1) | **~1.6×** |
| shermes **typed** native | 1.42 (1.37–1.45, tight) | **~3.5×** |

Phase breakdown (one run each, summed over 300 commits):

| Phase | interp | untyped native | typed native |
|---|---|---|---|
| render (alloc) | 732 ms | 495 ms | 277 ms |
| reconcile (diff) | 644 ms | 401 ms | 168 ms |
| commit (walk) | 33 ms | 7 ms | 4 ms |

## Cross-device summary (median ms/commit)

| Device | Hermes interp | untyped AOT | typed AOT |
|---|---|---|---|
| MacBook (M-series) | 5.5 | 3.5–3.9 (~1.5×) | 1.4 (~3.9×) |
| Galaxy S23 Ultra (8 Gen 2) | 7.19 | 6.88 (~1.1×) | 1.97 (~3.6×) |
| iPhone 15 Pro Max (A17 Pro) | 4.92 | 3.08 (~1.6×) | 1.42 (~3.5×) |

**The pattern is stable across all three platforms: typed AOT ≈ 3.5–3.9× over RN's shipping engine; untyped AOT ≈ 1.1–1.6×.** iOS is the platform where this matters most (JIT prohibited, so a JS engine can never close the gap the way V8 does on desktop) — and the A17 Pro runs the typed native benchmark at desktop-M-series speed. The strategic conclusion is unchanged and now empirically grounded on both mobile platforms: **the payoff of full-AOT React Native is real but lives almost entirely in porting the hot path (reconciler + app code) to the typed subset, not in AOT-compiling the existing dynamic bundle.**

**iOS artifacts:** `bench/ios/` — `interp_main.cpp`, `bench_hbc.h`, `bench-{interp,dynamic,typed}-ios`, `AOTBench-{interp,dynamic,typed}.app` (installed on device as `com.aotbench.{interp,dynamic,typed}`), `seed/` (provisioning seed project), iOS build tree `hermes/build_ios/`.

---

## Experiment 4 (2026-08-01): realistic feed-app workload + GC profiling — iPhone 15 Pro Max

Two follow-ups: (a) a larger, realistic typed workload; (b) GC time isolated via `HermesInternal.getInstrumentedStats()` (works in interp, untyped-native, and typed-native — the SH-compiled binaries keep the full Hermes runtime, so the API is present; note `js_gcTime` is in **seconds**, `lib/VM/GCBase.cpp:929`).

**bench2 — the workload** (`bench/bench2-dynamic.js` / `bench2-typed.ts`): a social-feed app with component functions — header/badge/nav, 150 post cards (avatar, author/timestamp column, body, like/comment/share buttons, expandable comments), tab footer; ~2,800 nodes. Per-post **element cache** so unchanged posts return reference-identical elements → React-style bailouts (`bailoutOnAlreadyFinishedWork`); **keyed child reconciliation** (positional fast path + keyed scan); **`subtreeFlags`** so commit walks only dirty subtrees. 2,000 interactions: 70% like-toggle, 20% comments-toggle, 10% prepend-post. Both variants execute the identical algorithm — verified by identical counters (`clones=50163 bailouts=298000 effects=4075`). In typed mode, undeclared globals are `any` (per `-help-typed`), so `HermesInternal` needs no `declare` (which typed mode rejects anyway).

**Results — bench2, 2,000 interactions (median of 3):**

| Runtime | total | ms/interaction | vs interp | render | reconcile | commit | GC time (share) |
|---|---|---|---|---|---|---|---|
| Hermes interp (bytecode) | 443 ms | 0.222 | 1.0× | 366 ms | 57 ms | 7 ms | 7.2 ms (1.6%) |
| shermes untyped native | 261 ms | 0.131 | **1.7×** | 200 ms | 39 ms | 2 ms | 8.9 ms (3.4%) |
| shermes typed native | 120 ms | 0.060 | **3.7×** | 96 ms | 20 ms | 6 ms | 9.1 ms (7.6%) |

**Results — bench1 (full-rebuild, allocation-heavy) GC profile, same device:**

| Runtime | total | numGCs | GC time | allocated | **GC share of total** |
|---|---|---|---|---|---|
| Hermes interp | 1,501 ms | 105 | 862 ms | 366 MB | **57.4%** |
| shermes untyped native | 837 ms | 103 | 425 ms | 366 MB | **50.8%** |
| shermes typed native | 428 ms | 119 | 196 ms | 431 MB | **45.9%** |

**Findings.**

1. **The typed-AOT advantage survives realism: ~3.7×** on a memoized, keyed, bailout-heavy feed app — same ratio as the synthetic full-rebuild benchmark. Untyped AOT improves slightly on realistic code (~1.7×) because cache lookups/keyed scans are more monomorphic than for-in props diffing.
2. **GC is the dominant cost of unmemoized React-style rendering — and typed AOT is also a GC optimization.** In the full-rebuild workload, GC consumes 46–57% of total time in *every* engine. The typed variant allocates *more* bytes (431 MB — fixed 14-field Props objects are bigger than 4-key dynamic objects) yet spends **4.4× less wall-clock in GC than the interpreter** (196 ms vs 862 ms): fixed-layout cells with statically known pointer maps trace much faster than dictionary-shaped objects.
3. **With React-style memoization, GC is a non-issue** (7–9 ms per 2,000 interactions, ~29 MB allocated — constant across engines). The engine gap is then pure compute, and it stays ~3.7×. Corollary for RN: element caching/bailouts (what `React.memo` does) is worth more than any engine change for GC pressure — but the compute win from typed AOT stacks on top of it.
4. Absolute numbers worth keeping in mind: even the interpreter handles a memoized 150-card feed interaction in 0.22 ms — reconciler cost only matters at mount time, on unmemoized trees, or on far larger component counts; that's exactly where the 3.7× and the GC findings bite.

**Artifacts:** `bench/bench2-{dynamic.js,typed.ts}`, iOS apps `com.aotbench.{interp2,dynamic2,typed2}` on device; GC stats also added to bench1 sources and apps (rebuilt/reinstalled).

---

## Experiment 5 (2026-08-01): feed-app workload + GC profiling — Galaxy S23 Ultra

Same bench2 + GC-instrumented bench1 as Experiment 4, cross-compiled with the Experiment-2 NDK recipe, run pinned to the performance cluster (`taskset f0`). Counters again identical across variants.

**bench2 — 2,000 interactions (median of 3):**

| Runtime | total | ms/interaction | vs interp | render | reconcile | GC time (share) |
|---|---|---|---|---|---|---|
| Hermes interp | 503 ms | 0.252 | 1.0× | 468 ms | 60 ms | 14.1 ms (2.8%) |
| shermes untyped native | 315 ms | 0.158 | **1.6×** | 266 ms | 52 ms | 14.0 ms (4.5%) |
| shermes typed native | 175 ms | 0.088 | **2.9×** | 145 ms | 24 ms | 15.3 ms (8.7%) |

**bench1 (full-rebuild) GC profile:**

| Runtime | total | numGCs | GC time | allocated | **GC share** |
|---|---|---|---|---|---|
| Hermes interp | 1,917 ms | 104 | 1,113 ms | 366 MB | **58.1%** |
| shermes untyped native | 1,943 ms | 105 | **1,298 ms** | 366 MB | **66.8%** |
| shermes typed native | 556 ms | 117 | 263 ms | 431 MB | **47.3%** |

**Findings.**

1. **The GC numbers explain Experiment 2's Android anomaly.** Untyped native was worthless on Android bench1 (~1.0× today: 6.48 vs 6.39 ms/commit) because its GC time is actually *worse* than the interpreter's (1,298 vs 1,113 ms; 67% of total). Compiling away interpreter dispatch cannot help when two-thirds of the time is collector work on dictionary-shaped objects — and Snapdragon cores pay far more for that tracing than Apple's.
2. **Typed AOT again cuts GC ~4.2×** (263 vs 1,113 ms) despite allocating 18% more bytes — the fixed-layout-traces-faster effect reproduces on Android.
3. bench2 confirms the realistic-workload ratios: **2.9× typed, 1.6× untyped**, GC negligible (~14 ms) under memoization.

## Final cross-platform picture

| Workload | Device | interp | untyped AOT | typed AOT |
|---|---|---|---|---|
| Full rebuild (ms/commit) | Mac M-series | 5.5 | 3.5–3.9 (1.5×) | 1.4 (3.9×) |
| Full rebuild | S23 Ultra | 6.4–7.2 | 6.5–6.9 (~1.0–1.1×) | 1.85–1.97 (~3.5×) |
| Full rebuild | iPhone 15 Pro Max | 4.9 | 2.8–3.1 (~1.6×) | 1.42 (3.5×) |
| Feed app (ms/interaction) | S23 Ultra | 0.252 | 0.158 (1.6×) | 0.088 (2.9×) |
| Feed app | iPhone 15 Pro Max | 0.222 | 0.131 (1.7×) | 0.060 (3.7×) |
| GC share, full rebuild | S23 Ultra | 58% | 67% | 47% |
| GC share, full rebuild | iPhone 15 Pro Max | 57% | 51% | 46% |

Consistent story on every device and workload: **typed AOT ≈ 3–4× over RN's shipping engine (and ~4× less GC time); untyped AOT ≈ 1–1.7× and can even regress GC.** The win comes from static shapes — unboxed representation, direct field access, fast-tracing fixed layouts — not from removing the interpreter.

**Android device artifacts:** `/data/local/tmp/aotbench/{bench,bench2}-{dynamic,typed}-android`, `bench2-dynamic.js`, updated `bench-dynamic.js` (GC stats).

## Proposed architecture: hash-keyed hybrid AOT + OTA

**Goal:** AOT-level performance while keeping OTA. Changed code runs on the Hermes interpreter; unchanged code runs as prebuilt native.

**Constraint that fixes the design space:** iOS forbids on-device code generation (no JIT, no on-device AOT — executable pages must be signed and non-writable). So OTA'd code can *only* ever run interpreted, and the whole problem reduces to making native and interpreted implementations of the same code interchangeable at some granularity, with a load-time decision per granule.

### Enabler: one VM, two code sources

`HermesRuntime` (hermes/API/hermes/hermes.h:199) implements both ordinary bytecode evaluation (`evaluateJavaScript`) and `IHermesSHUnit::evaluateSHUnit` (hermes/API/jsi/jsi/hermes-interfaces.h:209). AOT-compiled SHUnits and interpreted HBC bytecode execute on the **same VM, same heap, same GC** — a shermes-compiled function and an interpreted function are both just JS closures; callers cannot tell them apart, and no serialization boundary exists. RN already has the consumption hook (`ReactInstance.cpp:276-287`, currently OSS-gated). This is what a dual-engine design (Valdi's QuickJS island, or a "native core + JS engine" split) can never give you.

### Granularity: the Metro module

Metro registers every module as `__d(factory, moduleId)` and resolves via `__r(moduleId)`. That registry is the swap point:

1. **Build time.** A Metro serializer plugin emits (a) the normal HBC bundle, with each `__d` call carrying a **content hash** of the module's post-transform output; (b) each module separately to shermes, compiled *as its own compilation root* (no cross-module inlining, so modules stay independently swappable), all linked into one SHUnit shipped in the app binary. Evaluating that unit registers `global.__nativeModules = { [id]: { hash, factory } }`.
2. **Startup.** Evaluate the SHUnit first, then the current bundle (embedded or OTA). A patched `__d` prelude dispatches: if `__nativeModules[id].hash` equals the hash in the incoming `__d` call, bind the native factory and discard the JS one; otherwise keep the JS factory.
3. **OTA.** Ships plain bytecode as today (CodePush posture, App Store-legal). Unchanged modules keep dispatching to native; changed modules shadow to the interpreter. Correctness is structural: stale native code can never run for a changed module because hash equality is the dispatch condition. Next store release re-bases the native set to 100%.

Performance therefore degrades *proportionally to churn* and never breaks: a hotfix touching 5% of modules keeps 95% native. Fast Refresh in dev is just "everything shadowed" — DX preserved.

### Three rings (where the measured wins map)

| Ring | Contents | Compilation | OTA | Measured payoff |
|---|---|---|---|---|
| 0 | react-reconciler, scheduler, RN core JS, hot utils | **typed** shermes (ported to typed subset) | never (changes only with binary — true today anyway) | **2.9–3.7×, GC ÷4** |
| 1 | product/app modules, vendor libs | untyped shermes, per-module | shadowable per module | 1.6–1.7× while unchanged |
| 2 | OTA-changed modules, dev mode, non-compilable modules (`eval` etc.) | HBC interpreter | n/a | baseline |

Ring 0 is the essential piece: untyped AOT alone is 1–1.7× and *regresses GC on Android* (67% GC share vs interp's 58%), while the reconciler+GC is 40–60% of frame time — and framework internals are precisely the code that never changes via OTA, so pinning them native costs OTA nothing. The typed/untyped boundary should be coarse (reconciler public API) so shermes's boundary checks amortize.

### Correctness notes

- shermes is a Hermes-semantics compiler, so native-vs-interpreted for a given module is observationally equivalent; the swap happens at factory granularity before first `__r`, never mid-execution, so closure/prototype identity is single-sourced.
- Compile granularity = swap granularity: any cross-module optimization would force whole-unit fallback, hence per-module roots for ring 1.
- Native manifest is keyed to the binary version; OTA bundles already are (CodePush model).
- Modules shermes can't compile simply don't appear in the manifest → interpreted. Graceful, not fatal.

### Gaps to build

1. Un-gate/patch shermes SHUnit support in OSS RN (hook exists).
2. Metro serializer plugin: per-module hash embedding + per-module emission + patched `__d` prelude.
3. Build infra: shermes over node_modules-scale code; module hashes make compilation incrementally cacheable.
4. **Typed port of react-reconciler + scheduler** — the big engineering item, and the one carrying most of the 3–4×.
5. Prototype exists in reach: the bench setup (host `shermes_console` + hermesvm) can validate the SHUnit-registry + hash-dispatching-`__d` + interpreted-bundle round trip outside RN in ~a day.

### Experiment 6 (2026-08-01): working prototype — `bench/hybrid/`

The runtime mechanism is **built and validated** on the host. One `HermesRuntime`; two SHUnits baked into the binary (typed `core` = the reconciler port, untyped `util` = a product module); interpreted HBC bundles whose `__d(factory, id, hash)` prelude dispatches per module by content hash. Build pipeline (`build.py`): hash factory sources → codegen registries + bundles → `shermes -typed -O -c -exported-unit=core` / `shermes -O -c -exported-unit=util` → `hermesc -O -emit-binary` → link `main.cpp` + both `.o` with `libhermesvm`, calling `runtime->evaluateSHUnit(sh_export_core/util)` then `evaluateJavaScript(bundle)`.

| Scenario | util binding | core binding | reconciler (300 commits) | 5M tiny cross-calls |
|---|---|---|---|---|
| v1 bundle (fresh install) | NATIVE (hash matched) | NATIVE typed | **~1.42 ms/commit** | 14.0 ns/call |
| v2 bundle (OTA: util changed) | INTERPRETED (hash mismatch; v2 code verifiably runs: `util-v2-hotfix`, checksum 44000096 vs 48000006) | NATIVE typed | ~1.46 ms/commit | 11.6 ns/call |
| v1 bundle, `--no-native` | INTERPRETED | INTERPRETED | ~5.6 ms/commit | ~11 ns/call |

**Validated claims.**
1. **Hash dispatch works and is structurally safe** — the OTA'd module's *new* code demonstrably executes (changed tag + changed checksum) while untouched modules keep their native binding; stale native code cannot run because hash equality is the dispatch condition.
2. **Mixed heap is free** — interpreted app code holds and calls native modules' exports (and vice versa through `require`) with no marshalling; effects counts identical (65,700) across all bindings.
3. **The 3.9× typed win survives the module system** — 1.42 vs 5.6 ms/commit through `require()`d module boundaries, matching the raw bench1 numbers.
4. **Boundary cost ≈ 2–3 ns/call** (14.0 ns interpreted→native vs ~11.5 ns interpreted→interpreted for a trivial `add`). Implication: dispatching *tiny* functions to native buys nothing — the granularity should stay module/subsystem level, which the design already does.
5. **OTA degradation is proportional** — in the v2 scenario only the changed module slowed down; ring 0 kept its full speedup.

**On-device (Galaxy S23 Ultra, pinned `taskset f0`).** Same SHUnit objects cross-compiled via `shermes -c` with the NDK clang as `CC`; the `.hbc` bundles reused unchanged (Hermes bytecode is architecture-independent); host linked statically (`-lhermesvm_a -ljsi -lboost_context` + `libclang_rt.builtins-aarch64-android.a` — the last one needed for `__emutls_get_address`, which the shermes driver normally adds).

| Scenario (S23 Ultra) | util | core | reconciler (300 commits) | 5M tiny cross-calls |
|---|---|---|---|---|
| v1 fresh install | NATIVE | NATIVE typed | **~2.01 ms/commit** | 26–28 ns/call |
| v2 OTA (util changed) | INTERPRETED (v2 code verified) | NATIVE typed | ~2.06 ms/commit | 17.6 ns/call |
| `--no-native` baseline | INTERPRETED | INTERPRETED | ~6.44 ms/commit | ~18 ns/call |

All five claims reproduce on device: hash dispatch correct, mixed heap works (effects=65,700 everywhere), **typed ring 0 is 3.2× through the module system** (2.01 vs 6.44 ms/commit, matching Experiment 2's raw 3.5× within module-call overhead), OTA degradation proportional. Boundary cost is higher on the Snapdragon — ~8–9 ns/call extra for interpreted→native (26–28 vs ~18 ns) vs ~2–3 ns on the Mac — reinforcing that dispatch granularity must stay at module/subsystem level, never per-tiny-function.

**On-device (iPhone 15 Pro Max).** Same SHUnits cross-compiled with `CC="xcrun clang" CFLAGS="-target arm64-apple-ios15.0 -isysroot $SDK …"`; linked against `build_ios` static libs; `ios_main.cpp` runs all three scenarios in one launch (fresh runtime each), reading the unchanged `.hbc` bundles from the app bundle. Packaged/signed as `com.aotbench.hybrid` (same profile/cert as Experiments 3–4), run via `devicectl process launch --console`.

| Scenario (iPhone 15 Pro Max) | util | core | reconciler (300 commits) | 5M tiny cross-calls |
|---|---|---|---|---|
| v1 fresh install | NATIVE | NATIVE typed | **~1.40–1.42 ms/commit** | ~14.4 ns/call |
| v2 OTA (util changed) | INTERPRETED (v2 code verified) | NATIVE typed | ~1.32 ms/commit | ~11.2 ns/call |
| no-native baseline | INTERPRETED | INTERPRETED | ~5.04 ms/commit | ~12 ns/call |

Typed ring 0 is **3.6× through the module system** on the iPhone (1.40 vs 5.04 ms/commit — again matching the raw Experiment 3 numbers), correctness identical (effects=65,700, hotfix code verified), boundary cost ~2–3 ns/call, same as the Mac.

**Prototype summary across all three platforms** — ring-0 reconciler via hash-dispatched `require()`, native vs pure interpreter: Mac 1.42→5.6 ms (**3.9×**), iPhone 15 Pro Max 1.40→5.04 ms (**3.6×**), Galaxy S23 Ultra 2.01→6.44 ms (**3.2×**). The architecture holds its full measured AOT win everywhere while OTA fallback stays per-module and provably correct.

Artifacts: `bench/hybrid/{build.py, main.cpp, ios_main.cpp, runtime/prelude.js, modules/*.factory.js, native/registry-*.template.*}`; host binaries and bundles in `bench/hybrid/out/`; Android copies in `/data/local/tmp/aotbench/{hybrid-android, bundle-v1.hbc, bundle-v2.hbc}`; iOS app `com.aotbench.hybrid` (`bench/hybrid/out/AOTBench-hybrid.app`).

### Experiment 7 (2026-08-01): SHUnit registry inside a real React Native app — RNTester on Galaxy S23 Ultra

The hybrid mechanism now runs **inside React Native itself**, not just a standalone host. Setup:

- **RN + Hermes from source, same-day checkouts (2026-07-31).** RNTester built with `REACT_NATIVE_OVERRIDE_HERMES_DIR=<our hermes>` and `-Preact.internal.useHermesNightly=false` (the repo defaults to prebuilt Hermes nightlies from Maven, which silently skips the source build). RN's gradle builds Hermes with `-DHERMESVM_HEAP_HV_MODE=HEAP_HV_PREFER32` → **compressed pointers**, a different SHUnit ABI than our standalone build — the registry units were recompiled with `shermes -c` against the gradle-generated `libhermesvm-config.h`.
- **Patch 1 — `ReactCommon/react/runtime/ReactInstance.cpp`:** upstream's SHUnit hook is either/or (SHUnit *replaces* the bundle). Added an additive path: weak-linked `sh_export_core`/`sh_export_util` are evaluated via `IHermes::evaluateSHUnit` *before* the normal `evaluateJavaScript(bundle)`.
- **Patch 2 — `ReactAndroid/src/main/jni/CMakeLists.txt`:** links the registry `.o` files into `libreactnative.so` (arm64-only, guarded by `EXISTS`) plus `hermes-engine::hermesvm` — the `.o`s introduce libreactnative's first direct `_sh_*` references and the link runs with `-Wl,--no-undefined` (first attempt failed exactly there). Verified: `llvm-nm -D libreactnative.so` shows `T sh_export_core` / `T sh_export_util`.
- **JS demo** (`packages/rn-tester/js/HybridAOTDemo.js`, imported from the RNTester entry): consumes `global.__nativeModules` and races the native-typed reconciler against the identical bundle-JS implementation.

Logcat from the live RNTester app (dev-mode Metro bundle, unpinned cores):

```
ReactNativeJS: [HybridAOT] registry present, modules: core, util
ReactNativeJS: [HybridAOT] util (hash 05ff34003c): tag=util-v1 checksum(1e6)=48000006
ReactNativeJS: [HybridAOT] core impl=native-typed (hash 35059407b8)
ReactNativeJS: [HybridAOT] NATIVE-TYPED reconciler: 300 commits, effects=65700, 576 ms (1.920 ms/commit)
ReactNativeJS: [HybridAOT] BUNDLE-JS     reconciler: 300 commits, effects=65700, 1719 ms (5.730 ms/commit)
ReactNativeJS: [HybridAOT] speedup: 2.98x
```

**Findings.** (1) shermes-compiled typed code executes inside a production-shaped RN runtime (bridgeless/Fabric, TurboModules, dev bundle via Metro) on the same heap as the app bundle — `3.0×` on unpinned cores, consistent with the pinned standalone 3.2×. (2) The integration surface is tiny: ~20 lines in ReactInstance.cpp + ~10 lines of CMake; the `evaluateSHUnit` plumbing upstream already exists. (3) The ABI discipline the design requires is real and manageable: SHUnits must be compiled against the exact VM config of the app's Hermes (compressed pointers tripped the first attempt) — in production this is automatic because the Metro/shermes plugin and the app build share one Hermes.

Remaining for a production system (unchanged): the Metro serializer plugin for per-module hashes + `__d` dispatch (the demo calls factories via `__nativeModules` directly), and the typed react-reconciler port.

### Experiment 8 (2026-08-01): Metro serializer plugin — the full pipeline, automated

The last missing mechanism is built: modules now reach native dispatch through **ordinary `require()` calls in an unmodified Metro bundle flow**, with the hash plumbing fully automated.

**The plugin** (`packages/rn-tester/hybrid-serializer.js`, wired into `metro.config.js` via `serializer.createModuleIdFactory` + `serializer.customSerializer`):
1. **Stable module IDs** — sha1(project-relative path) truncated to 32 bits (collision-checked), replacing Metro's traversal-order numeric IDs so the native manifest stays valid across OTA bundle rebuilds.
2. **Content hashes** — sha256 of each module's transformed factory code (`output.data.code`, the `__d(function...)` wrapper before IDs are appended), emitted as a `__moduleHashes` table plus a `__d` wrapper in `bundle.pre` that binds a module to `global.__nativeModules[id].factory` iff hashes match, recording every decision in `__hybridBindings`. (Production would embed the hash per `__d` call instead of a table.)
3. **`hybrid-manifest.json`** — `{id: {hash, path, code}}` for all 794 RNTester modules, the input to registry codegen. Metro 0.87 note: internals import as `metro/private/...` (the `exports` map), with `.default` interop.

**Registry codegen** (`bench/hybrid/build-rn-registry.py`): reads the manifest; ring 1 (`HybridUtil`) compiles the **verbatim transformed Metro factory** with untyped shermes — zero manual work; ring 0 (`HybridCoreReconciler`) registers the typed reconciler port under the JS twin's ID + hash behind a Metro-signature factory. Both compiled against the gradle Hermes config into the same `.o` names the CMake/ReactInstance patches already consume.

**On-device round trip** (RNTester *release* builds — bundle built by gradle through the same metro.config.js, compiled by hermesc, embedded in APK; Galaxy S23 Ultra, unpinned):

| Pass | dispatch decisions | core.impl | reconciler (300 commits) |
|---|---|---|---|
| Fresh install | both `native` | native-typed | **587 ms (1.957 ms/commit)** |
| OTA hotfix (both modules edited, JS-only rebuild) | both `shadowed-ota-changed` | interpreted-dynamic-v2 | 1,121 ms (3.737 ms/commit) |
| Hotfix reverted, rebuilt | both `native` | native-typed | 590 ms (1.967 ms/commit) |

The OTA pass proves the safety story end to end: stable IDs survive the rebuild, hash mismatch shadows exactly the changed modules, the *new* code demonstrably runs (`util-v2-hotfix`, checksum 44000096 vs 48000006), and reverting re-binds native with reproducible timings. Even "never-OTA" ring 0 degrades gracefully rather than breaking. In-app release-mode speedup for the typed reconciler: **1.9×** (3.74 → 1.96 ms/commit) — lower than the pinned standalone 3.2× because the release bundle's interpreter baseline is much faster than dev (hermesc -O + release transforms) and cores are unpinned; the standalone pinned numbers remain the upper bound.

**iOS (iPhone 15 Pro Max), same pipeline through RNTester's Xcode/CocoaPods flow:** pods with `RCT_BUILD_HERMES_FROM_SOURCE=true REACT_NATIVE_OVERRIDE_HERMES_DIR=<hermes>`; the pod-built `hermesvm.framework` exports all 134 `_sh_*` symbols (nm caveat: Mach-O prefixes C symbols with `_`, so grep `__sh_`), and iOS Hermes builds **without** compressed pointers — a different SHUnit ABI than Android, so the registry units are recompiled against `Pods/hermes-engine/build/iphoneos/lib/config`. The `.o`s are injected via `OTHER_LDFLAGS` in `Pods-RNTester.release.xcconfig`; the ReactInstance patch needed `__attribute__((weak_import))` on Apple (plain `weak` declarations don't create Mach-O weak references — pass 1 failed at ld64 exactly there). Release-build note: `RCTLog` is compiled out in release, so the demo logs through a `__hybridLog` jsi host function installed by the patch (glog → stderr → `devicectl --console`).

| Pass (iPhone 15 Pro Max, RNTester Release) | dispatch | core.impl | reconciler (300 commits) |
|---|---|---|---|
| Fresh install | both `native` | native-typed | **485 ms (1.617 ms/commit)** |
| OTA hotfix (JS-only rebuild) | both `shadowed-ota-changed` | interpreted-dynamic-v2 | 1,365 ms (4.550 ms/commit) |

In-app release speedup on iPhone: **2.8×** (4.55 → 1.62 ms/commit), with the native-side log trail visible in the console (`ReactInstance: hybrid AOT evaluateSHUnit(core/util)` followed by normal bundle evaluation).

**All four mechanisms of the proposed architecture are now implemented and validated on device:** SHUnit registry in the app binary (Exp 6–7), additive `evaluateSHUnit` in ReactInstance (Exp 7), the Metro serializer plugin with stable IDs + hashes + dispatch (Exp 8), and per-module OTA fallback with structural correctness (Exp 6, 8). What remains for production is engineering scale-out, not mechanism: hash-per-`__d`-call encoding, a build orchestrator (two-pass today: bundle → registry codegen → app build), ring-1 module selection policy, and the typed react-reconciler port for the real ring 0.

### Experiment 9 (2026-08-01): typed react-reconciler port — fiber architecture in the typed subset

`bench/reconciler/mini-react-typed.ts` (+ algorithm-identical dynamic twin `mini-react-dynamic.js`) ports the reconciler's real architecture — not the bench1 toy — to the shermes typed subset: **function components with a persistent hooks list (`useState` with stable setter closures and dirty bits), memo bailouts that reuse the current subtree and skip it in the work loop (React's `bailoutOnAlreadyFinishedWork`), two-pass keyed child reconciliation (`reconcileChildrenArray` reduced), host-prop diffing, child/sibling/return work loop, commit phase walking + clearing effect flags.** Workload: a 150→200-post feed app driven by 2,000 seeded interactions (70% like-toggles through cached press handlers, 20% content edits, 10% keyed prepends with list cap). Parity verified: both variants produce renders=5683, bailouts=388531, placements=1144, updates=7080, deletions=98, effects=8436, checksum=2467130.

| Runtime | Mac (host) | iPhone 15 Pro Max | S23 Ultra (pinned, median of 3) |
|---|---|---|---|
| Hermes interpreter | 0.336 ms/interaction | 0.328 | 0.580 |
| shermes untyped native | 0.268 (1.25×) | 0.267 (1.23×) | 0.537 (1.08×) |
| shermes typed native | **0.221 (1.52×)** | **0.193 (1.70×)** | **0.396 (1.46×)** |

**Why 1.5–1.7×, not 3–4×:** this workload is what the reconciler hot path actually looks like in a well-memoized app — **bailout-dominated** (388k bailouts vs 5.7k renders). The bailout path is prop-equality checks + pointer chasing, where typed layouts help moderately; the 3–4× shows up when render/diff/alloc dominates (bench1's full rebuilds, bench2's clone-heavy commits). Both are real: the composite picture is ~1.5–1.7× on already-optimized screens and 3–4× on render-heavy ones — and the *worst frames* (mounts, list resets, heavy updates) are precisely the render-heavy ones users notice.

**Porting-cost findings (the typed-subset catalog):**
1. `new Map<K,V>()` in typed mode produces a construct whose methods are missing at runtime — use the untyped global (`const G: any = globalThis; new G.Map()`).
2. Array methods (`push/slice/pop/unshift`) work on typed arrays **in typed context** but NOT through `any`-typed dynamic dispatch; `.length = 0` assignment is rejected on typed arrays.
3. Heterogeneous data (hook state, handler caches) types as `any` cleanly; closures, classes, recursion, ternaries all port directly.
4. Two genuine reconciler bugs were caught by the parity counters during the port (work loop descending into bailed-out subtrees; press handlers capturing stale state instead of functional updates) — the counter-parity discipline is essentially free verification.
5. Port effort: the full fiber hot path is ~700 lines typed; a few hours including debugging. Extrapolating to real react-reconciler's hot path (beginWork/completeWork/commitWork/childReconciler for the common tags) is weeks, not months — and mechanical once the subset rules above are known.

Android note: the platform pattern from earlier experiments repeats on the reconciler workload — untyped AOT is nearly worthless on the Snapdragon (1.08×) while typed reaches 1.46×; typed allocates 11% less (277 vs 310 MB) with fewer GCs (78 vs 86). Parity counters identical on device.

### Experiment 10 (2026-08-01): the real react-reconciler hot path, ported and checksum-verified

`bench/reconciler/real/` closes the loop: the **actual `react-reconciler@0.29.2` npm package (React 18.3.1)** runs on Hermes as the baseline, and `typed-port-core.ts` is a port of its hot path whose equivalence is **proven by an identical host-mutation stream** — a recording host config hashes every createInstance/append/insertBefore/removeChild/commitUpdate/commitTextUpdate including diff payloads, and all three variants produce the same op counts (572 creates, 429 text creates, 858 appends, 143 inserts, 98 removes, 3,540 updates, 3,540 text updates) and the same rolling checksum **4174768215** across 2,050 sync flushes, on every platform.

**What the port covers (following the React source structure):** FiberNode + `createWorkInProgress` double buffering (alternate reuse — this is why the real reconciler allocates so little), lanes/childLanes with `markUpdateLaneFromFiberToRoot` and the `bailoutOnAlreadyFinishedWork` childLanes-skip, dispatcher-based hooks (`useState`/`useCallback`) with circular pending update queues, functional updates via `basicStateReducer`, and the eager-state bailout, `SimpleMemoComponent` with `shallowEqual`, the full two-pass keyed `reconcileChildrenArray` with `lastPlacedIndex` placement and map-based moves, `completeWork` with host-config `prepareUpdate` diffing and `bubbleProperties`, and the mutation commit phase — deletions-first recursion over `subtreeFlags`, `commitPlacement` with the real `getHostSibling` traversal. Reduced surface: sync lane only, no context/suspense/refs/effects. The **app stays fully dynamic** (object-literal props, for-in diffs) — only the reconciler is typed, which is exactly the production ring-0 shape.

| Runtime (medians; identical checksum everywhere) | Mac | iPhone 15 Pro Max | S23 Ultra (pinned) |
|---|---|---|---|
| real react-reconciler, Hermes interpreter | 0.506 ms/interaction | 0.500 | 0.702 |
| real react-reconciler, shermes untyped native | 0.394 (1.28×) | 0.381 (1.31×) | 0.591 (1.19×) |
| **typed port, native** | **0.284 (1.78×)** | **0.288 (1.74×)** | **0.419 (1.68×)** |

**Findings.**
1. **The equivalence harness works and is the port's real safety net**: any semantic divergence (placement order, diff payload, bailout behavior) breaks the checksum immediately. The port matched on its first complete run.
2. **1.7–1.8× on the real reconciler with a fully dynamic app** — the typed win survives dynamic props at the boundary (shallowEqual and host diffing run over `any`). Untyped AOT of the real reconciler is again marginal on Android (1.19×).
3. **GC parity**: the real reconciler's double buffering means neither variant is GC-bound (~9–10 ms GC, ~300 MB allocated both) — the typed win here is pure compute, unlike the full-rebuild benches where GC dominated.
4. **Port cost, measured**: the hot-path core is ~1,100 lines of typed TS written and verified in one session. The earlier "weeks" estimate holds for the full feature surface (context, suspense, effects, priorities), not the hot path.
5. New typed-subset rules learned: object-literal fields initialized to `null` freeze as null-type (build such objects dynamically); `as`-casts are unreliable (use null-guards); calling typed functions through `any` with fewer arguments works (missing → undefined); for-in and computed access over typed literals through `any` work.

Artifacts: `bench/reconciler/real/{host-config.inc.js, feed-app.inc.js, typed-port-core.ts, typed-main.ts, main-real-body.js, build-real.sh, build-typed.sh}`; binaries `real-react-{native,android,ios}`, `typed-port-{native,android,ios}`, interp apps `com.aotbench.rr{interp,native,typed}` on the iPhone, Android binaries in `/data/local/tmp/aotbench/`.

### Experiment 11 (2026-08-02): the typed reconciler port as ring 0 inside React Native

The final integration: the checksum-verified port from Experiment 10 is now the hybrid's ring 0 inside RNTester, in the exact production shape — **the bundle's JS twin is the real react-reconciler itself** (`HybridReactCore.js`: react 18.3.1 + react-reconciler 0.29.2 + the shared benchmark, esbuild'd into one 194 KB Metro module exposing `{impl, run()}`), and the app binary registers the **typed port** under that module's id + content hash through the same SHUnit/`__d`-dispatch machinery. Equivalence between twin and port is established at build time by the Experiment-10 checksum harness — precisely how ring 0 is meant to work.

**On-device round trips (RNTester Release, in-app, unpinned; identical host checksum 4174768215 in every cell):**

| Pass | binding | what actually ran | S23 Ultra | iPhone 15 Pro Max |
|---|---|---|---|---|
| Fresh install | `native` | **typed port, native** | **0.517 ms/interaction** | **0.309** |
| OTA hotfix (twin edited, JS-only rebuild) | `shadowed-ota-changed` | **real React 18.3.1, interpreted** | 0.771 | 0.540 |
| Hotfix reverted | `native` | typed port, native | 0.519 | 0.310 |

In-app speedups — typed-port-native vs real-React-interpreted, inside a live RN app with the RNTester UI running: **1.49× (Android), 1.75× (iPhone)** — matching the pinned standalone numbers (1.68× / 1.74×). The `util` ring-1 module kept its native binding through every core hotfix (per-module fallback intact), and the host-mutation checksum matching across native/interpreted *inside the app* is the strongest correctness statement in this investigation: the OTA fallback and the native fast path are observably the same reconciler.

**Build-pipeline lessons for production:** (1) the manifest→registry ordering bit us once — a registry compiled against a stale manifest (post-hotfix hash) would have silently unbound ring 0; hash-mismatch is fail-safe (falls back to interpreter) but a real orchestrator must sequence bundle→manifest→registry→link. (2) Log channels differ per platform in release builds (Android: `console.*`→logcat, glog→stderr lost; iOS: the reverse), hence the demo logs through both.

Artifacts: `bench/reconciler/real/{rn-core-js-body.js, rn-core-typed-body.template.ts, build-rn-twin.sh}`, generated twin `packages/rn-tester/js/hybrid/HybridReactCore.js`, updated `bench/hybrid/build-rn-registry.py` (assembles ring 0 from the real-port sources; `--ios` for the pod-config units).

### Experiment 12 (2026-08-02): Fabric-shaped host layer — persistence mode + typed diffProperties

Two steps toward the real Fabric host config, both checksum-verified. (Alongside: all patches are now committed — RN branch `hybrid-aot` + `bench/patches/react-native-hybrid-aot.patch`, and the AOT-RN workspace is a git repo — and `bench/hybrid/orchestrate.py` enforces the full pipeline with a built-in equivalence gate: twin-vs-typed-port checksums must match before any registry ships.)

**1. Persistence mode.** Fabric's host contract is clone-based (`cloneNodeWithNewProps`, container child sets, `completeRoot`), not mutation. The typed port now implements React's persistent paths — gated on `supportsMutation`/`supportsPersistence` consts exactly as React gates them — including `hadNoMutationsEffects`, persistent `updateHostComponent` (reuse/clone/re-append decision tree), per-change `HostText` re-creation, `updateHostContainer` child-set construction, and the commit-time container swap. Verified against the real react-reconciler in persistence mode on the same feed workload: **identical checksum 2635835858** (7,397 clones, 402,183 child appends, 2,000 child sets/replaces). The first attempt used fiber-identity for `childrenUnchanged` and produced 3,714 excess clones — **the checksum harness caught a real semantic divergence** (React uses subtree effect-flags, not fiber identity), which is precisely the fidelity net working.

| Persistent mode (host, medians) | ms/interaction | vs interp |
|---|---|---|
| real react-reconciler, interpreter | 0.548 | 1.0× |
| real react-reconciler, untyped native | 0.422 | 1.30× |
| **typed port, native** | **0.293** | **1.87×** |

Persistence costs everyone more than mutation mode (Fabric's real profile: clone + re-append traffic), and the typed port gains slightly *more* here (1.87× vs mutation's 1.78×) — clone/child-set work is fiber-structure traversal, exactly where typed layouts pay.

**2. Typed `diffProperties`.** RN's real payload diffing (`ReactNativeAttributePayload.diff` + `flattenStyle` + `deepDiffer`, the function Fabric's `cloneInstance` consumes) ported to the typed subset, with the verbatim type-stripped original as baseline. Seeded ViewConfig-shaped workload (nested style configs, custom `process`/`diff` attributes, identity-shared styles, key removal/restore, style-array growth): **identical deep payload checksum 1647276060** across 100k diffs.

| diffProperties (host, medians) | µs/diff | vs interp |
|---|---|---|
| real algorithm, interpreter | 1.61 | 1.0× |
| real algorithm, untyped native | 1.09 | 1.48× |
| typed port, native | 1.03 | 1.56× |

**Finding:** diffProperties is boundary-dynamic code — arbitrary app props traversed via for-in — so types add little over plain native compilation (1.56× vs 1.48×). This sharpens the architecture's rule of thumb: **type the structures the framework owns (fibers, hooks, queues, clone trees → 1.8–1.9×); the dynamic app boundary gets its ~1.3–1.5× from untyped AOT alone.** For the real Fabric integration, the remaining step is binding these to `global.nativeFabricUIManager` (createNode/cloneNode*/completeRoot) in an RN app surface.

Artifacts: `bench/reconciler/real/{main-real-persistent-body.js, build-real-persistent.sh, build-typed-persistent.sh, diffprops-shared.inc.js, diffprops-real-body.js, diffprops-typed-body.ts}`; persistent paths in `typed-port-core.ts`; orchestrator `bench/hybrid/orchestrate.py`.

### Experiment 13 (2026-08-02): the typed reconciler drives a LIVE Fabric surface — `nativeFabricUIManager` bound

The last gap between the harness and the real thing is closed: the typed persistent reconciler now renders **real native views** through Fabric's C++ UIManager binding, on both phones, with touch working — and OTA still swaps it for the interpreted real React on the same screen.

**How it's wired.** A new glue module (`js/HybridFabricDemo.js`) registers a runnable that takes over RNTester's root surface (ReactFabric never runs): it resolves real view configs from `ReactNativeViewConfigRegistry` (RCTView/RCTText/RCTRawText), registers the touch handler via `nativeFabricUIManager.registerEventHandler`, and hands an env to the ring-0 core module `js/hybrid/HybridFabricCore.js`. That module's JS twin is the real react-reconciler in persistence mode; the binary registers the typed port under its content hash. Both drive the identical host layer (`fabric-host.inc.js`), which maps the port's seven persistent host ops onto the binding exactly as RN's shipped renderer does — `createNode(tag, viewName, rootTag, payload, fiber)` with the fiber as `instanceHandle`, `cloneNodeWithNewProps`/`WithNewChildren`/`WithNewChildrenAndProps` chosen by (keepChildren × payload), zero-arg `createChildSet`, `appendChildToSet`, and commit-phase `completeRoot(rootTag, childSet)`. Payloads come from the Exp-12 diffProperties ports (typed in the unit, verbatim RN algorithm in the twin) against the real ViewConfig `validAttributes` — so style flattening and `processColor` run for real. Touch events arrive from C++ with the creating fiber as target; a fiber-walk to the nearest `onPress` (stable via `useCallback`) completes the loop.

**What happened on device.** The demo app (header + 30 memoized rows; each tick moves a highlight and rewrites the header text; taps toggle a selection) mounted through 63 `createNode` calls + 1 `completeRoot`, ticks live, and answers taps — screenshot-verified on the S23 (`adb input tap` on Row 3 → row turns blue, header shows "selected 3") in BOTH modes. Every commit is exactly: 1 text create, 5 clones, 33 appends, 1 child set + 1 `completeRoot` — **identical op streams from the typed port and the real reconciler**, the checksum-equivalence result now holding against the real C++ host.

| Live Fabric commits (1000 measured, on device) | ms/commit | vs interp |
|---|---|---|
| S23 Ultra — interpreted real React (OTA mode) | 0.473 | 1.0× |
| S23 Ultra — **typed unit** | **0.358–0.364** | **~1.31×** |
| iPhone 15 Pro Max — interpreted real React (OTA mode) | 0.232 | 1.0× |
| iPhone 15 Pro Max — **typed unit** | **0.147** | **1.58×** |

The ratio is lower than the host-only 1.87× because each commit now includes Fabric's invariant C++ share (RawProps parsing, ShadowTree commit, Yoga) — the typed win applies to the JS slice only. That is the honest number for "reconciler AOT in production": **~24% (Android) to ~37% (iPhone) off every UI commit**, with the app code untouched and OTA intact — the round trip (typed → OTA-edit → interpreted real React on the same live screen → restore → typed again) was exercised on both phones, per-module: while `fabriccore` was shadowed, the other two units stayed native.

**Pipeline lesson, again.** The stale-manifest trap bit a second time: running `build-rn-registry.py` by hand after the OTA bundle pass baked the OTA hash into the units, silently unbinding ring 0 after the restore. Re-running `orchestrate.py --ios` (which orders twin → bundle → registry → gate) fixed it — registry codegen should only ever run through the orchestrator.

Artifacts: `bench/reconciler/real/{fabric-host.inc.js, fabric-app.inc.js, fabric-core-js-body.js, fabric-core-typed-body.template.ts, build-fabric-twin.sh}`; glue `packages/rn-tester/js/HybridFabricDemo.js`; third SHUnit (`fabriccore`) in `ReactInstance.cpp`/CMake/xcconfig; fabric unit assembly in `build-rn-registry.py`. Host-op signatures gained instance/fiber params (`diffHostProps(old, new, inst)`, `hcCreateInstance(type, props, fiber)`, `hcCreateTextInstance(text, fiber)`) — both equivalence gates re-verified after the change (4174768215 mutation, 2635835858 persistent).

### Experiment 14 (2026-08-02): hash-per-`__d`-call encoding + ring-1 selection policy

Two production-shape upgrades to the dispatch pipeline, both validated on-device on both phones.

**1. Hash per `__d` call.** The `__moduleHashes` table is gone: the serializer now appends each module's content hash as a trailing argument to that module's own `__d(factory, id, deps, hash)` call, and the dispatch prelude reads it from the call. A module is now self-describing under module-level delivery — OTA patches and delta/HMR bundles ship bare `__d` calls without the bundle prelude, and the native-vs-interpreted decision still works. All 796 RNTester modules carry their hash inline; no bundle-global state beyond the wrapper itself.

**2. Ring-1 selection policy.** Ring 1 is no longer a hardcoded module: `build-rn-registry.py` applies a policy (`^js/` — the app's product code — minus the two ring-0 twins) over the manifest, **probes every candidate with an isolated untyped shermes compile** (8-way parallel, results cached by content hash), batches the passes into a single `ring1` SHUnit, and leaves failures interpreted (ring 2 by construction). On RNTester: **257/257 Android and 264/264 iOS candidates compile** — zero probe failures across the entire app, ~2 MB of transformed JS per platform → 6.5 MB (Android) / 7.0 MB (iOS) of `.o`. The formerly hardcoded `HybridUtil` unit is retired; it now flows through the policy like any other app module.

On device: **Android native=259, iOS native=266, zero shadowed** — every eligible module dispatches to its compiled factory; the app boots clean and the live Fabric surface is unaffected (0.359 / 0.147 ms/commit, typed). Single-module OTA within ring 1 verified end-to-end: editing one app module (`HybridUtil.js` → `util-v2-OTA`) flipped exactly that module to `shadowed-ota-changed=1` running its **updated** interpreted code, while the other 258 stayed native.

**Finding: ring-1 units must be per-platform.** The first iOS run (units compiled from the Android manifest) showed 28 of 245 modules correctly fail-safed to interpreted — Metro transforms are platform-specific (`Platform.OS` inlining, `.android`/`.ios` variants), so hashes legitimately differ. The pipeline now does two bundle passes (`hybrid-manifest-android.json` / `hybrid-manifest-ios.json`) and compiles each platform's units against its own manifest; the probe cache keeps the double pass cheap. This also re-demonstrated the fail-safe doing its job on *legitimately different* content, not just OTA edits.

Open cost question (unmeasured): startup evaluation of the 6.5 MB ring-1 unit and its binary-size impact vs the interpreter's lazy bytecode — a production policy would likely rank modules by hotness/size instead of compiling everything that passes the probe; the knobs are in place (`RING1_INCLUDE`/`RING1_EXCLUDE`).

Artifacts: per-call hash in `hybrid-serializer.js`; policy/probe/per-platform units in `build-rn-registry.py`; per-platform manifest passes in `orchestrate.py`; `ring1` SHUnit replaces `util` in `ReactInstance.cpp`/CMake/xcconfig; grouped dispatch log in `HybridAOTDemo.js`.

### Experiment 15 (2026-08-02): typed reconciler feature surface — hooks, context, effects, refs

The typed port now covers the "every real app uses these" React surface, each piece verified against the real react-reconciler on a feature-extended workload in BOTH host modes: **useReducer / useMemo / useRef**, **createContext / useContext / Provider** (value stack, `readContext` dependency lists, `propagateContextChange` through memo-bailed subtrees), **useEffect / useLayoutEffect** (circular effect lists, HookFlags, mutation-phase layout destroys, layout-phase mounts, deletion-inline destroys, `flushPassiveEffects` with React's exact flush points — start of `flushSync`/`performSyncWorkOnRoot`, sync-callback flush at the end of passive and commit for effect-scheduled setState), and **host refs** (object + function, `Ref` flag, mutation-phase detach / layout-phase attach, deletion detach).

**Verification got a second axis.** The recording host only sees host mutations; effects/memo callbacks are invisible to it. The workload now feeds `fx` — an app-level rolling checksum mixed by every effect create/destroy and memo recompute in call order — printed alongside the host checksum and enforced by the orchestrator gate. The extended feed app exercises: theme context toggles consumed by 200 memoized cards, reducer + memo + ref in the header, four effect flavors with cleanups (including effects on cards that mount/unmount with the feed), a layout-effect setState and a passive-effect setState (commit-tail and passive-tail sync flush paths), and a stable function ref on the footer.

Result: **all four accumulators identical** — mutation mode `checksum=2539688126 fx=796176228`, persistence mode `checksum=2086907373 fx=796176228` (77,928 clones — context propagation drives heavy clone traffic through memo bailouts), reproduced on-device on both phones.

**The harness caught two real bugs on the way:**
1. Three typed-subset freezes (new catalog entry): class fields mutated only through `any`-references (`FCUpdateQueue.lastEffect`, effect `next`/`destroy`, `context._currentValue`, `ref.current`) compile as frozen — such structures must be `mkObj()` dynamics, not classes.
2. A genuine semantic divergence: `bubbleProperties` must bubble only *static* flags when the fiber **bailed out** (`didBailout` — React's exact rule); bubbling child flags unconditionally leaks stale `Ref`/`Passive`/`Update` flags into `subtreeFlags` and re-fires ref attaches and effects on bailed subtrees. Host stream stayed identical; only `fx` exposed it — the second axis paying for itself immediately.

| Extended workload (2000 interactions) | interp | untyped native | typed native |
|---|---|---|---|
| mutation mode, host (ms/int) | 0.750 | 0.556 (1.35×) | **0.409 (1.84×)** |
| persistence mode, host (ms/int) | 0.826 | — | **0.477 (1.73×)** |
| S23 Ultra, in-app ring 0 (ms/int) | 1.108 (OTA) | — | **0.697 (1.59×)** |
| iPhone 15 Pro Max, in-app ring 0 (ms/int) | 0.764 (OTA) | — | **0.443 (1.72×)** |

The typed advantage holds with the full feature surface (1.84× vs Exp 10's 1.78× on the plain workload) — effect bookkeeping and context propagation are fiber-structure work, exactly where typed layouts pay. Live Fabric surface unaffected (persistent consts still flip cleanly; 0.368/0.162 ms/commit). Still not ported: Suspense/lazy, insertion effects, forwardRef, class components, concurrent lanes.

Artifacts: hooks/context/effects/refs in `typed-port-core.ts` (+~600 lines); extended `feed-app.inc.js` (+fx checksum, trace mode, env-tunable driver); all five harnesses pass the full RA surface + explicit `flushPassive`; orchestrator gate compares `checksum` AND `fx`.

*(Follow-up polish: the live-Fabric takeover surface now handles system bars itself — `StatusBar.setBarStyle` + real status-bar inset + bottom-inset padding with list clipping, passed through `env.insetTop/insetBottom` — since RNTester's AppContainer/safe-area plumbing never runs under the takeover; previously content drew behind the Android gesture bar. A production integration would plumb real WindowInsets through the surface.)*

### Experiment 16 (2026-08-02): ring-1 cost model — measured, and answered with profile-guided selection

The open question from Experiment 14: what does compile-everything ring 1 actually cost, and what should a production policy compile? Both halves answered on-device.

**The costs, measured (Android arm64, stripped `libreactnative.so` / release APK; iOS app binary).** Instrumentation: `std::chrono` around each `evaluateSHUnit` in ReactInstance, exposed to JS as `global.__hybridEvalMs`.

| ring-1 variant | modules | lib / binary | APK | Δ vs none | ring1 eval |
|---|---|---|---|---|---|
| Android — none | 0 | 7,273,184 | 21,899,886 | — | — |
| Android — profiled | 199 | 10,835,960 | 25,462,662 | **+3.56 MB** | 1.4 ms |
| Android — full | 257 | 11,400,648 | 26,027,350 | **+4.13 MB** | 1.1 ms |
| iOS — profiled | 204 | 16,608,352 | — | −0.78 MB vs full | 0.9 ms |
| iOS — full | 264 | 17,385,648 | — | — | 1.6 ms |

Two findings kill one worry and confirm the other:
- **Startup eval is a non-issue**: evaluating a ~250-module, 6.5 MB unit takes ~1 ms — unit evaluation only registers factory closures in `__nativeModules`; the code pages mmap in on demand. No lazy-eval disadvantage vs bytecode worth engineering around.
- **Binary size is THE cost**: ~2.0× the transformed JS source on Android (4.13 MB for 2.07 MB of JS), ~2.7–3.7× marginal per module. Every module compiled that never executes is pure dead weight.

**The policy: profile-guided selection (PGO-lite).** The dispatch prelude now wraps each factory to record which modules actually EXECUTE (first require), in order — stable path-hash ids make the profile durable across builds. The demo dumps the profile to the log; extracted into `bench/hybrid/profiles/rn-tester-startup-<platform>.json`; `build-rn-registry.py` then compiles only executed candidates per platform (`--ring1-all` overrides; missing profile falls back to compile-all, which is exactly what a capture run needs). The cold tail stays ring 2 — the interpreted fallback IS the lazy path.

On RNTester: 199/257 (Android) and 204/264 (iOS) candidates executed at startup — a modest 22% drop (0.56 MB), because RNTesterList eagerly imports every example screen; **RNTester is a worst case for this policy**. An app with lazy navigation would shed most of its screens' native weight while keeping the startup path compiled. Validated on both phones: `native=201/206`, everything boots, fabric surface unchanged (0.355 / 0.149 ms/commit).

Bonus fail-safe sighting: mid-experiment, a bundle newer than the unit correctly showed `shadowed-ota-changed=1 (js/HybridAOTDemo.js)` — the hash dispatch protecting against a stale unit yet again.

Artifacts: eval timing + `__hybridEvalMs` in `ReactInstance.cpp`; execution recorder in `hybrid-serializer.js` prelude; profile dump in `HybridAOTDemo.js`; `load_profile`/selection in `build-rn-registry.py`; checked-in profiles under `bench/hybrid/profiles/`; ring-1 `.o` now independently optional in CMake.

### Experiment 17 (2026-08-02): the real-app trial — HybridShop

Everything before ran on RNTester's example registry or synthetic benchmarks. This experiment puts a real app shape through the full pipeline: **HybridShop** (`packages/rn-tester/js/hybridshop/`, 13 modules) — a FlatList catalog over a fake async API (constant 80 ms latency), hand-rolled stack navigation whose detail/cart/settings screens are `require()`d **lazily** on first open, theme context, memoized components, images — rendered through the NORMAL RN pipeline (ReactFabric; the takeover demo is flag-parked). A deterministic auto-pilot drives a session and logs timings: TTI (bundle-eval start → feed rendered with data), first-open per lazy screen, theme-toggle, refresh bursts.

**The whole bundle compiles.** Ring-1 policy widened from `^js/` to everything: **807/807 (Android) and 811/811 (iOS) modules pass the compile probe** — all of RN core, the shipped ReactFabric renderer, node_modules, babel helpers. Zero failures. The full unit: 14.8 MB `.o` per platform.

**Android matrix (S23 Ultra; stripped `libreactnative.so` / release APK; TTI includes the 80 ms API latency):**

| variant | native modules | lib | APK | TTI | nav(detail) first-open | ring1 eval |
|---|---|---|---|---|---|---|
| none | 2 | 7.27 MB | 21.92 MB | 158–172 ms | 14–30 ms | — |
| profiled | 514 | 14.53 MB | 29.18 MB | 153–155 ms | 15–31 ms | 2–3.5 ms |
| full | 809 | 16.80 MB | 31.45 MB | 159 ms | 19 ms | 2.3 ms |

iPhone 15 Pro Max: full — TTI 112 ms, nav(detail) 12 ms, eval 1.9 ms, native=813, binary 24.18 MB; profiled (521/811) — TTI 108 ms, binary 21.56 MB (−2.62 MB), cold screens interpreted seamlessly.

**Finding 1 — TTI is not where AOT pays.** All three variants land in the same 153–172 ms band (JS-side startup ≈ 73–92 ms once the constant API latency is subtracted). On flagship hardware, Hermes' lazy bytecode startup is already so good that ahead-of-time machine code does not move TTI measurably, even with the ENTIRE bundle native. (Low-end devices untested — the calculus may differ there.) This sharpens the architecture's value story: **AOT buys sustained JS work** (the reconciler benches: 1.6–1.9×), not startup; compile the framework's hot paths (ring 0) and profile-hot product code (ring 1), not the world for TTI's sake.

**Finding 2 — the profile policy earns its keep on a lazy-nav app.** The startup-window profile (session profile truncated offline at the first lazy-screen require — no code change needed) keeps 513 of 807 modules: **36% cold** (vs RNTester's 22%), including exactly the three lazy screens and their exclusive deps, saving 2.27 MB of the 9.53 MB full-AOT weight. In the profiled build, the auto-pilot navigates to the cold screens and they run **interpreted, seamlessly** — the fallback IS the lazy path, live-verified.

**Finding 3 — everything holds under a real app.** Per-call hashes, per-platform units, ring-0 typed core, dispatch fail-safes — all behaved identically under a component-tree app with navigation, lists, timers, images, and Pressability. Screenshot-verified (dark theme persisted from the auto-pilot's settings visit).

Trial-infra notes: `__hybridT0` stamped in the dispatch prelude anchors TTI at bundle-eval start; Metro constant-folds `if (false)` blocks AND drops requires whose binding is only used in dead code — the fabric twin must stay referenced from live exports or the ring-0 unit silently unkeys; Android logcat measurement runs must be tag-filtered (`-s ReactNativeJS`) and buffer-cleared — stale lines produced two bogus readings before the clean protocol.

Artifacts: `js/hybridshop/**` (app + auto-pilot), whole-bundle `RING1_INCLUDE`, startup profiles for the shop app under `bench/hybrid/profiles/`, TTI anchor in `hybrid-serializer.js`.

### Experiment 18 (2026-08-02): Suspense, lazy, forwardRef, insertion effects, memo(compare)

The typed port now covers the last app-blocking React features, verified two-axis (host checksum + effect-order `fx`) in both host modes and running as ring 0 on both phones.

**Ported (React 18.3.1 legacy-sync semantics, exact):**
- **`Suspense` + `React.lazy`** — the big one: Suspense/Offscreen/Fragment/Lazy work tags; thrown-thenable handling (`throwException` with legacy's two capture paths — `ShouldCapture` on the direct-parent boundary vs `DidCapture` + commit-the-incomplete-source with `ForceUpdateForLegacySuspense`); the full **unwind machinery** in `completeUnitOfWork` (`Incomplete`/`HostEffectMask`, `unwindWork` popping providers); the boundary's completeWork `DidCapture → return workInProgress` re-render; legacy fallback mounting that REUSES the progressed primary fragment; **hidden-primary semantics** (Offscreen `Visibility` flag → mutation-mode `hideOrUnhideAllChildren`, persistence-mode hidden clones through `appendAllChildrenToContainer`); commit-attached **retry listeners** with React's deferred scheduling (`ensureRootIsScheduled`, not inline); and legacy's remount rule for suspended lazy components (`resetSuspendedCurrentOnMountInLegacyMode`: disconnect alternates + Placement).
- **`forwardRef`** (render with ref as second arg, full FC hook treatment), **`useInsertionEffect`** (mutation-phase unmount+mount before layout destroys, deletion-inline destroys), **`memo` with custom compare** (MemoComponent wrapper fiber, compare-based bailout, single-child clone).

**Workload:** a lazy `TrendsPanel` under `Suspense` driven by **synchronous custom thenables** (driver-fired, so retries resolve deterministically inside the measured loop — React accepts any thenable), exercising mount-suspend → double retry (module, then data), two update-suspends that HIDE committed content and unhide on resolve, and subtree unmount; plus a forwardRef banner, a custom-compare stats panel that ignores a noisy prop, and versioned insertion effects.

**Result: all four accumulators identical** — mutation `424919205 / fx 1208032539` (hides=3, unhides=3), persistence `1263784292 / fx 1208032539` (hiddenClones=3, 78,508 clones) — reproduced on-device on both phones as ring 0 (S23 0.729 ms/int, iPhone 0.443).

**Three divergences the harness caught on the way** (each an exact-semantics lesson):
1. `bubbleProperties`-adjacent: through-`any` writes to typed class fields are **runtime-checked** by shermes even when the field admits typed writes — a NEW typed-subset rule (fix: write through typed references; the Suspense state assignments hit it).
2. **Retry timing**: React's retry only *schedules* (`ensureRootIsScheduled`) — my inline flush produced renders one flush early. Only visible because the sync-thenable design put retries inside the measured window.
3. **Legacy lazy remount**: after a suspended lazy commit, the stale alternate still carries the `LazyComponent` tag; React treats re-render as a NEW MOUNT (alternates disconnected, `Placement` on the wip). Without it, the resolved content was appended instead of placed — a one-`insertBefore` difference the host checksum caught.

Perf with the full surface intact: host mutation typed 0.413 vs interp 0.743 (**1.80×**), persistent 0.498 vs 0.815 (**1.64×**). Still out of scope: class components, concurrent lanes/priorities, hydration, SuspenseList — none load-bearing for modern function-component RN apps.

Artifacts: ~700 new lines in `typed-port-core.ts`; visibility ops in both host layers (`hcHide*/hcUnhide*/hcCloneHidden*`, mix codes 17–24); twin HostConfigs wire visibility + hidden clones; extended `feed-app.inc.js` + RA surface in all five harnesses.

### Rejected alternatives

- **Dual engine / native core + JS islands** (Valdi-style): two heaps, serialization at every boundary, function-identity hazards.
- **On-device compilation of OTA code**: illegal on iOS (W^X + signing).
- **Whole-bundle AOT with all-or-nothing fallback**: one changed line drops the entire app to interpreter; per-module hashing strictly dominates.
- **Function-level patching**: granularity too fine — closure capture and identity make sub-module swaps unsound.

---

*Detailed per-repo reports were produced by four exploration agents; file:line references throughout point into the cloned repos above.*
