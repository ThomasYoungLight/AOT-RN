#!/usr/bin/env python3
"""Hybrid AOT build orchestrator.

Enforces the pipeline ordering that manual runs got wrong once (Experiment 11:
a registry compiled against a stale manifest silently unbinds ring 0):

  1. build the ring-0 JS twin (real react-reconciler Metro module)
  2. Metro bundle pass -> hybrid-manifest.json (ids + content hashes)
  3. registry codegen + shermes compile (Android; --ios adds the pod-config units)
  4. EQUIVALENCE GATE: run the JS twin (Hermes interpreter) and the typed port
     (shermes -typed, host) and require identical host-mutation checksums
  5. optionally build+install on devices (--install-android / --install-ios)

Usage: orchestrate.py [--ios] [--install-android] [--install-ios]
"""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent          # bench/hybrid
WS = ROOT.parent.parent                                  # AOT-RN
RN = WS / "react-native"
RNT = RN / "packages" / "rn-tester"
REAL = WS / "bench" / "reconciler" / "real"
H = WS / "hermes"
OUT = ROOT / "out" / "rn"
SCRATCH = ROOT / "out" / "orchestrator"
SCRATCH.mkdir(parents=True, exist_ok=True)

HERMES_ENV = {
    "REACT_NATIVE_OVERRIDE_HERMES_DIR": str(H),
    "RCT_BUILD_HERMES_FROM_SOURCE": "true",
}
IOS_DEVICE = "<IOS-DEVICE-UDID>"
ANDROID_SERIAL = "<ANDROID-SERIAL>"


def run(cmd, cwd=None, env_extra=None, capture=False):
    import os
    env = {**os.environ, **(env_extra or {})}
    print(f"+ [{cwd or '.'}] {' '.join(str(c) for c in cmd)}")
    r = subprocess.run(
        [str(c) for c in cmd], cwd=cwd, env=env, check=True,
        capture_output=capture, text=True,
    )
    return r.stdout if capture else None


def step(n, title):
    print(f"\n=== [{n}] {title} ===")


def extract_checksum(output, who):
    m = re.search(r"checksum=(\d+)", output)
    if not m:
        sys.exit(f"GATE FAIL: no checksum in {who} output:\n{output[-500:]}")
    fx = re.search(r"fx=(-?\d+)", output)
    if not fx:
        sys.exit(f"GATE FAIL: no fx (effect-order checksum) in {who} output:\n{output[-500:]}")
    return m.group(1) + "/" + fx.group(1)


