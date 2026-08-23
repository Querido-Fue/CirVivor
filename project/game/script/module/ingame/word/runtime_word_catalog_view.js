import {
    R7_WORD_DEFINITION_BY_ID
} from 'data/word/r3_word_catalog_data.js';
import {
    R8_WORD_UPGRADE_PROFILE_BY_ID
} from 'data/word/r8_word_upgrade_profile_data.js';
import { fingerprintR8Record } from '../contract/r8_fingerprint_contract.js';
import {
    fingerprintWordDefinitionContent,
    normalizeOwnedWordInstance
} from '../contract/word_inventory_contract.js';
import {
    normalizeWordUpgradeProfile
} from '../contract/word_upgrade_contract.js';
import { WORD_KIND } from '../contract/word_sentence_contract.js';

function requireRecord(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label}은 객체여야 합니다.`);
    }
    return value;
}

/** Owned inventory를 기존 SentenceCompiler catalog shape로 투영합니다. */
export function createRuntimeWordCatalogView(options = {}) {
    const inventory = requireRecord(
        options.inventorySnapshot,
        'inventorySnapshot'
    );
    if (!Array.isArray(inventory.instances)) {
        throw new TypeError('inventorySnapshot.instances가 필요합니다.');
    }
    const wordDefinitionsById = requireRecord(
        options.wordDefinitionsById ?? R7_WORD_DEFINITION_BY_ID,
        'wordDefinitionsById'
    );
    const upgradeProfilesById = requireRecord(
        options.upgradeProfilesById ?? R8_WORD_UPGRADE_PROFILE_BY_ID,
        'upgradeProfilesById'
    );
    const instances = [];
    const wordInstancesById = Object.create(null);
    const definitionFingerprints = new Map();
    const profileFingerprints = new Map();
    for (let index = 0; index < inventory.instances.length; index++) {
        const owned = normalizeOwnedWordInstance(
            inventory.instances[index],
            `inventorySnapshot.instances[${index}]`
        );
        const definition = wordDefinitionsById[owned.definitionId];
        if (!definition || definition.id !== owned.definitionId) {
            throw new RangeError(`Owned WordDefinition이 없습니다: ${owned.definitionId}`);
        }
        let definitionFingerprint = definitionFingerprints.get(definition.id);
        if (definitionFingerprint === undefined) {
            definitionFingerprint = fingerprintWordDefinitionContent(definition);
            definitionFingerprints.set(definition.id, definitionFingerprint);
        }
        if (definitionFingerprint !== owned.contentFingerprint) {
            throw new RangeError(
                `Owned Word content fingerprint가 다릅니다: ${owned.instanceId}`
            );
        }
        let modifierStackContribution = null;
        let upgradeProfileFingerprint = 0;
        if (owned.upgradeProfileId !== null) {
            const rawProfile = upgradeProfilesById[owned.upgradeProfileId];
            if (!rawProfile) {
                throw new RangeError(
                    `Owned WordUpgradeProfile이 없습니다: ${owned.upgradeProfileId}`
                );
            }
            let profile = profileFingerprints.get(owned.upgradeProfileId);
            if (!profile) {
                profile = normalizeWordUpgradeProfile(rawProfile);
                profileFingerprints.set(owned.upgradeProfileId, profile);
            }
            if (profile.definitionId !== owned.definitionId) {
                throw new RangeError(
                    `Owned Word upgrade definition이 다릅니다: ${owned.instanceId}`
                );
            }
            const level = profile.levels[owned.upgradeLevel];
            if (!level) {
                throw new RangeError(
                    `Owned Word upgrade level이 없습니다: ${owned.instanceId}`
                );
            }
            upgradeProfileFingerprint = profile.profileFingerprint;
            if (definition.kind === WORD_KIND.MODIFIER) {
                modifierStackContribution = level.stackContribution;
            }
        } else if (definition.kind === WORD_KIND.MODIFIER) {
            modifierStackContribution = 1;
        }
        const instance = Object.freeze({
            id: owned.instanceId,
            definitionId: owned.definitionId,
            acquisitionOrdinal: owned.acquisitionOrdinal,
            acquiredShopSessionOrdinal: owned.acquiredShopSessionOrdinal,
            upgradeLevel: owned.upgradeLevel,
            upgradeProfileId: owned.upgradeProfileId,
            upgradeProfileFingerprint,
            contentFingerprint: owned.contentFingerprint,
            ...(modifierStackContribution === null
                ? {}
                : { modifierStackContribution })
        });
        if (Object.hasOwn(wordInstancesById, instance.id)) {
            throw new RangeError(`Owned WordInstance ID가 중복됩니다: ${instance.id}`);
        }
        wordInstancesById[instance.id] = instance;
        instances.push(instance);
    }
    const frozenInstances = Object.freeze(instances);
    const frozenById = Object.freeze(wordInstancesById);
    const catalogFingerprint = fingerprintR8Record(
        'runtime-word-catalog.r8',
        {
            inventoryRevision: inventory.revision,
            inventoryFingerprint: inventory.fingerprint,
            definitions: Array.from(definitionFingerprints.entries()).sort(
                (left, right) => left[0].localeCompare(right[0])
            ),
            instances: frozenInstances
        }
    );
    return Object.freeze({
        inventoryRevision: inventory.revision,
        inventoryFingerprint: inventory.fingerprint,
        catalogFingerprint,
        wordDefinitionsById,
        wordInstancesById: frozenById,
        instances: frozenInstances
    });
}
