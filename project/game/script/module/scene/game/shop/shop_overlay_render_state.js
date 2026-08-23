import {
    R7_WORD_DEFINITION_BY_ID
} from 'data/word/r3_word_catalog_data.js';
import {
    R8_WORD_UPGRADE_PROFILE_BY_ID
} from 'data/word/r8_word_upgrade_profile_data.js';
import {
    R8_WORD_SHOP_BALANCE
} from 'data/word/r8_word_shop_catalog_data.js';
import {
    ABILITY_SLOT_IDS,
    WORD_GRAMMATICAL_ROLE,
    WORD_KIND
} from 'ingame/contract/word_sentence_contract.js';
import { SHOP_RUNTIME_PHASE } from 'ingame/flow/shop_phase_coordinator.js';

const EMPTY_TEXT = '—';

function freezeArray(values) {
    return Object.freeze(values);
}

function normalizeFinite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function getWordDefinition(definitionId) {
    return R7_WORD_DEFINITION_BY_ID[definitionId] ?? null;
}

function getDefinitionLabel(definitionId) {
    const definition = getWordDefinition(definitionId);
    return definition?.display?.korean?.singular
        ?? definition?.display?.english?.singular
        ?? definitionId
        ?? EMPTY_TEXT;
}

function getInstanceLabel(instance, definition = null) {
    if (!instance) return EMPTY_TEXT;
    const resolved = definition ?? getWordDefinition(instance.definitionId);
    const label = getDefinitionLabel(instance.definitionId);
    const level = Number.isSafeInteger(instance.upgradeLevel)
        ? instance.upgradeLevel
        : 0;
    return resolved?.kind === WORD_KIND.MODIFIER
        ? `${label} · Lv.${level}`
        : label;
}

function createUpgradeState(instance, gold, interactive) {
    if (!instance || instance.upgradeProfileId === null) {
        return Object.freeze({
            supported: false,
            maxed: false,
            currentLevel: instance?.upgradeLevel ?? 0,
            nextLevel: null,
            cost: null,
            affordable: false,
            enabled: false,
            reason: instance ? 'UPGRADE_UNSUPPORTED' : 'NO_SELECTION'
        });
    }
    const profile = R8_WORD_UPGRADE_PROFILE_BY_ID[instance.upgradeProfileId];
    const level = profile?.levels?.[instance.upgradeLevel] ?? null;
    const cost = level?.upgradeCostToNext ?? null;
    const maxed = cost === null;
    const affordable = !maxed && gold >= cost;
    return Object.freeze({
        supported: Boolean(profile && level),
        maxed,
        currentLevel: instance.upgradeLevel,
        nextLevel: maxed ? null : instance.upgradeLevel + 1,
        cost,
        affordable,
        enabled: interactive && Boolean(profile && level)
            && !maxed && affordable,
        reason: !profile || !level
            ? 'UPGRADE_UNSUPPORTED'
            : (maxed
                ? 'UPGRADE_MAX_LEVEL'
                : (affordable ? null : 'INSUFFICIENT_GOLD'))
    });
}

function createInventoryEntry(instance, selectedId, gold, interactive) {
    const definition = getWordDefinition(instance.definitionId);
    const roles = freezeArray(Array.from(definition?.roles ?? []));
    const selected = instance.instanceId === selectedId;
    const upgrade = createUpgradeState(instance, gold, interactive);
    return Object.freeze({
        instanceId: instance.instanceId,
        definitionId: instance.definitionId,
        label: getInstanceLabel(instance, definition),
        kind: definition?.kind ?? null,
        roles,
        acquisitionOrdinal: instance.acquisitionOrdinal,
        acquiredShopSessionOrdinal: instance.acquiredShopSessionOrdinal,
        upgradeLevel: instance.upgradeLevel,
        upgradeProfileId: instance.upgradeProfileId,
        selected,
        enabled: interactive,
        upgrade,
        tooltip: `${getInstanceLabel(instance, definition)} · ${definition?.kind ?? 'Word'}`
    });
}

function createOfferState(offer, gold, interactive) {
    const sold = offer.sold === true;
    const affordable = gold >= normalizeFinite(offer.price);
    const state = sold
        ? 'sold'
        : (affordable ? 'available' : 'insufficient');
    return Object.freeze({
        offerId: offer.offerId,
        offerOrdinal: offer.offerOrdinal,
        definitionId: offer.definitionId,
        label: getDefinitionLabel(offer.definitionId),
        rarityId: offer.rarityId,
        price: offer.price,
        sold,
        affordable,
        enabled: interactive && !sold && affordable,
        state,
        tooltip: sold
            ? `${getDefinitionLabel(offer.definitionId)} · 구매 완료`
            : `${getDefinitionLabel(offer.definitionId)} · Gold ${offer.price}`
    });
}

