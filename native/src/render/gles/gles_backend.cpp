#include "render/gles/gles_backend.h"

#include "render/gles/gles_ui_placeholder.h"

#include "render/common/frame_packet.h"

#include <SDL3/SDL.h>
#include <SDL3/SDL_opengles2.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <limits>
#include <memory>
#include <numbers>
#include <span>
#include <string>
#include <string_view>
#include <utility>

namespace cirvivor::render::gles {
namespace {

using detail::GeometryOutcome;

constexpr std::int32_t maximum_drawable_dimension = 32'768;
constexpr std::uint64_t maximum_drawable_pixels = 256ULL * 1'024ULL * 1'024ULL;
constexpr double geometry_limit = 1.0e9;
constexpr double minimum_homogeneous_denominator = 1.0e-12;
constexpr GLuint position_attribute_index = 0U;
constexpr GLenum gl_context_lost = GL_CONTEXT_LOST_KHR;
constexpr GLenum gl_max_samples = 0x8d57U;
constexpr std::size_t circle_segment_count = 32U;
constexpr std::size_t rounded_corner_segment_count = 6U;
constexpr std::size_t maximum_geometry_vertices = circle_segment_count + 2U;
constexpr std::size_t rounded_rectangle_vertex_count =
    1U + 4U * (rounded_corner_segment_count + 1U) + 1U;
static_assert(rounded_rectangle_vertex_count <= maximum_geometry_vertices);

template <std::size_t Size>
[[nodiscard]] std::size_t copyText(
    std::array<char, Size>& destination,
    const std::string_view source
) noexcept {
    static_assert(Size > 0U);
    const std::size_t length = std::min(source.size(), Size - 1U);
    if (length > 0U) {
        std::memcpy(destination.data(), source.data(), length);
    }
    destination[length] = '\0';
    return length;
}

template <std::size_t Size>
[[nodiscard]] std::size_t formatText(
    std::array<char, Size>& destination,
    const char* const format,
    const char* const first,
    const char* const second
) noexcept {
    static_assert(Size > 0U);
    const int written = std::snprintf(destination.data(), Size, format, first, second);
    if (written < 0) {
        destination[0] = '\0';
        return 0U;
    }
    const std::size_t converted = static_cast<std::size_t>(written);
    return std::min(converted, Size - 1U);
}

template <std::size_t Size>
[[nodiscard]] std::size_t formatGlError(
    std::array<char, Size>& destination,
    const char* const prefix,
    const GLenum error
) noexcept {
    static_assert(Size > 0U);
    const int written = std::snprintf(
        destination.data(),
        Size,
        "%s: OpenGL ES error 0x%04x",
        prefix,
        static_cast<unsigned int>(error)
    );
    if (written < 0) {
        destination[0] = '\0';
        return 0U;
    }
    const std::size_t converted = static_cast<std::size_t>(written);
    return std::min(converted, Size - 1U);
}

template <std::size_t Size>
[[nodiscard]] std::size_t formatProfileMismatch(
    std::array<char, Size>& destination,
    const int requestedMajor,
    const int actualProfile,
    const int actualMajor,
    const int actualMinor
) noexcept {
    static_assert(Size > 0U);
    const int written = std::snprintf(
        destination.data(),
        Size,
        "OpenGL ES profile mismatch: requested ES %d.0, got profile 0x%x version %d.%d; recreate the SDL_WINDOW_OPENGL window with matching attributes before retrying",
        requestedMajor,
        static_cast<unsigned int>(actualProfile),
        actualMajor,
        actualMinor
    );
    if (written < 0) {
        destination[0] = '\0';
        return 0U;
    }
    const std::size_t converted = static_cast<std::size_t>(written);
    return std::min(converted, Size - 1U);
}

[[nodiscard]] bool drawableDimensionsAreValid(
    const std::int32_t width,
    const std::int32_t height
) noexcept {
    return width > 0
        && height > 0
        && width <= maximum_drawable_dimension
        && height <= maximum_drawable_dimension
        && static_cast<std::uint64_t>(width) * static_cast<std::uint64_t>(height)
            <= maximum_drawable_pixels;
}

[[nodiscard]] const char* safeSdlError() noexcept {
    const char* const error = SDL_GetError();
    return error != nullptr && error[0] != '\0' ? error : "SDL did not provide an error";
}

template <typename Procedure>
[[nodiscard]] bool loadGlProcedure(
    Procedure& destination,
    const char* const name
) noexcept {
    const SDL_FunctionPointer source = SDL_GL_GetProcAddress(name);
    if (source == nullptr) {
        destination = nullptr;
        return false;
    }
    static_assert(sizeof(Procedure) == sizeof(SDL_FunctionPointer));
    std::memcpy(&destination, &source, sizeof(destination));
    return destination != nullptr;
}

[[nodiscard]] bool finiteCoordinate(const double value) noexcept {
    return std::isfinite(value) && std::abs(value) <= geometry_limit;
}

struct PointD final {
    double x = 0.0;
    double y = 0.0;
};

[[nodiscard]] PointD rotatePoint(
    const PointD point,
    const PointD pivot,
    const double radians
) noexcept {
    if (radians == 0.0) {
        return point;
    }
    const double cosine = std::cos(radians);
    const double sine = std::sin(radians);
    const double relativeX = point.x - pivot.x;
    const double relativeY = point.y - pivot.y;
    return {
        pivot.x + relativeX * cosine - relativeY * sine,
        pivot.y + relativeX * sine + relativeY * cosine
    };
}

class CoordinateMapper final {
public:
    CoordinateMapper(
        const ViewportState& viewport,
        const std::int32_t drawableWidth,
        const std::int32_t drawableHeight
    ) noexcept
        : viewport_(viewport),
          drawableWidth_(drawableWidth),
          drawableHeight_(drawableHeight) {
        const SizeI frameDrawable = viewport_.drawable.size;
        valid_ = drawableDimensionsAreValid(drawableWidth_, drawableHeight_)
            && frameDrawable.width > 0
            && frameDrawable.height > 0;
        if (valid_) {
            outputScaleX_ = static_cast<double>(drawableWidth_)
                / static_cast<double>(frameDrawable.width);
            outputScaleY_ = static_cast<double>(drawableHeight_)
                / static_cast<double>(frameDrawable.height);
            valid_ = std::isfinite(outputScaleX_)
                && std::isfinite(outputScaleY_)
                && outputScaleX_ > 0.0
                && outputScaleY_ > 0.0;
        }
    }

    [[nodiscard]] bool isValid() const noexcept {
        return valid_;
    }

