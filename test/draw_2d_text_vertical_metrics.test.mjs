import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const { renderDrawText } = await loadGameModule('display/draw_2d_shapes.js');
const { getCanvasTextVerticalMetricOffset } = await loadGameModule('util/font_util.js');

/**
 * 지정한 font 메트릭을 반환하고 실제 draw 좌표를 기록하는 context stub을 만듭니다.
 * @param {object} metrics - measureText 반환 메트릭입니다.
 * @param {string} [font='700 48px "SUIT Variable"'] - Canvas font 문자열입니다.
 * @returns {object} 테스트용 context입니다.
 */
function createContext(metrics, font = '700 48px "SUIT Variable"') {
    return {
        font,
        textBaseline: 'alphabetic',
        fillTextCalls: [],
        translateCalls: [],
        measureText() {
            return metrics;
        },
        fillText(...args) {
            this.fillTextCalls.push(args);
        },
        save() {},
        restore() {},
        rotate() {},
        translate(...args) {
            this.translateCalls.push(args);
        }
    };
}

test('middle 텍스트는 폰트 박스의 위아래 메트릭 중심에 놓인다', () => {
    const context = createContext({
        fontBoundingBoxAscent: 33,
        fontBoundingBoxDescent: 26
    });

    renderDrawText(context, {
        text: '설정',
        x: 80,
        y: 40,
        baseline: 'middle'
    });

    assert.deepEqual(context.fillTextCalls, [['설정', 80, 43.5]]);
});

test('top 텍스트는 font-size 높이 안에서 폰트 박스 중심을 맞춘다', () => {
    const context = createContext({
        fontBoundingBoxAscent: 9,
        fontBoundingBoxDescent: 50
    });

    renderDrawText(context, {
        text: '설정',
        x: 80,
        y: 20,
        baseline: 'top'
    });

    assert.deepEqual(context.fillTextCalls, [['설정', 80, 23.5]]);
});

test('회전 텍스트도 보정된 중심을 회전 원점으로 사용한다', () => {
    const context = createContext({
        fontBoundingBoxAscent: 17.5,
        fontBoundingBoxDescent: 14.5
    }, '600 25px "SUIT Variable"');

    renderDrawText(context, {
        text: '저장',
        x: 30,
        y: 25,
        baseline: 'middle',
        rotation: 12
    });

    assert.deepEqual(context.translateCalls, [[30, 26.5]]);
    assert.deepEqual(context.fillTextCalls, [['저장', 0, 0]]);
});

test('폰트 박스 메트릭이 없거나 alphabetic 기준선이면 좌표를 유지한다', () => {
    const noMetricsContext = createContext({ width: 42 });
    const alphabeticContext = createContext({
        fontBoundingBoxAscent: 33,
        fontBoundingBoxDescent: 26
    });

    renderDrawText(noMetricsContext, {
        text: '저장',
        x: 10,
        y: 20,
        baseline: 'middle'
    });
    renderDrawText(alphabeticContext, {
        text: '저장',
        x: 10,
        y: 20,
        baseline: 'alphabetic'
    });

    assert.deepEqual(noMetricsContext.fillTextCalls, [['저장', 10, 20]]);
    assert.deepEqual(alphabeticContext.fillTextCalls, [['저장', 10, 20]]);
});

test('연속 크기 변경의 글꼴 메트릭 캐시는 오래된 항목을 버리고 같은 값으로 재측정한다', () => {
    let measurements = 0;
    const context = {
        font: '12px sans-serif', textBaseline: 'middle',
        measureText() {
            measurements++;
            const size = Number.parseFloat(this.font);
            return { fontBoundingBoxAscent: size * 0.8, fontBoundingBoxDescent: size * 0.2 };
        }
    };
    const firstOffset = getCanvasTextVerticalMetricOffset(context);
    assert.equal(getCanvasTextVerticalMetricOffset(context), firstOffset);
    assert.equal(measurements, 1);
    for (let size = 13; size <= 2048; size++) {
        context.font = `${size}px sans-serif`;
        const expected = (size * 0.8 - size * 0.2) * 0.5;
        assert.equal(getCanvasTextVerticalMetricOffset(context), expected);
    }
    const beforeRepeat = measurements;
    getCanvasTextVerticalMetricOffset(context);
    assert.equal(measurements, beforeRepeat, 'recent font should remain cached');
    context.font = '12px sans-serif';
    assert.equal(getCanvasTextVerticalMetricOffset(context), firstOffset);
    assert.equal(measurements, beforeRepeat + 1, 'old font should have been evicted');
    assert.equal(getCanvasTextVerticalMetricOffset(context), firstOffset);
    assert.equal(measurements, beforeRepeat + 1);
});
