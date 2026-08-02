"""Screen sweep — stability + visual-parity testing across a real app surface.

RNTester is Meta's kitchen-sink app: ~78 example modules covering nearly
every RN component and API. This walks every one of them by deep link
(rntester://example/<key>), captures a screenshot, and scans logcat for
crashes / red-box errors / JS exceptions.

Run it twice — once on the hybrid build, once on an all-interpreted control
build produced from the SAME bundle (units removed => stock React Native
behavior) — then `sweep compare` diffs the two runs:

  * crashes / exceptions that appear only in one variant
  * screenshots whose pixels differ (rendering divergence)

Pixel comparison uses a decoded-PNG hash plus a coarse per-tile difference
count, so a diff points at *where* on screen it differs.
"""
import json
import re
import subprocess
import time
import zlib

from . import runner
from .runner import log, step

# error signatures worth failing on, from the JS and native sides
ERROR_RE = re.compile(
    r"(FATAL EXCEPTION|AndroidRuntime.*?Exception|ReactNoCrashSoftException|"
    r"Unhandled (JS|SoftException)|Error: |Invariant Violation|"
    r"RedBox|ReactNativeJS.*?Exception|com\.facebook\.react\.common\.JavascriptException)",
    re.I)
# noise that is expected on a release build and not a stability signal
IGNORE_RE = re.compile(
    r"(Error: ENOENT|favicon|Failed to load font|NetworkingModule|"
    r"Unable to resolve host|SoLoader|WebSocket|Metro)", re.I)


def _example_keys(cfg):
    listfile = cfg.app_dir / "js" / "utils" / "RNTesterList.android.js"
    keys = re.findall(r"key: '([A-Za-z0-9_]+)'", listfile.read_text())
    # de-dup, preserve order
    seen, out = set(), []
    for k in keys:
        if k not in seen:
            seen.add(k)
            out.append(k)
    return out


def _adb(cfg, *args, **kw):
    return runner.run(["adb", "-s", cfg.android_serial, *args], quiet=True, **kw)


SCREEN_TIMEOUT_MS = 1800000


def _stay_awake(cfg, on):
    """Screen-off captures come back solid black and look like a total
    rendering divergence, so hold the display up for the whole run: wake,
    dismiss the (unsecured) lockscreen, and stretch the display timeout.
    A soak run in particular will otherwise doze the device mid-sweep."""
    _adb(cfg, "shell", "svc", "power", "stayon", "true" if on else "false",
         check=False)
    if on:
        _adb(cfg, "shell", "input", "keyevent", "KEYCODE_WAKEUP", check=False)
        _adb(cfg, "shell", "input", "keyevent", "82", check=False)  # dismiss keyguard
        _adb(cfg, "shell", "settings", "put", "system", "screen_off_timeout",
             str(SCREEN_TIMEOUT_MS), check=False)


def _is_blank(sig):
    grid = sig.get("grid") or []
    if not grid:
        return False
    lo, hi = min(grid), max(grid)
    return (hi - lo) < 8


def _app_pids(cfg):
    out = _adb(cfg, "shell", "pidof", cfg.android_app_id, capture=True) or ""
    return set(out.split())


def _app_errors(cfg, logs, pids):
    """Error lines belonging to OUR app only — a shared device logs plenty of
    unrelated failures (camera services, other apps) that are not signal."""
    keep = []
    for line in logs.splitlines():
        if not ERROR_RE.search(line) or IGNORE_RE.search(line):
            continue
        parts = line.split()
        pid = parts[2] if len(parts) > 3 else ""
        if pids and pid not in pids:
            continue
        keep.append(line)
    return keep


