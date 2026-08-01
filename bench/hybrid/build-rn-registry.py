#!/usr/bin/env python3
"""Registry codegen for the RN Metro-plugin pipeline.

ring 0 (core + fabriccore units): the checksum-verified typed port of
    react-reconciler's hot path, registered under the JS twins' module ids +
    content hashes (HybridReactCore.js benchmark twin, HybridFabricCore.js
    live-Fabric twin).
ring 1 (ring1 unit): POLICY-SELECTED product modules, transformed Metro
    factories compiled verbatim (untyped). Every manifest module whose path
    matches the include patterns (minus ring-0 modules) is probed with an
    isolated shermes compile; the passes are batched into one unit, the
    failures stay interpreted (they are ring 2 by construction).

    PROFILE-GUIDED selection: when profiles/rn-tester-startup-<platform>.json
    exists, only candidates whose stable module id appears in the captured
    startup execution profile are compiled — native code for modules that
    never execute is pure binary-size dead weight, and the interpreted
    fallback covers the cold tail lazily. Pass --ring1-all to override and
    compile every probe-passing candidate (also the fallback when no profile
    has been captured yet).

Units are PER-PLATFORM: Metro transforms differ between android and ios
(Platform.OS inlining, .android/.ios variants), so each platform's units are
keyed to that platform's own manifest hashes. Pass --ios to also build the
iOS units (requires hybrid-manifest-ios.json + the CocoaPods hermes config).

ONLY run this through orchestrate.py — a registry compiled against a stale
manifest silently unbinds every unit (Experiments 11 and 13 both hit this).
"""
import concurrent.futures
import json
import os
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent
RN = ROOT.parent.parent / "react-native"
H = ROOT.parent.parent / "hermes"
REAL = ROOT.parent / "reconciler" / "real"
BUILD = RN / "packages" / "rn-tester" / "build"
OUT = ROOT / "out" / "rn"
OUT.mkdir(parents=True, exist_ok=True)

CFG_GLOB = "packages/react-native/ReactAndroid/hermes-engine/.cxx/*/*/arm64-v8a/lib/config"
cfg_dirs = sorted(RN.glob(CFG_GLOB))
if not cfg_dirs:
    sys.exit("no gradle-built libhermesvm-config.h found; build hermes-engine first")
CFG_ANDROID = cfg_dirs[-1]
CFG_IOS = RN / "packages" / "rn-tester" / "Pods" / "hermes-engine" / "build" / "iphoneos" / "lib" / "config"

NDK_CC = pathlib.Path.home() / (
    "Library/Android/sdk/ndk/27.1.12297006/toolchains/llvm/prebuilt/"
    "darwin-x86_64/bin/aarch64-linux-android24-clang"
)

SHERMES = H / "build_release" / "bin" / "shermes"
PROBE_DIR = OUT / "ring1-probe"
PROBE_DIR.mkdir(parents=True, exist_ok=True)

# --- ring-1 selection policy ---
# WHOLE BUNDLE: every manifest module (app code, RN core, node_modules) is a
# candidate — the compile probe skips what shermes can't take and the hash
# dispatch fail-safes anything stale. Only the ring-0 twins are excluded
# (they must never be double-registered; their typed ports own those slots).
RING1_INCLUDE = [re.compile(r"")]
RING1_EXCLUDE = [
    re.compile(r"^js/hybrid/HybridReactCore\.js$"),
    re.compile(r"^js/hybrid/HybridFabricCore\.js$"),
]

# probe results cached by content hash: most modules transform identically on
# both platforms and only need one probe.
_probe_cache = {}


def load_manifest(platform):
    p = BUILD / f"hybrid-manifest-{platform}.json"
    if not p.exists() and platform == "android":
        p = BUILD / "hybrid-manifest.json"  # legacy single-platform name
    if not p.exists():
        sys.exit(f"{p} missing — run the {platform} bundle pass first (orchestrate.py)")
    return json.loads(p.read_text())


def find(manifest, path_suffix):
    for mod_id, entry in manifest.items():
        if entry["path"].endswith(path_suffix):
            return mod_id, entry
    sys.exit(f"module {path_suffix} not found in manifest")


def factory_expr(code):
    assert code.startswith("__d(") and code.rstrip().endswith(");"), "unexpected wrap"
    return code[len("__d("):].rstrip()[:-len(");")]


