"""iOS screen sweep.

Two capture paths, because iOS gives very different tooling per target:

  device     `devicectl process launch --payload-url rntester://example/<key>`
             navigates. iOS 17+ has no CLI screenshot (the screenshotr
             lockdown service is gone; devicectl has no equivalent), so the
             app screenshots ITSELF: a second deep link
             `rntester://hybridshot/<key>` drives RNTester's ScreenshotManager
             TurboModule (UIGraphicsImageRenderer over the key window), which
             writes a PNG into the app container and logs the path; the
             harness pulls it with `devicectl device copy from`. Full pixel
             parity on a physical device, no XCUITest/WebDriverAgent needed.
  simulator  `simctl openurl` + `simctl io screenshot` gives full pixel
             capture, so the simulator run supports the same visual-parity
             comparison as Android — and it runs on CI machines with no phone
             attached.
"""
import json
import re
import subprocess
import time

from . import runner, sweep
from .runner import log, step

# console lines that indicate a real problem in OUR app
IOS_ERROR_RE = re.compile(
    r"(Fatal error|\*\*\* Terminating app|NSException|SIGABRT|SIGSEGV|"
    r"Unhandled JS Exception|Invariant Violation|RCTFatal|"
    r"JavaScript error|redbox|\[HybridErr\])", re.I)
IOS_IGNORE_RE = re.compile(
    r"(Unable to resolve host|NetworkingModule|Metro|favicon|"
    r"Could not find image|nw_connection|quic_conn)", re.I)


SHOT_RE = re.compile(r"\[HybridShot\] (\S+) (\S+)")


def _pull(cfg, remote_abs, dest):
    """Pull a file out of the app data container. The module reports an
    absolute sandbox path; devicectl wants it relative to the container."""
    m = re.search(r"/Data/Application/[^/]+/(.*)$", remote_abs)
    rel = m.group(1) if m else remote_abs.lstrip("/")
    r = runner.run(["xcrun", "devicectl", "device", "copy", "from",
                    "--device", cfg.ios_udid,
                    "--domain-type", "appDataContainer",
                    "--domain-identifier", cfg.ios_bundle_id,
                    "--source", rel, "--destination", str(dest)],
                   capture=True, quiet=True, check=False) or ""
    return dest.exists()


def _keys(cfg):
    listfile = cfg.app_dir / "js" / "utils" / "RNTesterList.ios.js"
    if not listfile.exists():
        listfile = cfg.app_dir / "js" / "utils" / "RNTesterList.android.js"
    ks = re.findall(r"key: '([A-Za-z0-9_]+)'", listfile.read_text())
    seen, out = set(), []
    for k in ks:
        if k not in seen:
            seen.add(k)
            out.append(k)
    return out


