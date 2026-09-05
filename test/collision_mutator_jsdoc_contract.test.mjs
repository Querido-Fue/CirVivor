import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const FRAME_STATS_PATH = fileURLToPath(new URL(
    '../project/game/script/module/physics/collision_frame_stats.js',
    import.meta.url
));
const ENEMY_PAIR_BUDGET_PATH = fileURLToPath(new URL(
    '../project/game/script/module/physics/collision_enemy_pair_budget.js',
    import.meta.url
));
const [frameStatsSource, enemyPairBudgetSource] = await Promise.all([
    readFile(FRAME_STATS_PATH, 'utf8'),
    readFile(ENEMY_PAIR_BUDGET_PATH, 'utf8')
]);

/**
 * export 함수 선언 바로 앞의 JSDoc 본문을 찾습니다.
 * @param {string} source - 검사할 모듈 소스입니다.
 * @param {string} functionName - export 함수 이름입니다.
 * @returns {string} JSDoc 본문입니다.
 */
function findExportFunctionJsDoc(source, functionName) {
    const escapedFunctionName = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = source.match(new RegExp(
        `/\\*\\*((?:(?!\\*/)[\\s\\S])*)\\*/\\s*export function ${escapedFunctionName}\\(`
    ));
    assert.ok(match, `${functionName} 선언 앞 JSDoc을 찾을 수 없습니다.`);
    return match[1];
}

test('충돌 상태 mutator JSDoc은 void 반환 계약을 명시한다', () => {
    const cases = [
        [frameStatsSource, 'resetCollisionFrameStats'],
        [enemyPairBudgetSource, 'resetCollisionPassPairProcessCounts'],
        [enemyPairBudgetSource, 'markCollisionEnemyPairProcessAttempt']
    ];

    for (const [source, functionName] of cases) {
        assert.match(findExportFunctionJsDoc(source, functionName), /@returns \{void\}/);
    }
});
