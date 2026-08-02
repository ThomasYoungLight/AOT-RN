"""On-device ring-0 verification: launch the app, capture the demo's log
lines, assert the typed unit is BOUND (not the fail-safe interpreter) and
that its checksums match the gate expectation. Productizes the manual
protocol: cleared tag-filtered logcat on Android; `devicectl launch
--terminate-existing --console` on iOS (release RCTLog is compiled out —
the demo logs through the __hybridLog glog host function)."""
import json
import re
import subprocess
import time

from . import runner
from .runner import log, step

RING0_RE = re.compile(r"ring0=(\S+)")
IMPL_RE = re.compile(r"core\.impl=(\S+)")
HOST_RE = re.compile(r"checksum=(\d+) fx=(-?\d+)")
NATIVE_RE = re.compile(r"dispatch decisions: native=(\d+)")
RUN_RE = re.compile(r"ring0 run: (\d+) interactions.*?\(([\d.]+) ms/interaction\)")


def expected_values(cfg):
    gate_json = cfg.out / "gate-results.json"
    if gate_json.exists():
        data = json.loads(gate_json.read_text())
        lm = data.get("legacy-mutation", {})
        if lm.get("status") == "PASS":
            return lm["twin"]["checksum"], lm["twin"]["fx"]
    return None, None


def _assess(cfg, text, platform):
    impl = IMPL_RE.search(text)
    ring0 = RING0_RE.search(text)
    host = HOST_RE.search(text)
    native = NATIVE_RE.search(text)
    runline = RUN_RE.search(text)
    if not (impl and host):
        runner.fail(f"verify[{platform}]: demo output not found — did the app launch?"
                    f"\n{text[-600:]}")
    ok = True
    if "native" not in impl.group(1):
        log(f"verify[{platform}]: ring 0 NOT bound — running '{impl.group(1)}' "
            "(fail-safe interpreter). Stale manifest?")
        ok = False
    exp_cs, exp_fx = expected_values(cfg)
    cs, fx = host.group(1), host.group(2)
    if exp_cs and (cs, fx) != (exp_cs, exp_fx):
        log(f"verify[{platform}]: checksum MISMATCH device=({cs},{fx}) gate=({exp_cs},{exp_fx})")
        ok = False
    status = "PASS" if ok else "FAIL"
    print(f"  {status}  {platform}: impl={impl.group(1)}"
          + (f" ring0={ring0.group(1)}" if ring0 else "")
          + f" checksum={cs} fx={fx}"
          + (f" native-modules={native.group(1)}" if native else "")
          + (f" {runline.group(2)} ms/interaction" if runline else ""))
    return ok


def _verify_android(cfg):
    serial = cfg.android_serial
    adb = ["adb", "-s", serial]
    runner.run(adb + ["shell", "am", "force-stop", cfg.android_app_id], quiet=True)
    runner.run(adb + ["logcat", "-c"], quiet=True)
    runner.run(adb + ["shell", "monkey", "-p", cfg.android_app_id,
                      "-c", "android.intent.category.LAUNCHER", "1"],
               quiet=True, check=False)
    deadline = time.time() + 90
    text = ""
    while time.time() < deadline:
        time.sleep(5)
        text = runner.run(adb + ["logcat", "-d", "-s", "ReactNativeJS"],
                          capture=True, quiet=True) or ""
        if "demo end" in text:
            break
    return _assess(cfg, text, "android")


def _verify_ios(cfg):
    out_file = cfg.out / "verify-ios.log"
    with open(out_file, "w") as f:
        proc = subprocess.Popen(
            ["xcrun", "devicectl", "device", "process", "launch",
             "--terminate-existing", "--console",
             "--device", cfg.ios_udid, cfg.ios_bundle_id],
            stdout=f, stderr=subprocess.STDOUT, text=True)
        deadline = time.time() + 90
        while time.time() < deadline:
            time.sleep(5)
            if "demo end" in out_file.read_text():
                break
        proc.terminate()
    return _assess(cfg, out_file.read_text(), "ios")


def cmd_verify(cfg, args):
    platforms = args.platforms or cfg.platforms
    step("verify: on-device ring-0 assertion")
    ok = True
    if "android" in platforms:
        ok = _verify_android(cfg) and ok
    if "ios" in platforms:
        ok = _verify_ios(cfg) and ok
    if not ok:
        runner.fail("device verification failed")
    log("device verification PASSED")
