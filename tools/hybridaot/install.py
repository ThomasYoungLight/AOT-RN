"""Device release builds + install (gradle / xcodebuild + devicectl)."""
from . import runner
from .runner import step


def cmd_install(cfg, args):
    platforms = args.platforms or cfg.platforms
    if "android" in platforms:
        step("install: Android release build + install")
        runner.run(["./gradlew", ":packages:rn-tester:android:app:installRelease",
                    "-PreactNativeArchitectures=arm64-v8a",
                    "-Preact.internal.useHermesNightly=false"],
                   cwd=cfg.rn,
                   env_extra={**cfg.hermes_env, "ANDROID_SERIAL": cfg.android_serial})
    if "ios" in platforms:
        step("install: iOS release build + install")
        runner.run(["xcodebuild", "-workspace", "RNTesterPods.xcworkspace",
                    "-scheme", "RNTester", "-configuration", "Release",
                    "-destination", f"platform=iOS,id={cfg.ios_udid}",
                    f"DEVELOPMENT_TEAM={cfg.ios_team}", "CODE_SIGN_STYLE=Automatic",
                    "-allowProvisioningUpdates", "build"],
                   cwd=cfg.app_dir, env_extra=cfg.hermes_env)
        app = cfg.ios_derived_data / "Build/Products/Release-iphoneos/RNTester.app"
        runner.run(["xcrun", "devicectl", "device", "install", "app",
                    "--device", cfg.ios_udid, str(app)])
