#!/usr/bin/env python3
"""LEGACY SHIM — the pipeline now lives in tools/hybridaot (see
claudedocs/hybridaot-product-design.md).

Preserved because "registry codegen ONLY via the orchestrator" is muscle
memory; this forwards to the same enforced ordering:

  orchestrate.py [--ios] [--install-android] [--install-ios]
    -> hybridaot build [--platform ...]      (bundle -> units -> gate matrix)
    -> hybridaot install [--platform ...]
"""
import pathlib
import subprocess
import sys

WS = pathlib.Path(__file__).resolve().parent.parent.parent


def forward(args):
    cmd = [sys.executable, "-m", "tools.hybridaot"] + args
    print("+ " + " ".join(cmd))
    subprocess.run(cmd, cwd=WS, check=True)


def main():
    platforms = ["--platform", "android"]
    if "--ios" in sys.argv:
        platforms += ["--platform", "ios"]
    forward(["build"] + platforms)
    install = []
    if "--install-android" in sys.argv:
        install += ["--platform", "android"]
    if "--install-ios" in sys.argv:
        install += ["--platform", "ios"]
    if install:
        forward(["install"] + install)
    print("\nORCHESTRATION COMPLETE")


if __name__ == "__main__":
    main()
