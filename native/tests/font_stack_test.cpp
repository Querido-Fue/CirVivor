#include "render/text/font_face.h"

#include <array>
#include <bit>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace {

class TestFailure final : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

void require(
    const bool condition,
    const std::string_view expression,
    const std::string_view file,
    const int line
) {
    if (!condition) {
        throw TestFailure(
            std::string(file) + ':' + std::to_string(line)
            + " requirement failed: " + std::string(expression)
        );
    }
}

#define REQUIRE(expression) require((expression), #expression, __FILE__, __LINE__)

[[nodiscard]] std::vector<std::byte> readBytes(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary | std::ios::ate);
    if (!input) {
        throw TestFailure("unable to open " + path.string());
    }
    const std::streampos end = input.tellg();
    if (end < 0) {
        throw TestFailure("unable to measure " + path.string());
    }
    const auto fileSize = static_cast<std::uintmax_t>(end);
    if (fileSize > static_cast<std::uintmax_t>(std::numeric_limits<std::size_t>::max())) {
        throw TestFailure("file is too large " + path.string());
    }

    std::vector<std::byte> bytes(static_cast<std::size_t>(fileSize));
    input.seekg(0, std::ios::beg);
    if (!bytes.empty()) {
        input.read(
            reinterpret_cast<char*>(bytes.data()),
            static_cast<std::streamsize>(bytes.size())
        );
    }
    if (!input) {
        throw TestFailure("unable to read " + path.string());
    }
    return bytes;
}

[[nodiscard]] constexpr std::uint32_t choose(
    const std::uint32_t x,
    const std::uint32_t y,
    const std::uint32_t z
) noexcept {
    return (x & y) ^ (~x & z);
}

[[nodiscard]] constexpr std::uint32_t majority(
    const std::uint32_t x,
    const std::uint32_t y,
    const std::uint32_t z
) noexcept {
    return (x & y) ^ (x & z) ^ (y & z);
}

