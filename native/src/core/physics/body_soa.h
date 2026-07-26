#pragma once

#include "core/math/vector2.h"

#include <cstddef>
#include <cstdint>
#include <limits>
#include <vector>

namespace cirvivor::core {

enum class PhysicsBodyType : std::uint8_t {
    staticBody,
    kinematic,
    dynamic
};

struct PhysicsBodyConfig final {
    PhysicsBodyType type = PhysicsBodyType::dynamic;
    double x = 0.0;
    double y = 0.0;
    double mass = 1.0;
    double linearFriction = 0.0;
    double sleepSpeed = 0.0;
    double maxLinearSpeed = std::numeric_limits<double>::infinity();
};

// Fixed-capacity structure-of-arrays storage for authoritative physics state.
// Bodies are created before the fixed loop and no method used by a tick grows
// any backing vector.
class BodySoA final {
public:
    using Index = std::size_t;

    explicit BodySoA(std::size_t capacity);

    [[nodiscard]] Index addBody(const PhysicsBodyConfig& config);
    void seal() noexcept;

    [[nodiscard]] std::size_t size() const noexcept;
    [[nodiscard]] std::size_t capacity() const noexcept;
    [[nodiscard]] bool isSealed() const noexcept;
    [[nodiscard]] bool isEnabled(Index index) const;
    [[nodiscard]] PhysicsBodyType type(Index index) const;
    [[nodiscard]] Vector2 position(Index index) const;
    [[nodiscard]] Vector2 previousPosition(Index index) const;
    [[nodiscard]] Vector2 velocity(Index index) const;
    [[nodiscard]] double mass(Index index) const;
    [[nodiscard]] double inverseMass(Index index) const;

    [[nodiscard]] bool beginStep(Index index);
    [[nodiscard]] bool addAcceleration(Index index, double x, double y);
    [[nodiscard]] bool applyForce(Index index, double x, double y);
    [[nodiscard]] bool applyImpulse(Index index, double x, double y);
    [[nodiscard]] bool applyPositionCorrection(Index index, double x, double y);
    void setPosition(Index index, double x, double y, bool synchronizePrevious = false);
    void setVelocity(Index index, double x, double y);
    [[nodiscard]] bool integrate(Index index, double deltaSeconds);
    void stop(Index index);
    void destroy(Index index);

private:
    void requireIndex(Index index) const;
    void clearAccumulators(Index index) noexcept;
    void clampVelocity(Index index) noexcept;

    std::size_t capacity_ = 0;
    bool sealed_ = false;
    std::vector<PhysicsBodyType> type_;
    std::vector<std::uint8_t> enabled_;
    std::vector<std::uint8_t> stepBegun_;
    std::vector<double> mass_;
    std::vector<double> inverseMass_;
    std::vector<double> linearFriction_;
    std::vector<double> sleepSpeed_;
    std::vector<double> maxLinearSpeed_;
    std::vector<double> positionX_;
    std::vector<double> positionY_;
    std::vector<double> previousPositionX_;
    std::vector<double> previousPositionY_;
    std::vector<double> velocityX_;
    std::vector<double> velocityY_;
    std::vector<double> accelerationX_;
    std::vector<double> accelerationY_;
    std::vector<double> forceX_;
    std::vector<double> forceY_;
};

} // namespace cirvivor::core
