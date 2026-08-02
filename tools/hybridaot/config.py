"""hybridaot configuration.

Loads hybridaot.config.json from the workspace root (two levels above this
package) and resolves every path to an absolute pathlib.Path. Defaults match
the AOT-RN workspace so the tool runs out of the box.
"""
import json
import pathlib

PACKAGE_DIR = pathlib.Path(__file__).resolve().parent
WORKSPACE = PACKAGE_DIR.parent.parent
CONFIG_PATH = WORKSPACE / "hybridaot.config.json"
OUT = WORKSPACE / "out" / "hybridaot"


class Config:
    def __init__(self, raw):
        self.raw = raw
        self.workspace = WORKSPACE
        self.out = OUT
        self.rn = self._path(raw.get("reactNative", "react-native"))
        self.hermes = self._path(raw.get("hermes", "hermes"))
        app = raw.get("app", {})
        self.app_dir = self._path(app.get("dir", "react-native/packages/rn-tester"))
        self.entry = app.get("entry", {})
        self.android_app_id = app.get("androidAppId", "")
        self.ios_bundle_id = app.get("iosBundleId", "")
        devices = raw.get("devices", {})
        self.android_serial = devices.get("android", "")
        self.ios_udid = devices.get("ios", "")
        self.platforms = raw.get("platforms", ["android"])
        self.bench = self._path(raw.get("bench", "bench/reconciler/real"))
        self.units_script = self._path(raw.get("unitsScript", "bench/hybrid/build-rn-registry.py"))
        self.units_out = self._path(raw.get("unitsOut", "bench/hybrid/out/rn"))
        self.profiles_dir = self._path(raw.get("profilesDir", "bench/hybrid/profiles"))
        self.profile_name = raw.get("profileName", "rn-tester-startup")
        self.ios_team = raw.get("iosTeam", "")
        self.ios_derived_data = pathlib.Path(raw.get("iosDerivedData", "")).expanduser()
        self.ndk_clang = pathlib.Path(raw.get("ndkClang", "")).expanduser()
        # derived
        self.hermes_bin = self.hermes / "build_release" / "bin" / "hermes"
        self.shermes_bin = self.hermes / "build_release" / "bin" / "shermes"
        self.manifest_dir = self.app_dir / "build"
        self.serializer = self.app_dir / "hybrid-serializer.js"
        self.hermes_env = {
            "REACT_NATIVE_OVERRIDE_HERMES_DIR": str(self.hermes),
            "RCT_BUILD_HERMES_FROM_SOURCE": "true",
        }

    def _path(self, rel):
        p = pathlib.Path(rel).expanduser()
        return p if p.is_absolute() else (WORKSPACE / p)

    def manifest_path(self, platform):
        return self.manifest_dir / f"hybrid-manifest-{platform}.json"

    def baked_manifest_path(self, platform):
        return self.units_out / f"manifest-baked-{platform}.json"

    def profile_path(self, platform):
        return self.profiles_dir / f"{self.profile_name}-{platform}.json"


def load():
    raw = {}
    if CONFIG_PATH.exists():
        raw = json.loads(CONFIG_PATH.read_text())
    cfg = Config(raw)
    cfg.out.mkdir(parents=True, exist_ok=True)
    return cfg
