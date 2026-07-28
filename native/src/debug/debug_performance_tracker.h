#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <type_traits>

namespace cirvivor::debug {

inline constexpr std::uint64_t debug_performance_window_nanoseconds =
    1'000'000'000ULL;
inline constexpr std::size_t debug_performance_samples_per_section = 512U;

enum class DebugPerformanceSection : std::uint8_t {
    frameCpu,
    updateBuild,
    fixedUpdate,
    sceneBuild,
    renderCall,
    count
};

struct DebugPerformanceSectionSnapshot final {
    std::size_t sampleCount = 0U;
    double averageMilliseconds = 0.0;
    double lastMilliseconds = 0.0;
    double maximumMilliseconds = 0.0;
    bool hasSamples = false;

    constexpr bool operator==(
        const DebugPerformanceSectionSnapshot&
    ) const noexcept = default;
};

struct DebugPerformanceSnapshot final {
    std::array<
        DebugPerformanceSectionSnapshot,
        static_cast<std::size_t>(DebugPerformanceSection::count)
    > sections{};
    std::uint64_t windowEndTimestampNanoseconds = 0U;
    bool enabled = false;

    [[nodiscard]] constexpr const DebugPerformanceSectionSnapshot& section(
        const DebugPerformanceSection value
    ) const noexcept {
        const std::size_t index = static_cast<std::size_t>(value);
        return index < sections.size() ? sections[index] : sections.front();
    }

    constexpr bool operator==(const DebugPerformanceSnapshot&) const noexcept = default;
};

/**
 * 최근 1초의 native CPU 구간 표본을 섹션별 고정 링에 보관합니다. 생성 뒤
 * heap을 사용하지 않으며 renderer나 SDL 타입을 소유하지 않습니다.
 */
class DebugPerformanceTracker final {
public:
    [[nodiscard]] bool setEnabled(bool enabled) noexcept;
    [[nodiscard]] bool isEnabled() const noexcept;
    void reset() noexcept;

    [[nodiscard]] bool record(
        DebugPerformanceSection section,
        std::uint64_t timestampNanoseconds,
        std::uint64_t durationNanoseconds
    ) noexcept;

    [[nodiscard]] DebugPerformanceSnapshot snapshot(
        std::uint64_t timestampNanoseconds
    ) const noexcept;

private:
    struct Sample final {
        std::uint64_t timestampNanoseconds = 0U;
        std::uint64_t durationNanoseconds = 0U;
    };

    struct SectionRing final {
        std::array<Sample, debug_performance_samples_per_section> samples{};
        std::size_t first = 0U;
        std::size_t count = 0U;
    };

    [[nodiscard]] static bool validSection(
        DebugPerformanceSection section
    ) noexcept;
    static void removeExpired(
        SectionRing& ring,
        std::uint64_t timestampNanoseconds
    ) noexcept;

    std::array<
        SectionRing,
        static_cast<std::size_t>(DebugPerformanceSection::count)
    > sections_{};
    bool enabled_ = false;
};

static_assert(std::is_trivially_copyable_v<DebugPerformanceSectionSnapshot>);
static_assert(std::is_trivially_copyable_v<DebugPerformanceSnapshot>);
static_assert(std::is_standard_layout_v<DebugPerformanceSectionSnapshot>);
static_assert(std::is_standard_layout_v<DebugPerformanceSnapshot>);

} // namespace cirvivor::debug
