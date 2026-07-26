#include "render/frontend/synthetic_test_scene.h"
#include "render/software/software_renderer.h"

#include <algorithm>
#include <array>
#include <charconv>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <limits>
#include <new>
#include <numeric>
#include <span>
#include <string_view>
#include <thread>
#include <vector>

namespace allocation_tracking {

thread_local bool enabled = false;
thread_local std::size_t allocationCount = 0;

void recordAllocation() noexcept {
    if (enabled) {
        ++allocationCount;
    }
}

} // namespace allocation_tracking

void* operator new(const std::size_t size) {
    if (void* const memory = std::malloc(size == 0U ? 1U : size)) {
        allocation_tracking::recordAllocation();
        return memory;
    }
    throw std::bad_alloc();
}

void* operator new[](const std::size_t size) {
    return ::operator new(size);
}

void operator delete(void* const memory) noexcept {
    std::free(memory);
}

void operator delete[](void* const memory) noexcept {
    ::operator delete(memory);
}

void operator delete(void* const memory, const std::size_t) noexcept {
    ::operator delete(memory);
}

void operator delete[](void* const memory, const std::size_t) noexcept {
    ::operator delete(memory);
}

namespace {

using Clock = std::chrono::steady_clock;

constexpr std::size_t minimum_warmup_frames = 30U;
constexpr std::size_t default_warmup_frames = 60U;
constexpr std::size_t minimum_measurement_frames = 120U;
constexpr std::size_t default_measurement_frames = 180U;
constexpr double software_frame_budget_milliseconds = 33.33;
constexpr std::uint64_t phase_37_golden_hash = 0x77fe'ca0d'b768'b39dULL;

#if defined(NDEBUG)
constexpr bool release_gate_default = true;
#else
constexpr bool release_gate_default = false;
#endif

class AllocationScope final {
public:
    AllocationScope() noexcept
        : previousEnabled_(allocation_tracking::enabled),
          startCount_(allocation_tracking::allocationCount) {
        allocation_tracking::enabled = true;
    }

    AllocationScope(const AllocationScope&) = delete;
    AllocationScope& operator=(const AllocationScope&) = delete;

    ~AllocationScope() {
        allocation_tracking::enabled = previousEnabled_;
    }

