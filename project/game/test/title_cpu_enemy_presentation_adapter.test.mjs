import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SCRIPT_ROOT = new URL('../script/', import.meta.url);
const sourcePaths = Object.freeze({
    shapeEnemy: new URL('module/object/enemy/_shape_enemy.js', SCRIPT_ROOT),
    baseEnemy: new URL('module/object/enemy/_base_enemy.js', SCRIPT_ROOT),
    shapeAssets: new URL('module/object/enemy/_enemy_shape_assets.js', SCRIPT_ROOT),
    catalog: new URL('data/object/enemy/enemy_catalog_data.js', SCRIPT_ROOT),
    shapeGeometry: new URL(
        'data/object/enemy/enemy_shape_geometry_data.js',
        SCRIPT_ROOT
    ),
    balance: new URL('data/object/enemy/enemy_balance_data.js', SCRIPT_ROOT),
    math: new URL('util/math_util.js', SCRIPT_ROOT),
    number: new URL('util/number_util.js', SCRIPT_ROOT),
    parallax: new URL('module/scene/title/background/_title_background_parallax.js', SCRIPT_ROOT),
    adapter: new URL(
        'module/scene/title/webgpu/_title_cpu_enemy_presentation_adapter.js',
        SCRIPT_ROOT
    )
});

const sourceEntries = await Promise.all(
    Object.entries(sourcePaths).map(async ([key, url]) => [key, await readFile(url, 'utf8')])
);
const sources = Object.fromEntries(sourceEntries);

let objectOffsetY = 0;
let objectHeight = 900;
const legacyDrawCalls = [];

/**
 * 테스트 의존성용 synthetic module을 생성합니다.
 * @param {vm.Context} context - VM context입니다.
 * @param {string} identifier - 모듈 식별자입니다.
 * @param {object} exports - export 값입니다.
 * @returns {vm.SyntheticModule} synthetic module입니다.
 */
function createSyntheticModule(context, identifier, exports) {
    return new vm.SyntheticModule(
        Object.keys(exports),
        function initializeSyntheticModule() {
            for (const [name, value] of Object.entries(exports)) {
                this.setExport(name, value);
            }
        },
        { context, identifier }
    );
}

/**
 * 실제 ShapeEnemy, parallax 렌더 함수, CPU packet adapter를 같은 VM graph로 로드합니다.
 * @returns {Promise<object>} entry module namespace입니다.
 */
