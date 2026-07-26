#pragma once

#include <array>
#include <cstdint>
#include <limits>
#include <string_view>
#include <type_traits>

namespace cirvivor::render {

using ResourceId = std::uint64_t;
using StableElementId = std::uint64_t;

inline constexpr ResourceId invalid_resource_id = 0;
inline constexpr std::uint32_t invalid_command_index = std::numeric_limits<std::uint32_t>::max();

/**
 * 빌드 도구와 런타임이 공유할 수 있는 FNV-1a 기반의 안정적인 리소스 ID를 만듭니다.
 */
[[nodiscard]] constexpr ResourceId stableResourceId(const std::string_view text) noexcept {
    std::uint64_t value = 0xcbf2'9ce4'8422'2325ULL;
    for (const char character : text) {
        value ^= static_cast<std::uint8_t>(character);
        value *= 0x0000'0100'0000'01b3ULL;
    }
    return value == invalid_resource_id ? 1U : value;
}

struct Vec2F final {
    float x = 0.0F;
    float y = 0.0F;

    constexpr bool operator==(const Vec2F&) const noexcept = default;
};

struct SizeF final {
    float width = 0.0F;
    float height = 0.0F;

    constexpr bool operator==(const SizeF&) const noexcept = default;
};

struct SizeI final {
    std::int32_t width = 0;
    std::int32_t height = 0;

    constexpr bool operator==(const SizeI&) const noexcept = default;
};

struct RectF final {
    float x = 0.0F;
    float y = 0.0F;
    float width = 0.0F;
    float height = 0.0F;

    constexpr bool operator==(const RectF&) const noexcept = default;
};

struct RectI final {
    std::int32_t x = 0;
    std::int32_t y = 0;
    std::int32_t width = 0;
    std::int32_t height = 0;

    constexpr bool operator==(const RectI&) const noexcept = default;
};

struct InsetsF final {
    float left = 0.0F;
    float top = 0.0F;
    float right = 0.0F;
    float bottom = 0.0F;

    constexpr bool operator==(const InsetsF&) const noexcept = default;
};

struct InsetsI final {
    std::int32_t left = 0;
    std::int32_t top = 0;
    std::int32_t right = 0;
    std::int32_t bottom = 0;

    constexpr bool operator==(const InsetsI&) const noexcept = default;
};

/** row-major 저장과 오른쪽 column vector 곱셈을 사용하는 2D homogeneous 행렬입니다. */
struct Mat3F final {
    std::array<float, 9> elements{
        1.0F, 0.0F, 0.0F,
        0.0F, 1.0F, 0.0F,
        0.0F, 0.0F, 1.0F
    };

    constexpr bool operator==(const Mat3F&) const noexcept = default;
};

/**
 * 모든 색과 texture sample은 저장/업로드 시점부터 premultiplied alpha입니다.
 * backend는 source RGB에 alpha를 다시 곱하지 않고 `ONE, ONE_MINUS_SRC_ALPHA`에
 * 해당하는 합성을 사용합니다.
 */
struct PremultipliedRgba final {
    float red = 0.0F;
    float green = 0.0F;
    float blue = 0.0F;
    float alpha = 0.0F;

    [[nodiscard]] static constexpr PremultipliedRgba fromStraight(
        const float red,
        const float green,
        const float blue,
        const float alpha
    ) noexcept {
        return {red * alpha, green * alpha, blue * alpha, alpha};
    }

    [[nodiscard]] static constexpr PremultipliedRgba opaque(
        const float red,
        const float green,
        const float blue
    ) noexcept {
        return {red, green, blue, 1.0F};
    }

    [[nodiscard]] static constexpr PremultipliedRgba transparent() noexcept {
        return {};
    }

