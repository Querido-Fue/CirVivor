import { getCollisionRule } from './_collision_rules.js';

/**
 * 두 충돌 body가 같은 게임 객체 또는 같은 enemy id를 가리키는지 반환합니다.
 * @param {object|null|undefined} bodyA - 첫 번째 충돌 body입니다.
 * @param {object|null|undefined} bodyB - 두 번째 충돌 body입니다.
 * @returns {boolean} 같은 대상이면 true입니다.
 */
export function areCollisionBodiesSameEntity(bodyA, bodyB) {
    if (!bodyA || !bodyB) {
        return false;
    }
    if (bodyA.ref && bodyA.ref === bodyB.ref) {
        return true;
    }
    if (bodyA.kind === 'enemy' && bodyB.kind === 'enemy') {
        const idA = Number.isInteger(bodyA.id) ? bodyA.id : -1;
        const idB = Number.isInteger(bodyB.id) ? bodyB.id : -1;
        return idA >= 0 && idA === idB;
    }
    return false;
}

/**
 * 현재 패스에서 처리 가능한 충돌 규칙을 반환합니다.
 * @param {object|null|undefined} bodyA - 첫 번째 충돌 body입니다.
 * @param {object|null|undefined} bodyB - 두 번째 충돌 body입니다.
 * @param {boolean} applyNonPosition - 비위치 효과 적용 패스 여부입니다.
 * @returns {CollisionRule|null} 처리 가능한 규칙입니다.
 */
export function getCollisionPassRule(bodyA, bodyB, applyNonPosition) {
    if (!bodyA || !bodyB || areCollisionBodiesSameEntity(bodyA, bodyB)) {
        return null;
    }

    const rule = getCollisionRule(bodyA.kind, bodyB.kind);
    if (!rule.check) return null;
    if (!rule.resolve && !applyNonPosition) return null;
    return rule;
}
