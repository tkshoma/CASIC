// ==========================================
// 組み込み関数 (1章〜9章) & 関数呼び出しディスパッチ
// ==========================================

function formatCleanMathResult(val) {
    if (!Number.isFinite(val)) return formatFloatStorage(val);
    const cleaned = Number(val.toPrecision(15));
    if (Object.is(cleaned, -0)) return "0";
    return String(cleaned);
}

function executeTrigFunction(mode, degRaw) {
    const deg = parseCasicNumber(degRaw).num;
    if (!Number.isFinite(deg)) return "0";

    const norm360 = ((deg % 360) + 360) % 360;
    const norm180 = ((deg % 180) + 180) % 180;
    const rad = deg * (Math.PI / 180);

    if (mode === 'sin') {
        if (norm180 === 0) return "0";
        if (norm360 === 90) return "1";
        if (norm360 === 270) return "-1";
        return formatCleanMathResult(Math.sin(rad));
    }
    if (mode === 'cos') {
        if (norm360 === 0) return "1";
        if (norm360 === 180) return "-1";
        if (norm360 === 90 || norm360 === 270) return "0";
        return formatCleanMathResult(Math.cos(rad));
    }
    if (mode === 'tan') {
        if (norm180 === 0) return "0";
        if (norm180 === 45) return "1";
        if (norm180 === 135) return "-1";
        if (norm180 === 90) return "inf";
        return formatCleanMathResult(Math.tan(rad));
    }
    return "0";
}

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

// 文字列s1内の s2 と s3 の対応ペアを抽出する共通ヘルパー
function extractBetweenPairs(s1, s2, s3) {
    if (s2 === '' || s3 === '') return [];

    if (s2 === s3) {
        const positions = [];
        let pos = 0;
        while (pos <= s1.length - s2.length) {
            const idx = s1.indexOf(s2, pos);
            if (idx === -1) break;
            positions.push(idx);
            pos = idx + s2.length;
        }
        const samePairs = [];
        for (let i = 0; i + 1 < positions.length; i += 2) {
            samePairs.push({
                openStart: positions[i],
                openEnd: positions[i] + s2.length,
                closeStart: positions[i + 1],
                closeEnd: positions[i + 1] + s3.length,
                children: [],
                parent: null
            });
        }
        return samePairs;
    }

    const openStack = [];
    const pairs = [];
    let i = 0;

    while (i < s1.length) {
        const matchOpen = s1.startsWith(s2, i);
        const matchClose = s1.startsWith(s3, i);

        if (matchOpen && matchClose) {
            if (s2.length >= s3.length) {
                openStack.push({ start: i, end: i + s2.length });
                i += s2.length;
            } else {
                if (openStack.length > 0) {
                    const op = openStack.pop();
                    pairs.push({ openStart: op.start, openEnd: op.end, closeStart: i, closeEnd: i + s3.length, children: [], parent: null });
                }
                i += s3.length;
            }
        } else if (matchOpen) {
            openStack.push({ start: i, end: i + s2.length });
            i += s2.length;
        } else if (matchClose) {
            if (openStack.length > 0) {
                const op = openStack.pop();
                pairs.push({ openStart: op.start, openEnd: op.end, closeStart: i, closeEnd: i + s3.length, children: [], parent: null });
            }
            i += s3.length;
        } else {
            i++;
        }
    }

    return pairs;
}

// 7章: between_get(s1, s2, s3, n) 関数ヘルパー
// n>0: 前から数えてn番目のs2とそれに対応するs3の間にある文字列を返す。
// n<0: 後ろから数えて|n|番目のs3とそれに対応するs2の間にある文字列を返す。
function executeBetweenGetFunction(args) {
    if (args.length < 3) return "";
    const s1 = toDisplayString(args[0]);
    const s2 = toDisplayString(args[1]);
    const s3 = toDisplayString(args[2]);
    const n = (args.length >= 4 && cleanText(args[3]) !== '')
        ? Math.trunc(parseCasicNumber(args[3]).num)
        : 1;

    if (s2 === '' || s3 === '' || n === 0) return "";

    const pairs = extractBetweenPairs(s1, s2, s3);
    if (pairs.length === 0) return "";

    if (n > 0) {
        pairs.sort(function(a, b) {
            return a.openStart - b.openStart;
        });
        if (n > pairs.length) return "";
        const target = pairs[n - 1];
        return s1.slice(target.openEnd, target.closeStart);
    } else {
        pairs.sort(function(a, b) {
            return b.closeStart - a.closeStart;
        });
        const idx = Math.abs(n) - 1;
        if (idx >= pairs.length) return "";
        const target = pairs[idx];
        return s1.slice(target.openEnd, target.closeStart);
    }
}

