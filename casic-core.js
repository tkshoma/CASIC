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

function isIdentStartChar(ch) {
    if (!ch) return false;
    if (isDigitChar(ch) || ch === '_' || ch === '$') return false;
    return !isReservedSymbolChar(ch);
}

function isVarStartChar(ch) {
    if (!ch) return false;
    if (ch === '_') return true;
    return isIdentStartChar(ch);
}

function isIdentPartChar(ch) {
    if (!ch) return false;
    if (ch === '$') return false;
    if (ch === '_') return true;
    return !isReservedSymbolChar(ch);
}

function isValidIdentifier(str) {
    if (!str || str.length === 0) return false;
    if (!isIdentStartChar(str[0])) return false;
    for (let i = 1; i < str.length; i++) {
        if (!isIdentPartChar(str[i])) return false;
    }
    return true;
}

function isValidVarIdentifier(str) {
    if (!str || str.length === 0) return false;
    if (str[0] === '_') {
        if (str.length < 2) return false;
        for (let i = 1; i < str.length; i++) {
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

function isInfinityString(str) {
    if (!str) return false;
    const lower = cleanText(str).toLowerCase();
    return lower === 'inf' || lower === '+inf' || lower === '-inf' ||
           lower === '∞' || lower === '+∞' || lower === '-∞' ||
           lower === 'infinity' || lower === '+infinity' || lower === '-infinity';
}

function isNumericLiteralString(str) {
    return isIntString(str) || isBigIntString(str) || isFloatString(str) || isInfinityString(str);
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
        .split(CHAR_BSLASH + '"').join('"')
        .split(CHAR_BSLASH + "'").join("'");
}

function xor32(a, b) {
    return (a | b) & ~(a & b);
}

function xorBig(a, b) {
    return (a | b) & ~(a & b);
}

// ==========================================
// 1.5 物理的キーボード入力のトラッキング
// ==========================================
const keyInputState = {
    current: new Set(),
    pressedSinceLastTick: new Set(),
    releasedSinceLastTick: new Set()
};

function getCasicKeyName(eKey, eCode) {
    if (eKey.length === 1) {
        return eKey.toLowerCase();
    }
    if (eCode.startsWith('Numpad') && eCode.length === 7 && isDigitChar(eCode[6])) {
        return 'num' + eCode[6];
    }
    if (eKey.startsWith('F') && eKey.length <= 3) return eKey;

    const lower = eKey.toLowerCase();
    if (lower === ' ') return 'space';
    if (lower === 'escape') return 'escape';
    if (lower === 'enter') return 'enter';
    if (lower === 'tab') return 'tab';
    if (lower === 'backspace') return 'backspace';
    if (lower === 'delete') return 'delete';
    
    if (lower === 'shift') return eCode === 'ShiftRight' ? 'right_shift' : 'left_shift';
    if (lower === 'control') return eCode === 'ControlRight' ? 'right_control' : 'left_control';
    if (lower === 'alt') return 'alt';
    if (lower === 'meta') return 'command';

    if (lower === 'arrowup') return 'up_arrow';
    if (lower === 'arrowdown') return 'down_arrow';
    if (lower === 'arrowleft') return 'left_arrow';
    if (lower === 'arrowright') return 'right_arrow';
    if (lower === 'fn') return 'function';

    return lower;
}

window.addEventListener('keydown', function(e) {
    if (e.isComposing) return;
    const kName = getCasicKeyName(e.key, e.code);
    if (!keyInputState.current.has(kName)) {
        keyInputState.current.add(kName);
        keyInputState.pressedSinceLastTick.add(kName);
    }
});

window.addEventListener('keyup', function(e) {
    const kName = getCasicKeyName(e.key, e.code);
    if (keyInputState.current.has(kName)) {
        keyInputState.current.delete(kName);
        keyInputState.releasedSinceLastTick.add(kName);
    }
});

function resetKeyTickState() {
    keyInputState.pressedSinceLastTick.clear();
    keyInputState.releasedSinceLastTick.clear();
}

// ==========================================
// 2. CASIC ランタイム状態・同義語（エイリアス）定義
// ==========================================
const state = {
    vars: {},
    arrays: {},
    dicts: {},
    functions: {},
    callStack: [],
    funcOutputBuffer: '',
    forStates: {},
    inputPtr: 0,
    rngSeed: null,
    stepEvaluateBranch: false,
    isStopped: false,
    runEndLineIdx: null,
    lastModified: null,
    pc: 0,
    totalSteps: 0,
    warnings: [],
    
    // 非同期強制停止・ステップ実行判定フラグ
    isAborting: false,
    isStepMode: false,
    
    lastTickTime: null,
    lastFrameTime: null
};

const COMMAND_ALIASES = {
    'fin': 'exit',
    'inchar': 'charin',
    'inall': 'allin',
    'inreset': 'resetin',
    'print': 'out',
    's_sort': 'sort',
    'l_sort': 'sort',
    's_dsort': 'dsort',
    'l_dsort': 'dsort',
    's_rev': 'rev',
    'l_rev': 'rev',
    's_replace': 'replace',
    'l_replace': 'replace',
    'l_push': 'push',
    'ins': 'push',
    'add': 'push',
    'l_del': 'del',
    'l_clear': 'clear',
    'l_uniq': 'uniq'
};

function normalizeCommandName(cmdLower) {
    return Object.prototype.hasOwnProperty.call(COMMAND_ALIASES, cmdLower) ? COMMAND_ALIASES[cmdLower] : cmdLower;
}

const FUNCTION_ALIASES = {
    'checkchar': 'charcheck',
    'checkall': 'allcheck',
    'c_abs': 'abs',
    'c_not': 'not',
    'c_sqrt': 'sqrt',
    'c_round': 'round',
    'c_floor': 'floor',
    'celi': 'ceil',
    'c_ceil': 'ceil',
    'c_trunc': 'trunc',
    'c_min': 'min',
    'c_max': 'max',
    'c_sum': 'sum',
    'c_gcd': 'gcd',
    'c_lcm': 'lcm',
    'c_base': 'base',
    'c_clamp': 'clamp',
    'c_dist': 'dist',
    'b_and': 'band',
    'b_or': 'bor',
    'b_xor': 'bxor',
    'b_not': 'bnot',
    'randh': 'hrand',
    'randh.': 'hrand.',
    'h_hash': 'hash',
    'h_md5': 'md5',
    'h_sha256': 'sha256',
    's_len': 'len',
    'l_len': 'len',
    's_rev': 'rev',
    'l_rev': 'rev',
    's_sort': 'sort',
    'l_sort': 'sort',
    's_dsort': 'dsort',
    'l_dsort': 'dsort',
    's_find': 'find',
    'l_find': 'find',
    's_count': 'count',
    'l_count': 'count',
    's_replace': 'replace',
    'l_replace': 'replace',
    's_chr': 'chr',
    's_ord': 'ord',
    's_old': 'ord',
    's_uni': 'uni',
    's_split': 'split',
    's_rep': 'rep',
    's_trim': 'trim',
    's_upper': 'upper',
    's_lower': 'lower',
    's_regex': 'regex',
    's_if': 'if',
    's_squeeze': 'squeeze',
    's_between_get': 'between_get',
    's_between_replace': 'between_replace',
    's_between_list': 'between_list',
    's_unescape': 'unescape',
    's_at': 'at',
    'l_at': 'at',
    'd_at': 'at',
    'l_join': 'join',
    'l_grid': 'grid',
    'l_flat': 'flat',
    'l_bs': 'bs',
    'l_uniq': 'uniq',
    'd_has': 'has',
    'key': 'keys',
    'd_keys': 'keys',
    'd_key': 'keys',
    'd_json': 'json',
    'd_g_shape': 'g_shape',
    'd_g_image': 'g_image',
    'd_g_text': 'g_text',
    'd_a_sound': 'a_sound'
};

function normalizeFunctionName(funcNameLower) {
    return Object.prototype.hasOwnProperty.call(FUNCTION_ALIASES, funcNameLower) ? FUNCTION_ALIASES[funcNameLower] : funcNameLower;
}

const COMMAND_KEYWORDS = new Set([
    'out', 'print', 'put',
    'in', 'charin', 'inchar', 'allin', 'inall', 'resetin', 'inreset',
    'if', 'elseif', 'else', 'end', 'for', 'while', 'break',
    'go', 'to', 'fin', 'exit',
    'sort', 's_sort', 'l_sort',
    'dsort', 's_dsort', 'l_dsort',
    'rev', 's_rev', 'l_rev',
    'replace', 's_replace', 'l_replace',
    'push', 'l_push', 'ins', 'add',
    'del', 'l_del',
    'clear', 'l_clear',
    'uniq', 'l_uniq',
    'seed', 'rename', 'stop', 'return', 'fun', 'wait', 'js',
    'tick', 'frame', 'fetch',
    'g_size', 'g_smooth', 'g_clear', 'g_line', 'g_poly', 'g_rect', 'g_circle', 'g_image', 'g_text',
    'a_play', 'a_stop',
    'cont', 'run', 'goto', 'step', 'reset'
]);

const BUILTIN_FUNCTION_NAMES = new Set([
    'check', 'charcheck', 'checkchar', 'allcheck', 'checkall',
    'abs', 'c_abs', 'not', 'c_not', 'sqrt', 'c_sqrt',
    'round', 'c_round', 'floor', 'c_floor', 'ceil', 'celi', 'c_ceil', 'trunc', 'c_trunc',
    'min', 'c_min', 'max', 'c_max', 'sum', 'c_sum', 'gcd', 'c_gcd', 'lcm', 'c_lcm',
    'base', 'c_base', 'clamp', 'c_clamp', 'dist', 'c_dist', 'fix',
    'sin', 'cos', 'tan', 'atan2',
    'band', 'b_and', 'bor', 'b_or', 'bxor', 'b_xor', 'bnot', 'b_not',
    'rand', 'rand.', 'hrand', 'randh', 'hrand.', 'randh.',
    'hash', 'h_hash', 'md5', 'h_md5', 'sha256', 'h_sha256',
    'big', 'num', 'str', 'eval',
    'chr', 's_chr', 'ord', 's_ord', 's_old', 'uni', 's_uni',
    'len', 's_len', 'l_len', 'rev', 's_rev', 'l_rev',
    'sort', 's_sort', 'l_sort', 'dsort', 's_dsort', 'l_dsort',
    'find', 's_find', 'l_find', 'count', 's_count', 'l_count', 'replace', 's_replace', 'l_replace',
    'split', 's_split', 'rep', 's_rep', 'trim', 's_trim',
    'upper', 's_upper', 'lower', 's_lower', 'regex', 's_regex', 'if', 's_if',
    'squeeze', 's_squeeze',
    'between_get', 's_between_get',
    'between_replace', 's_between_replace',
    'between_list', 's_between_list',
    'unescape', 's_unescape', 'base64', 'unbase64',
    'at', 's_at', 'l_at', 'd_at',
    'join', 'l_join', 'grid', 'l_grid', 'flat', 'l_flat', 'bs', 'l_bs', 'uniq', 'l_uniq',
    'has', 'd_has', 'keys', 'key', 'd_keys', 'd_key', 'json', 'd_json',
    'g_shape', 'd_g_shape', 'g_image', 'd_g_image', 'g_text', 'd_g_text', 'g_color',
    'a_sound', 'd_a_sound',
    'key', 'key_up', 'key_down', 'keys', 'fps', 'tps'
]);

const ASSIGN_OPS = ['/.=', '+=', '-=', '&=', '*=', '/=', '%=', '='];

// ==========================================
// 3. 変数・配列・辞書のスコープ管理とフォーマット
// ==========================================

function getCurrentCallFrame() {
    return state.callStack.length > 0 ? state.callStack[state.callStack.length - 1] : null;
}

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

function formatFloatStorage(num) {
    if (num === Infinity) return 'inf';
    if (num === -Infinity) return '-inf';
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
            if (isNumericLiteralString(s) && !isInfinityString(s)) {
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
        if (isNumericLiteralString(s) && !isInfinityString(s)) return s;
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
        if (isNumericLiteralString(s) && !isInfinityString(s)) {
            return toDisplayString(s);
        }
        return '"' + s.split('"').join(CHAR_BSLASH + '"') + '"';
    });
    return '[' + parts.join(',') + ']';
}

function normalizeJsonValueRec(v) {
    if (Array.isArray(v)) {
        return v.map(normalizeJsonValueRec);
    }
    if (v !== null && typeof v === 'object') {
        const out = {};
        const keys = Object.keys(v);
        for (let i = 0; i < keys.length; i++) {
            out[String(keys[i])] = normalizeJsonValueRec(v[keys[i]]);
        }
        return out;
    }
    return String(v);
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
            return { dict: normalizeJsonValueRec(parsed), valid: true };
        }
    } catch (e) {
    }
    return { dict: {}, valid: false };
}

// ==========================================
// 4. 入力データ読み取りヘルパー
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