    constexpr bool operator==(const PremultipliedRgba&) const noexcept = default;
};

enum class AlphaEncoding : std::uint8_t {
    premultiplied = 1
};

enum class RenderLayer : std::uint8_t {
    background = 0,
    object = 1,
    effect = 2,
    textEffect = 3,
    ui = 4,
    vignette = 5,
    dynamicOverlay = 6,
    top = 7,
    count = 8
};

inline constexpr std::array<RenderLayer, 8> render_layer_order{
    RenderLayer::background,
    RenderLayer::object,
    RenderLayer::effect,
    RenderLayer::textEffect,
    RenderLayer::ui,
    RenderLayer::vignette,
    RenderLayer::dynamicOverlay,
    RenderLayer::top
};

[[nodiscard]] constexpr std::uint8_t renderLayerOrder(const RenderLayer layer) noexcept {
    return static_cast<std::uint8_t>(layer);
}

[[nodiscard]] constexpr bool isRenderLayer(const RenderLayer layer) noexcept {
    return renderLayerOrder(layer) < renderLayerOrder(RenderLayer::count);
}

using RenderLayerMask = std::uint16_t;

[[nodiscard]] constexpr RenderLayerMask renderLayerMask(const RenderLayer layer) noexcept {
    return isRenderLayer(layer)
        ? static_cast<RenderLayerMask>(1U << renderLayerOrder(layer))
        : RenderLayerMask{0};
}

enum class CoordinateSpace : std::uint8_t {
    physicalPixels = 0,
    drawablePixels = 1,
    logicalUi = 2,
    world = 3
};

enum class BlendMode : std::uint8_t {
    opaque = 0,
    premultipliedAlpha = 1,
    additivePremultiplied = 2
};

struct CommandHeader final {
    RenderLayer layer = RenderLayer::background;
    CoordinateSpace coordinateSpace = CoordinateSpace::drawablePixels;
    BlendMode blendMode = BlendMode::premultipliedAlpha;
    std::uint8_t flags = 0;
    std::int32_t layerOrder = 0;
    std::uint32_t sequence = 0;

    constexpr bool operator==(const CommandHeader&) const noexcept = default;
};

enum class SamplingMode : std::uint8_t {
    nearest = 0,
    linear = 1
};

struct SpriteCommand final {
    CommandHeader header;
    ResourceId textureId = invalid_resource_id;
    RectF destination;
    RectF uv{0.0F, 0.0F, 1.0F, 1.0F};
    Vec2F pivot{0.5F, 0.5F};
    float rotationRadians = 0.0F;
    PremultipliedRgba tint = PremultipliedRgba::opaque(1.0F, 1.0F, 1.0F);
    SamplingMode sampling = SamplingMode::linear;
    std::uint8_t flipX = 0;
    std::uint8_t flipY = 0;
    std::uint8_t reserved = 0;

    constexpr bool operator==(const SpriteCommand&) const noexcept = default;
};

enum class ShapeType : std::uint8_t {
    rectangle = 0,
    roundedRectangle = 1,
    circle = 2,
    triangle = 3,
    pentagon = 4,
    hexagon = 5,
    octagon = 6,
    arrow = 7
};

struct ShapeCommand final {
    CommandHeader header;
    ShapeType shape = ShapeType::rectangle;
    std::uint8_t fillEnabled = 1;
    std::uint8_t strokeEnabled = 0;
    std::uint8_t reserved = 0;
    RectF bounds;
    float cornerRadius = 0.0F;
    float strokeWidth = 0.0F;
    float rotationRadians = 0.0F;
    PremultipliedRgba fill = PremultipliedRgba::opaque(1.0F, 1.0F, 1.0F);
    PremultipliedRgba stroke = PremultipliedRgba::transparent();

    constexpr bool operator==(const ShapeCommand&) const noexcept = default;
};

enum class LineCap : std::uint8_t {
    butt = 0,
    round = 1,
    square = 2
};

struct LineCommand final {
    CommandHeader header;
    Vec2F start;
    Vec2F end;
    float width = 1.0F;
    PremultipliedRgba color = PremultipliedRgba::opaque(1.0F, 1.0F, 1.0F);
    LineCap cap = LineCap::butt;
    std::array<std::uint8_t, 3> reserved{};

    constexpr bool operator==(const LineCommand&) const noexcept = default;
};

struct TextSlice final {
    std::uint32_t byteOffset = 0;
    std::uint32_t byteLength = 0;

    constexpr bool operator==(const TextSlice&) const noexcept = default;
};

enum class TextAlign : std::uint8_t {
    start = 0,
    center = 1,
    end = 2
};

enum class TextBaseline : std::uint8_t {
    top = 0,
    middle = 1,
    alphabetic = 2,
    bottom = 3
};

enum class TextWrap : std::uint8_t {
    none = 0,
    word = 1,
    character = 2
};

struct TextCommand final {
    CommandHeader header;
    ResourceId fontId = invalid_resource_id;
    TextSlice utf8;
    Vec2F origin;
    SizeF maximumSize;
    float fontSize = 0.0F;
    float lineHeight = 0.0F;
    float rotationRadians = 0.0F;
    PremultipliedRgba color = PremultipliedRgba::opaque(1.0F, 1.0F, 1.0F);
    TextAlign align = TextAlign::start;
    TextBaseline baseline = TextBaseline::alphabetic;
    TextWrap wrap = TextWrap::none;
    std::uint8_t reserved = 0;

