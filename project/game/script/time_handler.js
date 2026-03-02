/**
 * @class TimeHandler
 * @description 게임의 시간 델타(delta time), FPS, 프레임 타임 등을 관리하고 계산하는 클래스입니다.
 * 싱글톤 패턴으로 구현되어 전역적으로 접근 가능합니다.
 */

let timeHandlerInstance = null;

export class TimeHandler {
    constructor() {
        timeHandlerInstance = this;
        this.recentData = [];
        this.recentFixedData = [];
        this.timeBefore = performance.now();
        this.fixedTimeBefore = performance.now();
        this.updateStartTime = 0;
        this.drawStartTime = 0;
        this.updateTimeHistory = [];
        this.drawTimeHistory = [];
        this.data = {
            fps: 0,
            lowestFps: 0,
            lastFrameTimeDelta: 0,
            lastFixedTimeDelta: 1 / 60,
            currentFixedFps: 60,
            displayLastFrameTimeDelta: 0,
            lastUpdateTime: 0,
            lastDrawTime: 0,
            rawFrameTimeDelta: 0,
            avgFrameTime: 0,
            avgUpdateTime: 0,
            avgDrawTime: 0
        }
    }

    /**
     * 메인 루프 외에 고정 업데이트 루프의 시간 델타를 계산합니다.
     */
    fixedUpdate() {
        const now = performance.now();
        let delta = now - this.fixedTimeBefore;
        this.fixedTimeBefore = now;

        // 델타 값이 너무 튀는 것을 방지 (최대 0.1초)
        if (delta > 100) delta = 100;
        // 최소 2ms 보장
        if (delta < 2) delta = 2;

        this.data.lastFixedTimeDelta = delta / 1000;

        const instantaneousFps = delta > 0 ? Math.round(1000 / delta) : 0;
        this.recentFixedData.push({ time: now, fps: instantaneousFps });
        while (this.recentFixedData.length > 0 && now - this.recentFixedData[0].time > 1000) {
            this.recentFixedData.shift();
        }

        if (this.recentFixedData.length > 0) {
            const fpsValues = this.recentFixedData.map(d => d.fps);
            fpsValues.sort((a, b) => a - b);
            const trimCount = Math.floor(fpsValues.length * 0.02);
            const trimmedFpsValues = trimCount > 0 ? fpsValues.slice(0, -trimCount) : fpsValues;
            const totalFps = trimmedFpsValues.reduce((a, b) => a + b, 0);
            this.data.currentFixedFps = Math.floor(totalFps / trimmedFpsValues.length);
        }
    }

    /**
     * 매 프레임 호출되어 시간 델타 및 FPS를 업데이트합니다.
     */
    update() {
        const now = performance.now();
        let delta = now - this.timeBefore;
        this.timeBefore = now;

        this.data.rawFrameTimeDelta = delta / 1000; // 디버그용 원본 델타

        // 델타 값이 너무 튀는 것을 방지 (최대 0.1초)
        if (delta > 100) delta = 100;

        // 너무 짧은 프레임 델타 방지 (0으로 수렴하여 물리/애니가 멈추거나 튀는 현상 방지)
        // 렌더 루프 지연 후 연속 호출 시 delta가 1~2ms로 튀는 현상 방어
        // 최소 2ms (약 500fps 한계) 보장
        if (delta < 2) delta = 2;

        this.data.lastFrameTimeDelta = delta / 1000;

        // 디버그용 즉시 FPS (가독성을 위해 스무딩된 값 유지)
        // 프레임 타임은 즉시 값 사용
        const currentFps = delta > 0 ? Math.round(1000 / delta) : 60;

        // 최근 프레임 데이터 저장 (최근 1초간)
        this.recentData.push({
            time: now,
            fps: currentFps,
            rawFrameTimeDelta: this.data.rawFrameTimeDelta,
            lastUpdateTime: this.data.lastUpdateTime,
            lastDrawTime: this.data.lastDrawTime
        });

        while (this.recentData.length > 0 && now - this.recentData[0].time > 1000) {
            this.recentData.shift();
        }

        if (this.recentData.length > 0) {
            const fpsValues = this.recentData.map(d => d.fps);
            this.data.lowestFps = Math.min(...fpsValues);

            // 평균 프레임 계산 (상위 2% 제외: 비정상적으로 튀는 값 방어)
            fpsValues.sort((a, b) => a - b);
            const trimCount = Math.floor(fpsValues.length * 0.02);
            const trimmedFpsValues = trimCount > 0 ? fpsValues.slice(0, -trimCount) : fpsValues;

            const totalFps = trimmedFpsValues.reduce((a, b) => a + b, 0);
            this.data.fps = Math.floor(totalFps / trimmedFpsValues.length);

            // 스무딩된 시간 데이터 계산
            const rawFrameTimeValues = this.recentData.map(d => d.rawFrameTimeDelta);
            const updateTimeValues = this.recentData.map(d => d.lastUpdateTime);
            const drawTimeValues = this.recentData.map(d => d.lastDrawTime);

            this.data.avgFrameTime = rawFrameTimeValues.reduce((a, b) => a + b, 0) / this.recentData.length;
            this.data.avgUpdateTime = updateTimeValues.reduce((a, b) => a + b, 0) / this.recentData.length;
            this.data.avgDrawTime = drawTimeValues.reduce((a, b) => a + b, 0) / this.recentData.length;
        }
    }

