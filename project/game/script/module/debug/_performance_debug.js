import { getWH, getWW, render } from "display/display_system.js";

const PERFORMANCE_WINDOW_MS = 1000;
const MAX_VISIBLE_SECTIONS = 18;
const MIN_VISIBLE_AVERAGE_MS = 0.05;

/**
 * @class PerformanceDebugger
 * @description 최근 1초 구간의 CPU 프레임 프로파일링 결과를 화면 좌측 상단에 표시합니다.
 */
export class PerformanceDebugger {
    constructor() {
        this.enabled = false;
        this.sampleWindowMs = PERFORMANCE_WINDOW_MS;
        this.maxVisibleSections = MAX_VISIBLE_SECTIONS;
        this.minVisibleAverageMs = MIN_VISIBLE_AVERAGE_MS;
        this.sectionRecords = new Map();
        this.sectionSequence = 0;
    }

    /**
     * 프로파일러 활성 상태를 갱신합니다.
     * @param {boolean} enabled - 활성화 여부입니다.
     */
    setEnabled(enabled) {
        this.enabled = enabled === true;
        if (!this.enabled) {
            this.reset();
        }
    }

    /**
     * 프로파일러 활성 여부를 반환합니다.
     * @returns {boolean} 활성 여부입니다.
     */
    isEnabled() {
        return this.enabled === true;
    }

    /**
     * 지정한 섹션의 실행 시간을 계측합니다.
     * @template T
     * @param {string} sectionName - 계측할 섹션 이름입니다.
     * @param {() => T} callback - 실행할 콜백입니다.
     * @returns {T} 콜백 실행 결과입니다.
     */
    measureSection(sectionName, callback) {
        if (!this.isEnabled()) {
            return callback();
        }

        const startTime = performance.now();
        try {
            return callback();
        } finally {
            const endTime = performance.now();
            this.recordSample(sectionName, endTime - startTime, endTime);
        }
    }

    /**
     * 지정한 섹션의 샘플을 수동으로 기록합니다.
     * @param {string} sectionName - 기록할 섹션 이름입니다.
     * @param {number} durationMs - 기록할 소요 시간(ms)입니다.
     * @param {number} [timestamp=performance.now()] - 샘플 기록 시각(ms)입니다.
     */
    recordSample(sectionName, durationMs, timestamp = performance.now()) {
        if (!this.isEnabled()
            || typeof sectionName !== 'string'
            || sectionName.length === 0
            || !Number.isFinite(durationMs)
            || durationMs < 0) {
            return;
        }

        const sampleTimestamp = Number.isFinite(timestamp) ? timestamp : performance.now();
        const sectionRecord = this.#getOrCreateSectionRecord(sectionName);
        sectionRecord.samples.push({
            timestamp: sampleTimestamp,
            durationMs
        });
        sectionRecord.sum += durationMs;
        sectionRecord.last = durationMs;
        if (durationMs > sectionRecord.max) {
            sectionRecord.max = durationMs;
        }
        this.#trimSectionRecord(sectionRecord, sampleTimestamp);
    }

    /**
     * 프로파일러 내부 샘플 상태를 갱신합니다.
     */
    update() {
        if (!this.isEnabled()) {
            return;
        }

        this.#trimAllSectionRecords(performance.now());
    }

    /**
     * 누적된 프로파일 샘플을 초기화합니다.
     */
    reset() {
        this.sectionRecords.clear();
        this.sectionSequence = 0;
    }

    /**
     * 프로파일링 HUD를 화면에 그립니다.
     */
    draw() {
        if (!this.isEnabled()) {
            return;
        }

        const lines = this.#buildDisplayLines();
        if (lines.length === 0) {
            return;
        }

        const ch = getWH();
        const ww = getWW();
        const fontSize = Math.max(12, Math.floor(ch * 0.014));
        const font = `600 ${fontSize}px "Pretendard Variable", arial`;
        const lineHeight = fontSize + Math.max(4, Math.floor(ch * 0.004));
        const panelPadding = Math.max(6, Math.floor(ch * 0.005));
        const startX = Math.max(10, Math.floor(ch * 0.01));
        const startY = startX;
        const longestLineLength = lines.reduce((maxLength, line) => Math.max(maxLength, line.length), 0);
        const panelWidth = Math.min(
            ww - (startX * 2),
            Math.ceil((fontSize * 0.58) * longestLineLength) + (panelPadding * 2)
        );
        const panelHeight = (lines.length * lineHeight) + (panelPadding * 2);

        render('top', {
            shape: 'roundRect',
            x: startX - panelPadding,
            y: startY - panelPadding,
            w: panelWidth,
            h: panelHeight,
            radius: panelPadding,
            fill: 'rgba(0, 0, 0, 0.78)'
        });

        lines.forEach((line, index) => {
            render('top', {
                shape: 'text',
                text: line,
                x: startX,
                y: startY + (index * lineHeight),
                font,
                fill: '#FFFFFF',
                align: 'left',
                baseline: 'top'
            });
        });
    }

    /**
     * @private
     * 섹션 기록 객체를 반환하거나 새로 생성합니다.
     * @param {string} sectionName - 기록할 섹션 이름입니다.
     * @returns {object} 섹션 기록 객체입니다.
     */
    #getOrCreateSectionRecord(sectionName) {
        if (!this.sectionRecords.has(sectionName)) {
            this.sectionRecords.set(sectionName, {
                name: sectionName,
                order: this.sectionSequence++,
                samples: [],
                sum: 0,
                last: 0,
                max: 0
            });
        }

