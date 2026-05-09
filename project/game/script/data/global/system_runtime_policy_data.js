/**
 * SystemHandler의 프레임 실행 정책과 런타임 설정 반영 키 목록입니다.
 */
export const SYSTEM_RUNTIME_POLICY_DATA = Object.freeze({
    DISPLAY_REFRESH_SETTING_KEYS: Object.freeze(['windowMode', 'widescreenSupport', 'renderScale']),
    SIMULATION_RUNTIME_SETTING_KEYS: Object.freeze([
        'debugMode'
    ]),
    DEFAULT_FRAME_EXECUTION_POLICY: Object.freeze({
        keepLoopRunning: true,
        runFrameTimeUpdate: true,
        runFixedStep: true,
        runSoundUpdate: true,
        runAnimationUpdate: true,
        runInputUpdate: true,
        runUiUpdate: true,
        runOverlayUpdate: true,
        runObjectUpdate: true,
        runSceneUpdate: true,
        runDebugUpdate: true,
        renderFrame: true,
        renderInput: true,
        renderObject: true,
        renderScene: true,
        renderUi: true,
        renderOverlay: true,
        renderDebug: true,
        renderSound: true,
        pauseBgm: false,
        resetInputOnEnter: false,
        setMouseInactiveOnEnter: false
    }),
    FRAME_EXECUTION_DISABLE_KEYS: Object.freeze([
        'keepLoopRunning',
        'runFrameTimeUpdate',
        'runFixedStep',
        'runSoundUpdate',
        'runAnimationUpdate',
        'runInputUpdate',
        'runUiUpdate',
        'runOverlayUpdate',
        'runObjectUpdate',
        'runSceneUpdate',
        'runDebugUpdate',
        'renderFrame',
        'renderInput',
        'renderObject',
        'renderScene',
        'renderUi',
        'renderOverlay',
        'renderDebug',
        'renderSound'
    ])
});
