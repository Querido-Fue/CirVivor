import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const navigation = await loadGameModule('object/enemy/ai/_enemy_ai_navigation.js');

const createWall = (x, y, w, h) => ({ kind: 'wall', x, y, w, h });

const getVersionedAvailability = (walls, version, startX, startY, endX, endY, pad, stats = null) => (
    navigation.getSharedDirectPathAvailability(
        { wallsVersion: version, aiDebugStats: stats },
        startX,
        startY,
        endX,
        endY,
        walls,
        pad,
        {},
        version
    )
);

test('versioned spatial LOS는 경계·다중 셀·패딩을 포함해 공개 linear LOS와 일치한다', () => {
    const walls = [
        createWall(-512, -512, 24, 1024),
        createWall(255, -40, 2, 80),
        createWall(256, -40, 2, 80),
        createWall(740, -420, 720, 840),
        createWall(-60, 480, 120, 3),
        createWall(320, 320, 16, 16),
        createWall(-960, -120, 48, 240),
        createWall(1600, 1200, 96, 96),
        createWall(2050, -50, 20, 100)
    ];
    const cases = [
        [0, 0, 1024, 0, 0],
        [0, 0, 1024, 0, 1],
        [0, 0, 1024, 0, 32],
        [-800, -800, 1800, 1600, 0],
        [256, -200, 256, 200, 0],
        [0, 482, 120, 482, 0],
        [0, 482.1, 120, 482.1, 0],
        [-1200, 0, 2400, 0, 300],
        [330, 330, 330, 330, 0]
    ];

    let seed = 0x9e3779b9;
    for (let i = 0; i < 160; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const startX = (seed % 3600) - 1800;
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const startY = (seed % 2800) - 1400;
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const endX = (seed % 3600) - 1800;
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const endY = (seed % 2800) - 1400;
        seed = (seed * 1664525 + 1013904223) >>> 0;
        cases.push([startX, startY, endX, endY, (seed % 5) * 37]);
    }

    for (const [startX, startY, endX, endY, pad] of cases) {
        const expected = !navigation.isSegmentBlockedByCoords(
            startX,
            startY,
            endX,
            endY,
            walls,
            pad
        );
        assert.equal(
            getVersionedAvailability(walls, 101, startX, startY, endX, endY, pad),
            expected,
            `${startX},${startY} -> ${endX},${endY}, pad=${pad}`
        );
    }
});

test('sparse cached LOS는 후보와 exact rect test를 줄이고 dense 후보는 linear로 fallback한다', () => {
    const sparseWalls = [createWall(20, -10, 10, 20)];
    for (let i = 1; i < 48; i++) {
        sparseWalls.push(createWall(i * 1024, 2048, 20, 20));
    }
    const sparseStats = { enabled: true };
    assert.equal(getVersionedAvailability(sparseWalls, 202, 0, 0, 100, 0, 0, sparseStats), false);
    assert.equal(sparseStats.directPathSpatialCandidateCount, 1);
    assert.equal(sparseStats.directPathRectTestCount, 1);
    assert.equal(sparseStats.directPathSpatialFallbackCount ?? 0, 0);

    const denseWalls = Array.from({ length: 16 }, (_, index) => (
        createWall(100 + index, 24 + (index * 8), 2, 2)
    ));
    const denseStats = { enabled: true };
    assert.equal(getVersionedAvailability(denseWalls, 203, 0, 0, 50, 0, 0, denseStats), true);
    assert.equal(denseStats.directPathSpatialFallbackCount, 1);
    assert.equal(denseStats.directPathRectTestCount, denseWalls.length);
});

test('versioned cache는 getter 평가를 한 번만 수행하고 version 변경 시 같은 순서로 재구성한다', () => {
    const calls = [];
    const walls = [
        {
            getCollisionRect() {
                calls.push('first');
                return { x: 20, y: 20, w: 10, h: 10 };
            }
        },
        {
            getCollisionRect() {
                calls.push('second');
                return { x: 2000, y: 2000, w: 10, h: 10 };
            }
        }
    ];
    assert.equal(getVersionedAvailability(walls, 301, 0, 0, 100, 0, 0), true);
    assert.deepEqual(calls, ['first', 'second']);
    assert.equal(getVersionedAvailability(walls, 301, 0, 0, 100, 0, 0), true);
    assert.deepEqual(calls, ['first', 'second']);
    assert.equal(getVersionedAvailability(walls, 302, 0, 0, 100, 0, 0), true);
    assert.deepEqual(calls, ['first', 'second', 'first', 'second']);

    navigation.isSegmentBlockedByCoords(0, 0, 100, 0, walls, 0);
    navigation.isSegmentBlockedByCoords(0, 0, 100, 0, walls, 0);
    assert.deepEqual(calls, ['first', 'second', 'first', 'second', 'first', 'second', 'first', 'second']);
});

test('versioned cache 생성 중 getter 예외 identity와 이전 wall 평가 순서를 보존한다', () => {
    const failure = new Error('wall getter failure');
    const calls = [];
    const walls = [
        {
            getCollisionRect() {
                calls.push('first');
                return { x: 20, y: 20, w: 10, h: 10 };
            }
        },
        {
            getCollisionRect() {
                calls.push('second');
                throw failure;
            }
        }
    ];
    assert.throws(
        () => getVersionedAvailability(walls, 401, 0, 0, 100, 0, 0),
        (error) => error === failure
    );
    assert.deepEqual(calls, ['first', 'second']);
});

test('debug 계측 재진입은 shared spatial scratch를 건드리지 않고 linear fallback으로 격리한다', () => {
    const walls = [createWall(20, -10, 10, 20)];
    for (let i = 1; i < 12; i++) {
        walls.push(createWall(i * 1024, 2048, 20, 20));
    }
    let reentered = false;
    const stats = { enabled: true };
    Object.defineProperty(stats, 'directPathSpatialCandidateCount', {
        get() {
            return 0;
        },
        set() {
            if (reentered) return;
            reentered = true;
            assert.equal(getVersionedAvailability(walls, 501, 0, 0, 100, 0, 0, stats), false);
        }
    });

    assert.equal(getVersionedAvailability(walls, 501, 0, 0, 100, 0, 0, stats), false);
    assert.equal(reentered, true);
});

test('safe integer 밖의 spatial cell 좌표는 index 순회 없이 linear fallback으로 처리한다', () => {
    const walls = [
        createWall(1e20, 1e20, 16, 16),
        createWall(-1e20, -1e20, 16, 16),
        createWall(20, -10, 10, 20),
        createWall(4096, 4096, 16, 16),
        createWall(8192, 8192, 16, 16),
        createWall(12288, 12288, 16, 16),
        createWall(16384, 16384, 16, 16),
        createWall(20480, 20480, 16, 16)
    ];
    const expected = !navigation.isSegmentBlockedByCoords(0, 0, 100, 0, walls, 0);
    assert.equal(getVersionedAvailability(walls, 601, 0, 0, 100, 0, 0), expected);
    assert.equal(getVersionedAvailability(walls, 601, 1e20, 1e20, 1e20 + 40, 1e20, 0), false);
});
