/**
 * validate — 本地即兴生成结果的守门（纯函数）。
 *
 * 生成器不返回半成品：任何一条错误都应让 generateLocalImprovisation 抛错，
 * 避免把不可演奏/不闭合的音符写进 store。
 *
 * 拍平数组按 `chordGroup` 分组校验：和弦组的时值只累加一次，跳进看组内
 * 最高声部，组内成员共享拍位、时值与力度。
 */

import type { Note } from '../../types/index.ts';
import { APP_HARMONICS, NOTE_DURATIONS } from '../../types/index.ts';
import type {
    HarmonyMeasure,
    PhrasePlan,
    PlayabilityRules,
    ResolvedImprovOptions,
    RhythmMeasure,
} from '../../types/improv/index.ts';
import {
    BEND_AMOUNT_LABELS,
    HARMONIC_FRET_MAX,
    HARMONIC_FRET_MIN,
} from '../../config.ts';
import { isConnectingTechnique } from '../technique.ts';
import { t } from '../../i18n/index.ts';
import { capacityFromTimeSignature } from '../measureUtils.ts';
import { groupFlatNotes } from '../noteGroup.ts';
import { connectIssue } from './connect.ts';
import { segmentAt, segmentIndexAt } from './harmony.ts';
import {
    fretToMidi,
    isInScale,
    midiRangeForFretRange,
    nearestPlayableMidiWithPitchClasses,
    pitchClassOf,
} from './pitch.ts';
import { classifySlotRole } from './rhythm.ts';

const VALID_DURATIONS = new Set<number>(NOTE_DURATIONS);
const VALID_BEND_AMOUNTS = new Set<number>(
    Object.keys(BEND_AMOUNT_LABELS).map(Number),
);
const VALID_HARMONICS = new Set<string>(APP_HARMONICS);
const TOLERANCE = 1e-9;

function isDurationValid(duration: number): boolean {
    return VALID_DURATIONS.has(duration);
}

/** 校验节奏计划：小节数、容量闭合、时值合法、每小节至少一个发音 */
export function validatePlan(
    plan: RhythmMeasure[],
    options: ResolvedImprovOptions,
    minNotesPerMeasure = 1,
): string[] {
    const errors: string[] = [];
    const capacity = capacityFromTimeSignature(options.timeSignature);

    if (!Number.isFinite(capacity) || capacity <= 0) {
        return [t('improv.common.invalidTimeSignature', { signature: options.timeSignature })];
    }
    if (plan.length !== options.numMeasures) {
        errors.push(t('improv.validate.plan.measureCountMismatch', {
            actual: plan.length,
            expected: options.numMeasures,
        }));
    }

    plan.forEach((measure, measureIndex) => {
        const measureNumber = measureIndex + 1;
        if (measure.index !== measureIndex) {
            errors.push(t('improv.validate.plan.measureIndex', {
                measure: measureNumber,
                index: measureIndex,
            }));
        }
        if (Math.abs(measure.capacity - capacity) > TOLERANCE) {
            errors.push(t('improv.validate.plan.capacityMismatch', {
                measure: measureNumber,
                capacity: measure.capacity,
                expected: capacity,
            }));
        }
        if (measure.slots.length === 0) {
            errors.push(t('improv.validate.plan.noSlots', { measure: measureNumber }));
            return;
        }

        let total = 0;
        for (const slot of measure.slots) {
            if (!isDurationValid(slot.duration) || slot.duration <= 0) {
                errors.push(t('improv.validate.plan.invalidSlotDuration', {
                    measure: measureNumber,
                    duration: slot.duration,
                }));
            }
            total += slot.duration;
        }
        if (Math.abs(total - capacity) > TOLERANCE) {
            errors.push(t('improv.validate.plan.slotTotalNotClosed', {
                measure: measureNumber,
                total,
                capacity,
            }));
        }
        if (measure.slots.every(slot => slot.isRest)) {
            errors.push(t('improv.validate.plan.allRests', { measure: measureNumber }));
        }
        const sounding = measure.slots.filter(slot => !slot.isRest).length;
        if (sounding < minNotesPerMeasure) {
            errors.push(t('improv.validate.plan.tooFewSounding', {
                measure: measureNumber,
                sounding,
                min: minNotesPerMeasure,
            }));
        }
    });

    return errors;
}

