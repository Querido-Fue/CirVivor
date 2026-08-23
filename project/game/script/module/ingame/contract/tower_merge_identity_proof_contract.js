const UINT32_MAX = 0xffffffff;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const SECOND_LANE_SEED = 0x9e3779b9;

export const TOWER_MERGE_IDENTITY_PROOF_ABI_VERSION = 1;
export const TOWER_MERGE_IDENTITY_PROOF_MAX_SUBJECT_COUNT = 256;

function requireUint32(value, label, { positive = false } = {}) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)
        || number < (positive ? 1 : 0)
        || number > UINT32_MAX) {
        throw new RangeError(`${label}은 ${positive ? '양의 ' : ''}uint32여야 합니다.`);
    }
    return number >>> 0;
}

function requireText(value, label) {
    const text = String(value ?? '');
    if (text.length === 0) {
        throw new TypeError(`${label}이 필요합니다.`);
    }
    return text;
}

function hashWord(hash, value) {
    return Math.imul(
        (hash ^ (Number(value) >>> 0)) >>> 0,
        FNV_PRIME
    ) >>> 0;
}

function hashText(hash, value) {
    const text = String(value);
    let result = hash;
    for (let index = 0; index < text.length; index++) {
        result = hashWord(result, text.charCodeAt(index));
    }
    return result;
}

function normalizeProtocol(source, label = 'Tower Merge identity protocol') {
    return Object.freeze({
        sessionGeneration: requireUint32(
            source?.sessionGeneration,
            `${label}.sessionGeneration`,
            { positive: true }
        ),
        deviceGeneration: requireUint32(
            source?.deviceGeneration,
            `${label}.deviceGeneration`
        ),
        authoritativeEpoch: requireUint32(
            source?.authoritativeEpoch,
            `${label}.authoritativeEpoch`
        )
    });
}

function sameProtocol(left, right) {
    return left?.sessionGeneration === right?.sessionGeneration
        && left?.deviceGeneration === right?.deviceGeneration
        && left?.authoritativeEpoch === right?.authoritativeEpoch;
}

function normalizeSubject(source, index, protocol, subjectCount) {
    const subjectProtocol = normalizeProtocol(
        source,
        `Tower Merge identity subjects[${index}]`
    );
    if (!sameProtocol(subjectProtocol, protocol)) {
        throw new RangeError('Tower Merge subject protocol이 proof protocol과 다릅니다.');
    }
    const declaredSubjectCount = requireUint32(
        source?.subjectCount,
        `Tower Merge identity subjects[${index}].subjectCount`
    );
    if (declaredSubjectCount !== subjectCount) {
        throw new RangeError('Tower Merge subjectCount 결속이 다릅니다.');
    }
    return Object.freeze({
        ...subjectProtocol,
        subjectCount,
        privateSlot: requireUint32(
            source?.privateSlot,
            `Tower Merge identity subjects[${index}].privateSlot`
        ),
        entityId: requireUint32(
            source?.entityId,
            `Tower Merge identity subjects[${index}].entityId`,
            { positive: true }
        ),
        incarnation: requireUint32(
            source?.incarnation,
            `Tower Merge identity subjects[${index}].incarnation`,
            { positive: true }
        ),
        logicalTowerId: requireText(
            source?.logicalTowerId,
            `Tower Merge identity subjects[${index}].logicalTowerId`
        ),
        logicalTowerOrdinal: requireUint32(
            source?.logicalTowerOrdinal,
            `Tower Merge identity subjects[${index}].logicalTowerOrdinal`,
            { positive: true }
        )
    });
}

