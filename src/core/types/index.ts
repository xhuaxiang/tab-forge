/**
 * TabForge 类型定义的公共出口。
 *
 * 具体声明按领域拆在相邻文件里；这里只做显式 re-export，保证外部
 * `core/types/index.ts` 的 import 路径不变。新增类型时先放到对应领域
 * 文件，再在这里补一行。
 */

export type { PlaybackState } from './playback.ts';

export {
    NOTE_DURATIONS,
    APP_HARMONICS,
    NOTE_ARTICULATIONS,
} from './note.ts';
export type {
    NoteDuration,
    AppHarmonic,
    NoteArticulation,
    NoteBase,
    GuitarNote,
    Note,
    AppTechnique,
} from './note.ts';

export { STANDARD_TUNING, TUNING_PRESETS } from './tuning.ts';
export type { Tuning } from './tuning.ts';

export type { MeasureBase, Measure } from './measure.ts';

export type { ScoreBase, TabScore, ChordDiagram } from './score.ts';

export {
    NOTE_FREQUENCIES,
    NATURAL_SEMITONE,
    SEMITONE_BY_NOTE_NAME,
    NOTE_NAMES_SHARP,
    STRING_NAMES,
    getNoteFromFret,
    getNoteFrequency,
} from './pitch.ts';
