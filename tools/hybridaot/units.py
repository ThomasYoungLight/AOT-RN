"""Registry codegen + shermes unit compile, with the freshness guard.

The stale-manifest trap (Experiments 11 and 13): codegen against an outdated
manifest bakes wrong hashes into the units and SILENTLY unbinds ring 0 (the
dispatch fail-safe keeps the app running interpreted). The guard refuses to
build units when the manifest predates any of its inputs.
"""
import json
import shutil
import sys

from . import runner
from .runner import log, step

# inputs whose change invalidates a manifest (relative to workspace/bench)
FRESHNESS_INPUTS = [
    ("bench", "host-config.inc.js"),
    ("bench", "feed-app.inc.js"),
    ("bench", "fabric-host.inc.js"),
    ("bench", "fabric-app.inc.js"),
    ("bench", "responder.inc.js"),
    ("bench", "typed-port-core.ts"),
    ("app", "hybrid-serializer.js"),
    ("app", "js/hybrid/HybridReactCore.js"),
    ("app", "js/hybrid/HybridFabricCore.js"),
]


def check_freshness(cfg, platform, force):
    manifest = cfg.manifest_path(platform)
    if not manifest.exists():
        runner.fail(f"{manifest} missing — run `hybridaot bundle` first")
    m_mtime = manifest.stat().st_mtime
    stale_against = []
    for root_key, rel in FRESHNESS_INPUTS:
        root = cfg.bench if root_key == "bench" else cfg.app_dir
        p = root / rel
        if p.exists() and p.stat().st_mtime > m_mtime:
            stale_against.append(str(p.relative_to(cfg.workspace)))
    if stale_against:
        msg = (f"manifest-{platform} is OLDER than: {', '.join(stale_against)}.\n"
               "  Units built now would key against stale hashes and silently unbind "
               "ring 0 on device.\n  Run `hybridaot bundle` (or `hybridaot build`) first")
        if force:
            log(f"WARNING (--force): {msg}")
        else:
            runner.fail(msg + ", or pass --force if you know better.")


def cmd_units(cfg, args):
    platforms = args.platforms or cfg.platforms
    for platform in platforms:
        check_freshness(cfg, platform, args.force)

    step("units: registry codegen + shermes compile")
    cmd = [sys.executable, cfg.units_script]
    if "ios" in platforms:
        cmd.append("--ios")
    if args.ring1_all:
        cmd.append("--ring1-all")
    runner.run(cmd, cwd=cfg.units_script.parent)

    # snapshot the manifests the units were keyed against: ground truth for
    # what a binary built from these units has natively (ota-impact input)
    for platform in platforms:
        snap = cfg.baked_manifest_path(platform)
        shutil.copyfile(cfg.manifest_path(platform), snap)
        n = len(json.loads(snap.read_text()))
        log(f"baked-manifest snapshot ({n} modules): {snap}")

    # stamp the gate result these units were built under, if one exists
    gate_json = cfg.out / "gate-results.json"
    if gate_json.exists():
        shutil.copyfile(gate_json, cfg.units_out / "built-under-gate-results.json")
    return platforms