    constexpr bool operator==(const TextCommand&) const noexcept = default;
};

struct StorageRange final {
    std::uint32_t offset = 0;
    std::uint32_t count = 0;

    constexpr bool operator==(const StorageRange&) const noexcept = default;
};

/**
 * frontend text shaper가 확정한 한 glyph의 배치입니다. renderer는 glyph index나
 * advance를 다시 측정하지 않고 atlas page/UV와 위치를 그대로 소비합니다.
 */
struct GlyphInstance final {
    std::uint32_t glyphIndex = 0;
    std::uint32_t atlasPage = 0;
    Vec2F position;
    Vec2F advance;
    Vec2F offset;
    RectF uv;

    constexpr bool operator==(const GlyphInstance&) const noexcept = default;
};

struct GlyphRunCommand final {
    CommandHeader header;
    ResourceId fontId = invalid_resource_id;
    ResourceId glyphAtlasId = invalid_resource_id;
    StorageRange glyphs;
    Vec2F origin;
    float pixelsPerEm = 0.0F;
    std::int32_t weight = 400;
    std::array<float, 4> variationCoordinates{};
    PremultipliedRgba color = PremultipliedRgba::opaque(1.0F, 1.0F, 1.0F);
    Mat3F transform;
    RectF clipBounds;
    std::uint8_t clipEnabled = 0;
    SamplingMode sampling = SamplingMode::linear;
    std::array<std::uint8_t, 2> reserved{};

    constexpr bool operator==(const GlyphRunCommand&) const noexcept = default;
};

/** projectiveWeight는 perspective-correct UV 보간에 사용할 양의 q 값입니다. */
struct ProjectiveVertex final {
    Vec2F position;
    Vec2F uv;
    float projectiveWeight = 1.0F;

    constexpr bool operator==(const ProjectiveVertex&) const noexcept = default;
};

struct TexturedMeshCommand final {
    CommandHeader header;
    ResourceId textureId = invalid_resource_id;
    StorageRange vertices;
    StorageRange indices;
    Mat3F transform;
    PremultipliedRgba tint = PremultipliedRgba::opaque(1.0F, 1.0F, 1.0F);
    SamplingMode sampling = SamplingMode::linear;
    std::array<std::uint8_t, 3> reserved{};

    constexpr bool operator==(const TexturedMeshCommand&) const noexcept = default;
};

enum class GradientType : std::uint8_t {
    linear = 0,
    radial = 1
};

enum class GradientSpread : std::uint8_t {
    clamp = 0,
    repeat = 1,
    reflect = 2
};

struct GradientStop final {
    float offset = 0.0F;
    PremultipliedRgba color = PremultipliedRgba::transparent();

    constexpr bool operator==(const GradientStop&) const noexcept = default;
};

struct GradientCommand final {
    CommandHeader header;
    GradientType type = GradientType::linear;
    GradientSpread spread = GradientSpread::clamp;
    std::array<std::uint8_t, 2> reserved{};
    RectF bounds;
    Vec2F start;
    Vec2F end;
    float startRadius = 0.0F;
    float endRadius = 0.0F;
    Mat3F transform;
    StorageRange stops;

    constexpr bool operator==(const GradientCommand&) const noexcept = default;
};

enum class ClipOperation : std::uint8_t {
    pushScissor = 0,
    pushRoundedRect = 1,
    pop = 2
};

struct ClipCommand final {
    CommandHeader header;
    ClipOperation operation = ClipOperation::pushScissor;
    std::uint8_t antialias = 0;
    std::array<std::uint8_t, 2> reserved{};
    RectF bounds;
    float cornerRadius = 0.0F;
    Mat3F transform;

