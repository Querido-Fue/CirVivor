import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { loadGameModule } from './source_module_loader.mjs';

const DEFAULT_SOURCE_FIXTURE_URL = new URL(
    '../fixtures/sdl_porting/legacy_collision_narrowphase_source_v1.json',
    import.meta.url
);
const DEFAULT_BASELINE_FIXTURE_URL = new URL(
    '../fixtures/sdl_porting/legacy_collision_narrowphase_baseline_v1.json',
    import.meta.url
);
const SOURCE_FIXTURE_ID = 'legacy_collision_narrowphase_source_v1';
const BASELINE_FIXTURE_ID = 'legacy_collision_narrowphase_baseline_v1';
const BASELINE_SCHEMA_VERSION = 1;
const BODY_F64_FIELDS = Object.freeze([
    'centerX', 'centerY', 'radius', 'minX', 'maxX', 'minY', 'maxY'
]);
const PART_F32_FIELDS = Object.freeze(['centerX', 'centerY', 'radius']);
const MANIFOLD_F64_FIELDS = Object.freeze([
    'normalX', 'normalY', 'penetration', 'pointX', 'pointY'
]);
const PRODUCTION_SOURCE_URLS = Object.freeze([
    ['physics/collision_body_detector.js', new URL(
        '../../script/module/physics/collision_body_detector.js',
        import.meta.url
    )],
    ['physics/collision_manifold_writer.js', new URL(
        '../../script/module/physics/collision_manifold_writer.js',
        import.meta.url
    )],
    ['physics/_collision_resolve_tuning.js', new URL(
        '../../script/module/physics/_collision_resolve_tuning.js',
        import.meta.url
    )],
    ['physics/collision_math_constants.js', new URL(
        '../../script/module/physics/collision_math_constants.js',
        import.meta.url
    )],
    ['physics/collision_body_layout.js', new URL(
        '../../script/module/physics/collision_body_layout.js',
        import.meta.url
    )],
    ['util/number_util.js', new URL('../../script/util/number_util.js', import.meta.url)]
]);

let productionModulesPromise = null;

/**
 * JSON fixture를 읽습니다.
 * @param {URL} fixtureUrl - 읽을 fixture URL입니다.
 * @returns {Promise<object>} 파싱한 fixture입니다.
 */
async function readJsonFixture(fixtureUrl) {
    return JSON.parse(await readFile(fixtureUrl, 'utf8'));
}

/**
 * UTF-8 문자열의 SHA-256을 계산합니다.
 * @param {string} value - 해시 입력입니다.
 * @returns {string} 64자리 digest입니다.
 */
function hashUtf8(value) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * raw hexadecimal IEEE-754 값 목록의 byte SHA-256을 계산합니다.
 * @param {string[]} values - 0x prefix가 있는 고정 폭 bit 문자열입니다.
 * @param {number} byteWidth - 원소 byte 폭입니다.
 * @returns {string} raw byte digest입니다.
 */
function hashRawHexValues(values, byteWidth) {
    const bytes = Buffer.allocUnsafe(values.length * byteWidth);
    for (let index = 0; index < values.length; index++) {
        const value = values[index];
        const expectedLength = 2 + (byteWidth * 2);
        if (typeof value !== 'string'
            || value.length !== expectedLength
            || !/^0x[0-9a-f]+$/u.test(value)) {
            throw new Error(
                '유효하지 않은 ' + (byteWidth * 8) + '-bit raw 값입니다: ' + value
            );
        }
        Buffer.from(value.slice(2), 'hex').copy(bytes, index * byteWidth);
    }
    return createHash('sha256').update(bytes).digest('hex');
}

/**
 * raw f64 bit 문자열을 JavaScript Number로 복원합니다.
 * @param {string} raw - f64 hexadecimal bit입니다.
 * @returns {number} 복원한 Number입니다.
 */
function decodeF64(raw) {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setBigUint64(0, BigInt(raw), false);
    return view.getFloat64(0, false);
}

/**
 * raw f32 bit 문자열을 JavaScript Number로 복원합니다.
 * @param {string} raw - f32 hexadecimal bit입니다.
 * @returns {number} 복원한 Number입니다.
 */
function decodeF32(raw) {
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setUint32(0, Number.parseInt(raw.slice(2), 16), false);
    return view.getFloat32(0, false);
}

