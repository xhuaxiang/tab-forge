/**
 * performancePatch — 拍位索引、AI 表现补丁的序列化与应用（纯函数）。
 *
 * 本地底稿先产出，AI 只在其上改「奏法与表情」。应用器逐条补丁
 * 用 `validateNotes` 复检，失败整条回滚；任何补丁都不能增加/删除音符
 * 或改音高时值。
 */

import type { Note, NoteDuration } from '../../types/index.ts';
import { APP_HARMONICS } from '../../types/index.ts';
import type {
    HarmonyMeasure,
    PerformancePatch,
    PerformanceSlot,
    PhrasePlan,
    PlayabilityRules,
    ResolvedImprovOptions,
    SlotRole,
} from '../../types/improv/index.ts';
import { PERFORMANCE_TECHNIQUES } from '../../types/improv/index.ts';
import {
    DEFAULT_HARMONIC_FRET,
    HARMONIC_FRET_MAX,
    HARMONIC_FRET_MIN,
} from '../../config.ts';
import { groupFlatNotes } from '../noteGroup.ts';
import { capacityFromTimeSignature } from '../measureUtils.ts';
import { t } from '../../i18n/index.ts';
import { classifySlotRole } from './rhythm.ts';
import { validateNotes } from './validate.ts';

/** 序列化给 AI 看的单音摘要（只含表现层字段，不含 MIDI） */
export interface SerializedImprovNote {
    string: number;
    fret: number;
    technique?: NonNullable<Note['technique']>;
    bendAmount?: number;
    bendRelease?: true;
    dynamics?: NonNullable<Note['dynamics']>;
    palmMute?: true;
    deadNote?: true;
    letRing?: true;
    staccato?: true;
    harmonic?: NonNullable<Note['harmonic']>;
    harmonicFret?: number;
}

/** 序列化给 AI 看的拍位（与 `PerformanceSlot` 同一套定位） */
export interface SerializedImprovSlot {
    measureIndex: number;
    slotIndex: number;
    start: number;
    duration: NoteDuration;
    role: SlotRole;
    rest?: true;
    chordGroup?: number;
    arpeggio?: 'up' | 'down';
    strum?: 'up' | 'down';
    notes?: SerializedImprovNote[];
}

interface SlotIndex {
    slots: PerformanceSlot[];
    errors: string[];
}

/**
 * 给拍平 notes 建立 `(measureIndex, slotIndex)` 索引。
 *
 * 序列化与补丁应用必须共用本函数，否则 AI 看到的拍位会与应用时漂移。
 * 小节推进规则与 `scoreStore.loadNotes` 一致：放不下当前拍位就换小节。
 */
export function indexImprovSlots(
    notes: readonly Note[],
    options: ResolvedImprovOptions,
): SlotIndex {
    const capacity = capacityFromTimeSignature(options.timeSignature);
    if (!Number.isFinite(capacity) || capacity <= 0) {
        return {
            slots: [],
            errors: [t('improv.common.invalidTimeSignature', {
                signature: options.timeSignature,
            })],
        };
    }

    const groups = groupFlatNotes(notes);
    const slots: PerformanceSlot[] = [];
    const errors: string[] = [];

    let measureIndex = 0;
    let slotIndex = 0;
    let beatsInMeasure = 0;
    let cursor = 0;

    for (const group of groups) {
        const head = group[0];
        const duration = head.duration;
        if (!Number.isFinite(duration) || duration <= 0) {
            errors.push(t('improv.patch.slotDurationInvalid', {
                slot: slots.length + 1,
                duration,
            }));
            break;
        }

        if (beatsInMeasure + duration > capacity + 1e-3) {
            measureIndex += 1;
            slotIndex = 0;
            beatsInMeasure = 0;
        }
        if (measureIndex >= options.numMeasures) {
            errors.push(t('improv.patch.slotBeyondCapacity', { measures: options.numMeasures }));
            break;
        }

        slots.push({
            measureIndex,
            slotIndex,
            noteStart: cursor,
            noteEnd: cursor + group.length,
            start: beatsInMeasure,
            duration,
            isRest: head.isRest === true,
        });

        beatsInMeasure += duration;
        slotIndex += 1;
        cursor += group.length;
    }

    return { slots, errors };
}

