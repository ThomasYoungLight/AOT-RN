"""OTA impact analysis.

Given the manifest of a NEW bundle (an OTA candidate) and the baked-manifest
snapshot of what's natively registered in binaries in the field, report
exactly which modules the hash dispatch will shadow to the interpreter —
overall and, more importantly, within the startup profile's hot set (the
modules whose fallback can actually move TTI / interaction latency).

With --max-hot-shadowed N the command becomes a release gate.
"""
import json

from . import runner
from .runner import log, step


def _load(path):
    return json.loads(path.read_text())


def cmd_ota_impact(cfg, args):
    platform = args.platform
    baked_path = args.baked or cfg.baked_manifest_path(platform)
    new_path = args.new_manifest or cfg.manifest_path(platform)
    if not baked_path.exists():
        runner.fail(f"{baked_path} missing — build units first (`hybridaot units`)")
    if not new_path.exists():
        runner.fail(f"{new_path} missing — bundle the OTA candidate first")
    baked = _load(baked_path)
    new = _load(new_path)

    step(f"ota-impact ({platform}): {new_path.name} vs {baked_path.name}")

    shadowed, added, removed, unchanged = [], [], [], []
    for mod_id, entry in new.items():
        old = baked.get(mod_id)
        if old is None:
            added.append((mod_id, entry["path"]))
        elif old["hash"] != entry["hash"]:
            shadowed.append((mod_id, entry["path"], len(entry.get("code", ""))))
        else:
            unchanged.append(mod_id)
    for mod_id, entry in baked.items():
        if mod_id not in new:
            removed.append((mod_id, entry["path"]))

    total = len(new)
    kb_total = sum(len(e.get("code", "")) for e in new.values()) // 1024
    kb_shadowed = sum(sz for _, _, sz in shadowed) // 1024

    hot_shadowed = []
    profile_path = cfg.profile_path(platform)
    if profile_path.exists():
        hot = set(str(i) for i in _load(profile_path)["executed_ids"])
        hot_shadowed = [(m, p) for m, p, _ in shadowed if str(m) in hot]

    print(f"  modules: {total} total | {len(unchanged)} stay native "
          f"({100 * len(unchanged) // max(total, 1)}%) | {len(shadowed)} shadowed | "
          f"{len(added)} added (interpreted) | {len(removed)} removed")
    print(f"  source:  {kb_shadowed}/{kb_total} KB drops to the interpreter")
    if profile_path.exists():
        print(f"  hot set ({profile_path.name}): {len(hot_shadowed)} shadowed hot modules")
    else:
        print(f"  hot set: no profile at {profile_path} — run `hybridaot profile pull`")
    for mod_id, path in (hot_shadowed or [(m, p) for m, p, _ in shadowed])[:20]:
        print(f"    ~ {path}")

    result = {
        "platform": platform,
        "total": total,
        "unchanged": len(unchanged),
        "shadowed": [{"id": m, "path": p} for m, p, _ in shadowed],
        "added": [{"id": m, "path": p} for m, p in added],
        "removed": [{"id": m, "path": p} for m, p in removed],
        "kbTotal": kb_total,
        "kbShadowed": kb_shadowed,
        "hotShadowed": [{"id": m, "path": p} for m, p in hot_shadowed],
    }
    out = cfg.out / f"ota-impact-{platform}.json"
    out.write_text(json.dumps(result, indent=2))
    log(f"wrote {out}")

    if args.max_hot_shadowed is not None and len(hot_shadowed) > args.max_hot_shadowed:
        runner.fail(f"ota-impact: {len(hot_shadowed)} hot modules would be shadowed "
                    f"(limit {args.max_hot_shadowed})")
    return result
