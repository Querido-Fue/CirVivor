#include "render/common/frame_packet.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>
#include <utility>

namespace cirvivor::render {

namespace {

[[nodiscard]] bool textSliceIsValid(
    const TextSlice slice,
    const std::size_t byteCount
) noexcept {
    const auto offset = static_cast<std::size_t>(slice.byteOffset);
    const auto length = static_cast<std::size_t>(slice.byteLength);
    return offset <= byteCount && length <= byteCount - offset;
}

[[nodiscard]] bool finite(const float value) noexcept {
    return std::isfinite(value);
}

[[nodiscard]] bool finite(const double value) noexcept {
    return std::isfinite(value);
}

[[nodiscard]] bool vecIsFinite(const Vec2F value) noexcept {
    return finite(value.x) && finite(value.y);
}

[[nodiscard]] bool sizeIsNonNegative(const SizeF value) noexcept {
    return finite(value.width) && finite(value.height)
        && value.width >= 0.0F && value.height >= 0.0F;
}

[[nodiscard]] bool rectIsNonNegative(const RectF value) noexcept {
    return finite(value.x) && finite(value.y)
        && finite(value.width) && finite(value.height)
        && value.width >= 0.0F && value.height >= 0.0F;
}

[[nodiscard]] bool colorIsPremultiplied(const PremultipliedRgba color) noexcept {
    return finite(color.red) && finite(color.green)
        && finite(color.blue) && finite(color.alpha)
        && color.alpha >= 0.0F && color.alpha <= 1.0F
        && color.red >= 0.0F && color.red <= color.alpha
        && color.green >= 0.0F && color.green <= color.alpha
        && color.blue >= 0.0F && color.blue <= color.alpha;
}

[[nodiscard]] bool matrixIsFinite(const Mat3F& matrix) noexcept {
    return std::all_of(
        matrix.elements.begin(),
        matrix.elements.end(),
        [](const float value) noexcept { return finite(value); }
    );
}

[[nodiscard]] bool rectIsContained(const RectI rect, const SizeI size) noexcept {
    if (size.width <= 0 || size.height <= 0
        || rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0) {
        return false;
    }
    const std::int64_t right = static_cast<std::int64_t>(rect.x) + rect.width;
    const std::int64_t bottom = static_cast<std::int64_t>(rect.y) + rect.height;
    return right <= size.width && bottom <= size.height;
}

[[nodiscard]] bool rectIsContained(const RectF rect, const SizeF size) noexcept {
    return rectIsNonNegative(rect)
        && sizeIsNonNegative(size)
        && size.width > 0.0F && size.height > 0.0F
        && rect.x >= 0.0F && rect.y >= 0.0F
        && rect.width > 0.0F && rect.height > 0.0F
        && rect.x + rect.width <= size.width
        && rect.y + rect.height <= size.height;
}

[[nodiscard]] bool insetsAreValid(const InsetsI insets, const SizeI size) noexcept {
    return insets.left >= 0 && insets.top >= 0
        && insets.right >= 0 && insets.bottom >= 0
        && static_cast<std::int64_t>(insets.left) + insets.right <= size.width
        && static_cast<std::int64_t>(insets.top) + insets.bottom <= size.height;
}

[[nodiscard]] bool insetsAreValid(const InsetsF insets, const SizeF size) noexcept {
    return finite(insets.left) && finite(insets.top)
        && finite(insets.right) && finite(insets.bottom)
        && insets.left >= 0.0F && insets.top >= 0.0F
        && insets.right >= 0.0F && insets.bottom >= 0.0F
        && insets.left + insets.right <= size.width
        && insets.top + insets.bottom <= size.height;
}

[[nodiscard]] bool scalesAreUniform(const float first, const float second) noexcept {
    if (!finite(first) || !finite(second) || first <= 0.0F || second <= 0.0F) {
        return false;
    }
    const float scale = std::max({1.0F, std::abs(first), std::abs(second)});
    return std::abs(first - second) <= std::numeric_limits<float>::epsilon() * scale;
}

[[nodiscard]] bool viewportIsValid(const ViewportState& viewport) noexcept {
    const SizeI drawableSize = viewport.drawable.size;
    const RectI contentRect = viewport.drawable.contentRect;
    const SizeF logicalContentSize{
        viewport.logicalUi.contentRect.width,
        viewport.logicalUi.contentRect.height
    };
    return viewport.physical.displaySize.width > 0
        && viewport.physical.displaySize.height > 0
        && viewport.physical.windowBounds.width >= 0
        && viewport.physical.windowBounds.height >= 0
        && finite(viewport.physical.dpiScale)
        && viewport.physical.dpiScale > 0.0F
        && rectIsContained(contentRect, drawableSize)
        && insetsAreValid(viewport.drawable.safeArea, {contentRect.width, contentRect.height})
        && viewport.drawable.worldRenderTargetSize.width > 0
        && viewport.drawable.worldRenderTargetSize.height > 0
        && finite(viewport.drawable.worldRenderScale)
        && viewport.drawable.worldRenderScale > 0.0F
        && rectIsContained(viewport.logicalUi.contentRect, viewport.logicalUi.size)
        && insetsAreValid(viewport.logicalUi.safeArea, logicalContentSize)
        && scalesAreUniform(
            viewport.logicalUi.drawablePixelsPerLogicalUnitX,
            viewport.logicalUi.drawablePixelsPerLogicalUnitY
        )
        && finite(viewport.logicalUi.uiScale)
        && viewport.logicalUi.uiScale > 0.0F
        && rectIsNonNegative(viewport.world.visibleBounds)
        && viewport.world.visibleBounds.width > 0.0F
        && viewport.world.visibleBounds.height > 0.0F
        && matrixIsFinite(viewport.world.worldToDrawable)
        && matrixIsFinite(viewport.world.drawableToWorld)
        && finite(viewport.world.drawablePixelsPerWorldUnit)
        && viewport.world.drawablePixelsPerWorldUnit > 0.0F;
}

[[nodiscard]] bool isContinuationByte(const std::uint8_t value) noexcept {
    return value >= 0x80U && value <= 0xbfU;
}

[[nodiscard]] std::uint8_t utf8Byte(
    const std::span<const char> bytes,
    const std::size_t index
) noexcept {
    return static_cast<std::uint8_t>(static_cast<unsigned char>(bytes[index]));
}

[[nodiscard]] bool utf8IsValid(const std::span<const char> bytes) noexcept {
    std::size_t index = 0;
    while (index < bytes.size()) {
        const std::uint8_t first = utf8Byte(bytes, index);
        if (first <= 0x7fU) {
            ++index;
            continue;
        }
        if (first >= 0xc2U && first <= 0xdfU) {
            if (index + 1U >= bytes.size()
                || !isContinuationByte(utf8Byte(bytes, index + 1U))) {
                return false;
            }
            index += 2U;
            continue;
        }
        if (first >= 0xe0U && first <= 0xefU) {
            if (index + 2U >= bytes.size()) {
                return false;
            }
            const std::uint8_t second = utf8Byte(bytes, index + 1U);
            const std::uint8_t third = utf8Byte(bytes, index + 2U);
            const bool secondIsValid = first == 0xe0U
                ? second >= 0xa0U && second <= 0xbfU
                : (first == 0xedU
                    ? second >= 0x80U && second <= 0x9fU
                    : isContinuationByte(second));
            if (!secondIsValid || !isContinuationByte(third)) {
                return false;
            }
            index += 3U;
            continue;
        }
        if (first >= 0xf0U && first <= 0xf4U) {
            if (index + 3U >= bytes.size()) {
                return false;
            }
            const std::uint8_t second = utf8Byte(bytes, index + 1U);
            const bool secondIsValid = first == 0xf0U
                ? second >= 0x90U && second <= 0xbfU
                : (first == 0xf4U
                    ? second >= 0x80U && second <= 0x8fU
                    : isContinuationByte(second));
            if (!secondIsValid
                || !isContinuationByte(utf8Byte(bytes, index + 2U))
                || !isContinuationByte(utf8Byte(bytes, index + 3U))) {
                return false;
            }
            index += 4U;
            continue;
        }
        return false;
    }
    return true;
}

[[nodiscard]] bool commandHeaderIsValid(const CommandHeader& header) noexcept {
    const auto coordinateSpace = static_cast<std::uint8_t>(header.coordinateSpace);
    const auto blendMode = static_cast<std::uint8_t>(header.blendMode);
    return isRenderLayer(header.layer)
        && coordinateSpace <= static_cast<std::uint8_t>(CoordinateSpace::world)
        && blendMode <= static_cast<std::uint8_t>(BlendMode::additivePremultiplied);
}

[[nodiscard]] bool commandValuesAreValid(const SpriteCommand& command) noexcept {
    return commandHeaderIsValid(command.header)
        && static_cast<std::uint8_t>(command.sampling)
            <= static_cast<std::uint8_t>(SamplingMode::linear)
        && command.flipX <= 1U
        && command.flipY <= 1U
        && command.reserved == 0U
        && rectIsNonNegative(command.destination)
        && rectIsNonNegative(command.uv)
        && vecIsFinite(command.pivot)
        && finite(command.rotationRadians)
        && colorIsPremultiplied(command.tint);
}

[[nodiscard]] bool commandValuesAreValid(const ShapeCommand& command) noexcept {
    return commandHeaderIsValid(command.header)
        && static_cast<std::uint8_t>(command.shape)
            <= static_cast<std::uint8_t>(ShapeType::arrow)
        && command.fillEnabled <= 1U
        && command.strokeEnabled <= 1U
        && command.reserved == 0U
        && rectIsNonNegative(command.bounds)
        && finite(command.cornerRadius) && command.cornerRadius >= 0.0F
        && finite(command.strokeWidth) && command.strokeWidth >= 0.0F
        && finite(command.rotationRadians)
        && colorIsPremultiplied(command.fill)
        && colorIsPremultiplied(command.stroke);
}

[[nodiscard]] bool commandValuesAreValid(const LineCommand& command) noexcept {
    return commandHeaderIsValid(command.header)
        && static_cast<std::uint8_t>(command.cap)
            <= static_cast<std::uint8_t>(LineCap::square)
        && command.reserved == std::array<std::uint8_t, 3>{}
        && vecIsFinite(command.start)
        && vecIsFinite(command.end)
        && finite(command.width) && command.width >= 0.0F
        && colorIsPremultiplied(command.color);
}

[[nodiscard]] bool commandValuesAreValid(
    const TextCommand& command,
    const std::size_t textByteCount
) noexcept {
    return commandHeaderIsValid(command.header)
        && textSliceIsValid(command.utf8, textByteCount)
        && static_cast<std::uint8_t>(command.align)
            <= static_cast<std::uint8_t>(TextAlign::end)
        && static_cast<std::uint8_t>(command.baseline)
            <= static_cast<std::uint8_t>(TextBaseline::bottom)
        && static_cast<std::uint8_t>(command.wrap)
            <= static_cast<std::uint8_t>(TextWrap::character)
        && command.reserved == 0U
        && vecIsFinite(command.origin)
        && sizeIsNonNegative(command.maximumSize)
        && finite(command.fontSize) && command.fontSize >= 0.0F
        && finite(command.lineHeight) && command.lineHeight >= 0.0F
        && finite(command.rotationRadians)
        && colorIsPremultiplied(command.color);
}

[[nodiscard]] bool commandValuesAreValid(const EffectCommand& command) noexcept {
    const auto effect = static_cast<std::uint8_t>(command.effect);
    return commandHeaderIsValid(command.header)
        && (effect <= static_cast<std::uint8_t>(EffectType::glassComposite)
            || effect == static_cast<std::uint8_t>(EffectType::custom))
        && static_cast<std::uint8_t>(command.quality)
            <= static_cast<std::uint8_t>(EffectQuality::softwareReplacement)
        && rectIsNonNegative(command.bounds)
        && vecIsFinite(command.origin)
        && colorIsPremultiplied(command.primaryColor)
        && colorIsPremultiplied(command.secondaryColor)
        && std::all_of(
            command.parameters.begin(),
            command.parameters.end(),
            [](const float value) noexcept { return finite(value); }
        );
}

[[nodiscard]] bool commandValuesAreValid(const UiCommand& command) noexcept {
    const auto primitive = static_cast<std::uint8_t>(command.primitive);
    constexpr std::uint16_t validStateBits = uiStateBits(UiStateFlag::hovered)
        | uiStateBits(UiStateFlag::pressed)
        | uiStateBits(UiStateFlag::disabled)
        | uiStateBits(UiStateFlag::selected)
        | uiStateBits(UiStateFlag::focused);
    return commandHeaderIsValid(command.header)
        && (primitive <= static_cast<std::uint8_t>(UiPrimitive::cursor)
            || primitive == static_cast<std::uint8_t>(UiPrimitive::custom))
        && command.reserved == 0U
        && (command.stateFlags & static_cast<std::uint16_t>(~validStateBits)) == 0U
        && rectIsNonNegative(command.bounds)
        && finite(command.cornerRadius) && command.cornerRadius >= 0.0F
        && finite(command.borderWidth) && command.borderWidth >= 0.0F
        && finite(command.value)
        && colorIsPremultiplied(command.backgroundColor)
        && colorIsPremultiplied(command.borderColor)
        && colorIsPremultiplied(command.accentColor);
}

[[nodiscard]] bool commandValuesAreValid(const OverlayCommand& command) noexcept {
    constexpr RenderLayerMask validSourceLayers = static_cast<RenderLayerMask>(
        (1U << renderLayerOrder(RenderLayer::dynamicOverlay)) - 1U
    );
    const bool isSessionBoundary = command.operation == OverlayOperation::beginSession
        || command.operation == OverlayOperation::endSession;
    return commandHeaderIsValid(command.header)
        && command.header.layer == RenderLayer::dynamicOverlay
        && static_cast<std::uint8_t>(command.operation)
            <= static_cast<std::uint8_t>(OverlayOperation::endSession)
        && static_cast<std::uint8_t>(command.updateMode)
            <= static_cast<std::uint8_t>(BackdropUpdateMode::always)
        && (command.sourceLayers & static_cast<RenderLayerMask>(~validSourceLayers)) == 0U
        && (!isSessionBoundary || command.sourceLayers == 0U)
        && command.sessionId != 0U
        && rectIsNonNegative(command.sourceBounds)
        && rectIsNonNegative(command.destinationBounds)
        && finite(command.opacity) && command.opacity >= 0.0F && command.opacity <= 1.0F
        && finite(command.blurRadius) && command.blurRadius >= 0.0F
        && finite(command.refractionStrength) && command.refractionStrength >= 0.0F
        && finite(command.edgeStrength) && command.edgeStrength >= 0.0F
        && colorIsPremultiplied(command.tintColor)
        && colorIsPremultiplied(command.edgeColor)
        && colorIsPremultiplied(command.shadowColor);
}

[[nodiscard]] std::size_t commandKindIndex(const CommandKind kind) noexcept {
    const auto index = static_cast<std::size_t>(kind);
    return index < 7U ? index : 7U;
}

} // namespace

FramePacket::FramePacket(const FramePacketCapacity& capacity) {
    reserve(capacity);
}

FramePacket::FramePacket(const FramePacket& other)
    : metadata_(other.metadata_),
      viewport_(other.viewport_),
      commandStream_(other.commandStream_),
      sprites_(other.sprites_),
      shapes_(other.shapes_),
      lines_(other.lines_),
      textRuns_(other.textRuns_),
      effects_(other.effects_),
      ui_(other.ui_),
      overlays_(other.overlays_),
      utf8Bytes_(other.utf8Bytes_) {
}

FramePacket& FramePacket::operator=(const FramePacket& other) {
    if (this == &other) {
        return *this;
    }
    metadata_ = other.metadata_;
    viewport_ = other.viewport_;
    commandStream_ = other.commandStream_;
    sprites_ = other.sprites_;
    shapes_ = other.shapes_;
    lines_ = other.lines_;
    textRuns_ = other.textRuns_;
    effects_ = other.effects_;
    ui_ = other.ui_;
    overlays_ = other.overlays_;
    utf8Bytes_ = other.utf8Bytes_;
    return *this;
}

FramePacket::FramePacket(FramePacket&& other) noexcept
    : metadata_(other.metadata_),
      viewport_(other.viewport_),
      commandStream_(std::move(other.commandStream_)),
      sprites_(std::move(other.sprites_)),
      shapes_(std::move(other.shapes_)),
      lines_(std::move(other.lines_)),
      textRuns_(std::move(other.textRuns_)),
      effects_(std::move(other.effects_)),
      ui_(std::move(other.ui_)),
      overlays_(std::move(other.overlays_)),
      utf8Bytes_(std::move(other.utf8Bytes_)) {
}

FramePacket& FramePacket::operator=(FramePacket&& other) noexcept {
    if (this == &other) {
        return *this;
    }
    metadata_ = other.metadata_;
    viewport_ = other.viewport_;
    commandStream_ = std::move(other.commandStream_);
    sprites_ = std::move(other.sprites_);
    shapes_ = std::move(other.shapes_);
    lines_ = std::move(other.lines_);
    textRuns_ = std::move(other.textRuns_);
    effects_ = std::move(other.effects_);
    ui_ = std::move(other.ui_);
    overlays_ = std::move(other.overlays_);
    utf8Bytes_ = std::move(other.utf8Bytes_);
    return *this;
}

void FramePacket::reserve(const FramePacketCapacity& capacity) {
    commandStream_.reserve(capacity.commandCount);
    sprites_.reserve(capacity.spriteCount);
    shapes_.reserve(capacity.shapeCount);
    lines_.reserve(capacity.lineCount);
    textRuns_.reserve(capacity.textCount);
    effects_.reserve(capacity.effectCount);
    ui_.reserve(capacity.uiCount);
    overlays_.reserve(capacity.overlayCount);
    utf8Bytes_.reserve(capacity.utf8ByteCount);
}

void FramePacket::clear() noexcept {
    metadata_ = {};
    viewport_ = {};
    commandStream_.clear();
    sprites_.clear();
    shapes_.clear();
    lines_.clear();
    textRuns_.clear();
    effects_.clear();
    ui_.clear();
    overlays_.clear();
    utf8Bytes_.clear();
}

const FrameMetadata& FramePacket::metadata() const noexcept {
    return metadata_;
}

const ViewportState& FramePacket::viewport() const noexcept {
    return viewport_;
}

std::span<const CommandRef> FramePacket::commandStream() const noexcept {
    return commandStream_;
}

std::span<const SpriteCommand> FramePacket::sprites() const noexcept {
    return sprites_;
}

std::span<const ShapeCommand> FramePacket::shapes() const noexcept {
    return shapes_;
}

std::span<const LineCommand> FramePacket::lines() const noexcept {
    return lines_;
}

std::span<const TextCommand> FramePacket::textRuns() const noexcept {
    return textRuns_;
}

std::span<const EffectCommand> FramePacket::effects() const noexcept {
    return effects_;
}

std::span<const UiCommand> FramePacket::ui() const noexcept {
    return ui_;
}

std::span<const OverlayCommand> FramePacket::overlays() const noexcept {
    return overlays_;
}

std::span<const char> FramePacket::utf8Bytes() const noexcept {
    return utf8Bytes_;
}

std::string_view FramePacket::text(const TextSlice slice) const noexcept {
    if (!textSliceIsValid(slice, utf8Bytes_.size())) {
        return {};
    }
    if (slice.byteLength == 0U) {
        return {};
    }
    return {
        utf8Bytes_.data() + static_cast<std::size_t>(slice.byteOffset),
        static_cast<std::size_t>(slice.byteLength)
    };
}

FramePacketView FramePacket::view() const noexcept {
    return {
        metadata_,
        viewport_,
        commandStream_,
        sprites_,
        shapes_,
        lines_,
        textRuns_,
        effects_,
        ui_,
        overlays_,
        utf8Bytes_
    };
}

FramePacketCapacity FramePacket::size() const noexcept {
    return {
        commandStream_.size(),
        sprites_.size(),
        shapes_.size(),
        lines_.size(),
        textRuns_.size(),
        effects_.size(),
        ui_.size(),
        overlays_.size(),
        utf8Bytes_.size()
    };
}

FramePacketCapacity FramePacket::capacity() const noexcept {
    return {
        commandStream_.capacity(),
        sprites_.capacity(),
        shapes_.capacity(),
        lines_.capacity(),
        textRuns_.capacity(),
        effects_.capacity(),
        ui_.capacity(),
        overlays_.capacity(),
        utf8Bytes_.capacity()
    };
}

bool FramePacket::hasCapacityFor(const FramePacketCapacity& required) const noexcept {
    const FramePacketCapacity available = capacity();
    return required.commandCount <= available.commandCount
        && required.spriteCount <= available.spriteCount
        && required.shapeCount <= available.shapeCount
        && required.lineCount <= available.lineCount
        && required.textCount <= available.textCount
        && required.effectCount <= available.effectCount
        && required.uiCount <= available.uiCount
        && required.overlayCount <= available.overlayCount
        && required.utf8ByteCount <= available.utf8ByteCount;
}

const CommandHeader* FramePacket::commandHeader(const CommandRef& reference) const noexcept {
    const auto index = static_cast<std::size_t>(reference.index);
    switch (reference.kind) {
        case CommandKind::sprite:
            return index < sprites_.size() ? &sprites_[index].header : nullptr;
        case CommandKind::shape:
            return index < shapes_.size() ? &shapes_[index].header : nullptr;
        case CommandKind::line:
            return index < lines_.size() ? &lines_[index].header : nullptr;
        case CommandKind::text:
            return index < textRuns_.size() ? &textRuns_[index].header : nullptr;
        case CommandKind::effect:
            return index < effects_.size() ? &effects_[index].header : nullptr;
        case CommandKind::ui:
            return index < ui_.size() ? &ui_[index].header : nullptr;
        case CommandKind::overlay:
            return index < overlays_.size() ? &overlays_[index].header : nullptr;
    }
    return nullptr;
}

bool FramePacket::isStructurallyValid() const noexcept {
    std::size_t expectedCommands = 0;
    const std::array commandCounts{
        sprites_.size(),
        shapes_.size(),
        lines_.size(),
        textRuns_.size(),
        effects_.size(),
        ui_.size(),
        overlays_.size()
    };
    for (const std::size_t count : commandCounts) {
        if (count > std::numeric_limits<std::size_t>::max() - expectedCommands) {
            return false;
        }
        expectedCommands += count;
    }
    if (commandStream_.size() != expectedCommands
        || commandStream_.size() > std::numeric_limits<std::uint32_t>::max()
        || metadata_.alphaEncoding != AlphaEncoding::premultiplied
        || !finite(metadata_.presentationTimeSeconds)
        || metadata_.presentationTimeSeconds < 0.0
        || !finite(metadata_.interpolationAlpha)
        || metadata_.interpolationAlpha < 0.0F
        || metadata_.interpolationAlpha > 1.0F
        || !colorIsPremultiplied(metadata_.clearColor)
        || !viewportIsValid(viewport_)) {
        return false;
    }

    for (const SpriteCommand& command : sprites_) {
        if (!commandValuesAreValid(command)) {
            return false;
        }
    }
    for (const ShapeCommand& command : shapes_) {
        if (!commandValuesAreValid(command)) {
            return false;
        }
    }
    for (const LineCommand& command : lines_) {
        if (!commandValuesAreValid(command)) {
            return false;
        }
    }
    if (!utf8IsValid(utf8Bytes_)) {
        return false;
    }
    for (const TextCommand& command : textRuns_) {
        const auto byteOffset = static_cast<std::size_t>(command.utf8.byteOffset);
        const auto byteLength = static_cast<std::size_t>(command.utf8.byteLength);
        if (!commandValuesAreValid(command, utf8Bytes_.size())
            || byteLength > utf8Bytes_.size() - byteOffset
            || !utf8IsValid(std::span<const char>{utf8Bytes_}.subspan(byteOffset, byteLength))) {
            return false;
        }
    }
    for (const EffectCommand& command : effects_) {
        if (!commandValuesAreValid(command)) {
            return false;
        }
    }
    for (const UiCommand& command : ui_) {
        if (!commandValuesAreValid(command)) {
            return false;
        }
    }
    for (const OverlayCommand& command : overlays_) {
        if (!commandValuesAreValid(command)) {
            return false;
        }
    }

    std::array<std::size_t, 7> nextIndexes{};
    for (const CommandRef& reference : commandStream_) {
        const std::size_t kindIndex = commandKindIndex(reference.kind);
        if (kindIndex >= nextIndexes.size()
            || reference.reserved != std::array<std::uint8_t, 3>{}
            || reference.index != nextIndexes[kindIndex]
            || commandHeader(reference) == nullptr) {
            return false;
        }
        ++nextIndexes[kindIndex];
    }
    if (nextIndexes[commandKindIndex(CommandKind::sprite)] != sprites_.size()
        || nextIndexes[commandKindIndex(CommandKind::shape)] != shapes_.size()
        || nextIndexes[commandKindIndex(CommandKind::line)] != lines_.size()
        || nextIndexes[commandKindIndex(CommandKind::text)] != textRuns_.size()
        || nextIndexes[commandKindIndex(CommandKind::effect)] != effects_.size()
        || nextIndexes[commandKindIndex(CommandKind::ui)] != ui_.size()
        || nextIndexes[commandKindIndex(CommandKind::overlay)] != overlays_.size()) {
        return false;
    }
    return true;
}

bool FramePacket::isRenderOrderValid() const noexcept {
    if (!isStructurallyValid()) {
        return false;
    }

    bool hasPrevious = false;
    std::uint8_t previousLayer = 0;
    std::int32_t previousLayerOrder = 0;
    std::uint32_t expectedSequence = 0;
    bool overlaySessionOpen = false;
    StableElementId overlaySessionId = 0;
    std::int32_t overlayLayerOrder = 0;
    for (const CommandRef& reference : commandStream_) {
        const CommandHeader* const header = commandHeader(reference);
        if (header == nullptr
            || !isRenderLayer(header->layer)
            || header->sequence != expectedSequence) {
            return false;
        }

        const std::uint8_t layer = renderLayerOrder(header->layer);
        if (hasPrevious) {
            if (layer < previousLayer
                || (layer == previousLayer && header->layerOrder < previousLayerOrder)) {
                return false;
            }
        }

        if (header->layer == RenderLayer::dynamicOverlay) {
            if (reference.kind == CommandKind::overlay) {
                const auto overlayIndex = static_cast<std::size_t>(reference.index);
                if (overlayIndex >= overlays_.size()) {
                    return false;
                }
                const OverlayCommand& overlay = overlays_[overlayIndex];
                switch (overlay.operation) {
                    case OverlayOperation::beginSession:
                        if (overlaySessionOpen) {
                            return false;
                        }
                        overlaySessionOpen = true;
                        overlaySessionId = overlay.sessionId;
                        overlayLayerOrder = header->layerOrder;
                        break;
                    case OverlayOperation::endSession:
                        if (!overlaySessionOpen
                            || overlay.sessionId != overlaySessionId
                            || header->layerOrder != overlayLayerOrder) {
                            return false;
                        }
                        overlaySessionOpen = false;
                        overlaySessionId = 0;
                        break;
                    case OverlayOperation::captureBackdrop:
                    case OverlayOperation::dim:
                    case OverlayOperation::glassPanel:
                        if (!overlaySessionOpen
                            || overlay.sessionId != overlaySessionId
                            || header->layerOrder != overlayLayerOrder) {
                            return false;
                        }
                        break;
                }
            } else if (!overlaySessionOpen || header->layerOrder != overlayLayerOrder) {
                return false;
            }
        } else if (overlaySessionOpen) {
            return false;
        }

        hasPrevious = true;
        previousLayer = layer;
        previousLayerOrder = header->layerOrder;
        ++expectedSequence;
    }
    return !overlaySessionOpen;
}

} // namespace cirvivor::render
