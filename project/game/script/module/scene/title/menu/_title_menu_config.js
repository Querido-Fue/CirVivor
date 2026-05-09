import { getData } from 'data/data_handler.js';

const TITLE_MENU_DATA = getData('TITLE_MENU_DATA');

/**
 * 타이틀 카드 등장 순서입니다.
 * @type {readonly string[]}
 */
export const TITLE_MENU_CARD_REVEAL_ORDER = TITLE_MENU_DATA.CARD_REVEAL_ORDER;

/**
 * 하단 보조 메뉴 항목 정의입니다.
 * @type {readonly object[]}
 */
export const TITLE_MENU_SECONDARY_ENTRIES = TITLE_MENU_DATA.SECONDARY_ENTRIES;