/** 序列化成 AI 可读的拍位表；索引失败时返回空数组。 */
export function serializeImprovSlots(
    notes: readonly Note[],
    options: ResolvedImprovOptions,
): SerializedImprovSlot[] {
    const { slots } = indexImprovSlots(notes, options);
    const groups = groupFlatNotes(notes);

    return slots.map((slot, index) => {
        const head = groups[index][0];
        const result: SerializedImprovSlot = {
            measureIndex: slot.measureIndex,
            slotIndex: slot.slotIndex,
            start: slot.start,
            duration: slot.duration,
            role: classifySlotRole(slot.start, slot.duration, options.timeSignature),
        };
        if (slot.isRest) {
            result.rest = true;
            return result;
        }
        if (head.chordGroup !== undefined) result.chordGroup = head.chordGroup;
        if (head.arpeggio !== undefined) result.arpeggio = head.arpeggio;
        if (head.strum !== undefined) result.strum = head.strum;
        result.notes = groups[index].map(note => {
            const summary: SerializedImprovNote = {
                string: note.string ?? 0,
                fret: note.fret ?? 0,
            };
            if (note.technique !== undefined) summary.technique = note.technique;
            if (note.bendAmount !== undefined) summary.bendAmount = note.bendAmount;
            if (note.bendRelease) summary.bendRelease = true;
            if (note.dynamics !== undefined) summary.dynamics = note.dynamics;
            if (note.palmMute) summary.palmMute = true;
            if (note.deadNote) summary.deadNote = true;
            if (note.letRing) summary.letRing = true;
            if (note.staccato) summary.staccato = true;
            if (note.harmonic !== undefined) summary.harmonic = note.harmonic;
            if (note.harmonicFret !== undefined) summary.harmonicFret = note.harmonicFret;
            return summary;
        });
        return result;
    });
}

export interface RejectedPatch {
    patch: PerformancePatch;
    reason: string;
}

export interface PatchApplyResult {
    notes: Note[];
    applied: number;
    dropped: RejectedPatch[];
    /** 索引不一致或最终复检失败时回退整份底稿 */
    reverted: boolean;
    finalErrors: string[];
}

const VALID_DYNAMICS: ReadonlySet<string> = new Set(['soft', 'accent']);
const VALID_BEND_AMOUNTS: readonly number[] = [0.25, 0.5, 1];
const TECHNIQUE_SET: ReadonlySet<string> = new Set(PERFORMANCE_TECHNIQUES);
const HARMONIC_SET: ReadonlySet<string> = new Set(APP_HARMONICS);

function isTechnique(value: unknown): value is NonNullable<Note['technique']> {
    return typeof value === 'string' && TECHNIQUE_SET.has(value);
}

function isHarmonic(value: unknown): value is NonNullable<Note['harmonic']> {
    return typeof value === 'string' && HARMONIC_SET.has(value);
}

function clearPerformance(note: Note): void {
    delete note.technique;
    delete note.bendAmount;
    delete note.bendRelease;
    delete note.dynamics;
    delete note.palmMute;
    delete note.deadNote;
    delete note.letRing;
    delete note.staccato;
    delete note.harmonic;
    delete note.harmonicFret;
}

/**
 * 把单音补丁落到一个音符上。
 *
 * @returns 错误原因；成功时返回 null（原地修改传入的克隆）
 */
