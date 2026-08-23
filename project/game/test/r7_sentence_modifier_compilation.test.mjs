import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    ACTOR_PAYLOAD_CODE,
    SENTENCE_ACTION_CODE,
    SENTENCE_COMPILE_ERROR_CODE,
    SENTENCE_MODIFIER_CODE,
    WORD_DEFINITION_ID,
    normalizeSentenceDefinition,
    normalizeWordDefinition,
    normalizeWordInstance
} = await loadGameModule('ingame/contract/word_sentence_contract.js');
const {
    MODIFIER_PROFILE_ID,
    normalizeModifierProfile
} = await loadGameModule('ingame/contract/sentence_modifier_contract.js');
const {
    normalizeAbilityExecutionCommand
} = await loadGameModule('ingame/contract/ability_execution_contract.js');
const {
    R7_TWICE_MODIFIER_PROFILE
} = await loadGameModule('data/word/r7_sentence_modifier_profile_data.js');
const {
    R3_ENEMY_WORD_INSTANCE,
    R3_SHOOT_WORD_INSTANCE,
    R3_TOWER_WORD_INSTANCE,
    R5_EMIT_WORD_INSTANCE,
    R5_SUMMON_WORD_INSTANCE,
    R5_THROW_WORD_INSTANCE,
    R6_MERGE_WORD_INSTANCE,
    R7_TOWER_SHOOTS_ENEMIES_TWICE_SENTENCE,
    R7_TOWER_SHOOTS_ENEMIES_TWICE_TWICE_SENTENCE,
    R7_TOWER_SHOOTS_TOWERS_TWICE_SENTENCE,
    R7_TOWERS_MERGE_TWICE_SENTENCE,
    R7_TWICE_WORD_INSTANCE_1,
    R7_TWICE_WORD_INSTANCE_2,
    R7_TWICE_WORD_INSTANCE_3,
    R7_WORD_DEFINITION_BY_ID,
    R7_WORD_INSTANCE_BY_ID,
    R7_WORD_PROTOCOL_DATA,
    TWICE_MODIFIER_WORD_DEFINITION
} = await loadGameModule('data/word/r3_word_catalog_data.js');
const {
    SentenceCompiler
} = await loadGameModule('ingame/word/sentence_compiler.js');
const {
    resolveSentenceModifiers
} = await loadGameModule('ingame/word/sentence_modifier_resolver.js');
const {
    SentenceRuntimeEstimator
} = await loadGameModule('ingame/word/sentence_runtime_estimator.js');

function compilerWith(overrides = {}) {
    return new SentenceCompiler({
        wordDefinitionsById: R7_WORD_DEFINITION_BY_ID,
        wordInstancesById: R7_WORD_INSTANCE_BY_ID,
        protocol: R7_WORD_PROTOCOL_DATA,
        ...overrides
    });
}

function sentenceWith({
    id,
    subject = R3_TOWER_WORD_INSTANCE,
    verb = R3_SHOOT_WORD_INSTANCE,
    payload = R3_ENEMY_WORD_INSTANCE,
    modifiers = [R7_TWICE_WORD_INSTANCE_1.id]
}) {
    return normalizeSentenceDefinition({
        id,
        subjectWordInstanceId: subject.id,
        verbWordInstanceId: verb.id,
        payloadWordInstanceId: payload?.id ?? null,
        modifierWordInstanceIds: modifiers
    }, 'testSentence', {
        payloadRequirement: payload === null ? 'FORBIDDEN' : 'REQUIRED'
    });
}

function mutableProfile(overrides = {}) {
    const {
        modifierProfileFingerprint: ignoredFingerprint,
        ...profile
    } = R7_TWICE_MODIFIER_PROFILE;
    return {
        ...profile,
        supportedActionCodes: [
            ...R7_TWICE_MODIFIER_PROFILE.supportedActionCodes
        ],
        supportedPayloadCodes: [
            ...R7_TWICE_MODIFIER_PROFILE.supportedPayloadCodes
        ],
        ...overrides
    };
}

function syntheticModifierDefinition(id, profileId = MODIFIER_PROFILE_ID.TWICE) {
    return normalizeWordDefinition({
        ...TWICE_MODIFIER_WORD_DEFINITION,
        id,
        modifier: {
            modifierCode: SENTENCE_MODIFIER_CODE.TWICE,
            profileId,
            runtimeSupport: 'r7'
        }
    });
}

