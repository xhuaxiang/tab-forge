import { defineConfig, mergeConfig } from "vite";
import baseConfig from "./vite.base.config.js";

/**
 * Vite 配置 - 普通浏览器版本
 * 可在普通浏览器中直接打开 index.html 运行
 */
export default defineConfig(mergeConfig(baseConfig, {
    base: "./",
    build: {
        outDir: "dist-web",
        rollupOptions: {
            input: {
                index: "./index.html",
            },
            output: {
                entryFileNames: "[name].js",
                chunkFileNames: "chunks/[name]-[hash].js",
                assetFileNames: "assets/[name]-[hash][extname]",
            }
        },
    },
}));