async function loadPresentationModules() {
    const context = vm.createContext({ console });
    const modules = new Map();
    const addSource = (specifier, source) => {
        modules.set(specifier, new vm.SourceTextModule(source, {
            context,
            identifier: specifier
        }));
    };

    addSource('object/enemy/_shape_enemy.js', sources.shapeEnemy);
    addSource('./_base_enemy.js', sources.baseEnemy);
    addSource('./_enemy_shape_assets.js', sources.shapeAssets);
    addSource('object/enemy/_enemy_shape_assets.js', sources.shapeAssets);
    addSource('data/object/enemy/enemy_catalog_data.js', sources.catalog);
    addSource('./enemy_shape_geometry_data.js', sources.shapeGeometry);
    addSource(
        'data/object/enemy/enemy_shape_geometry_data.js',
        sources.shapeGeometry
    );
    addSource('data/object/enemy/enemy_balance_data.js', sources.balance);
    addSource('util/math_util.js', sources.math);
    addSource('util/number_util.js', sources.number);
    addSource('scene/title/background/_title_background_parallax.js', sources.parallax);
    addSource('scene/title/webgpu/_title_cpu_enemy_presentation_adapter.js', sources.adapter);

    modules.set('display/display_system.js', createSyntheticModule(
        context,
        'display/display_system.js',
        {
            getObjectOffsetY: () => objectOffsetY,
            renderGL: (layer, options) => {
                legacyDrawCalls.push({
                    layer,
                    shape: options.shape,
                    x: options.x,
                    y: options.y,
                    w: options.w,
                    h: options.h,
                    fill: options.fill,
                    alpha: options.alpha,
                    rotation: options.rotation,
                    rotationCos: options.rotationCos,
                    rotationSin: options.rotationSin
                });
            }
        }
    ));
    modules.set('simulation/simulation_runtime.js', createSyntheticModule(
        context,
        'simulation/simulation_runtime.js',
        { getSimulationObjectWH: () => objectHeight }
    ));
    modules.set('scene/title/_title_runtime_constants.js', createSyntheticModule(
        context,
        'scene/title/_title_runtime_constants.js',
        { TITLE_AI_CONSTANTS: Object.freeze({ ID: 'title' }) }
    ));
    modules.set('util/color_util.js', createSyntheticModule(
        context,
        'util/color_util.js',
        {
            colorUtil: () => ({
                cssToRgb: () => ({ r: 255, g: 108, b: 108 }),
                rgbToString: (r, g, b, alpha) => `rgba(${r},${g},${b},${alpha})`
            })
        }
    ));
    modules.set('./_enemy_collision_debug.js', createSyntheticModule(
        context,
        './_enemy_collision_debug.js',
        { drawEnemyCollisionDebugCircles: () => {} }
    ));
    modules.set('./_title_background_theme.js', createSyntheticModule(
        context,
        './_title_background_theme.js',
        {
            getTitleBackgroundColor: () => '#102030',
            getTitleEnemyColor: () => '#f0d0b0',
            mixTitleEnemyColorWithBackground: (mix) => `mix-${mix}`
        }
    ));

    const entry = new vm.SourceTextModule(`
        export { ShapeEnemy } from 'object/enemy/_shape_enemy.js';
        export { drawTitleParallaxEnemy } from 'scene/title/background/_title_background_parallax.js';
        export {
            ENEMY_ASPECT_RATIO,
            ENEMY_DRAW_HEIGHT_RATIO,
            ENEMY_HEIGHT_SCALE
        } from 'data/object/enemy/enemy_catalog_data.js';
        export * from 'scene/title/webgpu/_title_cpu_enemy_presentation_adapter.js';
    `, { context, identifier: 'title-enemy-presentation-test-entry.js' });

    await entry.link((specifier) => {
        const dependency = modules.get(specifier);
        if (!dependency) {
            throw new Error(`누락된 테스트 모듈 의존성: ${specifier}`);
        }
        return dependency;
    });
    await entry.evaluate();
    return entry.namespace;
}

const presentation = await loadPresentationModules();
const {
    ShapeEnemy,
    TitleCpuEnemyPresentationAdapter,
    TITLE_CPU_ENEMY_MAX_COUNT,
    TITLE_CPU_ENEMY_PRESENTATION_MAX_RECORDS,
    TITLE_CPU_ENEMY_PRESENTATION_OFFSET: OFFSET,
    TITLE_CPU_ENEMY_PRESENTATION_RECORD_BYTES,
    TITLE_CPU_ENEMY_PRESENTATION_RECORD_FLOATS: STRIDE,
    TITLE_CPU_ENEMY_STYLE_LAYER_SHIFT,
    TITLE_CPU_ENEMY_STYLE_SHAPE_MASK,
    TITLE_CPU_ENEMY_STYLE_SOFTNESS_BIT,
    TITLE_CPU_ENEMY_STYLE_TYPES,
    ENEMY_ASPECT_RATIO,
    ENEMY_DRAW_HEIGHT_RATIO,
    ENEMY_HEIGHT_SCALE,
    drawTitleParallaxEnemy
} = presentation;

const TITLE_LAYERS = Object.freeze([
    Object.freeze({
        Id: 'far',
        Alpha: 0.4,
        ColorMix: 0.72,
        SoftnessScale: 1.14,
        SoftnessAlpha: 0.16,
        SoftnessOffsetPx: 1.4
    }),
    Object.freeze({
        Id: 'mid',
        Alpha: 0.52,
        ColorMix: 0.38,
        SoftnessScale: 1.06,
        SoftnessAlpha: 0.08,
        SoftnessOffsetPx: 0.7
    }),
    Object.freeze({
        Id: 'near',
        Alpha: 0.7,
        ColorMix: 0.1,
        SoftnessScale: 1.02,
        SoftnessAlpha: 0.03,
        SoftnessOffsetPx: 0.2
    })
]);

