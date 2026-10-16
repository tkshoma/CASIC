// ==========================================
// 1. 文字・識別子・数値判定ユーティリティ
// ==========================================
const CHAR_CARET = String.fromCharCode(94);    // ^
const CHAR_MUL_U = String.fromCharCode(0xD7);  // ×
const CHAR_DIV_U = String.fromCharCode(0xF7);  // ÷
const CHAR_FW_SP = String.fromCharCode(0x3000); // 全角スペース
const CHAR_BSLASH = String.fromCharCode(92);   // \

function isSpaceChar(ch) {
    if (!ch) return false;
    return ch === ' ' || ch === '\t' || ch === CHAR_FW_SP;
}

function isDefaultDelimChar(ch) {
    if (!ch) return false;
    return isSpaceChar(ch) || ch === '\n';
}

function isAsciiAlpha(ch) {
    if (!ch) return false;
    const c = ch.charCodeAt(0);
    return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

function isDigitChar(ch) {
    if (!ch) return false;
    const c = ch.charCodeAt(0);
    return c >= 48 && c <= 57;
}

function isReservedSymbolChar(ch) {
    if (!ch) return true;
    if (isSpaceChar(ch)) return true;
    const symbols = '+-*/%&|!<>=' + CHAR_CARET + CHAR_MUL_U + CHAR_DIV_U + '~()[]{}:,."' + "'" + '#' + CHAR_BSLASH + '$\r\n';
    return symbols.indexOf(ch) !== -1;
}

// 通常の識別子先頭文字（数字・_・$ は不可）
function isIdentStartChar(ch) {
    if (!ch) return false;
    if (isDigitChar(ch) || ch === '_' || ch === '$') return false;
    return !isReservedSymbolChar(ch);
}

// 変数名先頭文字（関数内ローカル変数用の先頭 _ も構文上許可し、実行時にスコープ検証する）
function isVarStartChar(ch) {
    if (!ch) return false;
    if (ch === '_') return true;
    return isIdentStartChar(ch);
}

// 2文字目以降の文字（_ と $ は先頭以外では使用不可）
function isIdentPartChar(ch) {
    if (!ch) return false;
    if (ch === '$' || ch === '_') return false;
    return !isReservedSymbolChar(ch);
}

// 関数名や引数名として有効な識別子か（先頭 _ は不可）
function isValidIdentifier(str) {
    if (!str || str.length === 0) return false;
    if (!isIdentStartChar(str[0])) return false;
    for (let i = 1; i < str.length; i++) {
        if (!isIdentPartChar(str[i])) return false;
    }
    return true;
}

// 変数名として有効な識別子か（先頭のみ _ 可、かつ _ 単体は不可）
function isValidVarIdentifier(str) {
    if (!str || str.length === 0) return false;
    if (str[0] === '_') {
        if (str.length < 2) return false;
        if (!isIdentStartChar(str[1]) && !isDigitChar(str[1])) return false;
        for (let i = 2; i < str.length; i++) {
            if (!isIdentPartChar(str[i])) return false;
        }
        return true;
    }
    return isValidIdentifier(str);
}

function isIntString(str) {
    if (!str) return false;
    let i = 0;
    if (str[0] === '+' || str[0] === '-') i++;
    if (i >= str.length) return false;
    for (; i < str.length; i++) {
        if (!isDigitChar(str[i])) return false;
    }
    return true;
}

function isBigIntString(str) {
    if (!str || str.length < 2) return false;
    const last = str[str.length - 1];
    if (last !== 'n' && last !== 'N') return false;
    return isIntString(str.slice(0, -1));
}

function isFloatString(str) {
    if (!str) return false;
    let i = 0;
    if (str[0] === '+' || str[0] === '-') i++;
    let dotCount = 0;
    let digitCount = 0;
    for (; i < str.length; i++) {
        if (str[i] === '.') {
            dotCount++;
            if (dotCount > 1) return false;
        } else if (isDigitChar(str[i])) {
            digitCount++;
        } else {
            return false;
        }
    }
    return dotCount === 1 && digitCount >= 1;
}

function isNumericLiteralString(str) {
    return isIntString(str) || isBigIntString(str) || isFloatString(str);
}

function cleanText(str) {
    const s = String(str);
    let out = '';
    for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        if (code === 0x200B || code === 0x200C || code === 0x200D || code === 0xFEFF) continue;
        out += s[i];
    }
    let start = 0;
    let end = out.length;
    while (start < end && isSpaceChar(out[start])) start++;
    while (end > start && isSpaceChar(out[end - 1])) end--;
    return out.slice(start, end);
}

function unescapeCasicString(str) {
    return String(str)
        .split(CHAR_BSLASH + 's').join(' ')
        .split(CHAR_BSLASH + 'n').join('\n')
        .split(CHAR_BSLASH + 't').join('\t')
        .split(CHAR_BSLASH + '"').join('"');
}

function xor32(a, b) {
    return (a | b) & ~(a & b);
}

function xorBig(a, b) {
    return (a | b) & ~(a & b);
}

// ==========================================
// 2. CASIC ランタイム状態（変数・配列・辞書・関数・コールスタック）
// ==========================================
const state = {
    vars: {},
    arrays: {},
    dicts: {},
    functions: {},      // 小文字の関数名 -> ユーザー定義関数オブジェクト
    callStack: [],      // 関数呼び出し中のローカルスコープスタック
    funcOutputBuffer: '', // 式の評価中に呼ばれた関数内で発生した out / put 出力の一時バッファ
    forStates: {},
    inputPtr: 0,
    rngSeed: null,
    stepEvaluateBranch: false,
    lastModified: null,
    pc: 0,
    totalSteps: 0,
    warnings: []
};

const COMMAND_KEYWORDS = new Set([
    'out', 'print', 'put',
    'in', 'charin', 'allin', 'resetin',
    'if', 'elseif', 'else', 'end', 'for', 'while', 'break',
    'go', 'to', 'fin', 'exit',
    'sort', 'dsort', 'rev',
    'push', 'ins', 'add', 'replace', 'del', 'clear', 'uniq',
    'seed', 'rename', 'stop', 'return', 'fun'
]);

// 組み込み関数名の一覧（ユーザー定義関数との重複禁止チェック用）
const BUILTIN_FUNCTION_NAMES = new Set([
    'check', 'charcheck', 'allcheck',
    'abs', 'not', 'sqrt', 'round', 'floor', 'ceil', 'trunc',
    'min', 'max', 'sum', 'gcd', 'lcm', 'base',
    'band', 'bor', 'bxor', 'bnot',
    'rand', 'rand.', 'hrand', 'hrand.', 'hash', 'md5', 'sha256',
    'big', 'num', 'str',
    'chr', 'ord', 'uni',
    'len', 'rev', 'sort', 'dsort', 'find', 'count', 'replace',
    'split', 'rep', 'trim', 'upper', 'lower', 'regex', 'if',
    'join', 'grid', 'flat', 'bs', 'uniq',
    'has', 'keys', 'json'
]);

const ASSIGN_OPS = ['/.=', '+=', '-=', '&=', '*=', '/=', '%=', '='];

function getCurrentCallFrame() {
    return state.callStack.length > 0 ? state.callStack[state.callStack.length - 1] : null;
}

// 変数名が現在の関数フレームのローカル対象（先頭 `_` または引数名）か判定
function resolveVarScope(rawName) {
    const key = cleanText(rawName).toLowerCase();
    const frame = getCurrentCallFrame();
    if (key.startsWith('_')) {
        if (!frame) {
            throw new Error('先頭に "_" がついたローカル変数 "' + rawName + '" は関数内でのみ使用できます');
        }
        return { isLocal: true, frame: frame, key: key };
    }
    if (frame && frame.paramSet.has(key)) {
        return { isLocal: true, frame: frame, key: key };
    }
    return { isLocal: false, frame: null, key: key };
}

function getVar(name) {
    const key = cleanText(name).toLowerCase();
    if (key === 'true') return "1";
    if (key === 'false') return "0";
    const scope = resolveVarScope(key);
    if (scope.isLocal) {
        return Object.prototype.hasOwnProperty.call(scope.frame.locals, scope.key) ? scope.frame.locals[scope.key] : "";
    }
    return Object.prototype.hasOwnProperty.call(state.vars, scope.key) ? state.vars[scope.key] : "";
}

