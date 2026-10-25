// ==========================================
// 組み込み関数 (1章〜9章) & 関数呼び出しディスパッチ
// ==========================================

function executeSqueezeFunction(args) {
    if (args.length < 2) return args[0] ? toDisplayString(args[0]) : "";
    const s1 = toDisplayString(args[0]);

    if (args.length === 2) {
        const s3 = toDisplayString(args[1]);
        let out = '';
        let inWs = false;
        for (let i = 0; i < s1.length; i++) {
            const ch = s1[i];
            if (isSpaceChar(ch) || ch === '\n' || ch === '\r') {
                if (!inWs) {
                    out += s3;
                    inWs = true;
                }
            } else {
                out += ch;
                inWs = false;
            }
        }
        return out;
    }

    const s2 = toDisplayString(args[1]);
    const s3 = toDisplayString(args[2]);
    if (s2 === '') return s1;

    let out = '';
    let i = 0;
    while (i < s1.length) {
        if (s1.startsWith(s2, i)) {
            out += s3;
            while (i < s1.length && s1.startsWith(s2, i)) {
                i += s2.length;
            }
        } else {
            out += s1[i];
            i++;
        }
    }
    return out;
}

function executeAtFunction(argResults) {
    if (argResults.length < 2) return "";
    let current = resolveArgAsCollectionOrValue(argResults[0]);

    for (let i = 1; i < argResults.length; i++) {
        current = parseNestedCasicStructure(current);
        const keyOrIdx = argResults[i].value;

        if (Array.isArray(current)) {
            const idx = Math.trunc(parseCasicNumber(keyOrIdx).num);
            if (idx < 1 || idx > current.length) return "";
            current = current[idx - 1];
        } else if (isPlainDictObject(current)) {
            const k = toDisplayString(keyOrIdx);
            if (!Object.prototype.hasOwnProperty.call(current, k)) return "";
            current = current[k];
        } else {
            return "";
        }
    }

    if (Array.isArray(current)) {
        return formatArrayAsCasicString(current);
    }
    if (isPlainDictObject(current)) {
        return formatDictAsJsonString(current);
    }
    return String(current);
}

