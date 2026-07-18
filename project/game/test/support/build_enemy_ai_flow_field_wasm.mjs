/**
 * WABT로 적 AI flow field WAT를 컴파일하고 결정적인 JS 바이트 모듈을 생성합니다.
 * 기본 실행은 생성물을 갱신하며, `--check`는 파일을 수정하지 않고 재현성을 검사합니다.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import wabtFactory from 'wabt';

const WABT_VERSION = '1.0.39';
const WAT_PATH = fileURLToPath(new URL(
    '../../script/module/object/enemy/ai/wasm/_enemy_ai_flow_field.wat',
    import.meta.url
));
const OUTPUT_PATH = fileURLToPath(new URL(
    '../../script/module/object/enemy/ai/wasm/_enemy_ai_flow_field_wasm_bytes.js',
    import.meta.url
));
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const wabt = await wabtFactory();

/**
 * 텍스트의 줄바꿈을 LF로 통일해 플랫폼별 체크아웃 차이를 제거합니다.
 * @param {string} source - 정규화할 텍스트입니다.
 * @returns {string} LF 줄바꿈으로 정규화한 텍스트입니다.
 */
function normalizeLineEndings(source) {
    return source.replace(/\r\n/g, '\n');
}

/**
 * 입력 바이트의 SHA-256 해시를 계산합니다.
 * @param {string|Uint8Array} value - 해시할 텍스트 또는 바이트입니다.
 * @returns {string} 소문자 16진수 SHA-256입니다.
 */
function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

/**
 * 잠금 파일로 고정된 WABT를 사용해 WAT를 결정적 WASM 바이트로 컴파일합니다.
 * @param {string} watSource - LF로 정규화된 WAT 원문입니다.
 * @returns {Uint8Array} 컴파일된 WASM 바이트입니다.
 */
function compileWat(watSource) {
    const module = wabt.parseWat(WAT_PATH, watSource);
    try {
        module.validate();
        const { buffer } = module.toBinary({
            canonicalize_lebs: true,
            log: false,
            relocatable: false,
            write_debug_names: false
        });
        return new Uint8Array(buffer);
    } finally {
        module.destroy();
    }
}

/**
 * WASM 바이트를 읽기 쉬운 16진수 배열 행으로 직렬화합니다.
 * @param {Uint8Array} bytes - 직렬화할 WASM 바이트입니다.
 * @returns {string} 들여쓰기된 배열 본문입니다.
 */
function formatByteRows(bytes) {
    const rows = [];
    for (let offset = 0; offset < bytes.length; offset += 16) {
        const row = Array.from(bytes.subarray(offset, offset + 16), (value) => (
            `0x${value.toString(16).padStart(2, '0')}`
        ));
        rows.push(`    ${row.join(', ')}`);
    }
    return rows.join(',\n');
}

/**
 * 현재 WAT와 WABT 결과로 생성될 JS 바이트 모듈 전체 텍스트를 만듭니다.
 * @returns {string} 결정적으로 생성된 JS 모듈 텍스트입니다.
 */
export function buildGeneratedModuleText() {
    const watSource = normalizeLineEndings(readFileSync(WAT_PATH, 'utf8'));
    const bytes = compileWat(watSource);
    const sourceHash = sha256(watSource);
    const artifactHash = sha256(bytes);
    return `/**
 * 이 파일은 build_enemy_ai_flow_field_wasm.mjs가 생성합니다.
 * 원본 WAT 또는 빌드 스크립트를 수정한 뒤 재생성하며 직접 편집하지 않습니다.
 */

/** WAT 원문의 정규화된 SHA-256입니다. */
export const ENEMY_AI_FLOW_FIELD_WAT_SHA256 = '${sourceHash}';

/** 생성된 WASM 바이트의 SHA-256입니다. */
export const ENEMY_AI_FLOW_FIELD_WASM_SHA256 = '${artifactHash}';

/** WABT ${WABT_VERSION}로 생성한 적 AI flow field WASM 바이트입니다. */
export const ENEMY_AI_FLOW_FIELD_WASM_BYTES = new Uint8Array([
${formatByteRows(bytes)}
]);
`;
}

/**
 * CLI 인수에 따라 생성물을 기록하거나 재현성을 검사하거나 표준 출력으로 보냅니다.
 * @param {string[]} args - 명령행 인수입니다.
 * @returns {void}
 */
export function main(args) {
    const generated = buildGeneratedModuleText();
    if (args.includes('--print')) {
        process.stdout.write(generated);
        return;
    }

    if (args.includes('--check')) {
        const current = normalizeLineEndings(readFileSync(OUTPUT_PATH, 'utf8'));
        if (current !== normalizeLineEndings(generated)) {
            throw new Error('WAT와 생성된 JS WASM 바이트 모듈이 일치하지 않습니다.');
        }
        process.stdout.write('WAT/WASM 생성물 재현성 검사 통과\n');
        return;
    }

    writeFileSync(OUTPUT_PATH, generated, 'utf8');
    process.stdout.write(`${OUTPUT_PATH}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
    main(process.argv.slice(2));
}
