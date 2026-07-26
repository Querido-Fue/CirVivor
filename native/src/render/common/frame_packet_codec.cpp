#include "render/common/frame_packet_codec.h"

#include <array>
#include <bit>
#include <limits>
#include <new>
#include <stdexcept>
#include <utility>

namespace cirvivor::render {

struct FramePacketStorageAccess final {
    [[nodiscard]] static FrameMetadata& metadata(FramePacket& packet) noexcept {
        return packet.metadata_;
    }

    [[nodiscard]] static ViewportState& viewport(FramePacket& packet) noexcept {
        return packet.viewport_;
    }

    [[nodiscard]] static std::vector<CommandRef>& commandStream(FramePacket& packet) noexcept {
        return packet.commandStream_;
    }

    [[nodiscard]] static std::vector<SpriteCommand>& sprites(FramePacket& packet) noexcept {
        return packet.sprites_;
    }

    [[nodiscard]] static std::vector<ShapeCommand>& shapes(FramePacket& packet) noexcept {
        return packet.shapes_;
    }

    [[nodiscard]] static std::vector<LineCommand>& lines(FramePacket& packet) noexcept {
        return packet.lines_;
    }

    [[nodiscard]] static std::vector<TextCommand>& textRuns(FramePacket& packet) noexcept {
        return packet.textRuns_;
    }

    [[nodiscard]] static std::vector<EffectCommand>& effects(FramePacket& packet) noexcept {
        return packet.effects_;
    }

    [[nodiscard]] static std::vector<UiCommand>& ui(FramePacket& packet) noexcept {
        return packet.ui_;
    }

    [[nodiscard]] static std::vector<OverlayCommand>& overlays(FramePacket& packet) noexcept {
        return packet.overlays_;
    }

    [[nodiscard]] static std::vector<char>& utf8Bytes(FramePacket& packet) noexcept {
        return packet.utf8Bytes_;
    }

    [[nodiscard]] static bool hasActiveBuilder(const FramePacket& packet) noexcept {
        return packet.activeBuilder_ != nullptr;
    }
};

namespace {

inline constexpr std::array<std::byte, 4> wire_magic{
    std::byte{'C'},
    std::byte{'V'},
    std::byte{'F'},
    std::byte{'P'}
};

inline constexpr std::size_t wire_fixed_byte_count = 320;
inline constexpr std::size_t wire_command_reference_byte_count = 5;
inline constexpr std::size_t wire_sprite_byte_count = 84;
inline constexpr std::size_t wire_shape_byte_count = 76;
inline constexpr std::size_t wire_line_byte_count = 52;
inline constexpr std::size_t wire_text_byte_count = 76;
inline constexpr std::size_t wire_effect_byte_count = 120;
inline constexpr std::size_t wire_ui_byte_count = 100;
inline constexpr std::size_t wire_overlay_byte_count = 128;

[[nodiscard]] bool addWireBlock(
    std::size_t& total,
    const std::size_t count,
    const std::size_t stride
) noexcept {
    if (count > (std::numeric_limits<std::size_t>::max() - total) / stride) {
        return false;
    }
    total += count * stride;
    return true;
}

[[nodiscard]] bool calculateWireByteCount(
    const FramePacketCapacity& size,
    std::size_t& result
) noexcept {
    result = wire_fixed_byte_count;
    return addWireBlock(result, size.commandCount, wire_command_reference_byte_count)
        && addWireBlock(result, size.spriteCount, wire_sprite_byte_count)
        && addWireBlock(result, size.shapeCount, wire_shape_byte_count)
        && addWireBlock(result, size.lineCount, wire_line_byte_count)
        && addWireBlock(result, size.textCount, wire_text_byte_count)
        && addWireBlock(result, size.effectCount, wire_effect_byte_count)
        && addWireBlock(result, size.uiCount, wire_ui_byte_count)
        && addWireBlock(result, size.overlayCount, wire_overlay_byte_count)
        && addWireBlock(result, size.utf8ByteCount, 1U);
}

[[nodiscard]] bool calculateDecodedByteCount(
    const FramePacketCapacity& size,
    std::size_t& result
) noexcept {
    result = sizeof(FramePacket);
    return addWireBlock(result, size.commandCount, sizeof(CommandRef))
        && addWireBlock(result, size.spriteCount, sizeof(SpriteCommand))
        && addWireBlock(result, size.shapeCount, sizeof(ShapeCommand))
        && addWireBlock(result, size.lineCount, sizeof(LineCommand))
        && addWireBlock(result, size.textCount, sizeof(TextCommand))
        && addWireBlock(result, size.effectCount, sizeof(EffectCommand))
        && addWireBlock(result, size.uiCount, sizeof(UiCommand))
        && addWireBlock(result, size.overlayCount, sizeof(OverlayCommand))
        && addWireBlock(result, size.utf8ByteCount, sizeof(char));
}

class ByteWriter final {
public:
    explicit ByteWriter(std::vector<std::byte>& output) noexcept
        : output_(output) {
    }

