#pragma once

#include "render/common/frame_packet.h"

#include <cstddef>
#include <cstdint>
#include <span>
#include <vector>

namespace cirvivor::render {

struct FramePacketDecodeLimits final {
    std::uint32_t maximumCommandCount = 131'072;
    std::uint32_t maximumCommandsPerKind = 65'536;
    std::uint32_t maximumUtf8ByteCount = 8U * 1'024U * 1'024U;
    std::size_t maximumWireByteCount = 64U * 1'024U * 1'024U;
    std::size_t maximumDecodedByteCount = 64U * 1'024U * 1'024U;
};

enum class FramePacketDecodeError : std::uint8_t {
    none = 0,
    invalidMagic,
    unsupportedSchemaVersion,
    unsupportedAlphaEncoding,
    sizeLimitExceeded,
    truncated,
    trailingBytes,
    invalidPacket,
    allocationFailure,
    destinationBusy
};

struct FramePacketDecodeResult final {
    FramePacketDecodeError error = FramePacketDecodeError::none;
    std::size_t byteOffset = 0;

    [[nodiscard]] constexpr explicit operator bool() const noexcept {
        return error == FramePacketDecodeError::none;
    }
};

/**
 * FramePacket을 padding과 host endian에 의존하지 않는 canonical little-endian v1으로 기록합니다.
 * output은 재사용할 수 있으며 clear 뒤 기존 capacity를 유지합니다.
 */
[[nodiscard]] bool serializeFramePacket(
    const FramePacket& packet,
    std::vector<std::byte>& output
);

/**
 * canonical v1을 읽습니다. 실패하면 destination을 변경하지 않으며, 비정상 count는
 * allocation 전에 limits로 차단합니다.
 */
[[nodiscard]] FramePacketDecodeResult deserializeFramePacket(
    std::span<const std::byte> bytes,
    FramePacket& destination,
    const FramePacketDecodeLimits& limits = {}
);

} // namespace cirvivor::render