function setVar(name, val) {
    const key = cleanText(name).toLowerCase();
    if (key === 'true' || key === 'false') return;
    const scope = resolveVarScope(key);
    if (scope.isLocal) {
        scope.frame.locals[scope.key] = String(val);
        return;
    }
    state.vars[scope.key] = String(val);
    state.lastModified = { kind: 'var', key: scope.key };
}

function stripArraySuffix(name) {
    const lower = cleanText(name).toLowerCase();
    return lower.endsWith('[]') ? lower.slice(0, -2) : lower;
}

function stripDictSuffix(name) {
    const lower = cleanText(name).toLowerCase();
    return lower.endsWith('{}') ? lower.slice(0, -2) : lower;
}

function resolveArrayStore(name) {
    const key = stripArraySuffix(name);
    if (key.startsWith('_')) {
        const frame = getCurrentCallFrame();
        if (!frame) {
            throw new Error('先頭に "_" がついたローカル配列 "' + name + '" は関数内でのみ使用できます');
        }
        return { isLocal: true, store: frame.localArrays, dictStore: frame.localDicts, key: key };
    }
    return { isLocal: false, store: state.arrays, dictStore: state.dicts, key: key };
}

function resolveDictStore(name) {
    const key = stripDictSuffix(name);
    if (key.startsWith('_')) {
        const frame = getCurrentCallFrame();
        if (!frame) {
            throw new Error('先頭に "_" がついたローカル辞書 "' + name + '" は関数内でのみ使用できます');
        }
        return { isLocal: true, store: frame.localDicts, arrStore: frame.localArrays, key: key };
    }
    return { isLocal: false, store: state.dicts, arrStore: state.arrays, key: key };
}

function hasArray(name) {
    const info = resolveArrayStore(name);
    return Object.prototype.hasOwnProperty.call(info.store, info.key);
}

function hasDict(name) {
    const info = resolveDictStore(name);
    return Object.prototype.hasOwnProperty.call(info.store, info.key);
}

function getArray(name) {
    const info = resolveArrayStore(name);
    return Object.prototype.hasOwnProperty.call(info.store, info.key) ? info.store[info.key] : [];
}

function cloneArrayDeep(arr) {
    if (!Array.isArray(arr)) return String(arr);
    return arr.map(cloneArrayDeep);
}

function setArray(name, arr) {
    const info = resolveArrayStore(name);
    if (Object.prototype.hasOwnProperty.call(info.dictStore, info.key)) {
        throw new Error('名前 "' + info.key + '" は既に辞書として使用されているため、配列名と重複できません');
    }
    info.store[info.key] = cloneArrayDeep(Array.isArray(arr) ? arr : [arr]);
    if (!info.isLocal) {
        state.lastModified = { kind: 'arr', key: info.key };
    }
}

function isPlainDictObject(val) {
    return val !== null && typeof val === 'object' && !Array.isArray(val);
}

function cloneDictDeep(dictObj) {
    const out = {};
    if (!isPlainDictObject(dictObj)) return out;
    const keys = Object.keys(dictObj);
    for (let i = 0; i < keys.length; i++) {
        const k = String(keys[i]);
        const v = dictObj[k];
        if (Array.isArray(v)) out[k] = cloneArrayDeep(v);
        else if (isPlainDictObject(v)) out[k] = cloneDictDeep(v);
        else out[k] = String(v);
    }
    return out;
}

function getDict(name) {
    const info = resolveDictStore(name);
    return Object.prototype.hasOwnProperty.call(info.store, info.key) ? info.store[info.key] : null;
}

function setDict(name, dictObj) {
    const info = resolveDictStore(name);
    if (Object.prototype.hasOwnProperty.call(info.arrStore, info.key)) {
        throw new Error('名前 "' + info.key + '" は既に配列として使用されているため、辞書名と重複できません');
    }
    info.store[info.key] = cloneDictDeep(dictObj);
    if (!info.isLocal) {
        state.lastModified = { kind: 'dict', key: info.key };
    }
}

// ==========================================
// 2.5 入力データ読み取り・乱数・ハッシュヘルパー
// ==========================================

function getRawInputString() {
    const el = document.getElementById('input-data');
    if (!el) return '';
    return String(el.value).split('\r\n').join('\n');
}

function readNextInputToken(customSep, advancePtr) {
    const text = getRawInputString();
    let pos = state.inputPtr;

    if (pos >= text.length) {
        return { token: "", eof: true };
    }

    if (customSep === null || customSep === undefined) {
        while (pos < text.length && isDefaultDelimChar(text[pos])) {
            pos++;
        }
        if (pos >= text.length) {
            if (advancePtr) state.inputPtr = text.length;
            return { token: "", eof: true };
        }
        const start = pos;
        while (pos < text.length && !isDefaultDelimChar(text[pos])) {
            pos++;
        }
        const token = text.slice(start, pos);
        if (advancePtr) {
            state.inputPtr = (pos < text.length) ? (pos + 1) : pos;
        }
        return { token: token, eof: false };
    }

    const sep = String(customSep);
    if (sep === '') {
        const chars = Array.from(text.slice(pos));
        if (chars.length === 0) return { token: "", eof: true };
        const firstChar = chars[0];
        if (advancePtr) state.inputPtr = pos + firstChar.length;
        return { token: firstChar, eof: false };
    }

    const idx = text.indexOf(sep, pos);
    if (idx !== -1) {
        const token = text.slice(pos, idx);
        if (advancePtr) {
            state.inputPtr = idx + sep.length;
        }
        return { token: token, eof: false };
    } else {
        const token = text.slice(pos);
        if (advancePtr) {
            state.inputPtr = text.length;
        }
        return { token: token, eof: false };
    }
}

function readInputChars(nChars, advancePtr) {
    const text = getRawInputString();
    const pos = state.inputPtr;
    if (pos >= text.length || nChars <= 0) {
        return "";
    }
    const restChars = Array.from(text.slice(pos));
    const slicedChars = restChars.slice(0, nChars);
    const resultStr = slicedChars.join('');
    if (advancePtr) {
        state.inputPtr = pos + resultStr.length;
    }
    return resultStr;
}

function readRemainingInput() {
    const text = getRawInputString();
    if (state.inputPtr >= text.length) return "";
    return text.slice(state.inputPtr);
}

function nextRandomFloat01() {
    if (state.rngSeed === null) {
        return Math.random();
    }
    let t = (state.rngSeed + 0x6D2B79F5) | 0;
    state.rngSeed = t;
    t = Math.imul(xor32(t, t >>> 15), t | 1);
    t = (t + Math.imul(xor32(t, t >>> 7), t | 61)) | 0;
    return (xor32(t, t >>> 14) >>> 0) / 4294967296;
}

function computeHash64BigInt(str) {
    const bytes = new TextEncoder().encode(String(str));
    let h = 14695981039346656037n;
    const prime = 1099511628211n;
    const mask64 = 18446744073709551615n;
    for (let i = 0; i < bytes.length; i++) {
        h = xorBig(h, BigInt(bytes[i]));
        h = (h * prime) & mask64;
    }
    h = xorBig(h, h >> 30n);
    h = (h * 13787848793156543929n) & mask64;
    h = xorBig(h, h >> 27n);
    h = (h * 10723151780598845931n) & mask64;
    h = xorBig(h, h >> 31n);
    return h;
}

function hashRandomFloat01(str) {
    const h = computeHash64BigInt(str);
    const top53 = Number(h >> 11n);
    return top53 / 9007199254740992;
}

