"""iOS screen sweep.

Two capture paths, because iOS gives very different tooling per target:

  device     `devicectl process launch --payload-url rntester://example/<key>`
             navigates; there is NO CLI screenshot on iOS 17+ (the classic
             screenshotr lockdown service is gone and devicectl has no
             equivalent), so the device run is STABILITY-ONLY: every screen is
             visited and the console is scanned for crashes/exceptions.
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
    visited = [keys[0]]
    for i, key in enumerate(keys[1:], 2):
        # relaunch with a new payload URL: devicectl has no "open url on a
        # running app", and a relaunch exercises cold navigation anyway
        runner.run(["xcrun", "devicectl", "device", "process", "launch",
                    "--device", cfg.ios_udid, "--no-activate",
                    "--payload-url", f"rntester://example/{key}",
                    cfg.ios_bundle_id],
                   capture=True, quiet=True, check=False)
        time.sleep(args.settle)
        visited.append(key)
        if i % 10 == 0 or i == len(keys):
            log(f"  {i}/{len(keys)} screens")
    time.sleep(2)
    proc.terminate()
    proc_log.close()
    text = logf.read_text(errors="replace")
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
        "signatures": {},
        "note": "stability only — iOS 17+ has no CLI screenshot for devices",
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
            results[key] = sweep._png_signature(shot)
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
