import * as pdfjsLib from './vendor/pdf.mjs';
// Loading the worker module once in the page gives PDF.js a reliable fake-worker
// fallback on browsers that cannot start module workers (notably some iOS builds).
await import('./vendor/pdf.worker.mjs');

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', import.meta.url).href;
window.pdfjsLib = pdfjsLib;

await import('./app-universal.mjs');
