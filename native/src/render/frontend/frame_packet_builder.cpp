#include "render/frontend/frame_packet_builder.h"

#include <algorithm>
#include <cstdint>
#include <limits>
#include <vector>

namespace cirvivor::render::frontend {

namespace {

template<typename T>
void reserveOneMore(std::vector<T>& values, const std::size_t minimumCapacity) {
    if (minimumCapacity <= values.capacity()) {
        return;
    }

    constexpr std::size_t minimumGrowth = 16;
    const std::size_t current = values.capacity();
    const std::size_t doubled = current <= std::numeric_limits<std::size_t>::max() / 2U
        ? current * 2U
        : std::numeric_limits<std::size_t>::max();
    values.reserve(std::max({minimumCapacity, doubled, minimumGrowth}));
}

[[nodiscard]] bool coordinateSpaceIsValid(const CoordinateSpace space) noexcept {
    switch (space) {
        case CoordinateSpace::physicalPixels:
        case CoordinateSpace::drawablePixels:
        case CoordinateSpace::logicalUi:
        case CoordinateSpace::world:
            return true;
    }
    return false;
}

[[nodiscard]] bool blendModeIsValid(const BlendMode mode) noexcept {
    switch (mode) {
        case BlendMode::opaque:
        case BlendMode::premultipliedAlpha:
        case BlendMode::additivePremultiplied:
            return true;
    }
    return false;
}

[[nodiscard]] bool aliasesTextStorage(
    const std::string_view text,
    const std::vector<char>& storage
) noexcept {
    if (text.empty() || text.data() == nullptr || storage.data() == nullptr
        || storage.capacity() == 0U) {
        return false;
    }

    const auto inputStart = reinterpret_cast<std::uintptr_t>(text.data());
    const auto storageStart = reinterpret_cast<std::uintptr_t>(storage.data());
    if (inputStart >= storageStart) {
        return inputStart - storageStart < storage.capacity();
    }
    return text.size() > storageStart - inputStart;
}

template<typename T>
[[nodiscard]] bool aliasesStorage(
    const std::span<const T> input,
    const std::vector<T>& storage
) noexcept {
    if (input.empty() || input.data() == nullptr || storage.data() == nullptr
        || storage.capacity() == 0U) {
        return false;
    }

    const auto inputStart = reinterpret_cast<std::uintptr_t>(input.data());
    const auto storageStart = reinterpret_cast<std::uintptr_t>(storage.data());
    const std::size_t storageBytes = storage.capacity() * sizeof(T);
    if (inputStart >= storageStart) {
        return inputStart - storageStart < storageBytes;
    }
    return input.size_bytes() > storageStart - inputStart;
}

[[nodiscard]] bool appendRangeFits(
    const std::size_t current,
    const std::size_t additional
) noexcept {
    constexpr std::size_t maximum = std::numeric_limits<std::uint32_t>::max();
    return current <= maximum && additional <= maximum - current;
}

} // namespace

FramePacketBuilder::FramePacketBuilder(
    FramePacket& packet,
    const PacketCapacityPolicy capacityPolicy
) noexcept
    : packet_(packet),
      capacityPolicy_(capacityPolicy) {
}

FramePacketBuilder::~FramePacketBuilder() {
    if (packet_.activeBuilder_ == this) {
        packet_.clear();
    }
    releasePacket();
    building_ = false;
}

bool FramePacketBuilder::begin(
    const FrameMetadata& metadata,
    const ViewportState& viewport
) noexcept {
    if (building_) {
        fail(FrameBuildError::alreadyBuilding);
        return false;
    }
    if (packet_.activeBuilder_ != nullptr && packet_.activeBuilder_ != this) {
        fail(FrameBuildError::packetAlreadyHasBuilder);
        return false;
    }

    packet_.activeBuilder_ = this;
    packet_.clear();
    packet_.metadata_ = metadata;
    packet_.metadata_.alphaEncoding = AlphaEncoding::premultiplied;
    packet_.viewport_ = viewport;
    error_ = FrameBuildError::none;
    nextSequence_ = 0;
    previousLayer_ = 0;
    previousLayerOrder_ = 0;
    hasPreviousCommand_ = false;
    building_ = true;
    return true;
}

bool FramePacketBuilder::finish() noexcept {
    if (!building_) {
        fail(FrameBuildError::notBuilding);
        return false;
    }

    if (error_ != FrameBuildError::none) {
        if (packet_.activeBuilder_ == this) {
            packet_.clear();
        }
        building_ = false;
        releasePacket();
        return false;
    }
    if (!packet_.isRenderOrderValid()) {
        fail(FrameBuildError::structurallyInvalid);
        if (packet_.activeBuilder_ == this) {
            packet_.clear();
        }
        building_ = false;
        releasePacket();
        return false;
    }
    building_ = false;
    releasePacket();
    return true;
}

void FramePacketBuilder::abort() noexcept {
    if (packet_.activeBuilder_ == this) {
        packet_.clear();
    }
    releasePacket();
    error_ = FrameBuildError::none;
    resetBuildState();
}

void FramePacketBuilder::resetBuildState() noexcept {
    nextSequence_ = 0;
    previousLayer_ = 0;
    previousLayerOrder_ = 0;
    hasPreviousCommand_ = false;
    building_ = false;
}

void FramePacketBuilder::releasePacket() noexcept {
    if (packet_.activeBuilder_ == this) {
        packet_.activeBuilder_ = nullptr;
    }
}

bool FramePacketBuilder::prepareCommand(
    const CommandHeader& header,
    const bool overlayCommand
) noexcept {
    if (!building_) {
        fail(FrameBuildError::notBuilding);
        return false;
    }
    if (packet_.activeBuilder_ != this) {
        fail(FrameBuildError::packetAlreadyHasBuilder);
        return false;
    }
    if (error_ != FrameBuildError::none) {
        return false;
    }
    if (!isRenderLayer(header.layer)
        || !coordinateSpaceIsValid(header.coordinateSpace)
        || !blendModeIsValid(header.blendMode)) {
        fail(FrameBuildError::invalidLayer);
        return false;
    }
    if (overlayCommand && header.layer != RenderLayer::dynamicOverlay) {
        fail(FrameBuildError::invalidOverlayLayer);
        return false;
    }
    if (nextSequence_ == std::numeric_limits<std::uint32_t>::max()) {
        fail(FrameBuildError::commandCountOverflow);
        return false;
    }

    const std::uint8_t layer = renderLayerOrder(header.layer);
    if (hasPreviousCommand_
        && (layer < previousLayer_
            || (layer == previousLayer_ && header.layerOrder < previousLayerOrder_))) {
        fail(FrameBuildError::renderOrderRegression);
        return false;
    }
    return true;
}

bool FramePacketBuilder::ensureCommandCapacity(
    const CommandKind kind,
    const std::size_t textByteCount,
    const std::size_t glyphCount,
    const std::size_t meshVertexCount,
    const std::size_t meshIndexCount,
    const std::size_t gradientStopCount
) {
    const std::size_t nextCommandCount = packet_.commandStream_.size() + 1U;
    const bool commandStreamFull = nextCommandCount > packet_.commandStream_.capacity();
    bool commandTypeFull = false;
    switch (kind) {
        case CommandKind::sprite:
            commandTypeFull = packet_.sprites_.size() + 1U > packet_.sprites_.capacity();
            break;
        case CommandKind::shape:
            commandTypeFull = packet_.shapes_.size() + 1U > packet_.shapes_.capacity();
            break;
        case CommandKind::line:
            commandTypeFull = packet_.lines_.size() + 1U > packet_.lines_.capacity();
            break;
        case CommandKind::text:
            commandTypeFull = packet_.textRuns_.size() + 1U > packet_.textRuns_.capacity();
            break;
        case CommandKind::effect:
            commandTypeFull = packet_.effects_.size() + 1U > packet_.effects_.capacity();
            break;
        case CommandKind::ui:
            commandTypeFull = packet_.ui_.size() + 1U > packet_.ui_.capacity();
            break;
        case CommandKind::overlay:
            commandTypeFull = packet_.overlays_.size() + 1U > packet_.overlays_.capacity();
            break;
        case CommandKind::glyphRun:
            commandTypeFull = packet_.glyphRuns_.size() + 1U > packet_.glyphRuns_.capacity();
            break;
        case CommandKind::texturedMesh:
            commandTypeFull = packet_.texturedMeshes_.size() + 1U
                > packet_.texturedMeshes_.capacity();
            break;
        case CommandKind::gradient:
            commandTypeFull = packet_.gradients_.size() + 1U > packet_.gradients_.capacity();
            break;
        case CommandKind::clip:
            commandTypeFull = packet_.clips_.size() + 1U > packet_.clips_.capacity();
            break;
        case CommandKind::pass:
            commandTypeFull = packet_.passes_.size() + 1U > packet_.passes_.capacity();
            break;
    }

    const bool textStorageFull = textByteCount > packet_.utf8Bytes_.capacity() - packet_.utf8Bytes_.size();
    const bool glyphStorageFull = glyphCount
        > packet_.glyphInstances_.capacity() - packet_.glyphInstances_.size();
    const bool meshVertexStorageFull = meshVertexCount
        > packet_.meshVertices_.capacity() - packet_.meshVertices_.size();
    const bool meshIndexStorageFull = meshIndexCount
        > packet_.meshIndices_.capacity() - packet_.meshIndices_.size();
    const bool gradientStopStorageFull = gradientStopCount
        > packet_.gradientStops_.capacity() - packet_.gradientStops_.size();
    if (capacityPolicy_ == PacketCapacityPolicy::fixedCapacity
        && (commandStreamFull
            || commandTypeFull
            || textStorageFull
            || glyphStorageFull
            || meshVertexStorageFull
            || meshIndexStorageFull
            || gradientStopStorageFull)) {
        fail(FrameBuildError::capacityExceeded);
        return false;
    }

    reserveOneMore(packet_.commandStream_, nextCommandCount);
    switch (kind) {
        case CommandKind::sprite:
            reserveOneMore(packet_.sprites_, packet_.sprites_.size() + 1U);
            break;
        case CommandKind::shape:
            reserveOneMore(packet_.shapes_, packet_.shapes_.size() + 1U);
            break;
        case CommandKind::line:
            reserveOneMore(packet_.lines_, packet_.lines_.size() + 1U);
            break;
        case CommandKind::text:
            reserveOneMore(packet_.textRuns_, packet_.textRuns_.size() + 1U);
            break;
        case CommandKind::effect:
            reserveOneMore(packet_.effects_, packet_.effects_.size() + 1U);
            break;
        case CommandKind::ui:
            reserveOneMore(packet_.ui_, packet_.ui_.size() + 1U);
            break;
        case CommandKind::overlay:
            reserveOneMore(packet_.overlays_, packet_.overlays_.size() + 1U);
            break;
        case CommandKind::glyphRun:
            reserveOneMore(packet_.glyphRuns_, packet_.glyphRuns_.size() + 1U);
            break;
        case CommandKind::texturedMesh:
            reserveOneMore(packet_.texturedMeshes_, packet_.texturedMeshes_.size() + 1U);
            break;
        case CommandKind::gradient:
            reserveOneMore(packet_.gradients_, packet_.gradients_.size() + 1U);
            break;
        case CommandKind::clip:
            reserveOneMore(packet_.clips_, packet_.clips_.size() + 1U);
            break;
        case CommandKind::pass:
            reserveOneMore(packet_.passes_, packet_.passes_.size() + 1U);
            break;
    }

    if (textByteCount > 0) {
        reserveOneMore(packet_.utf8Bytes_, packet_.utf8Bytes_.size() + textByteCount);
    }
    if (glyphCount > 0U) {
        reserveOneMore(packet_.glyphInstances_, packet_.glyphInstances_.size() + glyphCount);
    }
    if (meshVertexCount > 0U) {
        reserveOneMore(packet_.meshVertices_, packet_.meshVertices_.size() + meshVertexCount);
    }
    if (meshIndexCount > 0U) {
        reserveOneMore(packet_.meshIndices_, packet_.meshIndices_.size() + meshIndexCount);
    }
    if (gradientStopCount > 0U) {
        reserveOneMore(packet_.gradientStops_, packet_.gradientStops_.size() + gradientStopCount);
    }
    return true;
}

void FramePacketBuilder::commitOrder(const CommandHeader& header) noexcept {
    hasPreviousCommand_ = true;
    previousLayer_ = renderLayerOrder(header.layer);
    previousLayerOrder_ = header.layerOrder;
    ++nextSequence_;
}

bool FramePacketBuilder::addSprite(SpriteCommand command) {
    if (!prepareCommand(command.header, false)
        || !ensureCommandCapacity(CommandKind::sprite, 0)) {
        return false;
    }
    command.header.sequence = nextSequence_;
    const auto index = static_cast<std::uint32_t>(packet_.sprites_.size());
    packet_.sprites_.push_back(command);
    packet_.commandStream_.push_back({CommandKind::sprite, {}, index});
    commitOrder(command.header);
    return true;
}

bool FramePacketBuilder::addShape(ShapeCommand command) {
    if (!prepareCommand(command.header, false)
        || !ensureCommandCapacity(CommandKind::shape, 0)) {
        return false;
    }
    command.header.sequence = nextSequence_;
    const auto index = static_cast<std::uint32_t>(packet_.shapes_.size());
    packet_.shapes_.push_back(command);
    packet_.commandStream_.push_back({CommandKind::shape, {}, index});
    commitOrder(command.header);
    return true;
}

bool FramePacketBuilder::addLine(LineCommand command) {
    if (!prepareCommand(command.header, false)
        || !ensureCommandCapacity(CommandKind::line, 0)) {
        return false;
    }
    command.header.sequence = nextSequence_;
    const auto index = static_cast<std::uint32_t>(packet_.lines_.size());
    packet_.lines_.push_back(command);
    packet_.commandStream_.push_back({CommandKind::line, {}, index});
    commitOrder(command.header);
    return true;
}

bool FramePacketBuilder::addText(TextCommand command, const std::string_view utf8) {
    if (!prepareCommand(command.header, false)) {
        return false;
    }
    if (aliasesTextStorage(utf8, packet_.utf8Bytes_)) {
        fail(FrameBuildError::textAliasesPacketStorage);
        return false;
    }
    const std::size_t byteOffset = packet_.utf8Bytes_.size();
    if (utf8.size() > std::numeric_limits<std::uint32_t>::max()
        || byteOffset > std::numeric_limits<std::uint32_t>::max()
        || utf8.size() > std::numeric_limits<std::uint32_t>::max() - byteOffset) {
        fail(FrameBuildError::textStorageOverflow);
        return false;
    }
    if (!ensureCommandCapacity(CommandKind::text, utf8.size())) {
        return false;
    }

    command.header.sequence = nextSequence_;
    command.utf8 = {
        static_cast<std::uint32_t>(byteOffset),
        static_cast<std::uint32_t>(utf8.size())
    };
    packet_.utf8Bytes_.insert(packet_.utf8Bytes_.end(), utf8.begin(), utf8.end());
    const auto index = static_cast<std::uint32_t>(packet_.textRuns_.size());
    packet_.textRuns_.push_back(command);
    packet_.commandStream_.push_back({CommandKind::text, {}, index});
    commitOrder(command.header);
    return true;
}

bool FramePacketBuilder::addEffect(EffectCommand command) {
    if (!prepareCommand(command.header, false)
        || !ensureCommandCapacity(CommandKind::effect, 0)) {
        return false;
    }
    command.header.sequence = nextSequence_;
    const auto index = static_cast<std::uint32_t>(packet_.effects_.size());
    packet_.effects_.push_back(command);
    packet_.commandStream_.push_back({CommandKind::effect, {}, index});
    commitOrder(command.header);
    return true;
}

bool FramePacketBuilder::addUi(UiCommand command) {
    if (!prepareCommand(command.header, false)
        || !ensureCommandCapacity(CommandKind::ui, 0)) {
        return false;
    }
    command.header.sequence = nextSequence_;
    const auto index = static_cast<std::uint32_t>(packet_.ui_.size());
    packet_.ui_.push_back(command);
    packet_.commandStream_.push_back({CommandKind::ui, {}, index});
    commitOrder(command.header);
    return true;
}

bool FramePacketBuilder::addOverlay(OverlayCommand command) {
    if (!prepareCommand(command.header, true)
        || !ensureCommandCapacity(CommandKind::overlay, 0)) {
        return false;
    }
    command.header.sequence = nextSequence_;
    const auto index = static_cast<std::uint32_t>(packet_.overlays_.size());
    packet_.overlays_.push_back(command);
    packet_.commandStream_.push_back({CommandKind::overlay, {}, index});
    commitOrder(command.header);
    return true;
}

bool FramePacketBuilder::addGlyphRun(
    GlyphRunCommand command,
    const std::span<const GlyphInstance> glyphs
) {
    if (!prepareCommand(command.header, false)) {
        return false;
    }
    if (aliasesStorage(glyphs, packet_.glyphInstances_)) {
        fail(FrameBuildError::storageAliasesPacketStorage);
        return false;
    }
    const std::size_t offset = packet_.glyphInstances_.size();
    if (!appendRangeFits(offset, glyphs.size())) {
        fail(FrameBuildError::auxiliaryStorageOverflow);
        return false;
    }
    if (!ensureCommandCapacity(CommandKind::glyphRun, 0, glyphs.size())) {
        return false;
    }

    command.header.sequence = nextSequence_;
    command.glyphs = {
        static_cast<std::uint32_t>(offset),
        static_cast<std::uint32_t>(glyphs.size())
    };
    packet_.glyphInstances_.insert(
        packet_.glyphInstances_.end(),
        glyphs.begin(),
        glyphs.end()
    );
    const auto index = static_cast<std::uint32_t>(packet_.glyphRuns_.size());
    packet_.glyphRuns_.push_back(command);
    packet_.commandStream_.push_back({CommandKind::glyphRun, {}, index});
    commitOrder(command.header);
    return true;
}

bool FramePacketBuilder::addTexturedMesh(
    TexturedMeshCommand command,
    const std::span<const ProjectiveVertex> vertices,
    const std::span<const std::uint32_t> indices
) {
    if (!prepareCommand(command.header, false)) {
        return false;
    }
    if (aliasesStorage(vertices, packet_.meshVertices_)
        || aliasesStorage(indices, packet_.meshIndices_)) {
        fail(FrameBuildError::storageAliasesPacketStorage);
        return false;
    }
    const std::size_t vertexOffset = packet_.meshVertices_.size();
    const std::size_t indexOffset = packet_.meshIndices_.size();
    if (!appendRangeFits(vertexOffset, vertices.size())
        || !appendRangeFits(indexOffset, indices.size())) {
        fail(FrameBuildError::auxiliaryStorageOverflow);
        return false;
    }
    if (!ensureCommandCapacity(
            CommandKind::texturedMesh,
            0,
            0,
            vertices.size(),
            indices.size()
        )) {
        return false;
    }

    command.header.sequence = nextSequence_;
    command.vertices = {
        static_cast<std::uint32_t>(vertexOffset),
        static_cast<std::uint32_t>(vertices.size())
    };
    command.indices = {
        static_cast<std::uint32_t>(indexOffset),
        static_cast<std::uint32_t>(indices.size())
    };
    packet_.meshVertices_.insert(
        packet_.meshVertices_.end(),
        vertices.begin(),
        vertices.end()
    );
    packet_.meshIndices_.insert(
        packet_.meshIndices_.end(),
        indices.begin(),
        indices.end()
    );
    const auto index = static_cast<std::uint32_t>(packet_.texturedMeshes_.size());
    packet_.texturedMeshes_.push_back(command);
    packet_.commandStream_.push_back({CommandKind::texturedMesh, {}, index});
    commitOrder(command.header);
    return true;
}

bool FramePacketBuilder::addGradient(
    GradientCommand command,
    const std::span<const GradientStop> stops
) {
    if (!prepareCommand(command.header, false)) {
        return false;
    }
    if (aliasesStorage(stops, packet_.gradientStops_)) {
        fail(FrameBuildError::storageAliasesPacketStorage);
        return false;
    }
    const std::size_t offset = packet_.gradientStops_.size();
    if (!appendRangeFits(offset, stops.size())) {
        fail(FrameBuildError::auxiliaryStorageOverflow);
        return false;
    }
    if (!ensureCommandCapacity(CommandKind::gradient, 0, 0, 0, 0, stops.size())) {
        return false;
    }

    command.header.sequence = nextSequence_;
    command.stops = {
        static_cast<std::uint32_t>(offset),
        static_cast<std::uint32_t>(stops.size())
    };
    packet_.gradientStops_.insert(
        packet_.gradientStops_.end(),
        stops.begin(),
        stops.end()
    );
    const auto index = static_cast<std::uint32_t>(packet_.gradients_.size());
    packet_.gradients_.push_back(command);
    packet_.commandStream_.push_back({CommandKind::gradient, {}, index});
    commitOrder(command.header);
    return true;
}

bool FramePacketBuilder::addClip(ClipCommand command) {
    if (!prepareCommand(command.header, false)
        || !ensureCommandCapacity(CommandKind::clip)) {
        return false;
    }
    command.header.sequence = nextSequence_;
    const auto index = static_cast<std::uint32_t>(packet_.clips_.size());
    packet_.clips_.push_back(command);
    packet_.commandStream_.push_back({CommandKind::clip, {}, index});
    commitOrder(command.header);
    return true;
}

bool FramePacketBuilder::addPass(PassCommand command) {
    if (!prepareCommand(command.header, true)
        || !ensureCommandCapacity(CommandKind::pass)) {
        return false;
    }
    command.header.sequence = nextSequence_;
    const auto index = static_cast<std::uint32_t>(packet_.passes_.size());
    packet_.passes_.push_back(command);
    packet_.commandStream_.push_back({CommandKind::pass, {}, index});
    commitOrder(command.header);
    return true;
}

FrameBuildError FramePacketBuilder::error() const noexcept {
    return error_;
}

bool FramePacketBuilder::isBuilding() const noexcept {
    return building_;
}

const ViewportState* FramePacketBuilder::activeViewport() const noexcept {
    return building_ && packet_.activeBuilder_ == this
        ? &packet_.viewport_
        : nullptr;
}

std::uint32_t FramePacketBuilder::nextSequence() const noexcept {
    return nextSequence_;
}

void FramePacketBuilder::fail(const FrameBuildError error) noexcept {
    if (error_ == FrameBuildError::none) {
        error_ = error;
    }
}

} // namespace cirvivor::render::frontend
