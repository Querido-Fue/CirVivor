#pragma once

#include <cstddef>
#include <cstdint>
#include <span>
#include <vector>

struct SDL_Storage;

namespace cirvivor::platform::sdl {

enum class StorageResult : std::uint8_t {
    success,
    alreadyOpen,
    notOpen,
    notReady,
    invalidArgument,
    readLimitExceeded,
    addressSpaceExceeded,
    allocationFailed,
    backendFailure
};

enum class StorageReadyState : std::uint8_t {
    closed,
    pending,
    ready
};

struct StorageReadResult final {
    StorageResult status = StorageResult::backendFailure;
    std::vector<std::byte> bytes;

    [[nodiscard]] bool succeeded() const noexcept {
        return status == StorageResult::success;
    }
};

// SDL user storage의 batch 수명을 소유한다. 준비 대기는 호출자의 메인 루프가 폴링한다.
class SdlUserStorage final {
public:
    static constexpr std::uint64_t defaultMaximumReadBytes = 64ULL * 1024ULL * 1024ULL;

    SdlUserStorage() = default;
    ~SdlUserStorage();

    SdlUserStorage(const SdlUserStorage&) = delete;
    SdlUserStorage& operator=(const SdlUserStorage&) = delete;
    SdlUserStorage(SdlUserStorage&&) = delete;
    SdlUserStorage& operator=(SdlUserStorage&&) = delete;

    [[nodiscard]] StorageResult open(
        const char* organization,
        const char* application
    ) noexcept;
    [[nodiscard]] StorageReadyState readyState() const noexcept;

    [[nodiscard]] StorageReadResult read(
        const char* path,
        std::uint64_t maximumBytes = defaultMaximumReadBytes
    ) const noexcept;
    [[nodiscard]] StorageResult write(
        const char* path,
        std::span<const std::byte> bytes
    ) noexcept;
    [[nodiscard]] StorageResult remove(const char* path) noexcept;

    // SDL_CloseStorage는 실패해도 handle을 해제한다. 반환값과 로그로 flush 실패를 보고한다.
    [[nodiscard]] StorageResult close() noexcept;
    [[nodiscard]] bool isOpen() const noexcept;

private:
    [[nodiscard]] StorageResult accessStatus(const char* path) const noexcept;

    SDL_Storage* storage_ = nullptr;
};

} // namespace cirvivor::platform::sdl
