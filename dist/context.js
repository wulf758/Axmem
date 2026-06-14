"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setAxmemContextProvider = setAxmemContextProvider;
exports.clearAxmemContextProvider = clearAxmemContextProvider;
exports.readContext = readContext;
exports.readContextHistory = readContextHistory;
exports.readSessionLog = readSessionLog;
let provider = {};
function setAxmemContextProvider(nextProvider) {
    provider = nextProvider;
}
function clearAxmemContextProvider() {
    provider = {};
}
function readContext(cwd) {
    return provider.readContext?.(cwd);
}
function readContextHistory(cwd) {
    return provider.readContextHistory?.(cwd) ?? { schema: "axiom.context_history.v0", entries: [] };
}
function readSessionLog(cwd) {
    return provider.readSessionLog?.(cwd) ?? [];
}