    [[nodiscard]] bool mapToNdc(
        const double inputX,
        const double inputY,
        const CoordinateSpace coordinateSpace,
        PointD& output
    ) const noexcept {
        if (!valid_ || !finiteCoordinate(inputX) || !finiteCoordinate(inputY)) {
            return false;
        }

        double drawableX = 0.0;
        double drawableY = 0.0;
        switch (coordinateSpace) {
        case CoordinateSpace::physicalPixels: {
            const RectI bounds = viewport_.physical.windowBounds;
            if (bounds.width > 0 && bounds.height > 0) {
                drawableX = (inputX - static_cast<double>(bounds.x))
                    * static_cast<double>(viewport_.drawable.size.width)
                    / static_cast<double>(bounds.width);
                drawableY = (inputY - static_cast<double>(bounds.y))
                    * static_cast<double>(viewport_.drawable.size.height)
                    / static_cast<double>(bounds.height);
            } else {
                drawableX = inputX;
                drawableY = inputY;
            }
            break;
        }
        case CoordinateSpace::drawablePixels:
            drawableX = inputX;
            drawableY = inputY;
            break;
        case CoordinateSpace::logicalUi: {
            const double scaleX = static_cast<double>(
                viewport_.logicalUi.drawablePixelsPerLogicalUnitX
            );
            const double scaleY = static_cast<double>(
                viewport_.logicalUi.drawablePixelsPerLogicalUnitY
            );
            if (!(scaleX > 0.0) || !(scaleY > 0.0)
                || !std::isfinite(scaleX) || !std::isfinite(scaleY)) {
                return false;
            }
            drawableX = static_cast<double>(viewport_.drawable.contentRect.x)
                + (inputX - static_cast<double>(viewport_.logicalUi.contentRect.x)) * scaleX;
            drawableY = static_cast<double>(viewport_.drawable.contentRect.y)
                + (inputY - static_cast<double>(viewport_.logicalUi.contentRect.y)) * scaleY;
            break;
        }
        case CoordinateSpace::world: {
            const auto& matrix = viewport_.world.worldToDrawable.elements;
            const double homogeneousX = static_cast<double>(matrix[0]) * inputX
                + static_cast<double>(matrix[1]) * inputY
                + static_cast<double>(matrix[2]);
            const double homogeneousY = static_cast<double>(matrix[3]) * inputX
                + static_cast<double>(matrix[4]) * inputY
                + static_cast<double>(matrix[5]);
            const double homogeneousW = static_cast<double>(matrix[6]) * inputX
                + static_cast<double>(matrix[7]) * inputY
                + static_cast<double>(matrix[8]);
            if (!std::isfinite(homogeneousW)
                || std::abs(homogeneousW) <= minimum_homogeneous_denominator) {
                return false;
            }
            drawableX = homogeneousX / homogeneousW;
            drawableY = homogeneousY / homogeneousW;
            break;
        }
        }

        drawableX *= outputScaleX_;
        drawableY *= outputScaleY_;
        if (!finiteCoordinate(drawableX) || !finiteCoordinate(drawableY)) {
            return false;
        }
        output.x = drawableX * 2.0 / static_cast<double>(drawableWidth_) - 1.0;
        output.y = 1.0 - drawableY * 2.0 / static_cast<double>(drawableHeight_);
        return finiteCoordinate(output.x) && finiteCoordinate(output.y);
    }

private:
    const ViewportState& viewport_;
    std::int32_t drawableWidth_ = 0;
    std::int32_t drawableHeight_ = 0;
    double outputScaleX_ = 0.0;
    double outputScaleY_ = 0.0;
    bool valid_ = false;
};

[[nodiscard]] PremultipliedRgba visibleColorOr(
    const PremultipliedRgba color,
    const PremultipliedRgba fallback
) noexcept {
    return color.alpha > 0.0F ? color : fallback;
}

[[nodiscard]] PremultipliedRgba withOpacity(
    const PremultipliedRgba color,
    const float opacity
) noexcept {
    const float scale = std::clamp(opacity, 0.0F, 1.0F);
    return {
        color.red * scale,
        color.green * scale,
        color.blue * scale,
        color.alpha * scale
    };
}

[[nodiscard]] RectF textPlaceholderBounds(const TextCommand& command) noexcept {
    const float estimatedWidth = std::max(
        command.fontSize,
        static_cast<float>(command.utf8.byteLength) * command.fontSize * 0.52F
    );
    const float width = command.maximumSize.width > 0.0F
        ? std::min(estimatedWidth, command.maximumSize.width)
        : estimatedWidth;
    const float estimatedHeight = command.lineHeight > 0.0F
        ? command.lineHeight
        : command.fontSize;
    const float height = command.maximumSize.height > 0.0F
        ? std::min(estimatedHeight, command.maximumSize.height)
        : estimatedHeight;

    float x = command.origin.x;
    switch (command.align) {
    case TextAlign::start:
        break;
    case TextAlign::center:
        x -= width * 0.5F;
        break;
    case TextAlign::end:
        x -= width;
        break;
    }

    float y = command.origin.y;
    switch (command.baseline) {
    case TextBaseline::top:
        break;
    case TextBaseline::middle:
        y -= height * 0.5F;
        break;
    case TextBaseline::alphabetic:
        y -= height * 0.8F;
        break;
    case TextBaseline::bottom:
        y -= height;
        break;
    }
    return {x, y, width, height};
}

[[nodiscard]] RectF v2MarkerBounds(
    const ViewportState& viewport,
    const std::uint64_t seed
) noexcept {
    const RectF content = viewport.logicalUi.contentRect;
    const float marker = std::max(
        std::min(content.width, content.height) * 0.014F,
        4.0F
    );
    const float offset = static_cast<float>(seed & 0x1fU) * marker * 0.08F;
    return {
        content.x + marker + offset,
        content.y + marker * 2.0F,
        marker,
        marker
    };
}

[[nodiscard]] RectF meshPlaceholderBounds(
    const FramePacket& frame,
    const TexturedMeshCommand& command
) noexcept {
    const auto vertices = frame.meshVertices().subspan(
        static_cast<std::size_t>(command.vertices.offset),
        static_cast<std::size_t>(command.vertices.count)
    );
    float left = vertices.front().position.x;
    float top = vertices.front().position.y;
    float right = left;
    float bottom = top;
    for (const ProjectiveVertex& vertex : vertices) {
        left = std::min(left, vertex.position.x);
        top = std::min(top, vertex.position.y);
        right = std::max(right, vertex.position.x);
        bottom = std::max(bottom, vertex.position.y);
    }
    return {left, top, right - left, bottom - top};
}

[[nodiscard]] constexpr bool legacyOverlayControlNeedsPlaceholder(
    const OverlayOperation operation
) noexcept {
    return operation == OverlayOperation::beginSession
        || operation == OverlayOperation::captureBackdrop
        || operation == OverlayOperation::endSession;
}

static_assert(legacyOverlayControlNeedsPlaceholder(OverlayOperation::beginSession));
static_assert(legacyOverlayControlNeedsPlaceholder(OverlayOperation::captureBackdrop));
static_assert(legacyOverlayControlNeedsPlaceholder(OverlayOperation::endSession));
static_assert(!legacyOverlayControlNeedsPlaceholder(OverlayOperation::dim));
static_assert(!legacyOverlayControlNeedsPlaceholder(OverlayOperation::glassPanel));

} // namespace

struct GlesBackend::Impl final {
    struct GlFunctions final {
        PFNGLATTACHSHADERPROC attachShader = nullptr;
        PFNGLBINDATTRIBLOCATIONPROC bindAttribLocation = nullptr;
        PFNGLBINDBUFFERPROC bindBuffer = nullptr;
        PFNGLBLENDFUNCPROC blendFunc = nullptr;
        PFNGLBUFFERDATAPROC bufferData = nullptr;
        PFNGLBUFFERSUBDATAPROC bufferSubData = nullptr;
        PFNGLCLEARPROC clear = nullptr;
        PFNGLCLEARCOLORPROC clearColor = nullptr;
        PFNGLCOMPILESHADERPROC compileShader = nullptr;
        PFNGLCREATEPROGRAMPROC createProgram = nullptr;
        PFNGLCREATESHADERPROC createShader = nullptr;
        PFNGLDELETEBUFFERSPROC deleteBuffers = nullptr;
        PFNGLDELETEPROGRAMPROC deleteProgram = nullptr;
        PFNGLDELETESHADERPROC deleteShader = nullptr;
        PFNGLDISABLEPROC disable = nullptr;
        PFNGLDISABLEVERTEXATTRIBARRAYPROC disableVertexAttribArray = nullptr;
        PFNGLDRAWARRAYSPROC drawArrays = nullptr;
        PFNGLENABLEPROC enable = nullptr;
        PFNGLENABLEVERTEXATTRIBARRAYPROC enableVertexAttribArray = nullptr;
        PFNGLGENBUFFERSPROC genBuffers = nullptr;
        PFNGLGETERRORPROC getError = nullptr;
        PFNGLGETINTEGERVPROC getIntegerv = nullptr;
        PFNGLGETPROGRAMINFOLOGPROC getProgramInfoLog = nullptr;
        PFNGLGETPROGRAMIVPROC getProgramiv = nullptr;
        PFNGLGETSHADERINFOLOGPROC getShaderInfoLog = nullptr;
        PFNGLGETSHADERIVPROC getShaderiv = nullptr;
        PFNGLGETSTRINGPROC getString = nullptr;
        PFNGLGETUNIFORMLOCATIONPROC getUniformLocation = nullptr;
        PFNGLLINKPROGRAMPROC linkProgram = nullptr;
        PFNGLSHADERSOURCEPROC shaderSource = nullptr;
        PFNGLUNIFORM4FPROC uniform4f = nullptr;
        PFNGLUSEPROGRAMPROC useProgram = nullptr;
        PFNGLVERTEXATTRIBPOINTERPROC vertexAttribPointer = nullptr;
        PFNGLVIEWPORTPROC viewport = nullptr;