/** 校验单个音符的位置/技法边界 */
function validateNoteFields(
    note: Note,
    options: ResolvedImprovOptions,
    playability: PlayabilityRules,
    index: number,
    allowedPitchClasses?: ReadonlySet<number>,
): string[] {
    const errors: string[] = [];
    const noteNumber = index + 1;
    const fretMin = options.fretRange?.min ?? playability.fretMin;
    const fretMax = options.fretRange?.max ?? playability.fretMax;

    if (!isDurationValid(note.duration) || note.duration <= 0) {
        errors.push(t('improv.validate.note.durationInvalid', {
            index: noteNumber,
            duration: note.duration,
        }));
    }

    if (note.isRest) {
        if (note.string !== undefined || note.fret !== undefined
            || note.technique !== undefined || note.dynamics !== undefined
            || note.targetFret !== undefined || note.bendAmount !== undefined
            || note.bendRelease !== undefined
            || note.palmMute !== undefined || note.deadNote !== undefined
            || note.letRing !== undefined || note.staccato !== undefined
            || note.harmonic !== undefined || note.harmonicFret !== undefined
            || note.tieToNext !== undefined || note.chordGroup !== undefined
            || note.chordName !== undefined || note.arpeggio !== undefined
            || note.strum !== undefined) {
            errors.push(t('improv.validate.note.restHasFields', { index: noteNumber }));
        }
        return errors;
    }

    if (note.string === undefined || !Number.isInteger(note.string)
        || note.string < 1 || note.string > 6) {
        errors.push(t('improv.validate.note.stringInvalid', {
            index: noteNumber,
            string: String(note.string),
        }));
    }
    if (note.fret === undefined || !Number.isInteger(note.fret)
        || note.fret < fretMin || note.fret > fretMax) {
        errors.push(t('improv.validate.note.fretInvalid', {
            index: noteNumber,
            fret: String(note.fret),
        }));
    }

    if (note.string !== undefined && note.fret !== undefined
        && note.string >= 1 && note.string <= 6
        && Number.isInteger(note.fret)) {
        try {
            const midi = fretToMidi(options.tuning, note.string, note.fret);
            const pitchClass = pitchClassOf(midi);
            const inAllowedPool = allowedPitchClasses
                ? allowedPitchClasses.has(pitchClass)
                : isInScale(midi, options.tonicPitchClass, options.scaleType);
            if (!inAllowedPool) {
                errors.push(t(
                    allowedPitchClasses
                        ? 'improv.validate.note.outsideHarmonyPool'
                        : 'improv.validate.note.outsideScale',
                    { index: noteNumber, midi },
                ));
            }
        } catch (error) {
            errors.push(t('improv.validate.note.pitchConversionFailed', {
                index: noteNumber,
                error: error instanceof Error ? error.message : String(error),
            }));
        }
    }

    if (note.technique !== undefined
        && note.technique !== 'bend' && note.technique !== 'vibrato'
        && !isConnectingTechnique(note.technique)) {
        errors.push(t('improv.validate.note.unsupportedTechnique', {
            index: noteNumber,
            technique: note.technique,
        }));
    }
    if (note.technique === 'bend') {
        if (note.bendAmount === undefined || !VALID_BEND_AMOUNTS.has(note.bendAmount)) {
            errors.push(t('improv.validate.note.bendAmountInvalid', {
                index: noteNumber,
                amount: String(note.bendAmount),
            }));
        }
        if (note.duration < playability.minBendDuration) {
            errors.push(t('improv.validate.note.bendTooShort', { index: noteNumber }));
        }
        if (note.fret !== undefined && note.fret <= 0) {
            errors.push(t('improv.validate.note.bendOnOpenString', { index: noteNumber }));
        }
        if (note.bendRelease && note.duration < playability.minBendReleaseDuration) {
            errors.push(t('improv.validate.note.bendReleaseTooShort', { index: noteNumber }));
        }
    } else if (note.bendAmount !== undefined || note.bendRelease !== undefined) {
        errors.push(t('improv.validate.note.bendFieldsWithoutTechnique', { index: noteNumber }));
    }
    if (note.technique === 'vibrato') {
        if (note.duration < playability.minVibratoDuration) {
            errors.push(t('improv.validate.note.vibratoTooShort', { index: noteNumber }));
        }
        if (note.fret !== undefined && note.fret <= 0) {
            errors.push(t('improv.validate.note.vibratoOnOpenString', { index: noteNumber }));
        }
    }

    if (note.deadNote) {
        if (note.string === undefined
            || note.string < playability.deadNoteStrings[0]
            || note.string > playability.deadNoteStrings[1]) {
            errors.push(t('improv.validate.note.deadNoteStringRange', { index: noteNumber }));
        }
        if (note.duration < playability.minDeadNoteDuration) {
            errors.push(t('improv.validate.note.deadNoteTooShort', { index: noteNumber }));
        }
        if (note.technique !== undefined) {
            errors.push(t('improv.validate.note.deadNoteWithTechnique', { index: noteNumber }));
        }
        if (note.harmonic !== undefined || note.letRing || note.staccato
            || note.palmMute) {
            errors.push(t('improv.validate.note.deadNoteWithArticulation', { index: noteNumber }));
        }
    }

    if (note.staccato) {
        if (note.duration < playability.minStaccatoDuration) {
            errors.push(t('improv.validate.note.staccatoTooShort', { index: noteNumber }));
        }
        if (note.technique !== undefined) {
            errors.push(t('improv.validate.note.staccatoWithTechnique', { index: noteNumber }));
        }
    }

    if (note.letRing) {
        // 断音优先缩短发声，letRing 的最短时值只在没有 staccato 时生效。
        if (!note.staccato && note.duration < playability.minLetRingDuration) {
            errors.push(t('improv.validate.note.letRingTooShort', { index: noteNumber }));
        }
        if (note.technique !== undefined) {
            errors.push(t('improv.validate.note.letRingWithTechnique', { index: noteNumber }));
        }
        if (note.deadNote || note.palmMute) {
            errors.push(t('improv.validate.note.letRingWithMute', { index: noteNumber }));
        }
    }

    if (note.harmonic !== undefined) {
        if (!VALID_HARMONICS.has(note.harmonic)) {
            errors.push(t('improv.validate.note.harmonicTypeInvalid', {
                index: noteNumber,
                harmonic: note.harmonic,
            }));
        }
        if (note.duration < playability.minHarmonicDuration) {
            errors.push(t('improv.validate.note.harmonicTooShort', { index: noteNumber }));
        }
        if (note.technique !== undefined) {
            errors.push(t('improv.validate.note.harmonicWithTechnique', { index: noteNumber }));
        }
        if (note.deadNote || note.palmMute) {
            errors.push(t('improv.validate.note.harmonicWithMute', { index: noteNumber }));
        }
        if (note.harmonic === 'natural') {
            if (note.harmonicFret !== undefined) {
                errors.push(t('improv.validate.note.naturalHarmonicWithFret', { index: noteNumber }));
            }
            if (note.fret === undefined
                || !playability.naturalHarmonicFrets.includes(note.fret)) {
                errors.push(t('improv.validate.note.naturalHarmonicFretInvalid', {
                    index: noteNumber,
                    fret: String(note.fret),
                }));
            }
        } else {
            if (note.fret === undefined || note.fret <= 0) {
                errors.push(t('improv.validate.note.harmonicNeedsFingeredFret', { index: noteNumber }));
            }
            if (note.harmonicFret !== undefined
                && (!Number.isInteger(note.harmonicFret)
                    || note.harmonicFret < HARMONIC_FRET_MIN
                    || note.harmonicFret > HARMONIC_FRET_MAX
                    || !playability.harmonicFrets.includes(note.harmonicFret))) {
                errors.push(t('improv.validate.note.harmonicTouchFretInvalid', {
                    index: noteNumber,
                    fret: note.harmonicFret,
                }));
            }
            if (note.harmonic === 'pinch'
                && (note.string === undefined
                    || note.string < playability.pinchHarmonicStrings[0]
                    || note.string > playability.pinchHarmonicStrings[1])) {
                errors.push(t('improv.validate.note.pinchHarmonicStringRange', { index: noteNumber }));
            }
        }
    } else if (note.harmonicFret !== undefined) {
        errors.push(t('improv.validate.note.harmonicFretWithoutHarmonic', { index: noteNumber }));
    }

    if (note.palmMute) {
        if (note.string === undefined
            || note.string < playability.palmMuteStrings[0]
            || note.string > playability.palmMuteStrings[1]) {
            errors.push(t('improv.validate.note.palmMuteStringRange', { index: noteNumber }));
        }
        if (note.duration < playability.minPalmMuteDuration) {
            errors.push(t('improv.validate.note.palmMuteTooShort', { index: noteNumber }));
        }
        if (note.technique !== undefined) {
            errors.push(t('improv.validate.note.palmMuteWithTechnique', { index: noteNumber }));
        }
        if (note.deadNote || note.harmonic !== undefined || note.letRing) {
            errors.push(t('improv.validate.note.palmMuteWithArticulation', { index: noteNumber }));
        }
    }

    if (note.dynamics !== undefined
        && note.dynamics !== 'soft' && note.dynamics !== 'accent') {
        errors.push(t('improv.validate.note.dynamicsInvalid', {
            index: noteNumber,
            dynamics: note.dynamics,
        }));
    }

    if (note.chordGroup !== undefined
        && (!Number.isInteger(note.chordGroup) || note.chordGroup <= 0)) {
        errors.push(t('improv.validate.note.chordGroupIdInvalid', {
            index: noteNumber,
            group: note.chordGroup,
        }));
    }
    if (note.arpeggio !== undefined
        && note.arpeggio !== 'up' && note.arpeggio !== 'down') {
        errors.push(t('improv.validate.note.arpeggioInvalid', {
            index: noteNumber,
            arpeggio: note.arpeggio,
        }));
    }
    if (note.strum !== undefined
        && note.strum !== 'up' && note.strum !== 'down') {
        errors.push(t('improv.validate.note.strumInvalid', {
            index: noteNumber,
            strum: note.strum,
        }));
    }

    // 连接技法的目标品直接写在 fret 上；targetFret 只属于表单/编辑器，
    // 生成结果带它说明上游仍按旧契约写入。
    if (note.targetFret !== undefined) {
        errors.push(t('improv.validate.note.unexpectedTargetFret', { index: noteNumber }));
    }
    // tieToNext 暂不生成：Karplus 会跳过标记拍、SoundFont 按到达音处理，
    // 两引擎语义未统一前放行会得到静音拍。
    if (note.tieToNext) {
        errors.push(t('improv.validate.note.unsupportedTie', { index: noteNumber }));
    }
    // chordName 是标签不是奏法，本地生成不产出。
    if (note.chordName !== undefined) {
        errors.push(t('improv.validate.note.unsupportedChordName', { index: noteNumber }));
    }

    return errors;
}

