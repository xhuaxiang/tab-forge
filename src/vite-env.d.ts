/// <reference types="vite/client" />

/** 构建时由 vite.base.config.ts 从 package.json 注入 */
declare const __APP_VERSION__: string;

declare module '*.sf2?url' {
  const src: string;
  export default src;
}

declare module '*.sf3?url' {
  const src: string;
  export default src;
}