[[nodiscard]] std::string sha256(const std::vector<std::byte>& source) {
    constexpr std::array<std::uint32_t, 64> roundConstants{
        0x428a2f98U, 0x71374491U, 0xb5c0fbcfU, 0xe9b5dba5U,
        0x3956c25bU, 0x59f111f1U, 0x923f82a4U, 0xab1c5ed5U,
        0xd807aa98U, 0x12835b01U, 0x243185beU, 0x550c7dc3U,
        0x72be5d74U, 0x80deb1feU, 0x9bdc06a7U, 0xc19bf174U,
        0xe49b69c1U, 0xefbe4786U, 0x0fc19dc6U, 0x240ca1ccU,
        0x2de92c6fU, 0x4a7484aaU, 0x5cb0a9dcU, 0x76f988daU,
        0x983e5152U, 0xa831c66dU, 0xb00327c8U, 0xbf597fc7U,
        0xc6e00bf3U, 0xd5a79147U, 0x06ca6351U, 0x14292967U,
        0x27b70a85U, 0x2e1b2138U, 0x4d2c6dfcU, 0x53380d13U,
        0x650a7354U, 0x766a0abbU, 0x81c2c92eU, 0x92722c85U,
        0xa2bfe8a1U, 0xa81a664bU, 0xc24b8b70U, 0xc76c51a3U,
        0xd192e819U, 0xd6990624U, 0xf40e3585U, 0x106aa070U,
        0x19a4c116U, 0x1e376c08U, 0x2748774cU, 0x34b0bcb5U,
        0x391c0cb3U, 0x4ed8aa4aU, 0x5b9cca4fU, 0x682e6ff3U,
        0x748f82eeU, 0x78a5636fU, 0x84c87814U, 0x8cc70208U,
        0x90befffaU, 0xa4506cebU, 0xbef9a3f7U, 0xc67178f2U
    };
    std::array<std::uint32_t, 8> state{
        0x6a09e667U, 0xbb67ae85U, 0x3c6ef372U, 0xa54ff53aU,
        0x510e527fU, 0x9b05688cU, 0x1f83d9abU, 0x5be0cd19U
    };

    std::vector<std::byte> message = source;
    const std::uint64_t bitLength = static_cast<std::uint64_t>(source.size()) * 8U;
    message.push_back(std::byte{0x80});
    while ((message.size() % 64U) != 56U) {
        message.push_back(std::byte{0});
    }
    for (int shift = 56; shift >= 0; shift -= 8) {
        message.push_back(static_cast<std::byte>((bitLength >> shift) & 0xffU));
    }

    std::array<std::uint32_t, 64> words{};
    for (std::size_t block = 0; block < message.size(); block += 64U) {
        for (std::size_t index = 0; index < 16U; ++index) {
            const std::size_t offset = block + index * 4U;
            words[index] =
                (std::to_integer<std::uint32_t>(message[offset]) << 24U)
                | (std::to_integer<std::uint32_t>(message[offset + 1U]) << 16U)
                | (std::to_integer<std::uint32_t>(message[offset + 2U]) << 8U)
                | std::to_integer<std::uint32_t>(message[offset + 3U]);
        }
        for (std::size_t index = 16U; index < words.size(); ++index) {
            const std::uint32_t s0 = std::rotr(words[index - 15U], 7)
                ^ std::rotr(words[index - 15U], 18)
                ^ (words[index - 15U] >> 3U);
            const std::uint32_t s1 = std::rotr(words[index - 2U], 17)
                ^ std::rotr(words[index - 2U], 19)
                ^ (words[index - 2U] >> 10U);
            words[index] = words[index - 16U] + s0 + words[index - 7U] + s1;
        }

        std::uint32_t a = state[0];
        std::uint32_t b = state[1];
        std::uint32_t c = state[2];
        std::uint32_t d = state[3];
        std::uint32_t e = state[4];
        std::uint32_t f = state[5];
        std::uint32_t g = state[6];
        std::uint32_t h = state[7];
        for (std::size_t index = 0; index < words.size(); ++index) {
            const std::uint32_t sum1 = std::rotr(e, 6) ^ std::rotr(e, 11) ^ std::rotr(e, 25);
            const std::uint32_t temporary1 = h + sum1 + choose(e, f, g)
                + roundConstants[index] + words[index];
            const std::uint32_t sum0 = std::rotr(a, 2) ^ std::rotr(a, 13) ^ std::rotr(a, 22);
            const std::uint32_t temporary2 = sum0 + majority(a, b, c);
            h = g;
            g = f;
            f = e;
            e = d + temporary1;
            d = c;
            c = b;
            b = a;
            a = temporary1 + temporary2;
        }
        state[0] += a;
        state[1] += b;
        state[2] += c;
        state[3] += d;
        state[4] += e;
        state[5] += f;
        state[6] += g;
        state[7] += h;
    }

    constexpr std::string_view digits = "0123456789abcdef";
    std::string digest;
    digest.resize(64U);
    for (std::size_t index = 0; index < state.size(); ++index) {
        for (std::size_t nibble = 0; nibble < 8U; ++nibble) {
            const std::uint32_t shift = static_cast<std::uint32_t>((7U - nibble) * 4U);
            digest[index * 8U + nibble] = digits[(state[index] >> shift) & 0x0fU];
        }
    }
    return digest;
}

template<std::size_t Size>
void requireShapeContract(
    const cirvivor::render::text::ShapeResult& actual,
    const std::array<cirvivor::render::text::ShapedGlyph, Size>& expected,
    const std::int64_t expectedTotalAdvance
) {
    REQUIRE(actual.success);
    REQUIRE(actual.glyphs.size() == expected.size());
    REQUIRE(actual.totalXAdvance26Dot6 == expectedTotalAdvance);
    REQUIRE(actual.totalYAdvance26Dot6 == 0);
    for (std::size_t index = 0; index < expected.size(); ++index) {
        REQUIRE(actual.glyphs[index] == expected[index]);
    }
}