# ---------------- physical device (stability only) ----------------
def _device_sweep(cfg, args, keys, outdir):
    logf = outdir / "console.log"
    proc_log = open(logf, "w")
    # one long-lived console session captures the whole sweep
    proc = subprocess.Popen(
        ["xcrun", "devicectl", "device", "process", "launch",
         "--device", cfg.ios_udid, "--terminate-existing", "--console",
         "--payload-url", f"rntester://example/{keys[0]}",
         cfg.ios_bundle_id],
        stdout=proc_log, stderr=subprocess.STDOUT, text=True)
    time.sleep(args.settle + 6)  # first launch pays app start
    def open_url(url):
        runner.run(["xcrun", "devicectl", "device", "process", "launch",
                    "--device", cfg.ios_udid, "--no-activate",
                    "--payload-url", url, cfg.ios_bundle_id],
                   capture=True, quiet=True, check=False)

    visited, shots = [], {}
    for i, key in enumerate(keys, 1):
        if i > 1:
            # relaunch with a new payload URL: devicectl has no "open url on a
            # running app", but this DOES deliver to the running instance
            open_url(f"rntester://example/{key}")
            time.sleep(args.settle)
        visited.append(key)
        if not args.no_shots:
            open_url(f"rntester://hybridshot/{key}")
            time.sleep(args.shot_wait)
            shots[key] = None
        if i % 10 == 0 or i == len(keys):
            log(f"  {i}/{len(keys)} screens")
    time.sleep(2)
    proc.terminate()
    proc_log.close()
    text = logf.read_text(errors="replace")

    # pull every screenshot the app reported, then score it
    results = {}
    if not args.no_shots:
        paths = dict(SHOT_RE.findall(text))
        log(f"  pulling {len(paths)} screenshots from the device container")
        for n, (key, remote) in enumerate(paths.items(), 1):
            if remote == "FAILED":
                results[key] = {"hash": None, "grid": [], "error": "capture failed"}
                continue
            dest = outdir / f"{key}.png"
            if _pull(cfg, remote, dest):
                try:
                    results[key] = sweep._png_signature(dest, crop_top=0, crop_bottom=0)
                except Exception as e:  # noqa: BLE001
                    results[key] = {"hash": None, "grid": [], "error": str(e)}
            else:
                results[key] = {"hash": None, "grid": [], "error": "pull failed"}
            if n % 20 == 0:
                log(f"    {n}/{len(paths)} pulled")
    errors = [l for l in text.splitlines()
              if IOS_ERROR_RE.search(l) and not IOS_IGNORE_RE.search(l)]
    # the app is alive if the console session never reported termination
    died = ("terminated" in text.lower() and "signal" in text.lower())
    return {
        "platform": "ios-device",
        "screens": len(visited),
        "visited": visited,
        "alive_at_end": not died,
        "errors": errors[:40],
        "error_count": len(errors),
        "signatures": results,
        "blankCaptures": [k for k, v in results.items() if sweep._is_blank(v)],
    }


# ---------------- simulator (full pixel parity) ----------------
def _sim_udid(cfg, args):
    out = runner.run(["xcrun", "simctl", "list", "devices", "booted", "-j"],
                     capture=True, quiet=True) or "{}"
    for _rt, devs in json.loads(out).get("devices", {}).items():
        for d in devs:
            if d.get("state") == "Booted":
                return d["udid"], d["name"]
    runner.fail("no booted simulator — `xcrun simctl boot \"iPhone 16 Pro\"`")


def _sim_sweep(cfg, args, keys, outdir):
    udid, name = _sim_udid(cfg, args)
    log(f"simulator: {name} ({udid})")
    runner.run(["xcrun", "simctl", "terminate", udid, cfg.ios_bundle_id],
               quiet=True, check=False)
    logf = outdir / "console.log"
    log_proc = subprocess.Popen(
        ["xcrun", "simctl", "spawn", udid, "log", "stream", "--style", "compact",
         "--predicate", f'processImagePath CONTAINS "RNTester"'],
        stdout=open(logf, "w"), stderr=subprocess.STDOUT, text=True)
    runner.run(["xcrun", "simctl", "launch", udid, cfg.ios_bundle_id],
               quiet=True, check=False)
    time.sleep(6)
    results = {}
    for i, key in enumerate(keys, 1):
        runner.run(["xcrun", "simctl", "openurl", udid,
                    f"rntester://example/{key}"], quiet=True, check=False)
        time.sleep(args.settle)
        shot = outdir / f"{key}.png"
        runner.run(["xcrun", "simctl", "io", udid, "screenshot", str(shot)],
                   quiet=True, check=False)
        try:
            results[key] = sweep._png_signature(shot, crop_top=0, crop_bottom=0)
        except Exception as e:  # noqa: BLE001
            results[key] = {"hash": None, "grid": [], "error": str(e)}
        if i % 10 == 0 or i == len(keys):
            log(f"  {i}/{len(keys)} screens")
    log_proc.terminate()
    text = logf.read_text(errors="replace")
    errors = [l for l in text.splitlines()
              if IOS_ERROR_RE.search(l) and not IOS_IGNORE_RE.search(l)]
    running = runner.run(["xcrun", "simctl", "spawn", udid, "launchctl", "list"],
                         capture=True, quiet=True, check=False) or ""
    blanks = [k for k, v in results.items() if sweep._is_blank(v)]
    return {
        "platform": "ios-simulator",
        "simulator": name,
        "screens": len(keys),
        "blankCaptures": blanks,
        "alive_at_end": cfg.ios_bundle_id in running,
        "errors": errors[:40],
        "error_count": len(errors),
        "signatures": results,
    }


