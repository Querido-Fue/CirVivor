#include "platform/sdl/audio/sdl_playback_device.h"

#include <SDL3/SDL_audio.h>
#include <SDL3/SDL_error.h>
#include <SDL3/SDL_init.h>
#include <SDL3/SDL_log.h>
#include <SDL3/SDL_stdinc.h>

namespace cirvivor::platform::sdl {
namespace {

void logAudioFailure(const char* const operation) noexcept {
    SDL_LogError(
        SDL_LOG_CATEGORY_APPLICATION,
        "Playback device %s failed: %s",
        operation,
        SDL_GetError()
    );
}

} // namespace

SdlPlaybackDevice::~SdlPlaybackDevice() {
    static_cast<void>(close());
}

AudioDeviceResult SdlPlaybackDevice::openDefault() noexcept {
    if (deviceId_ != 0) {
        return AudioDeviceResult::alreadyOpen;
    }
    if ((SDL_WasInit(SDL_INIT_AUDIO) & SDL_INIT_AUDIO) == 0) {
        return AudioDeviceResult::subsystemNotInitialized;
    }

    int playbackDeviceCount = 0;
    SDL_AudioDeviceID* const playbackDevices =
        SDL_GetAudioPlaybackDevices(&playbackDeviceCount);
    if (playbackDevices == nullptr) {
        logAudioFailure("enumeration");
        return AudioDeviceResult::deviceEnumerationFailed;
    }
    SDL_free(playbackDevices);
    if (playbackDeviceCount <= 0) {
        return AudioDeviceResult::noPlaybackDevice;
    }

    const SDL_AudioDeviceID device = SDL_OpenAudioDevice(
        SDL_AUDIO_DEVICE_DEFAULT_PLAYBACK,
        nullptr
    );
    if (device == 0) {
        logAudioFailure("open");
        return AudioDeviceResult::deviceOpenFailed;
    }

    static_assert(sizeof(SDL_AudioDeviceID) == sizeof(std::uint32_t));
    deviceId_ = static_cast<std::uint32_t>(device);
    return AudioDeviceResult::success;
}

AudioDeviceResult SdlPlaybackDevice::pause() noexcept {
    if (deviceId_ == 0) {
        return AudioDeviceResult::notOpen;
    }
    if (!SDL_PauseAudioDevice(static_cast<SDL_AudioDeviceID>(deviceId_))) {
        logAudioFailure("pause");
        return AudioDeviceResult::commandFailed;
    }
    return AudioDeviceResult::success;
}

AudioDeviceResult SdlPlaybackDevice::resume() noexcept {
    if (deviceId_ == 0) {
        return AudioDeviceResult::notOpen;
    }
    if (!SDL_ResumeAudioDevice(static_cast<SDL_AudioDeviceID>(deviceId_))) {
        logAudioFailure("resume");
        return AudioDeviceResult::commandFailed;
    }
    return AudioDeviceResult::success;
}

AudioDeviceResult SdlPlaybackDevice::close() noexcept {
    if (deviceId_ == 0) {
        return AudioDeviceResult::success;
    }

    const SDL_AudioDeviceID device = static_cast<SDL_AudioDeviceID>(deviceId_);
    deviceId_ = 0;
    SDL_CloseAudioDevice(device);
    return AudioDeviceResult::success;
}

bool SdlPlaybackDevice::isOpen() const noexcept {
    return deviceId_ != 0;
}

bool SdlPlaybackDevice::isPaused() const noexcept {
    return deviceId_ != 0
        && SDL_AudioDevicePaused(static_cast<SDL_AudioDeviceID>(deviceId_));
}

std::uint32_t SdlPlaybackDevice::deviceId() const noexcept {
    return deviceId_;
}

} // namespace cirvivor::platform::sdl