def probe_one(item):
    """Isolated untyped shermes compile of one factory; returns (id, ok, reason)."""
    mod_id, entry = item
    cached = _probe_cache.get(entry["hash"])
    if cached is not None:
        return mod_id, cached[0], cached[1]
    src = PROBE_DIR / f"m{mod_id}.js"
    src.write_text("var __f = " + factory_expr(entry["code"]) + ";\n")
    r = subprocess.run(
        [str(SHERMES), "-O", "-c", str(src), "-o", os.devnull],
        capture_output=True, text=True,
    )
    src.unlink()
    ok = r.returncode == 0
    reason = "" if ok else (r.stderr.strip().splitlines() or ["?"])[0]
    _probe_cache[entry["hash"]] = (ok, reason)
    return mod_id, ok, reason


PROFILES = ROOT / "profiles"


def load_profile(platform):
    if "--ring1-all" in sys.argv:
        return None
    p = PROFILES / f"rn-tester-startup-{platform}.json"
    if not p.exists():
        print(f"ring1[{platform}]: no startup profile at {p} — compiling ALL probe passes")
        return None
    data = json.loads(p.read_text())
    ids = set(str(i) for i in data["executed_ids"])
    print(f"ring1[{platform}]: startup profile {p.name}: {len(ids)} executed modules")
    return ids


def build_ring1_source(manifest, platform):
    all_candidates = [
        (mod_id, entry)
        for mod_id, entry in manifest.items()
        if any(rx.search(entry["path"]) for rx in RING1_INCLUDE)
        and not any(rx.search(entry["path"]) for rx in RING1_EXCLUDE)
    ]
    profile = load_profile(platform)
    if profile is None:
        candidates = all_candidates
    else:
        candidates = [(m, e) for m, e in all_candidates if str(m) in profile]
        dropped = len(all_candidates) - len(candidates)
        kb_all = sum(len(e["code"]) for _, e in all_candidates) // 1024
        kb_sel = sum(len(e["code"]) for _, e in candidates) // 1024
        print(f"ring1[{platform}]: profile-guided: {len(candidates)}/{len(all_candidates)} "
              f"candidates selected ({kb_sel}/{kb_all} KB source), {dropped} cold modules stay ring 2")
    print(f"ring1[{platform}]: {len(candidates)} candidates under policy "
          f"{[rx.pattern for rx in RING1_INCLUDE]}")
    passed, failed = [], []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        for mod_id, ok, reason in ex.map(probe_one, candidates):
            (passed if ok else failed).append((mod_id, reason))
    by_id = dict(candidates)
    print(f"ring1[{platform}]: probe passed={len(passed)} failed={len(failed)}")
    fail_reasons = {}
    for mod_id, reason in failed:
        key = re.sub(r"^.*error: ", "", reason)[:80]
        fail_reasons.setdefault(key, []).append(by_id[mod_id]["path"])
    for key, paths in sorted(fail_reasons.items(), key=lambda kv: -len(kv[1])):
        print(f"  ring1 skip ({len(paths)}x): {key}   e.g. {paths[0]}")

    parts = ["'use strict';\n(function () {\n"
             "  var g = globalThis;\n"
             "  var manifest = g.__nativeModules || (g.__nativeModules = {});\n"]
    for mod_id, _ in passed:
        entry = by_id[mod_id]
        parts.append(
            f"  manifest[{mod_id}] = {{\n"
            f"    hash: '{entry['hash']}',\n"
            f"    path: '{entry['path']}',\n"
            f"    factory: {factory_expr(entry['code'])}\n"
            f"  }};\n"
        )
    parts.append("})();\n")
    src = OUT / f"registry-ring1-rn-{platform}.js"
    src.write_text("".join(parts))
    return src, len(passed)


PRELUDE = """'use strict';
const G: any = globalThis;
function mkList(): any {
  return new G.Array();
}
function mkObj(): any {
  return new G.Object();
}
function anyNull(): any {
  return null;
}
function anyVal(x: any): any {
  return x;
}
function coerceInt(n: number): number {
  return n | 0;
}
"""


