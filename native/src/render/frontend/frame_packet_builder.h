#pragma once

#include "render/common/frame_packet.h"

#include <cstdint>
#include <span>
#include <string_view>

namespace cirvivor::render::frontend {

enum class PacketCapacityPolicy : std::uint8_t {
    growAsNeeded = 0,
    fixedCapacity = 1
};

enum class FrameBuildError : std::uint8_t {
    none = 0,
    alreadyBuilding,
    packetAlreadyHasBuilder,
    notBuilding,
    capacityExceeded,
    commandCountOverflow,
    textStorageOverflow,
    textAliasesPacketStorage,
    auxiliaryStorageOverflow,
    storageAliasesPacketStorage,
    invalidLayer,
    invalidOverlayLayer,
    renderOrderRegression,
    structurallyInvalid
};

/**
 * 재사용 가능한 FramePacket에 command를 render order대로 기록합니다. fixedCapacity
 * 정책과 사전 reserve를 함께 쓰면 add/finish hot path가 heap을 사용하지 않습니다.
 */
class FramePacketBuilder final {
public:
    explicit FramePacketBuilder(
        FramePacket& packet,
        PacketCapacityPolicy capacityPolicy = PacketCapacityPolicy::growAsNeeded
    ) noexcept;
    ~FramePacketBuilder();

    FramePacketBuilder(const FramePacketBuilder&) = delete;
    FramePacketBuilder& operator=(const FramePacketBuilder&) = delete;
    FramePacketBuilder(FramePacketBuilder&&) = delete;
    FramePacketBuilder& operator=(FramePacketBuilder&&) = delete;

    [[nodiscard]] bool begin(
        const FrameMetadata& metadata,
        const ViewportState& viewport
    ) noexcept;
    [[nodiscard]] bool finish() noexcept;
    void abort() noexcept;

    [[nodiscard]] bool addSprite(SpriteCommand command);
    [[nodiscard]] bool addShape(ShapeCommand command);
    [[nodiscard]] bool addLine(LineCommand command);
    [[nodiscard]] bool addText(TextCommand command, std::string_view utf8);
    [[nodiscard]] bool addEffect(EffectCommand command);
    [[nodiscard]] bool addUi(UiCommand command);
    [[nodiscard]] bool addOverlay(OverlayCommand command);
    [[nodiscard]] bool addGlyphRun(
        GlyphRunCommand command,
        std::span<const GlyphInstance> glyphs
    );
    [[nodiscard]] bool addTexturedMesh(
        TexturedMeshCommand command,
        std::span<const ProjectiveVertex> vertices,
        std::span<const std::uint32_t> indices
    );
    [[nodiscard]] bool addGradient(
        GradientCommand command,
        std::span<const GradientStop> stops
    );
    [[nodiscard]] bool addClip(ClipCommand command);
    [[nodiscard]] bool addPass(PassCommand command);

    [[nodiscard]] FrameBuildError error() const noexcept;
    [[nodiscard]] bool isBuilding() const noexcept;
    [[nodiscard]] std::uint32_t nextSequence() const noexcept;

private:
    [[nodiscard]] bool prepareCommand(const CommandHeader& header, bool overlayCommand) noexcept;
    [[nodiscard]] bool ensureCommandCapacity(
        CommandKind kind,
        std::size_t textByteCount = 0,
        std::size_t glyphCount = 0,
        std::size_t meshVertexCount = 0,
        std::size_t meshIndexCount = 0,
        std::size_t gradientStopCount = 0
    );
    void commitOrder(const CommandHeader& header) noexcept;
    void releasePacket() noexcept;
    void resetBuildState() noexcept;
    void fail(FrameBuildError error) noexcept;

    FramePacket& packet_;
    PacketCapacityPolicy capacityPolicy_ = PacketCapacityPolicy::growAsNeeded;
    FrameBuildError error_ = FrameBuildError::none;
    std::uint32_t nextSequence_ = 0;
    std::uint8_t previousLayer_ = 0;
    std::int32_t previousLayerOrder_ = 0;
    bool hasPreviousCommand_ = false;
    bool building_ = false;
};

} // namespace cirvivor::render::frontend
