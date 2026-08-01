import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SOURCE_PATH = fileURLToPath(new URL(
    '../script/module/scene/benchmark/render/benchmark_scene_world_renderer.js',
    import.meta.url
));
const source = await readFile(SOURCE_PATH, 'utf8');

/**
 * VM realm의 배열·레코드를 host realm의 비교 가능한 snapshot으로 복사합니다.
 * @param {*} value - 복사할 값입니다.
 * @returns {*} host realm snapshot입니다.
 */
function copyPlainValue(value) {
    if (Array.isArray(value)) {
        return Array.from(value, copyPlainValue);
    }
    if (!value || typeof value !== 'object') {
        return value;
    }

    const copy = {};
    for (const [key, entry] of Object.entries(value)) {
        copy[key] = copyPlainValue(entry);
    }
    return copy;
}

/**
 * 실제 world renderer를 격리해 WebGL 단건·bulk 제출을 기록합니다.
 * @returns {Promise<{draw: Function, calls: object[]}>} renderer와 제출 기록입니다.
 */
async function loadWorldRenderer() {
    const context = vm.createContext({ console });
    const calls = [];
    let bulkStepHook = null;
    const createSyntheticModule = (identifier, exports) => new vm.SyntheticModule(
        Object.keys(exports),
        function initializeSyntheticModule() {
            for (const [name, value] of Object.entries(exports)) {
                this.setExport(name, value);
            }
        },
        { context, identifier }
    );
    const modules = new Map([
        ['display/_theme_handler.js', createSyntheticModule(
            'display/_theme_handler.js',
            { ColorSchemes: { Game: { Map: {} } } }
        )],
        ['display/display_system.js', createSyntheticModule(
            'display/display_system.js',
            {
                renderGL(layer, options) {
                    calls.push({
                        type: 'single',
                        layer,
                        options: copyPlainValue(options)
                    });
                },
                renderGLShapeInstances(
                    layer,
                    options,
                    centers,
                    originX,
                    originY,
                    localScale,
                    cacheKey
                ) {
                    const centerSnapshots = [];
                    for (let index = 0; index < centers.length; index++) {
                        centerSnapshots.push({
                            x: centers[index].x,
                            y: centers[index].y
                        });
                        if (index === 0 && bulkStepHook) {
                            const hook = bulkStepHook;
                            bulkStepHook = null;
                            hook();
                        }
                    }
                    calls.push({
                        type: 'bulk',
                        layer,
                        options: copyPlainValue(options),
                        centers: centerSnapshots,
                        originX,
                        originY,
                        localScale,
                        cacheKey
                    });
                    return centers.length;
                }
            }
        )],
        ['debug/debug_system.js', createSyntheticModule(
            'debug/debug_system.js',
            { beginPerformanceSection: () => 0, endPerformanceSection() {} }
        )],
        ['../benchmark_scene_snapshot_utils.js', createSyntheticModule(
            '../benchmark_scene_snapshot_utils.js',
            {
                normalizeSnapshotNumber(value, fallback = 0) {
                    return Number.isFinite(value) ? value : fallback;
                }
            }
        )],
        ['./benchmark_scene_palette.js', createSyntheticModule(
            './benchmark_scene_palette.js',
            { getBenchmarkColor: (key) => `color:${key}` }
        )]
    ]);

    const module = new vm.SourceTextModule(source, { context, identifier: SOURCE_PATH });
    await module.link((specifier) => {
        const dependency = modules.get(specifier);
        if (!dependency) {
            throw new Error(`지원하지 않는 테스트 import입니다: ${specifier}`);
        }
        return dependency;
    });
    await module.evaluate();
    return {
        draw: module.namespace.drawGameSceneWorldObjects,
        calls,
        setBulkStepHook(hook) {
            bulkStepHook = hook;
        }
    };
}