        [[nodiscard]] bool load(const char*& missingName) noexcept {
#define CIRVIVOR_LOAD_GL(member, procedure) \
    if (!loadGlProcedure(member, #procedure)) { \
        missingName = #procedure; \
        return false; \
    }
            CIRVIVOR_LOAD_GL(attachShader, glAttachShader)
            CIRVIVOR_LOAD_GL(bindAttribLocation, glBindAttribLocation)
            CIRVIVOR_LOAD_GL(bindBuffer, glBindBuffer)
            CIRVIVOR_LOAD_GL(blendFunc, glBlendFunc)
            CIRVIVOR_LOAD_GL(bufferData, glBufferData)
            CIRVIVOR_LOAD_GL(bufferSubData, glBufferSubData)
            CIRVIVOR_LOAD_GL(clear, glClear)
            CIRVIVOR_LOAD_GL(clearColor, glClearColor)
            CIRVIVOR_LOAD_GL(compileShader, glCompileShader)
            CIRVIVOR_LOAD_GL(createProgram, glCreateProgram)
            CIRVIVOR_LOAD_GL(createShader, glCreateShader)
            CIRVIVOR_LOAD_GL(deleteBuffers, glDeleteBuffers)
            CIRVIVOR_LOAD_GL(deleteProgram, glDeleteProgram)
            CIRVIVOR_LOAD_GL(deleteShader, glDeleteShader)
            CIRVIVOR_LOAD_GL(disable, glDisable)
            CIRVIVOR_LOAD_GL(disableVertexAttribArray, glDisableVertexAttribArray)
            CIRVIVOR_LOAD_GL(drawArrays, glDrawArrays)
            CIRVIVOR_LOAD_GL(enable, glEnable)
            CIRVIVOR_LOAD_GL(enableVertexAttribArray, glEnableVertexAttribArray)
            CIRVIVOR_LOAD_GL(genBuffers, glGenBuffers)
            CIRVIVOR_LOAD_GL(getError, glGetError)
            CIRVIVOR_LOAD_GL(getIntegerv, glGetIntegerv)
            CIRVIVOR_LOAD_GL(getProgramInfoLog, glGetProgramInfoLog)
            CIRVIVOR_LOAD_GL(getProgramiv, glGetProgramiv)
            CIRVIVOR_LOAD_GL(getShaderInfoLog, glGetShaderInfoLog)
            CIRVIVOR_LOAD_GL(getShaderiv, glGetShaderiv)
            CIRVIVOR_LOAD_GL(getString, glGetString)
            CIRVIVOR_LOAD_GL(getUniformLocation, glGetUniformLocation)
            CIRVIVOR_LOAD_GL(linkProgram, glLinkProgram)
            CIRVIVOR_LOAD_GL(shaderSource, glShaderSource)
            CIRVIVOR_LOAD_GL(uniform4f, glUniform4f)
            CIRVIVOR_LOAD_GL(useProgram, glUseProgram)
            CIRVIVOR_LOAD_GL(vertexAttribPointer, glVertexAttribPointer)
            CIRVIVOR_LOAD_GL(viewport, glViewport)
#undef CIRVIVOR_LOAD_GL
            missingName = nullptr;
            return true;
        }
    };

    explicit Impl(SDL_Window* const externalWindow) noexcept
        : window(externalWindow) {}

    ~Impl() noexcept {
        release();
    }

    Impl(const Impl&) = delete;
    Impl& operator=(const Impl&) = delete;

    void clearOperation() noexcept {
        operationError = GlesRenderError::none;
        operationDiagnosticLength = 0U;
        operationDiagnostic[0] = '\0';
    }

    void fail(
        const GlesRenderError error,
        const std::string_view message
    ) noexcept {
        operationError = error;
        operationDiagnosticLength = copyText(operationDiagnostic, message);
    }

    void failWithSdl(
        const GlesRenderError error,
        const char* const prefix
    ) noexcept {
        operationError = error;
        operationDiagnosticLength = formatText(
            operationDiagnostic,
            "%s: %s",
            prefix,
            safeSdlError()
        );
    }

    void failWithGl(
        const GlesRenderError error,
        const char* const prefix,
        const GLenum glError
    ) noexcept {
        operationError = error;
        operationDiagnosticLength = formatGlError(operationDiagnostic, prefix, glError);
    }

    [[nodiscard]] std::string_view operationMessage() const noexcept {
        return {operationDiagnostic.data(), operationDiagnosticLength};
    }

    [[nodiscard]] bool makeCurrent() noexcept {
        if (context == nullptr) {
            fail(GlesRenderError::notInitialized, "OpenGL ES context is not initialized");
            return false;
        }
        if (SDL_GL_GetCurrentContext() == context
            && SDL_GL_GetCurrentWindow() == window) {
            return true;
        }
        if (!SDL_GL_MakeCurrent(window, context)) {
            failWithSdl(
                GlesRenderError::contextMakeCurrentFailed,
                "OpenGL ES make-current failed"
            );
            return false;
        }
        return true;
    }

    void release() noexcept {
        if (context == nullptr) {
            program = 0U;
            vertexBuffer = 0U;
            gl = {};
            return;
        }

        const bool contextCurrent = SDL_GL_GetCurrentContext() == context
            || SDL_GL_MakeCurrent(window, context);
        if (contextCurrent) {
            if (gl.disableVertexAttribArray != nullptr) {
                gl.disableVertexAttribArray(position_attribute_index);
            }
            if (vertexBuffer != 0U && gl.deleteBuffers != nullptr) {
                gl.deleteBuffers(1, &vertexBuffer);
            }
            if (program != 0U && gl.deleteProgram != nullptr) {
                gl.deleteProgram(program);
            }
            (void)SDL_GL_MakeCurrent(window, nullptr);
        }
        vertexBuffer = 0U;
        program = 0U;
        colorUniform = -1;
        (void)SDL_GL_DestroyContext(context);
        context = nullptr;
        gl = {};
    }

    [[nodiscard]] GLenum drainErrors() const noexcept {
        if (gl.getError == nullptr) {
            return GL_NO_ERROR;
        }
        GLenum firstError = GL_NO_ERROR;
        for (std::uint32_t attempt = 0U; attempt < 32U; ++attempt) {
            const GLenum error = gl.getError();
            if (error == GL_NO_ERROR) {
                break;
            }
            if (firstError == GL_NO_ERROR || error == gl_context_lost) {
                firstError = error;
            }
            if (error == gl_context_lost) {
                break;
            }
        }
        return firstError;
    }

    [[nodiscard]] GLuint compileShader(
        const GLenum type,
        const char* const source,
        const char* const label
    ) noexcept {
        const GLuint shader = gl.createShader(type);
        if (shader == 0U) {
            fail(GlesRenderError::shaderCompileFailed, "OpenGL ES shader creation returned zero");
            return 0U;
        }
        gl.shaderSource(shader, 1, &source, nullptr);
        gl.compileShader(shader);
        GLint compiled = GL_FALSE;
        gl.getShaderiv(shader, GL_COMPILE_STATUS, &compiled);
        if (compiled == GL_TRUE) {
            return shader;
        }

        std::array<char, 448> log{};
        GLsizei length = 0;
        gl.getShaderInfoLog(
            shader,
            static_cast<GLsizei>(log.size()),
            &length,
            log.data()
        );
        gl.deleteShader(shader);
        const char* const logText = length > 0 ? log.data() : "driver returned no shader log";
        operationError = GlesRenderError::shaderCompileFailed;
        operationDiagnosticLength = formatText(
            operationDiagnostic,
            "%s shader compilation failed: %s",
            label,
            logText
        );
        return 0U;
    }