// 7章: between_replace(s1, s2, s3, s4) 関数ヘルパー
// 文字列s1の中で、s2とs3の間にある文字列をs4(初期値 "")に置き換えた文字列を返す。
function executeBetweenReplaceFunction(args) {
    if (args.length < 3) return args[0] ? toDisplayString(args[0]) : "";
    const s1 = toDisplayString(args[0]);
    const s2 = toDisplayString(args[1]);
    const s3 = toDisplayString(args[2]);
    const s4 = args.length >= 4 ? toDisplayString(args[3]) : "";

    if (s2 === '' || s3 === '') return s1;

    let out = '';
    let pos = 0;
    while (pos < s1.length) {
        const openIdx = s1.indexOf(s2, pos);
        if (openIdx === -1) {
            out += s1.slice(pos);
            break;
        }
        const closeIdx = s1.indexOf(s3, openIdx + s2.length);
        if (closeIdx === -1) {
            out += s1.slice(pos);
            break;
        }
        out += s1.slice(pos, openIdx + s2.length) + s4 + s3;
        pos = closeIdx + s3.length;
    }
    return out;
}

// 7章: between_list(s1, s2, s3, n) 関数ヘルパー
// 文字列s1の中でs2とs3の間にある文字列を取り出し配列型で返す。
function executeBetweenListFunction(args) {
    if (args.length < 3) return [];
    const s1 = toDisplayString(args[0]);
    const s2 = toDisplayString(args[1]);
    const s3 = toDisplayString(args[2]);
    const n = (args.length >= 4 && cleanText(args[3]) !== '')
        ? Math.trunc(parseCasicNumber(args[3]).num)
        : 1;

    if (s2 === '' || s3 === '' || n === 0) return [];

    if (s2 === s3) {
        if (n !== 1 && n !== -1) return [];
        const samePairs = extractBetweenPairs(s1, s2, s3);
        return samePairs.map(function(p) {
            return s1.slice(p.openEnd, p.closeStart);
        });
    }

    const pairs = extractBetweenPairs(s1, s2, s3);
    if (pairs.length === 0) return [];

    pairs.sort(function(a, b) {
        return a.openStart - b.openStart;
    });

    for (let j = 0; j < pairs.length; j++) {
        const child = pairs[j];
        let bestParent = null;
        for (let k = j - 1; k >= 0; k--) {
            const cand = pairs[k];
            if (cand.openStart < child.openStart && cand.closeEnd >= child.closeEnd) {
                bestParent = cand;
                break;
            }
        }
        if (bestParent) {
            child.parent = bestParent;
            bestParent.children.push(child);
        }
    }

    for (let j = 0; j < pairs.length; j++) {
        const p = pairs[j];
        p.outerDepth = p.parent ? (p.parent.outerDepth + 1) : 1;
    }

    function computeInnerDepth(node) {
        if (node.children.length === 0) {
            node.innerDepth = 1;
            return 1;
        }
        let maxChild = 0;
        for (let c = 0; c < node.children.length; c++) {
            const d = computeInnerDepth(node.children[c]);
            if (d > maxChild) maxChild = d;
        }
        node.innerDepth = maxChild + 1;
        return node.innerDepth;
    }

    for (let j = 0; j < pairs.length; j++) {
        if (!pairs[j].parent) {
            computeInnerDepth(pairs[j]);
        }
    }

    const targetDepth = Math.abs(n);
    const outList = [];
    for (let j = 0; j < pairs.length; j++) {
        const p = pairs[j];
        const depthToCheck = (n > 0) ? p.innerDepth : p.outerDepth;
        if (depthToCheck === targetDepth) {
            outList.push(s1.slice(p.openEnd, p.closeStart));
        }
    }

    return outList;
}

