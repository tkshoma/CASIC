// ==========================================
// 1. 乱数・ハッシュ計算 (MD5 / SHA-256 / 64bit Hash)
// ==========================================

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
// 2. 数値解釈・四則演算・比較・ソート比較
// ==========================================

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