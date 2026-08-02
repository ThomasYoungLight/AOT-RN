"""The equivalence gate matrix.

Every suite compares the JS twin (the REAL react-reconciler on the Hermes
interpreter, with the deterministic scheduler for concurrent suites) against
the shermes-compiled typed port on the SAME shared workload, and requires
every applicable accumulator to match:

  checksum  host-op stream (committed mutations / clones)
  fx        app-level render/effect ordering (incl. discarded renders)
  sched     scheduler trace (schedule/cancel/run/yield, work-unit exact)
  tree      committed-tree shape+props (contract-variant equivalence)

Assembly of entry files is serialized (the build scripts share generated
files); shermes compiles and runs are parallelized.
"""
import concurrent.futures
import json
import re

from . import runner
from .runner import log, step

# suite -> (twin build script, twin bundle, typed build script, typed entry,
#           accumulators to compare)
SUITES = {
    "legacy-mutation": {
        "twin_build": "build-real.sh",
        "twin_bundle": "real-react-bundle.js",
        "typed_build": "build-typed.sh",
        "typed_entry": "typed-entry.ts",
        "keys": ["checksum", "fx"],
    },
    "legacy-persistent": {
        "twin_build": "build-real-persistent.sh",
        "twin_bundle": "real-react-persistent-bundle.js",
        "typed_build": "build-typed-persistent.sh",
        "typed_entry": "typed-entry-persistent.ts",
        "keys": ["checksum", "fx", "tree"],
    },
    "concurrent-mutation": {
        "twin_build": "build-real-concurrent.sh",
        "twin_bundle": "real-react-concurrent-bundle.js",
        "typed_build": "build-typed-concurrent.sh",
        "typed_entry": "typed-entry-concurrent.ts",
        "keys": ["checksum", "fx", "sched"],
    },
    "concurrent-persistent": {
        "twin_build": "build-real-concurrent-persistent.sh",
        "twin_bundle": "real-react-concurrent-persistent-bundle.js",
        "typed_build": "build-typed-concurrent-persistent.sh",
        "typed_entry": "typed-entry-concurrent-persistent.ts",
        "keys": ["checksum", "fx", "sched", "tree"],
    },
    # The pass-children clone contract cannot be twin-verified op-by-op (the
    # npm reconciler predates the flag); the committed-tree checksum is the
    # equivalence axis. Twin bundles are reused from the persistent suites.
    "passchildren-legacy": {
        "twin_build": None,
        "twin_bundle": "real-react-persistent-bundle.js",
        "typed_build": "build-typed-persistent-passchildren.sh",
        "typed_entry": "typed-entry-persistent-passchildren.ts",
        "keys": ["tree", "fx"],
    },
    "passchildren-concurrent": {
        "twin_build": None,
        "twin_bundle": "real-react-concurrent-persistent-bundle.js",
        "typed_build": "build-typed-concurrent-persistent-passchildren.sh",
        "typed_entry": "typed-entry-concurrent-persistent-passchildren.ts",
        "keys": ["tree", "fx", "sched"],
    },
}

PATTERNS = {
    "checksum": re.compile(r"checksum=(\d+)"),
    "fx": re.compile(r"fx=(-?\d+)"),
    "sched": re.compile(r"sched=(\d+)"),
    "tree": re.compile(r"tree=(\d+)"),
}


def extract(output, keys, who):
    vals = {}
    for k in keys:
        m = PATTERNS[k].search(output)
        if not m:
            runner.fail(f"gate: no {k}= in {who} output:\n{output[-400:]}")
        vals[k] = m.group(1)
    return vals


