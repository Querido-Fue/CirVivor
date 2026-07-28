#include "debug/debug_performance_tracker.h"

#include <algorithm>

namespace cirvivor::debug {

namespace {

constexpr double nanosecondsPerMillisecond = 1'000'000.0;

[[nodiscard]] constexpr std::size_t ringIndex(
    const std::size_t first,
    const std::size_t offset
) noexcept {
    return (first + offset) % debug_performance_samples_per_section;
}

[[nodiscard]] constexpr bool insideWindow(
    const std::uint64_t sampleTimestamp,
    const std::uint64_t windowEnd
) noexcept {
    return sampleTimestamp <= windowEnd
        && windowEnd - sampleTimestamp
            <= debug_performance_window_nanoseconds;
}

} // namespace

bool DebugPerformanceTracker::setEnabled(const bool enabled) noexcept {
    if (enabled_ == enabled) {
        return false;
    }
    reset();
    enabled_ = enabled;
    return true;
}

bool DebugPerformanceTracker::isEnabled() const noexcept {
    return enabled_;
}

void DebugPerformanceTracker::reset() noexcept {
    for (SectionRing& ring : sections_) {
        ring.first = 0U;
        ring.count = 0U;
    }
}

bool DebugPerformanceTracker::record(
    const DebugPerformanceSection section,
    const std::uint64_t timestampNanoseconds,
    const std::uint64_t durationNanoseconds
) noexcept {
    if (!enabled_ || !validSection(section)) {
        return false;
    }

    SectionRing& ring = sections_[static_cast<std::size_t>(section)];
    if (ring.count > 0U) {
        const Sample& latest = ring.samples[ringIndex(
            ring.first,
            ring.count - 1U
        )];
        if (timestampNanoseconds < latest.timestampNanoseconds) {
            ring.first = 0U;
            ring.count = 0U;
        }
    }
    removeExpired(ring, timestampNanoseconds);
    if (ring.count == ring.samples.size()) {
        ring.first = ringIndex(ring.first, 1U);
        --ring.count;
    }
    ring.samples[ringIndex(ring.first, ring.count)] = {
        timestampNanoseconds,
        durationNanoseconds
    };
    ++ring.count;
    return true;
}

DebugPerformanceSnapshot DebugPerformanceTracker::snapshot(
    const std::uint64_t timestampNanoseconds
) const noexcept {
    DebugPerformanceSnapshot result;
    result.windowEndTimestampNanoseconds = timestampNanoseconds;
    result.enabled = enabled_;
    if (!enabled_) {
        return result;
    }

    for (std::size_t sectionIndex = 0U;
         sectionIndex < sections_.size();
         ++sectionIndex) {
        const SectionRing& ring = sections_[sectionIndex];
        DebugPerformanceSectionSnapshot& output = result.sections[sectionIndex];
        long double durationTotal = 0.0L;
        std::uint64_t maximumDuration = 0U;
        for (std::size_t offset = 0U; offset < ring.count; ++offset) {
            const Sample& sample = ring.samples[ringIndex(ring.first, offset)];
            if (!insideWindow(sample.timestampNanoseconds, timestampNanoseconds)) {
                continue;
            }
            durationTotal += static_cast<long double>(sample.durationNanoseconds);
            maximumDuration = std::max(maximumDuration, sample.durationNanoseconds);
            output.lastMilliseconds = static_cast<double>(sample.durationNanoseconds)
                / nanosecondsPerMillisecond;
            ++output.sampleCount;
        }
        if (output.sampleCount == 0U) {
            continue;
        }
        output.hasSamples = true;
        output.averageMilliseconds = static_cast<double>(
            durationTotal / static_cast<long double>(output.sampleCount)
        ) / nanosecondsPerMillisecond;
        output.maximumMilliseconds = static_cast<double>(maximumDuration)
            / nanosecondsPerMillisecond;
    }
    return result;
}

bool DebugPerformanceTracker::validSection(
    const DebugPerformanceSection section
) noexcept {
    return section >= DebugPerformanceSection::frameCpu
        && section < DebugPerformanceSection::count;
}

void DebugPerformanceTracker::removeExpired(
    SectionRing& ring,
    const std::uint64_t timestampNanoseconds
) noexcept {
    while (ring.count > 0U) {
        const Sample& sample = ring.samples[ring.first];
        if (sample.timestampNanoseconds > timestampNanoseconds
            || timestampNanoseconds - sample.timestampNanoseconds
                <= debug_performance_window_nanoseconds) {
            break;
        }
        ring.first = ringIndex(ring.first, 1U);
        --ring.count;
    }
}

} // namespace cirvivor::debug
