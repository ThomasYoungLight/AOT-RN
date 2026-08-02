"""hybridaot — the hybrid AOT+OTA toolchain CLI.

  doctor       toolchain / env / device checks
  bundle       Metro manifest pass(es) (rebuilds ring-0 twins first)
  units        registry codegen + shermes units (+ baked-manifest snapshot)
  gate         equivalence gate matrix (twin vs typed port), JSON + exit code
  build        bundle -> units -> gate (ordering enforced)
  install      device release builds + install
  verify       launch on device, assert ring-0 binding + checksums
  profile      pull startup execution profile from a device (PGO ring 1)
  ota-impact   what an OTA bundle would shadow, incl. hot modules
  ci           doctor -> bundle -> units -> gate, summary JSON
"""
import argparse

from . import (bundle, ci, config, doctor, gates, install, ota, profile_cmd,
               sweep, sweep_ios, units, verify)


def _platforms_arg(p):
    p.add_argument("--platform", dest="platforms", action="append",
                   choices=["android", "ios"],
                   help="platform (repeatable; default: config)")


def main(argv=None):
    parser = argparse.ArgumentParser(prog="hybridaot", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("doctor", help="toolchain / env / device checks")

    p = sub.add_parser("bundle", help="Metro manifest pass(es)")
    _platforms_arg(p)

    p = sub.add_parser("units", help="registry codegen + shermes units")
    _platforms_arg(p)
    p.add_argument("--force", action="store_true",
                   help="override the stale-manifest freshness guard")
    p.add_argument("--ring1-all", action="store_true",
                   help="compile all probe-passing ring-1 candidates (ignore profile)")

    p = sub.add_parser("gate", help="equivalence gate matrix")
    p.add_argument("--suite", default="all",
                   choices=["all"] + list(gates.SUITES.keys()))

    p = sub.add_parser("build", help="bundle -> units -> gate")
    _platforms_arg(p)
    p.add_argument("--ring1-all", action="store_true")

    p = sub.add_parser("install", help="device release builds + install")
    _platforms_arg(p)

    p = sub.add_parser("verify", help="on-device ring-0 assertion")
    _platforms_arg(p)

    p = sub.add_parser("profile", help="profile operations")
    p.add_argument("action", choices=["pull"])
    _platforms_arg(p)

    p = sub.add_parser("ota-impact", help="OTA shadowing analysis")
    p.add_argument("--platform", default="android", choices=["android", "ios"])
    p.add_argument("--baked", type=config.pathlib.Path, default=None,
                   help="baked-manifest snapshot (default: units output)")
    p.add_argument("--new-manifest", type=config.pathlib.Path, default=None,
                   help="OTA candidate manifest (default: current bundle manifest)")
    p.add_argument("--max-hot-shadowed", type=int, default=None,
                   help="fail if more than N hot (profiled) modules would be shadowed")

    p = sub.add_parser("sweep", help="app-surface stability + visual-parity sweep")
    p.add_argument("action", choices=["run", "compare", "soak", "reanalyze"])
    p.add_argument("--variant", default="hybrid",
                   help="label for this run's captures (run)")
    p.add_argument("--settle", type=float, default=1.6,
                   help="seconds to wait after each deep-link navigation")
    p.add_argument("--limit", type=int, default=None,
                   help="only sweep the first N screens")
    p.add_argument("--a", default="hybrid", help="first variant (compare)")
    p.add_argument("--b", default="control", help="second variant (compare)")
    p.add_argument("--baseline", default=None,
                   help="self-noise compare name, e.g. control-vs-control2")
    p.add_argument("--target", default="android",
                   choices=["android", "device", "simulator"],
                   help="android (adb) | device (iOS phone, stability only) "
                        "| simulator (iOS, full pixel capture)")
    p.add_argument("--events", type=int, default=3000,
                   help="random events to inject (soak)")

    p = sub.add_parser("ci", help="doctor -> bundle -> units -> gate")
    _platforms_arg(p)
    p.add_argument("--ring1-all", action="store_true")

    args = parser.parse_args(argv)
    cfg = config.load()

    if args.cmd == "doctor":
        doctor.cmd_doctor(cfg, args)
    elif args.cmd == "bundle":
        bundle.cmd_bundle(cfg, args)
    elif args.cmd == "units":
        units.cmd_units(cfg, args)
    elif args.cmd == "gate":
        gates.cmd_gate(cfg, args)
    elif args.cmd == "build":
        bundle.cmd_bundle(cfg, args)
        units.cmd_units(cfg, ci._A(platforms=args.platforms, force=False,
                                   ring1_all=args.ring1_all))
        gates.cmd_gate(cfg, ci._A(suite="all"))
    elif args.cmd == "install":
        install.cmd_install(cfg, args)
    elif args.cmd == "verify":
        verify.cmd_verify(cfg, args)
    elif args.cmd == "profile":
        profile_cmd.cmd_profile(cfg, args)
    elif args.cmd == "ota-impact":
        ota.cmd_ota_impact(cfg, args)
    elif args.cmd == "sweep":
        if args.action == "run" and args.target in ("device", "simulator"):
            sweep_ios.cmd_sweep_ios(cfg, args)
        else:
            sweep.cmd_sweep(cfg, args)
    elif args.cmd == "ci":
        ci.cmd_ci(cfg, args)