function computeMd5Hex(str) {
    const bytes = new TextEncoder().encode(String(str));
    const bitLen = bytes.length * 8;
    const padLen = (((bytes.length + 8) >>> 6) + 1) << 6;
    const buf = new Uint8Array(padLen);
    buf.set(bytes);
    buf[bytes.length] = 0x80;
    const view = new DataView(buf.buffer);
    view.setUint32(padLen - 8, bitLen >>> 0, true);
    view.setUint32(padLen - 4, Math.floor(bitLen / 4294967296) >>> 0, true);

    const K = new Uint32Array(64);
    for (let i = 0; i < 64; i++) {
        K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
    }
    const S = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
        5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20,
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
    ];

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;

    for (let offset = 0; offset < padLen; offset += 64) {
        let A = a0, B = b0, C = c0, D = d0;
        for (let i = 0; i < 64; i++) {
            let F = 0, g = 0;
            if (i < 16) {
                F = (B & C) | (~B & D);
                g = i;
            } else if (i < 32) {
                F = (D & B) | (~D & C);
                g = (5 * i + 1) % 16;
            } else if (i < 48) {
                F = xor32(xor32(B, C), D);
                g = (3 * i + 5) % 16;
            } else {
                F = xor32(C, B | ~D);
                g = (7 * i) % 16;
            }
            const M = view.getUint32(offset + g * 4, true);
            F = (F + A + K[i] + M) | 0;
            A = D;
            D = C;
            C = B;
            const rotated = (F << S[i]) | (F >>> (32 - S[i]));
            B = (B + rotated) | 0;
        }
        a0 = (a0 + A) | 0;
        b0 = (b0 + B) | 0;
        c0 = (c0 + C) | 0;
        d0 = (d0 + D) | 0;
    }

    const outBuf = new ArrayBuffer(16);
    const outView = new DataView(outBuf);
    outView.setUint32(0, a0, true);
    outView.setUint32(4, b0, true);
    outView.setUint32(8, c0, true);
    outView.setUint32(12, d0, true);
    const outBytes = new Uint8Array(outBuf);
    let hex = '';
    for (let i = 0; i < 16; i++) {
        hex += outBytes[i].toString(16).padStart(2, '0');
    }
    return hex;
}

function computeSha256Hex(str) {
    const bytes = new TextEncoder().encode(String(str));
    const bitLen = bytes.length * 8;
    const padLen = (((bytes.length + 8) >>> 6) + 1) << 6;
    const buf = new Uint8Array(padLen);
    buf.set(bytes);
    buf[bytes.length] = 0x80;
    const view = new DataView(buf.buffer);
    view.setUint32(padLen - 8, Math.floor(bitLen / 4294967296) >>> 0, false);
    view.setUint32(padLen - 4, bitLen >>> 0, false);

    const K = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];

    const H = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];

    function rotr(n, x) {
        return (x >>> n) | (x << (32 - n));
    }

    const W = new Uint32Array(64);

    for (let offset = 0; offset < padLen; offset += 64) {
        for (let i = 0; i < 16; i++) {
            W[i] = view.getUint32(offset + i * 4, false);
        }
        for (let i = 16; i < 64; i++) {
            const s0 = xor32(xor32(rotr(7, W[i - 15]), rotr(18, W[i - 15])), W[i - 15] >>> 3);
            const s1 = xor32(xor32(rotr(17, W[i - 2]), rotr(19, W[i - 2])), W[i - 2] >>> 10);
            W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
        }

        let a = H[0], b = H[1], c = H[2], d = H[3];
        let e = H[4], f = H[5], g = H[6], h = H[7];

        for (let i = 0; i < 64; i++) {
            const S1 = xor32(xor32(rotr(6, e), rotr(11, e)), rotr(25, e));
            const ch = xor32(e & f, ~e & g);
            const temp1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
            const S0 = xor32(xor32(rotr(2, a), rotr(13, a)), rotr(22, a));
            const maj = xor32(xor32(a & b, a & c), b & c);
            const temp2 = (S0 + maj) >>> 0;

            h = g;
            g = f;
            f = e;
            e = (d + temp1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) >>> 0;
        }

        H[0] = (H[0] + a) >>> 0;
        H[1] = (H[1] + b) >>> 0;
        H[2] = (H[2] + c) >>> 0;
        H[3] = (H[3] + d) >>> 0;
        H[4] = (H[4] + e) >>> 0;
        H[5] = (H[5] + f) >>> 0;
        H[6] = (H[6] + g) >>> 0;
        H[7] = (H[7] + h) >>> 0;
    }

    let hex = '';
    for (let i = 0; i < 8; i++) {
        hex += H[i].toString(16).padStart(8, '0');
    }
    return hex;
}

// ==========================================
// 3. 配列・辞書フォーマット & 数値演算ヘルパー
// ==========================================

function formatFloatStorage(num) {
    if (!Number.isFinite(num)) return String(num);
    if (Math.floor(num) === num) {
        return String(num) + '.0';
    }
    return String(num);
}

function formatDictAsJsonString(dictObj) {
    if (!isPlainDictObject(dictObj)) return "{}";
    const keys = Object.keys(dictObj);
    const pairs = keys.map(function(k) {
        const keyEsc = String(k).split('"').join(CHAR_BSLASH + '"');
        const val = dictObj[k];
        let valStr = '';
        if (Array.isArray(val)) {
            valStr = formatArrayAsCasicString(val);
        } else if (isPlainDictObject(val)) {
            valStr = formatDictAsJsonString(val);
        } else {
            const s = String(val);
            if (isNumericLiteralString(s)) {
                valStr = toDisplayString(s);
            } else {
                valStr = '"' + s.split('"').join(CHAR_BSLASH + '"') + '"';
            }
        }
        return '"' + keyEsc + '":' + valStr;
    });
    return '{' + pairs.join(',') + '}';
}

function toDisplayString(val) {
    if (Array.isArray(val)) {
        return val.map(toDisplayString).join(' ');
    }
    if (isPlainDictObject(val)) {
        return formatDictAsJsonString(val);
    }
    const s = String(val);
    if (isBigIntString(s)) {
        return s.slice(0, -1);
    }
    if (isFloatString(s)) {
        const n = Number(s);
        if (Number.isFinite(n) && Math.floor(n) === n) {
            return String(Math.trunc(n));
        }
    }
    return s;
}

function formatArrayAsCasicString(arr) {
    if (!Array.isArray(arr)) {
        if (isPlainDictObject(arr)) return formatDictAsJsonString(arr);
        const s = toDisplayString(arr);
        if (isNumericLiteralString(s)) return s;
        return '"' + s.split('"').join(CHAR_BSLASH + '"') + '"';
    }
    const parts = arr.map(function(el) {
        if (Array.isArray(el)) {
            return formatArrayAsCasicString(el);
        }
        if (isPlainDictObject(el)) {
            return formatDictAsJsonString(el);
        }
        const s = String(el);
        if (isNumericLiteralString(s)) {
            return toDisplayString(s);
        }
        return '"' + s.split('"').join(CHAR_BSLASH + '"') + '"';
    });
    return '[' + parts.join(',') + ']';
}

function parseCasicArrayLiteralString(rawStr) {
    const s = cleanText(rawStr);
    if (!s.startsWith('[') || !s.endsWith(']')) {
        return [s];
    }
    const inner = cleanText(s.slice(1, -1));
    if (inner === '') return [];
    const parts = splitTopLevelComma(inner);
    return parts.map(function(part) {
        const p = cleanText(part);
        if (p === '') return "";
        if (p.startsWith('[') && p.endsWith(']')) {
            return parseCasicArrayLiteralString(p);
        }
        if (p.startsWith('$')) {
            const exprPart = cleanText(p.slice(1));
            if (exprPart === '') return "";
            const evaluated = evaluateExpression(exprPart);
            return Array.isArray(evaluated) ? cloneArrayDeep(evaluated) : String(evaluated);
        }
        if (p.startsWith('"') && p.endsWith('"') && p.length >= 2) {
            return unescapeCasicString(p.slice(1, -1));
        }
        if (p.startsWith('/')) {
            return unescapeCasicString(p.slice(1));
        }
        return unescapeCasicString(p);
    });
}

function coerceToArray(val) {
    if (Array.isArray(val)) return cloneArrayDeep(val);
    const s = cleanText(val);
    if (s === '') return [];
    if (s.startsWith('[') && s.endsWith(']')) {
        return parseCasicArrayLiteralString(s);
    }
    return [String(val)];
}

function parseCasicJsonToDict(rawVal) {
    if (isPlainDictObject(rawVal)) {
        return { dict: cloneDictDeep(rawVal), valid: true };
    }
    const s = cleanText(rawVal);
    if (s === '' || s === '{}') {
        return { dict: {}, valid: true };
    }
    try {
        const parsed = JSON.parse(s);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const normalized = {};
            const keys = Object.keys(parsed);
            for (let i = 0; i < keys.length; i++) {
                const k = String(keys[i]);
                const v = parsed[k];
                if (Array.isArray(v)) {
                    normalized[k] = v.map(function(x) { return String(x); });
                } else if (v !== null && typeof v === 'object') {
                    normalized[k] = cloneDictDeep(v);
                } else {
                    normalized[k] = String(v);
                }
            }
            return { dict: normalized, valid: true };
        }
    } catch (e) {
    }
    return { dict: {}, valid: false };
}

