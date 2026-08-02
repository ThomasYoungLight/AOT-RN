# hybridaot — productizing the hybrid AOT+OTA pipeline

*Design doc, 2026-08-02. Status: v0 implemented in `tools/hybridaot/`.*

## What the product is

The investigation (Experiments 1–20, `aot-rn-investigation.md`) proved the
architecture: hash-keyed hybrid module loading — shermes-compiled SHUnits
registered per module id + content hash, an interpreted Metro bundle whose
`__d(factory, id, deps, hash)` calls dispatch to native when the hash
matches, per-module OTA fallback to the interpreter, a checksum-verified
typed reconciler as ring 0, and profile-guided ring 1.

The product is the **toolchain that lets a team operate that architecture**:
build it reproducibly, gate it against regressions, reason about OTA
releases, capture profiles, and survive React Native upgrades. One CLI,
one config file, machine-readable outputs.

```
hybridaot doctor                     # toolchain / env / device checks
hybridaot bundle [--platform ...]    # Metro manifest pass(es)
hybridaot units  [--platform ...]    # registry codegen + shermes units (+ manifest snapshot)
hybridaot gate   [--suite ...]       # equivalence gate matrix, --json, CI exit codes
hybridaot build                      # bundle -> units -> gate (ordering enforced)
hybridaot install [--platform ...]   # device release builds + install
hybridaot verify  [--platform ...]   # launch on device, assert ring-0 binding + checksums
hybridaot profile pull               # capture startup execution profile from a device
hybridaot ota-impact <new-manifest>  # what an OTA bundle would shadow, incl. hot modules
hybridaot ci                         # doctor -> build -> summary JSON (no devices needed)
```

## Why a CLI and not "keep the scripts"

Three operational failure modes appeared repeatedly during the
investigation, and each is a *process* problem the scripts can't solve:

1. **The stale-manifest trap** (struck twice, Experiments 11 and 13):
   registry codegen against an outdated manifest silently unbinds ring 0.
   The fail-safe means nothing crashes — the app just quietly runs
   interpreted. Product answer: `units` refuses to run against a manifest
   older than any of its inputs (twins, serializer, app entry) unless
   `--force`; `build` always re-bundles first.
2. **Verification drift**: five equivalence gates exist, but which ones ran
   before a given binary shipped was tribal knowledge in a terminal
   scrollback. Product answer: `gate` runs the whole matrix, writes
   `gate-results.json` with the actual accumulator values, and `units`
   stamps its output with the gate result it was built under.
3. **Device round ceremony**: cleared tag-filtered logcat, monkey launches,
   `devicectl --console` captures, eyeballing checksum lines. Product
   answer: `verify` does the full launch-parse-assert loop and prints a
   verdict; `profile pull` does the capture-assemble loop for PGO.

## Config

`hybridaot.config.json` at the workspace root. Everything the scripts had
hardcoded becomes config; defaults match this repo so `hybridaot` runs out
of the box.

```json
{
  "reactNative": "react-native",
  "hermes": "hermes",
  "app": {
    "dir": "react-native/packages/rn-tester",
    "entry": {"android": "js/RNTesterApp.android.js", "ios": "js/RNTesterApp.ios.js"},
    "androidAppId": "com.facebook.react.uiapp",
    "iosBundleId": "com.meta.RNTester.localDevelopment"
  },
  "devices": {"android": "<ANDROID-SERIAL>", "ios": "<IOS-DEVICE-UDID>"},
  "platforms": ["android", "ios"],
  "bench": "bench/reconciler/real",
  "unitsScript": "bench/hybrid/build-rn-registry.py",
  "unitsOut": "bench/hybrid/out/rn",
  "profilesDir": "bench/hybrid/profiles",
  "profileName": "rn-tester-startup",
  "iosTeam": "<APPLE-TEAM-ID>",
  "iosDerivedData": "~/Library/Developer/Xcode/DerivedData/RNTesterPods-<DERIVED-DATA-HASH>"
}
```

## The gate matrix

`hybridaot gate` runs every equivalence pair locally (Mac hermes/shermes),
comparing the JS twin (real react-reconciler on the interpreter, with the
deterministic scheduler where applicable) against the typed port compiled
by shermes. A pair passes only if **every** accumulator matches.