def build_core_source(manifest, platform):
    core_id, core = find(manifest, "js/hybrid/HybridReactCore.js")
    print(f"core[{platform}]: id={core_id} hash={core['hash'][:10]}…")
    body = (REAL / "rn-core-typed-body.template.ts").read_text()
    body = body.replace("__CORE_HASH__", core["hash"])
    body = body.replace("__CORE_PATH__", core["path"])
    body = body.replace("__CORE_ID__", str(core_id))
    src = OUT / f"registry-core-rn-{platform}.ts"
    src.write_text(
        PRELUDE
        + (REAL / "host-config.inc.js").read_text()
        + (REAL / "typed-port-core.ts").read_text()
        + (REAL / "feed-app.inc.js").read_text()
        + body
    )
    return src


def build_fabric_source(manifest, platform):
    fabric_id, fabric = find(manifest, "js/hybrid/HybridFabricCore.js")
    print(f"fabric[{platform}]: id={fabric_id} hash={fabric['hash'][:10]}…")
    fbody = (REAL / "fabric-core-typed-body.template.ts").read_text()
    fbody = fbody.replace("__FABRIC_HASH__", fabric["hash"])
    fbody = fbody.replace("__FABRIC_PATH__", fabric["path"])
    fbody = fbody.replace("__FABRIC_ID__", str(fabric_id))
    fcore = (REAL / "typed-port-core.ts").read_text()
    fcore = fcore.replace("const supportsMutation = true;", "const supportsMutation = false;")
    fcore = fcore.replace("const supportsPersistence = false;", "const supportsPersistence = true;")
    fdiff = "\n".join(
        l for l in (REAL / "diffprops-typed-body.ts").read_text().splitlines()
        if not l.startswith("dpRunWorkload(")
    )
    faliases = """
function fhDiff(prevProps: any, nextProps: any, validAttributes: any): any {
  return tDiffProperties(null, prevProps, nextProps, validAttributes);
}
function fhCreate(props: any, validAttributes: any): any {
  return tAddNestedProperty(null, props, validAttributes);
}
"""
    src = OUT / f"registry-fabric-rn-{platform}.ts"
    src.write_text(
        PRELUDE
        + fdiff
        + faliases
        + (REAL / "fabric-host.inc.js").read_text()
        + fcore
        + (REAL / "fabric-app.inc.js").read_text()
        + fbody
    )
    return src


def shermes_android(args):
    cflags = (
        f"-O3 -DNDEBUG -fno-strict-aliasing -fno-strict-overflow "
        f"-I{CFG_ANDROID} -I{H}/include"
    )
    cmd = [str(SHERMES)] + args
    print("+", " ".join(cmd))
    subprocess.run(cmd, check=True, env={**os.environ, "CC": str(NDK_CC), "CFLAGS": cflags})


def shermes_ios(args):
    sdk = subprocess.run(
        ["xcrun", "--sdk", "iphoneos", "--show-sdk-path"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    cc = subprocess.run(
        ["xcrun", "-f", "clang"], capture_output=True, text=True, check=True
    ).stdout.strip()
    cflags = (
        f"-target arm64-apple-ios15.1 -isysroot {sdk} -O3 -DNDEBUG "
        f"-fno-strict-aliasing -fno-strict-overflow -I{CFG_IOS} -I{H}/include"
    )
    cmd = [str(SHERMES)] + args
    print("+ [ios]", " ".join(cmd))
    subprocess.run(cmd, check=True, env={**os.environ, "CC": cc, "CFLAGS": cflags})


def build_platform(platform, compile_fn, suffix):
    manifest = load_manifest(platform)
    core_src = build_core_source(manifest, platform)
    fabric_src = build_fabric_source(manifest, platform)
    ring1_src, ring1_count = build_ring1_source(manifest, platform)
    compile_fn(["-typed", "-O", "-c", "-exported-unit=core",
                str(core_src), "-o", str(OUT / f"core_unit_rn{suffix}.o")])
    compile_fn(["-typed", "-O", "-c", "-exported-unit=fabriccore",
                str(fabric_src), "-o", str(OUT / f"fabric_unit_rn{suffix}.o")])
    compile_fn(["-O", "-c", "-exported-unit=ring1",
                str(ring1_src), "-o", str(OUT / f"ring1_unit_rn{suffix}.o")])
    size = (OUT / f"ring1_unit_rn{suffix}.o").stat().st_size // 1024
    print(f"ring1_unit_rn{suffix}.o: {size} KB, {ring1_count} modules")


build_platform("android", shermes_android, "")
if "--ios" in sys.argv:
    build_platform("ios", shermes_ios, "_ios")

print("done:", OUT)