function parseCasicNumber(rawVal) {
    if (Array.isArray(rawVal) || isPlainDictObject(rawVal)) {
        return { kind: 'int', rank: 1, num: 0, big: 0n, isValidNum: false };
    }
    const s = cleanText(rawVal);
    if (s.toLowerCase() === 'true') {
        return { kind: 'int', rank: 1, num: 1, big: 1n, isValidNum: true };
    }
    if (s === '' || s.toLowerCase() === 'false') {
        return { kind: 'int', rank: 1, num: 0, big: 0n, isValidNum: (s.toLowerCase() === 'false') };
    }
    if (isBigIntString(s)) {
        const b = BigInt(s.slice(0, -1));
        return { kind: 'bigint', rank: 2, num: Number(b), big: b, isValidNum: true };
    }
    if (isIntString(s)) {
        const n = Number(s);
        return { kind: 'int', rank: 1, num: n, big: BigInt(s), isValidNum: true };
    }
    if (isFloatString(s)) {
        const f = Number(s);
        const b = Number.isFinite(f) ? BigInt(Math.trunc(f)) : 0n;
        return { kind: 'float', rank: 3, num: f, big: b, isValidNum: true };
    }
    return { kind: 'int', rank: 1, num: 0, big: 0n, isValidNum: false };
}

function isCasicTruthy(val) {
    const parsed = parseCasicNumber(val);
    if (parsed.kind === 'bigint') {
        return parsed.big !== 0n;
    }
    return parsed.num !== 0;
}

function bigIntPow(base, exp) {
    if (exp < 0n) return 0n;
    let result = 1n;
    let b = base;
    let e = exp;
    while (e > 0n) {
        if ((e & 1n) === 1n) result *= b;
        b *= b;
        e >>= 1n;
    }
    return result;
}

function bigIntGcd(a, b) {
    let x = a < 0n ? -a : a;
    let y = b < 0n ? -b : b;
    while (y !== 0n) {
        const t = x % y;
        x = y;
        y = t;
    }
    return x;
}

function bigIntLcm(a, b) {
    if (a === 0n || b === 0n) return 0n;
    const x = a < 0n ? -a : a;
    const y = b < 0n ? -b : b;
    return (x / bigIntGcd(x, y)) * y;
}

function applyRoundingFunction(mode, n1Val, n2Val) {
    const p1 = parseCasicNumber(n1Val);
    const x = p1.num;
    const n2 = (n2Val === undefined || n2Val === null || cleanText(n2Val) === '')
        ? 0
        : Math.trunc(parseCasicNumber(n2Val).num);

    const factor = Math.pow(10, -n2);
    const scaled = x * factor;
    const cleanScaled = Number(scaled.toPrecision(14));

    let roundedScaled = 0;
    if (mode === 'round') {
        roundedScaled = (cleanScaled < 0) ? -Math.round(-cleanScaled) : Math.round(cleanScaled);
    } else if (mode === 'floor') {
        roundedScaled = Math.floor(cleanScaled);
    } else if (mode === 'ceil') {
        roundedScaled = Math.ceil(cleanScaled);
    } else if (mode === 'trunc') {
        roundedScaled = Math.trunc(cleanScaled);
    }

    if (n2 >= 0) {
        const resInt = Math.round(roundedScaled / factor);
        return String(resInt);
    } else {
        const digits = Math.min(20, -n2);
        const resFloat = Number((roundedScaled / factor).toFixed(digits));
        return String(resFloat);
    }
}

function convertBaseCasic(n1Raw, fromRadix, toRadix) {
    const rFrom = Math.trunc(fromRadix);
    const rTo = Math.trunc(toRadix);
    if (rFrom < 2 || rFrom > 36 || rTo < 2 || rTo > 36) {
        throw new Error('base関数の基数には 2〜36 の整数を指定してください');
    }

    let str = cleanText(toDisplayString(n1Raw)).toUpperCase();
    if (str === '') return "0";

    let isNeg = false;
    if (str[0] === '-') {
        isNeg = true;
        str = str.slice(1);
    } else if (str[0] === '+') {
        str = str.slice(1);
    }

    const digits = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let val = 0n;
    const bigFrom = BigInt(rFrom);

    for (let i = 0; i < str.length; i++) {
        const idx = digits.indexOf(str[i]);
        if (idx === -1 || idx >= rFrom) {
            throw new Error('base関数: "' + str + '" は ' + rFrom + ' 進数として無効な文字を含んでいます');
        }
        val = val * bigFrom + BigInt(idx);
    }

    if (val === 0n) return "0";

    const bigTo = BigInt(rTo);
    let out = '';
    while (val > 0n) {
        const rem = Number(val % bigTo);
        out = digits[rem] + out;
        val = val / bigTo;
    }
    return isNeg ? ('-' + out) : out;
}

function applyNumericBinaryOp(leftStr, rightStr, op) {
    const L = parseCasicNumber(leftStr);
    const R = parseCasicNumber(rightStr);

    if (op === '/.') {
        if (R.num === 0) throw new Error('0による除算です');
        return formatFloatStorage(L.num / R.num);
    }

    if (op === '<<' || op === '>>') {
        const shiftAmount = R.big;
        const resBig = (op === '<<') ? (L.big << shiftAmount) : (L.big >> shiftAmount);
        if (L.rank === 2 || R.rank === 2) {
            return resBig.toString() + 'n';
        }
        return String(Number(resBig));
    }

    const maxRank = Math.max(L.rank, R.rank);

    if (op === '/') {
        if (maxRank === 2) {
            if (R.big === 0n) throw new Error('0による除算です');
            return (L.big / R.big).toString() + 'n';
        }
        if (R.num === 0) throw new Error('0による除算です');
        const truncated = Math.trunc(L.num / R.num);
        return String(truncated);
    }

    if (maxRank === 3) {
        const a = L.num;
        const b = R.num;
        if (op === '+') return formatFloatStorage(a + b);
        if (op === '-') return formatFloatStorage(a - b);
        if (op === '*') return formatFloatStorage(a * b);
        if (op === '^') return formatFloatStorage(Math.pow(a, b));
        if (op === '%') {
            if (b === 0) throw new Error('0による剰余です');
            const absB = Math.abs(b);
            return formatFloatStorage(((a % absB) + absB) % absB);
        }
    }

    if (maxRank === 2) {
        const a = L.big;
        const b = R.big;
        if (op === '+') return (a + b).toString() + 'n';
        if (op === '-') return (a - b).toString() + 'n';
        if (op === '*') return (a * b).toString() + 'n';
        if (op === '^') return bigIntPow(a, b).toString() + 'n';
        if (op === '%') {
            if (b === 0n) throw new Error('0による剰余です');
            const absB = b < 0n ? -b : b;
            return (((a % absB) + absB) % absB).toString() + 'n';
        }
    }

    const a = L.num;
    const b = R.num;
    if (op === '+') return String(a + b);
    if (op === '-') return String(a - b);
    if (op === '*') return String(a * b);
    if (op === '^') {
        const p = Math.pow(a, b);
        return (b < 0) ? formatFloatStorage(p) : String(Math.trunc(p));
    }
    if (op === '%') {
        if (b === 0) throw new Error('0による剰余です');
        const absB = Math.abs(b);
        return String(((a % absB) + absB) % absB);
    }

    return "0";
}

function applyRelationalOp(leftVal, rightVal, op) {
    const L = parseCasicNumber(leftVal);
    const R = parseCasicNumber(rightVal);
    let res = false;
    if (L.rank === 2 && R.rank === 2) {
        if (op === '<') res = L.big < R.big;
        else if (op === '<=') res = L.big <= R.big;
        else if (op === '>') res = L.big > R.big;
        else if (op === '>=') res = L.big >= R.big;
    } else {
        if (op === '<') res = L.num < R.num;
        else if (op === '<=') res = L.num <= R.num;
        else if (op === '>') res = L.num > R.num;
        else if (op === '>=') res = L.num >= R.num;
    }
    return res ? "1" : "0";
}

