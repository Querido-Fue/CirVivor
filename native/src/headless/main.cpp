#include "core/ids/entity_id.h"
#include "core/rng/deterministic_rng.h"
#include "core/state_hash/state_hasher.h"

#include <charconv>
#include <cstdint>
#include <iomanip>
#include <iostream>
#include <limits>
#include <string_view>

namespace {

struct Options final {
    std::uint64_t seed = 42;
    std::uint32_t ticks = 60;
};

enum class ParseResult : std::uint8_t {
    success,
    help,
    error
};

template <typename Value>
[[nodiscard]] bool parseUnsigned(const std::string_view text, Value& value) noexcept {
    const char* const begin = text.data();
    const char* const end = begin + text.size();
    const auto [position, error] = std::from_chars(begin, end, value);
    return error == std::errc{} && position == end;
}

[[nodiscard]] ParseResult parseOptions(
    const int argc,
    char** argv,
    Options& options
) {
    for (int index = 1; index < argc; ++index) {
        const std::string_view argument{argv[index]};
        if (argument == "--help") {
            std::cout << "usage: game_headless [--seed UINT64] [--ticks UINT32]\n";
            return ParseResult::help;
        }

        if (argument != "--seed" && argument != "--ticks") {
            std::cerr << "unknown argument: " << argument << '\n';
            return ParseResult::error;
        }
        if (index + 1 >= argc) {
            std::cerr << "missing value for " << argument << '\n';
            return ParseResult::error;
        }

        const std::string_view valueText{argv[++index]};
        if (argument == "--seed") {
            if (!parseUnsigned(valueText, options.seed)) {
                std::cerr << "invalid seed: " << valueText << '\n';
                return ParseResult::error;
            }
            continue;
        }

        if (!parseUnsigned(valueText, options.ticks) || options.ticks == 0U) {
            std::cerr << "ticks must be a positive UINT32 value\n";
            return ParseResult::error;
        }
    }
    return ParseResult::success;
}

} // namespace

int main(const int argc, char** argv) {
    Options options;
    const ParseResult parseResult = parseOptions(argc, argv, options);
    if (parseResult != ParseResult::success) {
        return parseResult == ParseResult::help ? 0 : 2;
    }

    cirvivor::core::DeterministicRng rng(options.seed, 54);
    cirvivor::core::StateHasher64 stateHasher;
    cirvivor::core::EntityId entity{0, 1};
    double position = 0;
    constexpr double fixedStepSeconds = 1.0 / 60.0;

    for (std::uint32_t tick = 0; tick < options.ticks; ++tick) {
        const auto direction = static_cast<std::int32_t>(rng.nextBounded(3U)) - 1;
        position += static_cast<double>(direction) * fixedStepSeconds;

        stateHasher.appendU32(tick);
        stateHasher.appendU64(entity.packed());
        stateHasher.appendDoubleBits(position);
        stateHasher.appendU64(rng.state());

        if ((tick + 1U) % 20U == 0U) {
            entity.generation = cirvivor::core::EntityId::nextGeneration(entity.generation);
        }
    }

    std::cout
        << "{\"ticks\":" << options.ticks
        << ",\"seed\":" << options.seed
        << ",\"stateHash\":\""
        << std::hex << std::setfill('0') << std::setw(16) << stateHasher.value()
        << "\"}\n";
    return 0;
}
