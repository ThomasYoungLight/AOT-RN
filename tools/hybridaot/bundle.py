"""Metro manifest pass(es): rebuild the ring-0 JS twins, then bundle each
platform with HYBRID_MANIFEST_OUT so the serializer emits the id+hash
manifest the unit build keys against."""
from . import runner
from .runner import log, step


def cmd_bundle(cfg, args):
    platforms = args.platforms or cfg.platforms

    step("bundle: rebuild ring-0 JS twins")
    runner.run(["bash", cfg.bench / "build-rn-twin.sh"], quiet=True)
    runner.run(["bash", cfg.bench / "build-fabric-twin.sh"], quiet=True)

    for platform in platforms:
        step(f"bundle: Metro manifest pass ({platform})")
        entry = cfg.entry.get(platform)
        if not entry:
            runner.fail(f"no entry configured for platform {platform}")
        scratch = cfg.out / "bundle"
        scratch.mkdir(parents=True, exist_ok=True)
        runner.run(
            ["node", "../react-native/cli.js", "bundle",
             "--entry-file", entry,
             "--platform", platform, "--dev", "false", "--minify", "false",
             "--bundle-output", scratch / f"manifest-pass-{platform}.bundle",
             "--assets-dest", scratch / "assets"],
            cwd=cfg.app_dir,
            env_extra={"HYBRID_MANIFEST_OUT": str(cfg.manifest_path(platform))},
        )
        log(f"manifest: {cfg.manifest_path(platform)}")
    return platforms