/**
 * JavaScript Number의 f64 raw bit 문자열을 반환합니다.
 * @param {number} value - 변환할 값입니다.
 * @returns {string} 0x prefix가 있는 raw bit입니다.
 */
function encodeF64(value) {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setFloat64(0, value, false);
    return '0x' + view.getBigUint64(0, false).toString(16).padStart(16, '0');
}

/**
 * source fixture의 구조와 참조를 검증합니다.
 * @param {object} fixture - source fixture입니다.
 * @returns {void}
 */
function validateSourceFixture(fixture) {
    if (fixture?.schemaVersion !== 1 || fixture?.fixtureId !== SOURCE_FIXTURE_ID) {
        throw new Error('지원하지 않는 generic narrowphase source fixture입니다.');
    }
    if (!Array.isArray(fixture.bodies)
        || fixture.bodies.length === 0
        || fixture.bodies.length > 4096) {
        throw new Error('generic narrowphase body 목록이 유효하지 않습니다.');
    }
    if (!Array.isArray(fixture.cases)
        || fixture.cases.length === 0
        || fixture.cases.length > 16384) {
        throw new Error('generic narrowphase case 목록이 유효하지 않습니다.');
    }
    if (!isDeepStrictEqual(fixture.contract?.orderedBodyFields, BODY_F64_FIELDS)
        || !isDeepStrictEqual(fixture.contract?.orderedPartFields, PART_F32_FIELDS)) {
        throw new Error('generic narrowphase numeric field 순서가 계약과 다릅니다.');
    }

    const bodyIds = new Set();
    for (let bodyIndex = 0; bodyIndex < fixture.bodies.length; bodyIndex++) {
        const body = fixture.bodies[bodyIndex];
        if (typeof body?.id !== 'string' || body.id.length === 0 || bodyIds.has(body.id)) {
            throw new Error('중복되거나 유효하지 않은 body id입니다: ' + body?.id);
        }
        bodyIds.add(body.id);
        if (!['enemy', 'player', 'wall'].includes(body.kind)
            || !['circle', 'circleParts', 'rect'].includes(body.shape)) {
            throw new Error('지원하지 않는 body kind/shape입니다: ' + body.id);
        }
        for (let fieldIndex = 0; fieldIndex < BODY_F64_FIELDS.length; fieldIndex++) {
            hashRawHexValues([body.f64?.[BODY_F64_FIELDS[fieldIndex]]], 8);
        }
        if (!Array.isArray(body.parts)) {
            throw new Error('body parts가 배열이 아닙니다: ' + body.id);
        }
        if (body.shape !== 'circleParts' && body.parts.length !== 0) {
            throw new Error('circleParts가 아닌 body에 part가 있습니다: ' + body.id);
        }
        for (let partIndex = 0; partIndex < body.parts.length; partIndex++) {
            for (let fieldIndex = 0; fieldIndex < PART_F32_FIELDS.length; fieldIndex++) {
                hashRawHexValues([body.parts[partIndex]?.[PART_F32_FIELDS[fieldIndex]]], 4);
            }
        }
    }

    const caseIds = new Set();
    for (let caseIndex = 0; caseIndex < fixture.cases.length; caseIndex++) {
        const testCase = fixture.cases[caseIndex];
        if (typeof testCase?.id !== 'string'
            || testCase.id.length === 0
            || caseIds.has(testCase.id)
            || !bodyIds.has(testCase.bodyA)
            || !bodyIds.has(testCase.bodyB)) {
            throw new Error('유효하지 않은 generic narrowphase case입니다: ' + testCase?.id);
        }
        caseIds.add(testCase.id);
    }
}

/**
 * production export와 VM realm typed array constructor를 불러옵니다.
 * @returns {Promise<object>} production 함수 묶음입니다.
 */
async function loadProductionModules() {
    if (productionModulesPromise) {
        return productionModulesPromise;
    }
    productionModulesPromise = (async () => {
        const { detectCollisionBodies } = await loadGameModule(
            'physics/collision_body_detector.js'
        );
        const { createCollisionManifold } = await loadGameModule(
            'physics/collision_scratch_objects.js'
        );
        const { CollisionBroadphaseBuffer } = await loadGameModule(
            'physics/collision_broadphase_buffer.js'
        );
        const realmBuffer = new CollisionBroadphaseBuffer(1);
        return {
            detectCollisionBodies,
            createCollisionManifold,
            RealmFloat32Array: realmBuffer.broadData.constructor
        };
    })();
    return productionModulesPromise;
}

