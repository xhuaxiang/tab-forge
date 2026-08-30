/**
 * Tesseract 静音 worker 包装器（经典 worker）
 *
 * Tesseract 原生内核会往 worker 控制台打印噪音（"Estimating resolution as NNN"、
 * "Detected N diacritics"、形如 "00d2a84a:0x1eab52" 的内部日志），tesseract.js 的
 * setLogging(false) 管不到这些（来自 emscripten 的 print/console）。
 * 这里在加载真实 worker 前把 console 静音；通信走 postMessage，不受影响。
 */
/* eslint-disable no-console */
(function () {
    'use strict';
    var noop = function () { };
    var methods = ['log', 'warn', 'error', 'info', 'debug'];
    for (var i = 0; i < methods.length; i++) {
        if (self.console && self.console[methods[i]]) {
            try { self.console[methods[i]] = noop; } catch (e) { /* 某些环境只读，忽略 */ }
        }
    }
})();
importScripts('./tesseract-worker.min.js');