    [[nodiscard]] bool createPipeline() noexcept {
        static constexpr char es2VertexShader[] =
            "attribute vec2 aPosition;\n"
            "void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }\n";
        static constexpr char es2FragmentShader[] =
            "precision mediump float;\n"
            "uniform vec4 uColor;\n"
            "void main() { gl_FragColor = uColor; }\n";
        static constexpr char es3VertexShader[] =
            "#version 300 es\n"
            "layout(location = 0) in vec2 aPosition;\n"
            "void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }\n";
        static constexpr char es3FragmentShader[] =
            "#version 300 es\n"
            "precision mediump float;\n"
            "uniform vec4 uColor;\n"
            "out vec4 fragmentColor;\n"
            "void main() { fragmentColor = uColor; }\n";

        const bool useEs3Shaders = version == GlesContextVersion::es3;
        const GLuint vertexShader = compileShader(
            GL_VERTEX_SHADER,
            useEs3Shaders ? es3VertexShader : es2VertexShader,
            "vertex"
        );
        if (vertexShader == 0U) {
            return false;
        }
        const GLuint fragmentShader = compileShader(
            GL_FRAGMENT_SHADER,
            useEs3Shaders ? es3FragmentShader : es2FragmentShader,
            "fragment"
        );
        if (fragmentShader == 0U) {
            gl.deleteShader(vertexShader);
            return false;
        }

        const GLuint candidateProgram = gl.createProgram();
        if (candidateProgram == 0U) {
            gl.deleteShader(vertexShader);
            gl.deleteShader(fragmentShader);
            fail(GlesRenderError::programLinkFailed, "OpenGL ES program creation returned zero");
            return false;
        }
        gl.attachShader(candidateProgram, vertexShader);
        gl.attachShader(candidateProgram, fragmentShader);
        gl.bindAttribLocation(candidateProgram, position_attribute_index, "aPosition");
        gl.linkProgram(candidateProgram);
        GLint linked = GL_FALSE;
        gl.getProgramiv(candidateProgram, GL_LINK_STATUS, &linked);
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        if (linked != GL_TRUE) {
            std::array<char, 448> log{};
            GLsizei length = 0;
            gl.getProgramInfoLog(
                candidateProgram,
                static_cast<GLsizei>(log.size()),
                &length,
                log.data()
            );
            gl.deleteProgram(candidateProgram);
            const char* const logText = length > 0 ? log.data() : "driver returned no link log";
            operationError = GlesRenderError::programLinkFailed;
            operationDiagnosticLength = formatText(
                operationDiagnostic,
                "%s: %s",
                "OpenGL ES program link failed",
                logText
            );
            return false;
        }

        const GLint candidateUniform = gl.getUniformLocation(candidateProgram, "uColor");
        if (candidateUniform < 0) {
            gl.deleteProgram(candidateProgram);
            fail(GlesRenderError::programLinkFailed, "OpenGL ES uColor uniform was not found");
            return false;
        }

        GLuint candidateBuffer = 0U;
        gl.genBuffers(1, &candidateBuffer);
        if (candidateBuffer == 0U) {
            gl.deleteProgram(candidateProgram);
            fail(GlesRenderError::bufferCreationFailed, "OpenGL ES vertex buffer creation returned zero");
            return false;
        }
        gl.bindBuffer(GL_ARRAY_BUFFER, candidateBuffer);
        constexpr GLsizeiptr vertexBytes = static_cast<GLsizeiptr>(
            sizeof(float) * maximum_geometry_vertices * 2U
        );
        gl.bufferData(GL_ARRAY_BUFFER, vertexBytes, nullptr, GL_DYNAMIC_DRAW);

        const GLenum error = drainErrors();
        if (error != GL_NO_ERROR) {
            gl.deleteBuffers(1, &candidateBuffer);
            gl.deleteProgram(candidateProgram);
            failWithGl(
                error == gl_context_lost
                    ? GlesRenderError::contextLost
                    : GlesRenderError::bufferCreationFailed,
                "OpenGL ES pipeline creation failed",
                error
            );
            return false;
        }

        program = candidateProgram;
        colorUniform = candidateUniform;
        vertexBuffer = candidateBuffer;
        return true;
    }

    [[nodiscard]] bool initialize(const GlesContextVersion requestedVersion) noexcept {
        clearOperation();
        const int requestedMajor = requestedVersion == GlesContextVersion::es3 ? 3 : 2;
        context = SDL_GL_CreateContext(window);
        if (context == nullptr) {
            failWithSdl(
                GlesRenderError::contextCreationFailed,
                requestedMajor == 3
                    ? "OpenGL ES 3.0 context creation failed on the preconfigured window; recreate the window with ES 2.0 attributes before fallback"
                    : "OpenGL ES 2.0 context creation failed on the preconfigured window"
            );
            return false;
        }
        if (!SDL_GL_MakeCurrent(window, context)) {
            failWithSdl(
                GlesRenderError::contextMakeCurrentFailed,
                requestedMajor == 3
                    ? "OpenGL ES 3.0 make-current failed"
                    : "OpenGL ES 2.0 make-current failed"
            );
            return false;
        }

        int actualProfile = 0;
        int actualMajor = 0;
        int actualMinor = 0;
        if (!SDL_GL_GetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, &actualProfile)
            || !SDL_GL_GetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, &actualMajor)
            || !SDL_GL_GetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, &actualMinor)) {
            failWithSdl(
                GlesRenderError::contextProfileMismatch,
                "OpenGL ES context profile query failed; GL attributes must be configured before window creation"
            );
            return false;
        }
        if ((actualProfile & SDL_GL_CONTEXT_PROFILE_ES) == 0
            || actualMajor < requestedMajor) {
            operationError = GlesRenderError::contextProfileMismatch;
            operationDiagnosticLength = formatProfileMismatch(
                operationDiagnostic,
                requestedMajor,
                actualProfile,
                actualMajor,
                actualMinor
            );
            return false;
        }
        // ES2 fallback은 ES3 capable context를 받아도 GLSL ES 1.00 경로로 제한한다.
        version = requestedVersion;

        const char* missingName = nullptr;
        if (!gl.load(missingName)) {
            operationError = GlesRenderError::functionLoadFailed;
            operationDiagnosticLength = formatText(
                operationDiagnostic,
                "%s: %s",
                "OpenGL ES function load failed",
                missingName != nullptr ? missingName : "unknown procedure"
            );
            return false;
        }
        (void)drainErrors();
        if (!createPipeline()) {
            return false;
        }

        if (!SDL_GetWindowSizeInPixels(window, &drawableWidth, &drawableHeight)
            || !drawableDimensionsAreValid(drawableWidth, drawableHeight)) {
            failWithSdl(
                GlesRenderError::invalidDrawableSize,
                "OpenGL ES drawable size query failed"
            );
            return false;
        }

        gl.viewport(0, 0, drawableWidth, drawableHeight);
        gl.disable(GL_DEPTH_TEST);
        gl.disable(GL_CULL_FACE);
        gl.disable(GL_SCISSOR_TEST);
        gl.useProgram(program);
        gl.bindBuffer(GL_ARRAY_BUFFER, vertexBuffer);
        gl.enableVertexAttribArray(position_attribute_index);
        gl.vertexAttribPointer(
            position_attribute_index,
            2,
            GL_FLOAT,
            GL_FALSE,
            static_cast<GLsizei>(sizeof(float) * 2U),
            nullptr
        );

        const GLenum setupError = drainErrors();
        if (setupError != GL_NO_ERROR) {
            failWithGl(
                setupError == gl_context_lost
                    ? GlesRenderError::contextLost
                    : GlesRenderError::graphicsApiError,
                "OpenGL ES initial state setup failed",
                setupError
            );
            return false;
        }

        if (SDL_GL_SetSwapInterval(1)) {
            configuredSwapInterval = 1;
        } else if (SDL_GL_SetSwapInterval(0)) {
            configuredSwapInterval = 0;
        } else {
            configuredSwapInterval = -1;
            swapWarningLength = formatText(
                swapWarning,
                "%s: %s",
                "OpenGL ES swap interval control is unavailable",
                safeSdlError()
            );
        }

        GLint textureSize = 0;
        gl.getIntegerv(GL_MAX_TEXTURE_SIZE, &textureSize);
        maximumTextureSize = std::max(textureSize, 0);
        maximumSampleCount = 1;
        if (version == GlesContextVersion::es3) {
            GLint samples = 1;
            gl.getIntegerv(gl_max_samples, &samples);
            maximumSampleCount = std::max(samples, 1);
        }

        const GLubyte* const renderer = gl.getString(GL_RENDERER);
        if (renderer != nullptr) {
            const char* const text = reinterpret_cast<const char*>(renderer);
            std::size_t length = 0U;
            while (length + 1U < rendererName.size() && text[length] != '\0') {
                rendererName[length] = text[length];
                ++length;
            }
            rendererName[length] = '\0';
            rendererNameLength = length;
        }

