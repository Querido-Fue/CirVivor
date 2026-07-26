#include "engine/frame_scheduler.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace cirvivor::engine {
namespace {

constexpr double defaultFixedStepSeconds = 1.0 / 60.0;

[[nodiscard]] double normalizePositiveDouble(
    const double value,
    const double fallback
) noexcept {
    return std::isfinite(value) && value > 0 ? value : fallback;
}

[[nodiscard]] std::uint32_t normalizePositiveInteger(
    const std::uint32_t value,
    const std::uint32_t fallback
) noexcept {
    return value > 0U ? value : fallback;
}

[[nodiscard]] FrameSchedulerConfig normalizeConfig(FrameSchedulerConfig config) noexcept {
    config.fixedStepSeconds = normalizePositiveDouble(
        config.fixedStepSeconds,
        defaultFixedStepSeconds
    );
    config.maxFrameDeltaSeconds = normalizePositiveDouble(
        config.maxFrameDeltaSeconds,
        0.1
    );
    config.normalMaxSteps = normalizePositiveInteger(config.normalMaxSteps, 2U);
    config.cpuBoundMaxSteps = std::min(
        config.normalMaxSteps,
        normalizePositiveInteger(config.cpuBoundMaxSteps, 1U)
    );
    config.enterCpuRatio = normalizePositiveDouble(config.enterCpuRatio, 0.9);
    config.exitCpuRatio = std::min(
        config.enterCpuRatio,
        normalizePositiveDouble(config.exitCpuRatio, 0.7)
    );
    config.recoveryFrames = normalizePositiveInteger(config.recoveryFrames, 3U);
    return config;
}

[[nodiscard]] std::uint32_t countWholeFixedSteps(
    const double accumulatorSeconds,
    const double fixedStepSeconds
) noexcept {
    if (!std::isfinite(accumulatorSeconds) || accumulatorSeconds < fixedStepSeconds) {
        return 0;
    }

    const double wholeSteps = std::floor(accumulatorSeconds / fixedStepSeconds);
    if (wholeSteps >= static_cast<double>(std::numeric_limits<std::uint32_t>::max())) {
        return std::numeric_limits<std::uint32_t>::max();
    }
    return std::max(1U, static_cast<std::uint32_t>(wholeSteps));
}

} // namespace

FrameScheduler::FrameScheduler(FrameSchedulerConfig config) noexcept
    : config_(normalizeConfig(config)) {
}

FrameSchedule FrameScheduler::advance(const FrameSample& sample) noexcept {
    FrameSchedule schedule;
    schedule.rawFrameDeltaSeconds = sample.rawFrameDeltaSeconds;
    schedule.fixedStepSeconds = config_.fixedStepSeconds;
    schedule.suspended = suspended_;

    if (suspended_) {
        return schedule;
    }

    double frameDeltaSeconds = sample.rawFrameDeltaSeconds;
    if (!std::isfinite(frameDeltaSeconds) || frameDeltaSeconds < 0) {
        frameDeltaSeconds = config_.fixedStepSeconds;
    } else if (frameDeltaSeconds > config_.maxFrameDeltaSeconds) {
        frameDeltaSeconds = config_.maxFrameDeltaSeconds;
    }
    schedule.frameDeltaSeconds = frameDeltaSeconds;

    if (std::isfinite(sample.rawFrameDeltaSeconds)
        && sample.rawFrameDeltaSeconds > frameDeltaSeconds) {
        schedule.frameDeltaClampLossSeconds = sample.rawFrameDeltaSeconds - frameDeltaSeconds;
    }

    if (!sample.fixedStepEnabled) {
        reset();
        return schedule;
    }

    accumulatorSeconds_ += frameDeltaSeconds;
    const std::uint32_t maxSteps = resolveMaxSteps(
        sample.previousFrameCpuSeconds,
        sample.rawFrameDeltaSeconds
    );

    while (accumulatorSeconds_ >= config_.fixedStepSeconds
        && schedule.fixedStepCount < maxSteps) {
        accumulatorSeconds_ -= config_.fixedStepSeconds;
        ++schedule.fixedStepCount;
    }

    if (schedule.fixedStepCount >= maxSteps
        && accumulatorSeconds_ >= config_.fixedStepSeconds) {
        schedule.droppedFixedStepCount = countWholeFixedSteps(
            accumulatorSeconds_,
            config_.fixedStepSeconds
        );
        accumulatorSeconds_ = std::fmod(accumulatorSeconds_, config_.fixedStepSeconds);
    }

    schedule.fixedAlpha = accumulatorSeconds_ / config_.fixedStepSeconds;
    schedule.cpuBound = cpuBound_;
    return schedule;
}

void FrameScheduler::reset() noexcept {
    accumulatorSeconds_ = 0;
    headroomFrameCount_ = 0;
    cpuBound_ = false;
}

void FrameScheduler::suspend() noexcept {
    suspended_ = true;
    reset();
}

void FrameScheduler::resume() noexcept {
    suspended_ = false;
    reset();
}

const FrameSchedulerConfig& FrameScheduler::config() const noexcept {
    return config_;
}

double FrameScheduler::accumulatorSeconds() const noexcept {
    return accumulatorSeconds_;
}

bool FrameScheduler::isCpuBound() const noexcept {
    return cpuBound_;
}

bool FrameScheduler::isSuspended() const noexcept {
    return suspended_;
}

std::uint32_t FrameScheduler::resolveMaxSteps(
    const double previousFrameCpuSeconds,
    const double frameIntervalSeconds
) noexcept {
    const double safeFrameInterval = normalizePositiveDouble(
        frameIntervalSeconds,
        config_.fixedStepSeconds
    );
    const double safePreviousCpu = std::isfinite(previousFrameCpuSeconds)
        ? std::max(0.0, previousFrameCpuSeconds)
        : 0.0;
    const double referenceInterval = std::max(config_.fixedStepSeconds, safeFrameInterval);
    const double cpuRatio = safePreviousCpu / referenceInterval;

    if (cpuRatio >= config_.enterCpuRatio) {
        cpuBound_ = true;
        headroomFrameCount_ = 0;
    } else if (cpuBound_) {
        if (cpuRatio <= config_.exitCpuRatio) {
            ++headroomFrameCount_;
            if (headroomFrameCount_ >= config_.recoveryFrames) {
                cpuBound_ = false;
                headroomFrameCount_ = 0;
            }
        } else {
            headroomFrameCount_ = 0;
        }
    }

    return cpuBound_ ? config_.cpuBoundMaxSteps : config_.normalMaxSteps;
}

} // namespace cirvivor::engine
