#!/usr/bin/env python3
"""Build the hybrid AOT/OTA prototype.

Pipeline (mirrors the proposed Metro-plugin design):
  1. hash each module's factory source (stand-in for post-transform hash)
  2. codegen: native registries (hash-injected) + interpreted bundles whose
     __d calls carry the same hashes
  3. shermes -typed  -> core SHUnit (.o)   [ring 0]
     shermes         -> util SHUnit (.o)   [ring 1]
     hermesc         -> bundle-v1.hbc (fresh install), bundle-v2.hbc (OTA:
                        util changed)
  4. link host binary `hybrid` with both SHUnits + libhermesvm
"""
import hashlib
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent
H = ROOT.parent.parent / "hermes"
BIN = H / "build_release" / "bin"
OUT = ROOT / "out"
OUT.mkdir(exist_ok=True)


def sha(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(cmd, **kw):
    print("+", " ".join(str(c) for c in cmd))
    subprocess.run([str(c) for c in cmd], check=True, **kw)


mods = ROOT / "modules"
factories = {
    "core": mods / "core.factory.js",
    "util": mods / "util.factory.js",
    "util_v2": mods / "util_v2.factory.js",
    "app": mods / "app.factory.js",
}
hashes = {k: sha(v) for k, v in factories.items()}
for k, v in hashes.items():
    print(f"hash {k}: {v[:16]}…")

# --- codegen: native registries ---
core_ts = (ROOT / "native" / "registry-core.template.ts").read_text()
(OUT / "registry-core.ts").write_text(
    core_ts.replace("__CORE_HASH__", hashes["core"]))

util_js = (ROOT / "native" / "registry-util.template.js").read_text()
(OUT / "registry-util.js").write_text(
    util_js.replace("__UTIL_HASH__", hashes["util"])
           .replace("__UTIL_FACTORY__", factories["util"].read_text().strip()))

# --- codegen: interpreted bundles ---
prelude = (ROOT / "runtime" / "prelude.js").read_text()


def make_bundle(name: str, util_key: str):
    parts = [prelude]
    for mod_id, src_key in [("util", util_key), ("core", "core"), ("app", "app")]:
        factory = factories[src_key].read_text().strip()
        parts.append(f"__d({factory}, '{mod_id}', '{hashes[src_key]}');\n")
    parts.append("__r('app');\n")
    (OUT / f"{name}.js").write_text("\n".join(parts))
    run([BIN / "hermesc", "-O", "-emit-binary",
         "-out", OUT / f"{name}.hbc", OUT / f"{name}.js"])


make_bundle("bundle-v1", "util")     # fresh install: all hashes match
make_bundle("bundle-v2", "util_v2")  # OTA hotfix: util changed

# --- compile SHUnits ---
run([BIN / "shermes", "-typed", "-O", "-c", "-exported-unit=core",
     OUT / "registry-core.ts", "-o", OUT / "core_unit.o"])
run([BIN / "shermes", "-O", "-c", "-exported-unit=util",
     OUT / "registry-util.js", "-o", OUT / "util_unit.o"])

# --- link host ---
run(["clang++", "-O2", "-std=c++17",
     ROOT / "main.cpp", OUT / "core_unit.o", OUT / "util_unit.o",
     "-I", H / "API", "-I", H / "API" / "jsi", "-I", H / "public",
     "-L", H / "build_release" / "lib", "-lhermesvm",
     f"-Wl,-rpath,{H / 'build_release' / 'lib'}",
     "-o", OUT / "hybrid"])

print("\nbuilt:", OUT / "hybrid")
print("scenarios:")
print("  out/hybrid out/bundle-v1.hbc              # fresh install: all native")
print("  out/hybrid out/bundle-v2.hbc              # OTA: util -> interpreter")
print("  out/hybrid --no-native out/bundle-v1.hbc  # baseline: all interpreted")
