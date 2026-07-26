import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GAME_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPT_ROOT = path.join(GAME_ROOT, 'script');
const ALIAS_ROOTS = Object.freeze({
    'animation/': path.join(SCRIPT_ROOT, 'module', 'animation'),
    'data/': path.join(SCRIPT_ROOT, 'data'),
    'debug/': path.join(SCRIPT_ROOT, 'module', 'debug'),
    'display/': path.join(SCRIPT_ROOT, 'module', 'display'),
    'game/': SCRIPT_ROOT,
    'ingame/': path.join(SCRIPT_ROOT, 'module', 'ingame'),
    'input/': path.join(SCRIPT_ROOT, 'module', 'input'),
    'object/': path.join(SCRIPT_ROOT, 'module', 'object'),
    'overlay/': path.join(SCRIPT_ROOT, 'module', 'overlay'),
    'physics/': path.join(SCRIPT_ROOT, 'module', 'physics'),
    'save/': path.join(SCRIPT_ROOT, 'module', 'save'),
    'scene/': path.join(SCRIPT_ROOT, 'module', 'scene'),
    'simulation/': path.join(SCRIPT_ROOT, 'module', 'simulation'),
    'sound/': path.join(SCRIPT_ROOT, 'module', 'sound'),
    'ui/': path.join(SCRIPT_ROOT, 'module', 'ui'),
    'util/': path.join(SCRIPT_ROOT, 'util')
});

const context = vm.createContext({ console });
const moduleCache = new Map();

/**
 * 게임 모듈을 처음 불러오기 전에 VM 전역에 테스트 런타임 어댑터를 설치합니다.
 * NW.js 전용 모듈처럼 명시적인 전역이 필요한 production graph를 계약 테스트에서
 * 실행할 때 사용하며, 모듈 평가가 시작된 뒤에는 graph 상태가 달라지지 않도록 거부합니다.
 * @param {Record<string, *>} globals - VM 전역에 추가할 값입니다.
 * @returns {void}
 */
export function installSourceModuleTestGlobals(globals = {}) {
    if (!globals || typeof globals !== 'object') {
        throw new TypeError('테스트 VM 전역은 객체여야 합니다.');
    }
    if (moduleCache.size > 0) {
        throw new Error('게임 모듈을 불러온 뒤에는 테스트 VM 전역을 변경할 수 없습니다.');
    }

    Object.assign(context, globals);
}

/**
 * importmap 별칭과 상대 경로를 테스트용 파일 URL로 변환합니다.
 * @param {string} specifier - import 대상 경로입니다.
 * @param {string} parentUrl - import를 요청한 모듈 URL입니다.
 * @returns {string} 해석된 파일 URL입니다.
 */
function resolveModuleUrl(specifier, parentUrl) {
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
        return new URL(specifier, parentUrl).href;
    }

    for (const [prefix, root] of Object.entries(ALIAS_ROOTS)) {
        if (specifier.startsWith(prefix)) {
            return pathToFileURL(path.join(root, specifier.slice(prefix.length))).href;
        }
    }

    throw new Error(`지원하지 않는 모듈 경로입니다: ${specifier}`);
}

/**
 * 파일 URL의 ESM 모듈을 생성합니다.
 * @param {string} moduleUrl - 대상 파일 URL입니다.
 * @returns {Promise<vm.SourceTextModule>} 생성된 모듈입니다.
 */
async function createModuleByUrl(moduleUrl) {
    const source = await readFile(fileURLToPath(moduleUrl), 'utf8');
    const module = new vm.SourceTextModule(source, {
        context,
        identifier: moduleUrl,
        initializeImportMeta(meta) {
            meta.url = moduleUrl;
        }
    });
    return module;
}

/**
 * 동일 URL의 모듈 생성 Promise를 재사용합니다.
 * @param {string} moduleUrl - 대상 파일 URL입니다.
 * @returns {Promise<vm.SourceTextModule>} 캐시된 모듈 Promise입니다.
 */
function getModuleByUrl(moduleUrl) {
    if (!moduleCache.has(moduleUrl)) {
        moduleCache.set(moduleUrl, createModuleByUrl(moduleUrl));
    }
    return moduleCache.get(moduleUrl);
}

/**
 * 파일 URL의 ESM 그래프를 링크하고 평가합니다.
 * @param {string} moduleUrl - 대상 파일 URL입니다.
 * @returns {Promise<vm.SourceTextModule>} 평가된 모듈입니다.
 */
async function loadModuleByUrl(moduleUrl) {
    const module = await getModuleByUrl(moduleUrl);
    if (module.status === 'unlinked') {
        await module.link((specifier, referencingModule) => {
            return getModuleByUrl(resolveModuleUrl(specifier, referencingModule.identifier));
        });
    }
    if (module.status === 'linked') {
        await module.evaluate();
    }
    return module;
}

/**
 * 게임 importmap 별칭을 사용하는 모듈을 Node 계약 테스트에서 불러옵니다.
 * @param {string} specifier - 게임 importmap 기준 모듈 경로입니다.
 * @returns {Promise<object>} 모듈 namespace입니다.
 */
export async function loadGameModule(specifier) {
    const entryUrl = resolveModuleUrl(specifier, pathToFileURL(path.join(GAME_ROOT, 'index.html')).href);
    const module = await loadModuleByUrl(entryUrl);
    return module.namespace;
}
