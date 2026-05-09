import { getData } from 'data/data_handler.js';
import { DeckOverlay } from 'overlay/title/_deck.js';
import { QuickStartOverlay } from 'overlay/title/_quick_start.js';
import { RecordsOverlay } from 'overlay/title/_records.js';
import { ResearchOverlay } from 'overlay/title/_research.js';

const TITLE_MENU_CARD_DEFINITIONS = getData('TITLE_MENU_DATA').CARD_DEFINITIONS;

/**
 * @typedef {object} TitleMenuCardDefinition
 * @property {string} id - 카드 식별자입니다.
 * @property {string} layoutSlot - 레이아웃 배치 슬롯입니다.
 * @property {string} titleKey - 카드 제목 번역 키입니다.
 * @property {string|null} descriptionKey - 카드 설명 번역 키입니다.
 * @property {'scene'|'overlay'} actionType - 카드 액션 종류입니다.
 * @property {string} actionKey - 실행 대상 키입니다.
 * @property {Function|null} overlayClass - 연결된 overlay 클래스입니다.
 * @property {boolean} placeholder - 더미 구현 여부입니다.
 */

/**
 * @class TitleMenuCardRegistry
 * @description 타이틀 카드 메뉴의 메타데이터를 관리하는 레지스트리입니다.
 */
export class TitleMenuCardRegistry {
    /**
     * 카드 정의 레지스트리를 초기화합니다.
     */
    constructor() {
        this.cardDefinitions = this._createDefinitions();
    }

    /**
     * 등록된 카드 정의를 모두 반환합니다.
     * @returns {TitleMenuCardDefinition[]} 카드 정의 목록입니다.
     */
    getAll() {
        return this.cardDefinitions;
    }

    /**
     * 식별자로 카드 정의를 조회합니다.
     * @param {string} cardId - 조회할 카드 식별자입니다.
     * @returns {TitleMenuCardDefinition|null} 카드 정의입니다.
     */
    getById(cardId) {
        return this.cardDefinitions.find((cardDefinition) => cardDefinition.id === cardId) || null;
    }

    /**
     * 카드 정의 목록을 생성합니다.
     * @returns {TitleMenuCardDefinition[]} 생성된 카드 정의 목록입니다.
     * @private
     */
    _createDefinitions() {
        return Object.freeze(TITLE_MENU_CARD_DEFINITIONS.map((cardDefinition) => {
            return this._createCardDefinition({
                ...cardDefinition,
                overlayClass: this._getOverlayClass(cardDefinition.actionKey)
            });
        }));
    }

    /**
     * 카드 정의 하나를 정규화합니다.
     * @param {TitleMenuCardDefinition} cardDefinition - 정규화할 카드 정의입니다.
     * @returns {TitleMenuCardDefinition} 정규화된 카드 정의입니다.
     * @private
     */
    _createCardDefinition(cardDefinition) {
        return Object.freeze({
            id: cardDefinition.id,
            layoutSlot: cardDefinition.layoutSlot,
            titleKey: cardDefinition.titleKey,
            descriptionKey: cardDefinition.descriptionKey || null,
            actionType: cardDefinition.actionType,
            actionKey: cardDefinition.actionKey,
            overlayClass: cardDefinition.overlayClass || null,
            placeholder: cardDefinition.placeholder === true
        });
    }

    /**
     * 카드 액션 키에 연결된 overlay 클래스를 반환합니다.
     * @param {string} actionKey - 카드 액션 키입니다.
     * @returns {Function|null} 연결된 overlay 클래스입니다.
     * @private
     */
    _getOverlayClass(actionKey) {
        switch (actionKey) {
            case 'quickStart':
                return QuickStartOverlay;
            case 'records':
                return RecordsOverlay;
            case 'deck':
                return DeckOverlay;
            case 'research':
                return ResearchOverlay;
            default:
                return null;
        }
    }
}
