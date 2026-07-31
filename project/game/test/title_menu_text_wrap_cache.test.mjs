import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const TEXT_RENDER_PATH = new URL(
    '../script/module/scene/title/menu/_title_menu_text_render.js',
    import.meta.url
);
const textRenderSource = await readFile(TEXT_RENDER_PATH, 'utf8');

/**
 * 명령 순서와 폭 측정 횟수를 기록하는 최소 Canvas 2D 대역을 만듭니다.
 * @returns {{commands: unknown[][], measureCalls: string[], context: CanvasRenderingContext2D}}
 */
function createCanvasContextStub() {
    const commands = [];
    const measureCalls = [];
    const context = {
        save() {
            commands.push(['save']);
        },
        restore() {
            commands.push(['restore']);
        },
        set font(value) {
            commands.push(['font', value]);
        },
        set fillStyle(value) {
            commands.push(['fillStyle', value]);
        },
        set textAlign(value) {
            commands.push(['textAlign', value]);
        },
        set textBaseline(value) {
            commands.push(['textBaseline', value]);
        },
        measureText(line) {
            measureCalls.push(line);
            return { width: line.length * 10 };
        },
        fillText(line, x, y) {
            commands.push(['fillText', line, x, y]);
        }
    };
    return { commands, measureCalls, context };
}

/**
 * 실제 텍스트 렌더 모듈에 줄바꿈 함수 대역을 주입해 로드합니다.
 * @param {(text: string, options: object) => string[]} wrapTextByWords - 줄바꿈 대역입니다.
 * @param {object} [globals={}] - VM 전역에 추가할 값입니다.
 * @returns {Promise<(context: CanvasRenderingContext2D, options: object) => void>} 렌더 함수입니다.
 */
async function loadDrawTitleMenuWrappedText(wrapTextByWords, globals = {}) {
    const context = vm.createContext(globals);
    const textRenderModule = new vm.SourceTextModule(textRenderSource, {
        context,
        identifier: TEXT_RENDER_PATH.href
    });
    const fontUtilModule = new vm.SyntheticModule([
        'getCanvasTextVerticalMetricOffset',
        'wrapTextByWords'
    ], function initialize() {
        this.setExport('getCanvasTextVerticalMetricOffset', () => 0);
        this.setExport('wrapTextByWords', wrapTextByWords);
    }, { context, identifier: 'synthetic:util/font_util.js' });

    await textRenderModule.link((specifier) => {
        assert.equal(specifier, 'util/font_util.js');
        return fontUtilModule;
    });
    await textRenderModule.evaluate();
    return textRenderModule.namespace.drawTitleMenuWrappedText;
}

/**
 * 줄 단위 폭 측정을 수행하는 결정적인 줄바꿈 대역입니다.
 * @param {{count: number}} wrapCounter - 줄바꿈 호출 횟수입니다.
 * @returns {(text: string, options: {measureWidth: (line: string) => number}) => string[]} 대역 함수입니다.
 */
function createWrapTextStub(wrapCounter) {
    return (text, options) => {
        wrapCounter.count++;
        const lines = text.split('|');
        for (const line of lines) {
            options.measureWidth(line);
        }
        return lines;
    };
}

/**
 * 공통 타이틀 메뉴 텍스트 렌더 옵션을 만듭니다.
 * @param {object} overrides - 기본값을 덮어쓸 옵션입니다.
 * @returns {object} 렌더 옵션입니다.
 */
function createOptions(overrides = {}) {
    return {
        text: 'alpha|beta',
        font: '600 18px sans-serif',
        maxWidth: 180,
        fillStyle: '#c0ffee',
        align: 'center',
        x: 12,
        y: 24,
        lineHeight: 10,
        ...overrides
    };
}

