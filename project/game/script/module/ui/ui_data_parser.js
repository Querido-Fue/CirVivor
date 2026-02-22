import { BUTTON_CONSTANTS } from 'data/ui/button_constants.js';
import { UI_CONSTANTS } from 'data/ui/ui_constants.js';
import { TEXT_CONSTANTS } from 'data/ui/text_constants.js';
import { getWW, getWH } from 'display/_display_system.js';

let uiDataParserInstance = null;

export class UIDataParser {
    constructor() {
        if (uiDataParserInstance) return uiDataParserInstance;
        uiDataParserInstance = this;

        // 문자열 경로 조회용 루트 네임스페이스 테이블
        this._namespaces = {
            UI_CONSTANTS,
            BUTTON_CONSTANTS,
            TEXT_CONSTANTS,
        };
    }

    /**
     * 문자열 경로 또는 { BASE, VALUE } 객체를 실제 픽셀 float 값으로 환산합니다.
     * @param {string|{ BASE: string, VALUE: number }|number} data
     *   - string: "UI_CONSTANTS.UI_RADIUS" 형식의 경로
     *   - object: { BASE, VALUE } 형식의 상수 데이터
     *   - number: 그대로 반환
     * @param {number} [uiScale=1] - uiScale 값 (설정 반영)
     * @returns {number} 환산된 픽셀 float 값
     */
    parse(data, uiScale = 1) {
        if (data === null || data === undefined) {
            console.warn('[UIDataParser] parse()에 null 또는 undefined가 전달되었습니다.');
            return 0;
        }

        if (typeof data === 'number') return data;

        if (typeof data === 'string') {
            data = this._resolveByPath(data);
            if (data === null) return 0;
        }

        if (typeof data !== 'object' || data.BASE === undefined || data.VALUE === undefined) {
            console.warn('[UIDataParser] parse()에 유효하지 않은 데이터가 전달되었습니다:', data);
            return 0;
        }

        const WW = getWW();
        const WH = getWH();

        switch (data.BASE) {
            case 'WW':
                return (data.VALUE / 100) * WW * uiScale;
            case 'WH':
                return (data.VALUE / 100) * WH * uiScale;
            case 'absolute':
                return data.VALUE * uiScale;
            default:
                console.warn(`[UIDataParser] 알 수 없는 BASE 단위: "${data.BASE}"`);
                return 0;
        }
    }

    /**
     * "UI_CONSTANTS.UI_RADIUS" 등의 점(.) 경로 문자열로 상수를 조회합니다.
     * @param {string} path
     * @returns {{ BASE: string, VALUE: number }|null}
     */
    _resolveByPath(path) {
        const keys = path.split('.');
        let current = this._namespaces;

        for (const key of keys) {
            if (current === null || current === undefined || typeof current !== 'object') {
                console.warn(`[UIDataParser] "${path}" 경로를 찾을 수 없습니다. ("${key}" 에서 탐색 실패)`);
                return null;
            }
            current = current[key];
        }

        if (current === null || current === undefined) {
            console.warn(`[UIDataParser] "${path}" 경로의 값이 없습니다.`);
            return null;
        }

        return current;
    }
}

export const parseUIData = (data, uiScale = 1) => {
    if (!uiDataParserInstance) {
        console.warn('[UIDataParser] 인스턴스가 초기화되지 않았습니다.');
        return 0;
    }
    return uiDataParserInstance.parse(data, uiScale);
};