function syntheticModifierInstance(id, definitionId) {
    return normalizeWordInstance({ id, definitionId });
}

function commandFor(compiledAbility, overrides = {}) {
    return normalizeAbilityExecutionCommand({
        compiledAbility,
        executionId: 'execution.r7.modifier.test',
        executionOrdinal: 7,
        targetFixedTick: 101,
        aimPoint: { x: 12.5, y: -3.25 },
        ...overrides
    });
}

function exactTowerRuntime(overrides = {}) {
    return {
        livingTowerCount: 2,
        towerSubjectCountExact: true,
        eligibleTowerActorCount: 2,
        towerGenerationEligibilityExact: true,
        liveHostileActorCount: 4,
        hostileSubjectCountExact: true,
        eligibleHostileActorCount: 4,
        hostileGenerationEligibilityExact: true,
        pendingHostileActorCount: 0,
        registryAvailable: 1000,
        bodyAvailable: 1000,
        bountyPerEnemy: 3,
        siegeWeightPerEnemy: 1.5,
        siegeWeight: 5,
        ...overrides
    };
}

function assertDeepFrozen(value, visited = new Set()) {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) {
        assertDeepFrozen(child, visited);
    }
}

test('ModifierSet은 authored order와 canonical semantic order를 분리한다', () => {
    const alpha = syntheticModifierDefinition('modifier.test.alpha');
    const beta = syntheticModifierDefinition('modifier.test.beta');
    const alphaInstance = syntheticModifierInstance(
        'word-instance.test.alpha',
        alpha.id
    );
    const betaInstance = syntheticModifierInstance(
        'word-instance.test.beta',
        beta.id
    );
    const wordDefinitionsById = {
        ...R7_WORD_DEFINITION_BY_ID,
        [alpha.id]: alpha,
        [beta.id]: beta
    };
    const wordInstancesById = {
        ...R7_WORD_INSTANCE_BY_ID,
        [alphaInstance.id]: alphaInstance,
        [betaInstance.id]: betaInstance
    };
    const compiler = compilerWith({ wordDefinitionsById, wordInstancesById });
    const alphaThenBeta = compiler.compile(sentenceWith({
        id: 'sentence.test.alpha-beta',
        modifiers: [alphaInstance.id, betaInstance.id]
    }));
    const betaThenAlpha = compiler.compile(sentenceWith({
        id: 'sentence.test.beta-alpha',
        modifiers: [betaInstance.id, alphaInstance.id]
    }));

    assert.equal(
        alphaThenBeta.modifierSetFingerprint,
        betaThenAlpha.modifierSetFingerprint
    );
    assert.equal(alphaThenBeta.executionShape.copiesPerSubject, 4);
    assert.equal(betaThenAlpha.executionShape.copiesPerSubject, 4);
    assert.deepEqual(
        alphaThenBeta.displaySentenceData.modifierWordDefinitionIds,
        [alpha.id, beta.id]
    );
    assert.deepEqual(
        betaThenAlpha.displaySentenceData.modifierWordDefinitionIds,
        [beta.id, alpha.id]
    );
    assert.deepEqual(
        alphaThenBeta.modifierSet.canonicalEntries.map(
            ({ definitionId }) => definitionId
        ),
        [alpha.id, beta.id]
    );
    assert.equal(alphaThenBeta.compiledAbilityId, betaThenAlpha.compiledAbilityId);
    assert.notStrictEqual(alphaThenBeta, betaThenAlpha);
    assertDeepFrozen(alphaThenBeta.modifierSet);
    assertDeepFrozen(betaThenAlpha.modifierSet);
});

