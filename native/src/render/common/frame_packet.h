#pragma once

#include "render/common/render_command.h"
#include "render/common/viewport_state.h"

#include <cstddef>
#include <cstdint>
#include <span>
#include <string_view>
#include <vector>

namespace cirvivor::render {

namespace frontend {
class FramePacketBuilder;
}

struct FramePacketStorageAccess;

struct FrameMetadata final {
    std::uint64_t frameId = 0;
    std::uint64_t simulationTick = 0;
    double presentationTimeSeconds = 0.0;
    float interpolationAlpha = 0.0F;
    AlphaEncoding alphaEncoding = AlphaEncoding::premultiplied;
    PremultipliedRgba clearColor = PremultipliedRgba::opaque(0.125F, 0.125F, 0.125F);

    constexpr bool operator==(const FrameMetadata&) const noexcept = default;
};

struct FramePacketCapacity final {
    std::size_t commandCount = 0;
    std::size_t spriteCount = 0;
    std::size_t shapeCount = 0;
    std::size_t lineCount = 0;
    std::size_t textCount = 0;
    std::size_t effectCount = 0;
    std::size_t uiCount = 0;
    std::size_t overlayCount = 0;
    std::size_t utf8ByteCount = 0;

    constexpr bool operator==(const FramePacketCapacity&) const noexcept = default;
};

struct FramePacketView final {
    const FrameMetadata& metadata;
    const ViewportState& viewport;
    std::span<const CommandRef> commandStream;
    std::span<const SpriteCommand> sprites;
    std::span<const ShapeCommand> shapes;
    std::span<const LineCommand> lines;
    std::span<const TextCommand> textRuns;
    std::span<const EffectCommand> effects;
    std::span<const UiCommand> ui;
    std::span<const OverlayCommand> overlays;
    std::span<const char> utf8Bytes;
};

/**
 * 한 표시 프레임의 backend 독립 명령을 소유합니다. clear()는 vector capacity를
 * 유지하므로 FramePacket을 프레임마다 재사용하면 예약 범위 안에서 heap 할당이 없습니다.
 */
class FramePacket final {
public:
    static constexpr std::uint16_t schema_version = 1;

    FramePacket() = default;
    explicit FramePacket(const FramePacketCapacity& capacity);
    FramePacket(const FramePacket& other);
    FramePacket& operator=(const FramePacket& other);
    FramePacket(FramePacket&& other) noexcept;
    FramePacket& operator=(FramePacket&& other) noexcept;

    void reserve(const FramePacketCapacity& capacity);
    void clear() noexcept;

    [[nodiscard]] const FrameMetadata& metadata() const noexcept;
    [[nodiscard]] const ViewportState& viewport() const noexcept;
    [[nodiscard]] std::span<const CommandRef> commandStream() const noexcept;
    [[nodiscard]] std::span<const SpriteCommand> sprites() const noexcept;
    [[nodiscard]] std::span<const ShapeCommand> shapes() const noexcept;
    [[nodiscard]] std::span<const LineCommand> lines() const noexcept;
    [[nodiscard]] std::span<const TextCommand> textRuns() const noexcept;
    [[nodiscard]] std::span<const EffectCommand> effects() const noexcept;
    [[nodiscard]] std::span<const UiCommand> ui() const noexcept;
    [[nodiscard]] std::span<const OverlayCommand> overlays() const noexcept;
    [[nodiscard]] std::span<const char> utf8Bytes() const noexcept;
    [[nodiscard]] std::string_view text(TextSlice slice) const noexcept;
    [[nodiscard]] FramePacketView view() const noexcept;
    [[nodiscard]] FramePacketCapacity size() const noexcept;
    [[nodiscard]] FramePacketCapacity capacity() const noexcept;
    [[nodiscard]] bool hasCapacityFor(const FramePacketCapacity& required) const noexcept;
    [[nodiscard]] bool isStructurallyValid() const noexcept;
    [[nodiscard]] bool isRenderOrderValid() const noexcept;

private:
    friend class frontend::FramePacketBuilder;
    friend struct FramePacketStorageAccess;

    [[nodiscard]] const CommandHeader* commandHeader(const CommandRef& reference) const noexcept;

    FrameMetadata metadata_;
    ViewportState viewport_;
    std::vector<CommandRef> commandStream_;
    std::vector<SpriteCommand> sprites_;
    std::vector<ShapeCommand> shapes_;
    std::vector<LineCommand> lines_;
    std::vector<TextCommand> textRuns_;
    std::vector<EffectCommand> effects_;
    std::vector<UiCommand> ui_;
    std::vector<OverlayCommand> overlays_;
    std::vector<char> utf8Bytes_;
    frontend::FramePacketBuilder* activeBuilder_ = nullptr;
};

static_assert(std::is_trivially_copyable_v<FrameMetadata>);

} // namespace cirvivor::render
