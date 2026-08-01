// Interpreter baseline for iOS: embeds Hermes bytecode (like RN ships) and
// evaluates it through the same HermesRuntime API RN uses. Installs a print()
// host function so the benchmark's output reaches stdout.
#include <hermes/hermes.h>
#include <jsi/jsi.h>

#include <cstdio>
#include <memory>

#include "bench2_hbc.h"

using namespace facebook;

namespace {
class BytesBuffer : public jsi::Buffer {
 public:
  BytesBuffer(const uint8_t *data, size_t size) : data_(data), size_(size) {}
  size_t size() const override { return size_; }
  const uint8_t *data() const override { return data_; }

 private:
  const uint8_t *data_;
  size_t size_;
};
} // namespace

int main() {
  auto runtime = facebook::hermes::makeHermesRuntime();
  auto printFn = jsi::Function::createFromHostFunction(
      *runtime,
      jsi::PropNameID::forAscii(*runtime, "print"),
      1,
      [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) {
        for (size_t i = 0; i < count; ++i) {
          std::printf("%s%s", i ? " " : "", args[i].toString(rt).utf8(rt).c_str());
        }
        std::printf("\n");
        std::fflush(stdout);
        return jsi::Value::undefined();
      });
  runtime->global().setProperty(*runtime, "print", printFn);

  auto buffer = std::make_shared<BytesBuffer>(bench2_dynamic_hbc, bench2_dynamic_hbc_len);
  try {
    runtime->evaluateJavaScript(buffer, "bench2-dynamic.hbc");
  } catch (const std::exception &e) {
    std::printf("ERROR: %s\n", e.what());
    return 1;
  }
  return 0;
}