function areCasicValuesEqual(v1, v2) {
    if (Array.isArray(v1) || Array.isArray(v2) || isPlainDictObject(v1) || isPlainDictObject(v2)) {
        return JSON.stringify(v1) === JSON.stringify(v2);
    }
    const s1 = String(v1);
    const s2 = String(v2);
    if (isNumericLiteralString(s1) && isNumericLiteralString(s2)) {
        const n1 = parseCasicNumber(s1);
        const n2 = parseCasicNumber(s2);
        if (n1.rank === 2 && n2.rank === 2) return n1.big === n2.big;
        return n1.num === n2.num;
    }
    return toDisplayString(s1) === toDisplayString(s2);
}

function applyEqualityOp(leftNodeResult, rightNodeResult, op) {
    const lVal = leftNodeResult.value;
    const rVal = rightNodeResult.value;
    const lIsTrueSpecial = leftNodeResult.isTrueSpecial === true;
    const rIsTrueSpecial = rightNodeResult.isTrueSpecial === true;

    let isEq = false;

    if (lIsTrueSpecial && !rIsTrueSpecial) {
        isEq = isCasicTruthy(rVal);
    } else if (rIsTrueSpecial && !lIsTrueSpecial) {
        isEq = isCasicTruthy(lVal);
    } else if (lIsTrueSpecial && rIsTrueSpecial) {
        isEq = true;
    } else {
        isEq = areCasicValuesEqual(lVal, rVal);
    }

    if (op === '!=' || op === '<>') {
        return isEq ? "0" : "1";
    }
    return isEq ? "1" : "0";
}

function compareCasicNumericSort(a, b) {
    const sa = Array.isArray(a) ? formatArrayAsCasicString(a) : String(a);
    const sb = Array.isArray(b) ? formatArrayAsCasicString(b) : String(b);

    const catA = (sa === '') ? 3 : (isNumericLiteralString(sa) ? 1 : 2);
    const catB = (sb === '') ? 3 : (isNumericLiteralString(sb) ? 1 : 2);
    if (catA !== catB) return catA - catB;

    if (catA === 1) {
        const na = parseCasicNumber(sa);
        const nb = parseCasicNumber(sb);
        if (na.rank === 2 && nb.rank === 2) {
            return na.big < nb.big ? -1 : (na.big > nb.big ? 1 : 0);
        }
        return na.num < nb.num ? -1 : (na.num > nb.num ? 1 : 0);
    }
    if (catA === 2) {
        return sa < sb ? -1 : (sa > sb ? 1 : 0);
    }
    return 0;
}

function compareCasicDictSort(a, b) {
    const sa = Array.isArray(a) ? formatArrayAsCasicString(a) : toDisplayString(a);
    const sb = Array.isArray(b) ? formatArrayAsCasicString(b) : toDisplayString(b);

    if (sa === '' && sb === '') return 0;
    if (sa === '') return 1;
    if (sb === '') return -1;
    return sa < sb ? -1 : (sa > sb ? 1 : 0);
}

// ==========================================
// 4. コメント除去・行分割・カンマ分割ヘルパー
// ==========================================

function isSlashStringStartInLine(str, index) {
    let j = index - 1;
    while (j >= 0 && isSpaceChar(str[j])) {
        j--;
    }
    if (j < 0) return true;
    const prev = str[j];
    return prev === '(' || prev === '[' || prev === '{' || prev === ',' ||
           prev === '=' || prev === '<' || prev === '>' || prev === '!' ||
           prev === '&' || prev === '|' || prev === '+' || prev === '-' ||
           prev === '*' || prev === CHAR_CARET || prev === CHAR_MUL_U || prev === ':';
}

function findSlashStringEnd(str, slashIndex) {
    let i = slashIndex + 1;
    while (i < str.length) {
        const ch = str[i];
        if (isSpaceChar(ch) || ch === ',' || ch === ':' ||
            ch === '(' || ch === ')' || ch === '[' || ch === ']' || ch === '{' || ch === '}') {
            break;
        }
        i++;
    }
    return i;
}

function stripLineComment(line) {
    let inQuotes = false;
    let i = 0;
    while (i < line.length) {
        const ch = line[i];
        if (ch === '"' && line[i - 1] !== CHAR_BSLASH) {
            inQuotes = !inQuotes;
            i++;
            continue;
        }
        if (!inQuotes) {
            if (ch === '/' && isSlashStringStartInLine(line, i)) {
                if (line[i + 1] !== '=' && line[i + 1] !== '.') {
                    i = findSlashStringEnd(line, i);
                    continue;
                }
            }
            if (ch === '#' || ch === "'") {
                return line.slice(0, i);
            }
        }
        i++;
    }
    return line;
}

function splitStatementsByColon(line) {
    const uncommented = stripLineComment(line);
    const statements = [];
    let current = '';
    let inQuotes = false;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;

    for (let i = 0; i < uncommented.length; i++) {
        const ch = uncommented[i];
        if (ch === '"' && uncommented[i - 1] !== CHAR_BSLASH) {
            inQuotes = !inQuotes;
            current += ch;
            continue;
        }
        if (!inQuotes) {
            if (ch === '(') parenDepth++;
            else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
            else if (ch === '[') bracketDepth++;
            else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);
            else if (ch === '{') braceDepth++;
            else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);

            if (ch === ':' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
                if (cleanText(current) !== '') {
                    statements.push(cleanText(current));
                }
                current = '';
                continue;
            }
        }
        current += ch;
    }
    if (cleanText(current) !== '') {
        statements.push(cleanText(current));
    }
    return statements;
}

function splitTopLevelComma(str) {
    const items = [];
    let current = '';
    let inQuotes = false;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;

    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (ch === '"' && str[i - 1] !== CHAR_BSLASH) {
            inQuotes = !inQuotes;
            current += ch;
            continue;
        }
        if (!inQuotes) {
            if (ch === '(') parenDepth++;
            else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
            else if (ch === '[') bracketDepth++;
            else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);
            else if (ch === '{') braceDepth++;
            else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);

            if (ch === ',' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
                items.push(cleanText(current));
                current = '';
                continue;
            }
        }
        current += ch;
    }
    if (cleanText(current) !== '' || str.includes(',')) {
        items.push(cleanText(current));
    }
    return items;
}

function extractParenHead(str) {
    const s = cleanText(str);
    if (!s.startsWith('(')) return null;

    let depth = 0;
    let inQuotes = false;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '"' && s[i - 1] !== CHAR_BSLASH) {
            inQuotes = !inQuotes;
            continue;
        }
        if (!inQuotes) {
            if (ch === '/' && isSlashStringStartInLine(s, i)) {
                if (s[i + 1] !== '=' && s[i + 1] !== '.') {
                    i = findSlashStringEnd(s, i) - 1;
                    continue;
                }
            }
            if (ch === '(') depth++;
            else if (ch === ')') {
                depth--;
                if (depth === 0) {
                    return {
                        inside: cleanText(s.slice(1, i)),
                        after: cleanText(s.slice(i + 1))
                    };
                }
            }
        }
    }
    return null;
}

// ==========================================
// 5. 式のトークナイザ & 再帰下降パーサ（処理順 1〜14 + 全関数）
// ==========================================

