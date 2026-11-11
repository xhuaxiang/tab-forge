/**
 * connect — 连接类技法可演奏判定的边界测试。
 */

import { describe, it, expect } from 'vitest';
import type { Note } from '../../../../core/types/index.ts';
import { LOCAL_IMPROV_CONFIG } from '../../../../core/config.ts';
import { connectIssue } from '../../../../core/utils/improv/connect.ts';

const PLAYABILITY = LOCAL_IMPROV_CONFIG.playability;

function note(partial: Partial<Note> & { duration: Note['duration'] }): Note {
    return { string: 1, fret: 5, ...partial };
}

describe('connectIssue', () => {
    it('合法的击/勾/滑返回 undefined', () => {
        const source = note({ fret: 5, duration: 0.25 });
        expect(connectIssue('hammerOn', source, note({ fret: 7, duration: 0.25 }), PLAYABILITY))
            .toBeUndefined();
        expect(connectIssue('pullOff', source, note({ fret: 3, duration: 0.25 }), PLAYABILITY))
            .toBeUndefined();
        expect(connectIssue('slide', source, note({ fret: 9, duration: 0.25 }), PLAYABILITY))
            .toBeUndefined();
        // 1-2 品短滑也可演奏
        expect(connectIssue('slide', source, note({ fret: 7, duration: 0.25 }), PLAYABILITY))
            .toBeUndefined();
    });

    it('前音缺失、换弦、缺品位、时值过短', () => {
        const target = note({ fret: 7, duration: 0.25 });
        expect(connectIssue('hammerOn', undefined, target, PLAYABILITY))
            .toMatch(/缺少紧邻的同弦前音/);
        expect(connectIssue('hammerOn', note({ isRest: true, duration: 0.25 }), target, PLAYABILITY))
            .toMatch(/缺少紧邻的同弦前音/);
        expect(connectIssue('hammerOn', note({ string: 2, fret: 5, duration: 0.25 }), target, PLAYABILITY))
            .toMatch(/必须与前音同弦/);

        const noFret = { string: 1, duration: 0.25 } as unknown as Note;
        expect(connectIssue('hammerOn', noFret, target, PLAYABILITY))
            .toMatch(/缺少品位/);
        expect(connectIssue('hammerOn', note({ fret: 5, duration: 0.25 }), noFret, PLAYABILITY))
            .toMatch(/缺少品位/);

        expect(connectIssue(
            'hammerOn',
            note({ fret: 5, duration: 0.25 }),
            note({ fret: 7, duration: 0.03125 }),
            PLAYABILITY,
        )).toMatch(/时值过短/);
    });

    it('不可作为源的前音与带推/揉弦的前音', () => {
        const target = note({ fret: 7, duration: 0.25 });
        expect(connectIssue(
            'hammerOn',
            note({ fret: 5, duration: 0.25, palmMute: true }),
            target, PLAYABILITY,
        )).toMatch(/前音是闷音\/制音\/断音/);
        expect(connectIssue(
            'pullOff',
            note({ fret: 5, duration: 0.25, deadNote: true }),
            note({ fret: 3, duration: 0.25 }),
            PLAYABILITY,
        )).toMatch(/前音是闷音\/制音\/断音/);
        expect(connectIssue(
            'hammerOn',
            note({ fret: 5, duration: 0.25, technique: 'vibrato' }),
            target, PLAYABILITY,
        )).toMatch(/前音带推\/揉弦/);
        expect(connectIssue(
            'hammerOn',
            note({ fret: 5, duration: 0.25, technique: 'bend', bendAmount: 1 }),
            target, PLAYABILITY,
        )).toMatch(/前音带推\/揉弦/);
    });

    it('滑弦两端不能是空弦，且不能零位移或超跨度', () => {
        expect(connectIssue(
            'slide',
            note({ fret: 0, duration: 0.25 }),
            note({ fret: 5, duration: 0.25 }),
            PLAYABILITY,
        )).toMatch(/滑弦两端都不能是空弦/);
        expect(connectIssue(
            'slide',
            note({ fret: 5, duration: 0.25 }),
            note({ fret: 0, duration: 0.25 }),
            PLAYABILITY,
        )).toMatch(/滑弦两端都不能是空弦/);
        expect(connectIssue(
            'slide',
            note({ fret: 5, duration: 0.25 }),
            note({ fret: 5, duration: 0.25 }),
            PLAYABILITY,
        )).toMatch(/滑弦需要品位变化/);
        expect(connectIssue(
            'slide',
            note({ fret: 2, duration: 0.25 }),
            note({ fret: 2 + PLAYABILITY.maxSlideFrets + 1, duration: 0.25 }),
            PLAYABILITY,
        )).toMatch(/滑弦品位跨度过大/);
    });

    it('击/勾弦跨度为 1-2 品且方向正确', () => {
        const source = note({ fret: 5, duration: 0.25 });
        expect(connectIssue('hammerOn', source, note({ fret: 5, duration: 0.25 }), PLAYABILITY))
            .toMatch(/击\/勾弦需要品位变化/);
        expect(connectIssue(
            'hammerOn', source,
            note({ fret: 5 + PLAYABILITY.maxHammerPullFrets + 1, duration: 0.25 }),
            PLAYABILITY,
        )).toMatch(/击\/勾弦品位跨度过大/);
        expect(connectIssue('hammerOn', source, note({ fret: 3, duration: 0.25 }), PLAYABILITY))
            .toMatch(/击弦目标品位应高于前音/);
        expect(connectIssue('pullOff', source, note({ fret: 7, duration: 0.25 }), PLAYABILITY))
            .toMatch(/勾弦目标品位应低于前音/);
    });
});