| suite | twin | typed | accumulators |
|---|---|---|---|
| `legacy-mutation` | real reconciler, LegacyRoot, mutation host | port, mutation | checksum, fx |
| `legacy-persistent` | real reconciler, LegacyRoot, persistence host | port, persistence | checksum, fx, tree |
| `concurrent-mutation` | real reconciler, ConcurrentRoot, det-scheduler | port, concurrent | checksum, fx, sched |
| `concurrent-persistent` | same, persistence host | port | checksum, fx, sched, tree |
| `passchildren-tree` | (reuses legacy+concurrent persistent twins) | port with the pass-children contract | tree only (op streams differ by design) |
| `ring0-unit` | in-app twin module (`HybridReactCore`) | the actual registry unit source | checksum, fx |

The accumulators are the investigation's verification axes: host-op
checksum (committed mutation/clone stream), `fx` (app-level render/effect
ordering, including renders discarded by interruption), `sched`
(scheduler-trace: schedule/cancel/run/yield sequence — work-unit-exact
concurrency), `tree` (committed-tree shape/props — contract-variant
equivalence).

Output: human table + `out/hybridaot/gate-results.json`
(`{suite: {status, values: {twin, typed}, ms}}`), exit 0/1. CI consumes
the JSON; `units` embeds a copy next to the built units.

## OTA release workflow

The serializer already makes bundles self-describing (per-`__d`-call
hashes). What release engineering needs is *foresight*: before shipping an
OTA bundle, know exactly which modules will drop to the interpreter on
binaries in the field.

- `units` snapshots the manifest it was built against to
  `unitsOut/manifest-baked-<platform>.json` — the ground truth for what a
  given binary has natively.
- `hybridaot ota-impact --platform android [--baked <snapshot>] <new-manifest-or-auto>`
  diffs the new bundle's manifest against the baked snapshot:
  - **shadowed**: modules whose hash changed (will run interpreted),
  - **added / removed** modules,
  - **native retention**: % of modules and % of transformed-source KB that
    stay native,
  - **hot-path impact**: intersects shadowed modules with the startup
    profile — a shadowed *hot* module is the one that can move TTI/
    interaction latency, and that's the number a release gate should look
    at.

Exit code is 0 with `--max-hot-shadowed N` unset; with it, the command
becomes a release gate ("fail the OTA pipeline if more than N hot modules
fall back").

## Profile workflow (PGO ring 1)

`hybridaot profile pull --platform android` productizes the capture loop:
force-stop, clear logcat, launch, wait for the demo's chunked
`profile[...]` dump, assemble `profilesDir/<profileName>-<platform>.json`
(`{executed_ids: [...]}`, execution order preserved). iOS uses
`devicectl launch --terminate-existing --console` and parses the same
lines from glog. `units` picks profiles up automatically (existing
behavior); `--ring1-all` remains the capture-mode override.

## RN upgrade workflow

An RN or Hermes bump can break three distinct layers, so `hybridaot ci`
after an upgrade answers them in order:

1. **Toolchain still sane?** — `doctor` (shermes present, gradle hermes
   config present, NDK, pods config for iOS).
2. **Does the bundle still probe?** — `units` re-runs the ring-1 compile
   probes on the new transformed output; probe-failure diffs are printed
   per reason (the typed-subset catalog lives in the investigation doc).
3. **Is the reconciler still equivalent?** — the twins pin react/
   react-reconciler versions in `bench/.../node_modules`, so the gate
   matrix verifies the *port*, while `ring0-unit` verifies the *pipeline*
   around it. Upgrading the React version inside RN's renderer is a
   separate, deliberate act: bump the twin's pinned packages, re-run the
   matrix, and fix divergences the checksums surface (that is exactly how
   Experiments 10–20 were built, and the process is now repeatable).

## What is deliberately NOT in v0

- **Serializer as an npm package**: `hybrid-serializer.js` stays where
  Metro's config references it; extracting it into a versioned package is
  mechanical but touches app build config — scheduled for when a second
  app integrates.
- **OTA delivery**: hosting/signing/rollout of bundle updates is the
  app's release infrastructure; hybridaot ends at impact analysis.
- **Remote device farms**: `verify`/`profile pull` assume adb/devicectl
  reachable devices.

## Layout

```
tools/hybridaot/
  __main__.py        # python3 tools/hybridaot <cmd>
  cli.py             # argparse, command dispatch
  config.py          # config load/validate/defaults
  runner.py          # subprocess helpers, logging, out-dir management
  doctor.py
  bundle.py          # Metro manifest passes
  units.py           # registry codegen wrapper + snapshots + freshness guard
  gates.py           # the gate matrix
  install.py         # gradle / xcodebuild+devicectl
  verify.py          # on-device ring-0 assertion
  profile_cmd.py     # profile pull
  ota.py             # ota-impact
  ci.py              # composite
bench/hybrid/orchestrate.py   # legacy shim -> hybridaot pipeline
hybridaot.config.json
```