test('Twice stack 1/2/3은 2/4/8 copies이고 네 번째 stack은 명시적으로 거절된다', () => {
    const fourth = syntheticModifierInstance(
        'word-instance.r7.twice.4',
        WORD_DEFINITION_ID.TWICE
    );
    const compiler = compilerWith({
        wordInstancesById: {
            ...R7_WORD_INSTANCE_BY_ID,
            [fourth.id]: fourth
        }
    });
    const ids = [
        R7_TWICE_WORD_INSTANCE_1.id,
        R7_TWICE_WORD_INSTANCE_2.id,
        R7_TWICE_WORD_INSTANCE_3.id,
        fourth.id
    ];
    for (let stackCount = 1; stackCount <= 3; stackCount++) {
        const compiled = compiler.compile(sentenceWith({
            id: `sentence.test.stack-${stackCount}`,
            modifiers: ids.slice(0, stackCount)
        }));
        assert.equal(
            compiled.executionShape.copiesPerSubject,
            2 ** stackCount
        );
        assert.equal(
            compiled.modifierSet.canonicalEntries[0].stackCount,
            stackCount
        );
    }
    assert.equal(
        compiler.tryCompile(sentenceWith({
            id: 'sentence.test.stack-4',
            modifiers: ids
        })).code,
        SENTENCE_COMPILE_ERROR_CODE.MODIFIER_STACK_LIMIT_EXCEEDED
    );
    assert.equal(
        compiler.tryCompile(sentenceWith({
            id: 'sentence.test.same-instance',
            modifiers: [
                R7_TWICE_WORD_INSTANCE_1.id,
                R7_TWICE_WORD_INSTANCE_1.id
            ]
        })).code,
        SENTENCE_COMPILE_ERROR_CODE.DUPLICATE_MODIFIER_INSTANCE
    );
});

test('Modifier conflict, wrong kind, unknown profile은 각각 stable code로 실패한다', () => {
    const alpha = syntheticModifierDefinition('modifier.test.conflict-alpha');
    const beta = syntheticModifierDefinition('modifier.test.conflict-beta');
    const alphaInstance = syntheticModifierInstance(
        'word-instance.test.conflict-alpha',
        alpha.id
    );
    const betaInstance = syntheticModifierInstance(
        'word-instance.test.conflict-beta',
        beta.id
    );
    const conflictingProfile = normalizeModifierProfile(mutableProfile({
        conflictGroup: 'execution-cardinality-exclusive'
    }));
    const conflictCompiler = compilerWith({
        wordDefinitionsById: {
            ...R7_WORD_DEFINITION_BY_ID,
            [alpha.id]: alpha,
            [beta.id]: beta
        },
        wordInstancesById: {
            ...R7_WORD_INSTANCE_BY_ID,
            [alphaInstance.id]: alphaInstance,
            [betaInstance.id]: betaInstance
        },
        modifierProfilesById: {
            [conflictingProfile.id]: conflictingProfile
        },
        modifierProfilesByCode: {
            [conflictingProfile.modifierCode]: conflictingProfile
        }
    });
    assert.equal(
        conflictCompiler.tryCompile(sentenceWith({
            id: 'sentence.test.conflict',
            modifiers: [alphaInstance.id, betaInstance.id]
        })).code,
        SENTENCE_COMPILE_ERROR_CODE.MODIFIER_CONFLICT
    );

    assert.equal(
        compilerWith().tryCompile(sentenceWith({
            id: 'sentence.test.wrong-kind',
            modifiers: [R3_SHOOT_WORD_INSTANCE.id]
        })).code,
        SENTENCE_COMPILE_ERROR_CODE.WRONG_WORD_KIND
    );

    const unknownDefinition = syntheticModifierDefinition(
        'modifier.test.unknown-profile',
        'sentence-modifier.unknown.v1'
    );
    const unknownInstance = syntheticModifierInstance(
        'word-instance.test.unknown-profile',
        unknownDefinition.id
    );
    assert.equal(
        compilerWith({
            wordDefinitionsById: {
                ...R7_WORD_DEFINITION_BY_ID,
                [unknownDefinition.id]: unknownDefinition
            },
            wordInstancesById: {
                ...R7_WORD_INSTANCE_BY_ID,
                [unknownInstance.id]: unknownInstance
            }
        }).tryCompile(sentenceWith({
            id: 'sentence.test.unknown-profile',
            modifiers: [unknownInstance.id]
        })).code,
        SENTENCE_COMPILE_ERROR_CODE.UNKNOWN_MODIFIER
    );
});

