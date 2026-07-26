#pragma once

#include <cstdint>

namespace cirvivor::platform::sdl {

enum class AudioDeviceResult : std::uint8_t {
    success,
    alreadyOpen,
    notOpen,
    subsystemNotInitialized,
    noPlaybackDevice,
    deviceEnumerationFailed,
    deviceOpenFailed,
    commandFailed
};

// 기본 playback 논리 장치의 수명과 pause 상태만 관리한다. stream/callback은 소유하지 않는다.
class SdlPlaybackDevice final {
public:
    SdlPlaybackDevice() = default;
    ~SdlPlaybackDevice();

    SdlPlaybackDevice(const SdlPlaybackDevice&) = delete;
    SdlPlaybackDevice& operator=(const SdlPlaybackDevice&) = delete;
    SdlPlaybackDevice(SdlPlaybackDevice&&) = delete;
    SdlPlaybackDevice& operator=(SdlPlaybackDevice&&) = delete;

    [[nodiscard]] AudioDeviceResult openDefault() noexcept;
    [[nodiscard]] AudioDeviceResult pause() noexcept;
    [[nodiscard]] AudioDeviceResult resume() noexcept;
    [[nodiscard]] AudioDeviceResult close() noexcept;

    [[nodiscard]] bool isOpen() const noexcept;
    [[nodiscard]] bool isPaused() const noexcept;
    [[nodiscard]] std::uint32_t deviceId() const noexcept;

private:
    std::uint32_t deviceId_ = 0;
};

} // namespace cirvivor::platform::sdl