function computeProofFingerprint(source) {
    let lane0 = FNV_OFFSET;
    let lane1 = (FNV_OFFSET ^ SECOND_LANE_SEED) >>> 0;
    const hashBoth = (value) => {
        lane0 = hashWord(lane0, value);
        lane1 = hashWord(lane1, value);
    };
    for (const value of [
        source.abiVersion,
        source.commandFingerprint,
        source.sessionGeneration,
        source.deviceGeneration,
        source.authoritativeEpoch,
        source.groupRevision,
        source.rosterFingerprint,
        source.subjectCount,
        source.snapshotFingerprint
    ]) {
        hashBoth(value);
    }
    for (const subject of source.subjects) {
        for (const value of [
            subject.privateSlot,
            subject.entityId,
            subject.incarnation,
            subject.logicalTowerOrdinal
        ]) {
            hashBoth(value);
        }
        lane0 = hashText(lane0, subject.logicalTowerId);
        lane1 = hashText(lane1, subject.logicalTowerId);
    }
    return [lane0, lane1]
        .map((value) => value.toString(16).padStart(8, '0'))
        .join('');
}

export function computeTowerMergeSnapshotIdentityFingerprint(
    commandFingerprint,
    subjects
) {
    const fingerprint = requireUint32(
        commandFingerprint,
        'Tower Merge commandFingerprint',
        { positive: true }
    );
    if (!Array.isArray(subjects)) {
        throw new TypeError('Tower Merge snapshot subjects 배열이 필요합니다.');
    }
    let hash = hashWord(FNV_OFFSET, fingerprint);
    for (let index = 0; index < subjects.length; index++) {
        const subject = subjects[index];
        hash = hashWord(hash, requireUint32(
            subject?.privateSlot,
            `Tower Merge snapshot subjects[${index}].privateSlot`
        ));
        hash = hashWord(hash, requireUint32(
            subject?.entityId,
            `Tower Merge snapshot subjects[${index}].entityId`,
            { positive: true }
        ));
        hash = hashWord(hash, requireUint32(
            subject?.incarnation,
            `Tower Merge snapshot subjects[${index}].incarnation`,
            { positive: true }
        ));
    }
    return hash >>> 0;
}

export function sealTowerMergeIdentityProof(source = {}) {
    const abiVersion = requireUint32(
        source.abiVersion,
        'Tower Merge identity proof abiVersion',
        { positive: true }
    );
    if (abiVersion !== TOWER_MERGE_IDENTITY_PROOF_ABI_VERSION) {
        throw new RangeError('Tower Merge identity proof ABI version이 다릅니다.');
    }
    const protocol = normalizeProtocol(source);
    const subjectCount = requireUint32(
        source.subjectCount,
        'Tower Merge identity proof subjectCount'
    );
    if (subjectCount > TOWER_MERGE_IDENTITY_PROOF_MAX_SUBJECT_COUNT
        || !Array.isArray(source.subjects)
        || source.subjects.length !== subjectCount) {
        throw new RangeError('Tower Merge identity proof subject cardinality가 다릅니다.');
    }
    const subjects = source.subjects.map((subject, index) => (
        normalizeSubject(subject, index, protocol, subjectCount)
    )).sort((left, right) => left.privateSlot - right.privateSlot);
    const slots = new Set();
    const handles = new Set();
    const logicalIds = new Set();
    const ordinals = new Set();
    for (const subject of subjects) {
        const handle = `${subject.entityId}:${subject.incarnation}`;
        if (slots.has(subject.privateSlot)
            || handles.has(handle)
            || logicalIds.has(subject.logicalTowerId)
            || ordinals.has(subject.logicalTowerOrdinal)) {
            throw new RangeError('Tower Merge identity proof에 중복 identity가 있습니다.');
        }
        slots.add(subject.privateSlot);
        handles.add(handle);
        logicalIds.add(subject.logicalTowerId);
        ordinals.add(subject.logicalTowerOrdinal);
    }
    const commandFingerprint = requireUint32(
        source.commandFingerprint,
        'Tower Merge identity proof commandFingerprint',
        { positive: true }
    );
    const snapshotFingerprint = requireUint32(
        source.snapshotFingerprint,
        'Tower Merge identity proof snapshotFingerprint'
    );
    const expectedSnapshotFingerprint
        = computeTowerMergeSnapshotIdentityFingerprint(
            commandFingerprint,
            subjects
        );
    if (snapshotFingerprint !== expectedSnapshotFingerprint) {
        throw new RangeError('Tower Merge identity proof snapshot fingerprint가 다릅니다.');
    }
    const normalized = {
        abiVersion,
        commandFingerprint,
        ...protocol,
        groupRevision: requireUint32(
            source.groupRevision,
            'Tower Merge identity proof groupRevision',
            { positive: true }
        ),
        rosterFingerprint: requireUint32(
            source.rosterFingerprint,
            'Tower Merge identity proof rosterFingerprint'
        ),
        subjectCount,
        snapshotFingerprint,
        subjects: Object.freeze(subjects)
    };
    const proofFingerprint = computeProofFingerprint(normalized);
    if (source.proofFingerprint !== undefined
        && String(source.proofFingerprint).toLowerCase() !== proofFingerprint) {
        throw new RangeError('Tower Merge identity proof fingerprint가 다릅니다.');
    }
    return Object.freeze({ ...normalized, proofFingerprint });
}