    constexpr bool operator==(const ClipCommand&) const noexcept = default;
};

enum class PassOperation : std::uint8_t {
    beginSession = 0,
    capture = 1,
    composite = 2,
    endSession = 3
};

enum class PassCompositeMode : std::uint8_t {
    sourceOver = 0,
    replace = 1
};

enum class PassUpdateMode : std::uint8_t {
    dirty = 0,
    always = 1
};

/**
 * offscreen capture/pass/composite의 명시적 계약입니다. sourceSessionId가 0이면
 * source anchor(layer/order/sequence)까지의 frame stream을 캡처하고, 0이 아니면
 * 더 먼저 시작한 pass의 destinationId를 입력으로 사용합니다.
 */
struct PassCommand final {
    CommandHeader header{
        RenderLayer::dynamicOverlay,
        CoordinateSpace::logicalUi,
        BlendMode::premultipliedAlpha,
        0,
        0,
        0
    };
    PassOperation operation = PassOperation::beginSession;
    PassUpdateMode updateMode = PassUpdateMode::dirty;
    PassCompositeMode compositeMode = PassCompositeMode::sourceOver;
    std::uint8_t reserved0 = 0;
    RenderLayer sourceAnchorLayer = RenderLayer::background;
    std::array<std::uint8_t, 3> reserved1{};
    StableElementId sessionId = 0;
    StableElementId sourceSessionId = 0;
    StableElementId destinationId = 0;
    std::uint64_t sourceRevision = 0;
    std::int32_t sourceAnchorLayerOrder = 0;
    std::uint32_t sourceAnchorSequence = 0;
    RectF sourceBounds;
    RectF destinationBounds;
    Vec2F scale{1.0F, 1.0F};
    float opacity = 1.0F;
    float contentBlurRadius = 0.0F;
    float glassBlurRadius = 0.0F;
    float refractionStrength = 0.0F;
    float edgeStrength = 0.0F;
    PremultipliedRgba tintColor = PremultipliedRgba::transparent();
    PremultipliedRgba edgeColor = PremultipliedRgba::transparent();
    PremultipliedRgba shadowColor = PremultipliedRgba::transparent();

    constexpr bool operator==(const PassCommand&) const noexcept = default;
};

enum class EffectType : std::uint8_t {
    magneticShield = 0,
    hexaMergeBoundary = 1,
    titleLoadingCircle = 2,
    vignette = 3,
    backdropBlur = 4,
    glassComposite = 5,
    custom = 255
};

enum class EffectQuality : std::uint8_t {
    full = 0,
    reduced = 1,
    softwareReplacement = 2
};

struct EffectCommand final {
    CommandHeader header;
    EffectType effect = EffectType::custom;
    EffectQuality quality = EffectQuality::full;
    std::uint16_t variant = 0;
    RectF bounds;
    Vec2F origin;
    PremultipliedRgba primaryColor = PremultipliedRgba::opaque(1.0F, 1.0F, 1.0F);
    PremultipliedRgba secondaryColor = PremultipliedRgba::transparent();
    std::array<float, 8> parameters{};
    ResourceId textureId = invalid_resource_id;
    std::uint64_t sourceRevision = 0;

    constexpr bool operator==(const EffectCommand&) const noexcept = default;
};

enum class UiPrimitive : std::uint8_t {
    panel = 0,
    button = 1,
    selection = 2,
    progress = 3,
    cursor = 4,
    custom = 255
};

enum class UiStateFlag : std::uint16_t {
    none = 0,
    hovered = 1U << 0U,
    pressed = 1U << 1U,
    disabled = 1U << 2U,
    selected = 1U << 3U,
    focused = 1U << 4U
};

[[nodiscard]] constexpr std::uint16_t uiStateBits(const UiStateFlag flag) noexcept {
    return static_cast<std::uint16_t>(flag);
}

struct UiCommand final {
    CommandHeader header;
    UiPrimitive primitive = UiPrimitive::panel;
    std::uint8_t reserved = 0;
    std::uint16_t stateFlags = uiStateBits(UiStateFlag::none);
    StableElementId elementId = 0;
    RectF bounds;
    float cornerRadius = 0.0F;
    float borderWidth = 0.0F;
    float value = 0.0F;
    PremultipliedRgba backgroundColor = PremultipliedRgba::transparent();
    PremultipliedRgba borderColor = PremultipliedRgba::transparent();
    PremultipliedRgba accentColor = PremultipliedRgba::transparent();

    constexpr bool operator==(const UiCommand&) const noexcept = default;
};

enum class OverlayOperation : std::uint8_t {
    beginSession = 0,
    captureBackdrop = 1,
    dim = 2,
    glassPanel = 3,
    endSession = 4
};

enum class BackdropUpdateMode : std::uint8_t {
    dirty = 0,
    always = 1
};

struct OverlayCommand final {
    CommandHeader header{
        RenderLayer::dynamicOverlay,
        CoordinateSpace::logicalUi,
        BlendMode::premultipliedAlpha,
        0,
        0,
        0
    };
    OverlayOperation operation = OverlayOperation::beginSession;
    BackdropUpdateMode updateMode = BackdropUpdateMode::dirty;
    RenderLayerMask sourceLayers = 0;
    StableElementId sessionId = 0;
    std::uint64_t sourceRevision = 0;
    RectF sourceBounds;
    RectF destinationBounds;
    float opacity = 1.0F;
    float blurRadius = 0.0F;
    float refractionStrength = 0.0F;
    float edgeStrength = 0.0F;
    PremultipliedRgba tintColor = PremultipliedRgba::transparent();
    PremultipliedRgba edgeColor = PremultipliedRgba::transparent();
    PremultipliedRgba shadowColor = PremultipliedRgba::transparent();

