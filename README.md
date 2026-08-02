# AOT-RN — hybrid AOT + OTA for React Native

Make React Native's JavaScript run as **ahead-of-time compiled native code**
without giving up **over-the-air updates** — per module, verified, on stock
RN new architecture.

```
                    ┌──────────────── app binary ────────────────┐
 Metro bundle       │  SHUnits (shermes-compiled native code)     │
 __d(factory, id,   │  global.__nativeModules = {                 │
      deps, HASH) ──┼──►  id: {hash, factory}, ...                │
                    │  }                                          │
 hash matches? ──► run the native factory (ring 0 / ring 1)
 hash differs? ──► run the bundle's JS factory (interpreter)  ← OTA fallback
```

Every `__d` call carries a content hash of its own module. An OTA update
changes some hashes; exactly those modules fall back to the Hermes
interpreter, everything else keeps running native. iOS never sees on-device
codegen, so this is the canonical shape.

## Results (Experiments 1–21, `claudedocs/aot-rn-investigation.md`)

- **Ring 0** — a typed-Hermes (shermes) port of react-reconciler 18.3.1's
  hot path: hooks, context, effects, refs, Suspense/lazy, forwardRef,
  memo(compare), `useSyncExternalStore`, and the **full concurrent
  architecture** (lanes, scheduler, interruptible rendering, transitions,
  concurrent Suspense with retry lanes and pings). Proven **byte-equivalent
  to real React** on up to four independent accumulators per suite: host-op
  checksum, effect-order `fx`, scheduler trace (work-unit-exact
  concurrency), committed-tree hash.
- **Speed**: 1.6–2.3× over interpreted React on sustained UI work
  (concurrent workloads gain most — lane/scheduler bookkeeping is exactly
  what typed compilation accelerates). On device: Galaxy S23 Ultra and
  iPhone 15 Pro Max run the port as ring 0 with identical checksums.
- **Ring 1** — whole-bundle untyped compilation works (800+ modules probe
  clean); startup **TTI is not parse/exec-bound on flagships**, so ring 1
  is profile-guided (PGO): compile what the startup profile executed, let
  the interpreter cover the cold tail lazily.
- **Live Fabric**: the typed reconciler drives `nativeFabricUIManager`
  directly (persistence mode, the next `passChildrenWhenCloningPersistedNodes`
  clone contract, and a gesture-responder port) — real views, real touch.

## Toolchain

Operate everything through the `hybridaot` CLI
(`tools/hybridaot/README.md`):

```bash
python3 -m tools.hybridaot doctor      # toolchain/env/device checks
python3 -m tools.hybridaot build       # bundle -> units -> 7-suite gate matrix
python3 -m tools.hybridaot install     # device release builds
python3 -m tools.hybridaot verify      # assert ring 0 is BOUND on device
python3 -m tools.hybridaot profile pull      # PGO startup profile capture
python3 -m tools.hybridaot ota-impact --max-hot-shadowed 5   # OTA release gate
```

Machine-specific settings (device serials, signing team) go in a gitignored
`hybridaot.config.local.json` overlaying `hybridaot.config.json`.

## Repo layout

| path | contents |
|---|---|
| `tools/hybridaot/` | the CLI (design: `claudedocs/hybridaot-product-design.md`) |
| `bench/reconciler/real/` | the typed reconciler port + JS twins + gate harnesses |
| `bench/hybrid/` | registry codegen, startup profiles, prototype runtimes |
| `bench/patches/` | the RN integration as a single patch (fallback for the fork) |
| `claudedocs/` | the full investigation report + product design |
| `PINS.md` | pinned react-native fork branch + hermes commit |

The `react-native/` and `hermes/` clones are gitignored; see `PINS.md`.
RN-side integration lives on
[`ThomasYoungLight/react-native#hybrid-aot`](https://github.com/ThomasYoungLight/react-native/tree/hybrid-aot).
