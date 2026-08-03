import { ENEMY_SHAPE_TYPES } from 'data/object/enemy/enemy_catalog_data.js';
import { getEnemyShapeKey } from 'object/enemy/_enemy_shape_assets.js';
import { resolveFiniteNumber } from 'util/number_util.js';

export const TITLE_CPU_ENEMY_MAX_COUNT = 420;
export const TITLE_CPU_ENEMY_PRESENTATION_RECORD_FLOATS = 8;
export const TITLE_CPU_ENEMY_PRESENTATION_RECORD_BYTES = 32;
export const TITLE_CPU_ENEMY_PRESENTATION_MAX_RECORDS = TITLE_CPU_ENEMY_MAX_COUNT * 2;
export const TITLE_CPU_ENEMY_PRESENTATION_LAYER_CAPACITY = 3;

export const TITLE_CPU_ENEMY_PRESENTATION_OFFSET = Object.freeze({
    X: 0,
    Y: 1,
    WIDTH: 2,
    HEIGHT: 3,
    ROTATION_COS: 4,
    ROTATION_SIN: 5,
    ALPHA: 6,
    STYLE_CODE: 7
});

export const TITLE_CPU_ENEMY_STYLE_SHAPE_MASK = 0x7;
export const TITLE_CPU_ENEMY_STYLE_SOFTNESS_BIT = 0x8;
export const TITLE_CPU_ENEMY_STYLE_LAYER_SHIFT = 4;

const TITLE_CPU_ENEMY_SOFTNESS_ALPHA_MULTIPLIER = 2.2;
const TITLE_CPU_ENEMY_SOFTNESS_SCALE_EXPANSION = 1.035;
const TITLE_CPU_ENEMY_STYLE_TYPES_MUTABLE = ENEMY_SHAPE_TYPES.filter((type) => type !== 'gen');
export const TITLE_CPU_ENEMY_STYLE_TYPES = Object.freeze(TITLE_CPU_ENEMY_STYLE_TYPES_MUTABLE);
const TITLE_CPU_ENEMY_STYLE_CODE_BY_SHAPE = Object.create(null);

for (let index = 0; index < TITLE_CPU_ENEMY_STYLE_TYPES.length; index++) {
    TITLE_CPU_ENEMY_STYLE_CODE_BY_SHAPE[getEnemyShapeKey(TITLE_CPU_ENEMY_STYLE_TYPES[index])] = index;
}
Object.freeze(TITLE_CPU_ENEMY_STYLE_CODE_BY_SHAPE);

/**
 * 도형, softness pass, 페럴랙스 계층을 하나의 정확한 f32 정수 style code로 묶습니다.
 * @param {number} shapeCode - 하위 3비트에 기록할 도형 코드입니다.
 * @param {number} layerIndex - far/mid/near 계층 인덱스입니다.
 * @param {boolean} softness - softness 보조 레코드 여부입니다.
 * @returns {number} GPU에서 u32로 복원할 수 있는 style code입니다.
 */
function encodeStyleCode(shapeCode, layerIndex, softness) {
    return shapeCode
        | (softness ? TITLE_CPU_ENEMY_STYLE_SOFTNESS_BIT : 0)
        | (layerIndex << TITLE_CPU_ENEMY_STYLE_LAYER_SHIFT);
}

/**
 * CPU simulation 적을 WebGPU shadow renderer용 고정 typed packet으로 변환합니다.
 * packet과 모든 typed array, presentation scratch 및 override 객체는 생성 시 한 번만
 * 할당하고 이후 프레임에는 같은 identity를 덮어씁니다.
 */
export class TitleCpuEnemyPresentationAdapter {
    #packet;
    #presentationState;
    #softnessOverrides;
    #coreOverrides;