test('Tower/Enemy Subject × 네 ActorAction × Enemy/Tower Payload가 Twice와 호환된다', () => {
    const compiler = compilerWith();
    const subjects = [R3_TOWER_WORD_INSTANCE, R3_ENEMY_WORD_INSTANCE];
    const verbs = [
        R3_SHOOT_WORD_INSTANCE,
        R5_THROW_WORD_INSTANCE,
        R5_EMIT_WORD_INSTANCE,
        R5_SUMMON_WORD_INSTANCE
    ];
    const payloads = [R3_ENEMY_WORD_INSTANCE, R3_TOWER_WORD_INSTANCE];
    let index = 0;
    for (const subject of subjects) {
        for (const verb of verbs) {
            for (const payload of payloads) {
                const compiled = compiler.compile(sentenceWith({
                    id: `sentence.test.compatibility-${index++}`,
                    subject,
                    verb,
                    payload
                }));
                assert.match(compiled.compiledAbilityId, /^compiled-ability\.r7:/);
                assert.equal(compiled.executionShape.copiesPerSubject, 2);
                assert.equal(compiled.actionCode, verb === R3_SHOOT_WORD_INSTANCE
                    ? SENTENCE_ACTION_CODE.SHOOT
                    : verb === R5_THROW_WORD_INSTANCE
                        ? SENTENCE_ACTION_CODE.THROW
                        : verb === R5_EMIT_WORD_INSTANCE
                            ? SENTENCE_ACTION_CODE.EMIT
                            : SENTENCE_ACTION_CODE.SUMMON);
                assert.equal(compiled.payloadCode,
                    payload === R3_ENEMY_WORD_INSTANCE
                        ? ACTOR_PAYLOAD_CODE.ENEMY
                        : ACTOR_PAYLOAD_CODE.TOWER);
            }
        }
    }
    assert.equal(index, 16);
    assert.equal(
        compiler.tryCompile(R7_TOWERS_MERGE_TWICE_SENTENCE).code,
        SENTENCE_COMPILE_ERROR_CODE.UNSUPPORTED_MODIFIER_FOR_OPERATION
    );
});

test('profile action/payload compatibility와 compile-time budget/overflow는 clamp 없이 실패한다', () => {
    const narrowProfile = normalizeModifierProfile(mutableProfile({
        supportedActionCodes: [SENTENCE_ACTION_CODE.SHOOT],
        supportedPayloadCodes: [ACTOR_PAYLOAD_CODE.ENEMY]
    }));
    const narrowCompiler = compilerWith({
        modifierProfilesById: { [narrowProfile.id]: narrowProfile },
        modifierProfilesByCode: {
            [narrowProfile.modifierCode]: narrowProfile
        }
    });
    assert.equal(
        narrowCompiler.tryCompile(sentenceWith({
            id: 'sentence.test.unsupported-action',
            verb: R5_THROW_WORD_INSTANCE
        })).code,
        SENTENCE_COMPILE_ERROR_CODE.UNSUPPORTED_MODIFIER
    );
    assert.equal(
        narrowCompiler.tryCompile(sentenceWith({
            id: 'sentence.test.unsupported-payload',
            payload: R3_TOWER_WORD_INSTANCE
        })).code,
        SENTENCE_COMPILE_ERROR_CODE.UNSUPPORTED_MODIFIER
    );
    assert.equal(
        compilerWith({
            protocol: { ...R7_WORD_PROTOCOL_DATA, generatedBodyBudget: 1 }
        }).tryCompile(R7_TOWER_SHOOTS_ENEMIES_TWICE_SENTENCE).code,
        SENTENCE_COMPILE_ERROR_CODE
            .MODIFIER_GENERATED_BODY_BUDGET_EXCEEDED
    );

    const hugeProfile = normalizeModifierProfile(mutableProfile({
        factorNumerator: 0xffffffff,
        maxStacks: 1
    }));
    const alpha = syntheticModifierDefinition('modifier.test.overflow-alpha');
    const beta = syntheticModifierDefinition('modifier.test.overflow-beta');
    const alphaInstance = syntheticModifierInstance(
        'word-instance.test.overflow-alpha',
        alpha.id
    );
    const betaInstance = syntheticModifierInstance(
        'word-instance.test.overflow-beta',
        beta.id
    );
    assert.equal(
        compilerWith({
            wordDefinitionsById: {
                ...R7_WORD_DEFINITION_BY_ID,
                [alpha.id]: alpha,
                [beta.id]: beta
            },
            wordInstancesById: {
                ...R7_WORD_INSTANCE_BY_ID,
                [alphaInstance.id]: alphaInstance,
                [betaInstance.id]: betaInstance
            },
            modifierProfilesById: { [hugeProfile.id]: hugeProfile },
            modifierProfilesByCode: {
                [hugeProfile.modifierCode]: hugeProfile
            },
            protocol: {
                ...R7_WORD_PROTOCOL_DATA,
                generatedBodyBudget: Number.MAX_SAFE_INTEGER
            }
        }).tryCompile(sentenceWith({
            id: 'sentence.test.modifier-overflow',
            modifiers: [alphaInstance.id, betaInstance.id]
        })).code,
        SENTENCE_COMPILE_ERROR_CODE.MODIFIER_CARDINALITY_OVERFLOW
    );
});

