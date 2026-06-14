"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearAxmemContextProvider = exports.setAxmemContextProvider = exports.resolveAxmemStorageDir = exports.setAxmemStorageLayout = void 0;
var memory_1 = require("./memory");
Object.defineProperty(exports, "setAxmemStorageLayout", { enumerable: true, get: function () { return memory_1.setAxmemStorageLayout; } });
Object.defineProperty(exports, "resolveAxmemStorageDir", { enumerable: true, get: function () { return memory_1.resolveAxmemStorageDir; } });
var context_1 = require("./context");
Object.defineProperty(exports, "setAxmemContextProvider", { enumerable: true, get: function () { return context_1.setAxmemContextProvider; } });
Object.defineProperty(exports, "clearAxmemContextProvider", { enumerable: true, get: function () { return context_1.clearAxmemContextProvider; } });