void testAssetIntegrityAndMemoryFace() {
    using namespace cirvivor::render::text;

    std::vector<std::byte> fontBytes = readBytes(CIRVIVOR_PRETENDARD_FONT_PATH);
    const std::vector<std::byte> licenseBytes = readBytes(CIRVIVOR_PRETENDARD_LICENSE_PATH);
    REQUIRE(fontBytes.size() == 2'057'688U);
    REQUIRE(licenseBytes.size() == 4'916U);
    REQUIRE(sha256(fontBytes) == "9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4");
    REQUIRE(sha256(licenseBytes) == "dbbfd9862cc8513c40d307d892a446b33ef4767e6423a3f74a913b8a210b91fd");

    FontLoadError error = FontLoadError::none;
    std::unique_ptr<FontFace> face = FontFace::loadFromMemory(std::move(fontBytes), error);
    REQUIRE(error == FontLoadError::none);
    REQUIRE(face != nullptr);
    REQUIRE(face->sourceByteCount() == 2'057'688U);
    REQUIRE(face->weightCoordinate() == FontFace::canonicalWeight);
    REQUIRE(face->pixelSize() == FontFace::canonicalPixelSize);

    REQUIRE(!face->containsCodepoint(U'\U0001F3C6'));
    REQUIRE(!face->containsCodepoint(U'\U0001F4D6'));
    REQUIRE(iconAssetReplacementFor(U'\U0001F3C6') == IconAssetReplacement::trophy);
    REQUIRE(iconAssetReplacementFor(U'\U0001F4D6') == IconAssetReplacement::book);
    REQUIRE(iconAssetReplacementFor(U'A') == IconAssetReplacement::none);

    const ShapeResult korean = face->shapeUtf8("설정");
    const ShapeResult latin = face->shapeUtf8("Lonely Tower");
    constexpr std::array expectedKorean{
        ShapedGlyph{6'948U, 0U, 3'540, 0, 0, 0},
        ShapedGlyph{8'725U, 3U, 3'540, 0, 0, 0}
    };
    constexpr std::array expectedLatin{
        ShapedGlyph{147U, 0U, 2'184, 0, 0, 0},
        ShapedGlyph{645U, 1U, 2'324, 0, 0, 0},
        ShapedGlyph{630U, 2U, 2'280, 0, 0, 0},
        ShapedGlyph{489U, 3U, 2'264, 0, 0, 0},
        ShapedGlyph{605U, 4U, 892, 0, 0, 0},
        ShapedGlyph{826U, 5U, 2'168, 0, 0, 0},
        ShapedGlyph{2U, 6U, 1'028, 0, 0, 0},
        ShapedGlyph{243U, 7U, 2'188, 0, 0, 0},
        ShapedGlyph{645U, 8U, 2'252, 0, 0, 0},
        ShapedGlyph{813U, 9U, 3'112, 0, 0, 0},
        ShapedGlyph{489U, 10U, 2'264, 0, 0, 0},
        ShapedGlyph{692U, 11U, 1'432, 0, 0, 0}
    };
    requireShapeContract(korean, expectedKorean, 7'080);
    requireShapeContract(latin, expectedLatin, 24'388);
}

struct TestCase final {
    std::string_view name;
    void (*run)();
};

} // namespace

int main() {
    constexpr std::array tests{
        TestCase{"asset integrity, memory face, and shaping", testAssetIntegrityAndMemoryFace}
    };

    std::size_t passed = 0;
    for (const TestCase& test : tests) {
        try {
            test.run();
            ++passed;
            std::cout << "[PASS] " << test.name << '\n';
        } catch (const std::exception& error) {
            std::cerr << "[FAIL] " << test.name << ": " << error.what() << '\n';
            return 1;
        }
    }

    std::cout << passed << '/' << tests.size() << " tests passed\n";
    return 0;
}
