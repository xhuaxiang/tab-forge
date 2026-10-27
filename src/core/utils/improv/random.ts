/**
 * random — 可注入种子的伪随机数。
 *
 * core 内禁止 `Math.random()`：生成结果必须能用同一 seed 复现，
 * 单测才能固定输入输出。mulberry32 足够小、分布够用，不引入依赖。
 */

/** 创建确定性 RNG；同一 seed 的前 N 个值完全相同 */
export function createRng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** 等概率取一项；空数组抛错（调用方必须保证候选非空） */
export function pick<T>(rng: () => number, items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick: 候选为空');
    return items[Math.floor(rng() * items.length)];
}

/** 按权重取一项；总权重为 0 时退化为等概率 */
export function pickWeighted<T>(
    rng: () => number,
    items: readonly { value: T; weight: number }[],
): T {
    if (items.length === 0) throw new Error('pickWeighted: 候选为空');
    const total = items.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
    if (total <= 0) return pick(rng, items).value;

    let r = rng() * total;
    for (const item of items) {
        r -= Math.max(0, item.weight);
        if (r < 0) return item.value;
    }
    return items[items.length - 1].value;
}

/** 闭区间随机整数 [min, max] */
export function randInt(rng: () => number, min: number, max: number): number {
    if (max < min) return min;
    return min + Math.floor(rng() * (max - min + 1));
}