test('Modifier command identity는 semantic fingerprint/copies를 포함하고 mismatch replay를 거절한다', () => {
    const compiler = compilerWith();
    const once = compiler.compile(R7_TOWER_SHOOTS_ENEMIES_TWICE_SENTENCE);
    const twice = compiler.compile(
        R7_TOWER_SHOOTS_ENEMIES_TWICE_TWICE_SENTENCE
    );
    const onceCommand = commandFor(once);
    const onceReplay = commandFor(once);
    const twiceCommand = commandFor(twice);
    const base = new SentenceCompiler().compile(normalizeSentenceDefinition({
        id: 'sentence.test.command-base',
        subjectWordInstanceId: R3_TOWER_WORD_INSTANCE.id,
        verbWordInstanceId: R3_SHOOT_WORD_INSTANCE.id,
        payloadWordInstanceId: R3_ENEMY_WORD_INSTANCE.id,
        modifierWordInstanceIds: []
    }));
    const baseCommand = commandFor(base);

    assert.deepEqual(onceReplay, onceCommand);
    assert.equal(onceCommand.modifierSetFingerprint,
        once.modifierSetFingerprint);
    assert.equal(onceCommand.copiesPerSubject, 2);
    assert.notEqual(onceCommand.compiledAbilityCode,
        twiceCommand.compiledAbilityCode);
    assert.notEqual(onceCommand.fingerprint, twiceCommand.fingerprint);
    assert.notEqual(onceCommand.executionIdFingerprint,
        baseCommand.executionIdFingerprint);
    assert.equal(Object.hasOwn(baseCommand, 'modifierSetFingerprint'), false);
    assert.equal(Object.hasOwn(baseCommand, 'copiesPerSubject'), false);

    assert.throws(() => commandFor(once, {
        modifierSetFingerprint: once.modifierSetFingerprint ^ 1
    }), /ModifierSet execution shape/);
    assert.throws(() => commandFor(once, {
        copiesPerSubject: 3
    }), /ModifierSet execution shape/);
    assert.throws(() => commandFor(once, {
        fingerprint: twiceCommand.fingerprint
    }), /execution fingerprint/);
    const forgedModifierSet = Object.freeze({
        ...once.modifierSet,
        canonicalEntries: Object.freeze([
            Object.freeze({
                ...once.modifierSet.canonicalEntries[0],
                stackCount: 2
            })
        ])
    });
    assert.throws(() => commandFor(Object.freeze({
        ...once,
        modifierSet: forgedModifierSet
    })), /ModifierSet fingerprint/);
});

test('R7 preview는 exact generated cardinality와 Tower resulting count를 노출한다', () => {
    const compiler = compilerWith();
    const enemyAbility = compiler.compile(
        R7_TOWER_SHOOTS_ENEMIES_TWICE_TWICE_SENTENCE
    );
    const enemyPreview = new SentenceRuntimeEstimator({
        getRuntimeState: () => exactTowerRuntime()
    }).estimate(enemyAbility);
    assert.equal(enemyPreview.rawSubjectCount, 2);
    assert.equal(enemyPreview.copiesPerSubject, 4);
    assert.equal(enemyPreview.effectiveGeneratedCount, 8);
    assert.equal(enemyPreview.newEnemyCount, 8);
    assert.equal(enemyPreview.resultingHostileCount, 12);
    assert.equal(enemyPreview.requiredBodies, 8);
    assert.equal(enemyPreview.executionEnabled, true);
    assert.equal(enemyPreview.previewExact, true);

    const towerAbility = compiler.compile(
        R7_TOWER_SHOOTS_TOWERS_TWICE_SENTENCE
    );
    let childCount = 0;
    const towerPreview = new SentenceRuntimeEstimator({
        getRuntimeState: () => exactTowerRuntime(),
        previewTowerCreation: ({ childCount: value }) => {
            childCount = value;
            return Object.freeze({
                executionEnabled: true,
                capacity: 256,
                existing: Object.freeze([]),
                children: Object.freeze([])
            });
        }
    }).estimate(towerAbility);
    assert.equal(childCount, 4);
    assert.equal(towerPreview.effectiveGeneratedCount, 4);
    assert.equal(towerPreview.currentTowerCount, 2);
    assert.equal(towerPreview.resultingTowerCount, 6);
    assert.equal(towerPreview.newTowerCount, 4);
    assert.equal(towerPreview.previewExact, true);
});