/**
 * source body를 production detector 입력 object로 복원합니다.
 * @param {object} definition - source body 정의입니다.
 * @param {Function} RealmFloat32Array - production VM realm의 Float32Array입니다.
 * @returns {object} detector 입력 body입니다.
 */
function createProductionBody(definition, RealmFloat32Array) {
    const body = {
        id: definition.id,
        kind: definition.kind,
        shape: definition.shape,
        circlePartCount: definition.parts.length,
        circleParts: null
    };
    for (let fieldIndex = 0; fieldIndex < BODY_F64_FIELDS.length; fieldIndex++) {
        const fieldName = BODY_F64_FIELDS[fieldIndex];
        body[fieldName] = decodeF64(definition.f64[fieldName]);
    }
    if (definition.shape === 'circleParts') {
        const parts = new RealmFloat32Array(definition.parts.length * PART_F32_FIELDS.length);
        let offset = 0;
        for (let partIndex = 0; partIndex < definition.parts.length; partIndex++) {
            const part = definition.parts[partIndex];
            for (let fieldIndex = 0; fieldIndex < PART_F32_FIELDS.length; fieldIndex++) {
                parts[offset++] = decodeF32(part[PART_F32_FIELDS[fieldIndex]]);
            }
        }
        body.circleParts = parts;
    }
    return body;
}

/**
 * production source 파일 digest를 순서대로 계산합니다.
 * @returns {Promise<object[]>} path와 SHA-256 목록입니다.
 */
async function captureProductionSourceDigests() {
    const entries = [];
    for (let index = 0; index < PRODUCTION_SOURCE_URLS.length; index++) {
        const [sourcePath, sourceUrl] = PRODUCTION_SOURCE_URLS[index];
        entries.push({
            path: sourcePath,
            sha256: hashUtf8(await readFile(sourceUrl, 'utf8'))
        });
    }
    return entries;
}

/**
 * source fixture를 직접 export된 production detector로 실행합니다.
 * @param {object} fixture - 검증할 source fixture입니다.
 * @returns {Promise<object>} raw-bit 결정론 baseline입니다.
 */
export async function exportLegacyCollisionNarrowphaseBaseline(fixture) {
    validateSourceFixture(fixture);
    const modules = await loadProductionModules();
    const bodiesById = new Map();
    for (let bodyIndex = 0; bodyIndex < fixture.bodies.length; bodyIndex++) {
        const definition = fixture.bodies[bodyIndex];
        bodiesById.set(
            definition.id,
            createProductionBody(definition, modules.RealmFloat32Array)
        );
    }

    const cases = [];
    const collisionMask = [];
    const outputRawValues = [];
    for (let caseIndex = 0; caseIndex < fixture.cases.length; caseIndex++) {
        const sourceCase = fixture.cases[caseIndex];
        const context = {
            manifold: modules.createCollisionManifold(),
            candidateManifold: modules.createCollisionManifold(),
            bestManifold: modules.createCollisionManifold(),
            profileRecorder: null
        };
        const manifold = modules.detectCollisionBodies(
            bodiesById.get(sourceCase.bodyA),
            bodiesById.get(sourceCase.bodyB),
            context
        );
        const collided = manifold !== null;
        collisionMask.push(collided ? 1 : 0);
        let rawF64 = null;
        if (collided) {
            rawF64 = {};
            for (let fieldIndex = 0; fieldIndex < MANIFOLD_F64_FIELDS.length; fieldIndex++) {
                const fieldName = MANIFOLD_F64_FIELDS[fieldIndex];
                const rawValue = encodeF64(manifold[fieldName]);
                rawF64[fieldName] = rawValue;
                outputRawValues.push(rawValue);
            }
        }
        cases.push({
            id: sourceCase.id,
            bodyA: sourceCase.bodyA,
            bodyB: sourceCase.bodyB,
            collided,
            rawF64
        });
    }

    const bodyRawValues = fixture.bodies.flatMap((body) => (
        BODY_F64_FIELDS.map((fieldName) => body.f64[fieldName])
    ));
    const partRawValues = fixture.bodies.flatMap((body) => (
        body.parts.flatMap((part) => (
            PART_F32_FIELDS.map((fieldName) => part[fieldName])
        ))
    ));
    const productionSources = await captureProductionSourceDigests();
    return {
        schemaVersion: BASELINE_SCHEMA_VERSION,
        fixtureId: BASELINE_FIXTURE_ID,
        oracle: {
            runtime: 'javascript-production-generic-narrowphase',
            contractVersion: 1,
            productionEntrypoint:
                'physics/collision_body_detector.js::detectCollisionBodies(bodyA, bodyB, context)',
            directExportInvocation: true,
            circlePartsRealmAdapter:
                'CollisionBroadphaseBuffer.broadData.constructor (constructor only; no grid execution)',
            manifoldFields: [...MANIFOLD_F64_FIELDS],
            authoritativeScope: [...fixture.contract.authoritativeScope],
            unavailableCapabilities: [...fixture.contract.unavailableCapabilities],
            productionSources,
            productionSourcesSha256: hashUtf8(JSON.stringify(productionSources))
        },
        source: {
            fixtureId: fixture.fixtureId,
            canonicalEncoding: 'JSON.stringify(source fixture)',
            canonicalSha256: hashUtf8(JSON.stringify(fixture)),
            bodyCount: fixture.bodies.length,
            bodyF64FieldOrder: [...BODY_F64_FIELDS],
            bodyF64ValueCount: bodyRawValues.length,
            bodyF64RawSha256: hashRawHexValues(bodyRawValues, 8),
            circlePartCount: partRawValues.length / PART_F32_FIELDS.length,
            circlePartF32FieldOrder: [...PART_F32_FIELDS],
            circlePartF32ValueCount: partRawValues.length,
            circlePartF32RawSha256: hashRawHexValues(partRawValues, 4),
            caseCount: fixture.cases.length,
            caseOrderSha256: hashUtf8(fixture.cases.map((entry) => entry.id).join('\n'))
        },
        result: {
            collisionCount: collisionMask.reduce((sum, value) => sum + value, 0),
            collisionMaskSha256: createHash('sha256')
                .update(Buffer.from(collisionMask))
                .digest('hex'),
            manifoldF64FieldOrder: [...MANIFOLD_F64_FIELDS],
            manifoldF64ValueCount: outputRawValues.length,
            manifoldF64RawSha256: hashRawHexValues(outputRawValues, 8)
        },
        cases
    };
}

