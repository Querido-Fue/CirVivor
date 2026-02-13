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
        this.timeBefore = performance.now();
        this.updateStartTime = 0;
        this.drawStartTime = 0;
        this.updateTimeHistory = [];
        this.drawTimeHistory = [];
        this.data = {
            fps: 0,
            lowestFps: 0,
            lastFrameTimeDelta: 0,
            displayLastFrameTimeDelta: 0,
            lastUpdateTime: 0,
            lastDrawTime: 0,
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

        this.data.lastFrameTimeDelta = delta / 1000;

        // 디버그용 즉시 FPS (가독성을 위해 스무딩된 값 유지)
        // 프레임 타임은 즉시 값 사용
        const currentFps = delta > 0 ? Math.round(1000 / delta) : 60;

        // 최근 프레임 데이터 저장 (최근 1초간)
        this.recentData.push({
            time: now,
            fps: currentFps
        });

        this.recentData = this.recentData.filter(d => now - d.time <= 1000);

        if (this.recentData.length > 0) {
            const fpsValues = this.recentData.map(d => d.fps);

            const totalFps = fpsValues.reduce((a, b) => a + b, 0);
            this.data.fps = Math.floor(totalFps / this.recentData.length);

            this.data.lowestFps = Math.min(...fpsValues);
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

export function getTimeHandler() {
    return timeHandlerInstance;
}

export function getDelta() {
    if (timeHandlerInstance) {
        return timeHandlerInstance.getData('lastFrameTimeDelta');
    }
    return 0;
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