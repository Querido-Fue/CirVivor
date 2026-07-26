#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <utility>

namespace cirvivor::render {

class FramePacket;

namespace backend {

enum class RenderBackendKind : std::uint8_t {
    sdlGpu = 0,
    gles = 1,
    software = 2
};

[[nodiscard]] constexpr std::string_view renderBackendKindName(
    const RenderBackendKind kind
) noexcept {
    switch (kind) {
    case RenderBackendKind::sdlGpu:
        return "sdl-gpu";
    case RenderBackendKind::gles:
        return "gles";
    case RenderBackendKind::software:
        return "software";
    }
    return "unknown";
}

struct RenderCapabilities final {
    bool hardwareAccelerated = false;
    bool supportsFloatRenderTarget = false;
    bool supportsTimestampQuery = false;
    bool supportsAnisotropicFiltering = false;
    std::int32_t maximumTextureSize = 0;
    std::int32_t maximumSampleCount = 1;
    std::string backendName;
    std::string adapterName;
    // 0은 present가 callback을 확실히 pace하는 backend만 사용합니다. 그 외에는
    // SDL main callback을 이 상한으로 제한해 VSync 협상 실패 시 busy-loop를 막습니다.
    std::uint16_t mainCallbackRateLimitHz = 60;

    bool operator==(const RenderCapabilities&) const = default;
};

class BackendInitializeResult final {
public:
    [[nodiscard]] static BackendInitializeResult success() {
        return BackendInitializeResult(true, {});
    }

    [[nodiscard]] static BackendInitializeResult failure(std::string reason) {
        return BackendInitializeResult(false, std::move(reason));
    }

    [[nodiscard]] bool succeeded() const noexcept {
        return succeeded_;
    }

    [[nodiscard]] const std::string& reason() const noexcept {
        return reason_;
    }

private:
    BackendInitializeResult(const bool succeeded, std::string reason)
        : succeeded_(succeeded), reason_(std::move(reason)) {}

    bool succeeded_ = false;
    std::string reason_;
};

/**
 * Backend 중립 렌더 수명주기입니다. 플랫폼 handle은 구현체를 만드는 factory가
 * 소유하거나 주입하며 이 경계 밖으로 노출하지 않습니다. shutdown()은 여러 번
 * 호출해도 안전해야 하고 구현체 소멸자도 남은 자원을 회수해야 합니다.
 */
class IRenderBackend {
public:
    virtual ~IRenderBackend() = default;

    [[nodiscard]] virtual RenderBackendKind kind() const noexcept = 0;
    [[nodiscard]] virtual const RenderCapabilities& capabilities() const noexcept = 0;
    [[nodiscard]] virtual BackendInitializeResult initialize() = 0;
    virtual void shutdown() noexcept = 0;

    [[nodiscard]] virtual bool resize(
        std::int32_t drawableWidth,
        std::int32_t drawableHeight
    ) noexcept = 0;
    [[nodiscard]] virtual bool render(const FramePacket& frame) noexcept = 0;
    [[nodiscard]] virtual bool onBackground() noexcept = 0;
    [[nodiscard]] virtual bool onForeground() noexcept = 0;
    [[nodiscard]] virtual bool purgeTransientResources() noexcept = 0;
    [[nodiscard]] virtual bool onRenderTargetsReset() noexcept {
        return purgeTransientResources();
    }
};

} // namespace backend
} // namespace cirvivor::render
