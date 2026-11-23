import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const pkg = JSON.parse(
    readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

// 基础配置，包含共享插件和通用设置
export default defineConfig({
    plugins: [],
    define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
    },
    build: {
        worker: {
            format: 'es',
        },
        rollupOptions: {
            output: {
                entryFileNames: "[name].js",
                chunkFileNames: "chunks/[name]-[hash].js",
                assetFileNames: "assets/[name]-[hash][extname]",
            },
        },
    },
});
