# Pinned checkouts

The `react-native/` and `hermes/` clones are gitignored; reproduce the
workspace with:

| repo | remote | ref |
|---|---|---|
| react-native | https://github.com/ThomasYoungLight/react-native | branch `hybrid-aot` (9 commits on upstream `c7d62a125c1225802b55ca52e020a73e67f3ac98`) |
| hermes | https://github.com/facebook/hermes | `07596004f035bee428496aae8222eaff0a4803a7` (unmodified — shermes used as-is) |

Fallback if the fork disappears: `bench/patches/react-native-hybrid-aot.patch`
applies onto the upstream base commit above.

Build entry points: `tools/hybridaot/README.md`.