export function captureTowerMergeIdentityProof({
    towerGroupState,
    backend,
    commandFingerprint
} = {}) {
    for (const method of ['getTowerRecords', 'getStatus']) {
        if (typeof towerGroupState?.[method] !== 'function') {
            throw new TypeError(`Tower Merge identity state.${method}()가 필요합니다.`);
        }
    }
    for (const method of [
        'getEventProtocolState',
        'getTowerGroupRuntimeStatus',
        'resolveExactAbilityBodySlot'
    ]) {
        if (typeof backend?.[method] !== 'function') {
            throw new TypeError(`Tower Merge identity backend.${method}()가 필요합니다.`);
        }
    }
    const protocol = normalizeProtocol(backend.getEventProtocolState());
    const stateStatus = towerGroupState.getStatus();
    const runtime = backend.getTowerGroupRuntimeStatus();
    const groupRevision = requireUint32(
        stateStatus?.groupRevision,
        'Tower Merge identity state groupRevision',
        { positive: true }
    );
    const living = towerGroupState.getTowerRecords().filter((record) => (
        record?.alive === true
    ));
    if (living.length > TOWER_MERGE_IDENTITY_PROOF_MAX_SUBJECT_COUNT
        || stateStatus?.livingTowerCount !== living.length
        || (stateStatus?.pendingCreation ?? null) !== null
        || (stateStatus?.pendingMerge ?? null) !== null
        || !sameProtocol(runtime, protocol)
        || runtime?.groupRevision !== groupRevision
        || runtime?.rosterMemberCount !== living.length
        || (runtime?.pendingRosterTransition ?? null) !== null
        || runtime?.requiresRecovery === true) {
        throw new RangeError('Tower Merge CPU/GPU roster identity가 안정 상태가 아닙니다.');
    }
    const subjectCount = living.length;
    const subjects = living.map((record, index) => {
        const binding = record.exactGpuBinding;
        if (!binding || !sameProtocol(binding, protocol)) {
            throw new RangeError(
                `Tower Merge living source[${index}] GPU binding이 stale입니다.`
            );
        }
        const exact = backend.resolveExactAbilityBodySlot(binding);
        if (!exact
            || exact.entityId !== binding.entityId
            || exact.incarnation !== binding.incarnation) {
            throw new RangeError(
                `Tower Merge living source[${index}] exact slot이 다릅니다.`
            );
        }
        return Object.freeze({
            ...protocol,
            subjectCount,
            privateSlot: exact.slot,
            entityId: exact.entityId,
            incarnation: exact.incarnation,
            logicalTowerId: record.logicalTowerId,
            logicalTowerOrdinal: record.logicalTowerOrdinal
        });
    }).sort((left, right) => left.privateSlot - right.privateSlot);
    return sealTowerMergeIdentityProof({
        abiVersion: TOWER_MERGE_IDENTITY_PROOF_ABI_VERSION,
        commandFingerprint,
        ...protocol,
        groupRevision,
        rosterFingerprint: runtime.rosterFingerprint,
        subjectCount,
        snapshotFingerprint: computeTowerMergeSnapshotIdentityFingerprint(
            commandFingerprint,
            subjects
        ),
        subjects
    });
}

