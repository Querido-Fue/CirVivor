function requireNonNegativeSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new RangeError(`${label}은 0 이상의 안전한 정수여야 합니다.`);
    }
    return number;
}

function requirePositiveSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new RangeError(`${label}은 양의 안전한 정수여야 합니다.`);
    }
    return number;
}

const UINT32_MAX = 0xffffffff;

export const ACTOR_PAYLOAD_CARDINALITY_REASON = Object.freeze({
    GENERATED_COUNT_OVERFLOW: 'GENERATED_COUNT_OVERFLOW',
    GENERATED_BODY_BUDGET_EXCEEDED: 'GENERATED_BODY_BUDGET_EXCEEDED',
    DESTINATION_CAPACITY_EXCEEDED: 'DESTINATION_CAPACITY_EXCEEDED'
});

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

/**
 * Modifier가 파생한 copies를 포함해 preview/runtime이 공유하는 생성량과
 * capacity rejection reason을 계산합니다.
 */
export function evaluateActorPayloadCardinality(source = {}) {
    const subjectCount = requireNonNegativeSafeInteger(
        source.subjectCount ?? 0,
        'subjectCount'
    );
    const copiesPerSubject = requirePositiveSafeInteger(
        source.copiesPerSubject ?? 1,
        'copiesPerSubject'
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
        source.generatedBodyBudget ?? 0,
        'generatedBodyBudget'
    );
    const multiplicationOverflow = subjectCount > Math.floor(
        UINT32_MAX / copiesPerSubject
    );
    const effectiveGeneratedCount = multiplicationOverflow
        ? 0
        : subjectCount * copiesPerSubject;
    const availableBodies = Math.min(registryAvailable, bodyAvailable);
    const reason = multiplicationOverflow
        ? ACTOR_PAYLOAD_CARDINALITY_REASON.GENERATED_COUNT_OVERFLOW
        : effectiveGeneratedCount > generatedBodyBudget
            ? ACTOR_PAYLOAD_CARDINALITY_REASON
                .GENERATED_BODY_BUDGET_EXCEEDED
            : effectiveGeneratedCount > availableBodies
                ? ACTOR_PAYLOAD_CARDINALITY_REASON
                    .DESTINATION_CAPACITY_EXCEEDED
                : null;
    return Object.freeze({
        valid: reason === null,
        reason,
        subjectCount,
        copiesPerSubject,
        effectiveGeneratedCount,
        multiplicationOverflow,
        requiredBodies: effectiveGeneratedCount,
        availableBodies,
        registryAvailable,
        bodyAvailable,
        generatedBodyBudget,
        shortfall: reason === null || multiplicationOverflow
            ? 0
            : Math.max(0, effectiveGeneratedCount - availableBodies)
    });
}
