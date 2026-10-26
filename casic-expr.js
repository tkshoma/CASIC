// ==========================================
// 1. 配列リテラル・ネスト構造パースヘルパー
// ==========================================

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
        if (p.startsWith('{') && p.endsWith('}')) {
            const dParsed = parseCasicJsonToDict(p);
            if (dParsed.valid) return dParsed.dict;
        }
        if (p.startsWith('$')) {
            const exprPart = cleanText(p.slice(1));
            if (exprPart === '') return "";
            const evaluated = evaluateExpression(exprPart);
            return Array.isArray(evaluated) ? cloneArrayDeep(evaluated) : String(evaluated);
        }
        if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
            if (p.length >= 2) {
                return unescapeCasicString(p.slice(1, -1));
            }
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

function parseNestedCasicStructure(val) {
    if (Array.isArray(val) || isPlainDictObject(val)) {
        return val;
    }
    const s = cleanText(val);
    if (s.startsWith('{') && s.endsWith('}')) {
        const dRes = parseCasicJsonToDict(s);
        if (dRes.valid) return dRes.dict;
    }
    if (s.startsWith('[') && s.endsWith(']')) {
        try {
            const parsed = JSON.parse(s);
            if (Array.isArray(parsed)) return normalizeJsonValueRec(parsed);
        } catch (e) {
        }
        return parseCasicArrayLiteralString(s);
    }
    return val;
}

// ==========================================
// 2. コメント除去・行分割・カンマ分割ヘルパー
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
    let quoteChar = null;
    let i = 0;
    while (i < line.length) {
        const ch = line[i];
        if (ch === '"' || ch === "'") {
            if (quoteChar === null) quoteChar = ch;
            else if (quoteChar === ch) quoteChar = null;
            i++;
            continue;
        }
        if (quoteChar === null) {
            if (ch === '/' && isSlashStringStartInLine(line, i)) {
                if (line[i + 1] !== '=' && line[i + 1] !== '.') {
                    i = findSlashStringEnd(line, i);
                    continue;
                }
            }
            if (ch === '#') {
                return line.slice(0, i);
            }
        }
        i++;
    }
    return line;
}

function isRunCommandAwaitingRangeColon(currentStr) {
    const trimmed = cleanText(currentStr);
    if (!trimmed) return false;
    if (trimmed.length >= 3 && trimmed.slice(0, 3).toLowerCase() === 'run') {
        if (trimmed.length === 3 || isSpaceChar(trimmed[3])) {
            return trimmed.indexOf(':') === -1;
        }
    }
    return false;
}

function splitStatementsByColon(line) {
    const uncommented = stripLineComment(line);
    const statements = [];
    let current = '';
    let quoteChar = null;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;

    for (let i = 0; i < uncommented.length; i++) {
        const ch = uncommented[i];
        if (ch === '"' || ch === "'") {
            if (quoteChar === null) quoteChar = ch;
            else if (quoteChar === ch) quoteChar = null;
            current += ch;
            continue;
        }
        if (quoteChar === null) {
            if (ch === '(') parenDepth++;
            else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
            else if (ch === '[') bracketDepth++;
            else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);
            else if (ch === '{') braceDepth++;
            else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);

            if (ch === ':' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
                if (isRunCommandAwaitingRangeColon(current)) {
                    current += ch;
                    continue;
                }
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
    let quoteChar = null;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;

    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (ch === '"' || ch === "'") {
            if (quoteChar === null) quoteChar = ch;
            else if (quoteChar === ch) quoteChar = null;
            current += ch;
            continue;
        }
        if (quoteChar === null) {
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
    let quoteChar = null;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '"' || ch === "'") {
            if (quoteChar === null) quoteChar = ch;
            else if (quoteChar === ch) quoteChar = null;
            continue;
        }
        if (quoteChar === null) {
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
// 3. 式のトークナイザ & 再帰下降パーサ（処理順 1〜14）
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

        // 処理順1: "" または '' による文字列化（"\" などもそのまま閉じられるよう同じクォート文字で終端）
        if (ch === '"' || ch === "'") {
            const q = ch;
            let end = i + 1;
            while (end < len && exprStr[end] !== q) {
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
            let quoteChar = null;
            let end = i;
            while (end < len) {
                const c = exprStr[end];
                if (c === '"' || c === "'") {
                    if (quoteChar === null) quoteChar = c;
                    else if (quoteChar === c) quoteChar = null;
                } else if (quoteChar === null) {
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
            let quoteChar = null;
            let end = i;
            while (end < len) {
                const c = exprStr[end];
                if (c === '"' || c === "'") {
                    if (quoteChar === null) quoteChar = c;
                    else if (quoteChar === c) quoteChar = null;
                } else if (quoteChar === null) {
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
                if (exprStr[look] === '(' && (lower === 'rand' || lower === 'hrand' || lower === 'randh')) {
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
    if (len === 0) return "";

    if (!hasColon) {
        let idx = evalIndexToInt(startRes, 1);
        if (idx < 0) idx = len + 1 + idx;
        if (idx < 1 || idx > len) return "";
        return chars[idx - 1];
    }

    let rawStart = startRes ? evalIndexToInt(startRes, 1) : 1;
    let rawEnd = endRes ? evalIndexToInt(endRes, len) : len;
    if (rawStart < 0) rawStart = len + 1 + rawStart;
    if (rawEnd < 0) rawEnd = len + 1 + rawEnd;

    const sIdx = Math.max(1, rawStart);
    const eIdx = Math.min(len, rawEnd);
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
        const first = parseShift();
        const ops = [];
        const operands = [first];

        while (true) {
            const t = peek();
            if (t && t.type === 'OP' && (t.value === '<' || t.value === '<=' || t.value === '>' || t.value === '>=')) {
                ops.push(consume().value);
                operands.push(parseShift());
            } else {
                break;
            }
        }

        if (ops.length === 0) {
            return first;
        }

        let allTrue = true;
        for (let i = 0; i < ops.length; i++) {
            const stepRes = applyRelationalOp(operands[i].value, operands[i + 1].value, ops[i]);
            if (stepRes !== "1") {
                allTrue = false;
                break;
            }
        }
        return { value: allTrue ? "1" : "0", isTrueSpecial: false };
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