def main():
    ios = "--ios" in sys.argv

    step(1, "build ring-0 JS twins")
    run(["bash", str(REAL / "build-rn-twin.sh")])
    run(["bash", str(REAL / "build-fabric-twin.sh")])

    step(2, "Metro bundle passes -> per-platform hybrid manifests")
    # Metro transforms are platform-specific (Platform.OS inlining, .android/
    # .ios variants), so each platform's units key against its own manifest.
    run(["node", "../react-native/cli.js", "bundle",
         "--entry-file", "js/RNTesterApp.android.js",
         "--platform", "android", "--dev", "false", "--minify", "false",
         "--bundle-output", str(SCRATCH / "manifest-pass-android.bundle"),
         "--assets-dest", str(SCRATCH / "manifest-pass-assets")],
        cwd=RNT,
        env_extra={"HYBRID_MANIFEST_OUT": str(RNT / "build" / "hybrid-manifest-android.json")})
    if ios:
        run(["node", "../react-native/cli.js", "bundle",
             "--entry-file", "js/RNTesterApp.ios.js",
             "--platform", "ios", "--dev", "false", "--minify", "false",
             "--bundle-output", str(SCRATCH / "manifest-pass-ios.bundle"),
             "--assets-dest", str(SCRATCH / "manifest-pass-assets")],
            cwd=RNT,
            env_extra={"HYBRID_MANIFEST_OUT": str(RNT / "build" / "hybrid-manifest-ios.json")})

    step(3, "registry codegen + shermes compile")
    args = [sys.executable, str(ROOT / "build-rn-registry.py")]
    if ios:
        args.append("--ios")
    run(args, cwd=ROOT)

    step(4, "equivalence gate (host)")
    # 4a. typed port checksum
    smoke = SCRATCH / "smoke.ts"
    smoke.write_text(
        (OUT / "registry-core-rn-android.ts").read_text()
        + "\nconst __r: any = makeTypedCoreExports().run();\n"
          "print(String(__r.host));\n"
    )
    typed_out = run([str(H / "build_release" / "bin" / "shermes"),
                     "-typed", "-O", "-exec", str(smoke)], capture=True)
    typed_sum = extract_checksum(typed_out, "typed port")
    # 4b. JS twin checksum (real react-reconciler on the interpreter)
    check_entry = SCRATCH / "twin-check.cjs"
    check_entry.write_text(
        "if (typeof globalThis.setTimeout === 'undefined') {\n"
        "  globalThis.setTimeout = function () { return 0; };\n"
        "  globalThis.clearTimeout = function () {};\n"
        "}\n"
        "if (typeof globalThis.console === 'undefined') {\n"
        "  globalThis.console = {log: print, warn: print, error: print};\n"
        "}\n"
        f"var m = require('{REAL}/twin-entry.cjs');\n"
        "var r = m.run();\n"
        "print(r.host);\n"
    )
    run(["npx", "esbuild", str(check_entry), "--bundle", "--format=iife",
         "--platform=neutral",
         "--define:process.env.NODE_ENV=\"production\"", "--define:__DEV__=false",
         f"--outfile={SCRATCH / 'twin-check.js'}"], cwd=REAL)
    twin_out = run([str(H / "build_release" / "bin" / "hermes"),
                    "-O", str(SCRATCH / "twin-check.js")], capture=True)
    twin_sum = extract_checksum(twin_out, "JS twin")
    if typed_sum != twin_sum:
        sys.exit(f"GATE FAIL: typed port checksum {typed_sum} != twin checksum {twin_sum}\n"
                 "The typed port and the real reconciler diverged — do NOT ship this registry.")
    print(f"GATE OK: typed port == real reconciler (checksum {typed_sum})")

    step(4.5, "equivalence gate (concurrent root: host + fx + sched trace)")
    def extract_concurrent(output, who):
        vals = []
        for pat in (r"checksum=(\d+)", r"fx=(-?\d+)", r"sched=(\d+)"):
            m2 = re.search(pat, output)
            if not m2:
                sys.exit(f"GATE FAIL: no {pat} in {who} output:\n{output[-500:]}")
            vals.append(m2.group(1))
        return "/".join(vals)
    run(["bash", str(REAL / "build-real-concurrent.sh")])
    cc_twin_out = run([str(H / "build_release" / "bin" / "hermes"),
                       "-O", str(REAL / "real-react-concurrent-bundle.js")], capture=True)
    cc_twin_sum = extract_concurrent(cc_twin_out, "concurrent JS twin")
    run(["bash", str(REAL / "build-typed-concurrent.sh")])
    cc_bin = SCRATCH / "typed-concurrent-gate"
    run([str(H / "build_release" / "bin" / "shermes"),
         "-typed", "-O", "-o", str(cc_bin), str(REAL / "typed-entry-concurrent.ts")])
    cc_typed_out = run([str(cc_bin)], capture=True)
    cc_typed_sum = extract_concurrent(cc_typed_out, "concurrent typed port")
    if cc_typed_sum != cc_twin_sum:
        sys.exit(f"GATE FAIL: concurrent typed {cc_typed_sum} != twin {cc_twin_sum}\n"
                 "Concurrent lanes/scheduling diverged — do NOT ship this registry.")
    print(f"GATE OK: concurrent root equivalent (checksum/fx/sched {cc_typed_sum})")

    # concurrent + persistence (Fabric-shaped): what a new-arch ring 0 runs
    run(["bash", str(REAL / "build-real-concurrent-persistent.sh")])
    ccp_twin_out = run([str(H / "build_release" / "bin" / "hermes"),
                        "-O", str(REAL / "real-react-concurrent-persistent-bundle.js")], capture=True)
    ccp_twin_sum = extract_concurrent(ccp_twin_out, "concurrent persistent JS twin")
    run(["bash", str(REAL / "build-typed-concurrent-persistent.sh")])
    ccp_bin = SCRATCH / "typed-concurrent-persistent-gate"
    run([str(H / "build_release" / "bin" / "shermes"),
         "-typed", "-O", "-o", str(ccp_bin), str(REAL / "typed-entry-concurrent-persistent.ts")])
    ccp_typed_out = run([str(ccp_bin)], capture=True)
    ccp_typed_sum = extract_concurrent(ccp_typed_out, "concurrent persistent typed port")
    if ccp_typed_sum != ccp_twin_sum:
        sys.exit(f"GATE FAIL: concurrent persistent typed {ccp_typed_sum} != twin {ccp_twin_sum}\n"
                 "Concurrent persistence (Fabric-shaped) diverged — do NOT ship this registry.")
    print(f"GATE OK: concurrent persistent equivalent (checksum/fx/sched {ccp_typed_sum})")

    if "--install-android" in sys.argv:
        step(5, "Android release build + install")
        run(["./gradlew", ":packages:rn-tester:android:app:installRelease",
             "-PreactNativeArchitectures=arm64-v8a",
             "-Preact.internal.useHermesNightly=false"],
            cwd=RN, env_extra={**HERMES_ENV, "ANDROID_SERIAL": ANDROID_SERIAL})

    if "--install-ios" in sys.argv:
        step(6, "iOS release build + install")
        run(["xcodebuild", "-workspace", "RNTesterPods.xcworkspace",
             "-scheme", "RNTester", "-configuration", "Release",
             "-destination", f"platform=iOS,id={IOS_DEVICE}",
             "DEVELOPMENT_TEAM=<APPLE-TEAM-ID>", "CODE_SIGN_STYLE=Automatic",
             "-allowProvisioningUpdates", "build"],
            cwd=RNT, env_extra=HERMES_ENV)
        app = pathlib.Path.home() / (
            "Library/Developer/Xcode/DerivedData/"
            "RNTesterPods-<DERIVED-DATA-HASH>/Build/Products/"
            "Release-iphoneos/RNTester.app"
        )
        run(["xcrun", "devicectl", "device", "install", "app",
             "--device", IOS_DEVICE, str(app)])

    print("\nORCHESTRATION COMPLETE")


if __name__ == "__main__":
    main()