    [[nodiscard]] std::size_t allocationCount() const noexcept {
        return allocation_tracking::allocationCount - startCount_;
    }

private:
    bool previousEnabled_ = false;
    std::size_t startCount_ = 0;
};

struct Options final {
    std::size_t warmupFrames = default_warmup_frames;
    std::size_t measurementFrames = default_measurement_frames;
    bool enforceGate = release_gate_default;
    bool showHelp = false;
};

struct FrameResult final {
    bool buildSucceeded = false;
    bool renderSucceeded = false;
    cirvivor::render::frontend::FrameBuildError buildError =
        cirvivor::render::frontend::FrameBuildError::none;
    cirvivor::render::software::SoftwareRenderError renderError =
        cirvivor::render::software::SoftwareRenderError::none;
    cirvivor::render::software::SoftwareRenderStats stats{};
    double renderCallMilliseconds = 0.0;
    std::size_t allocations = 0;
};

struct Distribution final {
    double minimum = 0.0;
    double mean = 0.0;
    double p50 = 0.0;
    double p95 = 0.0;
    double p99 = 0.0;
    double maximum = 0.0;
};

[[nodiscard]] bool parseSize(
    const std::string_view value,
    std::size_t& output
) noexcept {
    std::uint64_t parsed = 0;
    const char* const begin = value.data();
    const char* const end = begin + value.size();
    const auto result = std::from_chars(begin, end, parsed);
    if (result.ec != std::errc{}
        || result.ptr != end
        || parsed > static_cast<std::uint64_t>(std::numeric_limits<std::size_t>::max())) {
        return false;
    }
    output = static_cast<std::size_t>(parsed);
    return true;
}

[[nodiscard]] bool parseOptions(
    const int argumentCount,
    char** const arguments,
    Options& options
) noexcept {
    for (int index = 1; index < argumentCount; ++index) {
        const std::string_view argument(arguments[index]);
        if (argument == "--gate") {
            options.enforceGate = true;
            continue;
        }
        if (argument == "--report-only") {
            options.enforceGate = false;
            continue;
        }
        if (argument == "--help") {
            options.showHelp = true;
            continue;
        }
        if (argument == "--warmup" || argument == "--frames") {
            if (index + 1 >= argumentCount) {
                return false;
            }
            std::size_t value = 0;
            ++index;
            if (!parseSize(arguments[index], value)) {
                return false;
            }
            if (argument == "--warmup") {
                options.warmupFrames = value;
            } else {
                options.measurementFrames = value;
            }
            continue;
        }
        return false;
    }
    return options.showHelp
        || (options.warmupFrames >= minimum_warmup_frames
            && options.measurementFrames >= minimum_measurement_frames);
}

void printUsage() {
    std::cout
        << "usage: software_renderer_benchmark [--warmup N] [--frames N] "
           "[--gate|--report-only]\n"
        << "  warmup minimum: " << minimum_warmup_frames << " frames\n"
        << "  measurement minimum: " << minimum_measurement_frames << " frames\n"
        << "  Release defaults to --gate; Debug defaults to --report-only.\n";
}

[[nodiscard]] FrameResult renderFrame(
    cirvivor::render::FramePacket& packet,
    cirvivor::render::software::SoftwareRenderer& renderer,
    cirvivor::render::frontend::SyntheticSceneConfig& config
) {
    using cirvivor::render::frontend::PacketCapacityPolicy;
    using cirvivor::render::frontend::buildSyntheticTestScene;

    FrameResult result;
    {
        AllocationScope allocationScope;
        const auto buildResult = buildSyntheticTestScene(
            packet,
            config,
            PacketCapacityPolicy::fixedCapacity
        );
        result.buildSucceeded = buildResult.success;
        result.buildError = buildResult.error;
        if (result.buildSucceeded) {
            const Clock::time_point start = Clock::now();
            result.renderSucceeded = renderer.render(packet);
            const Clock::time_point end = Clock::now();
            result.renderCallMilliseconds =
                std::chrono::duration<double, std::milli>(end - start).count();
            result.renderError = renderer.lastError();
            result.stats = renderer.lastStats();
        }
        result.allocations = allocationScope.allocationCount();
    }
    return result;
}

[[nodiscard]] bool frameIsValid(const FrameResult& result) noexcept {
    return result.buildSucceeded
        && result.renderSucceeded
        && result.buildError == cirvivor::render::frontend::FrameBuildError::none
        && result.renderError == cirvivor::render::software::SoftwareRenderError::none
        && result.stats.submittedCommands == 25U
        && result.stats.renderedCommands == 25U
        && result.stats.skippedCommands == 0U
        && std::isfinite(result.stats.wallClockMilliseconds)
        && result.stats.wallClockMilliseconds >= 0.0
        && std::isfinite(result.renderCallMilliseconds)
        && result.renderCallMilliseconds >= 0.0;
}

void printInvalidFrame(
    const std::string_view stage,
    const std::size_t index,
    const FrameResult& result
) {
    std::cerr
        << "validation failed during " << stage << " frame " << index
        << ": build=" << result.buildSucceeded
        << " buildError=" << static_cast<unsigned int>(result.buildError)
        << " render=" << result.renderSucceeded
        << " renderError=" << static_cast<unsigned int>(result.renderError)
        << " commands=" << result.stats.submittedCommands << '/'
        << result.stats.renderedCommands << '/'
        << result.stats.skippedCommands << '\n';
}

[[nodiscard]] double nearestRank(
    const std::span<const double> sorted,
    const double percentile
) noexcept {
    if (sorted.empty()) {
        return 0.0;
    }
    const double rank = std::ceil(
        percentile * static_cast<double>(sorted.size())
    );
    const std::size_t oneBased = std::clamp(
        static_cast<std::size_t>(rank),
        std::size_t{1},
        sorted.size()
    );
    return sorted[oneBased - 1U];
}

[[nodiscard]] Distribution summarize(const std::vector<double>& samples) {
    std::vector<double> sorted(samples);
    std::sort(sorted.begin(), sorted.end());
    const double total = std::accumulate(sorted.begin(), sorted.end(), 0.0);
    return {
        sorted.front(),
        total / static_cast<double>(sorted.size()),
        nearestRank(sorted, 0.50),
        nearestRank(sorted, 0.95),
        nearestRank(sorted, 0.99),
        sorted.back()
    };
}

[[nodiscard]] std::uint64_t mixHashes(
    const std::span<const std::uint64_t> hashes
) noexcept {
    constexpr std::uint64_t offsetBasis = 0xcbf2'9ce4'8422'2325ULL;
    constexpr std::uint64_t prime = 0x0000'0100'0000'01b3ULL;
    std::uint64_t result = offsetBasis;
    for (const std::uint64_t value : hashes) {
        for (std::uint32_t shift = 0; shift < 64U; shift += 8U) {
            result ^= static_cast<std::uint8_t>((value >> shift) & 0xffU);
            result *= prime;
        }
    }
    return result;
}

void printDistribution(
    const std::string_view label,
    const Distribution& distribution
) {
    std::cout
        << label
        << " min/mean/p50/p95/p99/max="
        << distribution.minimum << '/'
        << distribution.mean << '/'
        << distribution.p50 << '/'
        << distribution.p95 << '/'
        << distribution.p99 << '/'
        << distribution.maximum << " ms\n";
}

} // namespace