def cmd_sweep_ios(cfg, args):
    keys = _keys(cfg)
    if args.limit:
        keys = keys[:args.limit]
    outdir = cfg.out / "sweep" / args.variant
    outdir.mkdir(parents=True, exist_ok=True)
    step(f"sweep-ios[{args.variant}] ({args.target}): {len(keys)} example screens")
    if args.target == "simulator":
        summary = _sim_sweep(cfg, args, keys, outdir)
    else:
        summary = _device_sweep(cfg, args, keys, outdir)
    summary["variant"] = args.variant
    (outdir / "summary.json").write_text(json.dumps(summary))
    print(f"  screens visited:  {summary['screens']}")
    if summary.get("blankCaptures"):
        print(f"  BLANK captures:   {len(summary['blankCaptures'])} — run invalid")
    print(f"  alive at end:     {summary['alive_at_end']}")
    print(f"  error lines:      {summary['error_count']}")
    for e in summary["errors"][:8]:
        print(f"    ! {e[:150]}")
    log(f"wrote {outdir}/summary.json")
    return summary


def cmd_noise(cfg, args):
    """Measure a screen's TRUE run-to-run noise with back-to-back captures.

    A self-baseline derived from two full sweeps under-reports periodic
    animations: the sweep's fixed cadence samples a spinner at correlated
    phases, so two runs can look almost identical while the screen is in fact
    highly nondeterministic. Capturing the same screen N times in a row, on
    one build, measures what the screen actually does.
    """
    import subprocess as sp
    screens = [k.strip() for k in args.screens.split(",") if k.strip()]
    outdir = cfg.out / "sweep" / f"noise-{args.variant}"
    outdir.mkdir(parents=True, exist_ok=True)
    step(f"noise[{args.variant}]: {len(screens)} screens x {args.repeats} captures")
    noise = {}
    for key in screens:
        logf = outdir / f"{key}.log"
        f = open(logf, "w")
        proc = sp.Popen(
            ["xcrun", "devicectl", "device", "process", "launch",
             "--device", cfg.ios_udid, "--terminate-existing", "--console",
             "--payload-url", f"rntester://example/{key}", cfg.ios_bundle_id],
            stdout=f, stderr=sp.STDOUT, text=True)
        time.sleep(args.settle + 8)
        for i in range(args.repeats):
            runner.run(["xcrun", "devicectl", "device", "process", "launch",
                        "--device", cfg.ios_udid, "--no-activate",
                        "--payload-url", f"rntester://hybridshot/{key}__{i}",
                        cfg.ios_bundle_id], capture=True, quiet=True, check=False)
            time.sleep(args.shot_wait)
        time.sleep(1.5)
        proc.terminate()
        f.close()
        paths = dict(SHOT_RE.findall(logf.read_text(errors="replace")))
        grids = []
        for tag, remote in sorted(paths.items()):
            if remote == "FAILED":
                continue
            dest = outdir / f"{tag}.png"
            if _pull(cfg, remote, dest):
                try:
                    grids.append(sweep._png_signature(dest, crop_top=0,
                                                      crop_bottom=0)["grid"])
                except Exception:  # noqa: BLE001
                    pass
        worst = 0
        for i in range(len(grids)):
            for j in range(i + 1, len(grids)):
                d = sum(1 for x, y in zip(grids[i], grids[j]) if abs(x - y) > 12)
                worst = max(worst, d)
        noise[key] = worst
        print(f"  {key}: {len(grids)} captures, worst pairwise diff {worst} cells")
    out = cfg.out / "sweep" / f"noise-{args.variant}.json"
    out.write_text(json.dumps({"differing": [{"key": k, "cells": v}
                                             for k, v in noise.items()]}, indent=2))
    log(f"wrote {out}")
    return noise