test('R7 preview/runtime shared rejection은 unknown/zero/overflow/budget/capacity를 구분한다', () => {
    const ability = compilerWith().compile(
        R7_TOWER_SHOOTS_ENEMIES_TWICE_TWICE_SENTENCE
    );
    const cases = [
        {
            label: 'runtime unavailable',
            state: null,
            expected: 'RUNTIME_UNAVAILABLE'
        },
        {
            label: 'unknown subject',
            state: exactTowerRuntime({
                livingTowerCount: undefined,
                eligibleTowerActorCount: undefined
            }),
            expected: 'SUBJECT_COUNT_NOT_EXACT'
        },
        {
            label: 'zero subject',
            state: exactTowerRuntime({
                livingTowerCount: 0,
                eligibleTowerActorCount: 0
            }),
            expected: 'ZERO_SUBJECT'
        },
        {
            label: 'generated budget',
            state: exactTowerRuntime({
                livingTowerCount: 300,
                eligibleTowerActorCount: 300,
                registryAvailable: 2000,
                bodyAvailable: 2000
            }),
            expected: 'GENERATED_BODY_BUDGET_EXCEEDED'
        },
        {
            label: 'registry/body capacity',
            state: exactTowerRuntime({
                registryAvailable: 7,
                bodyAvailable: 100
            }),
            expected: 'DESTINATION_CAPACITY_EXCEEDED'
        }
    ];
    for (const scenario of cases) {
        const preview = new SentenceRuntimeEstimator({
            getRuntimeState: () => scenario.state
        }).estimate(ability);
        assert.equal(
            preview.executionDisabledReason,
            scenario.expected,
            scenario.label
        );
        assert.equal(preview.executionEnabled, false, scenario.label);
        assert.equal(preview.cooldownTicks, 0, scenario.label);
    }

    const overflowAbility = Object.freeze({
        ...ability,
        budgets: Object.freeze({
            ...ability.budgets,
            subjectCount: 0xffffffff,
            generatedBodyCount: 0xffffffff
        })
    });
    const overflowPreview = new SentenceRuntimeEstimator({
        getRuntimeState: () => exactTowerRuntime({
            livingTowerCount: 0x40000000,
            eligibleTowerActorCount: 0x40000000,
            registryAvailable: 0xffffffff,
            bodyAvailable: 0xffffffff
        })
    }).estimate(overflowAbility);
    assert.equal(
        overflowPreview.executionDisabledReason,
        'GENERATED_COUNT_OVERFLOW'
    );
    assert.equal(overflowPreview.effectiveGeneratedCount, 0);
    assert.equal(overflowPreview.cooldownTicks, 0);

    const unsupportedAbility = Object.freeze({
        ...ability,
        executionShape: Object.freeze({ copiesPerSubject: 3 })
    });
    const unsupportedPreview = new SentenceRuntimeEstimator({
        getRuntimeState: () => exactTowerRuntime()
    }).estimate(unsupportedAbility);
    assert.equal(
        unsupportedPreview.executionDisabledReason,
        'UNSUPPORTED_MODIFIER'
    );
    assert.equal(unsupportedPreview.cooldownTicks, 0);
});

test('R7 Tower preview는 256 cap과 low-HP runtime reason을 clamp 없이 공유한다', () => {
    const ability = compilerWith().compile(
        R7_TOWER_SHOOTS_TOWERS_TWICE_SENTENCE
    );
    let capPreviewCalls = 0;
    const capPreview = new SentenceRuntimeEstimator({
        getRuntimeState: () => exactTowerRuntime({
            livingTowerCount: 250,
            eligibleTowerActorCount: 250
        }),
        previewTowerCreation: () => {
            capPreviewCalls++;
            return { executionEnabled: true };
        }
    }).estimate(ability);
    assert.equal(capPreview.effectiveGeneratedCount, 500);
    assert.equal(capPreview.resultingTowerCount, 750);
    assert.equal(capPreview.executionDisabledReason, 'TOWER_CAPACITY_EXCEEDED');
    assert.equal(capPreview.cooldownTicks, 0);
    assert.equal(capPreviewCalls, 0);

    const lowHpPreview = new SentenceRuntimeEstimator({
        getRuntimeState: () => exactTowerRuntime(),
        previewTowerCreation: () => Object.freeze({
            executionEnabled: false,
            reason: 'TOWER_CURRENT_HP_TOO_LOW'
        })
    }).estimate(ability);
    assert.equal(
        lowHpPreview.executionDisabledReason,
        'TOWER_CURRENT_HP_TOO_LOW'
    );
    assert.equal(lowHpPreview.cooldownTicks, 0);
});

