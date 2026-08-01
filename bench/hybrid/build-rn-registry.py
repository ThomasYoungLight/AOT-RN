#!/usr/bin/env python3
"""Registry codegen for the RN Metro-plugin pipeline (ring 0 = real port).

ring 0 (core unit): the checksum-verified typed port of react-reconciler's
    hot path (bench/reconciler/real/typed-port-core.ts) + shared benchmark,
    registered under HybridReactCore.js's module id + content hash. The JS
    twin in the bundle is the REAL react-reconciler.
ring 1 (util unit): HybridUtil's transformed Metro factory compiled verbatim.

Pass --ios to also compile against the CocoaPods iOS hermes config.
"""
import json
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent
RN = ROOT.parent.parent / "react-native"
H = ROOT.parent.parent / "hermes"
REAL = ROOT.parent / "reconciler" / "real"
MANIFEST = RN / "packages" / "rn-tester" / "build" / "hybrid-manifest.json"
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

manifest = json.loads(MANIFEST.read_text())


def find(path_suffix):
    for mod_id, entry in manifest.items():
        if entry["path"].endswith(path_suffix):
            return mod_id, entry
    sys.exit(f"module {path_suffix} not found in manifest")


def factory_expr(code):
    assert code.startswith("__d(") and code.rstrip().endswith(");"), "unexpected wrap"
    return code[len("__d("):].rstrip()[:-len(");")]


util_id, util = find("js/hybrid/HybridUtil.js")
core_id, core = find("js/hybrid/HybridReactCore.js")
fabric_id, fabric = find("js/hybrid/HybridFabricCore.js")
print(f"util: id={util_id} hash={util['hash'][:10]}…")
print(f"core: id={core_id} hash={core['hash'][:10]}… ({core['path']})")
print(f"fabric: id={fabric_id} hash={fabric['hash'][:10]}… ({fabric['path']})")

# --- ring 1 ---
registry_util = f"""'use strict';
(function () {{
  var g = globalThis;
  var manifest = g.__nativeModules || (g.__nativeModules = {{}});
  manifest[{util_id}] = {{
    hash: '{util["hash"]}',
    path: '{util["path"]}',
    factory: {factory_expr(util["code"])}
  }};
}})();
"""
(OUT / "registry-util-rn.js").write_text(registry_util)

# --- ring 0: assemble typed unit from the real-port sources ---
prelude = """'use strict';
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
body = (REAL / "rn-core-typed-body.template.ts").read_text()
body = body.replace("__CORE_HASH__", core["hash"])
body = body.replace("__CORE_PATH__", core["path"])
body = body.replace("__CORE_ID__", str(core_id))
typed_unit = (
    prelude
    + (REAL / "host-config.inc.js").read_text()
    + (REAL / "typed-port-core.ts").read_text()
    + (REAL / "feed-app.inc.js").read_text()
    + body
)
(OUT / "registry-core-rn.ts").write_text(typed_unit)

# --- ring 0, fabric flavor: typed persistent reconciler bound to
# nativeFabricUIManager, keyed to the HybridFabricCore twin's hash ---
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
fabric_unit = (
    prelude
    + fdiff
    + faliases
    + (REAL / "fabric-host.inc.js").read_text()
    + fcore
    + (REAL / "fabric-app.inc.js").read_text()
    + fbody
)
(OUT / "registry-fabric-rn.ts").write_text(fabric_unit)


def shermes(args, cfg):
    cflags = (
        f"-O3 -DNDEBUG -fno-strict-aliasing -fno-strict-overflow -I{cfg} -I{H}/include"
    )
    cmd = [str(H / "build_release" / "bin" / "shermes")] + args
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
    cmd = [str(H / "build_release" / "bin" / "shermes")] + args
    print("+ [ios]", " ".join(cmd))
    subprocess.run(cmd, check=True, env={**os.environ, "CC": cc, "CFLAGS": cflags})


shermes(["-typed", "-O", "-c", "-exported-unit=core",
         str(OUT / "registry-core-rn.ts"), "-o", str(OUT / "core_unit_rn.o")], CFG_ANDROID)
shermes(["-typed", "-O", "-c", "-exported-unit=fabriccore",
         str(OUT / "registry-fabric-rn.ts"), "-o", str(OUT / "fabric_unit_rn.o")], CFG_ANDROID)
shermes(["-O", "-c", "-exported-unit=util",
         str(OUT / "registry-util-rn.js"), "-o", str(OUT / "util_unit_rn.o")], CFG_ANDROID)

if "--ios" in sys.argv:
    shermes_ios(["-typed", "-O", "-c", "-exported-unit=core",
                 str(OUT / "registry-core-rn.ts"), "-o", str(OUT / "core_unit_rn_ios.o")])
    shermes_ios(["-typed", "-O", "-c", "-exported-unit=fabriccore",
                 str(OUT / "registry-fabric-rn.ts"), "-o", str(OUT / "fabric_unit_rn_ios.o")])
    shermes_ios(["-O", "-c", "-exported-unit=util",
                 str(OUT / "registry-util-rn.js"), "-o", str(OUT / "util_unit_rn_ios.o")])

print("done:", OUT)
