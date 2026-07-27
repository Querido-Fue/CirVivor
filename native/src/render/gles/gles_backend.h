#pragma once

#include "render/backend/render_backend.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string_view>

struct SDL_Window;

namespace cirvivor::render::gles {

enum class GlesContextVersion : std::uint8_t {
    none = 0,
    es2 = 2,
    es3 = 3
};

enum class GlesRenderError : std::uint8_t {
    none = 0,
    alreadyInitialized,
    notInitialized,
    invalidWindow,
    unsupportedVideoDriver,
    windowMissingOpenGlFlag,
    invalidDrawableSize,
    contextCreationFailed,
    contextProfileMismatch,
    contextMakeCurrentFailed,
    functionLoadFailed,
    shaderCompileFailed,
    programLinkFailed,
    bufferCreationFailed,
    invalidFramePacket,
    invalidViewport,
    graphicsApiError,
    contextLost,
    swapFailed
};

/**
 * submittedCommands == renderedCommands + skippedCommands + noOpCommands입니다.
 * placeholderCommands는 rendered/skipped 중 실제 자산 대신 단색 geometry로 처리한
 * 명령 수이며 합계와 겹치는 진단 축입니다.
 */
struct GlesRenderStats final {
    std::uint64_t submittedCommands = 0;
    std::uint64_t renderedCommands = 0;
    std::uint64_t placeholderCommands = 0;
    std::uint64_t supportedShapeCommands = 0;
    std::uint64_t skippedCommands = 0;
    std::uint64_t noOpCommands = 0;
    bool framePresented = false;
    bool backgroundSkipped = false;

    constexpr bool operator==(const GlesRenderStats&) const noexcept = default;
};

/**
 * 외부 SDL_Window를 소유하지 않는 OpenGL ES 호환 backend입니다. window는 backend보다
 * 오래 살아야 하고 SDL_WINDOW_OPENGL로 생성되어야 하며, shutdown()은 window/SDL
 * 종료 전에 호출해야 합니다. profile/version/double-buffer 속성도 window 생성 전에
 * requestedVersion에 맞게 설정되어 있어야 합니다. 이 backend는 전역 GL 속성을 바꾸지
 * 않고 사전 구성된 profile 하나만 생성합니다. ES3 실패 후 ES2로 내릴 때는 factory가
 * window를 ES2 속성으로 재생성하고 새 backend를 만들어야 합니다.
 *
 * 모든 메서드는 SDL의 main thread에서 호출해야 합니다. render hot path의 오류 진단은
 * 고정 크기 버퍼에 기록되어 heap 할당을 하지 않습니다.
 */
class GlesBackend final : public backend::IRenderBackend {
public:
    explicit GlesBackend(
        SDL_Window* externalWindow,
        GlesContextVersion requestedVersion = GlesContextVersion::es3
    ) noexcept;
    ~GlesBackend() noexcept override;

    GlesBackend(const GlesBackend&) = delete;
    GlesBackend& operator=(const GlesBackend&) = delete;
    GlesBackend(GlesBackend&&) = delete;
    GlesBackend& operator=(GlesBackend&&) = delete;

    [[nodiscard]] backend::RenderBackendKind kind() const noexcept override;
    [[nodiscard]] const backend::RenderCapabilities& capabilities() const noexcept override;
    [[nodiscard]] backend::BackendInitializeResult initialize() override;
    void shutdown() noexcept override;

    [[nodiscard]] bool resize(
        std::int32_t drawableWidth,
        std::int32_t drawableHeight
    ) noexcept override;
    [[nodiscard]] bool render(
        const FramePacket& frame,
        RenderResourcesView resources = {}
    ) noexcept override;
    [[nodiscard]] bool onBackground() noexcept override;
    [[nodiscard]] bool onForeground() noexcept override;
    [[nodiscard]] bool purgeTransientResources() noexcept override;

    [[nodiscard]] GlesContextVersion contextVersion() const noexcept;
    [[nodiscard]] GlesContextVersion requestedContextVersion() const noexcept;
    [[nodiscard]] int swapInterval() const noexcept;
    [[nodiscard]] GlesRenderError lastError() const noexcept;
    [[nodiscard]] std::string_view lastDiagnostic() const noexcept;
    [[nodiscard]] std::string_view es3FailureReason() const noexcept;
    [[nodiscard]] std::string_view es2FailureReason() const noexcept;
    [[nodiscard]] const GlesRenderStats& lastStats() const noexcept;

private:
    struct Impl;

    void clearDiagnostic() noexcept;
    void setDiagnostic(GlesRenderError error, std::string_view text) noexcept;
    void captureAttemptFailure(GlesContextVersion version) noexcept;
    void resetImplementation() noexcept;
    [[nodiscard]] bool tryInitialize(GlesContextVersion requestedVersion);
    [[nodiscard]] bool ensureCurrent() noexcept;
    [[nodiscard]] bool refreshDrawableSize() noexcept;

    SDL_Window* window_ = nullptr;
    GlesContextVersion requestedVersion_ = GlesContextVersion::es3;
    std::unique_ptr<Impl> implementation_;
    backend::RenderCapabilities capabilities_;
    GlesContextVersion contextVersion_ = GlesContextVersion::none;
    int swapInterval_ = 0;
    std::int32_t drawableWidth_ = 0;
    std::int32_t drawableHeight_ = 0;
    bool backgrounded_ = false;
    GlesRenderError lastError_ = GlesRenderError::none;
    GlesRenderStats lastStats_;
    std::array<char, 768> diagnostic_{};
    std::size_t diagnosticLength_ = 0;
    std::array<char, 384> es3Failure_{};
    std::size_t es3FailureLength_ = 0;
    std::array<char, 384> es2Failure_{};
    std::size_t es2FailureLength_ = 0;
};

} // namespace cirvivor::render::gles