test('resolver는 source copy-out을 동결하고 unique catalog identity를 한 번만 materialize한다', () => {
    const instanceGetterReads = new Map();
    function getterInstance(id) {
        const reads = { id: 0, definitionId: 0 };
        instanceGetterReads.set(id, reads);
        return Object.defineProperties({}, {
            id: {
                enumerable: true,
                get() {
                    reads.id++;
                    return id;
                }
            },
            definitionId: {
                enumerable: true,
                get() {
                    reads.definitionId++;
                    return WORD_DEFINITION_ID.TWICE;
                }
            }
        });
    }
    const firstId = 'word-instance.test.getter-once.1';
    const secondId = 'word-instance.test.getter-once.2';
    const mapReads = {
        instance: new Map(),
        definition: new Map(),
        profileId: new Map(),
        profileCode: new Map()
    };
    function countedCatalog(source, counts) {
        return new Proxy(source, {
            get(target, key, receiver) {
                if (typeof key === 'string') {
                    counts.set(key, (counts.get(key) ?? 0) + 1);
                }
                return Reflect.get(target, key, receiver);
            }
        });
    }
    const authoredIds = [firstId, secondId];
    const modifierSet = resolveSentenceModifiers({
        modifierWordInstanceIds: authoredIds,
        wordInstancesById: countedCatalog({
            [firstId]: getterInstance(firstId),
            [secondId]: getterInstance(secondId)
        }, mapReads.instance),
        wordDefinitionsById: countedCatalog({
            [WORD_DEFINITION_ID.TWICE]: TWICE_MODIFIER_WORD_DEFINITION
        }, mapReads.definition),
        modifierProfilesById: countedCatalog({
            [R7_TWICE_MODIFIER_PROFILE.id]: R7_TWICE_MODIFIER_PROFILE
        }, mapReads.profileId),
        modifierProfilesByCode: countedCatalog({
            [R7_TWICE_MODIFIER_PROFILE.modifierCode]:
                R7_TWICE_MODIFIER_PROFILE
        }, mapReads.profileCode),
        baseCompiledSemanticContext: {
            actionCode: SENTENCE_ACTION_CODE.SHOOT,
            payloadCode: ACTOR_PAYLOAD_CODE.ENEMY,
            operationKind: null,
            generatedBodyBudget: 1000
        }
    });
    authoredIds.reverse();

    assert.deepEqual(modifierSet.authoredModifierWordInstanceIds,
        [firstId, secondId]);
    assert.equal(modifierSet.copiesPerSubject, 4);
    assert.equal(mapReads.instance.get(firstId), 1);
    assert.equal(mapReads.instance.get(secondId), 1);
    assert.equal(mapReads.definition.get(WORD_DEFINITION_ID.TWICE), 1);
    assert.equal(mapReads.profileId.get(R7_TWICE_MODIFIER_PROFILE.id), 1);
    assert.equal(mapReads.profileCode.get(String(SENTENCE_MODIFIER_CODE.TWICE)), 1);
    for (const reads of instanceGetterReads.values()) {
        assert.deepEqual(reads, { id: 1, definitionId: 1 });
    }
    assertDeepFrozen(modifierSet);
});

test('Merge fixture는 payload null이어도 Modifier를 ActorAction으로 우회하지 않는다', () => {
    const merge = sentenceWith({
        id: 'sentence.test.merge-twice-explicit',
        subject: R3_TOWER_WORD_INSTANCE,
        verb: R6_MERGE_WORD_INSTANCE,
        payload: null
    });
    assert.equal(merge.payloadWordInstanceId, null);
    assert.equal(
        compilerWith().tryCompile(merge).code,
        SENTENCE_COMPILE_ERROR_CODE.UNSUPPORTED_MODIFIER_FOR_OPERATION
    );
});
