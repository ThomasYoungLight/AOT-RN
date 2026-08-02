"""CI composite: doctor (essential) -> bundle -> units -> gate matrix,
summarized in out/hybridaot/ci-summary.json. Device-free; add
`hybridaot install && hybridaot verify` on device-attached runners."""
import json
import time

from . import bundle, doctor, gates, units
from .runner import log, step


class _A:
    def __init__(self, **kw):
        self.__dict__.update(kw)


def cmd_ci(cfg, args):
    t0 = time.time()
    summary = {"steps": {}}

    doctor.cmd_doctor(cfg, args, essential_only=True)
    summary["steps"]["doctor"] = "PASS"

    platforms = args.platforms or cfg.platforms
    bundle.cmd_bundle(cfg, _A(platforms=platforms))
    summary["steps"]["bundle"] = platforms

    units.cmd_units(cfg, _A(platforms=platforms, force=False, ring1_all=args.ring1_all))
    summary["steps"]["units"] = "built"

    gate_results = gates.cmd_gate(cfg, _A(suite="all"))
    summary["steps"]["gates"] = {k: v["status"] for k, v in gate_results.items()}

    summary["totalMs"] = int((time.time() - t0) * 1000)
    out = cfg.out / "ci-summary.json"
    out.write_text(json.dumps(summary, indent=2))
    step("ci summary")
    for k, v in summary["steps"].items():
        print(f"  {k}: {v}")
    log(f"wrote {out}")