    constexpr bool operator==(const OverlayCommand&) const noexcept = default;
};

enum class CommandKind : std::uint8_t {
    sprite = 0,
    shape = 1,
    line = 2,
    text = 3,
    effect = 4,
    ui = 5,
    overlay = 6,
    glyphRun = 7,
    texturedMesh = 8,
    gradient = 9,
    clip = 10,
    pass = 11
};

struct CommandRef final {
    CommandKind kind = CommandKind::shape;
    std::array<std::uint8_t, 3> reserved{};
    std::uint32_t index = invalid_command_index;

    constexpr bool operator==(const CommandRef&) const noexcept = default;
};

static_assert(renderLayerOrder(RenderLayer::background) < renderLayerOrder(RenderLayer::object));
static_assert(renderLayerOrder(RenderLayer::object) < renderLayerOrder(RenderLayer::effect));
static_assert(renderLayerOrder(RenderLayer::effect) < renderLayerOrder(RenderLayer::textEffect));
static_assert(renderLayerOrder(RenderLayer::textEffect) < renderLayerOrder(RenderLayer::ui));
static_assert(renderLayerOrder(RenderLayer::ui) < renderLayerOrder(RenderLayer::vignette));
static_assert(renderLayerOrder(RenderLayer::vignette) < renderLayerOrder(RenderLayer::dynamicOverlay));
static_assert(renderLayerOrder(RenderLayer::dynamicOverlay) < renderLayerOrder(RenderLayer::top));
static_assert(render_layer_order.size() == renderLayerOrder(RenderLayer::count));
static_assert(sizeof(float) == 4);
static_assert(sizeof(double) == 8);
static_assert(std::numeric_limits<float>::is_iec559);
static_assert(std::numeric_limits<double>::is_iec559);
static_assert(std::is_trivially_copyable_v<CommandHeader>);
static_assert(std::is_trivially_copyable_v<SpriteCommand>);
static_assert(std::is_trivially_copyable_v<ShapeCommand>);
static_assert(std::is_trivially_copyable_v<LineCommand>);
static_assert(std::is_trivially_copyable_v<TextCommand>);
static_assert(std::is_trivially_copyable_v<StorageRange>);
static_assert(std::is_trivially_copyable_v<GlyphInstance>);
static_assert(std::is_trivially_copyable_v<GlyphRunCommand>);
static_assert(std::is_trivially_copyable_v<ProjectiveVertex>);
static_assert(std::is_trivially_copyable_v<TexturedMeshCommand>);
static_assert(std::is_trivially_copyable_v<GradientStop>);
static_assert(std::is_trivially_copyable_v<GradientCommand>);
static_assert(std::is_trivially_copyable_v<ClipCommand>);
static_assert(std::is_trivially_copyable_v<PassCommand>);
static_assert(std::is_trivially_copyable_v<EffectCommand>);
static_assert(std::is_trivially_copyable_v<UiCommand>);
static_assert(std::is_trivially_copyable_v<OverlayCommand>);
static_assert(std::is_trivially_copyable_v<CommandRef>);
static_assert(std::is_standard_layout_v<SpriteCommand>);
static_assert(std::is_standard_layout_v<ShapeCommand>);
static_assert(std::is_standard_layout_v<LineCommand>);
static_assert(std::is_standard_layout_v<TextCommand>);
static_assert(std::is_standard_layout_v<GlyphInstance>);
static_assert(std::is_standard_layout_v<GlyphRunCommand>);
static_assert(std::is_standard_layout_v<ProjectiveVertex>);
static_assert(std::is_standard_layout_v<TexturedMeshCommand>);
static_assert(std::is_standard_layout_v<GradientStop>);
static_assert(std::is_standard_layout_v<GradientCommand>);
static_assert(std::is_standard_layout_v<ClipCommand>);
static_assert(std::is_standard_layout_v<PassCommand>);
static_assert(std::is_standard_layout_v<EffectCommand>);
static_assert(std::is_standard_layout_v<UiCommand>);
static_assert(std::is_standard_layout_v<OverlayCommand>);

} // namespace cirvivor::render