int main(const int argumentCount, char** const arguments) {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;
    using namespace cirvivor::render::software;

    Options options;
    if (!parseOptions(argumentCount, arguments, options)) {
        printUsage();
        return 64;
    }
    if (options.showHelp) {
        printUsage();
        return 0;
    }

    FramePacket packet(syntheticTestSceneCapacity());
    SoftwareRenderer renderer(SoftwareRenderer::default_internal_size);
    if (!renderer.isValid()
        || renderer.internalSize() != SoftwareRenderer::default_internal_size) {
        std::cerr << "failed to create the 960x540 software surface\n";
        return 1;
    }

    SyntheticSceneConfig config;
    config.drawableSize = SoftwareRenderer::default_internal_size;
    config.physicalDisplaySize = SoftwareRenderer::default_internal_size;
    config.physicalWindowBounds = {
        0,
        0,
        SoftwareRenderer::default_internal_size.width,
        SoftwareRenderer::default_internal_size.height
    };
    config.effectQuality = EffectQuality::softwareReplacement;

    config.phaseStep = 37U;
    config.frameId = 1U;
    config.simulationTick = 1U;
    const FrameResult preflight = renderFrame(packet, renderer, config);
    if (!frameIsValid(preflight) || preflight.allocations != 0U) {
        printInvalidFrame("preflight", 0U, preflight);
        std::cerr << "preflight C++ allocations=" << preflight.allocations << '\n';
        return 1;
    }
    const std::uint64_t goldenHash = renderer.pixelHash();
    if (goldenHash != phase_37_golden_hash) {
        std::cerr
            << "phase 37 pixel golden mismatch: actual=0x" << std::hex << goldenHash
            << " expected=0x" << phase_37_golden_hash << std::dec << '\n';
        return 1;
    }

    std::size_t totalAllocations = 0;
    for (std::size_t index = 0; index < options.warmupFrames; ++index) {
        const std::size_t frameOrdinal = index + 2U;
        config.phaseStep = static_cast<std::uint32_t>(frameOrdinal % 120U);
        config.frameId = static_cast<std::uint64_t>(frameOrdinal);
        config.simulationTick = static_cast<std::uint64_t>(frameOrdinal);
        const FrameResult result = renderFrame(packet, renderer, config);
        if (!frameIsValid(result)) {
            printInvalidFrame("warmup", index, result);
            return 1;
        }
        totalAllocations += result.allocations;
    }

    std::vector<double> rasterSamples;
    std::vector<double> renderCallSamples;
    rasterSamples.reserve(options.measurementFrames);
    renderCallSamples.reserve(options.measurementFrames);
    const std::array<std::size_t, 3> checkpointIndices{
        0U,
        options.measurementFrames / 2U,
        options.measurementFrames - 1U
    };
    std::array<std::uint64_t, 3> checkpointHashes{};
    std::size_t nextCheckpoint = 0U;
    std::uint64_t submittedCommands = 0;
    std::uint64_t renderedCommands = 0;
    std::uint64_t skippedCommands = 0;

    for (std::size_t index = 0; index < options.measurementFrames; ++index) {
        const std::size_t frameOrdinal = options.warmupFrames + index + 2U;
        config.phaseStep = static_cast<std::uint32_t>(frameOrdinal % 120U);
        config.frameId = static_cast<std::uint64_t>(frameOrdinal);
        config.simulationTick = static_cast<std::uint64_t>(frameOrdinal);
        const FrameResult result = renderFrame(packet, renderer, config);
        if (!frameIsValid(result)) {
            printInvalidFrame("measurement", index, result);
            return 1;
        }
        totalAllocations += result.allocations;
        rasterSamples.push_back(result.stats.wallClockMilliseconds);
        renderCallSamples.push_back(result.renderCallMilliseconds);
        submittedCommands += result.stats.submittedCommands;
        renderedCommands += result.stats.renderedCommands;
        skippedCommands += result.stats.skippedCommands;

        if (nextCheckpoint < checkpointIndices.size()
            && index == checkpointIndices[nextCheckpoint]) {
            checkpointHashes[nextCheckpoint] = renderer.pixelHash();
            ++nextCheckpoint;
        }
    }

    if (totalAllocations != 0U) {
        std::cerr
            << "FramePacket build + software render performed "
            << totalAllocations << " tracked C++ allocations\n";
        return 1;
    }
    const bool phaseChangedPixels = checkpointHashes[0] != checkpointHashes[1]
        || checkpointHashes[0] != checkpointHashes[2];
    if (!phaseChangedPixels) {
        std::cerr << "phase changes did not change checkpoint pixel hashes\n";
        return 1;
    }

    const Distribution rasterDistribution = summarize(rasterSamples);
    const Distribution renderCallDistribution = summarize(renderCallSamples);
    const std::uint64_t checkpointDigest = mixHashes(checkpointHashes);

    std::cout << std::fixed << std::setprecision(3);
    std::cout
        << "software renderer benchmark: 960x540, warmup=" << options.warmupFrames
        << ", measured=" << options.measurementFrames
        << ", hardware_threads=" << std::thread::hardware_concurrency() << '\n';
#if defined(NDEBUG)
    std::cout << "build_mode=Release-like (NDEBUG)";
#else
    std::cout << "build_mode=Debug-like";
#endif
#if defined(_MSC_VER)
    std::cout << ", compiler=MSVC " << _MSC_VER;
#elif defined(__clang__)
    std::cout << ", compiler=Clang " << __clang_major__ << '.' << __clang_minor__;
#elif defined(__GNUC__)
    std::cout << ", compiler=GCC " << __GNUC__ << '.' << __GNUC_MINOR__;
#endif
    std::cout << '\n';
    printDistribution("CPU raster", rasterDistribution);
    printDistribution("render() call", renderCallDistribution);
    std::cout
        << "commands submitted/rendered/skipped="
        << submittedCommands << '/' << renderedCommands << '/' << skippedCommands << '\n'
        << "tracked C++ allocations (build + render)=" << totalAllocations << '\n'
        << "phase37_golden=0x" << std::hex << goldenHash
        << ", checkpoint_hashes=0x" << checkpointHashes[0]
        << "/0x" << checkpointHashes[1]
        << "/0x" << checkpointHashes[2]
        << ", checkpoint_digest=0x" << checkpointDigest << std::dec << '\n'
        << "gate=" << (options.enforceGate ? "enabled" : "report-only")
        << ", p95_budget=" << software_frame_budget_milliseconds << " ms\n";

    if (options.enforceGate
        && renderCallDistribution.p95 > software_frame_budget_milliseconds) {
        std::cerr
            << "FAIL: render() p95 " << renderCallDistribution.p95
            << " ms exceeds the 30fps budget of "
            << software_frame_budget_milliseconds << " ms\n";
        return 2;
    }

    std::cout << (options.enforceGate ? "PASS: performance gate\n" : "PASS: validation/report\n");
    return 0;
}