function applySingleNote(
    note: Note,
    patch: PerformancePatch,
): string | null {
    if (patch.dynamics !== undefined && patch.dynamics !== null
        && !VALID_DYNAMICS.has(patch.dynamics)) {
        return t('improv.patch.dynamicsInvalid', { dynamics: patch.dynamics });
    }
    if (patch.technique !== undefined && patch.technique !== null
        && !isTechnique(patch.technique)) {
        return t('improv.patch.techniqueInvalid', { technique: patch.technique });
    }
    if (patch.bendAmount !== undefined
        && !VALID_BEND_AMOUNTS.includes(patch.bendAmount)) {
        return t('improv.patch.bendAmountInvalid', { amount: patch.bendAmount });
    }
    if (patch.harmonic !== undefined && patch.harmonic !== null
        && !isHarmonic(patch.harmonic)) {
        return t('improv.patch.harmonicInvalid', { harmonic: patch.harmonic });
    }
    if (patch.harmonicFret !== undefined
        && (!Number.isInteger(patch.harmonicFret)
            || patch.harmonicFret < HARMONIC_FRET_MIN
            || patch.harmonicFret > HARMONIC_FRET_MAX)) {
        return t('improv.patch.harmonicFretInvalid', { fret: patch.harmonicFret });
    }
    for (const field of ['palmMute', 'deadNote', 'letRing', 'staccato'] as const) {
        const value = patch[field];
        if (value !== undefined && value !== null && typeof value !== 'boolean') {
            return t('improv.patch.fieldNotBoolean', { field });
        }
    }

    const technique = patch.technique === undefined
        ? note.technique
        : (patch.technique ?? undefined);
    const hasBendFields = patch.bendAmount !== undefined
        || patch.bendRelease !== undefined;
    if (technique !== 'bend' && hasBendFields) {
        // 允许在既有 bend 上只改幅度：此时 technique 解析结果仍是 bend
        return t('improv.patch.bendFieldsWithoutTechnique');
    }

    const harmonic = patch.harmonic === undefined
        ? note.harmonic
        : (patch.harmonic ?? undefined);
    if (harmonic === undefined && patch.harmonicFret !== undefined
        && patch.harmonic !== null) {
        return t('improv.patch.harmonicFretWithoutHarmonic');
    }

    const deadNote = patch.deadNote === undefined ? note.deadNote === true : patch.deadNote === true;
    const palmMute = patch.palmMute === undefined ? note.palmMute === true : patch.palmMute === true;
    const letRing = patch.letRing === undefined ? note.letRing === true : patch.letRing === true;
    const staccato = patch.staccato === undefined ? note.staccato === true : patch.staccato === true;
    const dynamics = patch.dynamics === undefined
        ? note.dynamics
        : (patch.dynamics ?? undefined);
    // clearPerformance 会把旧字段删掉；沿用旧值前先取下来
    const existingHarmonicFret = note.harmonicFret;
    const existingBendAmount = note.bendAmount;
    const existingBendRelease = note.bendRelease === true;

    clearPerformance(note);

    // 互斥字段的归一化优先级：制音 > 泛音 > 闷音 > 延音 > 技法。
    // `validateNotes` 允许泛音/闷音/延音与断音共存，因此这些分支保留断音；
    // 技法与制音则一律清掉断音。
    if (deadNote) {
        note.deadNote = true;
    } else if (harmonic !== undefined) {
        note.harmonic = harmonic;
        if (harmonic === 'natural') {
            delete note.harmonicFret;
        } else {
            const fret = patch.harmonicFret ?? existingHarmonicFret ?? DEFAULT_HARMONIC_FRET;
            note.harmonicFret = fret;
        }
        if (letRing) note.letRing = true;
        if (staccato) note.staccato = true;
    } else if (palmMute) {
        note.palmMute = true;
        if (staccato) note.staccato = true;
    } else if (letRing) {
        note.letRing = true;
        if (staccato) note.staccato = true;
    } else if (technique !== undefined) {
        note.technique = technique;
        if (technique === 'bend') {
            const amount = patch.bendAmount ?? existingBendAmount ?? 1;
            note.bendAmount = amount;
            if (patch.bendRelease === true
                || (patch.bendRelease === undefined && existingBendRelease)) {
                note.bendRelease = true;
            }
        }
    } else if (staccato) {
        note.staccato = true;
    }

    if (dynamics !== undefined) note.dynamics = dynamics;

    // 时值/弦号/自然泛音节点等约束交给 validateNotes，逐条失败即回滚
    return null;
}