        const GLenum queryError = drainErrors();
        if (queryError != GL_NO_ERROR) {
            failWithGl(
                queryError == gl_context_lost
                    ? GlesRenderError::contextLost
                    : GlesRenderError::graphicsApiError,
                "OpenGL ES capability query failed",
                queryError
            );
            return false;
        }
        clearOperation();
        return true;
    }

    void configureBlend(const BlendMode blendMode) const noexcept {
        switch (blendMode) {
        case BlendMode::opaque:
            gl.disable(GL_BLEND);
            break;
        case BlendMode::premultipliedAlpha:
            gl.enable(GL_BLEND);
            gl.blendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
            break;
        case BlendMode::additivePremultiplied:
            gl.enable(GL_BLEND);
            gl.blendFunc(GL_ONE, GL_ONE);
            break;
        }
    }

    [[nodiscard]] GeometryOutcome drawVertices(
        const std::span<const PointD> inputVertices,
        const GLenum primitive,
        const CommandHeader& header,
        const PremultipliedRgba color,
        const CoordinateMapper& mapper
    ) const noexcept {
        if (inputVertices.size() < 3U
            || inputVertices.size() > maximum_geometry_vertices) {
            return GeometryOutcome::skipped;
        }

        std::array<float, maximum_geometry_vertices * 2U> vertices{};
        bool outsideLeft = true;
        bool outsideRight = true;
        bool outsideBottom = true;
        bool outsideTop = true;
        for (std::size_t index = 0U; index < inputVertices.size(); ++index) {
            PointD mapped;
            if (!mapper.mapToNdc(
                    inputVertices[index].x,
                    inputVertices[index].y,
                    header.coordinateSpace,
                    mapped
                )) {
                return GeometryOutcome::skipped;
            }
            vertices[index * 2U] = static_cast<float>(mapped.x);
            vertices[index * 2U + 1U] = static_cast<float>(mapped.y);
            outsideLeft = outsideLeft && mapped.x < -1.0;
            outsideRight = outsideRight && mapped.x > 1.0;
            outsideBottom = outsideBottom && mapped.y < -1.0;
            outsideTop = outsideTop && mapped.y > 1.0;
        }
        if (outsideLeft || outsideRight || outsideBottom || outsideTop) {
            return GeometryOutcome::skipped;
        }

        const std::size_t floatCount = inputVertices.size() * 2U;
        configureBlend(header.blendMode);
        gl.useProgram(program);
        gl.bindBuffer(GL_ARRAY_BUFFER, vertexBuffer);
        gl.bufferSubData(
            GL_ARRAY_BUFFER,
            0,
            static_cast<GLsizeiptr>(floatCount * sizeof(float)),
            vertices.data()
        );
        gl.enableVertexAttribArray(position_attribute_index);
        gl.vertexAttribPointer(
            position_attribute_index,
            2,
            GL_FLOAT,
            GL_FALSE,
            static_cast<GLsizei>(sizeof(float) * 2U),
            nullptr
        );
        gl.uniform4f(colorUniform, color.red, color.green, color.blue, color.alpha);
        gl.drawArrays(primitive, 0, static_cast<GLsizei>(inputVertices.size()));
        return GeometryOutcome::drawn;
    }

    [[nodiscard]] GeometryOutcome drawRectangle(
        const RectF rectangle,
        const CommandHeader& header,
        const PremultipliedRgba color,
        const CoordinateMapper& mapper,
        const float rotationRadians = 0.0F,
        const Vec2F normalizedPivot = {0.5F, 0.5F}
    ) const noexcept {
        if (!(rectangle.width > 0.0F) || !(rectangle.height > 0.0F)) {
            return GeometryOutcome::skipped;
        }

        const double left = static_cast<double>(rectangle.x);
        const double top = static_cast<double>(rectangle.y);
        const double right = left + static_cast<double>(rectangle.width);
        const double bottom = top + static_cast<double>(rectangle.height);
        const PointD pivot{
            left + static_cast<double>(rectangle.width)
                * static_cast<double>(normalizedPivot.x),
            top + static_cast<double>(rectangle.height)
                * static_cast<double>(normalizedPivot.y)
        };
        const double rotation = static_cast<double>(rotationRadians);
        std::array<PointD, 4> points{
            rotatePoint({left, top}, pivot, rotation),
            rotatePoint({right, top}, pivot, rotation),
            rotatePoint({right, bottom}, pivot, rotation),
            rotatePoint({left, bottom}, pivot, rotation)
        };
        return drawVertices(points, GL_TRIANGLE_FAN, header, color, mapper);
    }

    [[nodiscard]] GeometryOutcome drawCircle(
        const RectF bounds,
        const CommandHeader& header,
        const PremultipliedRgba color,
        const CoordinateMapper& mapper,
        const float rotationRadians = 0.0F
    ) const noexcept {
        if (!(bounds.width > 0.0F) || !(bounds.height > 0.0F)) {
            return GeometryOutcome::skipped;
        }

        const PointD center{
            static_cast<double>(bounds.x) + static_cast<double>(bounds.width) * 0.5,
            static_cast<double>(bounds.y) + static_cast<double>(bounds.height) * 0.5
        };
        const double radiusX = static_cast<double>(bounds.width) * 0.5;
        const double radiusY = static_cast<double>(bounds.height) * 0.5;
        const double rotation = static_cast<double>(rotationRadians);
        constexpr double fullCircle = std::numbers::pi_v<double> * 2.0;
        std::array<PointD, maximum_geometry_vertices> points{};
        points[0] = center;
        for (std::size_t segment = 0U; segment <= circle_segment_count; ++segment) {
            const double angle = -std::numbers::pi_v<double> * 0.5
                + fullCircle * static_cast<double>(segment)
                    / static_cast<double>(circle_segment_count);
            const PointD perimeter{
                center.x + std::cos(angle) * radiusX,
                center.y + std::sin(angle) * radiusY
            };
            points[segment + 1U] = rotatePoint(perimeter, center, rotation);
        }
        return drawVertices(points, GL_TRIANGLE_FAN, header, color, mapper);
    }

    [[nodiscard]] GeometryOutcome drawRoundedRectangle(
        const RectF bounds,
        const float requestedRadius,
        const CommandHeader& header,
        const PremultipliedRgba color,
        const CoordinateMapper& mapper,
        const float rotationRadians
    ) const noexcept {
        if (!(bounds.width > 0.0F) || !(bounds.height > 0.0F)) {
            return GeometryOutcome::skipped;
        }
        const double width = static_cast<double>(bounds.width);
        const double height = static_cast<double>(bounds.height);
        const double radius = std::clamp(
            static_cast<double>(requestedRadius),
            0.0,
            std::min(width, height) * 0.5
        );
        if (!(radius > 0.0)) {
            return drawRectangle(
                bounds,
                header,
                color,
                mapper,
                rotationRadians
            );
        }

        const double left = static_cast<double>(bounds.x);
        const double top = static_cast<double>(bounds.y);
        const double right = left + width;
        const double bottom = top + height;
        const PointD center{(left + right) * 0.5, (top + bottom) * 0.5};
        const std::array<PointD, 4> cornerCenters{
            PointD{right - radius, top + radius},
            PointD{right - radius, bottom - radius},
            PointD{left + radius, bottom - radius},
            PointD{left + radius, top + radius}
        };
        const std::array<double, 4> startAngles{
            -std::numbers::pi_v<double> * 0.5,
            0.0,
            std::numbers::pi_v<double> * 0.5,
            std::numbers::pi_v<double>
        };
        const double cornerSweep = std::numbers::pi_v<double> * 0.5;
        const double rotation = static_cast<double>(rotationRadians);
        std::array<PointD, rounded_rectangle_vertex_count> points{};
        std::size_t count = 0U;
        points[count++] = center;
        PointD firstPerimeter;
        for (std::size_t corner = 0U; corner < cornerCenters.size(); ++corner) {
            for (std::size_t segment = 0U;
                segment <= rounded_corner_segment_count;
                ++segment) {
                const double angle = startAngles[corner]
                    + cornerSweep * static_cast<double>(segment)
                        / static_cast<double>(rounded_corner_segment_count);
                const PointD perimeter{
                    cornerCenters[corner].x + std::cos(angle) * radius,
                    cornerCenters[corner].y + std::sin(angle) * radius
                };
                const PointD rotated = rotatePoint(perimeter, center, rotation);
                if (count == 1U) {
                    firstPerimeter = rotated;
                }
                points[count++] = rotated;
            }
        }
        points[count++] = firstPerimeter;
        return drawVertices(
            std::span<const PointD>(points.data(), count),
            GL_TRIANGLE_FAN,
            header,
            color,
            mapper
        );
    }

    [[nodiscard]] GeometryOutcome drawLine(
        const LineCommand& command,
        const CoordinateMapper& mapper
    ) const noexcept {
        if (!(command.width > 0.0F)) {
            return GeometryOutcome::skipped;
        }
        PointD start{
            static_cast<double>(command.start.x),
            static_cast<double>(command.start.y)
        };
        PointD end{
            static_cast<double>(command.end.x),
            static_cast<double>(command.end.y)
        };
        const double deltaX = end.x - start.x;
        const double deltaY = end.y - start.y;
        const double length = std::hypot(deltaX, deltaY);
        const double halfWidth = static_cast<double>(command.width) * 0.5;
        if (!(length > minimum_homogeneous_denominator)) {
            if (command.cap != LineCap::round) {
                return GeometryOutcome::skipped;
            }
            return drawCircle(
                {
                    static_cast<float>(start.x - halfWidth),
                    static_cast<float>(start.y - halfWidth),
                    command.width,
                    command.width
                },
                command.header,
                command.color,
                mapper
            );
        }

        const double directionX = deltaX / length;
        const double directionY = deltaY / length;
        if (command.cap == LineCap::square) {
            start.x -= directionX * halfWidth;
            start.y -= directionY * halfWidth;
            end.x += directionX * halfWidth;
            end.y += directionY * halfWidth;
        }
        const double normalX = -directionY * halfWidth;
        const double normalY = directionX * halfWidth;
        const std::array<PointD, 4> quad{
            PointD{start.x + normalX, start.y + normalY},
            PointD{end.x + normalX, end.y + normalY},
            PointD{end.x - normalX, end.y - normalY},
            PointD{start.x - normalX, start.y - normalY}
        };
        const GeometryOutcome body = drawVertices(
            quad,
            GL_TRIANGLE_FAN,
            command.header,
            command.color,
            mapper
        );
        if (command.cap != LineCap::round) {
            return body;
        }

        const RectF startCap{
            static_cast<float>(start.x - halfWidth),
            static_cast<float>(start.y - halfWidth),
            command.width,
            command.width
        };
        const RectF endCap{
            static_cast<float>(end.x - halfWidth),
            static_cast<float>(end.y - halfWidth),
            command.width,
            command.width
        };
        const GeometryOutcome firstCap = drawCircle(
            startCap,
            command.header,
            command.color,
            mapper
        );
        const GeometryOutcome secondCap = drawCircle(
            endCap,
            command.header,
            command.color,
            mapper
        );
        return body == GeometryOutcome::drawn
                || firstCap == GeometryOutcome::drawn
                || secondCap == GeometryOutcome::drawn
            ? GeometryOutcome::drawn
            : GeometryOutcome::skipped;
    }

    [[nodiscard]] bool renderFrame(
        const FramePacket& frame,
        const std::int32_t outputWidth,
        const std::int32_t outputHeight,
        GlesRenderStats& stats
    ) noexcept {
        clearOperation();
        const CoordinateMapper mapper(frame.viewport(), outputWidth, outputHeight);
        if (!mapper.isValid()) {
            fail(GlesRenderError::invalidViewport, "OpenGL ES viewport mapping is invalid");
            return false;
        }

        (void)drainErrors();
        gl.viewport(0, 0, outputWidth, outputHeight);
        const PremultipliedRgba clearColor = frame.metadata().clearColor;
        gl.clearColor(clearColor.red, clearColor.green, clearColor.blue, clearColor.alpha);
        gl.clear(GL_COLOR_BUFFER_BIT);

        const auto record = [&stats](
            const GeometryOutcome outcome,
            const bool placeholder,
            const bool supportedShape
        ) noexcept {
            detail::recordCommandOutcome(
                stats,
                outcome,
                placeholder,
                supportedShape
            );
        };

        for (const CommandRef reference : frame.commandStream()) {
            const std::size_t index = static_cast<std::size_t>(reference.index);
            switch (reference.kind) {
            case CommandKind::sprite: {
                const SpriteCommand& command = frame.sprites()[index];
                record(
                    drawRectangle(
                        command.destination,
                        command.header,
                        visibleColorOr(
                            command.tint,
                            PremultipliedRgba::fromStraight(
                                0.92F,
                                0.24F,
                                0.92F,
                                0.82F
                            )
                        ),
                        mapper,
                        command.rotationRadians,
                        command.pivot
                    ),
                    true,
                    false
                );
                break;
            }
            case CommandKind::shape: {
                const ShapeCommand& command = frame.shapes()[index];
                if (command.fillEnabled == 0U && command.strokeEnabled == 0U) {
                    ++stats.noOpCommands;
                    break;
                }
                const bool supported = command.shape == ShapeType::rectangle
                    || command.shape == ShapeType::roundedRectangle
                    || command.shape == ShapeType::circle;
                const PremultipliedRgba selectedColor = command.fillEnabled != 0U
                    ? command.fill
                    : command.stroke;
                const PremultipliedRgba color = visibleColorOr(
                    selectedColor,
                    PremultipliedRgba::fromStraight(0.2F, 0.78F, 0.96F, 0.82F)
                );
                GeometryOutcome outcome = GeometryOutcome::skipped;
                switch (command.shape) {
                case ShapeType::rectangle:
                    outcome = drawRectangle(
                        command.bounds,
                        command.header,
                        color,
                        mapper,
                        command.rotationRadians
                    );
                    break;
                case ShapeType::roundedRectangle:
                    outcome = drawRoundedRectangle(
                        command.bounds,
                        command.cornerRadius,
                        command.header,
                        color,
                        mapper,
                        command.rotationRadians
                    );
                    break;
                case ShapeType::circle:
                    outcome = drawCircle(
                        command.bounds,
                        command.header,
                        color,
                        mapper,
                        command.rotationRadians
                    );
                    break;
                case ShapeType::triangle:
                case ShapeType::pentagon:
                case ShapeType::hexagon:
                case ShapeType::octagon:
                case ShapeType::arrow:
                    outcome = drawRectangle(
                        command.bounds,
                        command.header,
                        color,
                        mapper,
                        command.rotationRadians
                    );
                    break;
                }
                record(
                    outcome,
                    !supported,
                    supported
                );
                break;
            }
            case CommandKind::line: {
                const LineCommand& command = frame.lines()[index];
                record(
                    drawLine(command, mapper),
                    false,
                    false
                );
                break;
            }
            case CommandKind::text: {
                const TextCommand& command = frame.textRuns()[index];
                const RectF bounds = textPlaceholderBounds(command);
                Vec2F pivot{0.5F, 0.5F};
                if (bounds.width > 0.0F && bounds.height > 0.0F) {
                    pivot.x = (command.origin.x - bounds.x) / bounds.width;
                    pivot.y = (command.origin.y - bounds.y) / bounds.height;
                }
                record(
                    drawRectangle(
                        bounds,
                        command.header,
                        command.color,
                        mapper,
                        command.rotationRadians,
                        pivot
                    ),
                    true,
                    false
                );
                break;
            }
            case CommandKind::effect: {
                const EffectCommand& command = frame.effects()[index];
                record(
                    drawRectangle(
                        command.bounds,
                        command.header,
                        visibleColorOr(
                            command.primaryColor,
                            PremultipliedRgba::fromStraight(
                                0.32F,
                                0.68F,
                                1.0F,
                                0.45F
                            )
                        ),
                        mapper
                    ),
                    true,
                    false
                );
                break;
            }
            case CommandKind::ui: {
                const UiCommand& command = frame.ui()[index];
                detail::dispatchUiPlaceholder(
                    command,
                    stats,
                    [this, &command, &mapper](
                        const PremultipliedRgba color
                    ) noexcept {
                        return drawRectangle(
                            command.bounds,
                            command.header,
                            color,
                            mapper
                        );
                    }
                );
                break;
            }
            case CommandKind::overlay: {
                const OverlayCommand& command = frame.overlays()[index];
                switch (command.operation) {
                case OverlayOperation::beginSession:
                case OverlayOperation::captureBackdrop:
                case OverlayOperation::endSession:
                    record(
                        GeometryOutcome::skipped,
                        legacyOverlayControlNeedsPlaceholder(command.operation),
                        false
                    );
                    break;
                case OverlayOperation::dim: {
                    RectF destination = command.destinationBounds;
                    if (!(destination.width > 0.0F) || !(destination.height > 0.0F)) {
                        destination = frame.viewport().logicalUi.contentRect;
                    }
                    record(
                        drawRectangle(
                            destination,
                            command.header,
                            withOpacity(command.tintColor, command.opacity),
                            mapper
                        ),
                        true,
                        false
                    );
                    break;
                }
                case OverlayOperation::glassPanel:
                    record(
                        drawRectangle(
                            command.destinationBounds,
                            command.header,
                            withOpacity(
                                visibleColorOr(
                                    command.tintColor,
                                    PremultipliedRgba::fromStraight(
                                        0.12F,
                                        0.2F,
                                        0.34F,
                                        0.72F
                                    )
                                ),
                                command.opacity
                            ),
                            mapper
                        ),
                        true,
                        false
                    );
                    break;
                }
                break;
            }
            case CommandKind::glyphRun: {
                const GlyphRunCommand& command = frame.glyphRuns()[index];
                record(
                    drawRectangle(
                        {
                            command.origin.x,
                            command.origin.y - command.pixelsPerEm,
                            command.pixelsPerEm * 0.62F
                                * static_cast<float>(command.glyphs.count),
                            command.pixelsPerEm
                        },
                        command.header,
                        visibleColorOr(
                            command.color,
                            PremultipliedRgba::fromStraight(0.82F, 0.36F, 1.0F, 0.78F)
                        ),
                        mapper
                    ),
                    true,
                    false
                );
                break;
            }
            case CommandKind::texturedMesh: {
                const TexturedMeshCommand& command = frame.texturedMeshes()[index];
                record(
                    drawRectangle(
                        meshPlaceholderBounds(frame, command),
                        command.header,
                        visibleColorOr(
                            command.tint,
                            PremultipliedRgba::fromStraight(0.94F, 0.32F, 0.84F, 0.78F)
                        ),
                        mapper
                    ),
                    true,
                    false
                );
                break;
            }
            case CommandKind::gradient: {
                const GradientCommand& command = frame.gradients()[index];
                const GradientStop& stop = frame.gradientStops()[command.stops.offset];
                record(
                    drawRectangle(
                        command.bounds,
                        command.header,
                        visibleColorOr(
                            stop.color,
                            PremultipliedRgba::fromStraight(0.22F, 0.72F, 0.96F, 0.72F)
                        ),
                        mapper
                    ),
                    true,
                    false
                );
                break;
            }
            case CommandKind::clip: {
                const ClipCommand& command = frame.clips()[index];
                const RectF bounds = command.operation == ClipOperation::pop
                    ? v2MarkerBounds(frame.viewport(), index)
                    : command.bounds;
                record(
                    drawRectangle(
                        bounds,
                        command.header,
                        PremultipliedRgba::fromStraight(0.96F, 0.62F, 0.12F, 0.72F),
                        mapper
                    ),
                    true,
                    false
                );
                break;
            }
            case CommandKind::pass: {
                const PassCommand& command = frame.passes()[index];
                RectF bounds = command.destinationBounds;
                if (!(bounds.width > 0.0F) || !(bounds.height > 0.0F)) {
                    bounds = command.sourceBounds;
                }
                if (!(bounds.width > 0.0F) || !(bounds.height > 0.0F)) {
                    bounds = v2MarkerBounds(frame.viewport(), command.sessionId);
                }
                record(
                    drawRectangle(
                        bounds,
                        command.header,
                        visibleColorOr(
                            command.tintColor,
                            PremultipliedRgba::fromStraight(0.32F, 0.72F, 1.0F, 0.72F)
                        ),
                        mapper
                    ),
                    true,
                    false
                );
                break;
            }
            }
        }

        const GLenum renderError = drainErrors();
        if (renderError != GL_NO_ERROR) {
            failWithGl(
                renderError == gl_context_lost
                    ? GlesRenderError::contextLost
                    : GlesRenderError::graphicsApiError,
                "OpenGL ES frame submission failed",
                renderError
            );
            return false;
        }
        if (!SDL_GL_SwapWindow(window)) {
            failWithSdl(GlesRenderError::swapFailed, "OpenGL ES window swap failed");
            return false;
        }
        const GLenum swapError = drainErrors();
        if (swapError != GL_NO_ERROR) {
            failWithGl(
                swapError == gl_context_lost
                    ? GlesRenderError::contextLost
                    : GlesRenderError::graphicsApiError,
                "OpenGL ES post-swap check failed",
                swapError
            );
            return false;
        }
        stats.framePresented = true;
        clearOperation();
        return true;
    }

    SDL_Window* window = nullptr;
    SDL_GLContext context = nullptr;
    GlFunctions gl;
    GLuint program = 0U;
    GLuint vertexBuffer = 0U;
    GLint colorUniform = -1;
    GlesContextVersion version = GlesContextVersion::none;
    int configuredSwapInterval = 0;
    int drawableWidth = 0;
    int drawableHeight = 0;
    int maximumTextureSize = 0;
    int maximumSampleCount = 1;
    std::array<char, 256> rendererName{};
    std::size_t rendererNameLength = 0U;
    std::array<char, 256> swapWarning{};
    std::size_t swapWarningLength = 0U;
    GlesRenderError operationError = GlesRenderError::none;
    std::array<char, 768> operationDiagnostic{};
    std::size_t operationDiagnosticLength = 0U;
};

