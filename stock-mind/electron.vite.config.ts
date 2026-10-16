import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    main: {
        plugins: [externalizeDepsPlugin()],
    },
    preload: {
        plugins: [externalizeDepsPlugin()],
    },
    renderer: {
        root: 'src/renderer',
        resolve: {
            alias: {
                '@renderer': resolve('src/renderer/src'),
            },
        },
        plugins: [react()],
        build: {
            // 多窗口各自一个 HTML 入口；不列出来的话生产包里只会打出 index.html
            rollupOptions: {
                input: {
                    index: resolve('src/renderer/index.html'),
                    pet: resolve('src/renderer/pet.html'),
                    mini: resolve('src/renderer/mini.html'),
                },
            },
        },
    },
})