export function sameTowerMergeIdentityProof(left, right) {
    let sealedLeft;
    let sealedRight;
    try {
        sealedLeft = sealTowerMergeIdentityProof(left);
        sealedRight = sealTowerMergeIdentityProof(right);
    } catch {
        return false;
    }
    if (sealedLeft.abiVersion !== sealedRight.abiVersion
        || sealedLeft.commandFingerprint !== sealedRight.commandFingerprint
        || !sameProtocol(sealedLeft, sealedRight)
        || sealedLeft.groupRevision !== sealedRight.groupRevision
        || sealedLeft.rosterFingerprint !== sealedRight.rosterFingerprint
        || sealedLeft.subjectCount !== sealedRight.subjectCount
        || sealedLeft.snapshotFingerprint !== sealedRight.snapshotFingerprint
        || sealedLeft.proofFingerprint !== sealedRight.proofFingerprint) {
        return false;
    }
    return sealedLeft.subjects.every((subject, index) => {
        const candidate = sealedRight.subjects[index];
        return candidate
            && sameProtocol(subject, candidate)
            && subject.subjectCount === candidate.subjectCount
            && subject.privateSlot === candidate.privateSlot
            && subject.entityId === candidate.entityId
            && subject.incarnation === candidate.incarnation
            && subject.logicalTowerId === candidate.logicalTowerId
            && subject.logicalTowerOrdinal === candidate.logicalTowerOrdinal;
    });
}

export function towerMergeSnapshotMatchesIdentityProof(proof, completion) {
    let sealed;
    try {
        sealed = sealTowerMergeIdentityProof(proof);
    } catch {
        return false;
    }
    if (!sameProtocol(sealed, completion)
        || completion?.commandFingerprint !== sealed.commandFingerprint
        || completion?.snapshotFingerprint !== sealed.snapshotFingerprint
        || Number(completion?.subjectCount) !== sealed.subjectCount
        || Number(completion?.capacityDemand) !== sealed.subjectCount
        || !Array.isArray(completion?.subjectIdentities)
        || completion.subjectIdentities.length !== sealed.subjectCount) {
        return false;
    }
    return completion.subjectIdentities.every((identity, index) => {
        const subject = sealed.subjects[index];
        return identity?.privateSlot === subject.privateSlot
            && identity?.entityId === subject.entityId
            && identity?.incarnation === subject.incarnation;
    });
}

export function towerMergePlanMatchesIdentityProof(proof, plan) {
    let sealed;
    try {
        sealed = sealTowerMergeIdentityProof(proof);
    } catch {
        return false;
    }
    if (plan?.accepted !== true
        || plan.sourceGroupRevision !== sealed.groupRevision
        || plan.sourceCount !== sealed.subjectCount
        || !Array.isArray(plan.sources)
        || plan.sources.length !== sealed.subjectCount) {
        return false;
    }
    const byHandle = new Map(sealed.subjects.map((subject) => (
        [`${subject.entityId}:${subject.incarnation}`, subject]
    )));
    return plan.sources.every((source) => {
        const binding = source?.exactGpuBinding;
        const subject = byHandle.get(
            `${Number(binding?.entityId)}:${Number(binding?.incarnation)}`
        );
        return subject
            && sameProtocol(subject, binding)
            && subject.logicalTowerId === source.logicalTowerId
            && subject.logicalTowerOrdinal === source.logicalTowerOrdinal;
    });
}
