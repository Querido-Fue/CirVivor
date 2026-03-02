/**
 * NW.js 및 Node.js 내장 모듈 브릿지
 * 브라우저 기반의 ES 모듈(import) 환경에서 NW.js 전역 require를 통해 Node 모듈을 가져올 수 있게 합니다.
 */

const hasWindow = typeof window !== 'undefined';
const hasNw = hasWindow && typeof window.nw !== 'undefined';
const hasRequire = hasWindow && typeof window.require === 'function';
const isNw = hasNw && hasRequire;

/**
 * 현재 런타임이 NW.js인지 여부를 반환합니다.
 * @returns {boolean}
 */
//export const isNwRuntime = () => isNw;
export const isNwRuntime = () => false;

/**
 * nw 전역 객체
 * @type {typeof nw}
 */
export const nw = isNw ? window.nw : null;

/**
 * fs/promises 모듈
 * @type {typeof import('fs/promises')}
 */
export const fsPromises = isNw ? window.require('fs').promises : null;

/**
 * path 모듈
 * @type {typeof import('path')}
 */
export const path = isNw ? window.require('path') : null;
