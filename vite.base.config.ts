import { defineConfig } from "vite";

// 基础配置，包含共享插件和通用设置
export default defineConfig({
    plugins: [],
    build: {
        rollupOptions: {
            output: {
                entryFileNames: "[name].js",
                chunkFileNames: "chunks/[name]-[hash].js",
                assetFileNames: "assets/[name]-[hash][extname]",
            },
        },
    },
});