function tokenizeExpression(exprStr) {
    const tokens = [];
    let i = 0;
    const len = exprStr.length;
    let afterValue = false;

    while (i < len) {
        const ch = exprStr[i];

        if (isSpaceChar(ch)) {
            i++;
            continue;
        }

        if (ch === '"') {
            let end = i + 1;
            while (end < len && !(exprStr[end] === '"' && exprStr[end - 1] !== CHAR_BSLASH)) {
                end++;
            }
            const rawStr = exprStr.slice(i + 1, end);
            const unescaped = unescapeCasicString(rawStr);
            tokens.push({
                type: 'STRING',
                value: unescaped,
                isTrueLiteral: (rawStr.toLowerCase() === 'true')
            });
            i = (end < len) ? end + 1 : len;
            afterValue = true;
            continue;
        }

        if (ch === '[' && !afterValue) {
            let depth = 0;
            let inQ = false;
            let end = i;
            while (end < len) {
                const c = exprStr[end];
                if (c === '"' && exprStr[end - 1] !== CHAR_BSLASH) {
                    inQ = !inQ;
                } else if (!inQ) {
                    if (c === '[') depth++;
                    else if (c === ']') {
                        depth--;
                        if (depth === 0) break;
                    }
                }
                end++;
            }
            if (end >= len) {
                throw new Error('配列リテラルに対応する "]" がありません');
            }
            const rawArrStr = exprStr.slice(i, end + 1);
            tokens.push({
                type: 'ARRAY_LITERAL',
                value: parseCasicArrayLiteralString(rawArrStr)
            });
            i = end + 1;
            afterValue = true;
            continue;
        }

        if (ch === '{' && !afterValue) {
            let depth = 0;
            let inQ = false;
            let end = i;
            while (end < len) {
                const c = exprStr[end];
                if (c === '"' && exprStr[end - 1] !== CHAR_BSLASH) {
                    inQ = !inQ;
                } else if (!inQ) {
                    if (c === '{') depth++;
                    else if (c === '}') {
                        depth--;
                        if (depth === 0) break;
                    }
                }
                end++;
            }
            if (end >= len) {
                throw new Error('JSONリテラルに対応する "}" がありません');
            }
            const rawJsonStr = exprStr.slice(i, end + 1);
            tokens.push({
                type: 'JSON_LITERAL',
                raw: rawJsonStr
            });
            i = end + 1;
            afterValue = true;
            continue;
        }

        if (ch === '/') {
            if (afterValue) {
                if (exprStr[i + 1] === '.') {
                    tokens.push({ type: 'OP', value: '/.' });
                    i += 2;
                } else {
                    tokens.push({ type: 'OP', value: '/' });
                    i += 1;
                }
                afterValue = false;
                continue;
            } else {
                const end = findSlashStringEnd(exprStr, i);
                const rawSlash = exprStr.slice(i + 1, end);
                const unescaped = unescapeCasicString(rawSlash);
                tokens.push({
                    type: 'STRING',
                    value: unescaped,
                    isTrueLiteral: (rawSlash.toLowerCase() === 'true')
                });
                i = end;
                afterValue = true;
                continue;
            }
        }

        if (ch === CHAR_BSLASH) {
            const nextCh = exprStr[i + 1];
            if (nextCh === 's') {
                tokens.push({ type: 'STRING', value: ' ', isTrueLiteral: false });
                i += 2;
                afterValue = true;
                continue;
            }
            if (nextCh === 'n') {
                tokens.push({ type: 'STRING', value: '\n', isTrueLiteral: false });
                i += 2;
                afterValue = true;
                continue;
            }
            if (nextCh === 't') {
                tokens.push({ type: 'STRING', value: '\t', isTrueLiteral: false });
                i += 2;
                afterValue = true;
                continue;
            }
        }

        if (ch === '(' || ch === '[' || ch === '{') {
            tokens.push({ type: 'PUNC', value: ch });
            i++;
            afterValue = false;
            continue;
        }
        if (ch === ')' || ch === ']' || ch === '}') {
            tokens.push({ type: 'PUNC', value: ch });
            i++;
            afterValue = true;
            continue;
        }
        if (ch === ',' || ch === ':') {
            tokens.push({ type: 'PUNC', value: ch });
            i++;
            afterValue = false;
            continue;
        }

        const twoChars = exprStr.slice(i, i + 2);
        if (twoChars === '**') {
            tokens.push({ type: 'OP', value: '**' });
            i += 2;
            afterValue = false;
            continue;
        }
        if (twoChars === CHAR_DIV_U + '.') {
            tokens.push({ type: 'OP', value: '/.' });
            i += 2;
            afterValue = false;
            continue;
        }
        if (twoChars === '<<' || twoChars === '>>' ||
            twoChars === '<=' || twoChars === '>=' ||
            twoChars === '==' || twoChars === '!=' || twoChars === '<>' ||
            twoChars === '&&' || twoChars === '||' || twoChars === CHAR_CARET + CHAR_CARET) {
            const normOp = (twoChars === CHAR_CARET + CHAR_CARET) ? '^^' : twoChars;
            tokens.push({ type: 'OP', value: normOp });
            i += 2;
            afterValue = false;
            continue;
        }

        if (ch === CHAR_CARET) {
            tokens.push({ type: 'OP', value: '^' });
            i++;
            afterValue = false;
            continue;
        }
        if (ch === '*' || ch === CHAR_MUL_U) {
            tokens.push({ type: 'OP', value: '*' });
            i++;
            afterValue = false;
            continue;
        }
        if (ch === CHAR_DIV_U) {
            tokens.push({ type: 'OP', value: '/' });
            i++;
            afterValue = false;
            continue;
        }
        if (ch === '%' || ch === '+' || ch === '-' || ch === '&' ||
            ch === '~' || ch === '!' || ch === '<' || ch === '>' || ch === '=') {
            tokens.push({ type: 'OP', value: ch });
            i++;
            afterValue = false;
            continue;
        }

        if (isDigitChar(ch) || (ch === '.' && isDigitChar(exprStr[i + 1]))) {
            let end = i;
            let hasDot = false;
            while (end < len) {
                if (isDigitChar(exprStr[end])) {
                    end++;
                } else if (exprStr[end] === '.' && !hasDot) {
                    hasDot = true;
                    end++;
                } else {
                    break;
                }
            }
            if (!hasDot && (exprStr[end] === 'n' || exprStr[end] === 'N')) {
                end++;
            }
            const numStr = exprStr.slice(i, end);
            tokens.push({ type: 'NUMBER', value: numStr });
            i = end;
            afterValue = true;
            continue;
        }

        // 識別子（関数内ローカル変数 `_x` のため先頭 `_` もトークンとして切り出す）
        if (isVarStartChar(ch)) {
            let end = i + 1;
            while (end < len && isIdentPartChar(exprStr[end])) {
                end++;
            }
            let word = exprStr.slice(i, end);
            let lower = word.toLowerCase();

            if (word === '_') {
                throw new Error('"_" 単体を変数名として使用することはできません');
            }

            if (exprStr[end] === '.') {
                let look = end + 1;
                while (look < len && isSpaceChar(exprStr[look])) look++;
                if (exprStr[look] === '(' && (lower === 'rand' || lower === 'hrand')) {
                    word = word + '.';
                    lower = lower + '.';
                    end = end + 1;
                }
            }

            const prevHasSpace = (i > 0 && isSpaceChar(exprStr[i - 1]));
            const nextHasSpace = (end < len && isSpaceChar(exprStr[end]));
            if ((lower === 'and' || lower === 'xor' || lower === 'or') && prevHasSpace && nextHasSpace) {
                const opMap = { 'and': '&&', 'xor': '^^', 'or': '||' };
                tokens.push({ type: 'OP', value: opMap[lower] });
                i = end;
                afterValue = false;
                continue;
            }

            tokens.push({ type: 'IDENT', value: word });
            i = end;
            afterValue = true;
            continue;
        }

        if (ch === '_') {
            throw new Error('"_" は関数内の変数名の先頭にのみ使用できます');
        }

        if (ch === '$') {
            throw new Error('変数名や式の途中に "$" は使用できません');
        }

        throw new Error('式の中に解釈できない文字があります: ' + ch);
    }

    return tokens;
}

function evalIndexToInt(nodeResult, defaultVal) {
    if (!nodeResult) return defaultVal;
    const parsed = parseCasicNumber(nodeResult.value);
    return Math.trunc(parsed.num);
}

function applyStringBraceSlice(targetStr, startRes, endRes, hasColon) {
    const chars = Array.from(toDisplayString(targetStr));
    const len = chars.length;
    if (!hasColon) {
        const idx = evalIndexToInt(startRes, 1);
        if (idx < 1 || idx > len) return "";
        return chars[idx - 1];
    }
    const sIdx = startRes ? Math.max(1, evalIndexToInt(startRes, 1)) : 1;
    const eIdx = endRes ? Math.min(len, evalIndexToInt(endRes, len)) : len;
    if (sIdx > eIdx || sIdx > len || eIdx < 1) return "";
    return chars.slice(sIdx - 1, eIdx).join('');
}