// 7章: unescape(s, type) 関数ヘルパー
// type: "all" (初期値), "unicode", "html", "url"（大文字小文字不問）
function executeUnescapeFunction(args) {
    if (args.length === 0) return "";
    let result = toDisplayString(args[0]);
    const type = args.length >= 2 ? cleanText(toDisplayString(args[1])).toLowerCase() : 'all';

    if (type !== 'all' && type !== 'unicode' && type !== 'html' && type !== 'url') {
        throw new Error('unescape関数の第2引数には "all", "unicode", "html", "url" のいずれかを指定してください');
    }

    if (type === 'all' || type === 'unicode') {
        result = result.replace(/\\u\{([0-9a-fA-F]+)\}/g, function(_, hex) {
            const code = parseInt(hex, 16);
            return Number.isFinite(code) ? String.fromCodePoint(code) : _;
        });
        result = result.replace(/\\u([0-9a-fA-F]{4})/g, function(_, hex) {
            const code = parseInt(hex, 16);
            return Number.isFinite(code) ? String.fromCharCode(code) : _;
        });
    }

    if (type === 'all' || type === 'html') {
        const decoder = document.createElement('textarea');
        result = result.replace(/&(#?[a-zA-Z0-9]+);/g, function(fullMatch, entityBody) {
            if (entityBody.toLowerCase() === 'apos') return "'";
            decoder.innerHTML = fullMatch;
            return decoder.value;
        });
    }

    if (type === 'all' || type === 'url') {
        result = result.replace(/(?:%[0-9a-fA-F]{2})+/g, function(encodedSeq) {
            try {
                return decodeURIComponent(encodedSeq);
            } catch (e) {
                return encodedSeq;
            }
        });
    }

    return result;
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

function executeBinarySearchFunction(targetArr, x, opStr) {
    const mode = cleanText(opStr || '>=');
    const n = targetArr.length;

    if (mode === '>=' || mode === '') {
        let lo = 0;
        let hi = n;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (compareCasicNumericSort(targetArr[mid], x) < 0) lo = mid + 1;
            else hi = mid;
        }
        return String(lo + 1);
    }

    if (mode === '>') {
        let lo = 0;
        let hi = n;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (compareCasicNumericSort(targetArr[mid], x) <= 0) lo = mid + 1;
            else hi = mid;
        }
        return String(lo + 1);
    }

    if (mode === '<=') {
        let lo = 0;
        let hi = n;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (compareCasicNumericSort(targetArr[mid], x) <= 0) lo = mid + 1;
            else hi = mid;
        }
        return String(lo);
    }

    if (mode === '<') {
        let lo = 0;
        let hi = n;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (compareCasicNumericSort(targetArr[mid], x) < 0) lo = mid + 1;
            else hi = mid;
        }
        return String(lo);
    }

    throw new Error('bs関数の第3引数（不等号）には ">=", ">", "<=", "<" のいずれかを指定してください');
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
    if (funcNameLower === 'clamp') {
        if (args.length < 3) throw new Error('clamp関数には3つの引数 clamp(n1, n2, n3) が必要です');
        const v1 = String(args[0]);
        const v2 = String(args[1]);
        const v3 = String(args[2]);
        const lo = compareCasicNumericSort(v2, v3) <= 0 ? v2 : v3;
        const hi = compareCasicNumericSort(v2, v3) <= 0 ? v3 : v2;
        if (compareCasicNumericSort(v1, lo) < 0) return lo;
        if (compareCasicNumericSort(v1, hi) > 0) return hi;
        return v1;
    }
    if (funcNameLower === 'dist') {
        if (args.length < 2) throw new Error('dist関数には少なくとも2つの引数 dist(n1, n2, [n3, n4]) が必要です');
        const x1 = parseCasicNumber(args[0]).num;
        const y1 = parseCasicNumber(args[1]).num;
        const x2 = (args.length >= 3 && cleanText(args[2]) !== '') ? parseCasicNumber(args[2]).num : 0;
        const y2 = (args.length >= 4 && cleanText(args[3]) !== '') ? parseCasicNumber(args[3]).num : 0;
        return formatCleanMathResult(Math.hypot(x2 - x1, y2 - y1));
    }
    if (funcNameLower === 'sin' || funcNameLower === 'cos' || funcNameLower === 'tan') {
        if (args.length < 1) throw new Error(funcNameLower + '関数には1つの引数（角度）が必要です');
        return executeTrigFunction(funcNameLower, args[0]);
    }
    if (funcNameLower === 'atan2') {
        if (args.length < 2) throw new Error('atan2関数には2つの引数 atan2(x, y) が必要です');
        const x = parseCasicNumber(args[0]).num;
        const y = parseCasicNumber(args[1]).num;
        const deg = Math.atan2(y, x) * (180 / Math.PI);
        return formatCleanMathResult(deg);
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
        if (args.length === 0) return {};
        const target = resolveArgAsCollectionOrValue(argResults[0]);

        if (args.length === 1) {
            const freqDict = {};
            if (Array.isArray(target)) {
                for (let i = 0; i < target.length; i++) {
                    const k = toDisplayString(target[i]);
                    freqDict[k] = String((Number(freqDict[k] || 0)) + 1);
                }
                return freqDict;
            }
            if (isPlainDictObject(target)) {
                const keys = Object.keys(target);
                for (let i = 0; i < keys.length; i++) {
                    const k = toDisplayString(target[keys[i]]);
                    freqDict[k] = String((Number(freqDict[k] || 0)) + 1);
                }
                return freqDict;
            }
            const chars = Array.from(toDisplayString(target));
            for (let i = 0; i < chars.length; i++) {
                const ch = chars[i];
                freqDict[ch] = String((Number(freqDict[ch] || 0)) + 1);
            }
            return freqDict;
        }

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
    if (funcNameLower === 'between_get') {
        return executeBetweenGetFunction(args);
    }
    if (funcNameLower === 'between_replace') {
        return executeBetweenReplaceFunction(args);
    }
    if (funcNameLower === 'between_list') {
        return executeBetweenListFunction(args);
    }
    if (funcNameLower === 'unescape') {
        return executeUnescapeFunction(args);
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
        const opStr = args.length >= 3 ? toDisplayString(args[2]) : '>=';
        return executeBinarySearchFunction(target, x, opStr);
    }

    // 9. 辞書・JSON・描画/音声初期辞書の関数
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
    if (funcNameLower === 'a_sound') {
        return {
            "vol": "1", "loop": "0", "pitch": "1",
            "pan": "0", "start": "0", "end": ""
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