"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var WaitUntilReady_1 = __importDefault(require("./WaitUntilReady"));
var GetResult_1 = __importDefault(require("./GetResult"));
var HiveUtils = /** @class */ (function () {
    function HiveUtils(TCLIService_types) {
        this.TCLIService_types = TCLIService_types;
    }
    HiveUtils.prototype.waitUntilReady = function (operation, progress, callback) {
        var waitUntilReady = new WaitUntilReady_1.default(operation, this.TCLIService_types);
        return waitUntilReady.execute(progress, callback);
    };
    HiveUtils.prototype.getResult = function (operation, resultHandler) {
        var getResult = new GetResult_1.default(operation, this.TCLIService_types);
        return getResult.execute(resultHandler);
    };
    return HiveUtils;
}());
exports.default = HiveUtils;
//# sourceMappingURL=HiveUtils.js.map