function applyArrayBracketAccess(arr, specs) {
    if (specs.type === 'empty') {
        return cloneArrayDeep(arr);
    }
    if (specs.type === 'slice') {
        const len = arr.length;
        const sIdx = specs.start ? Math.max(1, evalIndexToInt(specs.start, 1)) : 1;
        const eIdx = specs.end ? Math.min(len, evalIndexToInt(specs.end, len)) : len;
        if (sIdx > eIdx || sIdx > len || eIdx < 1) return [];
        return cloneArrayDeep(arr.slice(sIdx - 1, eIdx));
    }
    let current = arr;
    for (let i = 0; i < specs.indices.length; i++) {
        if (!Array.isArray(current)) return "";
        const idx = evalIndexToInt(specs.indices[i], 1);
        if (idx < 1 || idx > current.length) return "";
        current = current[idx - 1];
    }
    return Array.isArray(current) ? cloneArrayDeep(current) : current;
}

function resolveArgAsCollectionOrValue(argRes) {
    if (!argRes) return "";
    if (Array.isArray(argRes.value) || isPlainDictObject(argRes.value)) {
        return argRes.value;
    }
    if (argRes.identName && argRes.value === '') {
        if (hasArray(argRes.identName)) return getArray(argRes.identName);
        if (hasDict(argRes.identName)) return getDict(argRes.identName);
    }
    const s = String(argRes.value);
    if (s.startsWith('[') && s.endsWith(']')) {
        return parseCasicArrayLiteralString(s);
    }
    if (s.startsWith('{') && s.endsWith('}')) {
        const parsed = parseCasicJsonToDict(s);
        if (parsed.valid) return parsed.dict;
    }
    return argRes.value;
}

function resolveArgAsDict(argRes) {
    if (!argRes) return {};
    if (isPlainDictObject(argRes.value)) return argRes.value;
    if (argRes.identName && hasDict(argRes.identName)) {
        return getDict(argRes.identName);
    }
    const parsed = parseCasicJsonToDict(argRes.value);
    return parsed.valid ? parsed.dict : {};
}

// ==========================================
// 6. 組み込み関数 & ユーザー定義関数の呼び出しディスパッチ
// ==========================================