GlesBackend::GlesBackend(
    SDL_Window* const externalWindow,
    const GlesContextVersion requestedVersion
) noexcept
    : window_(externalWindow),
      requestedVersion_(requestedVersion == GlesContextVersion::es2
          ? GlesContextVersion::es2
          : GlesContextVersion::es3) {}

GlesBackend::~GlesBackend() noexcept {
    shutdown();
}

backend::RenderBackendKind GlesBackend::kind() const noexcept {
    return backend::RenderBackendKind::gles;
}

const backend::RenderCapabilities& GlesBackend::capabilities() const noexcept {
    return capabilities_;
}

backend::BackendInitializeResult GlesBackend::initialize() {
    if (implementation_ != nullptr) {
        setDiagnostic(
            GlesRenderError::alreadyInitialized,
            "OpenGL ES backend is already initialized"
        );
        return backend::BackendInitializeResult::failure(std::string(lastDiagnostic()));
    }
    if (window_ == nullptr) {
        setDiagnostic(GlesRenderError::invalidWindow, "OpenGL ES requires a non-null SDL window");
        return backend::BackendInitializeResult::failure(std::string(lastDiagnostic()));
    }
    const char* const videoDriver = SDL_GetCurrentVideoDriver();
    if (videoDriver == nullptr) {
        setDiagnostic(
            GlesRenderError::invalidWindow,
            "SDL video subsystem is not initialized for OpenGL ES"
        );
        return backend::BackendInitializeResult::failure(std::string(lastDiagnostic()));
    }
    if (std::strcmp(videoDriver, "dummy") == 0
        || std::strcmp(videoDriver, "offscreen") == 0) {
        setDiagnostic(
            GlesRenderError::unsupportedVideoDriver,
            std::strcmp(videoDriver, "dummy") == 0
                ? "SDL dummy video driver is unsupported by the GLES backend; select the Software backend"
                : "SDL offscreen video driver is unsupported by the production GLES backend; use an actual platform video driver"
        );
        return backend::BackendInitializeResult::failure(std::string(lastDiagnostic()));
    }
    if ((SDL_GetWindowFlags(window_) & SDL_WINDOW_OPENGL) == 0U) {
        setDiagnostic(
            GlesRenderError::windowMissingOpenGlFlag,
            "SDL window was not created with SDL_WINDOW_OPENGL; the renderer factory must choose this flag before window creation"
        );
        return backend::BackendInitializeResult::failure(std::string(lastDiagnostic()));
    }

    es3FailureLength_ = 0U;
    es2FailureLength_ = 0U;
    es3Failure_[0] = '\0';
    es2Failure_[0] = '\0';
    try {
        if (tryInitialize(requestedVersion_)) {
            return backend::BackendInitializeResult::success();
        }
        captureAttemptFailure(requestedVersion_);
        resetImplementation();
        return backend::BackendInitializeResult::failure(std::string(lastDiagnostic()));
    } catch (...) {
        resetImplementation();
        throw;
    }
}