/**
 * 테스트용 활성 ShapeEnemy를 구성합니다.
 * @param {string} type - 도형 타입입니다.
 * @param {number} [layerIndex=0] - 페럴랙스 계층 인덱스입니다.
 * @param {number} [sequence=0] - 위치를 구분할 순번입니다.
 * @returns {ShapeEnemy} 구성한 적입니다.
 */
function createEnemy(type, layerIndex = 0, sequence = 0) {
    const enemy = new ShapeEnemy(type);
    enemy.active = true;
    enemy.type = type;
    enemy.size = 0.63 + (sequence * 0.013);
    enemy.renderPosition.x = 100.25 + (sequence * 37.5);
    enemy.renderPosition.y = 240.75 - (sequence * 11.25);
    enemy.renderRotation = -37.5 + (sequence * 23.75);
    enemy.mergePullOffset.x = 2.5 + sequence;
    enemy.mergePullOffset.y = -3.75 - sequence;
    enemy.mergeSettleOffset.x = -0.625 * sequence;
    enemy.mergeSettleOffset.y = 0.875 * sequence;
    enemy.alpha = TITLE_LAYERS[layerIndex]?.Alpha ?? 0.55;
    enemy.fill = `fill-${type}`;
    enemy._titleParallaxFill = `core-${type}`;
    enemy._titleParallaxLayerIndex = layerIndex;
    return enemy;
}

/**
 * packet의 한 레코드 필드를 읽습니다.
 * @param {object} packet - presentation packet입니다.
 * @param {number} recordIndex - 레코드 인덱스입니다.
 * @param {number} fieldOffset - 필드 오프셋입니다.
 * @returns {number} f32 필드 값입니다.
 */
function readRecord(packet, recordIndex, fieldOffset) {
    return packet.records[(recordIndex * STRIDE) + fieldOffset];
}

/**
 * legacy draw 결과와 packet record의 공통 수치 필드를 f32 경계에서 비교합니다.
 * @param {object} packet - presentation packet입니다.
 * @param {number} recordIndex - 레코드 인덱스입니다.
 * @param {object} legacy - renderGL에 전달된 레거시 options snapshot입니다.
 */
function assertRecordMatchesLegacy(packet, recordIndex, legacy) {
    const fields = [
        [OFFSET.X, legacy.x, 'x'],
        [OFFSET.Y, legacy.y, 'y'],
        [OFFSET.WIDTH, legacy.w, 'width'],
        [OFFSET.HEIGHT, legacy.h, 'height'],
        [OFFSET.ROTATION_COS, legacy.rotationCos, 'rotationCos'],
        [OFFSET.ROTATION_SIN, legacy.rotationSin, 'rotationSin'],
        [OFFSET.ALPHA, legacy.alpha, 'alpha']
    ];
    for (const [offset, expected, label] of fields) {
        assert.ok(
            Object.is(readRecord(packet, recordIndex, offset), Math.fround(expected)),
            `${recordIndex}번 레코드 ${label}가 legacy f32 값과 달라졌습니다.`
        );
    }
}

test('ShapeEnemy draw와 writePresentationState가 최종 transform 컨테이너를 정확히 공유한다', () => {
    objectOffsetY = 73.125;
    objectHeight = 913.5;
    legacyDrawCalls.length = 0;
    const enemy = createEnemy('arrow', 1, 3);
    const overrides = {
        layer: 'background',
        fill: '#abcdef',
        alpha: 0.2375,
        sizeScale: 1.1875,
        offsetX: 0.625,
        offsetY: -0.875
    };
    const out = {};

    assert.equal(enemy.writePresentationState(out, overrides), true);
    enemy.draw(overrides);
    assert.equal(legacyDrawCalls.length, 1);
    assert.deepEqual(legacyDrawCalls[0], { layer: 'background', ...out });

    const baseHeight = objectHeight * ENEMY_DRAW_HEIGHT_RATIO * enemy.size * overrides.sizeScale;
    assert.equal(out.x, enemy.renderPosition.x + overrides.offsetX
        + enemy.mergePullOffset.x + enemy.mergeSettleOffset.x);
    assert.equal(out.y, enemy.renderPosition.y - objectOffsetY + overrides.offsetY
        + enemy.mergePullOffset.y + enemy.mergeSettleOffset.y);
    assert.equal(out.h, baseHeight * ENEMY_HEIGHT_SCALE.arrow);
    assert.equal(out.w, baseHeight * ENEMY_ASPECT_RATIO.arrow);
    assert.equal(out.rotationCos, Math.cos(enemy.renderRotation * Math.PI / 180));
    assert.equal(out.rotationSin, Math.sin(enemy.renderRotation * Math.PI / 180));

    enemy.active = false;
    assert.equal(enemy.writePresentationState(out, overrides), false);
    enemy.draw(overrides);
    assert.equal(legacyDrawCalls.length, 1);
});