function createSlotCell(role, instanceId, instancesById, selectedEntry, slot) {
    const instance = instanceId ? instancesById[instanceId] ?? null : null;
    const selectedDefinition = selectedEntry
        ? getWordDefinition(selectedEntry.definitionId)
        : null;
    let compatible = false;
    if (selectedDefinition) {
        if (role === 'verb') {
            compatible = selectedDefinition.kind === WORD_KIND.VERB;
        } else if (role === 'modifier') {
            compatible = selectedDefinition.kind === WORD_KIND.MODIFIER;
        } else {
            const grammaticalRole = role === 'subject'
                ? WORD_GRAMMATICAL_ROLE.SUBJECT
                : WORD_GRAMMATICAL_ROLE.PAYLOAD;
            compatible = selectedDefinition.roles.includes(grammaticalRole);
        }
    }
    const modifierIds = role === 'modifier'
        ? slot.modifierInstanceIds
        : freezeArray([]);
    const modifierLabels = role === 'modifier'
        ? freezeArray(modifierIds.map((id) => (
            getInstanceLabel(instancesById[id] ?? null)
        )))
        : freezeArray([]);
    const selectedAlreadyPlaced = role === 'modifier'
        && selectedEntry !== null
        && modifierIds.includes(selectedEntry.instanceId);
    return Object.freeze({
        role,
        instanceId,
        label: role === 'modifier'
            ? (modifierLabels.join(' → ') || EMPTY_TEXT)
            : getInstanceLabel(instance),
        modifierInstanceIds: modifierIds,
        modifierLabels,
        compatible,
        selectedAlreadyPlaced,
        enabled: compatible,
        tooltip: role === 'modifier'
            ? 'Modifier · 선택한 단어를 추가/제거'
            : `${role.toUpperCase()} · 선택한 단어 배치`
    });
}

function createDisplaySentenceText(display) {
    if (!display || typeof display !== 'object') return null;
    const subject = getWordDefinition(display.subjectWordDefinitionId);
    const verb = getWordDefinition(display.verbWordDefinitionId);
    const payload = display.payloadWordDefinitionId
        ? getWordDefinition(display.payloadWordDefinitionId)
        : null;
    const modifierIds = Array.isArray(display.modifierWordDefinitionIds)
        ? display.modifierWordDefinitionIds
        : [];
    const words = [
        subject?.display?.english?.singular,
        verb?.display?.english?.singular,
        payload?.display?.english?.plural,
        ...modifierIds.map((definitionId) => (
            getWordDefinition(definitionId)?.display?.english?.singular
        ))
    ].filter((word) => typeof word === 'string' && word.length > 0);
    return words.length > 0 ? words.join(' ') : null;
}

function createPreview(slotId, validation) {
    const slotValidation = validation?.slotValidations?.find(
        (entry) => entry.slotId === slotId
    ) ?? null;
    if (!slotValidation) {
        return Object.freeze({
            slotId,
            valid: false,
            empty: false,
            code: validation?.code ?? 'NOT_VALIDATED',
            text: validation?.code ?? '검증 대기',
            copiesPerSubject: null,
            effectiveCount: null
        });
    }
    if (slotValidation.empty === true) {
        return Object.freeze({
            slotId,
            valid: true,
            empty: true,
            code: 'EMPTY',
            text: `${slotId} · 빈 슬롯`,
            copiesPerSubject: 0,
            effectiveCount: 0
        });
    }
    const copies = slotValidation.preview?.copiesPerSubject ?? null;
    const sentenceText = createDisplaySentenceText(
        slotValidation.preview?.displaySentenceData
    )
        ?? slotValidation.preview?.actionCode
        ?? slotValidation.code;
    return Object.freeze({
        slotId,
        valid: slotValidation.valid === true,
        empty: false,
        code: slotValidation.code,
        text: slotValidation.valid === true
            ? `${slotId} · ${sentenceText}${copies > 1 ? ` · ×${copies}` : ''}`
            : `${slotId} · ${slotValidation.code}${slotValidation.message ? ` · ${slotValidation.message}` : ''}`,
        copiesPerSubject: copies,
        effectiveCount: copies
    });
}

function createFeedback(shopUiStatus) {
    const receipt = shopUiStatus?.lastReceipt ?? null;
    if (!receipt) {
        return Object.freeze({ kind: 'none', code: null, text: '' });
    }
    return Object.freeze({
        kind: receipt.accepted === true ? 'success' : (
            String(receipt.code).includes('STALE') ? 'stale' : 'error'
        ),
        code: receipt.code ?? null,
        commandType: receipt.commandType ?? null,
        commandId: receipt.commandId ?? null,
        text: `${receipt.commandType ?? 'SHOP'} · ${receipt.code ?? 'UNKNOWN'}`
    });
}