def _decode_png_gray(path, crop_top=96, crop_bottom=48, downscale=4):
    """Decode a screencap PNG to a coarse grayscale grid.

    Screenshots carry two sources of false difference: the status-bar clock
    (top) and the gesture pill / nav bar (bottom), so those bands are
    cropped. The remaining pixels are averaged into a downscaled grid, which
    makes the comparison robust to sub-pixel AA jitter while still catching
    any real layout or color divergence.
    """
    data = path.read_bytes()
    idat = b""
    width = height = 0
    bitdepth = colortype = 0
    pos = 8
    while pos < len(data):
        ln = int.from_bytes(data[pos:pos + 4], "big")
        typ = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            width = int.from_bytes(chunk[0:4], "big")
            height = int.from_bytes(chunk[4:8], "big")
            bitdepth, colortype = chunk[8], chunk[9]
        elif typ == b"IDAT":
            idat += chunk
        elif typ == b"IEND":
            break
        pos += 12 + ln
    if bitdepth != 8 or colortype not in (2, 6):
        raise ValueError(f"unsupported PNG ({bitdepth}bit type{colortype})")
    nch = 3 if colortype == 2 else 4
    raw = zlib.decompress(idat)
    stride = width * nch

    # undo PNG row filters
    out = bytearray(height * stride)
    prev = bytearray(stride)
    p_in = 0
    for y in range(height):
        ft = raw[p_in]
        p_in += 1
        row = bytearray(raw[p_in:p_in + stride])
        p_in += stride
        if ft == 1:
            for i in range(nch, stride):
                row[i] = (row[i] + row[i - nch]) & 0xFF
        elif ft == 2:
            for i in range(stride):
                row[i] = (row[i] + prev[i]) & 0xFF
        elif ft == 3:
            for i in range(stride):
                left = row[i - nch] if i >= nch else 0
                row[i] = (row[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif ft == 4:
            for i in range(stride):
                a = row[i - nch] if i >= nch else 0
                b = prev[i]
                c = prev[i - nch] if i >= nch else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                row[i] = (row[i] + pr) & 0xFF
        out[y * stride:(y + 1) * stride] = row
        prev = row

    y0, y1 = crop_top, max(height - crop_bottom, crop_top + 1)
    gw, gh = width // downscale, (y1 - y0) // downscale
    grid = []
    for gy in range(gh):
        for gx in range(gw):
            acc = 0
            for dy in range(downscale):
                base = ((y0 + gy * downscale + dy) * stride) + (gx * downscale * nch)
                for dx in range(downscale):
                    o = base + dx * nch
                    acc += out[o] + out[o + 1] + out[o + 2]
            grid.append(acc // (downscale * downscale * 3))
    return {"grid": grid, "w": gw, "h": gh, "size": [width, height]}


def _png_signature(path):
    g = _decode_png_gray(path)
    return {
        "hash": zlib.crc32(bytes(g["grid"])) & 0xFFFFFFFF,
        "grid": g["grid"],
        "gw": g["w"], "gh": g["h"],
        "size": g["size"],
    }


def cmd_sweep(cfg, args):
    if args.action == "compare":
        return _compare(cfg, args)
    if args.action == "soak":
        return cmd_soak(cfg, args)
    if args.action == "reanalyze":
        return cmd_reanalyze(cfg, args)

    variant = args.variant
    outdir = cfg.out / "sweep" / variant
    outdir.mkdir(parents=True, exist_ok=True)
    keys = _example_keys(cfg)
    if args.limit:
        keys = keys[:args.limit]
    step(f"sweep[{variant}]: {len(keys)} example screens")

    _stay_awake(cfg, True)
    _adb(cfg, "shell", "am", "force-stop", cfg.android_app_id)
    _adb(cfg, "logcat", "-c")
    # the display can take a few seconds to come up after a doze; capture a
    # throwaway frame until it is actually rendering, or the first screens
    # come back black and look like a total divergence
    _adb(cfg, "shell", "am", "start", "-a", "android.intent.action.VIEW",
         "-d", f"rntester://example/{keys[0]}", cfg.android_app_id, check=False)
    warm = cfg.out / "sweep" / "_warmup.png"
    for attempt in range(12):
        time.sleep(2)
        with open(warm, "wb") as f:
            subprocess.run(["adb", "-s", cfg.android_serial, "exec-out",
                            "screencap", "-p"], stdout=f, check=True)
        try:
            if not _is_blank(_png_signature(warm)):
                break
        except Exception:  # noqa: BLE001
            pass
        _stay_awake(cfg, True)
    else:
        runner.fail("display never woke — captures would all be blank")
    results = {}
    for i, key in enumerate(keys, 1):
        _adb(cfg, "shell", "am", "start", "-a", "android.intent.action.VIEW",
             "-d", f"rntester://example/{key}", cfg.android_app_id, check=False)
        time.sleep(args.settle)
        shot = outdir / f"{key}.png"
        with open(shot, "wb") as f:
            subprocess.run(["adb", "-s", cfg.android_serial, "exec-out",
                            "screencap", "-p"], stdout=f, check=True)
        try:
            sig = _png_signature(shot)
        except Exception as e:  # noqa: BLE001 - a corrupt capture is data, not a crash
            sig = {"hash": None, "tiles": [], "size": [0, 0], "error": str(e)}
        results[key] = sig
        if i % 10 == 0 or i == len(keys):
            log(f"  {i}/{len(keys)} screens")

    blanks = [k for k, v in results.items() if _is_blank(v)]
    _stay_awake(cfg, False)
    pids = _app_pids(cfg)
    logs = _adb(cfg, "logcat", "-d", capture=True) or ""
    (outdir / "logcat.txt").write_text(logs)
    errors = _app_errors(cfg, logs, pids)
    alive = bool(pids)

    summary = {
        "variant": variant,
        "screens": len(keys),
        "blankCaptures": blanks,
        "alive_at_end": alive,
        "errors": errors[:40],
        "error_count": len(errors),
        "signatures": results,
    }
    (outdir / "summary.json").write_text(json.dumps(summary, indent=2))
    print(f"  screens captured: {len(keys)}")
    if blanks:
        print(f"  BLANK captures:   {len(blanks)} (screen off / not rendering) "
              f"— run invalid: {blanks[:5]}")
    print(f"  app alive at end: {alive}")
    print(f"  error lines:      {len(errors)}")
    for e in errors[:8]:
        print(f"    ! {e[:150]}")
    log(f"wrote {outdir}/summary.json")
    return summary


def cmd_reanalyze(cfg, args):
    """Recompute signatures from PNGs already captured for a variant —
    lets the comparison metric evolve without re-running the device."""
    d = cfg.out / "sweep" / args.variant
    summary = json.loads((d / "summary.json").read_text())
    step(f"reanalyze[{args.variant}]: {len(summary['signatures'])} captures")
    sigs = {}
    for i, key in enumerate(summary["signatures"], 1):
        png = d / f"{key}.png"
        try:
            sigs[key] = _png_signature(png)
        except Exception as e:  # noqa: BLE001
            sigs[key] = {"hash": None, "grid": [], "error": str(e)}
        if i % 20 == 0:
            log(f"  {i} decoded")
    summary["signatures"] = sigs
    (d / "summary.json").write_text(json.dumps(summary))
    log(f"rewrote {d}/summary.json")
    return summary


def cmd_soak(cfg, args):
    """Random-input stress test (adb monkey) — catches crashes that a
    scripted screen walk cannot: rapid navigation, gestures mid-render,
    orientation churn, back-stack thrash."""
    step(f"soak[{args.variant}]: {args.events} random events")
    _stay_awake(cfg, True)
    _adb(cfg, "shell", "am", "force-stop", cfg.android_app_id)
    _adb(cfg, "logcat", "-c")
    out = runner.run(
        ["adb", "-s", cfg.android_serial, "shell", "monkey",
         "-p", cfg.android_app_id, "--pct-syskeys", "0", "--throttle", "40",
         "--ignore-timeouts", "--monitor-native-crashes", "-v",
         str(args.events)],
        capture=True, quiet=True, check=False) or ""
    pids = _app_pids(cfg)
    logs = _adb(cfg, "logcat", "-d", capture=True) or ""
    errors = _app_errors(cfg, logs, pids)
    alive = bool(pids)
    completed = "Events injected:" in out
    injected = re.search(r"Events injected: (\d+)", out)
    crashed = ("// CRASH" in out) or ("// NOT RESPONDING" in out)
    summary = {
        "variant": args.variant,
        "requested": args.events,
        "injected": int(injected.group(1)) if injected else 0,
        "completed": completed,
        "monkeyReportedCrash": crashed,
        "aliveAtEnd": alive,
        "errorCount": len(errors),
        "errors": errors[:30],
    }
    d = cfg.out / "sweep" / args.variant
    d.mkdir(parents=True, exist_ok=True)
    (d / "soak.json").write_text(json.dumps(summary, indent=2))
    (d / "soak-logcat.txt").write_text(logs)
    print(f"  events injected:  {summary['injected']}/{args.events}")
    print(f"  monkey crash:     {crashed}")
    print(f"  app alive at end: {alive}")
    print(f"  error lines:      {len(errors)}")
    for e in errors[:8]:
        print(f"    ! {e[:150]}")
    log(f"wrote {d}/soak.json")
    return summary


def _compare(cfg, args):
    a_dir = cfg.out / "sweep" / args.a
    b_dir = cfg.out / "sweep" / args.b
    a = json.loads((a_dir / "summary.json").read_text())
    b = json.loads((b_dir / "summary.json").read_text())
    step(f"sweep compare: {args.a} vs {args.b}")

    keys = [k for k in a["signatures"] if k in b["signatures"]]
    TOL = 12          # per-cell grayscale tolerance (AA / gradient jitter)
    CELL_FLOOR = 6    # cells that must differ before a screen counts as divergent
    identical, differing, failed = [], [], []
    for k in keys:
        sa, sb = a["signatures"][k], b["signatures"][k]
        ga, gb = sa.get("grid"), sb.get("grid")
        if not ga or not gb or len(ga) != len(gb):
            failed.append(k)
            continue
        diffs = [i for i, (x, y) in enumerate(zip(ga, gb)) if abs(x - y) > TOL]
        if len(diffs) <= CELL_FLOOR:
            identical.append(k)
        else:
            gw = sa.get("gw") or 1
            rows = [i // gw for i in diffs]
            cols = [i % gw for i in diffs]
            differing.append({
                "key": k,
                "cells": len(diffs),
                "totalCells": len(ga),
                "pctArea": round(100.0 * len(diffs) / len(ga), 2),
                "bbox": {"x0": min(cols), "x1": max(cols),
                         "y0": min(rows), "y1": max(rows)},
                "maxDelta": max(abs(ga[i] - gb[i]) for i in diffs),
            })

    print(f"  screens compared:   {len(keys)}")
    print(f"  pixel-identical:    {len(identical)}  (<= {CELL_FLOOR} cells over tol {TOL})")
    print(f"  differing:          {len(differing)}")
    print(f"  capture failures:   {len(failed)}")
    for d in sorted(differing, key=lambda x: -x["cells"])[:15]:
        bb = d["bbox"]
        print(f"    ~ {d['key']}: {d['cells']} cells ({d['pctArea']}% of area), "
              f"maxDelta {d['maxDelta']}, bbox x{bb['x0']}-{bb['x1']} y{bb['y0']}-{bb['y1']}")
    print(f"  errors {args.a}: {a['error_count']} | {args.b}: {b['error_count']}")
    print(f"  alive at end — {args.a}: {a['alive_at_end']} | {args.b}: {b['alive_at_end']}")

    # Baseline subtraction: a screen only counts as DIVERGENT if the
    # cross-variant difference exceeds that screen's own run-to-run noise
    # (animations, toasts, spinners are inherently nondeterministic).
    verdict = None
    if args.baseline:
        bl_path = cfg.out / "sweep" / f"compare-{args.baseline}.json"
        if bl_path.exists():
            bl = {d["key"]: d["cells"] for d in json.loads(bl_path.read_text())["differing"]}
            real, noise = [], []
            for d in differing:
                nz = bl.get(d["key"], 0)
                (real if d["cells"] > max(nz * 1.5, nz + 200) else noise).append(
                    {**d, "selfNoiseCells": nz})
            verdict = {"realDivergences": real, "withinSelfNoise": noise}
            print(f"\n  baseline {args.baseline}:")
            print(f"    within self-noise:  {len(noise)}  "
                  + ", ".join(f"{d['key']}({d['cells']}v{d['selfNoiseCells']})" for d in noise))
            print(f"    REAL divergences:   {len(real)}  "
                  + ", ".join(f"{d['key']}({d['cells']}v{d['selfNoiseCells']})" for d in real))
        else:
            print(f"  (baseline {bl_path} not found)")

    result = {
        "a": args.a, "b": args.b,
        "verdict": verdict,
        "compared": len(keys),
        "identical": len(identical),
        "differing": differing,
        "captureFailures": failed,
        "errors": {args.a: a["error_count"], args.b: b["error_count"]},
        "aliveAtEnd": {args.a: a["alive_at_end"], args.b: b["alive_at_end"]},
    }
    out = cfg.out / "sweep" / f"compare-{args.a}-vs-{args.b}.json"
    out.write_text(json.dumps(result, indent=2))
    log(f"wrote {out}")
    stable = a["alive_at_end"] and b["alive_at_end"] and not failed
    if verdict is not None:
        # with a self-noise baseline, only differences EXCEEDING the same-binary
        # run-to-run variation count as divergence
        if verdict["realDivergences"] or not stable:
            log("DIVERGENCE or instability detected — inspect the screens above")
        else:
            log(f"PARITY: {len(identical)} screens pixel-identical, "
                f"{len(verdict['withinSelfNoise'])} differ only within self-noise "
                "(animations), 0 real divergences; both variants stable")
    elif differing or not stable:
        log("DIVERGENCE or instability detected — re-run with --baseline "
            "<self-compare> to discount animated screens")
    else:
        log("PARITY: every screen pixel-identical, both variants stable")
    return result