        return this.sectionRecords.get(sectionName);
    }

    /**
     * @private
     * 모든 섹션에서 최근 1초 구간 밖의 샘플을 제거합니다.
     * @param {number} currentTimestamp - 현재 시각(ms)입니다.
     */
    #trimAllSectionRecords(currentTimestamp) {
        for (const [sectionName, sectionRecord] of this.sectionRecords.entries()) {
            this.#trimSectionRecord(sectionRecord, currentTimestamp);
            if (sectionRecord.samples.length === 0) {
                this.sectionRecords.delete(sectionName);
            }
        }
    }

    /**
     * @private
     * 최근 1초 구간 밖의 샘플을 제거합니다.
     * @param {object} sectionRecord - 정리할 섹션 기록입니다.
     * @param {number} currentTimestamp - 현재 시각(ms)입니다.
     */
    #trimSectionRecord(sectionRecord, currentTimestamp) {
        const threshold = currentTimestamp - this.sampleWindowMs;
        let shouldRecalculateMax = false;

        while (sectionRecord.samples.length > 0 && sectionRecord.samples[0].timestamp < threshold) {
            const expiredSample = sectionRecord.samples.shift();
            sectionRecord.sum -= expiredSample.durationMs;
            if (expiredSample.durationMs >= sectionRecord.max) {
                shouldRecalculateMax = true;
            }
        }

        if (sectionRecord.samples.length === 0) {
            sectionRecord.sum = 0;
            sectionRecord.last = 0;
            sectionRecord.max = 0;
            return;
        }

        if (shouldRecalculateMax) {
            sectionRecord.max = sectionRecord.samples.reduce((maxValue, sample) => {
                return Math.max(maxValue, sample.durationMs);
            }, 0);
        }
    }

    /**
     * @private
     * HUD에 표시할 문자열 목록을 구성합니다.
     * @returns {string[]} 표시 문자열 목록입니다.
     */
    #buildDisplayLines() {
        this.#trimAllSectionRecords(performance.now());

        const sectionSnapshots = Array.from(this.sectionRecords.values())
            .map((sectionRecord) => this.#buildSectionSnapshot(sectionRecord))
            .filter(Boolean);
        const frameCpuSnapshot = sectionSnapshots.find((snapshot) => snapshot.name === 'frame.cpu') || null;
        const sortedSnapshots = sectionSnapshots
            .filter((snapshot) => snapshot.name !== 'frame.cpu' && snapshot.averageMs >= this.minVisibleAverageMs)
            .sort((left, right) => {
                if (right.averageMs !== left.averageMs) {
                    return right.averageMs - left.averageMs;
                }
                return left.order - right.order;
            })
            .slice(0, this.maxVisibleSections);
        const lines = ['CPU 프로파일러(1초 평균 / avg | last | max)'];

        if (frameCpuSnapshot) {
            lines.push(this.#formatSectionLine(frameCpuSnapshot));
        } else {
            lines.push('frame.cpu                      avg --    | last --    | max --');
        }

        sortedSnapshots.forEach((snapshot) => {
            lines.push(this.#formatSectionLine(snapshot));
        });

        return lines;
    }

    /**
     * @private
     * 섹션 기록을 HUD 출력용 스냅샷으로 변환합니다.
     * @param {object} sectionRecord - 변환할 섹션 기록입니다.
     * @returns {object|null} HUD 출력용 스냅샷입니다.
     */
    #buildSectionSnapshot(sectionRecord) {
        if (!sectionRecord || sectionRecord.samples.length === 0) {
            return null;
        }

        return {
            name: sectionRecord.name,
            order: sectionRecord.order,
            averageMs: sectionRecord.sum / sectionRecord.samples.length,
            lastMs: sectionRecord.last,
            maxMs: sectionRecord.max
        };
    }

    /**
     * @private
     * HUD 한 줄에 들어갈 문자열을 구성합니다.
     * @param {object} snapshot - 출력할 섹션 스냅샷입니다.
     * @returns {string} 완성된 출력 문자열입니다.
     */
    #formatSectionLine(snapshot) {
        const sectionLabel = this.#truncateSectionName(snapshot.name, 30).padEnd(30, ' ');
        return `${sectionLabel} avg ${snapshot.averageMs.toFixed(2).padStart(6, ' ')} | last ${snapshot.lastMs.toFixed(2).padStart(6, ' ')} | max ${snapshot.maxMs.toFixed(2).padStart(6, ' ')}`;
    }

    /**
     * @private
     * 긴 섹션 이름을 HUD 폭에 맞게 축약합니다.
     * @param {string} sectionName - 원본 섹션 이름입니다.
     * @param {number} maxLength - 허용할 최대 길이입니다.
     * @returns {string} 축약된 섹션 이름입니다.
     */
    #truncateSectionName(sectionName, maxLength) {
        if (sectionName.length <= maxLength) {
            return sectionName;
        }

        const preservedLength = Math.max(4, Math.floor((maxLength - 3) * 0.5));
        const suffixLength = Math.max(4, maxLength - 3 - preservedLength);
        return `${sectionName.slice(0, preservedLength)}...${sectionName.slice(-suffixLength)}`;
    }
}