test('같은 context·텍스트·font·폭은 줄바꿈과 폭 측정을 한 번만 수행하고 두 번 모두 같은 명령을 그린다', async () => {
    const wrapCounter = { count: 0 };
    const drawTitleMenuWrappedText = await loadDrawTitleMenuWrappedText(createWrapTextStub(wrapCounter));
    const canvas = createCanvasContextStub();
    const options = createOptions();

    drawTitleMenuWrappedText(canvas.context, options);
    drawTitleMenuWrappedText(canvas.context, options);

    assert.equal(wrapCounter.count, 1);
    assert.deepEqual(canvas.measureCalls, ['alpha', 'beta']);
    assert.deepEqual(canvas.commands, [
        ['save'],
        ['font', '600 18px sans-serif'],
        ['fillStyle', '#c0ffee'],
        ['textAlign', 'center'],
        ['textBaseline', 'top'],
        ['fillText', 'alpha', 12, 24],
        ['fillText', 'beta', 12, 34],
        ['restore'],
        ['save'],
        ['font', '600 18px sans-serif'],
        ['fillStyle', '#c0ffee'],
        ['textAlign', 'center'],
        ['textBaseline', 'top'],
        ['fillText', 'alpha', 12, 24],
        ['fillText', 'beta', 12, 34],
        ['restore']
    ]);
});

test('텍스트·font·maxWidth 중 하나가 달라지면 각각 줄바꿈 캐시 miss다', async () => {
    const wrapCounter = { count: 0 };
    const drawTitleMenuWrappedText = await loadDrawTitleMenuWrappedText(createWrapTextStub(wrapCounter));
    const canvas = createCanvasContextStub();

    drawTitleMenuWrappedText(canvas.context, createOptions({ text: 'base' }));
    drawTitleMenuWrappedText(canvas.context, createOptions({ text: 'changed-text' }));
    drawTitleMenuWrappedText(canvas.context, createOptions({ text: 'base', font: '700 18px sans-serif' }));
    drawTitleMenuWrappedText(canvas.context, createOptions({ text: 'base', maxWidth: 181 }));

    assert.equal(wrapCounter.count, 4);
    assert.deepEqual(canvas.measureCalls, ['base', 'changed-text', 'base', 'base']);
});

test('다른 context는 miss이며 텍스트당 아홉 번째 variant 뒤 첫 variant는 FIFO로 제거된다', async () => {
    const wrapCounter = { count: 0 };
    const drawTitleMenuWrappedText = await loadDrawTitleMenuWrappedText(createWrapTextStub(wrapCounter));
    const firstCanvas = createCanvasContextStub();
    const secondCanvas = createCanvasContextStub();
    const firstVariant = createOptions({ text: 'shared', maxWidth: 100 });

    drawTitleMenuWrappedText(firstCanvas.context, firstVariant);
    drawTitleMenuWrappedText(secondCanvas.context, firstVariant);
    for (let variant = 1; variant <= 8; variant++) {
        drawTitleMenuWrappedText(firstCanvas.context, createOptions({
            text: 'shared',
            maxWidth: 100 + variant
        }));
    }
    drawTitleMenuWrappedText(firstCanvas.context, firstVariant);

    assert.equal(wrapCounter.count, 11);
    assert.equal(firstCanvas.measureCalls.length, 10);
    assert.equal(secondCanvas.measureCalls.length, 1);
});

test('웹폰트 로딩 중에는 캐시하지 않고 상태 전환 뒤 이전 폭 측정 결과를 폐기한다', async () => {
    const wrapCounter = { count: 0 };
    const fontSet = { status: 'loading' };
    const drawTitleMenuWrappedText = await loadDrawTitleMenuWrappedText(
        createWrapTextStub(wrapCounter),
        { document: { fonts: fontSet } }
    );
    const canvas = createCanvasContextStub();
    const options = createOptions({ text: 'font-state' });

    drawTitleMenuWrappedText(canvas.context, options);
    drawTitleMenuWrappedText(canvas.context, options);
    assert.equal(wrapCounter.count, 2, 'loading 상태에서는 매번 다시 측정해야 합니다.');

    fontSet.status = 'loaded';
    drawTitleMenuWrappedText(canvas.context, options);
    drawTitleMenuWrappedText(canvas.context, options);
    assert.equal(wrapCounter.count, 3, 'loaded 전환 뒤 첫 결과만 측정하고 재사용해야 합니다.');

    fontSet.status = 'loading';
    drawTitleMenuWrappedText(canvas.context, options);
    fontSet.status = 'loaded';
    drawTitleMenuWrappedText(canvas.context, options);
    drawTitleMenuWrappedText(canvas.context, options);
    assert.equal(wrapCounter.count, 5, '새 로딩 주기 뒤 이전 캐시를 재사용하면 안 됩니다.');
});
