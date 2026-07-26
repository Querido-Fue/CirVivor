#include "render/sdl_gpu/sdl_gpu_backend.h"

#include "render/common/frame_packet.h"
#include "render/sdl_gpu/sdl_gpu_geometry.h"

#include "render/sdl_gpu/shaders/generated/solid_2d.frag.dxil.h"
#include "render/sdl_gpu/shaders/generated/solid_2d.frag.msl.h"
#include "render/sdl_gpu/shaders/generated/solid_2d.frag.spv.h"
#include "render/sdl_gpu/shaders/generated/solid_2d.vert.dxil.h"
#include "render/sdl_gpu/shaders/generated/solid_2d.vert.msl.h"
#include "render/sdl_gpu/shaders/generated/solid_2d.vert.spv.h"

#include <SDL3/SDL.h>

#include <algorithm>
#include <array>
#include <climits>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>
#include <memory>
#include <string>
#include <string_view>
#include <utility>

namespace cirvivor::render::sdl_gpu {

namespace detail {

struct SdlGpuDrawState final {
    SdlGpuDrawState(
        const std::size_t maximumVertices,
        const std::size_t maximumBatches
    ) : geometry(maximumVertices, maximumBatches) {}

    FrameGeometry geometry;
    std::array<SDL_GPUGraphicsPipeline*, 3> pipelines{};
    SDL_GPUBuffer* vertexBuffer = nullptr;
    SDL_GPUTransferBuffer* transferBuffer = nullptr;
    std::uint32_t vertexBufferSize = 0;
};

} // namespace detail

namespace {

constexpr std::int32_t guaranteedMinimumTextureDimension = 4'096;

struct ShaderAsset final {
    const std::uint8_t* code = nullptr;
    std::size_t size = 0;
    const char* entrypoint = "main";
    SDL_GPUShaderFormat format = SDL_GPU_SHADERFORMAT_INVALID;
};

struct ShaderPair final {
    ShaderAsset vertex;
    ShaderAsset fragment;
};

[[nodiscard]] ShaderPair selectShaderPair(
    const SDL_GPUShaderFormat formats
) noexcept {
    if ((formats & SDL_GPU_SHADERFORMAT_SPIRV) != 0U) {
        return {
            {
                tri_color_vert_spv,
                static_cast<std::size_t>(tri_color_vert_spv_len),
                "main",
                SDL_GPU_SHADERFORMAT_SPIRV
            },
            {
                color_frag_spv,
                static_cast<std::size_t>(color_frag_spv_len),
                "main",
                SDL_GPU_SHADERFORMAT_SPIRV
            }
        };
    }
    if ((formats & SDL_GPU_SHADERFORMAT_DXIL) != 0U) {
        return {
            {
                tri_color_vert_dxil,
                static_cast<std::size_t>(tri_color_vert_dxil_len),
                "main",
                SDL_GPU_SHADERFORMAT_DXIL
            },
            {
                color_frag_dxil,
                static_cast<std::size_t>(color_frag_dxil_len),
                "main",
                SDL_GPU_SHADERFORMAT_DXIL
            }
        };
    }
    if ((formats & SDL_GPU_SHADERFORMAT_MSL) != 0U) {
        return {
            {
                tri_color_vert_msl,
                static_cast<std::size_t>(tri_color_vert_msl_len),
                "main0",
                SDL_GPU_SHADERFORMAT_MSL
            },
            {
                color_frag_msl,
                static_cast<std::size_t>(color_frag_msl_len),
                "main0",
                SDL_GPU_SHADERFORMAT_MSL
            }
        };
    }
    return {};
}

[[nodiscard]] constexpr std::size_t blendPipelineIndex(
    const BlendMode blendMode
) noexcept {
    return static_cast<std::size_t>(blendMode);
}

static_assert(blendPipelineIndex(BlendMode::opaque) == 0U);
static_assert(blendPipelineIndex(BlendMode::premultipliedAlpha) == 1U);
static_assert(blendPipelineIndex(BlendMode::additivePremultiplied) == 2U);

[[nodiscard]] SDL_GPUColorTargetBlendState makeBlendState(
    const BlendMode blendMode
) noexcept {
    SDL_GPUColorTargetBlendState state{};
    state.src_color_blendfactor = SDL_GPU_BLENDFACTOR_ONE;
    state.color_blend_op = SDL_GPU_BLENDOP_ADD;
    state.src_alpha_blendfactor = SDL_GPU_BLENDFACTOR_ONE;
    state.alpha_blend_op = SDL_GPU_BLENDOP_ADD;
    switch (blendMode) {
    case BlendMode::opaque:
        state.dst_color_blendfactor = SDL_GPU_BLENDFACTOR_ZERO;
        state.dst_alpha_blendfactor = SDL_GPU_BLENDFACTOR_ZERO;
        state.enable_blend = false;
        break;
    case BlendMode::premultipliedAlpha:
        state.dst_color_blendfactor = SDL_GPU_BLENDFACTOR_ONE_MINUS_SRC_ALPHA;
        state.dst_alpha_blendfactor = SDL_GPU_BLENDFACTOR_ONE_MINUS_SRC_ALPHA;
        state.enable_blend = true;
        break;
    case BlendMode::additivePremultiplied:
        state.dst_color_blendfactor = SDL_GPU_BLENDFACTOR_ONE;
        state.dst_alpha_blendfactor = SDL_GPU_BLENDFACTOR_ONE;
        state.enable_blend = true;
        break;
    }
    return state;
}

[[nodiscard]] char asciiLower(const char value) noexcept {
    return value >= 'A' && value <= 'Z'
        ? static_cast<char>(value + ('a' - 'A'))
        : value;
}

[[nodiscard]] bool containsCaseInsensitive(
    const std::string_view text,
    const std::string_view needle
) noexcept {
    if (needle.empty() || needle.size() > text.size()) {
        return false;
    }
    for (std::size_t offset = 0; offset <= text.size() - needle.size(); ++offset) {
        bool matches = true;
        for (std::size_t index = 0; index < needle.size(); ++index) {
            if (asciiLower(text[offset + index]) != asciiLower(needle[index])) {
                matches = false;
                break;
            }
        }
        if (matches) {
            return true;
        }
    }
    return false;
}

[[nodiscard]] bool describesDeviceLoss(const std::string_view message) noexcept {
    constexpr std::array<std::string_view, 5> deviceLossMarkers{
        "device lost",
        "device removed",
        "device reset",
        "VK_ERROR_DEVICE_LOST",
        "DXGI_ERROR_DEVICE_REMOVED"
    };
    return std::any_of(
        deviceLossMarkers.begin(),
        deviceLossMarkers.end(),
        [message](const std::string_view marker) noexcept {
            return containsCaseInsensitive(message, marker);
        }
    );
}

[[nodiscard]] std::int32_t maximumSampleCount(
    SDL_GPUDevice* const device,
    const SDL_GPUTextureFormat format
) noexcept {
    if (SDL_GPUTextureSupportsSampleCount(device, format, SDL_GPU_SAMPLECOUNT_8)) {
        return 8;
    }
    if (SDL_GPUTextureSupportsSampleCount(device, format, SDL_GPU_SAMPLECOUNT_4)) {
        return 4;
    }
    if (SDL_GPUTextureSupportsSampleCount(device, format, SDL_GPU_SAMPLECOUNT_2)) {
        return 2;
    }
    return 1;
}

} // namespace

SdlGpuBackend::SdlGpuBackend(
    SDL_Window* const window,
    const SdlGpuBackendOptions options
) noexcept
    : window_(window), options_(options) {}

SdlGpuBackend::~SdlGpuBackend() noexcept {
    shutdown();
}

backend::RenderBackendKind SdlGpuBackend::kind() const noexcept {
    return backend::RenderBackendKind::sdlGpu;
}

const backend::RenderCapabilities& SdlGpuBackend::capabilities() const noexcept {
    return capabilities_;
}

backend::BackendInitializeResult SdlGpuBackend::initialize() {
    if (device_ != nullptr || windowClaimed_) {
        setError(SdlGpuError::alreadyInitialized, sdlGpuErrorName(SdlGpuError::alreadyInitialized));
        return backend::BackendInitializeResult::failure(std::string(lastErrorMessage()));
    }

    capabilities_ = {};
    diagnostics_ = {};
    backgrounded_ = false;
    deviceLost_ = false;
    clearError();

    const auto fail = [this]() {
        std::string reason(lastErrorMessage());
        releaseDevice();
        return backend::BackendInitializeResult::failure(std::move(reason));
    };

    if ((SDL_WasInit(SDL_INIT_VIDEO) & SDL_INIT_VIDEO) == 0U) {
        setError(
            SdlGpuError::videoSubsystemNotInitialized,
            sdlGpuErrorName(SdlGpuError::videoSubsystemNotInitialized)
        );
        return fail();
    }
    if (window_ == nullptr) {
        setError(SdlGpuError::nullWindow, sdlGpuErrorName(SdlGpuError::nullWindow));
        return fail();
    }
    if (SDL_GetWindowID(window_) == 0U) {
        setSdlError(SdlGpuError::invalidWindow);
        return fail();
    }

    int drawableWidth = 0;
    int drawableHeight = 0;
    if (!SDL_GetWindowSizeInPixels(window_, &drawableWidth, &drawableHeight)) {
        setSdlError(SdlGpuError::invalidWindow);
        return fail();
    }
    if (drawableWidth > 0 && drawableHeight > 0) {
        diagnostics_.drawableWidth = drawableWidth;
        diagnostics_.drawableHeight = drawableHeight;
    }
    if (options_.maximumVertices < 3U
        || options_.maximumDrawBatches == 0U
        || options_.maximumVertices
            > std::numeric_limits<std::uint32_t>::max() / sizeof(detail::SolidVertex)) {
        setError(
            SdlGpuError::invalidDrawCapacity,
            sdlGpuErrorName(SdlGpuError::invalidDrawCapacity)
        );
        return fail();
    }

    const SDL_PropertiesID properties = SDL_CreateProperties();
    if (properties == 0U) {
        setSdlError(SdlGpuError::propertiesCreationFailed);
        return fail();
    }

    const bool propertiesConfigured =
        SDL_SetBooleanProperty(
            properties,
            SDL_PROP_GPU_DEVICE_CREATE_DEBUGMODE_BOOLEAN,
            options_.debugMode
        )
        && SDL_SetBooleanProperty(
            properties,
            SDL_PROP_GPU_DEVICE_CREATE_PREFERLOWPOWER_BOOLEAN,
            options_.preferLowPower
        )
        && SDL_SetBooleanProperty(
            properties,
            SDL_PROP_GPU_DEVICE_CREATE_VERBOSE_BOOLEAN,
            options_.verboseDiagnostics
        )
        && SDL_SetBooleanProperty(
            properties,
            SDL_PROP_GPU_DEVICE_CREATE_FEATURE_CLIP_DISTANCE_BOOLEAN,
            options_.enableClipDistance
        )
        && SDL_SetBooleanProperty(
            properties,
            SDL_PROP_GPU_DEVICE_CREATE_FEATURE_DEPTH_CLAMPING_BOOLEAN,
            options_.enableDepthClamping
        )
        && SDL_SetBooleanProperty(
            properties,
            SDL_PROP_GPU_DEVICE_CREATE_FEATURE_INDIRECT_DRAW_FIRST_INSTANCE_BOOLEAN,
            options_.enableIndirectFirstInstance
        )
        && SDL_SetBooleanProperty(
            properties,
            SDL_PROP_GPU_DEVICE_CREATE_FEATURE_ANISOTROPY_BOOLEAN,
            options_.enableAnisotropy
        )
        && SDL_SetBooleanProperty(
            properties,
            SDL_PROP_GPU_DEVICE_CREATE_VULKAN_REQUIRE_HARDWARE_ACCELERATION_BOOLEAN,
            options_.requireVulkanHardwareAcceleration
        )
        && SDL_SetBooleanProperty(
            properties,
            SDL_PROP_GPU_DEVICE_CREATE_SHADERS_SPIRV_BOOLEAN,
            true
        )
        && SDL_SetBooleanProperty(
            properties,
            SDL_PROP_GPU_DEVICE_CREATE_SHADERS_DXBC_BOOLEAN,
            false
        )
        && SDL_SetBooleanProperty(
            properties,
            SDL_PROP_GPU_DEVICE_CREATE_SHADERS_DXIL_BOOLEAN,
            true
        )
        && SDL_SetBooleanProperty(
            properties,
            SDL_PROP_GPU_DEVICE_CREATE_SHADERS_MSL_BOOLEAN,
            true
        )
        && SDL_SetBooleanProperty(
            properties,
            SDL_PROP_GPU_DEVICE_CREATE_SHADERS_METALLIB_BOOLEAN,
            false
        );
    if (!propertiesConfigured) {
        setSdlError(SdlGpuError::propertiesConfigurationFailed);
        SDL_DestroyProperties(properties);
        return fail();
    }

    device_ = SDL_CreateGPUDeviceWithProperties(properties);
    SDL_DestroyProperties(properties);
    if (device_ == nullptr) {
        setSdlError(SdlGpuError::deviceCreationFailed);
        return fail();
    }

    const char* const driver = SDL_GetGPUDeviceDriver(device_);
    if (driver == nullptr || driver[0] == '\0') {
        setSdlError(SdlGpuError::deviceDriverQueryFailed);
        return fail();
    }

    const SDL_GPUShaderFormat shaderFormats = SDL_GetGPUShaderFormats(device_);
    if (shaderFormats == SDL_GPU_SHADERFORMAT_INVALID) {
        setSdlError(SdlGpuError::shaderFormatQueryFailed);
        return fail();
    }
    diagnostics_.shaderFormatMask = static_cast<std::uint32_t>(shaderFormats);

    if (!SDL_ClaimWindowForGPUDevice(device_, window_)) {
        setSdlError(SdlGpuError::windowClaimFailed);
        return fail();
    }
    windowClaimed_ = true;

    const SDL_GPUTextureFormat swapchainFormat =
        SDL_GetGPUSwapchainTextureFormat(device_, window_);
    if (swapchainFormat == SDL_GPU_TEXTUREFORMAT_INVALID) {
        setSdlError(SdlGpuError::swapchainFormatQueryFailed);
        return fail();
    }
    diagnostics_.swapchainTextureFormat = static_cast<std::uint32_t>(swapchainFormat);

    if (!initializeDrawResources(static_cast<std::uint32_t>(swapchainFormat))) {
        return fail();
    }

    capabilities_.hardwareAccelerated = true;
    capabilities_.supportsFloatRenderTarget = SDL_GPUTextureSupportsFormat(
        device_,
        SDL_GPU_TEXTUREFORMAT_R16G16B16A16_FLOAT,
        SDL_GPU_TEXTURETYPE_2D,
        SDL_GPU_TEXTUREUSAGE_COLOR_TARGET
    );
    capabilities_.supportsTimestampQuery = false;
    capabilities_.supportsAnisotropicFiltering = options_.enableAnisotropy;
    capabilities_.maximumTextureSize = guaranteedMinimumTextureDimension;
    capabilities_.maximumSampleCount = maximumSampleCount(device_, swapchainFormat);
    capabilities_.backendName = driver;

    const SDL_PropertiesID deviceProperties = SDL_GetGPUDeviceProperties(device_);
    if (deviceProperties != 0U) {
        capabilities_.adapterName = SDL_GetStringProperty(
            deviceProperties,
            SDL_PROP_GPU_DEVICE_NAME_STRING,
            "unknown GPU adapter"
        );
    } else {
        capabilities_.adapterName = "unknown GPU adapter";
    }

    clearError();
    return backend::BackendInitializeResult::success();
}

bool SdlGpuBackend::initializeDrawResources(const std::uint32_t swapchainFormat) {
    drawState_ = std::make_unique<detail::SdlGpuDrawState>(
        options_.maximumVertices,
        options_.maximumDrawBatches
    );

    const ShaderPair shaderAssets = selectShaderPair(
        static_cast<SDL_GPUShaderFormat>(diagnostics_.shaderFormatMask)
    );
    if (shaderAssets.vertex.code == nullptr || shaderAssets.fragment.code == nullptr) {
        setError(
            SdlGpuError::shaderAssetUnavailable,
            sdlGpuErrorName(SdlGpuError::shaderAssetUnavailable)
        );
        return false;
    }

    const auto createShader = [this](
        const ShaderAsset& asset,
        const SDL_GPUShaderStage stage
    ) noexcept {
        SDL_GPUShaderCreateInfo createInfo{};
        createInfo.code_size = asset.size;
        createInfo.code = asset.code;
        createInfo.entrypoint = asset.entrypoint;
        createInfo.format = asset.format;
        createInfo.stage = stage;
        createInfo.num_uniform_buffers = 1U;
        return SDL_CreateGPUShader(device_, &createInfo);
    };

    SDL_GPUShader* const vertexShader = createShader(
        shaderAssets.vertex,
        SDL_GPU_SHADERSTAGE_VERTEX
    );
    if (vertexShader == nullptr) {
        setSdlError(SdlGpuError::shaderCreationFailed);
        return false;
    }
    SDL_GPUShader* const fragmentShader = createShader(
        shaderAssets.fragment,
        SDL_GPU_SHADERSTAGE_FRAGMENT
    );
    if (fragmentShader == nullptr) {
        setSdlError(SdlGpuError::shaderCreationFailed);
        SDL_ReleaseGPUShader(device_, vertexShader);
        return false;
    }

    SDL_GPUVertexBufferDescription vertexBufferDescription{};
    vertexBufferDescription.slot = 0U;
    vertexBufferDescription.pitch = static_cast<Uint32>(sizeof(detail::SolidVertex));
    vertexBufferDescription.input_rate = SDL_GPU_VERTEXINPUTRATE_VERTEX;

    const std::array<SDL_GPUVertexAttribute, 2> vertexAttributes{
        SDL_GPUVertexAttribute{
            0U,
            0U,
            SDL_GPU_VERTEXELEMENTFORMAT_FLOAT2,
            static_cast<Uint32>(offsetof(detail::SolidVertex, x))
        },
        SDL_GPUVertexAttribute{
            1U,
            0U,
            SDL_GPU_VERTEXELEMENTFORMAT_FLOAT4,
            static_cast<Uint32>(offsetof(detail::SolidVertex, red))
        }
    };

    SDL_GPUColorTargetDescription colorTargetDescription{};
    colorTargetDescription.format = static_cast<SDL_GPUTextureFormat>(swapchainFormat);

    SDL_GPUGraphicsPipelineCreateInfo pipelineCreateInfo{};
    pipelineCreateInfo.vertex_shader = vertexShader;
    pipelineCreateInfo.fragment_shader = fragmentShader;
    pipelineCreateInfo.vertex_input_state.vertex_buffer_descriptions =
        &vertexBufferDescription;
    pipelineCreateInfo.vertex_input_state.num_vertex_buffers = 1U;
    pipelineCreateInfo.vertex_input_state.vertex_attributes = vertexAttributes.data();
    pipelineCreateInfo.vertex_input_state.num_vertex_attributes =
        static_cast<Uint32>(vertexAttributes.size());
    pipelineCreateInfo.primitive_type = SDL_GPU_PRIMITIVETYPE_TRIANGLELIST;
    pipelineCreateInfo.rasterizer_state.fill_mode = SDL_GPU_FILLMODE_FILL;
    pipelineCreateInfo.rasterizer_state.cull_mode = SDL_GPU_CULLMODE_NONE;
    pipelineCreateInfo.rasterizer_state.front_face = SDL_GPU_FRONTFACE_COUNTER_CLOCKWISE;
    pipelineCreateInfo.rasterizer_state.enable_depth_clip = true;
    pipelineCreateInfo.multisample_state.sample_count = SDL_GPU_SAMPLECOUNT_1;
    pipelineCreateInfo.target_info.color_target_descriptions = &colorTargetDescription;
    pipelineCreateInfo.target_info.num_color_targets = 1U;

    for (const BlendMode blendMode : {
            BlendMode::opaque,
            BlendMode::premultipliedAlpha,
            BlendMode::additivePremultiplied
        }) {
        colorTargetDescription.blend_state = makeBlendState(blendMode);
        SDL_GPUGraphicsPipeline*& pipeline =
            drawState_->pipelines[blendPipelineIndex(blendMode)];
        pipeline = SDL_CreateGPUGraphicsPipeline(device_, &pipelineCreateInfo);
        if (pipeline == nullptr) {
            setSdlError(SdlGpuError::pipelineCreationFailed);
            SDL_ReleaseGPUShader(device_, fragmentShader);
            SDL_ReleaseGPUShader(device_, vertexShader);
            return false;
        }
    }

    SDL_ReleaseGPUShader(device_, fragmentShader);
    SDL_ReleaseGPUShader(device_, vertexShader);

    const std::size_t vertexBufferSize = static_cast<std::size_t>(options_.maximumVertices)
        * sizeof(detail::SolidVertex);
    drawState_->vertexBufferSize = static_cast<std::uint32_t>(vertexBufferSize);

    SDL_GPUBufferCreateInfo vertexBufferCreateInfo{};
    vertexBufferCreateInfo.usage = SDL_GPU_BUFFERUSAGE_VERTEX;
    vertexBufferCreateInfo.size = drawState_->vertexBufferSize;
    drawState_->vertexBuffer = SDL_CreateGPUBuffer(device_, &vertexBufferCreateInfo);
    if (drawState_->vertexBuffer == nullptr) {
        setSdlError(SdlGpuError::vertexBufferCreationFailed);
        return false;
    }

    SDL_GPUTransferBufferCreateInfo transferBufferCreateInfo{};
    transferBufferCreateInfo.usage = SDL_GPU_TRANSFERBUFFERUSAGE_UPLOAD;
    transferBufferCreateInfo.size = drawState_->vertexBufferSize;
    drawState_->transferBuffer = SDL_CreateGPUTransferBuffer(
        device_,
        &transferBufferCreateInfo
    );
    if (drawState_->transferBuffer == nullptr) {
        setSdlError(SdlGpuError::transferBufferCreationFailed);
        return false;
    }
    return true;
}

void SdlGpuBackend::releaseDrawResources() noexcept {
    if (drawState_ == nullptr) {
        return;
    }
    if (device_ != nullptr) {
        if (drawState_->transferBuffer != nullptr) {
            SDL_ReleaseGPUTransferBuffer(device_, drawState_->transferBuffer);
            drawState_->transferBuffer = nullptr;
        }
        if (drawState_->vertexBuffer != nullptr) {
            SDL_ReleaseGPUBuffer(device_, drawState_->vertexBuffer);
            drawState_->vertexBuffer = nullptr;
        }
        for (SDL_GPUGraphicsPipeline*& pipeline : drawState_->pipelines) {
            if (pipeline != nullptr) {
                SDL_ReleaseGPUGraphicsPipeline(device_, pipeline);
                pipeline = nullptr;
            }
        }
    }
    drawState_.reset();
}

void SdlGpuBackend::shutdown() noexcept {
    releaseDevice();
    backgrounded_ = false;
    capabilities_ = {};
}

bool SdlGpuBackend::resize(
    const std::int32_t drawableWidth,
    const std::int32_t drawableHeight
) noexcept {
    if (!requireReady()) {
        return false;
    }
    if (drawableWidth <= 0 || drawableHeight <= 0) {
        setError(SdlGpuError::invalidDimensions, sdlGpuErrorName(SdlGpuError::invalidDimensions));
        return false;
    }
    diagnostics_.drawableWidth = drawableWidth;
    diagnostics_.drawableHeight = drawableHeight;
    clearError();
    return true;
}

bool SdlGpuBackend::render(const FramePacket& frame) noexcept {
    if (!requireReady()) {
        return false;
    }
    if (!frame.isRenderOrderValid()) {
        setError(
            SdlGpuError::invalidFramePacket,
            sdlGpuErrorName(SdlGpuError::invalidFramePacket)
        );
        return false;
    }
    if (backgrounded_) {
        ++diagnostics_.skippedFrames;
        clearError();
        return true;
    }

    const detail::GeometryBuildResult geometryResult = detail::buildFrameGeometry(
        frame,
        drawState_->geometry
    );
    diagnostics_.lastRenderedCommands = geometryResult.stats.renderedCommands;
    diagnostics_.lastPlaceholderCommands = geometryResult.stats.placeholderCommands;
    diagnostics_.lastGeneratedVertices = geometryResult.stats.generatedVertices;
    diagnostics_.lastDrawCalls = 0;
    if (geometryResult.error != detail::GeometryBuildError::none) {
        setError(
            SdlGpuError::geometryBuildFailed,
            sdlGpuErrorName(SdlGpuError::geometryBuildFailed)
        );
        return false;
    }

    const std::size_t uploadSize = drawState_->geometry.vertices().size()
        * sizeof(detail::SolidVertex);
    if (uploadSize > drawState_->vertexBufferSize) {
        setError(
            SdlGpuError::geometryBuildFailed,
            sdlGpuErrorName(SdlGpuError::geometryBuildFailed)
        );
        return false;
    }
    if (uploadSize > 0U) {
        void* const mapped = SDL_MapGPUTransferBuffer(
            device_,
            drawState_->transferBuffer,
            true
        );
        if (mapped == nullptr) {
            setSdlError(SdlGpuError::transferBufferMapFailed);
            return false;
        }
        std::memcpy(mapped, drawState_->geometry.vertices().data(), uploadSize);
        SDL_UnmapGPUTransferBuffer(device_, drawState_->transferBuffer);
    }

    SDL_GPUCommandBuffer* const commandBuffer = SDL_AcquireGPUCommandBuffer(device_);
    if (commandBuffer == nullptr) {
        setSdlError(SdlGpuError::commandBufferAcquireFailed);
        return false;
    }

    if (uploadSize > 0U) {
        SDL_GPUCopyPass* const copyPass = SDL_BeginGPUCopyPass(commandBuffer);
        if (copyPass == nullptr) {
            setSdlError(SdlGpuError::copyPassBeginFailed);
            const SdlGpuError primaryError = lastError_;
            const std::array<char, error_message_capacity> primaryMessage = lastErrorMessage_;
            const std::size_t primaryMessageSize = lastErrorMessageSize_;
            const bool canceled = cancelCommandBuffer(commandBuffer);
            if (primaryError == SdlGpuError::deviceLost || canceled) {
                lastError_ = primaryError;
                lastErrorMessage_ = primaryMessage;
                lastErrorMessageSize_ = primaryMessageSize;
            }
            return false;
        }

        const SDL_GPUTransferBufferLocation source{
            drawState_->transferBuffer,
            0U
        };
        const SDL_GPUBufferRegion destination{
            drawState_->vertexBuffer,
            0U,
            static_cast<Uint32>(uploadSize)
        };
        SDL_UploadToGPUBuffer(copyPass, &source, &destination, true);
        SDL_EndGPUCopyPass(copyPass);

        constexpr std::array<float, 16> identityMatrix{
            1.0F, 0.0F, 0.0F, 0.0F,
            0.0F, 1.0F, 0.0F, 0.0F,
            0.0F, 0.0F, 1.0F, 0.0F,
            0.0F, 0.0F, 0.0F, 1.0F
        };
        constexpr float colorScale = 1.0F;
        SDL_PushGPUVertexUniformData(
            commandBuffer,
            0U,
            identityMatrix.data(),
            static_cast<Uint32>(sizeof(identityMatrix))
        );
        SDL_PushGPUFragmentUniformData(
            commandBuffer,
            0U,
            &colorScale,
            static_cast<Uint32>(sizeof(colorScale))
        );
    }

    SDL_GPUTexture* swapchainTexture = nullptr;
    Uint32 swapchainWidth = 0;
    Uint32 swapchainHeight = 0;
    if (!SDL_WaitAndAcquireGPUSwapchainTexture(
            commandBuffer,
            window_,
            &swapchainTexture,
            &swapchainWidth,
            &swapchainHeight)) {
        setSdlError(SdlGpuError::swapchainAcquireFailed);
        const SdlGpuError primaryError = lastError_;
        const std::array<char, error_message_capacity> primaryMessage = lastErrorMessage_;
        const std::size_t primaryMessageSize = lastErrorMessageSize_;
        const bool canceled = cancelCommandBuffer(commandBuffer);
        if (primaryError == SdlGpuError::deviceLost || canceled) {
            lastError_ = primaryError;
            lastErrorMessage_ = primaryMessage;
            lastErrorMessageSize_ = primaryMessageSize;
        }
        return false;
    }

    if (swapchainTexture == nullptr) {
        if (!cancelCommandBuffer(commandBuffer)) {
            return false;
        }
        ++diagnostics_.skippedFrames;
        clearError();
        return true;
    }

    const PremultipliedRgba clearColor = frame.metadata().clearColor;
    SDL_GPUColorTargetInfo colorTarget{};
    colorTarget.texture = swapchainTexture;
    colorTarget.clear_color = {
        clearColor.red,
        clearColor.green,
        clearColor.blue,
        clearColor.alpha
    };
    colorTarget.load_op = SDL_GPU_LOADOP_CLEAR;
    colorTarget.store_op = SDL_GPU_STOREOP_STORE;

    SDL_GPURenderPass* const renderPass = SDL_BeginGPURenderPass(
        commandBuffer,
        &colorTarget,
        1U,
        nullptr
    );
    if (renderPass == nullptr) {
        setSdlError(SdlGpuError::renderPassBeginFailed);
        const SdlGpuError primaryError = lastError_;
        const std::array<char, error_message_capacity> primaryMessage = lastErrorMessage_;
        const std::size_t primaryMessageSize = lastErrorMessageSize_;
        if (!SDL_SubmitGPUCommandBuffer(commandBuffer)) {
            setSdlError(SdlGpuError::commandBufferSubmitFailed);
            if (primaryError == SdlGpuError::deviceLost) {
                lastError_ = primaryError;
                lastErrorMessage_ = primaryMessage;
                lastErrorMessageSize_ = primaryMessageSize;
            }
        } else {
            lastError_ = primaryError;
            lastErrorMessage_ = primaryMessage;
            lastErrorMessageSize_ = primaryMessageSize;
        }
        return false;
    }

    if (uploadSize > 0U) {
        const SDL_GPUBufferBinding vertexBinding{
            drawState_->vertexBuffer,
            0U
        };
        SDL_BindGPUVertexBuffers(renderPass, 0U, &vertexBinding, 1U);
        for (const detail::DrawBatch& batch : drawState_->geometry.batches()) {
            SDL_BindGPUGraphicsPipeline(
                renderPass,
                drawState_->pipelines[blendPipelineIndex(batch.blendMode)]
            );
            SDL_DrawGPUPrimitives(
                renderPass,
                batch.vertexCount,
                1U,
                batch.firstVertex,
                0U
            );
        }
        diagnostics_.lastDrawCalls = drawState_->geometry.batches().size();
    }

    SDL_EndGPURenderPass(renderPass);
    if (!SDL_SubmitGPUCommandBuffer(commandBuffer)) {
        setSdlError(SdlGpuError::commandBufferSubmitFailed);
        return false;
    }

    if (swapchainWidth <= static_cast<Uint32>(INT_MAX)
        && swapchainHeight <= static_cast<Uint32>(INT_MAX)
        && swapchainWidth > 0U
        && swapchainHeight > 0U) {
        diagnostics_.drawableWidth = static_cast<std::int32_t>(swapchainWidth);
        diagnostics_.drawableHeight = static_cast<std::int32_t>(swapchainHeight);
    }
    ++diagnostics_.submittedFrames;
    clearError();
    return true;
}

bool SdlGpuBackend::onBackground() noexcept {
    if (!requireReady()) {
        return false;
    }
    if (backgrounded_) {
        clearError();
        return true;
    }

    backgrounded_ = true;
    if (!SDL_WaitForGPUIdle(device_)) {
        setSdlError(SdlGpuError::gpuIdleWaitFailed);
        return false;
    }
    clearError();
    return true;
}

bool SdlGpuBackend::onForeground() noexcept {
    if (!requireReady()) {
        return false;
    }
    if (SDL_GetWindowID(window_) == 0U) {
        setSdlError(SdlGpuError::invalidWindow);
        return false;
    }
    backgrounded_ = false;
    clearError();
    return true;
}

bool SdlGpuBackend::purgeTransientResources() noexcept {
    if (!requireReady()) {
        return false;
    }
    if (!SDL_WaitForGPUIdle(device_)) {
        setSdlError(SdlGpuError::gpuIdleWaitFailed);
        return false;
    }
    clearError();
    return true;
}

void SdlGpuBackend::notifyDeviceLost(const std::string_view reason) noexcept {
    deviceLost_ = true;
    setError(
        SdlGpuError::deviceLost,
        reason.empty() ? sdlGpuErrorName(SdlGpuError::deviceLost) : reason
    );
}

bool SdlGpuBackend::isInitialized() const noexcept {
    return device_ != nullptr
        && windowClaimed_
        && drawState_ != nullptr
        && drawState_->vertexBuffer != nullptr
        && drawState_->transferBuffer != nullptr
        && std::all_of(
            drawState_->pipelines.begin(),
            drawState_->pipelines.end(),
            [](const SDL_GPUGraphicsPipeline* const pipeline) noexcept {
                return pipeline != nullptr;
            }
        );
}

bool SdlGpuBackend::isBackgrounded() const noexcept {
    return backgrounded_;
}

bool SdlGpuBackend::isDeviceLost() const noexcept {
    return deviceLost_;
}

SdlGpuError SdlGpuBackend::lastError() const noexcept {
    return lastError_;
}

std::string_view SdlGpuBackend::lastErrorMessage() const noexcept {
    return {lastErrorMessage_.data(), lastErrorMessageSize_};
}

const SdlGpuDiagnostics& SdlGpuBackend::diagnostics() const noexcept {
    return diagnostics_;
}

void SdlGpuBackend::clearError() noexcept {
    lastError_ = SdlGpuError::none;
    lastErrorMessage_[0] = '\0';
    lastErrorMessageSize_ = 0;
}

void SdlGpuBackend::setError(
    const SdlGpuError error,
    const std::string_view message
) noexcept {
    lastError_ = error;
    const std::string_view effectiveMessage = message.empty()
        ? sdlGpuErrorName(error)
        : message;
    const std::size_t copySize = std::min(
        effectiveMessage.size(),
        lastErrorMessage_.size() - 1U
    );
    if (copySize > 0U) {
        std::memmove(lastErrorMessage_.data(), effectiveMessage.data(), copySize);
    }
    lastErrorMessage_[copySize] = '\0';
    lastErrorMessageSize_ = copySize;
}

void SdlGpuBackend::setSdlError(const SdlGpuError fallback) noexcept {
    const char* const sdlMessage = SDL_GetError();
    const std::string_view message = sdlMessage == nullptr
        ? std::string_view{}
        : std::string_view{sdlMessage};
    if (describesDeviceLoss(message)) {
        notifyDeviceLost(message);
        return;
    }
    setError(fallback, message.empty() ? sdlGpuErrorName(fallback) : message);
}

bool SdlGpuBackend::requireReady() noexcept {
    if (deviceLost_) {
        lastError_ = SdlGpuError::deviceLost;
        if (lastErrorMessageSize_ == 0U) {
            setError(SdlGpuError::deviceLost, sdlGpuErrorName(SdlGpuError::deviceLost));
        }
        return false;
    }
    if (!isInitialized()) {
        setError(SdlGpuError::notInitialized, sdlGpuErrorName(SdlGpuError::notInitialized));
        return false;
    }
    return true;
}

bool SdlGpuBackend::cancelCommandBuffer(
    SDL_GPUCommandBuffer* const commandBuffer
) noexcept {
    if (SDL_CancelGPUCommandBuffer(commandBuffer)) {
        return true;
    }
    setSdlError(SdlGpuError::commandBufferCancelFailed);
    return false;
}

void SdlGpuBackend::releaseDevice() noexcept {
    const SdlGpuError preservedError = lastError_;
    const std::array<char, error_message_capacity> preservedMessage = lastErrorMessage_;
    const std::size_t preservedMessageSize = lastErrorMessageSize_;
    const bool preserveExistingError = preservedError != SdlGpuError::none;

    if (device_ != nullptr) {
        if (!SDL_WaitForGPUIdle(device_) && !preserveExistingError) {
            setSdlError(SdlGpuError::gpuIdleWaitFailed);
        }
        releaseDrawResources();
        if (windowClaimed_) {
            SDL_ReleaseWindowFromGPUDevice(device_, window_);
            windowClaimed_ = false;
        }
        SDL_DestroyGPUDevice(device_);
        device_ = nullptr;
    } else {
        releaseDrawResources();
        windowClaimed_ = false;
    }

    if (preserveExistingError) {
        lastError_ = preservedError;
        lastErrorMessage_ = preservedMessage;
        lastErrorMessageSize_ = preservedMessageSize;
    }
}

} // namespace cirvivor::render::sdl_gpu