/**
 * 校验一个拍位组的公共字段。
 *
 * 单音组不应带和弦组标记/琶音/扫弦；多音组要求同 id、同时值、同力度、
 * 弦与音级不重复，声部数与跨度在可演奏范围内，且组内不叠加单音奏法。
 */
function validateGroupFields(
    group: Note[],
    groupStart: number,
    options: ResolvedImprovOptions,
    playability: PlayabilityRules,
): string[] {
    const errors: string[] = [];
    const groupNumber = groupStart + 1;
    const first = group[0];

    if (group.length === 1) {
        if (first.isRest) return errors;
        if (first.chordGroup !== undefined) {
            errors.push(t('improv.validate.group.singleWithChordGroup', { index: groupNumber }));
        }
        if (first.arpeggio !== undefined) {
            errors.push(t('improv.validate.group.singleWithArpeggio', { index: groupNumber }));
        }
        if (first.strum !== undefined) {
            errors.push(t('improv.validate.group.singleWithStrum', { index: groupNumber }));
        }
        return errors;
    }

    if (first.chordGroup === undefined) {
        errors.push(t('improv.validate.group.multiWithoutChordGroup', { index: groupNumber }));
    }
    if (group.length > playability.maxChordVoices) {
        errors.push(t('improv.validate.group.tooManyVoices', {
            index: groupNumber,
            actual: group.length,
            max: playability.maxChordVoices,
        }));
    }

    group.forEach(note => {
        if (note.isRest) {
            errors.push(t('improv.validate.group.containsRest', { index: groupNumber }));
        }
        if (note.duration !== first.duration) {
            errors.push(t('improv.validate.group.durationMismatch', { index: groupNumber }));
        }
        if (note.dynamics !== first.dynamics) {
            errors.push(t('improv.validate.group.dynamicsMismatch', { index: groupNumber }));
        }
        if (note.technique !== undefined
            || note.palmMute || note.deadNote || note.letRing
            || note.staccato || note.harmonic !== undefined
            || note.harmonicFret !== undefined) {
            errors.push(t('improv.validate.group.withSingleArticulation', { index: groupNumber }));
        }
    });

    const strings = group
        .map(note => note.string)
        .filter((value): value is number => value !== undefined);
    if (new Set(strings).size !== strings.length) {
        errors.push(t('improv.validate.group.duplicateString', { index: groupNumber }));
    }
    if (strings.length === group.length) {
        const span = Math.max(...strings) - Math.min(...strings);
        if (span > playability.maxChordStringSpan) {
            errors.push(t('improv.validate.group.stringSpanTooLarge', {
                index: groupNumber,
                span,
                max: playability.maxChordStringSpan,
            }));
        }
    }

    const frets = group
        .map(note => note.fret)
        .filter((value): value is number => value !== undefined);
    if (frets.length === group.length) {
        const span = Math.max(...frets) - Math.min(...frets);
        if (span > playability.maxChordSpanFrets) {
            errors.push(t('improv.validate.group.fretSpanTooLarge', {
                index: groupNumber,
                span,
                max: playability.maxChordSpanFrets,
            }));
        }
    }

    const pitchClasses: number[] = [];
    group.forEach(note => {
        if (note.string === undefined || note.fret === undefined) return;
        try {
            pitchClasses.push(
                pitchClassOf(fretToMidi(options.tuning, note.string, note.fret)),
            );
        } catch {
            // 弦号/品位错误已在 validateNoteFields 里报告
        }
    });
    if (new Set(pitchClasses).size !== pitchClasses.length) {
        errors.push(t('improv.validate.group.duplicatePitchClass', { index: groupNumber }));
    }

    group.forEach((note, index) => {
        if (index === 0) return;
        if (note.arpeggio !== undefined) {
            errors.push(t('improv.validate.group.arpeggioNotOnHead', { index: groupNumber }));
        }
        if (note.strum !== undefined) {
            errors.push(t('improv.validate.group.strumNotOnHead', { index: groupNumber }));
        }
    });
    if (first.arpeggio !== undefined && first.strum !== undefined) {
        errors.push(t('improv.validate.group.arpeggioAndStrum', { index: groupNumber }));
    }

    return errors;
}

