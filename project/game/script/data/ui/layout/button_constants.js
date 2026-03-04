/**
 * UI 버튼 레이아웃 및 폰트 관련 설정 상수 모음
 */
export const BUTTON_CONSTANTS = {
    // 오버레이 상호작용 버튼 (예, 아니오 등)
    OVERLAY_INTERACT_BUTTON: {
        WIDTH: {
            BASE: "WW",
            VALUE: 7
        }, //모든 레이아웃 관련 상수는 %입니다. 예를 들어 WW 8이면, 화면 너비의 8%를 의미합니다.
        HEIGHT: {
            BASE: "WH",
            VALUE: 3.5
        },
        MARGIN: {
            BASE: "WW",
            VALUE: 0.8
        },
        RADIUS: {
            BASE: "WW",
            VALUE: 0.3
        },
        FONT: {
            SIZE: {
                BASE: "WW",
                VALUE: 1.0
            },
            WEIGHT: 600,
            FAMILY: "Pretendard Variable, arial"
        },
        ALIGN: 'right',
    },
    OVERLAY_LINK_BUTTON: {
        WIDTH: {
            BASE: "WW",
            VALUE: 6
        },
        HEIGHT: {
            BASE: "WH",
            VALUE: 3
        },
        MARGIN: {
            BASE: "WW",
            VALUE: 0.65
        },
        RADIUS: {
            BASE: "WW",
            VALUE: 0.3
        },
        FONT: {
            SIZE: {
                BASE: "WW",
                VALUE: 0.8
            },
            WEIGHT: 500,
            FAMILY: "Pretendard Variable, arial"
        },
        ICON_TYPE: "arrow",
        ALIGN: 'right',
    }
};