"""Startup-profile capture (PGO ring 1).

The dispatch prelude records every module factory that executes; the demo
dumps the executed ids in chunked `profile[k]: id,id,...` log lines shortly
after launch. This command launches the app, captures those lines, and
assembles profilesDir/<profileName>-<platform>.json in execution order.
"""
import json
import re
import subprocess
import time

from . import runner
from .runner import log, step

CHUNK_RE = re.compile(r"profile\[(\d+)\]: ([\d,]+)")
COUNT_RE = re.compile(r"executed: (\d+) module factories")


def _parse(text):
    chunks = {}
    for m in CHUNK_RE.finditer(text):
        chunks[int(m.group(1))] = [int(x) for x in m.group(2).split(",") if x]
    ids = []
    for k in sorted(chunks):
        ids.extend(chunks[k])
    want = COUNT_RE.search(text)
    if want and len(ids) != int(want.group(1)):
        log(f"WARNING: captured {len(ids)} ids, demo reported {want.group(1)}")
    return ids


def _capture_android(cfg):
    adb = ["adb", "-s", cfg.android_serial]
    runner.run(adb + ["shell", "am", "force-stop", cfg.android_app_id], quiet=True)
    runner.run(adb + ["logcat", "-c"], quiet=True)
    runner.run(adb + ["shell", "monkey", "-p", cfg.android_app_id,
                      "-c", "android.intent.category.LAUNCHER", "1"],
               quiet=True, check=False)
    deadline = time.time() + 60
    text = ""
    while time.time() < deadline:
        time.sleep(5)
        text = runner.run(adb + ["logcat", "-d", "-s", "ReactNativeJS"],
                          capture=True, quiet=True) or ""
        if COUNT_RE.search(text):
            break
    return text


def _capture_ios(cfg):
    out_file = cfg.out / "profile-ios.log"
    with open(out_file, "w") as f:
        proc = subprocess.Popen(
            ["xcrun", "devicectl", "device", "process", "launch",
             "--terminate-existing", "--console",
             "--device", cfg.ios_udid, cfg.ios_bundle_id],
            stdout=f, stderr=subprocess.STDOUT, text=True)
        deadline = time.time() + 60
        while time.time() < deadline:
            time.sleep(5)
            if COUNT_RE.search(out_file.read_text()):
                break
        proc.terminate()
    return out_file.read_text()


def cmd_profile(cfg, args):
    platforms = args.platforms or cfg.platforms
    for platform in platforms:
        step(f"profile pull ({platform})")
        text = _capture_android(cfg) if platform == "android" else _capture_ios(cfg)
        ids = _parse(text)
        if not ids:
            runner.fail(f"profile[{platform}]: no executed-id chunks captured — "
                        "is the demo build installed and logging?")
        cfg.profiles_dir.mkdir(parents=True, exist_ok=True)
        out = cfg.profile_path(platform)
        out.write_text(json.dumps({"executed_ids": [str(i) for i in ids]}, indent=0))
        log(f"{out}: {len(ids)} executed modules (execution order preserved)")
