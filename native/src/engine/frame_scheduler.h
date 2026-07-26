#pragma once

#include <cstdint>

namespace cirvivor::engine {

struct FrameSchedulerConfig final {
    double fixedStepSeconds = 1.0 / 60.0;
    double maxFrameDeltaSeconds = 0.1;
    std::uint32_t normalMaxSteps = 2;
    std::uint32_t cpuBoundMaxSteps = 1;
    double enterCpuRatio = 0.9;
    double exitCpuRatio = 0.7;
    std::uint32_t recoveryFrames = 3;
};

struct FrameSample final {
    double rawFrameDeltaSeconds = 0;
    double previousFrameCpuSeconds = 0;
    bool fixedStepEnabled = true;
};

struct FrameSchedule final {
    double rawFrameDeltaSeconds = 0;
    double frameDeltaSeconds = 0;
    double frameDeltaClampLossSeconds = 0;
    double fixedStepSeconds = 1.0 / 60.0;
    std::uint32_t fixedStepCount = 0;
    std::uint32_t droppedFixedStepCount = 0;
    double fixedAlpha = 0;
    bool cpuBound = false;
    bool suspended = false;
};

class FrameScheduler final {
public:
    explicit FrameScheduler(FrameSchedulerConfig config = {}) noexcept;

    [[nodiscard]] FrameSchedule advance(const FrameSample& sample) noexcept;

    void reset() noexcept;
    void suspend() noexcept;
    void resume() noexcept;

    [[nodiscard]] const FrameSchedulerConfig& config() const noexcept;
    [[nodiscard]] double accumulatorSeconds() const noexcept;
    [[nodiscard]] bool isCpuBound() const noexcept;
    [[nodiscard]] bool isSuspended() const noexcept;

private:
    [[nodiscard]] std::uint32_t resolveMaxSteps(
        double previousFrameCpuSeconds,
        double frameIntervalSeconds
    ) noexcept;

    FrameSchedulerConfig config_;
    double accumulatorSeconds_ = 0;
    std::uint32_t headroomFrameCount_ = 0;
    bool cpuBound_ = false;
    bool suspended_ = false;
};

} // namespace cirvivor::engine
