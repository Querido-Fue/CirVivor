import {
    TOWER_GROUP_OPERATION_AUTHORITY,
    TOWER_GROUP_OPERATION_KIND,
    TOWER_GROUP_OPERATION_PROFILE_ABI_VERSION,
    TOWER_GROUP_OPERATION_PROFILE_ID,
    TOWER_GROUP_SUBJECT_SELECTION_POLICY,
    TOWER_GROUP_SUBJECT_SNAPSHOT_POLICY,
    normalizeTowerGroupOperationProfile
} from 'ingame/contract/tower_group_operation_contract.js';
import {
    SENTENCE_ACTION_CODE,
    SENTENCE_PAYLOAD_REQUIREMENT,
    SENTENCE_RUNTIME_AVAILABILITY,
    SUBJECT_SELECTOR_CODE,
    WORD_RUNTIME_SUPPORT
} from 'ingame/contract/word_sentence_contract.js';

export const R6_TOWER_MERGE_GROUP_OPERATION_PROFILE
    = normalizeTowerGroupOperationProfile({
        abiVersion: TOWER_GROUP_OPERATION_PROFILE_ABI_VERSION,
        id: TOWER_GROUP_OPERATION_PROFILE_ID.MERGE,
        operationKind: TOWER_GROUP_OPERATION_KIND.MERGE,
        actionCode: SENTENCE_ACTION_CODE.MERGE,
        subjectSelectorCode: SUBJECT_SELECTOR_CODE.TOWER,
        subjectSelectionPolicy:
            TOWER_GROUP_SUBJECT_SELECTION_POLICY.ALL_LIVING_TOWERS,
        subjectSnapshotPolicy:
            TOWER_GROUP_SUBJECT_SNAPSHOT_POLICY.EXECUTION_START,
        payloadRequirement: SENTENCE_PAYLOAD_REQUIREMENT.FORBIDDEN,
        atomic: true,
        generatedBodyCount: 0,
        cooldownAuthority: TOWER_GROUP_OPERATION_AUTHORITY.WORD_PROTOCOL,
        subjectBudgetAuthority: TOWER_GROUP_OPERATION_AUTHORITY.WORD_PROTOCOL,
        generatedBodyBudgetAuthority:
            TOWER_GROUP_OPERATION_AUTHORITY.PROFILE_FIXED_ZERO,
        runtimeSupport: WORD_RUNTIME_SUPPORT.R6,
        runtimeAvailability:
            SENTENCE_RUNTIME_AVAILABILITY.RUNTIME_AVAILABLE,
        previewFormulaId: 'preview.tower-group-merge.r6.v1'
    }, 'R6 Tower Merge group-operation profile');

export const R6_TOWER_GROUP_OPERATION_PROFILES = Object.freeze([
    R6_TOWER_MERGE_GROUP_OPERATION_PROFILE
]);

export const R6_TOWER_GROUP_OPERATION_PROFILE_BY_ACTION_CODE = Object.freeze(
    Object.fromEntries(R6_TOWER_GROUP_OPERATION_PROFILES.map((profile) => (
        [profile.actionCode, profile]
    )))
);