test('7개 타이틀 도형은 legacy core draw와 같은 geometry/회전/alpha 및 안정된 style 순서를 기록한다', () => {
    objectOffsetY = 41.5;
    objectHeight = 1080;
    legacyDrawCalls.length = 0;
    const enemies = Array.from(
        TITLE_CPU_ENEMY_STYLE_TYPES,
        (type, index) => createEnemy(type, 0, index)
    );
    for (let index = 0; index < enemies.length; index++) {
        enemies[index].draw();
    }

    const adapter = new TitleCpuEnemyPresentationAdapter();
    const packet = adapter.writePacket(enemies, []);
    assert.deepEqual(Array.from(TITLE_CPU_ENEMY_STYLE_TYPES), [
        'square',
        'triangle',
        'arrow',
        'hexa',
        'penta',
        'rhom',
        'octa'
    ]);
    assert.equal(packet.recordCount, 7);
    assert.equal(packet.usedByteLength, 7 * TITLE_CPU_ENEMY_PRESENTATION_RECORD_BYTES);

    for (let index = 0; index < enemies.length; index++) {
        assertRecordMatchesLegacy(packet, index, legacyDrawCalls[index]);
        const styleCode = readRecord(packet, index, OFFSET.STYLE_CODE);
        assert.equal(styleCode & TITLE_CPU_ENEMY_STYLE_SHAPE_MASK, index);
        assert.equal(styleCode & TITLE_CPU_ENEMY_STYLE_SOFTNESS_BIT, 0);
        assert.equal(styleCode >> TITLE_CPU_ENEMY_STYLE_LAYER_SHIFT, 0);
    }
});

test('softness와 core 레코드는 실제 parallax draw 두 패스와 f32 기준으로 일치한다', () => {
    objectOffsetY = 19.75;
    objectHeight = 777.25;
    legacyDrawCalls.length = 0;
    const enemy = createEnemy('rhom', 0, 4);
    drawTitleParallaxEnemy(enemy, TITLE_LAYERS[0]);
    assert.equal(legacyDrawCalls.length, 2);

    const packet = new TitleCpuEnemyPresentationAdapter().writePacket([enemy], TITLE_LAYERS);
    assert.equal(packet.recordCount, 2);
    assertRecordMatchesLegacy(packet, 0, legacyDrawCalls[0]);
    assertRecordMatchesLegacy(packet, 1, legacyDrawCalls[1]);
    assert.notEqual(legacyDrawCalls[0].w, legacyDrawCalls[1].w);
    assert.notEqual(legacyDrawCalls[0].x, legacyDrawCalls[1].x);
    assert.equal(
        readRecord(packet, 0, OFFSET.STYLE_CODE) & TITLE_CPU_ENEMY_STYLE_SOFTNESS_BIT,
        TITLE_CPU_ENEMY_STYLE_SOFTNESS_BIT
    );
    assert.equal(readRecord(packet, 1, OFFSET.STYLE_CODE) & TITLE_CPU_ENEMY_STYLE_SOFTNESS_BIT, 0);
});