void GlesBackend::shutdown() noexcept {
    resetImplementation();
    capabilities_ = {};
    es3FailureLength_ = 0U;
    es2FailureLength_ = 0U;
    es3Failure_[0] = '\0';
    es2Failure_[0] = '\0';
    lastStats_ = {};
    clearDiagnostic();
}

bool GlesBackend::resize(
    const std::int32_t drawableWidth,
    const std::int32_t drawableHeight
) noexcept {
    if (implementation_ == nullptr) {
        setDiagnostic(GlesRenderError::notInitialized, "OpenGL ES backend is not initialized");
        return false;
    }
    if (!drawableDimensionsAreValid(drawableWidth, drawableHeight)) {
        setDiagnostic(GlesRenderError::invalidDrawableSize, "OpenGL ES drawable size is invalid");
        return false;
    }
    if (!ensureCurrent()) {
        return false;
    }

    (void)implementation_->drainErrors();
    implementation_->gl.viewport(0, 0, drawableWidth, drawableHeight);
    const GLenum error = implementation_->drainErrors();
    if (error != GL_NO_ERROR) {
        implementation_->failWithGl(
            error == gl_context_lost
                ? GlesRenderError::contextLost
                : GlesRenderError::graphicsApiError,
            "OpenGL ES resize failed",
            error
        );
        setDiagnostic(implementation_->operationError, implementation_->operationMessage());
        return false;
    }
    drawableWidth_ = drawableWidth;
    drawableHeight_ = drawableHeight;
    clearDiagnostic();
    return true;
}