    /**
     * 업데이트 로직 시작 시간을 기록합니다.
     */
    markUpdateStart() {
        this.updateStartTime = performance.now();
    }

    /**
     * 업데이트 로직 종료 시간을 기록하고 소요 시간을 계산합니다.
     */
    markUpdateEnd() {
        const now = performance.now();
        const duration = now - this.updateStartTime;
        this.data.lastUpdateTime = duration;
    }

    /**
     * 그리기 로직 시작 시간을 기록합니다.
     */
    markDrawStart() {
        this.drawStartTime = performance.now();
    }

    /**
     * 그리기 로직 종료 시간을 기록하고 소요 시간을 계산합니다.
     */
    markDrawEnd() {
        const now = performance.now();
        const duration = now - this.drawStartTime;
        this.data.lastDrawTime = duration;

        this.data.displayLastFrameTimeDelta = this.data.lastUpdateTime + this.data.lastDrawTime;
    }

    /**
     * 측정된 시간 데이터를 반환합니다.
     * @param {string} key - 데이터 키 (fps, lastFrameTimeDelta 등)
     * @returns {number} 데이터 값
     */
    getData(key) {
        return this.data[key];
    }

    /**
     * 특정 키에 해당하는 시간 데이터를 설정합니다.
     * @param {string} key - 데이터 키
     * @param {any} value - 설정할 값
     */
    setData(key, value) {
        this.data[key] = value;
    }
}

/**
 * TimeHandler 싱글톤 인스턴스를 반환합니다.
 * @returns {TimeHandler|null} 현재 TimeHandler 인스턴스
 */
export function getTimeHandler() {
    return timeHandlerInstance;
}

/**
 * 가변 프레임 델타(초)를 반환합니다.
 * @returns {number} 마지막 프레임 델타
 */
export function getDelta() {
    if (timeHandlerInstance) {
        return timeHandlerInstance.getData('lastFrameTimeDelta');
    }
    return 0;
}

/**
 * 고정 업데이트 델타(초)를 반환합니다.
 * @returns {number} 마지막 고정 업데이트 델타
 */
export function getFixedUpdateDelta() {
    if (timeHandlerInstance) {
        return timeHandlerInstance.getData('lastFixedTimeDelta');
    }
    return 1 / 60;
}

/**
 * 디버그용 시간 데이터를 반환합니다.
 * @param {string} key - 데이터 키
 * @returns {number} 데이터 값. 인스턴스가 없으면 0을 반환합니다.
 */
export function getDebugData(key) {
    if (timeHandlerInstance) {
        return timeHandlerInstance.getData(key);
    }
    return 0;
}
