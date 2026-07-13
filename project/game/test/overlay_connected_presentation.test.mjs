import assert from 'node:assert/strict';
import { loadGameModule } from './support/source_module_loader.mjs';

const presentationModule = await loadGameModule('overlay/overlay_connected_presentation.js');
const {
    advanceOverlayConnectedPresentation,
    cancelOverlayConnectedPresentation,
    createOverlayConnectedPresentation,
    getOverlayConnectedPresentationBackRotationY,
    getOverlayConnectedPresentationFrontContentRect,
    getOverlayConnectedPresentationRect,
    isOverlayConnectedPresentation,
    isOverlayConnectedPresentationFrontFace,
    setOverlayConnectedPresentationSource,
    setOverlayConnectedPresentationTarget
} = presentationModule;

const SOURCE_RECT = Object.freeze({ x: 100, y: 200, w: 240, h: 180, radius: 18 });
const TARGET_RECT = Object.freeze({ x: 300, y: 80, w: 900, h: 620, radius: 32 });

const presentation = createOverlayConnectedPresentation({
    sourceRect: SOURCE_RECT,
    durationSeconds: 0.4,
    switchProgress: 0.5,
    perspective: 1180
});

assert.equal(isOverlayConnectedPresentation(presentation), true);
assert.equal(presentation.ready, false);
assert.equal(presentation.progress, 0);
assert.equal(advanceOverlayConnectedPresentation(presentation, 0.1), false);
assert.equal(presentation.progress, 0);

assert.equal(setOverlayConnectedPresentationTarget(presentation, TARGET_RECT), true);
assert.equal(presentation.ready, true);
let rect = getOverlayConnectedPresentationRect(presentation);
assert.equal(rect.x, SOURCE_RECT.x);
assert.equal(rect.y, SOURCE_RECT.y);
assert.equal(rect.w, SOURCE_RECT.w);
assert.equal(rect.h, SOURCE_RECT.h);
const frontContentRect = getOverlayConnectedPresentationFrontContentRect(
    presentation,
    rect
);
assert.equal(frontContentRect.x, SOURCE_RECT.x);
assert.equal(frontContentRect.y, SOURCE_RECT.y);
assert.equal(frontContentRect.w, SOURCE_RECT.w);
assert.equal(frontContentRect.h, SOURCE_RECT.h);
assert.equal(isOverlayConnectedPresentationFrontFace(presentation), true);

assert.equal(advanceOverlayConnectedPresentation(presentation, Number.NaN), false);
assert.equal(advanceOverlayConnectedPresentation(presentation, -1), false);
assert.equal(presentation.progress, 0);

assert.equal(advanceOverlayConnectedPresentation(presentation, 0.1), false);
assert.equal(presentation.progress, 0.25);
assert.ok(Math.abs(presentation.motionProgress - (1 - Math.pow(2, -2.5))) < 1e-12);
assert.ok(Math.abs(presentation.rotationY - (Math.PI / 64)) < 1e-12);
assert.equal(isOverlayConnectedPresentationFrontFace(presentation), true);
rect = getOverlayConnectedPresentationRect(presentation);
assert.ok(rect.x > SOURCE_RECT.x && rect.x < TARGET_RECT.x);
assert.ok(rect.w > SOURCE_RECT.w && rect.w < TARGET_RECT.w);
const movingFrontContentRect = getOverlayConnectedPresentationFrontContentRect(
    presentation,
    rect,
    frontContentRect
);
assert.equal(movingFrontContentRect, frontContentRect);
assert.equal(movingFrontContentRect.w, SOURCE_RECT.w);
assert.equal(movingFrontContentRect.h, SOURCE_RECT.h);
assert.equal(
    movingFrontContentRect.x + (movingFrontContentRect.w * 0.5),
    rect.x + (rect.w * 0.5)
);
assert.equal(
    movingFrontContentRect.y + (movingFrontContentRect.h * 0.5),
    rect.y + (rect.h * 0.5)
);