bool GlesBackend::render(
    const FramePacket& frame,
    const RenderResourcesView
) noexcept {
    lastStats_ = {};
    lastStats_.submittedCommands = static_cast<std::uint64_t>(frame.commandStream().size());
    if (implementation_ == nullptr) {
        setDiagnostic(GlesRenderError::notInitialized, "OpenGL ES backend is not initialized");
        return false;
    }
    if (backgrounded_) {
        lastStats_.skippedCommands = lastStats_.submittedCommands;
        lastStats_.backgroundSkipped = true;
        setDiagnostic(GlesRenderError::none, "OpenGL ES frame was skipped while backgrounded");
        return true;
    }
    if (!frame.isRenderOrderValid()) {
        setDiagnostic(GlesRenderError::invalidFramePacket, "OpenGL ES rejected an invalid FramePacket");
        return false;
    }
    if (!ensureCurrent()) {
        return false;
    }
    if (!drawableDimensionsAreValid(drawableWidth_, drawableHeight_)
        && !refreshDrawableSize()) {
        return false;
    }

    if (!implementation_->renderFrame(
            frame,
            drawableWidth_,
            drawableHeight_,
            lastStats_
        )) {
        setDiagnostic(implementation_->operationError, implementation_->operationMessage());
        return false;
    }
    clearDiagnostic();
    return true;
}

bool GlesBackend::onBackground() noexcept {
    if (implementation_ == nullptr) {
        setDiagnostic(GlesRenderError::notInitialized, "OpenGL ES backend is not initialized");
        return false;
    }
    backgrounded_ = true;
    clearDiagnostic();
    return true;
}

bool GlesBackend::onForeground() noexcept {
    if (implementation_ == nullptr) {
        setDiagnostic(GlesRenderError::notInitialized, "OpenGL ES backend is not initialized");
        return false;
    }
    backgrounded_ = false;
    if (!ensureCurrent() || !refreshDrawableSize()) {
        return false;
    }
    return resize(drawableWidth_, drawableHeight_);
}

bool GlesBackend::purgeTransientResources() noexcept {
    if (implementation_ == nullptr) {
        setDiagnostic(GlesRenderError::notInitialized, "OpenGL ES backend is not initialized");
        return false;
    }
    // 이 skeleton은 per-frame transient GL object를 만들지 않는다.
    clearDiagnostic();
    return true;
}

GlesContextVersion GlesBackend::contextVersion() const noexcept {
    return contextVersion_;
}

GlesContextVersion GlesBackend::requestedContextVersion() const noexcept {
    return requestedVersion_;
}

int GlesBackend::swapInterval() const noexcept {
    return swapInterval_;
}

GlesRenderError GlesBackend::lastError() const noexcept {
    return lastError_;
}

std::string_view GlesBackend::lastDiagnostic() const noexcept {
    return {diagnostic_.data(), diagnosticLength_};
}

std::string_view GlesBackend::es3FailureReason() const noexcept {
    return {es3Failure_.data(), es3FailureLength_};
}

std::string_view GlesBackend::es2FailureReason() const noexcept {
    return {es2Failure_.data(), es2FailureLength_};
}

const GlesRenderStats& GlesBackend::lastStats() const noexcept {
    return lastStats_;
}

void GlesBackend::clearDiagnostic() noexcept {
    lastError_ = GlesRenderError::none;
    diagnosticLength_ = 0U;
    diagnostic_[0] = '\0';
}

void GlesBackend::setDiagnostic(
    const GlesRenderError error,
    const std::string_view text
) noexcept {
    lastError_ = error;
    diagnosticLength_ = copyText(diagnostic_, text);
}

void GlesBackend::captureAttemptFailure(const GlesContextVersion version) noexcept {
    if (version == GlesContextVersion::es3) {
        es3FailureLength_ = copyText(es3Failure_, lastDiagnostic());
    } else {
        es2FailureLength_ = copyText(es2Failure_, lastDiagnostic());
    }
}

void GlesBackend::resetImplementation() noexcept {
    implementation_.reset();
    contextVersion_ = GlesContextVersion::none;
    swapInterval_ = 0;
    drawableWidth_ = 0;
    drawableHeight_ = 0;
    backgrounded_ = false;
}

bool GlesBackend::tryInitialize(const GlesContextVersion requestedVersion) {
    auto candidate = std::make_unique<Impl>(window_);
    if (!candidate->initialize(requestedVersion)) {
        setDiagnostic(candidate->operationError, candidate->operationMessage());
        return false;
    }

    backend::RenderCapabilities candidateCapabilities;
    candidateCapabilities.hardwareAccelerated = true;
    candidateCapabilities.supportsFloatRenderTarget = false;
    candidateCapabilities.supportsTimestampQuery = false;
    candidateCapabilities.supportsAnisotropicFiltering = false;
    candidateCapabilities.maximumTextureSize = candidate->maximumTextureSize;
    candidateCapabilities.maximumSampleCount = candidate->maximumSampleCount;
    candidateCapabilities.backendName = candidate->version == GlesContextVersion::es3
        ? "OpenGL ES 3"
        : "OpenGL ES 2";
    candidateCapabilities.adapterName = candidate->rendererNameLength > 0U
        ? std::string(candidate->rendererName.data(), candidate->rendererNameLength)
        : std::string("Unknown OpenGL ES renderer");

    contextVersion_ = candidate->version;
    swapInterval_ = candidate->configuredSwapInterval;
    drawableWidth_ = candidate->drawableWidth;
    drawableHeight_ = candidate->drawableHeight;
    capabilities_ = std::move(candidateCapabilities);
    if (candidate->swapWarningLength > 0U) {
        setDiagnostic(
            GlesRenderError::none,
            std::string_view(candidate->swapWarning.data(), candidate->swapWarningLength)
        );
    } else {
        clearDiagnostic();
    }
    implementation_ = std::move(candidate);
    return true;
}

bool GlesBackend::ensureCurrent() noexcept {
    if (implementation_ == nullptr) {
        setDiagnostic(GlesRenderError::notInitialized, "OpenGL ES backend is not initialized");
        return false;
    }
    implementation_->clearOperation();
    if (!implementation_->makeCurrent()) {
        setDiagnostic(implementation_->operationError, implementation_->operationMessage());
        return false;
    }
    return true;
}

bool GlesBackend::refreshDrawableSize() noexcept {
    if (window_ == nullptr) {
        setDiagnostic(GlesRenderError::invalidWindow, "OpenGL ES window is null");
        return false;
    }
    int width = 0;
    int height = 0;
    if (!SDL_GetWindowSizeInPixels(window_, &width, &height)
        || !drawableDimensionsAreValid(width, height)) {
        const char* const error = safeSdlError();
        diagnosticLength_ = formatText(
            diagnostic_,
            "%s: %s",
            "OpenGL ES drawable size query failed",
            error
        );
        lastError_ = GlesRenderError::invalidDrawableSize;
        return false;
    }
    drawableWidth_ = width;
    drawableHeight_ = height;
    clearDiagnostic();
    return true;
}

} // namespace cirvivor::render::gles
