import { defineConfig, mergeConfig } from "vite";
import baseConfig from "./vite.base.config.js";
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig(mergeConfig(baseConfig, {
    base: "./",
    plugins: [
        viteStaticCopy({
            targets: [
                { src: 'manifest.json', dest: '' },
                { src: '_locales/*', dest: '_locales' },
            ],
        }),
    ],
    build: {
        outDir: "dist",
        rollupOptions: {
            input: {
                index: "./index.html",
                background: "./src/background.ts",
                content: './src/content.ts',
            },
            output: {
                entryFileNames: "[name].js",
                chunkFileNames: "chunks/[name]-[hash].js",
                assetFileNames: "assets/[name]-[hash][extname]",
            }
        },
    },
}));