/**
 * 和弦组只接受 `dynamics` / `arpeggio` / `strum`。
 *
 * 按「字段是否出现」判定：`palmMute: false` 这种清除写法在组上同样是越权，
 * 不能当 no-op 悄悄放过。
 */
function isForbiddenChordPatch(patch: PerformancePatch): boolean {
    return patch.technique !== undefined
        || patch.bendAmount !== undefined
        || patch.bendRelease !== undefined
        || patch.palmMute !== undefined
        || patch.deadNote !== undefined
        || patch.letRing !== undefined
        || patch.staccato !== undefined
        || patch.harmonic !== undefined
        || patch.harmonicFret !== undefined;
}

/** 表现字段的规范化签名，用于判定补丁是否真的改动了什么 */
function performanceSignature(note: Note): string {
    return JSON.stringify([
        note.dynamics ?? null,
        note.technique ?? null,
        note.bendAmount ?? null,
        note.bendRelease === true,
        note.palmMute === true,
        note.deadNote === true,
        note.letRing === true,
        note.staccato === true,
        note.harmonic ?? null,
        note.harmonicFret ?? null,
        note.arpeggio ?? null,
        note.strum ?? null,
    ]);
}

function isNoopGroup(
    group: readonly Note[],
    cloned: readonly Note[],
): boolean {
    return group.every((note, index) =>
        performanceSignature(note) === performanceSignature(cloned[index]));
}

function hasAnyField(patch: PerformancePatch): boolean {
    return patch.dynamics !== undefined
        || patch.technique !== undefined
        || patch.bendAmount !== undefined
        || patch.bendRelease !== undefined
        || patch.palmMute !== undefined
        || patch.deadNote !== undefined
        || patch.letRing !== undefined
        || patch.staccato !== undefined
        || patch.harmonic !== undefined
        || patch.harmonicFret !== undefined
        || patch.arpeggio !== undefined
        || patch.strum !== undefined;
}

/**
 * 逐条应用表现补丁；失败的单条回滚，其余继续。
 *
 * 输入不被修改。索引不一致或最终复检失败时整份回退底稿。
 */
