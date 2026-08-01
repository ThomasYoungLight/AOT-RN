// iOS variant of the hybrid AOT/OTA prototype host: runs all three scenarios
// in one launch (no argv plumbing through devicectl), loading the .hbc bundles
// from the app bundle directory (derived from argv[0]).
#include <hermes/hermes.h>
#include <jsi/jsi.h>

#include <cstdio>
#include <fstream>
#include <memory>
#include <string>
#include <vector>

struct SHUnit;
extern "C" SHUnit *sh_export_core(void);
extern "C" SHUnit *sh_export_util(void);

namespace jsi = facebook::jsi;

class FileBuffer : public jsi::Buffer {
 public:
  explicit FileBuffer(const std::string &path) {
    std::ifstream f(path, std::ios::binary | std::ios::ate);
    if (!f) {
      fprintf(stderr, "cannot open %s\n", path.c_str());
      exit(1);
    }
    auto size = f.tellg();
    data_.resize((size_t)size);
    f.seekg(0);
    f.read((char *)data_.data(), size);
  }
  size_t size() const override { return data_.size(); }
  const uint8_t *data() const override { return data_.data(); }

 private:
  std::vector<uint8_t> data_;
};

static void runScenario(const char *title, const std::string &hbcPath, bool useNative) {
  printf("===== %s =====\n", title);
  fflush(stdout);
  auto runtime = facebook::hermes::makeHermesRuntime();
  auto print = jsi::Function::createFromHostFunction(
      *runtime,
      jsi::PropNameID::forAscii(*runtime, "print"),
      1,
      [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) -> jsi::Value {
        for (size_t i = 0; i < count; i++) {
          if (i)
            printf(" ");
          printf("%s", args[i].toString(rt).utf8(rt).c_str());
        }
        printf("\n");
        fflush(stdout);
        return jsi::Value::undefined();
      });
  runtime->global().setProperty(*runtime, "print", print);
  try {
    if (useNative) {
      runtime->evaluateSHUnit(sh_export_core);
      runtime->evaluateSHUnit(sh_export_util);
      printf("[host] native SHUnits evaluated: core (typed), util (untyped)\n");
    } else {
      printf("[host] no-native: skipping SHUnits, pure interpreter\n");
    }
    runtime->evaluateJavaScript(std::make_shared<FileBuffer>(hbcPath), hbcPath);
  } catch (const std::exception &e) {
    fprintf(stderr, "JS error: %s\n", e.what());
  }
  printf("\n");
  fflush(stdout);
}

int main(int argc, char **argv) {
  std::string dir = argv[0];
  auto slash = dir.rfind('/');
  dir = slash == std::string::npos ? "." : dir.substr(0, slash);

  runScenario("SCENARIO 1: fresh install (v1, native on)", dir + "/bundle-v1.hbc", true);
  runScenario("SCENARIO 2: OTA hotfix (v2, util changed)", dir + "/bundle-v2.hbc", true);
  runScenario("SCENARIO 3: baseline (v1, no-native)", dir + "/bundle-v1.hbc", false);
  printf("ALL SCENARIOS DONE\n");
  fflush(stdout);
  return 0;
}
