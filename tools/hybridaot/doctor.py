"""Toolchain / environment / device checks."""
import shutil
import subprocess

from .runner import log


def _check(results, name, ok, detail="", warn_only=False):
    status = "PASS" if ok else ("WARN" if warn_only else "FAIL")
    results.append((status, name, detail))
    print(f"  {status:4s}  {name:34s} {detail}")
    return ok


def cmd_doctor(cfg, args, essential_only=False):
    print("\n=== doctor ===")
    results = []

    _check(results, "config", True, str(cfg.workspace / "hybridaot.config.json"))
    _check(results, "hermes CLI", cfg.hermes_bin.exists(), str(cfg.hermes_bin))
    _check(results, "shermes", cfg.shermes_bin.exists(), str(cfg.shermes_bin))
    _check(results, "node", shutil.which("node") is not None, shutil.which("node") or "")
    _check(results, "app dir", cfg.app_dir.exists(), str(cfg.app_dir))
    _check(results, "serializer plugin", cfg.serializer.exists(), str(cfg.serializer))
    _check(results, "bench harnesses", (cfg.bench / "typed-port-core.ts").exists(), str(cfg.bench))
    _check(results, "units script", cfg.units_script.exists(), str(cfg.units_script))

    if "android" in cfg.platforms:
        cfg_glob = "packages/react-native/ReactAndroid/hermes-engine/.cxx/*/*/arm64-v8a/lib/config"
        found = sorted(cfg.rn.glob(cfg_glob))
        _check(results, "android hermes config (gradle)", bool(found),
               str(found[-1]) if found else "build hermes-engine once first", warn_only=essential_only)
        _check(results, "android NDK clang", cfg.ndk_clang.exists(), str(cfg.ndk_clang),
               warn_only=essential_only)
    if "ios" in cfg.platforms:
        ios_cfg = cfg.app_dir / "Pods" / "hermes-engine" / "build" / "iphoneos" / "lib" / "config"
        _check(results, "ios hermes config (pods)", ios_cfg.exists(), str(ios_cfg),
               warn_only=essential_only)

    if not essential_only:
        if cfg.android_serial:
            r = subprocess.run(["adb", "devices"], capture_output=True, text=True)
            ok = cfg.android_serial in (r.stdout or "")
            _check(results, "android device", ok, cfg.android_serial, warn_only=True)
        if cfg.ios_udid:
            r = subprocess.run(["xcrun", "devicectl", "list", "devices"],
                               capture_output=True, text=True)
            ok = cfg.ios_udid[:8] in (r.stdout or "") or "iPhone" in (r.stdout or "")
            _check(results, "ios device", ok, cfg.ios_udid, warn_only=True)

    failed = [r for r in results if r[0] == "FAIL"]
    warned = [r for r in results if r[0] == "WARN"]
    log(f"doctor: {len(results) - len(failed) - len(warned)} pass, "
        f"{len(warned)} warn, {len(failed)} fail")
    if failed:
        from . import runner
        runner.fail("doctor found blocking problems")
    return results
