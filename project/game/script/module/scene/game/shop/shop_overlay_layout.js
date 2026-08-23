const REFERENCE_WIDTH = 1280;
const REFERENCE_HEIGHT = 720;
const INVENTORY_COLUMN_COUNT = 3;
const ROLE_ORDER = Object.freeze(['subject', 'verb', 'payload', 'modifier']);

function finitePositive(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function freezeRect(rect) {
    return Object.freeze(rect);
}

function relativeRect(parent, x, y, w, h) {
    return freezeRect({
        x: parent.x + parent.w * x,
        y: parent.y + parent.h * y,
        w: parent.w * w,
        h: parent.h * h
    });
}

function insetRect(parent, xInsetRatio, yInsetRatio) {
    return freezeRect({
        x: parent.x + parent.w * xInsetRatio,
        y: parent.y + parent.h * yInsetRatio,
        w: parent.w * (1 - xInsetRatio * 2),
        h: parent.h * (1 - yInsetRatio * 2)
    });
}

function createFocusTarget(id, kind, bounds, source = {}, enabled = true) {
    return Object.freeze({
        id,
        kind,
        bounds,
        enabled: enabled === true,
        ...source
    });
}

function normalizeViewport(viewport = {}) {
    const ww = finitePositive(viewport.ww, REFERENCE_WIDTH);
    const wh = finitePositive(viewport.wh, REFERENCE_HEIGHT);
    const uiww = Math.min(ww, finitePositive(viewport.uiww, ww));
    const uiOffsetX = finite(viewport.uiOffsetX, (ww - uiww) * 0.5);
    const uiScale = finitePositive(viewport.uiScale, 1);
    return Object.freeze({ ww, wh, uiww, uiOffsetX, uiScale });
}

/**
 * 1280×720 design ratio를 UI viewport에 투영합니다. 모든 hit geometry는 반환 시점의
 * UIWW/WH/OX와 같은 source에서 계산되어 animation scale과 무관합니다.
 */
export function createShopOverlayLayout(viewport = {}, renderState = {}) {
    const normalizedViewport = normalizeViewport(viewport);
    const designScale = Math.min(
        normalizedViewport.uiww / REFERENCE_WIDTH,
        normalizedViewport.wh / REFERENCE_HEIGHT
    ) * normalizedViewport.uiScale;
    const root = freezeRect({
        x: normalizedViewport.uiOffsetX
            + normalizedViewport.uiww * 0.018,
        y: normalizedViewport.wh * 0.022,
        w: normalizedViewport.uiww * 0.964,
        h: normalizedViewport.wh * 0.956
    });
    const top = relativeRect(root, 0.018, 0.018, 0.964, 0.075);
    const title = relativeRect(top, 0, 0, 0.47, 1);
    const feedback = relativeRect(top, 0.47, 0, 0.23, 1);
    const gold = relativeRect(top, 0.7, 0, 0.13, 1);
    const reroll = relativeRect(top, 0.842, 0.08, 0.158, 0.84);

    const offerPanel = relativeRect(root, 0.018, 0.105, 0.964, 0.205);
    const offerGap = offerPanel.w * 0.012;
    const offerWidth = (
        offerPanel.w - offerGap * Math.max(0, renderState.offers?.length - 1)
    ) / Math.max(1, renderState.offers?.length || 5);
    const offerCards = Object.freeze((renderState.offers ?? []).map(
        (offer, index) => Object.freeze({
            offerId: offer.offerId,
            offerOrdinal: offer.offerOrdinal,
            bounds: freezeRect({
                x: offerPanel.x + index * (offerWidth + offerGap),
                y: offerPanel.y,
                w: offerWidth,
                h: offerPanel.h
            })
        })
    ));

    const inventoryPanel = relativeRect(root, 0.018, 0.333, 0.305, 0.535);
    const inventoryHeader = relativeRect(inventoryPanel, 0.035, 0.025, 0.93, 0.09);
    const inventoryGrid = relativeRect(inventoryPanel, 0.035, 0.125, 0.93, 0.62);
    const inventoryEntriesSource = renderState.inventory ?? [];
    const inventoryRowCount = Math.max(
        1,
        Math.ceil(inventoryEntriesSource.length / INVENTORY_COLUMN_COUNT)
    );
    const inventoryGapX = inventoryGrid.w * 0.018;
    const inventoryGapY = inventoryGrid.h * 0.025;
    const inventoryItemWidth = (
        inventoryGrid.w - inventoryGapX * (INVENTORY_COLUMN_COUNT - 1)
    ) / INVENTORY_COLUMN_COUNT;
    const inventoryItemHeight = (
        inventoryGrid.h - inventoryGapY * (inventoryRowCount - 1)
    ) / inventoryRowCount;
    const inventoryEntries = Object.freeze(inventoryEntriesSource.map(
        (entry, index) => {
            const column = index % INVENTORY_COLUMN_COUNT;
            const row = Math.floor(index / INVENTORY_COLUMN_COUNT);
            return Object.freeze({
                instanceId: entry.instanceId,
                bounds: freezeRect({
                    x: inventoryGrid.x
                        + column * (inventoryItemWidth + inventoryGapX),
                    y: inventoryGrid.y
                        + row * (inventoryItemHeight + inventoryGapY),
                    w: inventoryItemWidth,
                    h: inventoryItemHeight
                })
            });
        }
    ));
    const upgradePanel = relativeRect(
        inventoryPanel,
        0.035,
        0.77,
        0.93,
        0.195
    );
    const upgradeButton = relativeRect(upgradePanel, 0.55, 0.18, 0.42, 0.64);

    const editorPanel = relativeRect(root, 0.342, 0.333, 0.64, 0.535);
    const editorHeader = relativeRect(editorPanel, 0.018, 0.02, 0.964, 0.07);
    const rowsPanel = relativeRect(editorPanel, 0.018, 0.1, 0.964, 0.65);
    const rowGap = rowsPanel.h * 0.025;
    const rowHeight = (
        rowsPanel.h - rowGap * Math.max(0, (renderState.slotRows?.length ?? 5) - 1)
    ) / Math.max(1, renderState.slotRows?.length ?? 5);
    const editorRows = Object.freeze((renderState.slotRows ?? []).map(
        (row, index) => {
            const bounds = freezeRect({
                x: rowsPanel.x,
                y: rowsPanel.y + index * (rowHeight + rowGap),
                w: rowsPanel.w,
                h: rowHeight
            });
            const label = relativeRect(bounds, 0.012, 0.08, 0.105, 0.84);
            const roleArea = relativeRect(bounds, 0.125, 0.08, 0.863, 0.84);
            const roleGap = roleArea.w * 0.012;
            const roleWeights = Object.freeze([0.205, 0.205, 0.205, 0.349]);
            let roleX = roleArea.x;
            const cells = {};
            ROLE_ORDER.forEach((role, roleIndex) => {
                const width = roleArea.w * roleWeights[roleIndex];
                cells[role] = freezeRect({
                    x: roleX,
                    y: roleArea.y,
                    w: width,
                    h: roleArea.h
                });
                roleX += width + roleGap;
            });
            return Object.freeze({
                slotId: row.slotId,
                bounds,
                label,
                cells: Object.freeze(cells)
            });
        }
    ));
    const preview = relativeRect(editorPanel, 0.018, 0.77, 0.964, 0.105);
    const footer = relativeRect(editorPanel, 0.018, 0.89, 0.964, 0.09);
    const apply = relativeRect(footer, 0, 0, 0.31, 1);
    const discard = relativeRect(footer, 0.345, 0, 0.31, 1);
    const continueButton = relativeRect(footer, 0.69, 0, 0.31, 1);

    const focusTargets = [];
    focusTargets.push(createFocusTarget(
        'reroll',
        'reroll',
        reroll,
        {},
        renderState.rerollEnabled
    ));
    for (let index = 0; index < offerCards.length; index++) {
        const card = offerCards[index];
        const offer = renderState.offers[index];
        focusTargets.push(createFocusTarget(
            `offer:${card.offerId}`,
            'offer',
            card.bounds,
            { offerId: card.offerId },
            offer?.enabled
        ));
    }
    for (let index = 0; index < inventoryEntries.length; index++) {
        const entry = inventoryEntries[index];
        focusTargets.push(createFocusTarget(
            `inventory:${entry.instanceId}`,
            'inventory',
            entry.bounds,
            { instanceId: entry.instanceId },
            renderState.interactive
        ));
    }
    focusTargets.push(createFocusTarget(
        'upgrade',
        'upgrade',
        upgradeButton,
        { instanceId: renderState.selectedInventoryInstanceId ?? null },
        renderState.selectedUpgrade?.enabled
    ));
    for (let rowIndex = 0; rowIndex < editorRows.length; rowIndex++) {
        const layoutRow = editorRows[rowIndex];
        const stateRow = renderState.slotRows[rowIndex];
        for (const role of ROLE_ORDER) {
            focusTargets.push(createFocusTarget(
                `slot:${layoutRow.slotId}:${role}`,
                'slot-role',
                layoutRow.cells[role],
                { slotId: layoutRow.slotId, role },
                renderState.interactive && stateRow?.[role]?.enabled
            ));
        }
    }
    focusTargets.push(createFocusTarget(
        'apply', 'apply', apply, {}, renderState.applyEnabled
    ));
    focusTargets.push(createFocusTarget(
        'discard', 'discard', discard, {}, renderState.discardEnabled
    ));
    focusTargets.push(createFocusTarget(
        'continue',
        'continue',
        continueButton,
        {},
        renderState.continueEnabled
    ));

    return Object.freeze({
        viewport: normalizedViewport,
        designScale,
        root,
        content: insetRect(root, 0.01, 0.012),
        top: Object.freeze({ bounds: top, title, feedback, gold, reroll }),
        offerPanel,
        offerCards,
        inventoryPanel: Object.freeze({
            bounds: inventoryPanel,
            header: inventoryHeader,
            grid: inventoryGrid,
            entries: inventoryEntries,
            upgradePanel,
            upgradeButton
        }),
        editorPanel: Object.freeze({
            bounds: editorPanel,
            header: editorHeader,
            rows: editorRows,
            preview,
            footer: Object.freeze({
                bounds: footer,
                apply,
                discard,
                continue: continueButton
            })
        }),
        focusTargets: Object.freeze(focusTargets),
        destroyed: false
    });
}

export function isPointInsideShopOverlayRect(point, rect) {
    return Number(point?.x) >= rect.x
        && Number(point?.x) <= rect.x + rect.w
        && Number(point?.y) >= rect.y
        && Number(point?.y) <= rect.y + rect.h;
}
