// Hybrid AOT/OTA prototype host.
// 1. Creates one HermesRuntime.
// 2. Unless --no-native: evaluates the SHUnits baked into this binary
//    (typed 'core' + untyped 'util'), which register global.__nativeModules.
// 3. Evaluates the given interpreted bundle (HBC bytecode); its __d prelude
//    dispatches each module to native or interpreter by content hash.
#include <hermes/hermes.h>
#include <jsi/jsi.h>

#include <cstdio>
#include <cstring>
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

int main(int argc, char **argv) {
  std::string bundlePath;
  bool useNative = true;
  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--no-native") == 0) {
      useNative = false;
    } else {
      bundlePath = argv[i];
    }
  }
  if (bundlePath.empty()) {
    fprintf(stderr, "usage: hybrid [--no-native] <bundle.hbc>\n");
    return 1;
  }

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
        return jsi::Value::undefined();
      });
  runtime->global().setProperty(*runtime, "print", print);

  try {
    if (useNative) {
      runtime->evaluateSHUnit(sh_export_core);
      runtime->evaluateSHUnit(sh_export_util);
      printf("[host] native SHUnits evaluated: core (typed), util (untyped)\n");
    } else {
      printf("[host] --no-native: skipping SHUnits, pure interpreter\n");
    }
    runtime->evaluateJavaScript(std::make_shared<FileBuffer>(bundlePath), bundlePath);
  } catch (const std::exception &e) {
    fprintf(stderr, "JS error: %s\n", e.what());
    return 1;
  }
  return 0;
}