/**
 * 校验最终 Note[]：
 * - 每个音合法、调内或属于当前小节和声音池、可演奏；
 * - 强拍落在当前和弦音，长音避开 avoid note；
 * - 技法/奏法在本地生成白名单内；
 * - 拍平顺序不会让 loadNotes 提前/延后切小节；
 * - 相邻音的跳进不超过可演奏上限。
 *
 * @param harmony 可选的每小节和声计划；不传时退回纯调内校验。
 */
export function validateNotes(
    notes: Note[],
    options: ResolvedImprovOptions,
    playability: PlayabilityRules,
    /**
     * 段落中间的跳进上限（通常传风格上限）。句间首音与最后一个音允许
     * 放宽到 playability.maxPhraseLeapSemitones，因为换把与收束主音不一定
     * 落在风格音区内。
     */
    middleMaxLeapSemitones: number = playability.maxLeapSemitones,
    harmony?: readonly HarmonyMeasure[],
    phrases?: readonly PhrasePlan[],
): string[] {
    if (notes.length === 0) return [t('improv.validate.notes.empty')];

    const errors: string[] = [];
    const capacity = capacityFromTimeSignature(options.timeSignature);
    if (!Number.isFinite(capacity) || capacity <= 0) {
        return [t('improv.common.invalidTimeSignature', { signature: options.timeSignature })];
    }

    const groups = groupFlatNotes(notes);
    const groupStarts: number[] = [];
    let cursor = 0;
    for (const group of groups) {
        groupStarts.push(cursor);
        cursor += group.length;
    }

    const lastSoundingGroupIndex = groups.reduce(
        (last, group, index) => group[0].isRest ? last : index,
        -1,
    );
    const baseMiddleLimit = Number.isFinite(middleMaxLeapSemitones)
        ? Math.max(1, Math.min(middleMaxLeapSemitones, playability.maxLeapSemitones))
        : playability.maxLeapSemitones;
    // 句间换把与旋律骨骼一致：只在这一句的第一个发音上放宽。
    const phraseStartMeasures = new Set(
        phrases?.map(phrase => phrase.startMeasure) ?? [],
    );
    const phraseStartSeen = new Set<number>();
    const segmentStartSeen = new Set<string>();
    // 生成器在句首取 max(风格上限, maxPhraseLeap)，这里用同一表达式，
    // 避免把 maxPhraseLeap 配得比 maxLeap 小时生成结果必被拒绝。
    const phraseLeapLimit = Math.max(
        playability.maxLeapSemitones,
        playability.maxPhraseLeapSemitones,
    );
    // 锁定把位时，和弦音可能只在风格音区之外出现；生成器用同一上限
    // 做锚点吸附，这里必须同步放行，否则合法结果会被判超限。
    const middleLimit = options.fretRange
        ? Math.max(baseMiddleLimit, phraseLeapLimit)
        : baseMiddleLimit;
    // 收尾主音可能只在锁定窗口的另一端。仅在窗口确实窄于整条指板时
    // 豁免；上限取该窗口的 MIDI 跨度（有限值，不会放过任意跳进）。
    let lockedFinalLeapLimit: number | null = null;
    if (options.fretRange) {
        const narrower = options.fretRange.max - options.fretRange.min
            < playability.fretMax - playability.fretMin;
        if (narrower) {
            const [lockedLow, lockedHigh] = midiRangeForFretRange(
                options.tuning,
                options.fretRange.min,
                options.fretRange.max,
            );
            lockedFinalLeapLimit = Math.max(
                phraseLeapLimit,
                lockedHigh - lockedLow,
            );
        }
    }

    // 同一 chordGroup id 只能出现在一个组里，否则 loadNotes 会把非连续的
    // 和弦拆成两拍。只在真正的和弦组（多音）之间检查。
    const chordGroupIds = new Set<number>();

    let total = 0;
    let measureBoundary = capacity;
    let previousMidi: number | null = null;

    groups.forEach((group, groupIndex) => {
        const groupStart = groupStarts[groupIndex];
        const first = group[0];
        const startsAt = total;
        const measureIndex = Number.isFinite(startsAt) && startsAt >= 0
            ? Math.floor(startsAt / capacity + 1e-9)
            : 0;
        const offsetInMeasure = startsAt - measureIndex * capacity;
        const measureHarmony = harmony?.[measureIndex];
        const segmentIndex = segmentIndexAt(measureHarmony, offsetInMeasure);
        const segment = segmentAt(measureHarmony, offsetInMeasure);
        const allowedPitchClasses = segment
            ? new Set(segment.pool.availablePitchClasses)
            : undefined;
        const role = segment && Number.isFinite(first.duration)
            && first.duration > 0
            ? classifySlotRole(
                offsetInMeasure,
                first.duration,
                options.timeSignature,
            )
            : undefined;

        group.forEach((note, memberIndex) => {
            errors.push(...validateNoteFields(
                note,
                options,
                playability,
                groupStart + memberIndex,
                allowedPitchClasses,
            ));
        });
        errors.push(...validateGroupFields(
            group, groupStart, options, playability,
        ));

        if (group.length > 1 && first.chordGroup !== undefined) {
            if (chordGroupIds.has(first.chordGroup)) {
                errors.push(t('improv.validate.notes.duplicateChordGroupId', {
                    index: groupStart + 1,
                    group: first.chordGroup,
                }));
            } else {
                chordGroupIds.add(first.chordGroup);
            }
        }

        // 组内时值必须相同；只累加一次，否则和弦组会让总时值翻倍。
        if (Number.isFinite(first.duration) && first.duration > 0) {
            total += first.duration;
            if (total > measureBoundary + TOLERANCE) {
                errors.push(t('improv.validate.notes.crossesMeasureBoundary', {
                    index: groupStart + 1,
                }));
                while (total > measureBoundary + TOLERANCE) measureBoundary += capacity;
            } else if (Math.abs(total - measureBoundary) <= TOLERANCE) {
                measureBoundary += capacity;
            }
        }

        if (first.isRest) return;

        // 多声部拍位的跳进看最高声部；旋律始终是最高音。
        let representativeMidi: number | null = null;
        for (const note of group) {
            if (note.string === undefined || note.fret === undefined) continue;
            try {
                const midi = fretToMidi(options.tuning, note.string, note.fret);
                if (representativeMidi === null || midi > representativeMidi) {
                    representativeMidi = midi;
                }
            } catch {
                // 音高换算错误已在 validateNoteFields 里报告
            }
        }
        if (representativeMidi === null) return;

        // 换和弦后的第一个发音必须落在新和弦音；段 0 沿用旧的
        // “小节首音”规则，不额外收紧。
        const segmentKey = `${measureIndex}:${segmentIndex}`;
        const isFirstSoundingOfSegment = segmentIndex > 0
            && !segmentStartSeen.has(segmentKey);
        segmentStartSeen.add(segmentKey);

        // 锁定把位时，窗口里可能根本按不到当前和弦音。此时锚点
        // 规则无解，生成器只能保留候选音；校验同步跳过这两条，
        // 但仍保留 avoid note 与越界检查。
        const reachable = (pitchClasses: readonly number[]): boolean =>
            !options.fretRange || previousMidi === null
            || nearestPlayableMidiWithPitchClasses(
                options.tuning,
                previousMidi,
                pitchClasses,
                previousMidi - phraseLeapLimit,
                previousMidi + phraseLeapLimit,
                options.fretRange.min,
                options.fretRange.max,
            ) !== null;
        const chordToneReachable = reachable(
            segment?.pool.chordPitchClasses ?? [],
        );
        const nonAvoid = segment
            ? segment.pool.availablePitchClasses.filter(
                value => !segment.pool.avoidPitchClasses.includes(value),
            )
            : [];
        const weakTargetReachable = reachable(
            nonAvoid.length > 0
                ? nonAvoid
                : segment?.pool.chordPitchClasses ?? [],
        );

        // 每个成员都要检查：强拍/换和弦首音落在和弦音、长音避开 avoid note。
        if (segment && role && groupIndex !== lastSoundingGroupIndex) {
            group.forEach((note, memberIndex) => {
                if (note.string === undefined || note.fret === undefined) return;
                let midi: number;
                try {
                    midi = fretToMidi(options.tuning, note.string, note.fret);
                } catch {
                    return;
                }
                const memberPitchClass = pitchClassOf(midi);
                const noteIndex = groupStart + memberIndex;
                if (isFirstSoundingOfSegment && chordToneReachable
                    && !segment.pool.chordPitchClasses.includes(memberPitchClass)) {
                    errors.push(t('improv.validate.notes.segmentFirstNotChordTone', {
                        index: noteIndex + 1,
                    }));
                } else if (role === 'strong' && chordToneReachable
                    && !segment.pool.chordPitchClasses.includes(memberPitchClass)) {
                    errors.push(t('improv.validate.notes.strongBeatNotChordTone', {
                        index: noteIndex + 1,
                    }));
                } else if (role !== 'passing' && weakTargetReachable
                    && segment.pool.avoidPitchClasses.includes(memberPitchClass)
                    && !segment.pool.chordPitchClasses.includes(memberPitchClass)) {
                    errors.push(t('improv.validate.notes.longNoteAvoid', {
                        index: noteIndex + 1,
                    }));
                }
            });
        }

        // 同一小节内只有第一个发音享受换把放宽，后续音仍守中间上限；
        // 小节内换和弦的首音也允许一次换把幅度。
        const isPhraseStart = phraseStartMeasures.has(measureIndex)
            && !phraseStartSeen.has(measureIndex);
        if (isPhraseStart) phraseStartSeen.add(measureIndex);
        // 锁定把位时，收尾主音可能只在离上一个音很远的品位上出现
        // （例如 10-12 品里 C 只有 60）。此时把位是硬约束，收尾
        // 优先落主音；豁免上限见 lockedFinalLeapLimit。
        const isFinalGroup = groupIndex === lastSoundingGroupIndex;
        const leapLimit = isFinalGroup && lockedFinalLeapLimit !== null
            ? lockedFinalLeapLimit
            : isFinalGroup || isPhraseStart || isFirstSoundingOfSegment
                ? phraseLeapLimit
                : middleLimit;
        // 连接技法是连续发声，不算跳进；其跨度由 connect.ts 单独守。
        const isConnectingGroup = group.length === 1
            && isConnectingTechnique(group[0].technique);
        if (!isConnectingGroup && previousMidi !== null
            && Math.abs(representativeMidi - previousMidi) > leapLimit) {
            errors.push(t('improv.validate.notes.leapTooLarge', {
                index: groupStart + 1,
                semitones: Math.abs(representativeMidi - previousMidi),
            }));
        }
        previousMidi = representativeMidi;
    });

    // 连接类技法必须紧邻同弦前音：播放层复用前音的缓冲区，若中间有休止、
    // 换弦或前音本身不可作为源，目标音会被退化成重拨，谱面上的技法弧线
    // 与实际发声不一致。可演奏判定与生成侧共用 connect.ts。
    groups.forEach((group, groupIndex) => {
        if (group.length !== 1) return;
        const note = group[0];
        if (!isConnectingTechnique(note.technique)) return;
        const noteIndex = groupStarts[groupIndex] + 1;
        const previousGroup = groups[groupIndex - 1];
        // 和弦组作为前音时，播放层没有单一缓冲可复用。
        if (previousGroup && previousGroup.length > 1) {
            errors.push(t('improv.validate.notes.connectingPreviousNotSingle', {
                index: noteIndex,
            }));
            return;
        }
        const issue = connectIssue(
            note.technique, previousGroup?.[0], note, playability,
        );
        if (issue !== undefined) {
            errors.push(t('improv.validate.notes.connection', {
                index: noteIndex,
                issue,
            }));
        }
    });

    const expected = capacity * options.numMeasures;
    if (Math.abs(total - expected) > TOLERANCE) {
        errors.push(t('improv.validate.notes.totalMismatch', {
            total,
            expected,
        }));
    }

    return errors;
}
