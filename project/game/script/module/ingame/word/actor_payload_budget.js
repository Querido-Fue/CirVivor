function requireNonNegativeSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new RangeError(`${label}은 0 이상의 안전한 정수여야 합니다.`);
    }
    return number;
}

/** Runtime preflight와 preview가 공유하는 0-or-N actor body capacity 판정입니다. */
export function evaluateActorPayloadCapacity(source = {}) {
    const requiredBodies = requireNonNegativeSafeInteger(
        source.requiredBodies ?? source.subjectCount ?? 0,
        'requiredBodies'
    );
    const registryAvailable = requireNonNegativeSafeInteger(
        source.registryAvailable ?? 0,
        'registryAvailable'
    );
    const bodyAvailable = requireNonNegativeSafeInteger(
        source.bodyAvailable ?? 0,
        'bodyAvailable'
    );
    const generatedBodyBudget = requireNonNegativeSafeInteger(
        source.generatedBodyBudget ?? requiredBodies,
        'generatedBodyBudget'
    );
    const availableBodies = Math.min(registryAvailable, bodyAvailable);
    const valid = requiredBodies <= generatedBodyBudget
        && requiredBodies <= availableBodies;
    return Object.freeze({
        valid,
        requiredBodies,
        availableBodies,
        registryAvailable,
        bodyAvailable,
        generatedBodyBudget,
        shortfall: valid ? 0 : Math.max(0, requiredBodies - availableBodies)
    });
}