    void u8(const std::uint8_t value) {
        output_.push_back(static_cast<std::byte>(value));
    }

    void u16(const std::uint16_t value) {
        u8(static_cast<std::uint8_t>(value & 0xffU));
        u8(static_cast<std::uint8_t>((value >> 8U) & 0xffU));
    }

    void u32(const std::uint32_t value) {
        for (std::uint32_t shift = 0; shift < 32U; shift += 8U) {
            u8(static_cast<std::uint8_t>((value >> shift) & 0xffU));
        }
    }

    void i32(const std::int32_t value) {
        u32(std::bit_cast<std::uint32_t>(value));
    }

    void u64(const std::uint64_t value) {
        for (std::uint32_t shift = 0; shift < 64U; shift += 8U) {
            u8(static_cast<std::uint8_t>((value >> shift) & 0xffU));
        }
    }

    void f32(const float value) {
        u32(std::bit_cast<std::uint32_t>(value));
    }

    void f64(const double value) {
        u64(std::bit_cast<std::uint64_t>(value));
    }

    void bytes(const std::span<const char> bytes) {
        for (const char value : bytes) {
            u8(static_cast<std::uint8_t>(value));
        }
    }

private:
    std::vector<std::byte>& output_;
};

class ByteReader final {
public:
    explicit ByteReader(const std::span<const std::byte> bytes) noexcept
        : bytes_(bytes) {
    }

    [[nodiscard]] bool u8(std::uint8_t& value) noexcept {
        if (remaining() < 1U) {
            return false;
        }
        value = std::to_integer<std::uint8_t>(bytes_[offset_]);
        ++offset_;
        return true;
    }

    [[nodiscard]] bool u16(std::uint16_t& value) noexcept {
        std::uint8_t byte0 = 0;
        std::uint8_t byte1 = 0;
        if (!u8(byte0) || !u8(byte1)) {
            return false;
        }
        value = static_cast<std::uint16_t>(byte0)
            | static_cast<std::uint16_t>(static_cast<std::uint16_t>(byte1) << 8U);
        return true;
    }

    [[nodiscard]] bool u32(std::uint32_t& value) noexcept {
        value = 0;
        for (std::uint32_t shift = 0; shift < 32U; shift += 8U) {
            std::uint8_t byte = 0;
            if (!u8(byte)) {
                return false;
            }
            value |= static_cast<std::uint32_t>(byte) << shift;
        }
        return true;
    }

    [[nodiscard]] bool i32(std::int32_t& value) noexcept {
        std::uint32_t bits = 0;
        if (!u32(bits)) {
            return false;
        }
        value = std::bit_cast<std::int32_t>(bits);
        return true;
    }

    [[nodiscard]] bool u64(std::uint64_t& value) noexcept {
        value = 0;
        for (std::uint32_t shift = 0; shift < 64U; shift += 8U) {
            std::uint8_t byte = 0;
            if (!u8(byte)) {
                return false;
            }
            value |= static_cast<std::uint64_t>(byte) << shift;
        }
        return true;
    }

    [[nodiscard]] bool f32(float& value) noexcept {
        std::uint32_t bits = 0;
        if (!u32(bits)) {
            return false;
        }
        value = std::bit_cast<float>(bits);
        return true;
    }

    [[nodiscard]] bool f64(double& value) noexcept {
        std::uint64_t bits = 0;
        if (!u64(bits)) {
            return false;
        }
        value = std::bit_cast<double>(bits);
        return true;
    }

    [[nodiscard]] bool bytes(std::span<char> output) noexcept {
        if (remaining() < output.size()) {
            return false;
        }
        for (char& value : output) {
            value = static_cast<char>(std::to_integer<std::uint8_t>(bytes_[offset_]));
            ++offset_;
        }
        return true;
    }

    [[nodiscard]] std::size_t offset() const noexcept {
        return offset_;
    }