test('동일 직경 투사체는 정규화된 좌표 순서 그대로 한 bulk 제출을 사용한다', async () => {
    const { draw, calls } = await loadWorldRenderer();
    draw({
        projectiles: [
            { radius: 3, position: { x: 1, y: 11 } },
            { active: false, radius: 99, position: { x: 99, y: 99 } },
            null,
            { radius: 3, position: { x: 2, y: 12 } },
            { radius: 3, position: { x: Number.POSITIVE_INFINITY, y: Number.NaN } }
        ],
        objectOffsetY: 10
    });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
        type: 'bulk',
        layer: 'object',
        options: {
            shape: 'circle',
            x: 0,
            y: 0,
            w: 6,
            h: 6,
            fill: 'color:Projectile',
            alpha: 0.95
        },
        centers: [
            { x: 1, y: 1 },
            { x: 2, y: 2 },
            { x: 0, y: -10 }
        ],
        originX: 0,
        originY: 0,
        localScale: 1,
        cacheKey: undefined
    });
});

test('혼합 직경은 연속 run 경계를 보존하고 단일 run은 기존 단건 제출을 사용한다', async () => {
    const { draw, calls } = await loadWorldRenderer();
    draw({
        projectiles: [
            { radius: 2, position: { x: 1, y: 5 } },
            { radius: 2, position: { x: 2, y: 6 } },
            { radius: 4, position: { x: 3, y: 7 } },
            { active: false, radius: 2, position: { x: 100, y: 100 } },
            { radius: 2, position: { x: 4, y: 8 } },
            { radius: 2, position: { x: 5, y: 9 } }
        ],
        objectOffsetY: 1
    });

    assert.deepEqual(calls.map((call) => ({
        type: call.type,
        diameter: call.options.w,
        centers: call.type === 'bulk'
            ? call.centers
            : [{ x: call.options.x, y: call.options.y }]
    })), [
        {
            type: 'bulk',
            diameter: 4,
            centers: [{ x: 1, y: 4 }, { x: 2, y: 5 }]
        },
        {
            type: 'single',
            diameter: 8,
            centers: [{ x: 3, y: 6 }]
        },
        {
            type: 'bulk',
            diameter: 4,
            centers: [{ x: 4, y: 7 }, { x: 5, y: 8 }]
        }
    ]);
});

test('재사용 scratch는 다음 draw의 짧은 투사체 목록에 이전 center를 남기지 않는다', async () => {
    const { draw, calls } = await loadWorldRenderer();
    draw({
        projectiles: Array.from({ length: 5 }, (_, index) => ({
            radius: 1,
            position: { x: index, y: index }
        }))
    });
    calls.length = 0;

    draw({
        projectiles: [
            { radius: -0, position: { x: -0, y: -0 } },
            { radius: -0, position: { x: 7, y: 8 } }
        ],
        objectOffsetY: -0
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].type, 'bulk');
    assert.equal(calls[0].centers.length, 2);
    assert.equal(Object.is(calls[0].options.w, -0), true);
    assert.equal(Object.is(calls[0].centers[0].x, -0), true);
    assert.equal(Object.is(calls[0].centers[0].y, 0), true);
    assert.deepEqual(calls[0].centers[1], { x: 7, y: 8 });
});

test('fallback bulk 순회 중 world draw가 재진입해도 outer center와 옵션을 보존한다', async () => {
    const { draw, calls, setBulkStepHook } = await loadWorldRenderer();
    setBulkStepHook(() => {
        draw({
            projectiles: [
                { radius: 9, position: { x: 90, y: 91 } },
                { radius: 9, position: { x: 92, y: 93 } }
            ]
        });
    });

    draw({
        projectiles: [
            { radius: 2, position: { x: 1, y: 2 } },
            { radius: 2, position: { x: 3, y: 4 } },
            { radius: 2, position: { x: 5, y: 6 } }
        ]
    });

    assert.equal(calls.length, 2);
    assert.deepEqual({
        diameter: calls[0].options.w,
        centers: calls[0].centers
    }, {
        diameter: 18,
        centers: [{ x: 90, y: 91 }, { x: 92, y: 93 }]
    });
    assert.deepEqual({
        diameter: calls[1].options.w,
        centers: calls[1].centers
    }, {
        diameter: 4,
        centers: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }]
    });
});