/**
 * 기본 source fixture를 production oracle로 실행합니다.
 * @returns {Promise<object>} 생성한 baseline입니다.
 */
export async function exportDefaultLegacyCollisionNarrowphaseBaseline() {
    return exportLegacyCollisionNarrowphaseBaseline(
        await readJsonFixture(DEFAULT_SOURCE_FIXTURE_URL)
    );
}

/**
 * 저장 baseline과 현재 production oracle 결과가 같은지 확인합니다.
 * @returns {Promise<object>} 검증된 baseline입니다.
 */
export async function checkDefaultLegacyCollisionNarrowphaseBaseline() {
    const actual = await exportDefaultLegacyCollisionNarrowphaseBaseline();
    const expected = await readJsonFixture(DEFAULT_BASELINE_FIXTURE_URL);
    if (!isDeepStrictEqual(actual, expected)) {
        throw new Error(
            'generic narrowphase baseline이 현재 production oracle과 다릅니다. '
            + 'exporter를 --stdout으로 실행해 의도한 변경을 검토하세요.'
        );
    }
    return actual;
}

/**
 * CLI에서 baseline을 갱신·출력하거나 저장본과 비교합니다.
 * @returns {Promise<void>}
 */
async function runCli() {
    const args = new Set(process.argv.slice(2));
    const baseline = await exportDefaultLegacyCollisionNarrowphaseBaseline();
    if (args.has('--stdout')) {
        process.stdout.write(JSON.stringify(baseline, null, 2) + '\n');
        return;
    }
    if (args.has('--update')) {
        await writeFile(
            DEFAULT_BASELINE_FIXTURE_URL,
            JSON.stringify(baseline, null, 2) + '\n',
            'utf8'
        );
        console.log(
            'generic narrowphase baseline updated: ' + baseline.source.caseCount
            + ' cases, ' + baseline.result.manifoldF64RawSha256
        );
        return;
    }
    await checkDefaultLegacyCollisionNarrowphaseBaseline();
    console.log(
        'generic narrowphase baseline ok: ' + baseline.source.caseCount
        + ' cases, ' + baseline.result.manifoldF64RawSha256
    );
}

const isMainModule = process.argv[1]
    && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMainModule) {
    await runCli();
}
