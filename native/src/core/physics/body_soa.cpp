#include "core/physics/body_soa.h"

#include "core/math/deterministic_math.h"

#include <cmath>
#include <stdexcept>

namespace cirvivor::core {
namespace {

[[nodiscard]] double finiteOr(const double value, const double fallback) noexcept {
    return std::isfinite(value) ? value : fallback;
}

[[nodiscard]] double nonNegativeOr(const double value, const double fallback) noexcept {
    return std::isfinite(value) && value >= 0.0 ? value : fallback;
}

} // namespace

BodySoA::BodySoA(const std::size_t capacity)
    : capacity_(capacity) {
    type_.reserve(capacity);
    enabled_.reserve(capacity);
    stepBegun_.reserve(capacity);
    mass_.reserve(capacity);
    inverseMass_.reserve(capacity);
    linearFriction_.reserve(capacity);
    sleepSpeed_.reserve(capacity);
    maxLinearSpeed_.reserve(capacity);
    positionX_.reserve(capacity);
    positionY_.reserve(capacity);
    previousPositionX_.reserve(capacity);
    previousPositionY_.reserve(capacity);
    velocityX_.reserve(capacity);
    velocityY_.reserve(capacity);
    accelerationX_.reserve(capacity);
    accelerationY_.reserve(capacity);
    forceX_.reserve(capacity);
    forceY_.reserve(capacity);
}

BodySoA::Index BodySoA::addBody(const PhysicsBodyConfig& config) {
    if (sealed_) {
        throw std::logic_error("BodySoA cannot add bodies after seal().");
    }
    if (size() >= capacity_) {
        throw std::length_error("BodySoA fixed capacity exceeded.");
    }

    const bool dynamic = config.type == PhysicsBodyType::dynamic;
    const double requestedMass = finiteOr(config.mass, 1.0);
    const double bodyMass = dynamic && requestedMass > 0.0
        ? requestedMass
        : std::numeric_limits<double>::infinity();
    const double maxSpeed = std::isfinite(config.maxLinearSpeed)
            && config.maxLinearSpeed > 0.0
        ? config.maxLinearSpeed
        : std::numeric_limits<double>::infinity();
    const double x = finiteOr(config.x, 0.0);
    const double y = finiteOr(config.y, 0.0);

    const Index index = size();
    type_.push_back(config.type);
    enabled_.push_back(1U);
    stepBegun_.push_back(0U);
    mass_.push_back(bodyMass);
    inverseMass_.push_back(std::isfinite(bodyMass) ? 1.0 / bodyMass : 0.0);
    linearFriction_.push_back(nonNegativeOr(config.linearFriction, 0.0));
    sleepSpeed_.push_back(nonNegativeOr(config.sleepSpeed, 0.0));
    maxLinearSpeed_.push_back(maxSpeed);
    positionX_.push_back(x);
    positionY_.push_back(y);
    previousPositionX_.push_back(x);
    previousPositionY_.push_back(y);
    velocityX_.push_back(0.0);
    velocityY_.push_back(0.0);
    accelerationX_.push_back(0.0);
    accelerationY_.push_back(0.0);
    forceX_.push_back(0.0);
    forceY_.push_back(0.0);
    return index;
}

void BodySoA::seal() noexcept {
    sealed_ = true;
}

std::size_t BodySoA::size() const noexcept {
    return type_.size();
}

std::size_t BodySoA::capacity() const noexcept {
    return capacity_;
}

bool BodySoA::isSealed() const noexcept {
    return sealed_;
}

bool BodySoA::isEnabled(const Index index) const {
    requireIndex(index);
    return enabled_[index] != 0U;
}

PhysicsBodyType BodySoA::type(const Index index) const {
    requireIndex(index);
    return type_[index];
}

Vector2 BodySoA::position(const Index index) const {
    requireIndex(index);
    return {positionX_[index], positionY_[index]};
}

Vector2 BodySoA::previousPosition(const Index index) const {
    requireIndex(index);
    return {previousPositionX_[index], previousPositionY_[index]};
}

Vector2 BodySoA::velocity(const Index index) const {
    requireIndex(index);
    return {velocityX_[index], velocityY_[index]};
}

double BodySoA::mass(const Index index) const {
    requireIndex(index);
    return mass_[index];
}

double BodySoA::inverseMass(const Index index) const {
    requireIndex(index);
    return inverseMass_[index];
}

bool BodySoA::beginStep(const Index index) {
    requireIndex(index);
    if (enabled_[index] == 0U || stepBegun_[index] != 0U) {
        return false;
    }
    previousPositionX_[index] = positionX_[index];
    previousPositionY_[index] = positionY_[index];
    stepBegun_[index] = 1U;
    return true;
}

bool BodySoA::addAcceleration(const Index index, const double x, const double y) {
    requireIndex(index);
    if (enabled_[index] == 0U || type_[index] != PhysicsBodyType::dynamic) {
        return false;
    }
    accelerationX_[index] += finiteOr(x, 0.0);
    accelerationY_[index] += finiteOr(y, 0.0);
    return true;
}

bool BodySoA::applyForce(const Index index, const double x, const double y) {
    requireIndex(index);
    if (enabled_[index] == 0U || type_[index] != PhysicsBodyType::dynamic) {
        return false;
    }
    forceX_[index] += finiteOr(x, 0.0);
    forceY_[index] += finiteOr(y, 0.0);
    return true;
}

bool BodySoA::applyImpulse(const Index index, const double x, const double y) {
    requireIndex(index);
    if (enabled_[index] == 0U || type_[index] != PhysicsBodyType::dynamic) {
        return false;
    }
    velocityX_[index] += finiteOr(x, 0.0) * inverseMass_[index];
    velocityY_[index] += finiteOr(y, 0.0) * inverseMass_[index];
    return true;
}

bool BodySoA::applyPositionCorrection(
    const Index index,
    const double x,
    const double y
) {
    requireIndex(index);
    if (enabled_[index] == 0U || type_[index] == PhysicsBodyType::staticBody) {
        return false;
    }
    positionX_[index] += finiteOr(x, 0.0);
    positionY_[index] += finiteOr(y, 0.0);
    return true;
}

void BodySoA::setPosition(
    const Index index,
    const double x,
    const double y,
    const bool synchronizePrevious
) {
    requireIndex(index);
    positionX_[index] = finiteOr(x, positionX_[index]);
    positionY_[index] = finiteOr(y, positionY_[index]);
    if (synchronizePrevious) {
        previousPositionX_[index] = positionX_[index];
        previousPositionY_[index] = positionY_[index];
    }
}

void BodySoA::setVelocity(const Index index, const double x, const double y) {
    requireIndex(index);
    velocityX_[index] = finiteOr(x, 0.0);
    velocityY_[index] = finiteOr(y, 0.0);
    clampVelocity(index);
}

bool BodySoA::integrate(const Index index, const double deltaSeconds) {
    requireIndex(index);
    if (enabled_[index] == 0U || type_[index] == PhysicsBodyType::staticBody) {
        clearAccumulators(index);
        stepBegun_[index] = 0U;
        return false;
    }
    if (!std::isfinite(deltaSeconds) || deltaSeconds <= 0.0) {
        return false;
    }
    if (stepBegun_[index] == 0U) {
        static_cast<void>(beginStep(index));
    }

    if (type_[index] == PhysicsBodyType::dynamic) {
        const double accelerationX = accelerationX_[index]
            + (forceX_[index] * inverseMass_[index]);
        const double accelerationY = accelerationY_[index]
            + (forceY_[index] * inverseMass_[index]);
        const double friction = linearFriction_[index];
        if (friction > 0.0) {
            const double decay = deterministicExp(-friction * deltaSeconds);
            const double accelerationScale = (1.0 - decay) / friction;
            velocityX_[index] = (velocityX_[index] * decay)
                + (accelerationX * accelerationScale);
            velocityY_[index] = (velocityY_[index] * decay)
                + (accelerationY * accelerationScale);
        } else {
            velocityX_[index] += accelerationX * deltaSeconds;
            velocityY_[index] += accelerationY * deltaSeconds;
        }
        clampVelocity(index);
        if (accelerationX == 0.0
            && accelerationY == 0.0
            && std::hypot(velocityX_[index], velocityY_[index]) <= sleepSpeed_[index]) {
            velocityX_[index] = 0.0;
            velocityY_[index] = 0.0;
        }
    }

    positionX_[index] += velocityX_[index] * deltaSeconds;
    positionY_[index] += velocityY_[index] * deltaSeconds;
    clearAccumulators(index);
    stepBegun_[index] = 0U;
    return true;
}

void BodySoA::stop(const Index index) {
    requireIndex(index);
    velocityX_[index] = 0.0;
    velocityY_[index] = 0.0;
    clearAccumulators(index);
}

void BodySoA::destroy(const Index index) {
    requireIndex(index);
    if (enabled_[index] == 0U) {
        return;
    }
    enabled_[index] = 0U;
    stop(index);
    stepBegun_[index] = 0U;
}

void BodySoA::requireIndex(const Index index) const {
    if (index >= size()) {
        throw std::out_of_range("BodySoA index is out of range.");
    }
}

void BodySoA::clearAccumulators(const Index index) noexcept {
    accelerationX_[index] = 0.0;
    accelerationY_[index] = 0.0;
    forceX_[index] = 0.0;
    forceY_[index] = 0.0;
}

void BodySoA::clampVelocity(const Index index) noexcept {
    const double maxMagnitude = maxLinearSpeed_[index];
    if (!std::isfinite(maxMagnitude)) {
        return;
    }
    const double magnitude = std::hypot(velocityX_[index], velocityY_[index]);
    if (magnitude <= maxMagnitude || magnitude == 0.0) {
        return;
    }
    const double scale = maxMagnitude / magnitude;
    velocityX_[index] *= scale;
    velocityY_[index] *= scale;
}

} // namespace cirvivor::core
