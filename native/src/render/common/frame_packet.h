#pragma once

#include "render/common/render_command.h"
#include "render/common/viewport_state.h"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <limits>
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
    std::size_t glyphRunCount = 0;
    std::size_t glyphInstanceCount = 0;
    std::size_t texturedMeshCount = 0;
    std::size_t meshVertexCount = 0;
    std::size_t meshIndexCount = 0;
    std::size_t gradientCount = 0;
    std::size_t gradientStopCount = 0;
    std::size_t clipCount = 0;
    std::size_t passCount = 0;

    constexpr bool operator==(const FramePacketCapacity&) const noexcept = default;
};

/**
 * 서로 배타적인 frame 대안의 예약 용량을 필드별 최댓값으로 병합합니다.
 * 두 frame을 한 packet에 함께 담기 위한 합계나 saturating sum이 아닙니다.
 */
[[nodiscard]] constexpr FramePacketCapacity maximumFramePacketCapacity(
    const FramePacketCapacity& first,
    const FramePacketCapacity& second
) noexcept {
    return {
        std::max(first.commandCount, second.commandCount),
        std::max(first.spriteCount, second.spriteCount),
        std::max(first.shapeCount, second.shapeCount),
        std::max(first.lineCount, second.lineCount),
        std::max(first.textCount, second.textCount),
        std::max(first.effectCount, second.effectCount),
        std::max(first.uiCount, second.uiCount),
        std::max(first.overlayCount, second.overlayCount),
        std::max(first.utf8ByteCount, second.utf8ByteCount),
        std::max(first.glyphRunCount, second.glyphRunCount),
        std::max(first.glyphInstanceCount, second.glyphInstanceCount),
        std::max(first.texturedMeshCount, second.texturedMeshCount),
        std::max(first.meshVertexCount, second.meshVertexCount),
        std::max(first.meshIndexCount, second.meshIndexCount),
        std::max(first.gradientCount, second.gradientCount),
        std::max(first.gradientStopCount, second.gradientStopCount),
        std::max(first.clipCount, second.clipCount),
        std::max(first.passCount, second.passCount)
    };
}

/** 같은 frame에 함께 기록되는 두 command 집합의 예약 용량을 필드별로 더합니다. */
[[nodiscard]] constexpr FramePacketCapacity additiveFramePacketCapacity(
    const FramePacketCapacity& first,
    const FramePacketCapacity& second
) noexcept {
    const auto add = [](const std::size_t firstValue, const std::size_t secondValue) {
        constexpr std::size_t maximum = std::numeric_limits<std::size_t>::max();
        return secondValue > maximum - firstValue
            ? maximum
            : firstValue + secondValue;
    };
    return {
        add(first.commandCount, second.commandCount),
        add(first.spriteCount, second.spriteCount),
        add(first.shapeCount, second.shapeCount),
        add(first.lineCount, second.lineCount),
        add(first.textCount, second.textCount),
        add(first.effectCount, second.effectCount),
        add(first.uiCount, second.uiCount),
        add(first.overlayCount, second.overlayCount),
        add(first.utf8ByteCount, second.utf8ByteCount),
        add(first.glyphRunCount, second.glyphRunCount),
        add(first.glyphInstanceCount, second.glyphInstanceCount),
        add(first.texturedMeshCount, second.texturedMeshCount),
        add(first.meshVertexCount, second.meshVertexCount),
        add(first.meshIndexCount, second.meshIndexCount),
        add(first.gradientCount, second.gradientCount),
        add(first.gradientStopCount, second.gradientStopCount),
        add(first.clipCount, second.clipCount),
        add(first.passCount, second.passCount)
    };
}

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
    std::span<const GlyphRunCommand> glyphRuns;
    std::span<const GlyphInstance> glyphInstances;
    std::span<const TexturedMeshCommand> texturedMeshes;
    std::span<const ProjectiveVertex> meshVertices;
    std::span<const std::uint32_t> meshIndices;
    std::span<const GradientCommand> gradients;
    std::span<const GradientStop> gradientStops;
    std::span<const ClipCommand> clips;
    std::span<const PassCommand> passes;
};

/**
 * 한 표시 프레임의 backend 독립 명령을 소유합니다. clear()는 vector capacity를
 * 유지하므로 FramePacket을 프레임마다 재사용하면 예약 범위 안에서 heap 할당이 없습니다.
 */
class FramePacket final {
public:
    static constexpr std::uint16_t schema_version = 2;

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
    [[nodiscard]] std::span<const GlyphRunCommand> glyphRuns() const noexcept;
    [[nodiscard]] std::span<const GlyphInstance> glyphInstances() const noexcept;
    [[nodiscard]] std::span<const TexturedMeshCommand> texturedMeshes() const noexcept;
    [[nodiscard]] std::span<const ProjectiveVertex> meshVertices() const noexcept;
    [[nodiscard]] std::span<const std::uint32_t> meshIndices() const noexcept;
    [[nodiscard]] std::span<const GradientCommand> gradients() const noexcept;
    [[nodiscard]] std::span<const GradientStop> gradientStops() const noexcept;
    [[nodiscard]] std::span<const ClipCommand> clips() const noexcept;
    [[nodiscard]] std::span<const PassCommand> passes() const noexcept;
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
    std::vector<GlyphRunCommand> glyphRuns_;
    std::vector<GlyphInstance> glyphInstances_;
    std::vector<TexturedMeshCommand> texturedMeshes_;
    std::vector<ProjectiveVertex> meshVertices_;
    std::vector<std::uint32_t> meshIndices_;
    std::vector<GradientCommand> gradients_;
    std::vector<GradientStop> gradientStops_;
    std::vector<ClipCommand> clips_;
    std::vector<PassCommand> passes_;
    frontend::FramePacketBuilder* activeBuilder_ = nullptr;
};

static_assert(std::is_trivially_copyable_v<FrameMetadata>);

} // namespace cirvivor::render
