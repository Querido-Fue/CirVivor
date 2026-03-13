import { DeckOverlay } from 'overlay/title/_deck.js';
import { QuickStartOverlay } from 'overlay/title/_quick_start.js';
import { RecordsOverlay } from 'overlay/title/_records.js';
import { ResearchOverlay } from 'overlay/title/_research.js';

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
     * @param {TitleScene} titleScene - 타이틀 씬 인스턴스입니다.
     */
    constructor(titleScene) {
        this.titleScene = titleScene;
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
        return Object.freeze([
            this._createCardDefinition({
                id: 'start',
                layoutSlot: 'start',
                titleKey: 'title_card_start_title',
                descriptionKey: null,
                actionType: 'scene',
                actionKey: 'gameStart',
                overlayClass: null,
                placeholder: false
            }),
            this._createCardDefinition({
                id: 'quick_start',
                layoutSlot: 'quick_start',
                titleKey: 'title_card_quick_start_title',
                descriptionKey: 'title_card_quick_start_desc',
                actionType: 'overlay',
                actionKey: 'quickStart',
                overlayClass: QuickStartOverlay,
                placeholder: true
            }),
            this._createCardDefinition({
                id: 'records',
                layoutSlot: 'records',
                titleKey: 'title_card_records_title',
                descriptionKey: null,
                actionType: 'overlay',
                actionKey: 'records',
                overlayClass: RecordsOverlay,
                placeholder: true
            }),
            this._createCardDefinition({
                id: 'deck',
                layoutSlot: 'deck',
                titleKey: 'title_card_deck_title',
                descriptionKey: 'title_card_deck_desc',
                actionType: 'overlay',
                actionKey: 'deck',
                overlayClass: DeckOverlay,
                placeholder: false
            }),
            this._createCardDefinition({
                id: 'research',
                layoutSlot: 'research',
                titleKey: 'title_card_research_title',
                descriptionKey: 'title_card_research_desc',
                actionType: 'overlay',
                actionKey: 'research',
                overlayClass: ResearchOverlay,
                placeholder: true
            })
        ]);
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
}