export function applyPerformancePatches(
    notes: readonly Note[],
    patches: readonly PerformancePatch[],
    options: ResolvedImprovOptions,
    playability: PlayabilityRules,
    harmony: readonly HarmonyMeasure[],
    phrases: readonly PhrasePlan[],
    middleMaxLeapSemitones: number,
    maxPatches: number,
): PatchApplyResult {
    const base = notes.map(note => ({ ...note }));
    const index = indexImprovSlots(base, options);
    if (index.errors.length > 0) {
        return {
            notes: base,
            applied: 0,
            dropped: [],
            reverted: true,
            finalErrors: index.errors,
        };
    }

    const slotByKey = new Map<string, PerformanceSlot>();
    for (const slot of index.slots) {
        slotByKey.set(`${slot.measureIndex}:${slot.slotIndex}`, slot);
    }
    const lastSoundingSlot = [...index.slots]
        .reverse()
        .find(slot => !slot.isRest);

    // 稳定排序：同拍位的补丁保持 AI 返回顺序
    const sorted = [...patches].sort(
        (a, b) => a.measureIndex - b.measureIndex || a.slotIndex - b.slotIndex,
    );
    const limit = Number.isFinite(maxPatches) && maxPatches >= 0
        ? Math.floor(maxPatches)
        : sorted.length;

    const working = base.map(note => ({ ...note }));
    const dropped: RejectedPatch[] = [];
    for (const patch of sorted.slice(limit)) {
        dropped.push({
            patch,
            reason: t('improv.patch.tooManyExtensions', { limit }),
        });
    }

    let applied = 0;
    for (const patch of sorted.slice(0, limit)) {
        if (!Number.isInteger(patch.measureIndex) || !Number.isInteger(patch.slotIndex)
            || patch.measureIndex < 0 || patch.slotIndex < 0) {
            dropped.push({ patch, reason: t('improv.patch.slotIndexInvalid') });
            continue;
        }
        if (!hasAnyField(patch)) {
            dropped.push({ patch, reason: t('improv.patch.noFields') });
            continue;
        }

        const slot = slotByKey.get(`${patch.measureIndex}:${patch.slotIndex}`);
        if (!slot) {
            dropped.push({
                patch,
                reason: t('improv.patch.slotNotFound', {
                    measure: patch.measureIndex + 1,
                    slot: patch.slotIndex + 1,
                }),
            });
            continue;
        }
        if (slot.isRest) {
            dropped.push({ patch, reason: t('improv.patch.targetIsRest') });
            continue;
        }

        const group = working.slice(slot.noteStart, slot.noteEnd);
        const isChord = slot.noteEnd - slot.noteStart > 1;

        let reason: string | null = null;
        const candidate = working.slice();
        const cloned = group.map(note => ({ ...note }));

        if (isChord) {
            if (isForbiddenChordPatch(patch)) {
                reason = t('improv.patch.chordGroupLimited');
            } else if (patch.dynamics !== undefined && patch.dynamics !== null
                && !VALID_DYNAMICS.has(patch.dynamics)) {
                reason = t('improv.patch.dynamicsInvalid', { dynamics: patch.dynamics });
            } else if (patch.arpeggio !== undefined && patch.arpeggio !== null
                && patch.arpeggio !== 'up' && patch.arpeggio !== 'down') {
                reason = t('improv.patch.arpeggioInvalid', { arpeggio: patch.arpeggio });
            } else if (patch.strum !== undefined && patch.strum !== null
                && patch.strum !== 'up' && patch.strum !== 'down') {
                reason = t('improv.patch.strumInvalid', { strum: patch.strum });
            } else {
                if (patch.dynamics === null) {
                    for (const note of cloned) delete note.dynamics;
                } else if (patch.dynamics !== undefined) {
                    for (const note of cloned) note.dynamics = patch.dynamics;
                }
                if (patch.strum !== undefined) {
                    if (patch.strum === null) delete cloned[0].strum;
                    else {
                        cloned[0].strum = patch.strum;
                        delete cloned[0].arpeggio;
                    }
                } else if (patch.arpeggio !== undefined) {
                    if (patch.arpeggio === null) delete cloned[0].arpeggio;
                    else {
                        cloned[0].arpeggio = patch.arpeggio;
                        delete cloned[0].strum;
                    }
                }
            }
        } else {
            if (patch.arpeggio === 'up' || patch.arpeggio === 'down'
                || patch.strum === 'up' || patch.strum === 'down') {
                reason = t('improv.patch.singleNoArpeggio');
            } else {
                reason = applySingleNote(cloned[0], patch);
            }
        }

        if (reason === null
            && patch.deadNote === true
            && lastSoundingSlot !== undefined
            && lastSoundingSlot.measureIndex === slot.measureIndex
            && lastSoundingSlot.slotIndex === slot.slotIndex) {
            reason = t('improv.patch.lastNoteMute');
        }

        // 例如 `{ arpeggio: null }` 落在单音上：合法但没有实际改动
        if (reason === null && isNoopGroup(group, cloned)) {
            reason = t('improv.patch.noChange');
        }

        if (reason === null) {
            for (let i = slot.noteStart; i < slot.noteEnd; i++) {
                candidate[i] = cloned[i - slot.noteStart];
            }
            const errors = validateNotes(
                candidate, options, playability,
                middleMaxLeapSemitones, harmony, phrases,
            );
            if (errors.length > 0) reason = errors[0];
        }

        if (reason !== null) {
            dropped.push({ patch, reason });
            continue;
        }
        for (let i = slot.noteStart; i < slot.noteEnd; i++) {
            working[i] = candidate[i];
        }
        applied += 1;
    }

    const finalErrors = validateNotes(
        working, options, playability,
        middleMaxLeapSemitones, harmony, phrases,
    );
    if (finalErrors.length > 0) {
        return {
            notes: base,
            applied: 0,
            dropped,
            reverted: true,
            finalErrors,
        };
    }

    return { notes: working, applied, dropped, reverted: false, finalErrors: [] };
}