test('packet 순서는 far→mid→near, 계층 내부 원래 배열, 적별 softness→core를 보존한다', () => {
    objectOffsetY = 0;
    const near = createEnemy('square', 2, 0);
    const farFirst = createEnemy('triangle', 0, 1);
    const mid = createEnemy('arrow', 1, 2);
    const farSecond = createEnemy('hexa', 0, 3);
    const inactiveFar = createEnemy('penta', 0, 4);
    inactiveFar.active = false;
    const packet = new TitleCpuEnemyPresentationAdapter().writePacket(
        [near, farFirst, mid, farSecond, inactiveFar],
        TITLE_LAYERS
    );
    const expected = [
        [farFirst, 0, true, 1],
        [farFirst, 0, false, 1],
        [farSecond, 0, true, 3],
        [farSecond, 0, false, 3],
        [mid, 1, true, 2],
        [mid, 1, false, 2],
        [near, 2, true, 0],
        [near, 2, false, 0]
    ];

    assert.equal(packet.recordCount, expected.length);
    assert.deepEqual(Array.from(packet.layerRecordStarts), [0, 4, 6]);
    assert.deepEqual(Array.from(packet.layerRecordCounts), [4, 2, 2]);
    for (let index = 0; index < expected.length; index++) {
        const [enemy, layerIndex, softness, shapeCode] = expected[index];
        const styleCode = readRecord(packet, index, OFFSET.STYLE_CODE);
        const softnessOffset = softness ? TITLE_LAYERS[layerIndex].SoftnessOffsetPx * 0.25 : 0;
        assert.equal(readRecord(packet, index, OFFSET.X), Math.fround(
            enemy.renderPosition.x
            + enemy.mergePullOffset.x
            + enemy.mergeSettleOffset.x
            + softnessOffset
        ));
        assert.equal(styleCode & TITLE_CPU_ENEMY_STYLE_SHAPE_MASK, shapeCode);
        assert.equal(
            Boolean(styleCode & TITLE_CPU_ENEMY_STYLE_SOFTNESS_BIT),
            softness
        );
        assert.equal(styleCode >> TITLE_CPU_ENEMY_STYLE_LAYER_SHIFT, layerIndex);
    }
});

test('420×softness/core 고정 용량을 채우고 초과 입력은 재할당 없이 결정적으로 자른다', () => {
    const enemy = createEnemy('square', 0, 0);
    const adapter = new TitleCpuEnemyPresentationAdapter();
    const atCapacity = new Array(TITLE_CPU_ENEMY_MAX_COUNT).fill(enemy);
    const packet = adapter.writePacket(atCapacity, TITLE_LAYERS);
    const recordsIdentity = packet.records;
    const startsIdentity = packet.layerRecordStarts;
    const countsIdentity = packet.layerRecordCounts;

    assert.equal(TITLE_CPU_ENEMY_PRESENTATION_MAX_RECORDS, 840);
    assert.equal(packet.records.length, 840 * STRIDE);
    assert.equal(packet.recordCount, 840);
    assert.equal(packet.overflowed, false);
    assert.equal(packet.droppedRecordCount, 0);

    const overflow = adapter.writePacket(new Array(TITLE_CPU_ENEMY_MAX_COUNT + 1).fill(enemy), TITLE_LAYERS);
    assert.strictEqual(overflow, packet);
    assert.strictEqual(overflow.records, recordsIdentity);
    assert.strictEqual(overflow.layerRecordStarts, startsIdentity);
    assert.strictEqual(overflow.layerRecordCounts, countsIdentity);
    assert.equal(overflow.recordCount, 840);
    assert.equal(overflow.overflowed, true);
    assert.equal(overflow.droppedRecordCount, 2);
    assert.equal(overflow.usedByteLength, 840 * 32);
});

test('adapter frame hot path에는 typed view 재생성이나 push/grow가 없다', () => {
    const hotPathSource = sources.adapter.slice(sources.adapter.indexOf('writePacket('));
    assert.doesNotMatch(hotPathSource, /\bnew\s+/u);
    assert.doesNotMatch(hotPathSource, /\.(?:push|slice|subarray|map|filter|splice)\s*\(/u);
    assert.match(sources.shapeEnemy, /draw\([^)]*\)\s*\{[\s\S]*this\.writePresentationState\(options, overrideOptions\)/u);
    assert.equal(fileURLToPath(sourcePaths.adapter).endsWith(
        'scene\\title\\webgpu\\_title_cpu_enemy_presentation_adapter.js'
    ), true);
});