    [[nodiscard]] std::size_t remaining() const noexcept {
        return bytes_.size() - offset_;
    }

private:
    std::span<const std::byte> bytes_;
    std::size_t offset_ = 0;
};

void writeVec2(ByteWriter& writer, const Vec2F& value) {
    writer.f32(value.x);
    writer.f32(value.y);
}

[[nodiscard]] bool readVec2(ByteReader& reader, Vec2F& value) noexcept {
    return reader.f32(value.x) && reader.f32(value.y);
}

void writeSizeF(ByteWriter& writer, const SizeF& value) {
    writer.f32(value.width);
    writer.f32(value.height);
}

[[nodiscard]] bool readSizeF(ByteReader& reader, SizeF& value) noexcept {
    return reader.f32(value.width) && reader.f32(value.height);
}

void writeSizeI(ByteWriter& writer, const SizeI& value) {
    writer.i32(value.width);
    writer.i32(value.height);
}

[[nodiscard]] bool readSizeI(ByteReader& reader, SizeI& value) noexcept {
    return reader.i32(value.width) && reader.i32(value.height);
}

void writeRectF(ByteWriter& writer, const RectF& value) {
    writer.f32(value.x);
    writer.f32(value.y);
    writer.f32(value.width);
    writer.f32(value.height);
}

[[nodiscard]] bool readRectF(ByteReader& reader, RectF& value) noexcept {
    return reader.f32(value.x)
        && reader.f32(value.y)
        && reader.f32(value.width)
        && reader.f32(value.height);
}

void writeRectI(ByteWriter& writer, const RectI& value) {
    writer.i32(value.x);
    writer.i32(value.y);
    writer.i32(value.width);
    writer.i32(value.height);
}

[[nodiscard]] bool readRectI(ByteReader& reader, RectI& value) noexcept {
    return reader.i32(value.x)
        && reader.i32(value.y)
        && reader.i32(value.width)
        && reader.i32(value.height);
}

void writeInsetsF(ByteWriter& writer, const InsetsF& value) {
    writer.f32(value.left);
    writer.f32(value.top);
    writer.f32(value.right);
    writer.f32(value.bottom);
}

[[nodiscard]] bool readInsetsF(ByteReader& reader, InsetsF& value) noexcept {
    return reader.f32(value.left)
        && reader.f32(value.top)
        && reader.f32(value.right)
        && reader.f32(value.bottom);
}

void writeInsetsI(ByteWriter& writer, const InsetsI& value) {
    writer.i32(value.left);
    writer.i32(value.top);
    writer.i32(value.right);
    writer.i32(value.bottom);
}

[[nodiscard]] bool readInsetsI(ByteReader& reader, InsetsI& value) noexcept {
    return reader.i32(value.left)
        && reader.i32(value.top)
        && reader.i32(value.right)
        && reader.i32(value.bottom);
}

void writeMat3(ByteWriter& writer, const Mat3F& value) {
    for (const float element : value.elements) {
        writer.f32(element);
    }
}

[[nodiscard]] bool readMat3(ByteReader& reader, Mat3F& value) noexcept {
    for (float& element : value.elements) {
        if (!reader.f32(element)) {
            return false;
        }
    }
    return true;
}

void writeColor(ByteWriter& writer, const PremultipliedRgba& value) {
    writer.f32(value.red);
    writer.f32(value.green);
    writer.f32(value.blue);
    writer.f32(value.alpha);
}

[[nodiscard]] bool readColor(ByteReader& reader, PremultipliedRgba& value) noexcept {
    return reader.f32(value.red)
        && reader.f32(value.green)
        && reader.f32(value.blue)
        && reader.f32(value.alpha);
}

void writeHeader(ByteWriter& writer, const CommandHeader& header) {
    writer.u8(static_cast<std::uint8_t>(header.layer));
    writer.u8(static_cast<std::uint8_t>(header.coordinateSpace));
    writer.u8(static_cast<std::uint8_t>(header.blendMode));
    writer.u8(header.flags);
    writer.i32(header.layerOrder);
    writer.u32(header.sequence);
}

[[nodiscard]] bool readHeader(ByteReader& reader, CommandHeader& header) noexcept {
    std::uint8_t layer = 0;
    std::uint8_t coordinateSpace = 0;
    std::uint8_t blendMode = 0;
    if (!reader.u8(layer)
        || !reader.u8(coordinateSpace)
        || !reader.u8(blendMode)
        || !reader.u8(header.flags)
        || !reader.i32(header.layerOrder)
        || !reader.u32(header.sequence)) {
        return false;
    }
    header.layer = static_cast<RenderLayer>(layer);
    header.coordinateSpace = static_cast<CoordinateSpace>(coordinateSpace);
    header.blendMode = static_cast<BlendMode>(blendMode);
    return true;
}

void writeViewport(ByteWriter& writer, const ViewportState& viewport) {
    writeSizeI(writer, viewport.physical.displaySize);
    writeRectI(writer, viewport.physical.windowBounds);
    writer.f32(viewport.physical.dpiScale);

    writeSizeI(writer, viewport.drawable.size);
    writeRectI(writer, viewport.drawable.contentRect);
    writeInsetsI(writer, viewport.drawable.safeArea);
    writeSizeI(writer, viewport.drawable.worldRenderTargetSize);
    writer.f32(viewport.drawable.worldRenderScale);

    writeSizeF(writer, viewport.logicalUi.size);
    writeRectF(writer, viewport.logicalUi.contentRect);
    writeInsetsF(writer, viewport.logicalUi.safeArea);
    writer.f32(viewport.logicalUi.drawablePixelsPerLogicalUnitX);
    writer.f32(viewport.logicalUi.drawablePixelsPerLogicalUnitY);
    writer.f32(viewport.logicalUi.uiScale);

    writeRectF(writer, viewport.world.visibleBounds);
    writeMat3(writer, viewport.world.worldToDrawable);
    writeMat3(writer, viewport.world.drawableToWorld);
    writer.f32(viewport.world.drawablePixelsPerWorldUnit);
    writer.u64(viewport.world.projectionRevision);
}

[[nodiscard]] bool readViewport(ByteReader& reader, ViewportState& viewport) noexcept {
    return readSizeI(reader, viewport.physical.displaySize)
        && readRectI(reader, viewport.physical.windowBounds)
        && reader.f32(viewport.physical.dpiScale)
        && readSizeI(reader, viewport.drawable.size)
        && readRectI(reader, viewport.drawable.contentRect)
        && readInsetsI(reader, viewport.drawable.safeArea)
        && readSizeI(reader, viewport.drawable.worldRenderTargetSize)
        && reader.f32(viewport.drawable.worldRenderScale)
        && readSizeF(reader, viewport.logicalUi.size)
        && readRectF(reader, viewport.logicalUi.contentRect)
        && readInsetsF(reader, viewport.logicalUi.safeArea)
        && reader.f32(viewport.logicalUi.drawablePixelsPerLogicalUnitX)
        && reader.f32(viewport.logicalUi.drawablePixelsPerLogicalUnitY)
        && reader.f32(viewport.logicalUi.uiScale)
        && readRectF(reader, viewport.world.visibleBounds)
        && readMat3(reader, viewport.world.worldToDrawable)
        && readMat3(reader, viewport.world.drawableToWorld)
        && reader.f32(viewport.world.drawablePixelsPerWorldUnit)
        && reader.u64(viewport.world.projectionRevision);
}

void writeSprite(ByteWriter& writer, const SpriteCommand& command) {
    writeHeader(writer, command.header);
    writer.u64(command.textureId);
    writeRectF(writer, command.destination);
    writeRectF(writer, command.uv);
    writeVec2(writer, command.pivot);
    writer.f32(command.rotationRadians);
    writeColor(writer, command.tint);
    writer.u8(static_cast<std::uint8_t>(command.sampling));
    writer.u8(command.flipX);
    writer.u8(command.flipY);
    writer.u8(command.reserved);
}

[[nodiscard]] bool readSprite(ByteReader& reader, SpriteCommand& command) noexcept {
    std::uint8_t sampling = 0;
    if (!readHeader(reader, command.header)
        || !reader.u64(command.textureId)
        || !readRectF(reader, command.destination)
        || !readRectF(reader, command.uv)
        || !readVec2(reader, command.pivot)
        || !reader.f32(command.rotationRadians)
        || !readColor(reader, command.tint)
        || !reader.u8(sampling)
        || !reader.u8(command.flipX)
        || !reader.u8(command.flipY)
        || !reader.u8(command.reserved)) {
        return false;
    }
    command.sampling = static_cast<SamplingMode>(sampling);
    return true;
}

void writeShape(ByteWriter& writer, const ShapeCommand& command) {
    writeHeader(writer, command.header);
    writer.u8(static_cast<std::uint8_t>(command.shape));
    writer.u8(command.fillEnabled);
    writer.u8(command.strokeEnabled);
    writer.u8(command.reserved);
    writeRectF(writer, command.bounds);
    writer.f32(command.cornerRadius);
    writer.f32(command.strokeWidth);
    writer.f32(command.rotationRadians);
    writeColor(writer, command.fill);
    writeColor(writer, command.stroke);
}

[[nodiscard]] bool readShape(ByteReader& reader, ShapeCommand& command) noexcept {
    std::uint8_t shape = 0;
    if (!readHeader(reader, command.header)
        || !reader.u8(shape)
        || !reader.u8(command.fillEnabled)
        || !reader.u8(command.strokeEnabled)
        || !reader.u8(command.reserved)
        || !readRectF(reader, command.bounds)
        || !reader.f32(command.cornerRadius)
        || !reader.f32(command.strokeWidth)
        || !reader.f32(command.rotationRadians)
        || !readColor(reader, command.fill)
        || !readColor(reader, command.stroke)) {
        return false;
    }
    command.shape = static_cast<ShapeType>(shape);
    return true;
}

void writeLine(ByteWriter& writer, const LineCommand& command) {
    writeHeader(writer, command.header);
    writeVec2(writer, command.start);
    writeVec2(writer, command.end);
    writer.f32(command.width);
    writeColor(writer, command.color);
    writer.u8(static_cast<std::uint8_t>(command.cap));
    for (const std::uint8_t value : command.reserved) {
        writer.u8(value);
    }
}

[[nodiscard]] bool readLine(ByteReader& reader, LineCommand& command) noexcept {
    std::uint8_t cap = 0;
    if (!readHeader(reader, command.header)
        || !readVec2(reader, command.start)
        || !readVec2(reader, command.end)
        || !reader.f32(command.width)
        || !readColor(reader, command.color)
        || !reader.u8(cap)) {
        return false;
    }
    for (std::uint8_t& value : command.reserved) {
        if (!reader.u8(value)) {
            return false;
        }
    }
    command.cap = static_cast<LineCap>(cap);
    return true;
}

void writeText(ByteWriter& writer, const TextCommand& command) {
    writeHeader(writer, command.header);
    writer.u64(command.fontId);
    writer.u32(command.utf8.byteOffset);
    writer.u32(command.utf8.byteLength);
    writeVec2(writer, command.origin);
    writeSizeF(writer, command.maximumSize);
    writer.f32(command.fontSize);
    writer.f32(command.lineHeight);
    writer.f32(command.rotationRadians);
    writeColor(writer, command.color);
    writer.u8(static_cast<std::uint8_t>(command.align));
    writer.u8(static_cast<std::uint8_t>(command.baseline));
    writer.u8(static_cast<std::uint8_t>(command.wrap));
    writer.u8(command.reserved);
}

[[nodiscard]] bool readText(ByteReader& reader, TextCommand& command) noexcept {
    std::uint8_t align = 0;
    std::uint8_t baseline = 0;
    std::uint8_t wrap = 0;
    if (!readHeader(reader, command.header)
        || !reader.u64(command.fontId)
        || !reader.u32(command.utf8.byteOffset)
        || !reader.u32(command.utf8.byteLength)
        || !readVec2(reader, command.origin)
        || !readSizeF(reader, command.maximumSize)
        || !reader.f32(command.fontSize)
        || !reader.f32(command.lineHeight)
        || !reader.f32(command.rotationRadians)
        || !readColor(reader, command.color)
        || !reader.u8(align)
        || !reader.u8(baseline)
        || !reader.u8(wrap)
        || !reader.u8(command.reserved)) {
        return false;
    }
    command.align = static_cast<TextAlign>(align);
    command.baseline = static_cast<TextBaseline>(baseline);
    command.wrap = static_cast<TextWrap>(wrap);
    return true;
}

void writeEffect(ByteWriter& writer, const EffectCommand& command) {
    writeHeader(writer, command.header);
    writer.u8(static_cast<std::uint8_t>(command.effect));
    writer.u8(static_cast<std::uint8_t>(command.quality));
    writer.u16(command.variant);
    writeRectF(writer, command.bounds);
    writeVec2(writer, command.origin);
    writeColor(writer, command.primaryColor);
    writeColor(writer, command.secondaryColor);
    for (const float parameter : command.parameters) {
        writer.f32(parameter);
    }
    writer.u64(command.textureId);
    writer.u64(command.sourceRevision);
}

[[nodiscard]] bool readEffect(ByteReader& reader, EffectCommand& command) noexcept {
    std::uint8_t effect = 0;
    std::uint8_t quality = 0;
    if (!readHeader(reader, command.header)
        || !reader.u8(effect)
        || !reader.u8(quality)
        || !reader.u16(command.variant)
        || !readRectF(reader, command.bounds)
        || !readVec2(reader, command.origin)
        || !readColor(reader, command.primaryColor)
        || !readColor(reader, command.secondaryColor)) {
        return false;
    }
    for (float& parameter : command.parameters) {
        if (!reader.f32(parameter)) {
            return false;
        }
    }
    if (!reader.u64(command.textureId) || !reader.u64(command.sourceRevision)) {
        return false;
    }
    command.effect = static_cast<EffectType>(effect);
    command.quality = static_cast<EffectQuality>(quality);
    return true;
}

void writeUi(ByteWriter& writer, const UiCommand& command) {
    writeHeader(writer, command.header);
    writer.u8(static_cast<std::uint8_t>(command.primitive));
    writer.u8(command.reserved);
    writer.u16(command.stateFlags);
    writer.u64(command.elementId);
    writeRectF(writer, command.bounds);
    writer.f32(command.cornerRadius);
    writer.f32(command.borderWidth);
    writer.f32(command.value);
    writeColor(writer, command.backgroundColor);
    writeColor(writer, command.borderColor);
    writeColor(writer, command.accentColor);
}

[[nodiscard]] bool readUi(ByteReader& reader, UiCommand& command) noexcept {
    std::uint8_t primitive = 0;
    if (!readHeader(reader, command.header)
        || !reader.u8(primitive)
        || !reader.u8(command.reserved)
        || !reader.u16(command.stateFlags)
        || !reader.u64(command.elementId)
        || !readRectF(reader, command.bounds)
        || !reader.f32(command.cornerRadius)
        || !reader.f32(command.borderWidth)
        || !reader.f32(command.value)
        || !readColor(reader, command.backgroundColor)
        || !readColor(reader, command.borderColor)
        || !readColor(reader, command.accentColor)) {
        return false;
    }
    command.primitive = static_cast<UiPrimitive>(primitive);
    return true;
}

void writeOverlay(ByteWriter& writer, const OverlayCommand& command) {
    writeHeader(writer, command.header);
    writer.u8(static_cast<std::uint8_t>(command.operation));
    writer.u8(static_cast<std::uint8_t>(command.updateMode));
    writer.u16(command.sourceLayers);
    writer.u64(command.sessionId);
    writer.u64(command.sourceRevision);
    writeRectF(writer, command.sourceBounds);
    writeRectF(writer, command.destinationBounds);
    writer.f32(command.opacity);
    writer.f32(command.blurRadius);
    writer.f32(command.refractionStrength);
    writer.f32(command.edgeStrength);
    writeColor(writer, command.tintColor);
    writeColor(writer, command.edgeColor);
    writeColor(writer, command.shadowColor);
}

[[nodiscard]] bool readOverlay(ByteReader& reader, OverlayCommand& command) noexcept {
    std::uint8_t operation = 0;
    std::uint8_t updateMode = 0;
    if (!readHeader(reader, command.header)
        || !reader.u8(operation)
        || !reader.u8(updateMode)
        || !reader.u16(command.sourceLayers)
        || !reader.u64(command.sessionId)
        || !reader.u64(command.sourceRevision)
        || !readRectF(reader, command.sourceBounds)
        || !readRectF(reader, command.destinationBounds)
        || !reader.f32(command.opacity)
        || !reader.f32(command.blurRadius)
        || !reader.f32(command.refractionStrength)
        || !reader.f32(command.edgeStrength)
        || !readColor(reader, command.tintColor)
        || !readColor(reader, command.edgeColor)
        || !readColor(reader, command.shadowColor)) {
        return false;
    }
    command.operation = static_cast<OverlayOperation>(operation);
    command.updateMode = static_cast<BackdropUpdateMode>(updateMode);
    return true;
}

[[nodiscard]] bool countWithinLimit(
    const std::uint32_t value,
    const FramePacketDecodeLimits& limits
) noexcept {
    return value <= limits.maximumCommandsPerKind;
}

} // namespace

bool serializeFramePacket(
    const FramePacket& packet,
    std::vector<std::byte>& output
) {
    try {
        if (!packet.isRenderOrderValid()) {
            return false;
        }

        const FramePacketCapacity packetSize = packet.size();
        if (packetSize.commandCount > std::numeric_limits<std::uint32_t>::max()
            || packetSize.spriteCount > std::numeric_limits<std::uint32_t>::max()
            || packetSize.shapeCount > std::numeric_limits<std::uint32_t>::max()
            || packetSize.lineCount > std::numeric_limits<std::uint32_t>::max()
            || packetSize.textCount > std::numeric_limits<std::uint32_t>::max()
            || packetSize.effectCount > std::numeric_limits<std::uint32_t>::max()
            || packetSize.uiCount > std::numeric_limits<std::uint32_t>::max()
            || packetSize.overlayCount > std::numeric_limits<std::uint32_t>::max()
            || packetSize.utf8ByteCount > std::numeric_limits<std::uint32_t>::max()) {
            return false;
        }

        std::size_t wireByteCount = 0;
        if (!calculateWireByteCount(packetSize, wireByteCount)) {
            return false;
        }

        output.clear();
        output.reserve(wireByteCount);
        ByteWriter writer(output);
        for (const std::byte value : wire_magic) {
            output.push_back(value);
        }
        writer.u16(FramePacket::schema_version);
        writer.u8(static_cast<std::uint8_t>(AlphaEncoding::premultiplied));
        writer.u8(0);

        const FrameMetadata& metadata = packet.metadata();
        writer.u64(metadata.frameId);
        writer.u64(metadata.simulationTick);
        writer.f64(metadata.presentationTimeSeconds);
        writer.f32(metadata.interpolationAlpha);
        writeColor(writer, metadata.clearColor);
        writeViewport(writer, packet.viewport());

        writer.u32(static_cast<std::uint32_t>(packetSize.commandCount));
        writer.u32(static_cast<std::uint32_t>(packetSize.spriteCount));
        writer.u32(static_cast<std::uint32_t>(packetSize.shapeCount));
        writer.u32(static_cast<std::uint32_t>(packetSize.lineCount));
        writer.u32(static_cast<std::uint32_t>(packetSize.textCount));
        writer.u32(static_cast<std::uint32_t>(packetSize.effectCount));
        writer.u32(static_cast<std::uint32_t>(packetSize.uiCount));
        writer.u32(static_cast<std::uint32_t>(packetSize.overlayCount));
        writer.u32(static_cast<std::uint32_t>(packetSize.utf8ByteCount));

        for (const CommandRef& reference : packet.commandStream()) {
            writer.u8(static_cast<std::uint8_t>(reference.kind));
            writer.u32(reference.index);
        }
        for (const SpriteCommand& command : packet.sprites()) {
            writeSprite(writer, command);
        }
        for (const ShapeCommand& command : packet.shapes()) {
            writeShape(writer, command);
        }
        for (const LineCommand& command : packet.lines()) {
            writeLine(writer, command);
        }
        for (const TextCommand& command : packet.textRuns()) {
            writeText(writer, command);
        }
        for (const EffectCommand& command : packet.effects()) {
            writeEffect(writer, command);
        }
        for (const UiCommand& command : packet.ui()) {
            writeUi(writer, command);
        }
        for (const OverlayCommand& command : packet.overlays()) {
            writeOverlay(writer, command);
        }
        writer.bytes(packet.utf8Bytes());
        return output.size() == wireByteCount;
    } catch (const std::bad_alloc&) {
        output.clear();
        return false;
    } catch (const std::length_error&) {
        output.clear();
        return false;
    }
}

FramePacketDecodeResult deserializeFramePacket(
    const std::span<const std::byte> bytes,
    FramePacket& destination,
    const FramePacketDecodeLimits& limits
) {
    if (FramePacketStorageAccess::hasActiveBuilder(destination)) {
        return {FramePacketDecodeError::destinationBusy, 0};
    }
    if (bytes.size() > limits.maximumWireByteCount) {
        return {FramePacketDecodeError::sizeLimitExceeded, 0};
    }

    ByteReader reader(bytes);
    for (const std::byte expected : wire_magic) {
        std::uint8_t actual = 0;
        if (!reader.u8(actual)) {
            return {FramePacketDecodeError::truncated, reader.offset()};
        }
        if (actual != std::to_integer<std::uint8_t>(expected)) {
            return {FramePacketDecodeError::invalidMagic, reader.offset() - 1U};
        }
    }

    std::uint16_t version = 0;
    std::uint8_t alphaEncoding = 0;
    std::uint8_t reserved = 0;
    if (!reader.u16(version) || !reader.u8(alphaEncoding) || !reader.u8(reserved)) {
        return {FramePacketDecodeError::truncated, reader.offset()};
    }
    if (version != FramePacket::schema_version) {
        return {FramePacketDecodeError::unsupportedSchemaVersion, reader.offset()};
    }
    if (alphaEncoding != static_cast<std::uint8_t>(AlphaEncoding::premultiplied)) {
        return {FramePacketDecodeError::unsupportedAlphaEncoding, reader.offset()};
    }
    if (reserved != 0U) {
        return {FramePacketDecodeError::invalidPacket, reader.offset()};
    }

    FramePacket decoded;
    FrameMetadata& metadata = FramePacketStorageAccess::metadata(decoded);
    metadata.alphaEncoding = AlphaEncoding::premultiplied;
    if (!reader.u64(metadata.frameId)
        || !reader.u64(metadata.simulationTick)
        || !reader.f64(metadata.presentationTimeSeconds)
        || !reader.f32(metadata.interpolationAlpha)
        || !readColor(reader, metadata.clearColor)
        || !readViewport(reader, FramePacketStorageAccess::viewport(decoded))) {
        return {FramePacketDecodeError::truncated, reader.offset()};
    }

    std::uint32_t commandCount = 0;
    std::uint32_t spriteCount = 0;
    std::uint32_t shapeCount = 0;
    std::uint32_t lineCount = 0;
    std::uint32_t textCount = 0;
    std::uint32_t effectCount = 0;
    std::uint32_t uiCount = 0;
    std::uint32_t overlayCount = 0;
    std::uint32_t utf8ByteCount = 0;
    if (!reader.u32(commandCount)
        || !reader.u32(spriteCount)
        || !reader.u32(shapeCount)
        || !reader.u32(lineCount)
        || !reader.u32(textCount)
        || !reader.u32(effectCount)
        || !reader.u32(uiCount)
        || !reader.u32(overlayCount)
        || !reader.u32(utf8ByteCount)) {
        return {FramePacketDecodeError::truncated, reader.offset()};
    }

    const std::uint64_t summedCommandCount = static_cast<std::uint64_t>(spriteCount)
        + static_cast<std::uint64_t>(shapeCount)
        + static_cast<std::uint64_t>(lineCount)
        + static_cast<std::uint64_t>(textCount)
        + static_cast<std::uint64_t>(effectCount)
        + static_cast<std::uint64_t>(uiCount)
        + static_cast<std::uint64_t>(overlayCount);
    if (summedCommandCount != commandCount) {
        return {FramePacketDecodeError::invalidPacket, reader.offset()};
    }
    if (commandCount > limits.maximumCommandCount
        || !countWithinLimit(spriteCount, limits)
        || !countWithinLimit(shapeCount, limits)
        || !countWithinLimit(lineCount, limits)
        || !countWithinLimit(textCount, limits)
        || !countWithinLimit(effectCount, limits)
        || !countWithinLimit(uiCount, limits)
        || !countWithinLimit(overlayCount, limits)
        || utf8ByteCount > limits.maximumUtf8ByteCount) {
        return {FramePacketDecodeError::sizeLimitExceeded, reader.offset()};
    }

    const FramePacketCapacity capacity{
        commandCount,
        spriteCount,
        shapeCount,
        lineCount,
        textCount,
        effectCount,
        uiCount,
        overlayCount,
        utf8ByteCount
    };
    std::size_t requiredWireByteCount = 0;
    if (!calculateWireByteCount(capacity, requiredWireByteCount)) {
        return {FramePacketDecodeError::sizeLimitExceeded, reader.offset()};
    }
    std::size_t requiredDecodedByteCount = 0;
    if (requiredWireByteCount > limits.maximumWireByteCount
        || !calculateDecodedByteCount(capacity, requiredDecodedByteCount)
        || requiredDecodedByteCount > limits.maximumDecodedByteCount) {
        return {FramePacketDecodeError::sizeLimitExceeded, reader.offset()};
    }
    if (bytes.size() < requiredWireByteCount) {
        return {FramePacketDecodeError::truncated, reader.offset()};
    }
    auto& commandStream = FramePacketStorageAccess::commandStream(decoded);
    auto& sprites = FramePacketStorageAccess::sprites(decoded);
    auto& shapes = FramePacketStorageAccess::shapes(decoded);
    auto& lines = FramePacketStorageAccess::lines(decoded);
    auto& textRuns = FramePacketStorageAccess::textRuns(decoded);
    auto& effects = FramePacketStorageAccess::effects(decoded);
    auto& ui = FramePacketStorageAccess::ui(decoded);
    auto& overlays = FramePacketStorageAccess::overlays(decoded);
    auto& utf8Bytes = FramePacketStorageAccess::utf8Bytes(decoded);
    try {
        decoded.reserve(capacity);
        commandStream.resize(commandCount);
        sprites.resize(spriteCount);
        shapes.resize(shapeCount);
        lines.resize(lineCount);
        textRuns.resize(textCount);
        effects.resize(effectCount);
        ui.resize(uiCount);
        overlays.resize(overlayCount);
        utf8Bytes.resize(utf8ByteCount);
    } catch (const std::bad_alloc&) {
        return {FramePacketDecodeError::allocationFailure, reader.offset()};
    } catch (const std::length_error&) {
        return {FramePacketDecodeError::allocationFailure, reader.offset()};
    }

    for (CommandRef& reference : commandStream) {
        std::uint8_t kind = 0;
        if (!reader.u8(kind) || !reader.u32(reference.index)) {
            return {FramePacketDecodeError::truncated, reader.offset()};
        }
        reference.kind = static_cast<CommandKind>(kind);
    }
    for (SpriteCommand& command : sprites) {
        if (!readSprite(reader, command)) {
            return {FramePacketDecodeError::truncated, reader.offset()};
        }
    }
    for (ShapeCommand& command : shapes) {
        if (!readShape(reader, command)) {
            return {FramePacketDecodeError::truncated, reader.offset()};
        }
    }
    for (LineCommand& command : lines) {
        if (!readLine(reader, command)) {
            return {FramePacketDecodeError::truncated, reader.offset()};
        }
    }
    for (TextCommand& command : textRuns) {
        if (!readText(reader, command)) {
            return {FramePacketDecodeError::truncated, reader.offset()};
        }
    }
    for (EffectCommand& command : effects) {
        if (!readEffect(reader, command)) {
            return {FramePacketDecodeError::truncated, reader.offset()};
        }
    }
    for (UiCommand& command : ui) {
        if (!readUi(reader, command)) {
            return {FramePacketDecodeError::truncated, reader.offset()};
        }
    }
    for (OverlayCommand& command : overlays) {
        if (!readOverlay(reader, command)) {
            return {FramePacketDecodeError::truncated, reader.offset()};
        }
    }
    if (!reader.bytes(utf8Bytes)) {
        return {FramePacketDecodeError::truncated, reader.offset()};
    }
    if (reader.remaining() != 0U) {
        return {FramePacketDecodeError::trailingBytes, reader.offset()};
    }
    if (!decoded.isRenderOrderValid()) {
        return {FramePacketDecodeError::invalidPacket, reader.offset()};
    }

    destination = std::move(decoded);
    return {FramePacketDecodeError::none, reader.offset()};
}

} // namespace cirvivor::render