assert.equal(advanceOverlayConnectedPresentation(presentation, 0.1), false);
assert.equal(presentation.progress, 0.5);
assert.equal(presentation.motionProgress, 31 / 32);
assert.ok(Math.abs(presentation.rotationY - (Math.PI * 0.5)) < 1e-12);
assert.equal(isOverlayConnectedPresentationFrontFace(presentation), false);
assert.ok(Math.abs(getOverlayConnectedPresentationBackRotationY(presentation) + (Math.PI * 0.5)) < 1e-12);
rect = getOverlayConnectedPresentationRect(presentation);
assert.equal(rect.x, SOURCE_RECT.x + ((TARGET_RECT.x - SOURCE_RECT.x) * (31 / 32)));
assert.equal(rect.w, SOURCE_RECT.w + ((TARGET_RECT.w - SOURCE_RECT.w) * (31 / 32)));

const RESIZED_SOURCE_RECT = Object.freeze({ x: 80, y: 160, w: 200, h: 150, radius: 15 });
const RESIZED_TARGET_RECT = Object.freeze({ x: 260, y: 60, w: 820, h: 560, radius: 28 });
assert.equal(setOverlayConnectedPresentationSource(presentation, RESIZED_SOURCE_RECT), true);
assert.equal(setOverlayConnectedPresentationTarget(presentation, RESIZED_TARGET_RECT), true);
assert.equal(presentation.progress, 0.5);
rect = getOverlayConnectedPresentationRect(presentation);
assert.equal(rect.x, RESIZED_SOURCE_RECT.x + ((RESIZED_TARGET_RECT.x - RESIZED_SOURCE_RECT.x) * (31 / 32)));
assert.equal(rect.h, RESIZED_SOURCE_RECT.h + ((RESIZED_TARGET_RECT.h - RESIZED_SOURCE_RECT.h) * (31 / 32)));

assert.equal(advanceOverlayConnectedPresentation(presentation, 0.1), false);
assert.equal(presentation.progress, 0.75);
assert.ok(Math.abs(presentation.motionProgress - (1 - Math.pow(2, -7.5))) < 1e-12);
assert.ok(Math.abs(presentation.rotationY - ((Math.PI * 63) / 64)) < 1e-12);
assert.ok(Math.abs(getOverlayConnectedPresentationBackRotationY(presentation) + (Math.PI / 64)) < 1e-12);

assert.equal(advanceOverlayConnectedPresentation(presentation, 1), true);
assert.equal(presentation.progress, 1);
assert.equal(presentation.completed, true);
assert.equal(presentation.rotationY, Math.PI);
rect = getOverlayConnectedPresentationRect(presentation);
assert.equal(rect.x, RESIZED_TARGET_RECT.x);
assert.equal(rect.y, RESIZED_TARGET_RECT.y);
assert.equal(rect.w, RESIZED_TARGET_RECT.w);
assert.equal(rect.h, RESIZED_TARGET_RECT.h);
assert.equal(advanceOverlayConnectedPresentation(presentation, 0.1), false);

const cancelledPresentation = createOverlayConnectedPresentation({ sourceRect: SOURCE_RECT });
setOverlayConnectedPresentationTarget(cancelledPresentation, TARGET_RECT);
cancelOverlayConnectedPresentation(cancelledPresentation);
assert.equal(advanceOverlayConnectedPresentation(cancelledPresentation, 0.4), false);
assert.equal(cancelledPresentation.progress, 0);

const mixedAxisPresentation = createOverlayConnectedPresentation({
    sourceRect: { x: 0, y: 0, w: 1000, h: 300, radius: 0 }
});
setOverlayConnectedPresentationTarget(
    mixedAxisPresentation,
    { x: 0, y: 0, w: 700, h: 800, radius: 0 }
);
const mixedAxisCurrentRect = getOverlayConnectedPresentationRect(mixedAxisPresentation);
const mixedAxisContentRect = getOverlayConnectedPresentationFrontContentRect(
    mixedAxisPresentation,
    mixedAxisCurrentRect
);
assert.equal(mixedAxisContentRect.w, 1000);
assert.equal(mixedAxisContentRect.h, 300);
assert.equal(mixedAxisContentRect.x, mixedAxisCurrentRect.x);
assert.equal(mixedAxisContentRect.y, mixedAxisCurrentRect.y);

console.log('overlay connected presentation contract: ok');
