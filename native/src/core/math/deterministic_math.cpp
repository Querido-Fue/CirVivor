#include "core/math/deterministic_math.h"

#include <bit>
#include <cstdint>

// Adapted from V8 12.4.254 src/base/ieee754.cc, itself adapted from fdlibm.
//
// Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
// Developed at SunSoft, a Sun Microsystems, Inc. business.
// Permission to use, copy, modify, and distribute this software is freely
// granted, provided that this notice is preserved.
// Copyright 2016 the V8 project authors. All rights reserved.

namespace cirvivor::core {
namespace {

[[nodiscard]] std::uint32_t highWord(const double value) noexcept {
    return static_cast<std::uint32_t>(std::bit_cast<std::uint64_t>(value) >> 32U);
}

[[nodiscard]] std::uint32_t lowWord(const double value) noexcept {
    return static_cast<std::uint32_t>(std::bit_cast<std::uint64_t>(value));
}

[[nodiscard]] double fromWords(
    const std::uint32_t high,
    const std::uint32_t low
) noexcept {
    return std::bit_cast<double>(
        (static_cast<std::uint64_t>(high) << 32U)
        | static_cast<std::uint64_t>(low)
    );
}

} // namespace

double deterministicExp(double value) noexcept {
    constexpr double one = 1.0;
    constexpr double half[2] = {0.5, -0.5};
    constexpr double overflowThreshold = 7.09782712893383973096e+02;
    constexpr double underflowThreshold = -7.45133219101941108420e+02;
    constexpr double ln2High[2] = {
        6.93147180369123816490e-01,
        -6.93147180369123816490e-01
    };
    constexpr double ln2Low[2] = {
        1.90821492927058770002e-10,
        -1.90821492927058770002e-10
    };
    constexpr double inverseLn2 = 1.44269504088896338700e+00;
    constexpr double p1 = 1.66666666666666019037e-01;
    constexpr double p2 = -2.77777777770155933842e-03;
    constexpr double p3 = 6.61375632143793436117e-05;
    constexpr double p4 = -1.65339022054652515390e-06;
    constexpr double p5 = 4.13813679705723846039e-08;
    constexpr double e = 2.718281828459045;
    volatile double huge = 1.0e+300;
    volatile double twoToMinus1000 = 9.33263618503218878990e-302;
    volatile double twoTo1023 = 8.988465674311579539e307;

    double result = 0.0;
    double high = 0.0;
    double low = 0.0;
    double correction = 0.0;
    double squared = 0.0;
    double twoToK = 0.0;
    int k = 0;

    std::uint32_t highBits = highWord(value);
    const int signBit = static_cast<int>((highBits >> 31U) & 1U);
    highBits &= 0x7fff'ffffU;

    if (highBits >= 0x4086'2e42U) {
        if (highBits >= 0x7ff0'0000U) {
            const std::uint32_t lowBits = lowWord(value);
            if (((highBits & 0x000f'ffffU) | lowBits) != 0U) {
                return value + value;
            }
            return signBit == 0 ? value : 0.0;
        }
        if (value > overflowThreshold) {
            return huge * huge;
        }
        if (value < underflowThreshold) {
            return twoToMinus1000 * twoToMinus1000;
        }
    }

    if (highBits > 0x3fd6'2e42U) {
        if (highBits < 0x3ff0'a2b2U) {
            if (value == 1.0) {
                return e;
            }
            high = value - ln2High[signBit];
            low = ln2Low[signBit];
            k = 1 - signBit - signBit;
        } else {
            k = static_cast<int>(inverseLn2 * value + half[signBit]);
            const double multiplier = static_cast<double>(k);
            high = value - multiplier * ln2High[0];
            low = multiplier * ln2Low[0];
        }
        value = high - low;
    } else if (highBits < 0x3e30'0000U) {
        if (huge + value > one) {
            return one + value;
        }
    }

    squared = value * value;
    if (k >= -1021) {
        twoToK = fromWords(
            0x3ff0'0000U + (static_cast<std::uint32_t>(k) << 20U),
            0U
        );
    } else {
        twoToK = fromWords(
            0x3ff0'0000U + (static_cast<std::uint32_t>(k + 1000) << 20U),
            0U
        );
    }
    correction = value - squared
        * (p1 + squared * (p2 + squared * (p3 + squared * (p4 + squared * p5))));
    if (k == 0) {
        return one - ((value * correction) / (correction - 2.0) - value);
    }
    result = one - ((low - (value * correction) / (2.0 - correction)) - high);
    if (k >= -1021) {
        if (k == 1024) {
            return result * 2.0 * twoTo1023;
        }
        return result * twoToK;
    }
    return result * twoToK * twoToMinus1000;
}

} // namespace cirvivor::core