function callBuiltinFunction(funcNameLower, argResults) {
    const args = argResults.map(function(r) { return r.value; });

    // --- 1. 入力の関数 (check, charcheck, allcheck) ---
    if (funcNameLower === 'check') {
        if (args.length === 0) {
            return readNextInputToken(null, false).token;
        }
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

    // --- 2. 計算の関数 (abs, not, sqrt, round, floor, ceil, trunc, min, max, sum, gcd, lcm, base) ---
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

    // --- 3. ビット演算の関数 (band, bor, bxor, bnot) ---
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

    // --- 4. ハッシュ・乱数の関数 (rand, rand., hrand, hrand., hash, md5, sha256) ---
    if (funcNameLower === 'rand') {
        const r = nextRandomFloat01();
        if (args.length === 0) {
            return r < 0.5 ? "0" : "1";
        }
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
        if (args.length === 0) {
            return formatFloatStorage(r);
        }
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
        if (args.length <= 1) {
            return r < 0.5 ? "0" : "1";
        }
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
        if (args.length <= 1) {
            return formatFloatStorage(r);
        }
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

    // --- 5. 型変換の関数 (big, num, str) ---
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

    // --- 6. 文字コードの関数 (chr, ord, uni) ---
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
        if (chars.length === 1) {
            return String(chars[0].codePointAt(0));
        }
        if (isIntString(raw)) {
            return String.fromCodePoint(Math.trunc(Number(raw)));
        }
        return chars.map(function(c) { return String(c.codePointAt(0)); });
    }

    // --- 7. 文字列・配列共通の関数 (len, rev, sort, dsort, find, count, replace) ---
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
        if (Array.isArray(target)) {
            return target.slice().sort(compareCasicNumericSort);
        }
        return Array.from(toDisplayString(target)).sort().join('');
    }
    if (funcNameLower === 'dsort') {
        if (args.length === 0) return "";
        const target = resolveArgAsCollectionOrValue(argResults[0]);
        if (Array.isArray(target)) {
            return target.slice().sort(compareCasicDictSort);
        }
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

    // --- 8. 文字列の関数 (split, rep, trim, upper, lower, regex, if) ---
    if (funcNameLower === 'split') {
        if (args.length === 0) return [];
        const s1 = toDisplayString(args[0]);
        const s2 = args.length >= 2 ? toDisplayString(args[1]) : ' ';
        const rawParts = s1.split(s2);
        const filteredParts = rawParts.filter(function(item) { return item !== ''; });
        if (args.length <= 2) {
            return filteredParts;
        }
        const nIdx = Math.trunc(parseCasicNumber(args[2]).num);
        if (nIdx >= 1 && nIdx <= filteredParts.length) {
            return filteredParts[nIdx - 1];
        }
        if (nIdx >= 1 && nIdx <= rawParts.length) {
            return rawParts[nIdx - 1];
        }
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

    // --- 9. 配列の関数 (join, grid, flat, bs, uniq) ---
    if (funcNameLower === 'join') {
        if (args.length === 0) return "";
        const target = resolveArgAsCollectionOrValue(argResults[0]);
        if (!Array.isArray(target)) return toDisplayString(target);
        if (args.length === 1) {
            return formatArrayAsCasicString(target);
        }
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
            if (compareCasicNumericSort(target[mid], x) < 0) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        return String(lo + 1);
    }

    // --- 10. 辞書・JSONの関数 (has, keys, json) ---
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

    // --- 11. ユーザー定義関数の呼び出し ---
    if (Object.prototype.hasOwnProperty.call(state.functions, funcNameLower)) {
        if (typeof invokeUserDefinedFunction === 'function') {
            return invokeUserDefinedFunction(state.functions[funcNameLower], argResults);
        }
    }

    throw new Error('未定義または未実装の関数です: ' + funcNameLower + '()');
}

function parseAndEvaluateTokens(tokens) {
    let pos = 0;

    function peek() {
        return pos < tokens.length ? tokens[pos] : null;
    }

    function consume() {
        return tokens[pos++];
    }

    function matchPunc(val) {
        const t = peek();
        if (t && t.type === 'PUNC' && t.value === val) {
            pos++;
            return true;
        }
        return false;
    }

    function matchOp(val) {
        const t = peek();
        if (t && t.type === 'OP' && t.value === val) {
            pos++;
            return true;
        }
        return false;
    }

    function parseLogicalOr() {
        let left = parseLogicalXor();
        while (matchOp('||')) {
            const right = parseLogicalXor();
            const res = (isCasicTruthy(left.value) || isCasicTruthy(right.value)) ? "1" : "0";
            left = { value: res, isTrueSpecial: false };
        }
        return left;
    }

    function parseLogicalXor() {
        let left = parseLogicalAnd();
        while (matchOp('^^')) {
            const right = parseLogicalAnd();
            const b1 = isCasicTruthy(left.value);
            const b2 = isCasicTruthy(right.value);
            const res = (b1 === b2) ? "0" : "1";
            left = { value: res, isTrueSpecial: false };
        }
        return left;
    }

    function parseLogicalAnd() {
        let left = parseEquality();
        while (matchOp('&&')) {
            const right = parseEquality();
            const res = (isCasicTruthy(left.value) && isCasicTruthy(right.value)) ? "1" : "0";
            left = { value: res, isTrueSpecial: false };
        }
        return left;
    }

    function parseEquality() {
        let left = parseRelational();
        while (true) {
            const t = peek();
            if (t && t.type === 'OP' && (t.value === '=' || t.value === '==' || t.value === '!=' || t.value === '<>')) {
                const op = consume().value;
                const right = parseRelational();
                const res = applyEqualityOp(left, right, op);
                left = { value: res, isTrueSpecial: false };
            } else {
                break;
            }
        }
        return left;
    }

    function parseRelational() {
        let left = parseShift();
        while (true) {
            const t = peek();
            if (t && t.type === 'OP' && (t.value === '<' || t.value === '<=' || t.value === '>' || t.value === '>=')) {
                const op = consume().value;
                const right = parseShift();
                const res = applyRelationalOp(left.value, right.value, op);
                left = { value: res, isTrueSpecial: false };
            } else {
                break;
            }
        }
        return left;
    }

    function parseShift() {
        let left = parseAdditive();
        while (true) {
            const t = peek();
            if (t && t.type === 'OP' && (t.value === '<<' || t.value === '>>')) {
                const op = consume().value;
                const right = parseAdditive();
                const res = applyNumericBinaryOp(left.value, right.value, op);
                left = { value: res, isTrueSpecial: false };
            } else {
                break;
            }
        }
        return left;
    }

    function parseAdditive() {
        let left = parseMultiplicative();
        while (true) {
            const t = peek();
            if (t && t.type === 'OP' && (t.value === '+' || t.value === '-' || t.value === '&')) {
                const op = consume().value;
                const right = parseMultiplicative();
                if (op === '&') {
                    const combined = toDisplayString(left.value) + toDisplayString(right.value);
                    left = { value: combined, isTrueSpecial: false };
                } else {
                    const res = applyNumericBinaryOp(left.value, right.value, op);
                    left = { value: res, isTrueSpecial: false };
                }
            } else {
                break;
            }
        }
        return left;
    }

    function parseMultiplicative() {
        let left = parseExponentiation();
        while (true) {
            const t = peek();
            if (t && t.type === 'OP' && (t.value === '*' || t.value === '/' || t.value === '/.' || t.value === '%')) {
                const op = consume().value;
                const right = parseExponentiation();
                const res = applyNumericBinaryOp(left.value, right.value, op);
                left = { value: res, isTrueSpecial: false };
            } else {
                break;
            }
        }
        return left;
    }

    function parseExponentiation() {
        const left = parseBraceSlice();
        const t = peek();
        if (t && t.type === 'OP' && (t.value === '^' || t.value === '**')) {
            consume();
            const right = parseExponentiation();
            const res = applyNumericBinaryOp(left.value, right.value, '^');
            return { value: res, isTrueSpecial: false };
        }
        return left;
    }

    function parseBraceSlice() {
        let node = parseUnary();
        while (matchPunc('{')) {
            node = parseBraceSliceBody(node);
        }
        return node;
    }

    function parseBraceSliceBody(targetNode) {
        if (matchPunc('}')) {
            if (targetNode.identName) {
                const dictObj = getDict(targetNode.identName);
                return { value: dictObj ? cloneDictDeep(dictObj) : {}, isTrueSpecial: false };
            }
            return { value: {}, isTrueSpecial: false };
        }

        let startRes = null;
        let endRes = null;
        let hasColon = false;

        if (!matchPunc(':')) {
            startRes = parseLogicalOr();
            if (matchPunc(':')) {
                hasColon = true;
                if (!(peek() && peek().type === 'PUNC' && peek().value === '}')) {
                    endRes = parseLogicalOr();
                }
            }
        } else {
            hasColon = true;
            if (!(peek() && peek().type === 'PUNC' && peek().value === '}')) {
                endRes = parseLogicalOr();
            }
        }

        if (!matchPunc('}')) {
            throw new Error('文字列の範囲指定に対応する "}" がありません');
        }

        const sliced = applyStringBraceSlice(targetNode.value, startRes, endRes, hasColon);
        return { value: sliced, isTrueSpecial: false };
    }

    function parseUnary() {
        const t = peek();
        if (t && t.type === 'OP' && (t.value === '-' || t.value === '~' || t.value === '!')) {
            const op = consume().value;
            const operand = parseUnary();
            if (op === '!') {
                const inverted = isCasicTruthy(operand.value) ? "0" : "1";
                return { value: inverted, isTrueSpecial: false };
            } else {
                const negated = applyNumericBinaryOp("0", operand.value, '-');
                return { value: negated, isTrueSpecial: false };
            }
        }
        return parsePostfix();
    }

    function parsePostfix() {
        let node = parsePrimary();

        while (true) {
            if (matchPunc('[')) {
                if (node.identName && hasDict(node.identName)) {
                    const dictObj = getDict(node.identName);
                    const keyRes = parseLogicalOr();
                    if (!matchPunc(']')) throw new Error('辞書のキー指定に対応する "]" がありません');
                    const kStr = toDisplayString(keyRes.value);
                    const val = Object.prototype.hasOwnProperty.call(dictObj, kStr) ? dictObj[kStr] : "";
                    node = { value: val, isTrueSpecial: false };
                    continue;
                }

                const baseArr = node.identName ? getArray(node.identName) : (Array.isArray(node.value) ? node.value : []);
                if (matchPunc(']')) {
                    node = { value: applyArrayBracketAccess(baseArr, { type: 'empty' }), isTrueSpecial: false };
                    continue;
                }

                let firstExpr = null;
                if (!matchPunc(':')) {
                    firstExpr = parseLogicalOr();
                    if (matchPunc(':')) {
                        let secondExpr = null;
                        if (!(peek() && peek().type === 'PUNC' && peek().value === ']')) {
                            secondExpr = parseLogicalOr();
                        }
                        if (!matchPunc(']')) throw new Error('配列の範囲指定に対応する "]" がありません');
                        node = {
                            value: applyArrayBracketAccess(baseArr, { type: 'slice', start: firstExpr, end: secondExpr }),
                            isTrueSpecial: false
                        };
                        continue;
                    }
                } else {
                    let secondExpr = null;
                    if (!(peek() && peek().type === 'PUNC' && peek().value === ']')) {
                        secondExpr = parseLogicalOr();
                    }
                    if (!matchPunc(']')) throw new Error('配列の範囲指定に対応する "]" がありません');
                    node = {
                        value: applyArrayBracketAccess(baseArr, { type: 'slice', start: null, end: secondExpr }),
                        isTrueSpecial: false
                    };
                    continue;
                }

                const indices = [firstExpr];
                while (matchPunc(',')) {
                    indices.push(parseLogicalOr());
                }
                if (!matchPunc(']')) throw new Error('配列の要素指定に対応する "]" がありません');
                node = {
                    value: applyArrayBracketAccess(baseArr, { type: 'indices', indices: indices }),
                    isTrueSpecial: false
                };
                continue;
            }

            if (matchPunc('{')) {
                node = parseBraceSliceBody(node);
                continue;
            }

            break;
        }

        return node;
    }

    function parsePrimary() {
        const t = peek();
        if (!t) {
            return { value: "", isTrueSpecial: false };
        }

        if (matchPunc('(')) {
            if (matchPunc(')')) {
                return { value: "", isTrueSpecial: false };
            }
            const inner = parseLogicalOr();
            if (!matchPunc(')')) {
                throw new Error('対応する閉じ括弧 ")" がありません');
            }
            return inner;
        }

        if (t.type === 'ARRAY_LITERAL') {
            consume();
            return { value: cloneArrayDeep(t.value), isTrueSpecial: false };
        }

        if (t.type === 'JSON_LITERAL') {
            consume();
            const parsed = parseCasicJsonToDict(t.raw);
            if (!parsed.valid) {
                return { value: t.raw, isTrueSpecial: false, invalidJsonRaw: t.raw };
            }
            return { value: parsed.dict, isTrueSpecial: false };
        }

        if (t.type === 'STRING') {
            consume();
            return { value: t.value, isTrueSpecial: t.isTrueLiteral === true };
        }

        if (t.type === 'NUMBER') {
            consume();
            return { value: t.value, isTrueSpecial: false };
        }

        if (t.type === 'IDENT') {
            consume();
            const name = t.value;
            const lower = name.toLowerCase();

            if (matchPunc('(')) {
                const args = [];
                if (!matchPunc(')')) {
                    args.push(parseLogicalOr());
                    while (matchPunc(',')) {
                        args.push(parseLogicalOr());
                    }
                    if (!matchPunc(')')) {
                        throw new Error('関数呼び出しに対応する ")" がありません');
                    }
                }
                const retVal = callBuiltinFunction(lower, args);
                return { value: retVal, isTrueSpecial: false };
            }

            return {
                value: getVar(name),
                isTrueSpecial: (lower === 'true'),
                identName: name
            };
        }

        throw new Error('式の構文が正しくありません: ' + t.value);
    }

    const result = parseLogicalOr();
    if (pos < tokens.length) {
        throw new Error('式の途中に解釈できない部分があります: ' + tokens[pos].value);
    }
    return result.value;
}

function evaluateExpression(expr) {
    const s = cleanText(expr);
    if (s === '') return "";
    const tokens = tokenizeExpression(s);
    if (tokens.length === 0) return "";
    return parseAndEvaluateTokens(tokens);
}