function callBuiltinFunction(rawFuncNameLower, argResults) {
    const funcNameLower = normalizeFunctionName(rawFuncNameLower);
    const args = argResults.map(function(r) { return r.value; });

    // 1. 入力の関数
    if (funcNameLower === 'check') {
        if (args.length === 0) return readNextInputToken(null, false).token;
        const customSep = toDisplayString(args[0]);
        return readNextInputToken(customSep, false).token;
    }
    if (funcNameLower === 'charcheck') {
        const n = args.length === 0 ? 1 : Math.max(0, Math.trunc(parseCasicNumber(args[0]).num));
        return readInputChars(n, false);
    }
    if (funcNameLower === 'allcheck') {
        return readRemainingInput();
    }

    // 2. 計算の関数
    if (funcNameLower === 'abs') {
        if (args.length === 0) return "0";
        const p = parseCasicNumber(args[0]);
        if (p.kind === 'bigint') return (p.big < 0n ? -p.big : p.big).toString() + 'n';
        if (p.kind === 'float') return formatFloatStorage(Math.abs(p.num));
        return String(Math.abs(p.num));
    }
    if (funcNameLower === 'not') {
        if (args.length === 0) return "1";
        return isCasicTruthy(args[0]) ? "0" : "1";
    }
    if (funcNameLower === 'sqrt') {
        if (args.length === 0) return "0.0";
        const p = parseCasicNumber(args[0]);
        if (p.num < 0) throw new Error('sqrt関数に負の数は指定できません');
        return formatFloatStorage(Math.sqrt(p.num));
    }
    if (funcNameLower === 'round' || funcNameLower === 'floor' || funcNameLower === 'ceil' || funcNameLower === 'trunc') {
        if (args.length === 0) return "0";
        return applyRoundingFunction(funcNameLower, args[0], args.length >= 2 ? args[1] : null);
    }
    if (funcNameLower === 'min' || funcNameLower === 'max' || funcNameLower === 'sum') {
        let items = [];
        if (args.length === 1) {
            const single = resolveArgAsCollectionOrValue(argResults[0]);
            items = Array.isArray(single) ? single : [single];
        } else {
            items = args;
        }
        const nums = [];
        for (let i = 0; i < items.length; i++) {
            const s = String(items[i]);
            if (isNumericLiteralString(s)) {
                nums.push({ raw: s, parsed: parseCasicNumber(s) });
            }
        }
        if (funcNameLower === 'sum') {
            let acc = "0";
            for (let i = 0; i < nums.length; i++) {
                acc = applyNumericBinaryOp(acc, nums[i].raw, '+');
            }
            return acc;
        }
        if (nums.length === 0) return "0";
        let best = nums[0];
        for (let i = 1; i < nums.length; i++) {
            const cmp = compareCasicNumericSort(nums[i].raw, best.raw);
            if ((funcNameLower === 'min' && cmp < 0) || (funcNameLower === 'max' && cmp > 0)) {
                best = nums[i];
            }
        }
        return best.raw;
    }
    if (funcNameLower === 'gcd' || funcNameLower === 'lcm') {
        let items = [];
        if (args.length === 1) {
            const single = resolveArgAsCollectionOrValue(argResults[0]);
            items = Array.isArray(single) ? single : [single];
        } else {
            items = args;
        }
        if (items.length === 0) return "0";
        let hasBig = false;
        const bigList = items.map(function(x) {
            const p = parseCasicNumber(x);
            if (p.rank === 2) hasBig = true;
            return p.big;
        });
        let acc = bigList[0] < 0n ? -bigList[0] : bigList[0];
        for (let i = 1; i < bigList.length; i++) {
            acc = (funcNameLower === 'gcd') ? bigIntGcd(acc, bigList[i]) : bigIntLcm(acc, bigList[i]);
        }
        return hasBig ? (acc.toString() + 'n') : acc.toString();
    }
    if (funcNameLower === 'base') {
        if (args.length === 2) {
            const rTo = parseCasicNumber(args[1]).num;
            return convertBaseCasic(args[0], 10, rTo);
        }
        if (args.length >= 3) {
            const rFrom = parseCasicNumber(args[1]).num;
            const rTo = parseCasicNumber(args[2]).num;
            return convertBaseCasic(args[0], rFrom, rTo);
        }
        throw new Error('base関数には2つまたは3つの引数が必要です');
    }

    // 3. ビット演算の関数
    if (funcNameLower === 'band' || funcNameLower === 'bor' || funcNameLower === 'bxor') {
        if (args.length < 2) throw new Error(funcNameLower + '関数には2つの引数が必要です');
        const p1 = parseCasicNumber(args[0]);
        const p2 = parseCasicNumber(args[1]);
        const isBig = (p1.rank === 2 || p2.rank === 2);
        let res = 0n;
        if (funcNameLower === 'band') res = p1.big & p2.big;
        else if (funcNameLower === 'bor') res = p1.big | p2.big;
        else if (funcNameLower === 'bxor') res = xorBig(p1.big, p2.big);
        return isBig ? (res.toString() + 'n') : res.toString();
    }
    if (funcNameLower === 'bnot') {
        if (args.length < 1) throw new Error('bnot関数には1つの引数が必要です');
        const p = parseCasicNumber(args[0]);
        const res = ~p.big;
        return p.rank === 2 ? (res.toString() + 'n') : res.toString();
    }

    // 4. ハッシュ・乱数の関数
    if (funcNameLower === 'rand') {
        const r = nextRandomFloat01();
        if (args.length === 0) return r < 0.5 ? "0" : "1";
        if (args.length === 1) {
            const firstResolved = resolveArgAsCollectionOrValue(argResults[0]);
            if (Array.isArray(firstResolved)) {
                if (firstResolved.length === 0) return "";
                const idx = Math.floor(r * firstResolved.length);
                return firstResolved[idx];
            }
            const n = Math.trunc(parseCasicNumber(firstResolved).num);
            if (n < 1) return "0";
            return String(Math.floor(r * n) + 1);
        }
        const n1 = Math.trunc(parseCasicNumber(args[0]).num);
        const n2 = Math.trunc(parseCasicNumber(args[1]).num);
        const lo = Math.min(n1, n2);
        const hi = Math.max(n1, n2);
        return String(Math.floor(r * (hi - lo + 1)) + lo);
    }
    if (funcNameLower === 'rand.') {
        const r = nextRandomFloat01();
        if (args.length === 0) return formatFloatStorage(r);
        if (args.length === 1) {
            const n = parseCasicNumber(args[0]).num;
            return formatFloatStorage(r * n);
        }
        const n1 = parseCasicNumber(args[0]).num;
        const n2 = parseCasicNumber(args[1]).num;
        return formatFloatStorage(n1 + r * (n2 - n1));
    }
    if (funcNameLower === 'hrand') {
        const sKey = args.length >= 1 ? toDisplayString(args[0]) : "";
        const r = hashRandomFloat01(sKey);
        if (args.length <= 1) return r < 0.5 ? "0" : "1";
        if (args.length === 2) {
            const n = Math.trunc(parseCasicNumber(args[1]).num);
            if (n < 1) return "0";
            return String(Math.floor(r * n) + 1);
        }
        const n1 = Math.trunc(parseCasicNumber(args[1]).num);
        const n2 = Math.trunc(parseCasicNumber(args[2]).num);
        const lo = Math.min(n1, n2);
        const hi = Math.max(n1, n2);
        return String(Math.floor(r * (hi - lo + 1)) + lo);
    }
    if (funcNameLower === 'hrand.') {
        const sKey = args.length >= 1 ? toDisplayString(args[0]) : "";
        const r = hashRandomFloat01(sKey);
        if (args.length <= 1) return formatFloatStorage(r);
        if (args.length === 2) {
            const n = parseCasicNumber(args[1]).num;
            return formatFloatStorage(r * n);
        }
        const n1 = parseCasicNumber(args[1]).num;
        const n2 = parseCasicNumber(args[2]).num;
        return formatFloatStorage(n1 + r * (n2 - n1));
    }
    if (funcNameLower === 'hash') {
        const sKey = args.length >= 1 ? toDisplayString(args[0]) : "";
        return computeHash64BigInt(sKey).toString();
    }
    if (funcNameLower === 'md5') {
        const sKey = args.length >= 1 ? toDisplayString(args[0]) : "";
        return computeMd5Hex(sKey);
    }
    if (funcNameLower === 'sha256') {
        const sKey = args.length >= 1 ? toDisplayString(args[0]) : "";
        return computeSha256Hex(sKey);
    }

    // 5. 型変換・評価の関数
    if (funcNameLower === 'str') {
        return args.length > 0 ? toDisplayString(args[0]) : "";
    }
    if (funcNameLower === 'big') {
        if (args.length === 0) return "0n";
        const p = parseCasicNumber(args[0]);
        return p.big.toString() + 'n';
    }
    if (funcNameLower === 'num') {
        if (args.length === 0) return "0";
        const p = parseCasicNumber(args[0]);
        return p.kind === 'float' ? formatFloatStorage(p.num) : String(Math.trunc(p.num));
    }
    if (funcNameLower === 'eval') {
        if (args.length === 0) return "";
        const codeExpr = toDisplayString(args[0]);
        return evaluateExpression(codeExpr);
    }

    // 6 & 7. 文字列・配列共通 & 文字列の関数
    if (funcNameLower === 'chr') {
        if (args.length === 0) return "";
        const code = Math.trunc(parseCasicNumber(args[0]).num);
        return String.fromCodePoint(code);
    }
    if (funcNameLower === 'ord') {
        if (args.length === 0) return "0";
        const s = toDisplayString(args[0]);
        return s.length > 0 ? String(s.codePointAt(0)) : "0";
    }
    if (funcNameLower === 'uni') {
        if (args.length === 0) return "";
        const raw = toDisplayString(args[0]);
        const chars = Array.from(raw);
        if (chars.length === 1) return String(chars[0].codePointAt(0));
        if (isIntString(raw)) return String.fromCodePoint(Math.trunc(Number(raw)));
        return chars.map(function(c) { return String(c.codePointAt(0)); });
    }
    if (funcNameLower === 'len') {
        if (args.length === 0) return "0";
        const target = resolveArgAsCollectionOrValue(argResults[0]);
        if (Array.isArray(target)) return String(target.length);
        if (isPlainDictObject(target)) return String(Object.keys(target).length);
        return String(Array.from(toDisplayString(target)).length);
    }
    if (funcNameLower === 'rev') {
        if (args.length === 0) return "";
        const target = resolveArgAsCollectionOrValue(argResults[0]);
        if (Array.isArray(target)) return target.slice().reverse();
        return Array.from(toDisplayString(target)).reverse().join('');
    }
    if (funcNameLower === 'sort') {
        if (args.length === 0) return "";
        const target = resolveArgAsCollectionOrValue(argResults[0]);
        if (Array.isArray(target)) return target.slice().sort(compareCasicNumericSort);
        return Array.from(toDisplayString(target)).sort().join('');
    }
    if (funcNameLower === 'dsort') {
        if (args.length === 0) return "";
        const target = resolveArgAsCollectionOrValue(argResults[0]);
        if (Array.isArray(target)) return target.slice().sort(compareCasicDictSort);
        return Array.from(toDisplayString(target)).sort().join('');
    }
    if (funcNameLower === 'find') {
        if (args.length < 2) return "0";
        const target = resolveArgAsCollectionOrValue(argResults[0]);
        const needle = args[1];
        if (Array.isArray(target)) {
            for (let i = 0; i < target.length; i++) {
                if (areCasicValuesEqual(target[i], needle)) return String(i + 1);
            }
            return "0";
        }
        const str = toDisplayString(target);
        const sub = toDisplayString(needle);
        const idx = str.indexOf(sub);
        return idx === -1 ? "0" : String(Array.from(str.slice(0, idx)).length + 1);
    }
    if (funcNameLower === 'count') {
        if (args.length < 2) return "0";
        const target = resolveArgAsCollectionOrValue(argResults[0]);
        const needle = args[1];
        if (Array.isArray(target)) {
            let c = 0;
            for (let i = 0; i < target.length; i++) {
                if (areCasicValuesEqual(target[i], needle)) c++;
            }
            return String(c);
        }
        if (isPlainDictObject(target)) {
            let c = 0;
            const keys = Object.keys(target);
            for (let i = 0; i < keys.length; i++) {
                if (areCasicValuesEqual(target[keys[i]], needle)) c++;
            }
            return String(c);
        }
        const str = toDisplayString(target);
        const sub = toDisplayString(needle);
        if (sub === '') return "0";
        return String(str.split(sub).length - 1);
    }
    if (funcNameLower === 'replace') {
        if (args.length < 2) return args[0] || "";
        const target = resolveArgAsCollectionOrValue(argResults[0]);
        const s1 = args[1];
        const s2 = args.length >= 3 ? args[2] : "";
        if (Array.isArray(target)) {
            return target.map(function(el) {
                return areCasicValuesEqual(el, s1) ? s2 : el;
            });
        }
        return toDisplayString(target).split(toDisplayString(s1)).join(toDisplayString(s2));
    }
    if (funcNameLower === 'split') {
        if (args.length === 0) return [];
        const s1 = toDisplayString(args[0]);
        const s2 = args.length >= 2 ? toDisplayString(args[1]) : ' ';
        const rawParts = s1.split(s2);
        const filteredParts = rawParts.filter(function(item) { return item !== ''; });
        if (args.length <= 2) return filteredParts;
        const nIdx = Math.trunc(parseCasicNumber(args[2]).num);
        if (nIdx >= 1 && nIdx <= filteredParts.length) return filteredParts[nIdx - 1];
        if (nIdx >= 1 && nIdx <= rawParts.length) return rawParts[nIdx - 1];
        return "";
    }
    if (funcNameLower === 'rep') {
        if (args.length === 0) return "";
        const s1 = toDisplayString(args[0]);
        const n = args.length >= 2 ? Math.max(0, Math.trunc(parseCasicNumber(args[1]).num)) : 0;
        return s1.repeat(n);
    }
    if (funcNameLower === 'trim') {
        if (args.length === 0) return "";
        const s = toDisplayString(args[0]);
        let start = 0;
        let end = s.length;
        while (start < end && (isSpaceChar(s[start]) || s[start] === '\n' || s[start] === '\r')) start++;
        while (end > start && (isSpaceChar(s[end - 1]) || s[end - 1] === '\n' || s[end - 1] === '\r')) end--;
        return s.slice(start, end);
    }
    if (funcNameLower === 'upper') {
        if (args.length === 0) return "";
        return toDisplayString(args[0]).toUpperCase();
    }
    if (funcNameLower === 'lower') {
        if (args.length === 0) return "";
        return toDisplayString(args[0]).toLowerCase();
    }
    if (funcNameLower === 'regex') {
        if (args.length < 2) return "";
        const s1 = toDisplayString(args[0]);
        const pattern = toDisplayString(args[1]);
        const re = new RegExp(pattern);
        const m = s1.match(re);
        return m ? m[0] : "";
    }
    if (funcNameLower === 'if') {
        const cond = args.length > 0 ? isCasicTruthy(args[0]) : false;
        const s1 = args.length > 1 ? args[1] : "";
        const s2 = args.length > 2 ? args[2] : "";
        return cond ? s1 : s2;
    }
    if (funcNameLower === 'squeeze') {
        return executeSqueezeFunction(args);
    }
    if (funcNameLower === 'at') {
        return executeAtFunction(argResults);
    }

    // 8. 配列の関数
    if (funcNameLower === 'join') {
        if (args.length === 0) return "";
        const target = resolveArgAsCollectionOrValue(argResults[0]);
        if (!Array.isArray(target)) return toDisplayString(target);
        if (args.length === 1) return formatArrayAsCasicString(target);
        const sep = toDisplayString(args[1]);
        return target.map(toDisplayString).join(sep);
    }
    if (funcNameLower === 'grid') {
        if (args.length < 2) return [];
        const fillVal = args[0];
        const dims = args.slice(1).map(function(d) {
            return Math.max(0, Math.trunc(parseCasicNumber(d).num));
        });
        function makeGrid(depth) {
            const len = dims[depth];
            const arr = [];
            for (let i = 0; i < len; i++) {
                arr.push(depth === dims.length - 1 ? fillVal : makeGrid(depth + 1));
            }
            return arr;
        }
        return makeGrid(0);
    }
    if (funcNameLower === 'flat') {
        if (args.length === 0) return [];
        const target = resolveArgAsCollectionOrValue(argResults[0]);
        if (!Array.isArray(target)) return [target];
        const out = [];
        function flattenRec(a) {
            for (let i = 0; i < a.length; i++) {
                if (Array.isArray(a[i])) flattenRec(a[i]);
                else out.push(a[i]);
            }
        }
        flattenRec(target);
        return out;
    }
    if (funcNameLower === 'uniq') {
        if (args.length === 0) return [];
        const target = resolveArgAsCollectionOrValue(argResults[0]);
        if (!Array.isArray(target)) return [target];
        const out = [];
        for (let i = 0; i < target.length; i++) {
            let exists = false;
            for (let j = 0; j < out.length; j++) {
                if (areCasicValuesEqual(out[j], target[i])) {
                    exists = true;
                    break;
                }
            }
            if (!exists) out.push(target[i]);
        }
        return out;
    }
    if (funcNameLower === 'bs') {
        if (args.length < 2) return "0";
        const target = resolveArgAsCollectionOrValue(argResults[0]);
        if (!Array.isArray(target)) return "0";
        const x = args[1];
        let lo = 0;
        let hi = target.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (compareCasicNumericSort(target[mid], x) < 0) lo = mid + 1;
            else hi = mid;
        }
        return String(lo + 1);
    }

    // 9. 辞書・JSON・描画初期辞書の関数
    if (funcNameLower === 'has') {
        if (args.length < 2) return "0";
        const dictObj = resolveArgAsDict(argResults[0]);
        const keyStr = toDisplayString(args[1]);
        return Object.prototype.hasOwnProperty.call(dictObj, keyStr) ? "1" : "0";
    }
    if (funcNameLower === 'keys') {
        if (args.length === 0) return [];
        const dictObj = resolveArgAsDict(argResults[0]);
        return Object.keys(dictObj);
    }
    if (funcNameLower === 'json') {
        if (args.length === 0) return "{}";
        const dictObj = resolveArgAsDict(argResults[0]);
        return formatDictAsJsonString(dictObj);
    }
    if (funcNameLower === 'g_shape') {
        return {
            "x": "0", "y": "0", "w": "60", "h": "60",
            "color": "#000000", "r": "0", "rot": "0",
            "fill": "1", "frame": "5", "alpha": "1"
        };
    }
    if (funcNameLower === 'g_image') {
        return {
            "x": "0", "y": "0", "w": "", "h": "",
            "rot": "0", "cx": "", "cy": "",
            "flipx": "0", "flipy": "0", "alpha": "1",
            "clip": "", "hue": "0"
        };
    }
    if (funcNameLower === 'g_text') {
        return {
            "x": "0", "y": "0", "w": "300", "h": "",
            "rot": "0", "color": "#000000", "font": "",
            "size": "30", "align": "left", "valign": "up", "alpha": "1"
        };
    }

    // 10. ユーザー定義関数の呼び出し
    if (Object.prototype.hasOwnProperty.call(state.functions, rawFuncNameLower)) {
        if (typeof invokeUserDefinedFunction === 'function') {
            return invokeUserDefinedFunction(state.functions[rawFuncNameLower], argResults);
        }
    }

    throw new Error('未定義または未実装の関数です: ' + rawFuncNameLower + '()');
}