def _ring0_unit_suite(cfg, results):
    """Gate the ACTUAL registry unit source (what ships in the binary)
    against the in-app twin module — the pipeline-level check."""
    reg = cfg.units_out / "registry-core-rn-android.ts"
    if not reg.exists():
        results["ring0-unit"] = {"status": "SKIP", "reason": "units not built yet (run `hybridaot units`)"}
        return
    smoke = cfg.out / "ring0-smoke.ts"
    smoke.write_text(
        reg.read_text()
        + "\nconst __r: any = makeTypedCoreExports().run();\nprint(String(__r.host));\n"
    )
    with runner.Timer() as t:
        typed_out = runner.run([cfg.shermes_bin, "-typed", "-O", "-exec", smoke],
                               capture=True, quiet=True)
        check_entry = cfg.out / "ring0-twin-check.cjs"
        check_entry.write_text(
            "if (typeof globalThis.setTimeout === 'undefined') {\n"
            "  globalThis.setTimeout = function () { return 0; };\n"
            "  globalThis.clearTimeout = function () {};\n"
            "}\n"
            "if (typeof globalThis.console === 'undefined') {\n"
            "  globalThis.console = {log: print, warn: print, error: print};\n"
            "}\n"
            f"var m = require('{cfg.bench}/twin-entry.cjs');\n"
            "var r = m.run();\nprint(r.host);\n"
        )
        runner.run(["npx", "esbuild", check_entry, "--bundle", "--format=iife",
                    "--platform=neutral",
                    "--define:process.env.NODE_ENV=\"production\"",
                    "--define:__DEV__=false",
                    f"--outfile={cfg.out / 'ring0-twin-check.js'}"],
                   cwd=cfg.bench, quiet=True)
        twin_out = runner.run([cfg.hermes_bin, "-O", cfg.out / "ring0-twin-check.js"],
                              capture=True, quiet=True)
    keys = ["checksum", "fx"]
    tv = extract(twin_out, keys, "ring0 twin")
    pv = extract(typed_out, keys, "ring0 unit")
    results["ring0-unit"] = {
        "status": "PASS" if tv == pv else "FAIL",
        "twin": tv, "typed": pv, "ms": t.ms,
    }


def cmd_gate(cfg, args):
    suites = SUITES if args.suite == "all" else {args.suite: SUITES[args.suite]}
    results = {}

    step("gate: assemble entries + twin bundles (serial)")
    built_twins = set()
    for name, s in suites.items():
        if s["twin_build"] and s["twin_build"] not in built_twins:
            runner.run(["bash", cfg.bench / s["twin_build"]], quiet=True)
            built_twins.add(s["twin_build"])
        runner.run(["bash", cfg.bench / s["typed_build"]], quiet=True)
    # pass-children suites reuse persistent twin bundles; make sure they exist
    for name, s in suites.items():
        if s["twin_build"] is None and not (cfg.bench / s["twin_bundle"]).exists():
            base = "build-real-persistent.sh" if "legacy" in name else "build-real-concurrent-persistent.sh"
            runner.run(["bash", cfg.bench / base], quiet=True)

    step(f"gate: compile {len(suites)} typed binaries (parallel) + run")

    def run_suite(item):
        name, s = item
        binary = cfg.out / f"gate-{name}"
        with runner.Timer() as t:
            runner.run([cfg.shermes_bin, "-typed", "-O", "-o", binary,
                        cfg.bench / s["typed_entry"]], quiet=True)
            twin_out = runner.run([cfg.hermes_bin, "-O", cfg.bench / s["twin_bundle"]],
                                  capture=True, quiet=True)
            typed_out = runner.run([binary], capture=True, quiet=True)
        tv = extract(twin_out, s["keys"], f"{name} twin")
        pv = extract(typed_out, s["keys"], f"{name} typed")
        return name, {
            "status": "PASS" if tv == pv else "FAIL",
            "twin": tv, "typed": pv, "ms": t.ms,
        }

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        for name, res in ex.map(run_suite, suites.items()):
            results[name] = res

    if args.suite == "all":
        _ring0_unit_suite(cfg, results)

    # report
    step("gate results")
    failed = False
    for name, res in results.items():
        if res["status"] == "SKIP":
            print(f"  SKIP  {name:26s} {res['reason']}")
            continue
        line = " ".join(f"{k}={v}" for k, v in res["typed"].items())
        print(f"  {res['status']:4s}  {name:26s} {line}  ({res['ms']} ms)")
        if res["status"] == "FAIL":
            failed = True
            print(f"        twin:  {res['twin']}")
            print(f"        typed: {res['typed']}")
    out_json = cfg.out / "gate-results.json"
    out_json.write_text(json.dumps(results, indent=2))
    log(f"wrote {out_json}")
    if failed:
        runner.fail("gate matrix FAILED — the typed port and the real reconciler diverged")
    log("gate matrix PASSED")
    return results
