/**
 * 音程换算：半音数 → 频率倍率。
 *
 * 频率换算与 playbackRate 变速是同一个指数关系（相差 2^(n/12) 倍）。
 * 泛音叠加、推弦目标速率都走这里，避免每个调用处各写一遍 Math.pow(2, n / 12)
 * 后各自漂移。
 */
export function semitonesToRate(semitones: number): number {
    return Math.pow(2, semitones / 12);
}