/** GameSystem snapshot을 렌더러 전용 immutable view로 축약합니다. */
export function createShopOverlayRenderState(
    gameplayStatus,
    editorStatus = {}
) {
    const phase = gameplayStatus?.shopPhase?.phase ?? SHOP_RUNTIME_PHASE.COMBAT;
    const visible = phase === SHOP_RUNTIME_PHASE.SHOP
        || phase === SHOP_RUNTIME_PHASE.SHOP_CLOSING;
    const shop = gameplayStatus?.shop ?? null;
    const board = gameplayStatus?.sentenceBoard ?? null;
    const commerce = gameplayStatus?.commerce ?? null;
    const interactive = visible
        && phase === SHOP_RUNTIME_PHASE.SHOP
        && shop?.active === true;
    const inventorySource = commerce?.inventory?.instances ?? [];
    const selectedId = editorStatus.selectedInventoryInstanceId ?? null;
    const gold = normalizeFinite(gameplayStatus?.gold ?? shop?.gold);
    const inventory = freezeArray(inventorySource.map((instance) => (
        createInventoryEntry(instance, selectedId, gold, interactive)
    )));
    const instancesById = Object.freeze(Object.fromEntries(
        inventorySource.map((instance) => [instance.instanceId, Object.freeze({
            instanceId: instance.instanceId,
            definitionId: instance.definitionId,
            upgradeLevel: instance.upgradeLevel
        })])
    ));
    const selectedEntry = inventory.find(({ selected }) => selected) ?? null;
    const slots = board?.draftSlots ?? board?.committedSlots ?? {};
    const validation = board?.draftSlots
        ? board.lastValidation
        : board?.lastCommittedValidation;
    const selectedSlotId = ABILITY_SLOT_IDS.includes(editorStatus.selectedSlotId)
        ? editorStatus.selectedSlotId
        : ABILITY_SLOT_IDS[0];
    const slotRows = freezeArray(ABILITY_SLOT_IDS.map((slotId) => {
        const slot = slots[slotId] ?? {
            subjectInstanceId: null,
            verbInstanceId: null,
            payloadInstanceId: null,
            modifierInstanceIds: freezeArray([])
        };
        const modifierIds = freezeArray(Array.from(
            slot.modifierInstanceIds ?? []
        ));
        const frozenSlot = Object.freeze({
            subjectInstanceId: slot.subjectInstanceId ?? null,
            verbInstanceId: slot.verbInstanceId ?? null,
            payloadInstanceId: slot.payloadInstanceId ?? null,
            modifierInstanceIds: modifierIds
        });
        return Object.freeze({
            slotId,
            selected: slotId === selectedSlotId,
            slot: frozenSlot,
            subject: createSlotCell(
                'subject',
                frozenSlot.subjectInstanceId,
                instancesById,
                selectedEntry,
                frozenSlot
            ),
            verb: createSlotCell(
                'verb',
                frozenSlot.verbInstanceId,
                instancesById,
                selectedEntry,
                frozenSlot
            ),
            payload: createSlotCell(
                'payload',
                frozenSlot.payloadInstanceId,
                instancesById,
                selectedEntry,
                frozenSlot
            ),
            modifier: createSlotCell(
                'modifier',
                null,
                instancesById,
                selectedEntry,
                frozenSlot
            ),
            preview: createPreview(slotId, validation)
        });
    }));
    const preview = createPreview(selectedSlotId, validation);
    const draftActive = board?.draftSlots !== null
        && board?.draftSlots !== undefined;
    const draftValid = draftActive && validation?.valid === true;
    const committedInventoryCurrent = board?.inventoryRevision
        === (shop?.inventoryRevision ?? commerce?.inventoryRevision);
    const committedBoardValid = board?.lastCommittedValidation?.valid === true;
    const selectedUpgrade = createUpgradeState(
        inventorySource.find(({ instanceId }) => instanceId === selectedId)
            ?? null,
        gold,
        interactive
    );
    const row = shop?.row ?? null;
    const offers = freezeArray((row?.offers ?? []).map((offer) => (
        createOfferState(offer, gold, interactive)
    )));

    return Object.freeze({
        visible,
        interactive,
        phase,
        title: 'WORD SHOP · SENTENCE EDITOR',
        gold,
        shopSessionOrdinal: shop?.shopSessionOrdinal ?? 0,
        rerollOrdinal: shop?.rerollOrdinal ?? 0,
        rerollCost: R8_WORD_SHOP_BALANCE.REROLL_COST,
        rowFingerprint: row?.rowFingerprint ?? 0,
        commerceRevision: shop?.commerceRevision
            ?? commerce?.commerceRevision ?? 0,
        inventoryRevision: shop?.inventoryRevision
            ?? commerce?.inventoryRevision ?? 0,
        boardRevision: board?.boardRevision ?? 0,
        draftRevision: board?.draftRevision ?? 0,
        offers,
        inventory,
        selectedInventoryInstanceId: selectedId,
        selectedInventoryEntry: selectedEntry,
        selectedUpgrade,
        selectedSlotId,
        slotRows,
        preview,
        draftActive,
        draftValid,
        validationCode: validation?.code ?? 'NOT_VALIDATED',
        rerollEnabled: interactive
            && gold >= R8_WORD_SHOP_BALANCE.REROLL_COST,
        applyEnabled: interactive && draftValid,
        discardEnabled: interactive && draftActive,
        continueEnabled: interactive
            && shop?.continueReady === true
            && !draftActive
            && committedInventoryCurrent
            && committedBoardValid,
        feedback: createFeedback(gameplayStatus?.shopUi),
        destroyed: gameplayStatus?.shopUi?.destroyed === true
    });
}
