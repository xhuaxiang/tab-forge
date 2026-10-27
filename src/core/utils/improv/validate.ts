/**
 * validate — 本地即兴生成结果的守门（纯函数）。
 *
 * 生成器不返回半成品：任何一条错误都应让 generateLocalImprovisation 抛错，
 * 避免把不可演奏/不闭合的音符写进 store。
 */

import type { Note } from '../../types/index.ts';
import { NOTE_DURATIONS } from '../../types/index.ts';
import type {
    PlayabilityRules,
    ResolvedImprovOptions,
    RhythmMeasure,
} from '../../types/improv.ts';
import { BEND_AMOUNT_LABELS } from '../../config.ts';
import { capacityFromTimeSignature } from '../measureUtils.ts';
import { fretToMidi, isInScale } from './pitch.ts';

const VALID_DURATIONS = new Set<number>(NOTE_DURATIONS);
const VALID_BEND_AMOUNTS = new Set<number>(
    Object.keys(BEND_AMOUNT_LABELS).map(Number),
);
const TOLERANCE = 1e-9;

function isDurationValid(duration: number): boolean {
    return VALID_DURATIONS.has(duration);
}

function hasField(note: Note, key: keyof Note): boolean {
    return note[key] !== undefined;
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
        return [`无效拍号: ${options.timeSignature}`];
    }
    if (plan.length !== options.numMeasures) {
        errors.push(`小节数不匹配: 计划 ${plan.length}，期望 ${options.numMeasures}`);
    }

    plan.forEach((measure, measureIndex) => {
        if (measure.index !== measureIndex) {
            errors.push(`第 ${measureIndex + 1} 小节 index 应为 ${measureIndex}`);
        }
        if (Math.abs(measure.capacity - capacity) > TOLERANCE) {
            errors.push(`第 ${measureIndex + 1} 小节容量 ${measure.capacity} 与拍号 ${capacity} 不符`);
        }
        if (measure.slots.length === 0) {
            errors.push(`第 ${measureIndex + 1} 小节没有拍位`);
            return;
        }

        let total = 0;
        for (const slot of measure.slots) {
            if (!isDurationValid(slot.duration) || slot.duration <= 0) {
                errors.push(`第 ${measureIndex + 1} 小节含非法时值 ${slot.duration}`);
            }
            total += slot.duration;
        }
        if (Math.abs(total - capacity) > TOLERANCE) {
            errors.push(`第 ${measureIndex + 1} 小节时值之和 ${total} 未闭合到 ${capacity}`);
        }
        if (measure.slots.every(slot => slot.isRest)) {
            errors.push(`第 ${measureIndex + 1} 小节全是休止符`);
        }
        const sounding = measure.slots.filter(slot => !slot.isRest).length;
        if (sounding < minNotesPerMeasure) {
            errors.push(
                `第 ${measureIndex + 1} 小节只有 ${sounding} 个发音，`
                + `少于密度下限 ${minNotesPerMeasure}`,
            );
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
): string[] {
    const errors: string[] = [];
    const prefix = `第 ${index + 1} 个音符`;

    if (!isDurationValid(note.duration) || note.duration <= 0) {
        errors.push(`${prefix}时值非法: ${note.duration}`);
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
            errors.push(`${prefix}是休止符，却带了演奏字段`);
        }
        return errors;
    }

    if (note.string === undefined || !Number.isInteger(note.string)
        || note.string < 1 || note.string > 6) {
        errors.push(`${prefix}弦号非法: ${note.string}`);
    }
    if (note.fret === undefined || !Number.isInteger(note.fret)
        || note.fret < playability.fretMin || note.fret > playability.fretMax) {
        errors.push(`${prefix}品位非法: ${note.fret}`);
    }

    if (note.string !== undefined && note.fret !== undefined
        && note.string >= 1 && note.string <= 6
        && Number.isInteger(note.fret)) {
        try {
            const midi = fretToMidi(options.tuning, note.string, note.fret);
            if (!isInScale(midi, options.tonicPitchClass, options.scaleType)) {
                errors.push(`${prefix}不在调内: MIDI ${midi}`);
            }
        } catch (error) {
            errors.push(`${prefix}无法换算音高: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    if (note.technique !== undefined
        && note.technique !== 'bend' && note.technique !== 'vibrato') {
        errors.push(`${prefix}含 v1 不支持的技法: ${note.technique}`);
    }
    if (note.technique === 'bend') {
        if (note.bendAmount === undefined || !VALID_BEND_AMOUNTS.has(note.bendAmount)) {
            errors.push(`${prefix}推弦幅度非法: ${note.bendAmount}`);
        }
        if (note.duration < playability.minBendDuration) {
            errors.push(`${prefix}推弦时值过短`);
        }
        if (note.fret !== undefined && note.fret <= 0) {
            errors.push(`${prefix}空弦不能推弦`);
        }
        if (note.bendRelease && note.duration < playability.minBendReleaseDuration) {
            errors.push(`${prefix}推弦释放时值过短`);
        }
    } else if (note.bendAmount !== undefined || note.bendRelease !== undefined) {
        errors.push(`${prefix}没有 bend 技法却带推弦字段`);
    }
    if (note.technique === 'vibrato') {
        if (note.duration < playability.minVibratoDuration) {
            errors.push(`${prefix}揉弦时值过短`);
        }
        if (note.fret !== undefined && note.fret <= 0) {
            errors.push(`${prefix}空弦不能揉弦`);
        }
    }

    if (note.palmMute) {
        if (note.string === undefined
            || note.string < playability.palmMuteStrings[0]
            || note.string > playability.palmMuteStrings[1]) {
            errors.push(`${prefix}手掌闷音只能用在低音弦`);
        }
        if (note.duration < playability.minPalmMuteDuration) {
            errors.push(`${prefix}手掌闷音时值过短`);
        }
        if (note.technique !== undefined) {
            errors.push(`${prefix}手掌闷音不能与技法叠加`);
        }
    }

    if (note.dynamics !== undefined
        && note.dynamics !== 'soft' && note.dynamics !== 'accent') {
        errors.push(`${prefix}力度非法: ${note.dynamics}`);
    }

    // v1 明确不生成这些字段；出现即说明上游契约漂移
    if (note.targetFret !== undefined) errors.push(`${prefix}不应带 targetFret`);
    if (note.deadNote) errors.push(`${prefix}含 v1 不支持的 deadNote`);
    if (note.letRing) errors.push(`${prefix}含 v1 不支持的 letRing`);
    if (note.staccato) errors.push(`${prefix}含 v1 不支持的 staccato`);
    if (note.harmonic !== undefined) errors.push(`${prefix}含 v1 不支持的泛音`);
    if (note.harmonicFret !== undefined) errors.push(`${prefix}含 v1 不支持的泛音品位`);
    if (note.tieToNext) errors.push(`${prefix}含 v1 不支持的延音`);
    if (hasField(note, 'chordGroup')) errors.push(`${prefix}含 v1 不支持的和弦组`);
    if (note.chordName !== undefined) errors.push(`${prefix}含 v1 不支持的和弦名`);
    if (note.arpeggio !== undefined) errors.push(`${prefix}含 v1 不支持的琶音`);
    if (note.strum !== undefined) errors.push(`${prefix}含 v1 不支持的扫弦`);

    return errors;
}

/**
 * 校验最终 Note[]：
 * - 每个音合法、调内、可演奏；
 * - 技法/奏法在 v1 白名单内；
 * - 拍平顺序不会让 loadNotes 提前/延后切小节；
 * - 相邻音的跳进不超过可演奏上限。
 */
export function validateNotes(
    notes: Note[],
    options: ResolvedImprovOptions,
    playability: PlayabilityRules,
    /**
     * 段落中间的跳进上限（通常传风格上限）。最后一个音允许放宽到
     * playability.maxLeapSemitones，因为主音不一定落在风格音区内。
     */
    middleMaxLeapSemitones: number = playability.maxLeapSemitones,
): string[] {
    if (notes.length === 0) return ['没有音符'];

    const errors: string[] = [];
    const capacity = capacityFromTimeSignature(options.timeSignature);
    if (!Number.isFinite(capacity) || capacity <= 0) {
        return [`无效拍号: ${options.timeSignature}`];
    }

    const lastSoundingIndex = notes.reduce(
        (last, note, index) => note.isRest ? last : index,
        -1,
    );
    const middleLimit = Number.isFinite(middleMaxLeapSemitones)
        ? Math.max(1, Math.min(middleMaxLeapSemitones, playability.maxLeapSemitones))
        : playability.maxLeapSemitones;

    let total = 0;
    let measureBoundary = capacity;
    let previousMidi: number | null = null;

    notes.forEach((note, index) => {
        errors.push(...validateNoteFields(note, options, playability, index));

        // 非有限/非正时值只报告非法，不能参与累加——否则 Infinity 会让
        // 下面的边界推进永远为真。
        if (Number.isFinite(note.duration) && note.duration > 0) {
            total += note.duration;
            if (total > measureBoundary + TOLERANCE) {
                errors.push(`第 ${index + 1} 个音符跨过了小节容量边界`);
                while (total > measureBoundary + TOLERANCE) measureBoundary += capacity;
            } else if (Math.abs(total - measureBoundary) <= TOLERANCE) {
                measureBoundary += capacity;
            }
        }

        if (!note.isRest && note.string !== undefined && note.fret !== undefined) {
            try {
                const midi = fretToMidi(options.tuning, note.string, note.fret);
                const leapLimit = index === lastSoundingIndex
                    ? playability.maxLeapSemitones
                    : middleLimit;
                if (previousMidi !== null
                    && Math.abs(midi - previousMidi) > leapLimit) {
                    errors.push(`第 ${index + 1} 个音符跳进 ${Math.abs(midi - previousMidi)} 超过上限`);
                }
                previousMidi = midi;
            } catch {
                // 音高换算错误已在 validateNoteFields 里报告
            }
        }
    });

    const expected = capacity * options.numMeasures;
    if (Math.abs(total - expected) > TOLERANCE) {
        errors.push(`总时值 ${total} 与期望 ${expected} 不符`);
    }

    return errors;
}
