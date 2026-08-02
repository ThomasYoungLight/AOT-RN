"""Subprocess + logging helpers shared by all hybridaot commands."""
import os
import subprocess
import sys
import time


def log(msg):
    print(f"[hybridaot] {msg}")


def step(title):
    print(f"\n=== {title} ===")


def fail(msg):
    print(f"[hybridaot] FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def run(cmd, cwd=None, env_extra=None, capture=False, check=True, quiet=False):
    env = {**os.environ, **(env_extra or {})}
    if not quiet:
        print(f"+ [{cwd or '.'}] {' '.join(str(c) for c in cmd)}")
    r = subprocess.run(
        [str(c) for c in cmd], cwd=cwd, env=env, check=check,
        capture_output=capture, text=True,
    )
    return r.stdout if capture else None


class Timer:
    def __enter__(self):
        self.t0 = time.time()
        return self

    def __exit__(self, *a):
        self.ms = int((time.time() - self.t0) * 1000)
