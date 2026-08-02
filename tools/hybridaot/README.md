# hybridaot

The toolchain for operating the hybrid AOT+OTA React Native architecture
(design: `claudedocs/hybridaot-product-design.md`; evidence base:
`claudedocs/aot-rn-investigation.md`, Experiments 1–20).

Run from the workspace root:

```bash
python3 -m tools.hybridaot doctor        # 13 toolchain/env/device checks
python3 -m tools.hybridaot build         # bundle -> units -> gate matrix
python3 -m tools.hybridaot install       # device release builds
python3 -m tools.hybridaot verify        # on-device ring-0 assertion
```

## Everyday flows

**Dev loop** (changed the typed port, a twin, an app module):

```bash
python3 -m tools.hybridaot build --platform android
python3 -m tools.hybridaot install --platform android
python3 -m tools.hybridaot verify --platform android
```

`build` enforces the ordering that prevents the stale-manifest trap; running
`units` by hand against a manifest older than its inputs is refused unless
`--force`.

**Gate-only** (port changes, no app rebuild): `gate` runs the 7-suite
equivalence matrix locally in ~25 s (twin = real react-reconciler on the
interpreter; typed = shermes-compiled port; every accumulator must match):

```
PASS  legacy-mutation            checksum fx
PASS  legacy-persistent          checksum fx tree
PASS  concurrent-mutation        checksum fx sched
PASS  concurrent-persistent      checksum fx sched tree
PASS  passchildren-legacy        tree fx
PASS  passchildren-concurrent    tree fx sched
PASS  ring0-unit                 checksum fx        (the shipping unit source)
```

Results land in `out/hybridaot/gate-results.json`; `units` stamps a copy
next to its outputs (`built-under-gate-results.json`).

**OTA release gate**: bundle the OTA candidate, then ask what binaries in
the field would shadow:

```bash
python3 -m tools.hybridaot bundle --platform android      # candidate manifest
python3 -m tools.hybridaot ota-impact --platform android --max-hot-shadowed 5
```

Reports modules/KB dropping to the interpreter and — the number that
matters — how many *hot* (startup-profiled) modules are affected. Exit code
gates the release.

**Profile capture (PGO ring 1)**:

```bash
python3 -m tools.hybridaot profile pull --platform android
```

Launches the app, captures the dispatch prelude's executed-module dump,
writes `bench/hybrid/profiles/<name>-<platform>.json`. The next `units` run
selects ring-1 candidates from it automatically.

**App-surface stability + visual parity** (`sweep`): walks RNTester's 76
example screens by deep link on two builds from the *same bundle* — hybrid
vs an all-interpreted control (units unlinked ⇒ stock RN behavior) —
capturing screenshots and PID-scoped error logs, then compares.

```bash
# hybrid build installed
python3 -m tools.hybridaot sweep run --variant hybrid
python3 -m tools.hybridaot sweep run --variant hybrid2      # self-noise baseline
python3 -m tools.hybridaot sweep soak --variant hybrid --events 3000
# control build installed (mv bench/hybrid/out/rn/*.o aside, touch CMakeLists, reinstall)
python3 -m tools.hybridaot sweep run --variant control
python3 -m tools.hybridaot sweep compare --a hybrid --b hybrid2   # -> self-noise
python3 -m tools.hybridaot sweep compare --a hybrid --b control \
        --baseline hybrid-vs-hybrid2                              # -> verdict
```

The baseline matters: animated screens (spinners, transforms, press states,
toasts) differ between two runs of the *same binary*, so a screen only counts
as divergent when the cross-variant difference exceeds that screen's own
run-to-run noise. Screenshots are decoded to grayscale grids with the
status-bar and nav-bar bands cropped; `soak` adds a random-input monkey run.
`sweep reanalyze` rescoring stored PNGs lets the metric evolve without
re-running the device.

**CI** (device-free): `python3 -m tools.hybridaot ci` = doctor(essential) →
bundle → units → gate; summary in `out/hybridaot/ci-summary.json`.

**RN/Hermes upgrade**: run `ci` after the bump. `doctor` catches toolchain
breaks, the ring-1 probe report shows what stopped compiling (per-reason
diff), the gate matrix proves the reconciler port is still exact, and
`ring0-unit` proves the pipeline around it still keys correctly.

## Config

`hybridaot.config.json` at the workspace root — paths, app ids, device
serials, platforms. Defaults match this workspace.

## Legacy

`bench/hybrid/orchestrate.py` is a shim forwarding to `hybridaot build` /
`install` with the old flags.