    constructor() {
        const records = new Float32Array(
            TITLE_CPU_ENEMY_PRESENTATION_MAX_RECORDS * TITLE_CPU_ENEMY_PRESENTATION_RECORD_FLOATS
        );
        const layerRecordStarts = new Uint16Array(TITLE_CPU_ENEMY_PRESENTATION_LAYER_CAPACITY);
        const layerRecordCounts = new Uint16Array(TITLE_CPU_ENEMY_PRESENTATION_LAYER_CAPACITY);
        this.#packet = Object.seal({
            records,
            recordCount: 0,
            usedByteLength: 0,
            recordStrideFloats: TITLE_CPU_ENEMY_PRESENTATION_RECORD_FLOATS,
            recordStrideBytes: TITLE_CPU_ENEMY_PRESENTATION_RECORD_BYTES,
            maxRecordCount: TITLE_CPU_ENEMY_PRESENTATION_MAX_RECORDS,
            layerCount: 0,
            layerRecordStarts,
            layerRecordCounts,
            overflowed: false,
            droppedRecordCount: 0,
            unsupportedRecordCount: 0
        });
        this.#presentationState = {
            shape: '',
            x: 0,
            y: 0,
            w: 0,
            h: 0,
            fill: '',
            alpha: 0,
            rotation: 0,
            rotationCos: 1,
            rotationSin: 0
        };
        this.#softnessOverrides = {
            alpha: 0,
            sizeScale: 1,
            offsetX: 0,
            offsetY: 0
        };
        this.#coreOverrides = {
            alpha: 1,
            sizeScale: 1,
            offsetX: 0,
            offsetY: 0
        };
    }

    /**
     * 레거시 타이틀 렌더와 같은 계층 및 enemy 순서로 현재 presentation packet을 덮어씁니다.
     * @param {object[]} titleEnemies - CPU simulation이 소유한 타이틀 적 배열입니다.
     * @param {object[]} parallaxLayers - far, mid, near 순서의 페럴랙스 프로필입니다.
     * @returns {object} identity가 고정된 typed presentation packet입니다.
     */
    writePacket(titleEnemies, parallaxLayers) {
        const packet = this.#packet;
        packet.recordCount = 0;
        packet.usedByteLength = 0;
        packet.layerCount = 0;
        packet.layerRecordStarts.fill(0);
        packet.layerRecordCounts.fill(0);
        packet.overflowed = false;
        packet.droppedRecordCount = 0;
        packet.unsupportedRecordCount = 0;

        const enemies = Array.isArray(titleEnemies) ? titleEnemies : null;
        if (!enemies || enemies.length === 0) {
            return packet;
        }

        const layers = Array.isArray(parallaxLayers) ? parallaxLayers : null;
        if (!layers || layers.length === 0) {
            packet.layerCount = 1;
            packet.layerRecordStarts[0] = 0;
            for (let enemyIndex = 0; enemyIndex < enemies.length; enemyIndex++) {
                this.#writeCoreRecord(enemies[enemyIndex], 0);
            }
            packet.layerRecordCounts[0] = packet.recordCount;
            packet.usedByteLength = packet.recordCount * TITLE_CPU_ENEMY_PRESENTATION_RECORD_BYTES;
            return packet;
        }

        const layerCount = Math.min(layers.length, TITLE_CPU_ENEMY_PRESENTATION_LAYER_CAPACITY);
        packet.layerCount = layerCount;
        for (let layerIndex = 0; layerIndex < layerCount; layerIndex++) {
            const layerStart = packet.recordCount;
            packet.layerRecordStarts[layerIndex] = layerStart;
            const layerProfile = layers[layerIndex];
            if (layerProfile) {
                for (let enemyIndex = 0; enemyIndex < enemies.length; enemyIndex++) {
                    const enemy = enemies[enemyIndex];
                    if (!enemy || enemy._titleParallaxLayerIndex !== layerIndex) {
                        continue;
                    }
                    this.#writeLayerRecords(enemy, layerProfile, layerIndex);
                }
            }
            packet.layerRecordCounts[layerIndex] = packet.recordCount - layerStart;
        }

        packet.usedByteLength = packet.recordCount * TITLE_CPU_ENEMY_PRESENTATION_RECORD_BYTES;
        return packet;
    }

    /**
     * @param {object} enemy - 기록할 적입니다.
     * @param {object} layerProfile - 현재 페럴랙스 프로필입니다.
     * @param {number} layerIndex - 현재 계층 인덱스입니다.
     * @returns {void}
     * @private
     */
    #writeLayerRecords(enemy, layerProfile, layerIndex) {
        const softnessAlpha = resolveFiniteNumber(layerProfile.SoftnessAlpha, 0);
        const softnessScale = resolveFiniteNumber(layerProfile.SoftnessScale, 1);
        if (softnessAlpha > 0.001 && softnessScale > 1) {
            const softnessOverrides = this.#softnessOverrides;
            softnessOverrides.alpha = Math.min(
                1,
                enemy.alpha * softnessAlpha * TITLE_CPU_ENEMY_SOFTNESS_ALPHA_MULTIPLIER
            );
            softnessOverrides.sizeScale = softnessScale * TITLE_CPU_ENEMY_SOFTNESS_SCALE_EXPANSION;
            const softnessOffset = resolveFiniteNumber(layerProfile.SoftnessOffsetPx, 0) * 0.25;
            softnessOverrides.offsetX = softnessOffset;
            softnessOverrides.offsetY = softnessOffset;
            this.#writeRecord(enemy, softnessOverrides, layerIndex, true);
        }

        this.#writeCoreRecord(enemy, layerIndex);
    }

    /**
     * @param {object} enemy - 기록할 적입니다.
     * @param {number} layerIndex - 현재 계층 인덱스입니다.
     * @returns {void}
     * @private
     */
    #writeCoreRecord(enemy, layerIndex) {
        const coreOverrides = this.#coreOverrides;
        coreOverrides.alpha = enemy?.alpha;
        this.#writeRecord(enemy, coreOverrides, layerIndex, false);
    }

    /**
     * @param {object} enemy - 기록할 적입니다.
     * @param {object} overrides - ShapeEnemy presentation override입니다.
     * @param {number} layerIndex - 현재 계층 인덱스입니다.
     * @param {boolean} softness - softness 보조 레코드 여부입니다.
     * @returns {void}
     * @private
     */
    #writeRecord(enemy, overrides, layerIndex, softness) {
        if (!enemy || typeof enemy.writePresentationState !== 'function') {
            return;
        }

        const state = this.#presentationState;
        if (!enemy.writePresentationState(state, overrides)) {
            return;
        }

        const shapeCode = TITLE_CPU_ENEMY_STYLE_CODE_BY_SHAPE[state.shape];
        if (!Number.isInteger(shapeCode)) {
            this.#packet.unsupportedRecordCount += 1;
            return;
        }

        const packet = this.#packet;
        if (packet.recordCount >= TITLE_CPU_ENEMY_PRESENTATION_MAX_RECORDS) {
            packet.overflowed = true;
            packet.droppedRecordCount += 1;
            return;
        }

        const recordOffset = packet.recordCount * TITLE_CPU_ENEMY_PRESENTATION_RECORD_FLOATS;
        const records = packet.records;
        records[recordOffset + TITLE_CPU_ENEMY_PRESENTATION_OFFSET.X] = state.x;
        records[recordOffset + TITLE_CPU_ENEMY_PRESENTATION_OFFSET.Y] = state.y;
        records[recordOffset + TITLE_CPU_ENEMY_PRESENTATION_OFFSET.WIDTH] = state.w;
        records[recordOffset + TITLE_CPU_ENEMY_PRESENTATION_OFFSET.HEIGHT] = state.h;
        records[recordOffset + TITLE_CPU_ENEMY_PRESENTATION_OFFSET.ROTATION_COS] = state.rotationCos;
        records[recordOffset + TITLE_CPU_ENEMY_PRESENTATION_OFFSET.ROTATION_SIN] = state.rotationSin;
        records[recordOffset + TITLE_CPU_ENEMY_PRESENTATION_OFFSET.ALPHA] = state.alpha;
        records[recordOffset + TITLE_CPU_ENEMY_PRESENTATION_OFFSET.STYLE_CODE] = encodeStyleCode(
            shapeCode,
            layerIndex,
            softness
        );
        packet.recordCount += 1;
    }
}
