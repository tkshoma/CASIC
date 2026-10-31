// ==========================================
// 1. 命令引数解析ヘルパー
// ==========================================

function matchAssignmentOp(str) {
    for (const op of ASSIGN_OPS) {
        if (str.startsWith(op)) {
            if (op === '=' && str.startsWith('==')) continue;
            return op;
        }
    }
    return null;
}

function splitCommandTargetArgs(str) {
    const s = cleanText(str);
    if (s === '') return [];
    return splitTopLevelComma(s);
}

function readCommandWordLength(str) {
    if (!str || !isAsciiAlpha(str[0])) return 0;
    let i = 1;
    while (i < str.length && (isAsciiAlpha(str[i]) || str[i] === '_')) {
        i++;
    }
    return i;
}

function parseCommandOptionAndTarget(restRaw) {
    const trimmed = cleanText(restRaw);
    if (trimmed.startsWith('(')) {
        const paren = extractParenHead(trimmed);
        if (paren && paren.after !== '') {
            return { optStr: paren.inside, targetStr: paren.after };
        }
    }
    return { optStr: null, targetStr: trimmed };
}

function parseArrayTargetSpec(argStr) {
    const s = cleanText(argStr);
    const openIdx = s.indexOf('[');
    if (openIdx === -1) {
        return { name: s, hasExplicitBrackets: false, bracketInside: null };
    }
    const name = cleanText(s.slice(0, openIdx));
    const closeIdx = s.lastIndexOf(']');
    const inside = closeIdx > openIdx ? cleanText(s.slice(openIdx + 1, closeIdx)) : '';
    return {
        name: name,
        hasExplicitBrackets: true,
        bracketInside: inside
    };
}

function parseRangeOrIndexSpec(specStr, defaultN1, defaultN2) {
    if (specStr === null || specStr === undefined || cleanText(specStr) === '') {
        return { isSpecified: false, isRange: false, n: null, n1: defaultN1, n2: defaultN2 };
    }
    const s = cleanText(specStr);
    if (s.indexOf(':') !== -1) {
        const parts = s.split(':');
        const n1 = cleanText(parts[0]) !== '' ? Math.trunc(parseCasicNumber(evaluateExpression(parts[0])).num) : defaultN1;
        const n2 = cleanText(parts[1]) !== '' ? Math.trunc(parseCasicNumber(evaluateExpression(parts[1])).num) : defaultN2;
        return { isSpecified: true, isRange: true, n: n1, n1: n1, n2: n2 };
    }
    const commaParts = splitTopLevelComma(s);
    if (commaParts.length >= 2) {
        const n1 = cleanText(commaParts[0]) !== '' ? Math.trunc(parseCasicNumber(evaluateExpression(commaParts[0])).num) : defaultN1;
        const n2 = cleanText(commaParts[1]) !== '' ? Math.trunc(parseCasicNumber(evaluateExpression(commaParts[1])).num) : defaultN2;
        return { isSpecified: true, isRange: true, n: n1, n1: n1, n2: n2 };
    }
    const n = Math.trunc(parseCasicNumber(evaluateExpression(s)).num);
    return { isSpecified: true, isRange: false, n: n, n1: n, n2: n };
}

// ==========================================
// 2. 辞書・配列・変数の代入命令
// ==========================================

function tryExecuteDictBraceAssignment(trimmed, lineNum) {
    let i = 0;
    if (!isVarStartChar(trimmed[0])) return null;
    i++;
    while (i < trimmed.length && isIdentPartChar(trimmed[i])) i++;
    const dictName = trimmed.slice(0, i);

    while (i < trimmed.length && isSpaceChar(trimmed[i])) i++;
    if (trimmed[i] !== '{' || trimmed[i + 1] !== '}') return null;

    const afterBrace = cleanText(trimmed.slice(i + 2));
    const op = matchAssignmentOp(afterBrace);
    if (!op) return null;

    const rhsRaw = cleanText(afterBrace.slice(op.length));

    if (op === '=') {
        if (rhsRaw === '') {
            setDict(dictName, {});
            return { executed: true };
        }
        const evaluated = evaluateExpression(rhsRaw);
        const parsed = parseCasicJsonToDict(evaluated);
        if (!parsed.valid) {
            state.warnings.push('[Line ' + lineNum + '] [警告] 辞書 "' + dictName + '{}" に無効なJSONが指定されたため、{}で初期化しました');
            setDict(dictName, {});
        } else {
            setDict(dictName, parsed.dict);
        }
        return { executed: true };
    }

    if (op === '+=') {
        if (!hasDict(dictName)) {
            throw new Error('辞書 "' + dictName + '{}" はまだ宣言されていません');
        }
        const currentDict = cloneDictDeep(getDict(dictName));
        if (rhsRaw === '') return { executed: true };

        let addDictObj = {};
        if (rhsRaw.endsWith('{}') && isValidVarIdentifier(rhsRaw.slice(0, -2))) {
            const d2Name = rhsRaw.slice(0, -2);
            if (!hasDict(d2Name)) {
                throw new Error('追加元の辞書 "' + d2Name + '{}" は宣言されていません');
            }
            addDictObj = getDict(d2Name);
        } else {
            const evaluated = evaluateExpression(rhsRaw);
            const parsed = parseCasicJsonToDict(evaluated);
            if (!parsed.valid) {
                throw new Error('辞書に追加するJSONが無効です: ' + rhsRaw);
            }
            addDictObj = parsed.dict;
        }

        const keys = Object.keys(addDictObj);
        for (let k = 0; k < keys.length; k++) {
            currentDict[keys[k]] = addDictObj[keys[k]];
        }
        setDict(dictName, currentDict);
        return { executed: true };
    }

    throw new Error('辞書 ' + dictName + '{} に対する "' + op + '" 代入は定義されていません');
}

function tryExecuteBracketAssignment(trimmed) {
    let i = 0;
    if (!isVarStartChar(trimmed[0])) return null;
    i++;
    while (i < trimmed.length && isIdentPartChar(trimmed[i])) i++;
    const targetName = trimmed.slice(0, i);

    while (i < trimmed.length && isSpaceChar(trimmed[i])) i++;
    if (trimmed[i] !== '[') return null;

    let depth = 0;
    let quoteChar = null;
    let closeBracketIdx = -1;
    for (let j = i; j < trimmed.length; j++) {
        const ch = trimmed[j];
        if ((ch === '"' || ch === "'") && trimmed[j - 1] !== CHAR_BSLASH) {
            if (quoteChar === null) quoteChar = ch;
            else if (quoteChar === ch) quoteChar = null;
            continue;
        }
        if (quoteChar === null) {
            if (ch === '[') depth++;
            else if (ch === ']') {
                depth--;
                if (depth === 0) {
                    closeBracketIdx = j;
                    break;
                }
            }
        }
    }
    if (closeBracketIdx === -1) return null;

    const insideBracket = cleanText(trimmed.slice(i + 1, closeBracketIdx));
    const afterBracket = cleanText(trimmed.slice(closeBracketIdx + 1));

    const op = matchAssignmentOp(afterBracket);
    if (!op) return null;

    const rhsRaw = cleanText(afterBracket.slice(op.length));

    if (hasDict(targetName)) {
        if (insideBracket === '') {
            throw new Error('名前 "' + targetName + '" は辞書として宣言されているため、配列 "' + targetName + '[]" としては使用できません');
        }
        const keyVal = toDisplayString(evaluateExpression(insideBracket));
        const dictObj = cloneDictDeep(getDict(targetName));
        const oldVal = Object.prototype.hasOwnProperty.call(dictObj, keyVal) ? dictObj[keyVal] : "";

        if (op === '=') {
            const val = rhsRaw === '' ? "" : evaluateExpression(rhsRaw);
            dictObj[keyVal] = Array.isArray(val) ? formatArrayAsCasicString(val) : toDisplayString(val);
        } else if (op === '+=') {
            const rhsVal = rhsRaw === '' ? "1" : evaluateExpression(rhsRaw);
            dictObj[keyVal] = applyNumericBinaryOp(oldVal, rhsVal, '+');
        } else if (op === '-=') {
            const rhsVal = rhsRaw === '' ? "1" : evaluateExpression(rhsRaw);
            dictObj[keyVal] = applyNumericBinaryOp(oldVal, rhsVal, '-');
        } else if (op === '&=') {
            const rhsVal = rhsRaw === '' ? "" : evaluateExpression(rhsRaw);
            dictObj[keyVal] = toDisplayString(oldVal) + toDisplayString(rhsVal);
        } else if (op === '*=') {
            const rhsVal = rhsRaw === '' ? "0" : evaluateExpression(rhsRaw);
            dictObj[keyVal] = applyNumericBinaryOp(oldVal, rhsVal, '*');
        } else if (op === '/=') {
            const rhsVal = rhsRaw === '' ? "0" : evaluateExpression(rhsRaw);
            dictObj[keyVal] = applyNumericBinaryOp(oldVal, rhsVal, '/');
        } else if (op === '/.=') {
            const rhsVal = rhsRaw === '' ? "0" : evaluateExpression(rhsRaw);
            dictObj[keyVal] = applyNumericBinaryOp(oldVal, rhsVal, '/.');
        } else if (op === '%=') {
            const rhsVal = rhsRaw === '' ? "0" : evaluateExpression(rhsRaw);
            dictObj[keyVal] = applyNumericBinaryOp(oldVal, rhsVal, '%');
        }
        setDict(targetName, dictObj);
        return { executed: true };
    }

    if (insideBracket === '') {
        if (op === '=') {
            if (rhsRaw === '') {
                setArray(targetName, []);
            } else {
                const evaluated = evaluateExpression(rhsRaw);
                setArray(targetName, coerceToArray(evaluated));
            }
            return { executed: true };
        }
        if (op === '+=') {
            const currentArr = cloneArrayDeep(getArray(targetName));
            const val = rhsRaw === '' ? "" : evaluateExpression(rhsRaw);
            currentArr.push(Array.isArray(val) ? cloneArrayDeep(val) : String(val));
            setArray(targetName, currentArr);
            return { executed: true };
        }
        throw new Error('配列全体 a[] に対する "' + op + '" 代入は定義されていません');
    }

    const indexExprs = splitTopLevelComma(insideBracket);
    const indices = indexExprs.map(function(expr) {
        const v = evaluateExpression(expr);
        const parsedNum = parseCasicNumber(v);
        if (!parsedNum.isValidNum) {
            throw new Error('辞書 "' + targetName + '{}" が未宣言であるか、配列の要素番号に数値以外が指定されています: ' + expr);
        }
        return Math.trunc(parsedNum.num);
    });

    for (let k = 0; k < indices.length; k++) {
        if (indices[k] < 1) {
            throw new Error('配列の要素番号には1以上の整数を指定してください (指定値: ' + indices[k] + ')');
        }
    }

    const rootArr = cloneArrayDeep(getArray(targetName));
    let cur = rootArr;

    for (let k = 0; k < indices.length - 1; k++) {
        const idx = indices[k];
        while (cur.length < idx) {
            cur.push("");
        }
        if (!Array.isArray(cur[idx - 1])) {
            if (cur[idx - 1] === "") {
                cur[idx - 1] = [];
            } else {
                cur[idx - 1] = [cur[idx - 1]];
            }
        }
        cur = cur[idx - 1];
    }

    const lastIdx = indices[indices.length - 1];
    while (cur.length < lastIdx) {
        cur.push("");
    }

    const oldVal = Array.isArray(cur[lastIdx - 1]) ? formatArrayAsCasicString(cur[lastIdx - 1]) : String(cur[lastIdx - 1]);

    if (op === '=') {
        const val = rhsRaw === '' ? "" : evaluateExpression(rhsRaw);
        cur[lastIdx - 1] = Array.isArray(val) ? cloneArrayDeep(val) : String(val);
    } else if (op === '+=') {
        const rhsVal = rhsRaw === '' ? "1" : evaluateExpression(rhsRaw);
        cur[lastIdx - 1] = applyNumericBinaryOp(oldVal, rhsVal, '+');
    } else if (op === '-=') {
        const rhsVal = rhsRaw === '' ? "1" : evaluateExpression(rhsRaw);
        cur[lastIdx - 1] = applyNumericBinaryOp(oldVal, rhsVal, '-');
    } else if (op === '&=') {
        const rhsVal = rhsRaw === '' ? "" : evaluateExpression(rhsRaw);
        cur[lastIdx - 1] = toDisplayString(oldVal) + toDisplayString(rhsVal);
    } else if (op === '*=') {
        const rhsVal = rhsRaw === '' ? "0" : evaluateExpression(rhsRaw);
        cur[lastIdx - 1] = applyNumericBinaryOp(oldVal, rhsVal, '*');
    } else if (op === '/=') {
        const rhsVal = rhsRaw === '' ? "0" : evaluateExpression(rhsRaw);
        cur[lastIdx - 1] = applyNumericBinaryOp(oldVal, rhsVal, '/');
    } else if (op === '/.=') {
        const rhsVal = rhsRaw === '' ? "0" : evaluateExpression(rhsRaw);
        cur[lastIdx - 1] = applyNumericBinaryOp(oldVal, rhsVal, '/.');
    } else if (op === '%=') {
        const rhsVal = rhsRaw === '' ? "0" : evaluateExpression(rhsRaw);
        cur[lastIdx - 1] = applyNumericBinaryOp(oldVal, rhsVal, '%');
    }

    setArray(targetName, rootArr);
    return { executed: true };
}

function tryExecuteVariableAssignment(trimmed) {
    let i = 0;
    if (!isVarStartChar(trimmed[0])) return null;
    i++;
    while (i < trimmed.length && isIdentPartChar(trimmed[i])) {
        i++;
    }

    const varName = trimmed.slice(0, i);
    if (!isValidVarIdentifier(varName)) return null;

    while (i < trimmed.length && isSpaceChar(trimmed[i])) {
        i++;
    }

    const rest = trimmed.slice(i);
    const op = matchAssignmentOp(rest);
    if (!op) return null;

    const rhsRaw = cleanText(rest.slice(op.length));
    const currentVal = getVar(varName);

    if (op === '=') {
        const val = rhsRaw === '' ? "" : evaluateExpression(rhsRaw);
        if (Array.isArray(val)) {
            setVar(varName, formatArrayAsCasicString(val));
        } else if (isPlainDictObject(val)) {
            setVar(varName, formatDictAsJsonString(val));
        } else {
            setVar(varName, String(val));
        }
        return { executed: true };
    }

    if (op === '+=') {
        const rhsVal = rhsRaw === '' ? "1" : evaluateExpression(rhsRaw);
        const nextVal = applyNumericBinaryOp(currentVal, rhsVal, '+');
        setVar(varName, nextVal);
        return { executed: true };
    }

    if (op === '-=') {
        const rhsVal = rhsRaw === '' ? "1" : evaluateExpression(rhsRaw);
        const nextVal = applyNumericBinaryOp(currentVal, rhsVal, '-');
        setVar(varName, nextVal);
        return { executed: true };
    }

    if (op === '&=') {
        const rhsVal = rhsRaw === '' ? "" : evaluateExpression(rhsRaw);
        setVar(varName, toDisplayString(currentVal) + toDisplayString(rhsVal));
        return { executed: true };
    }

    if (op === '*=') {
        const rhsVal = rhsRaw === '' ? "0" : evaluateExpression(rhsRaw);
        const nextVal = applyNumericBinaryOp(currentVal, rhsVal, '*');
        setVar(varName, nextVal);
        return { executed: true };
    }

    if (op === '/=') {
        const rhsVal = rhsRaw === '' ? "0" : evaluateExpression(rhsRaw);
        const nextVal = applyNumericBinaryOp(currentVal, rhsVal, '/');
        setVar(varName, nextVal);
        return { executed: true };
    }

    if (op === '/.=') {
        const rhsVal = rhsRaw === '' ? "0" : evaluateExpression(rhsRaw);
        const nextVal = applyNumericBinaryOp(currentVal, rhsVal, '/.');
        setVar(varName, nextVal);
        return { executed: true };
    }

    if (op === '%=') {
        const rhsVal = rhsRaw === '' ? "0" : evaluateExpression(rhsRaw);
        const nextVal = applyNumericBinaryOp(currentVal, rhsVal, '%');
        setVar(varName, nextVal);
        return { executed: true };
    }

    return null;
}

// ==========================================
// 3. 配列・変数・辞書の操作命令 (4章・5章・7章)
// ==========================================

function executeSortOrRevCommand(cmdLower, restRaw) {
    const parsed = parseCommandOptionAndTarget(restRaw);
    const targetArgs = splitCommandTargetArgs(parsed.targetStr);
    if (targetArgs.length === 0 || cleanText(targetArgs[0]) === '') {
        throw new Error(cmdLower + '命令の対象となる変数または配列を指定してください');
    }

    const firstTarget = cleanText(targetArgs[0]);

    if (cmdLower === 'rev') {
        const isArrayTarget = firstTarget.endsWith('[]') || (hasArray(firstTarget) && !Object.prototype.hasOwnProperty.call(state.vars, firstTarget.toLowerCase()));
        if (isArrayTarget) {
            const arr = cloneArrayDeep(getArray(firstTarget));
            arr.reverse();
            setArray(firstTarget, arr);
        } else {
            const str = toDisplayString(getVar(firstTarget));
            const reversed = Array.from(str).reverse().join('');
            setVar(firstTarget, reversed);
        }
        return;
    }

    let nLimit = Infinity;
    if (parsed.optStr !== null && parsed.optStr !== '') {
        nLimit = Math.max(0, Math.trunc(parseCasicNumber(evaluateExpression(parsed.optStr)).num));
    }

    if (targetArgs.length >= 2) {
        const primaryName = cleanText(targetArgs[0]);
        const primaryArr = cloneArrayDeep(getArray(primaryName));
        const count = Math.min(primaryArr.length, nLimit);

        const indices = [];
        for (let i = 0; i < count; i++) {
            indices.push(i);
        }

        const cmpFunc = (cmdLower === 'sort') ? compareCasicNumericSort : compareCasicDictSort;
        indices.sort(function(idxA, idxB) {
            return cmpFunc(primaryArr[idxA], primaryArr[idxB]);
        });

        for (let t = 0; t < targetArgs.length; t++) {
            const arrName = cleanText(targetArgs[t]);
            const origArr = cloneArrayDeep(getArray(arrName));
            const nextArr = origArr.slice();
            for (let i = 0; i < count; i++) {
                const srcIdx = indices[i];
                nextArr[i] = (srcIdx < origArr.length) ? origArr[srcIdx] : "";
            }
            setArray(arrName, nextArr);
        }
        return;
    }

    const isArrayTarget = firstTarget.endsWith('[]') || (hasArray(firstTarget) && !Object.prototype.hasOwnProperty.call(state.vars, firstTarget.toLowerCase()));

    if (isArrayTarget) {
        const arr = cloneArrayDeep(getArray(firstTarget));
        const count = Math.min(arr.length, nLimit);
        const head = arr.slice(0, count);
        const tail = arr.slice(count);
        if (cmdLower === 'sort') {
            head.sort(compareCasicNumericSort);
        } else {
            head.sort(compareCasicDictSort);
        }
        setArray(firstTarget, head.concat(tail));
    } else {
        const chars = Array.from(toDisplayString(getVar(firstTarget)));
        const count = Math.min(chars.length, nLimit);
        const head = chars.slice(0, count).sort();
        const tail = chars.slice(count);
        setVar(firstTarget, head.concat(tail).join(''));
    }
}

function executePushInsAddCommand(cmdLower, restRaw) {
    const parsed = parseCommandOptionAndTarget(restRaw);
    const args = splitCommandTargetArgs(parsed.targetStr);
    if (args.length === 0) {
        throw new Error(cmdLower + '命令の対象を指定してください');
    }

    const firstRaw = cleanText(args[0]);

    if (firstRaw.endsWith('{}')) {
        const dictName = firstRaw.slice(0, -2);
        if (!hasDict(dictName)) {
            throw new Error('辞書 "' + dictName + '{}" は宣言されていません');
        }
        const dictObj = cloneDictDeep(getDict(dictName));

        if (args.length === 3) {
            const kStr = toDisplayString(evaluateExpression(args[1]));
            const vVal = evaluateExpression(args[2]);
            dictObj[kStr] = Array.isArray(vVal) ? formatArrayAsCasicString(vVal) : toDisplayString(vVal);
            setDict(dictName, dictObj);
            return;
        }

        if (args.length === 2) {
            const secondRaw = cleanText(args[1]);
            let d2Obj = null;
            if (secondRaw.endsWith('{}')) {
                const d2Name = secondRaw.slice(0, -2);
                if (!hasDict(d2Name)) {
                    throw new Error('追加元の辞書 "' + d2Name + '{}" は宣言されていません');
                }
                d2Obj = getDict(d2Name);
            } else if (secondRaw.startsWith('{') && secondRaw.endsWith('}')) {
                const p = parseCasicJsonToDict(evaluateExpression(secondRaw));
                if (!p.valid) throw new Error('追加するJSONが無効です: ' + secondRaw);
                d2Obj = p.dict;
            } else {
                throw new Error(cmdLower + '命令で辞書同士を結合する場合、第2引数の辞書にも {} が必須です');
            }
            const keys = Object.keys(d2Obj);
            for (let i = 0; i < keys.length; i++) {
                dictObj[keys[i]] = d2Obj[keys[i]];
            }
            setDict(dictName, dictObj);
            return;
        }

        throw new Error('辞書に対する ' + cmdLower + ' 命令の引数の数が正しくありません');
    }

    const targetSpec = parseArrayTargetSpec(firstRaw);
    const arrName = targetSpec.name;

    if (args.length >= 2 && targetSpec.hasExplicitBrackets && targetSpec.bracketInside === '') {
        const secondRaw = cleanText(args[1]);
        if (secondRaw.endsWith('[]') || (secondRaw.startsWith('[') && secondRaw.endsWith(']'))) {
            const arrA = cloneArrayDeep(getArray(arrName));
            const arrB = secondRaw.endsWith('[]') ? getArray(secondRaw) : coerceToArray(evaluateExpression(secondRaw));
            setArray(arrName, arrA.concat(cloneArrayDeep(arrB)));
            return;
        }
    }

    const arr = cloneArrayDeep(getArray(arrName));
    const valToInsert = args.length >= 2 ? evaluateExpression(args[1]) : "";
    const formattedVal = Array.isArray(valToInsert) ? cloneArrayDeep(valToInsert) : String(valToInsert);

    let nPos = arr.length + 1;
    if (parsed.optStr !== null && parsed.optStr !== '') {
        nPos = Math.trunc(parseCasicNumber(evaluateExpression(parsed.optStr)).num);
    } else if (targetSpec.bracketInside !== null && targetSpec.bracketInside !== '') {
        nPos = Math.trunc(parseCasicNumber(evaluateExpression(targetSpec.bracketInside)).num);
    }

    if (nPos < 1) {
        throw new Error(cmdLower + '命令の挿入位置には1以上の整数を指定してください');
    }

    if (nPos > arr.length + 1) {
        while (arr.length < nPos - 1) {
            arr.push("");
        }
        arr.push(formattedVal);
    } else {
        arr.splice(nPos - 1, 0, formattedVal);
    }

    setArray(arrName, arr);
}

function executeReplaceCommand(restRaw) {
    const parsed = parseCommandOptionAndTarget(restRaw);
    const args = splitCommandTargetArgs(parsed.targetStr);
    if (args.length < 2) {
        throw new Error('replace命令にはカンマ区切りで対象と置換値の指定が必要です');
    }

    const targetSpec = parseArrayTargetSpec(args[0]);
    const targetName = targetSpec.name;
    const rawRangeStr = (parsed.optStr !== null && parsed.optStr !== '') ? parsed.optStr : targetSpec.bracketInside;

    if (args.length === 2) {
        const arr = cloneArrayDeep(getArray(targetName));
        const rangeInfo = parseRangeOrIndexSpec(rawRangeStr, 1, arr.length);
        if (!rangeInfo.isSpecified || rangeInfo.n === null) {
            throw new Error('replace命令で対象引数が2つの場合は要素番号nの指定が必要です');
        }
        const nPos = rangeInfo.n;
        if (nPos < 1) throw new Error('replace命令の要素番号には1以上を指定してください');
        const newVal = evaluateExpression(args[1]);
        while (arr.length < nPos) {
            arr.push("");
        }
        arr[nPos - 1] = Array.isArray(newVal) ? cloneArrayDeep(newVal) : String(newVal);
        setArray(targetName, arr);
        return;
    }

    const hasOptionRange = (rawRangeStr !== null && rawRangeStr !== undefined && cleanText(rawRangeStr) !== '');
    const isArrayMode = targetSpec.hasExplicitBrackets || hasOptionRange ||
        (hasArray(targetName) && !Object.prototype.hasOwnProperty.call(state.vars, targetName.toLowerCase()));

    const s1 = evaluateExpression(args[1]);
    const s2 = evaluateExpression(args[2]);

    if (!isArrayMode) {
        const currentStr = toDisplayString(getVar(targetName));
        const replacedStr = currentStr.split(toDisplayString(s1)).join(toDisplayString(s2));
        setVar(targetName, replacedStr);
        return;
    }

    const arr = cloneArrayDeep(getArray(targetName));
    const rangeInfo = parseRangeOrIndexSpec(rawRangeStr, 1, arr.length);
    const n1 = Math.max(1, rangeInfo.isRange ? rangeInfo.n1 : (rangeInfo.isSpecified ? rangeInfo.n : 1));
    const n2 = Math.min(arr.length, rangeInfo.isRange ? rangeInfo.n2 : (rangeInfo.isSpecified ? rangeInfo.n : arr.length));
    const formattedS2 = Array.isArray(s2) ? cloneArrayDeep(s2) : String(s2);

    for (let idx = n1; idx <= n2; idx++) {
        if (areCasicValuesEqual(arr[idx - 1], s1)) {
            arr[idx - 1] = formattedS2;
        }
    }
    setArray(targetName, arr);
}

function executeDelCommand(restRaw) {
    const parsed = parseCommandOptionAndTarget(restRaw);
    const args = splitCommandTargetArgs(parsed.targetStr);
    if (args.length === 0) {
        throw new Error('del命令の対象を指定してください');
    }

    const firstRaw = cleanText(args[0]);

    if (firstRaw.endsWith('{}')) {
        if (args.length < 2) {
            throw new Error('辞書に対するdel命令では削除するキーを指定してください (例: del d{}, "key")');
        }
        const dictName = firstRaw.slice(0, -2);
        if (!hasDict(dictName)) {
            throw new Error('辞書 "' + dictName + '{}" は宣言されていません');
        }
        const dictObj = cloneDictDeep(getDict(dictName));
        const keyStr = toDisplayString(evaluateExpression(args[1]));
        delete dictObj[keyStr];
        setDict(dictName, dictObj);
        return;
    }

    const targetSpec = parseArrayTargetSpec(firstRaw);
    const arrName = targetSpec.name;
    const arr = cloneArrayDeep(getArray(arrName));
    if (arr.length === 0) return;

    const rawRangeStr = (parsed.optStr !== null && parsed.optStr !== '') ? parsed.optStr : targetSpec.bracketInside;

    if (args.length === 1) {
        const rangeInfo = parseRangeOrIndexSpec(rawRangeStr, arr.length, arr.length);
        if (!rangeInfo.isSpecified) {
            arr.pop();
            setArray(arrName, arr);
            return;
        }
        const n1 = Math.max(1, rangeInfo.n1);
        const n2 = Math.min(arr.length, rangeInfo.n2);
        if (n1 <= n2 && n1 <= arr.length) {
            arr.splice(n1 - 1, n2 - n1 + 1);
        }
        setArray(arrName, arr);
        return;
    }

    const rangeInfo = parseRangeOrIndexSpec(rawRangeStr, 1, arr.length);
    const n1 = Math.max(1, rangeInfo.isSpecified ? rangeInfo.n1 : 1);
    const n2 = Math.min(arr.length, rangeInfo.isSpecified ? rangeInfo.n2 : arr.length);
    const targetVal = evaluateExpression(args[1]);

    const nextArr = [];
    for (let i = 0; i < arr.length; i++) {
        const oneBased = i + 1;
        if (oneBased >= n1 && oneBased <= n2 && areCasicValuesEqual(arr[i], targetVal)) {
            continue;
        }
        nextArr.push(arr[i]);
    }
    setArray(arrName, nextArr);
}

function executeClearOrUniqCommand(cmdLower, restRaw) {
    const trimmed = cleanText(restRaw);
    if (cmdLower === 'clear' && trimmed.endsWith('{}')) {
        const dictName = trimmed.slice(0, -2);
        if (!hasDict(dictName)) {
            throw new Error('辞書 "' + dictName + '{}" は宣言されていません');
        }
        setDict(dictName, {});
        return;
    }

    const targetSpec = parseArrayTargetSpec(trimmed);
    const arrName = targetSpec.name;
    if (!arrName) {
        throw new Error(cmdLower + '命令の対象を指定してください');
    }
    if (cmdLower === 'clear') {
        setArray(arrName, []);
        return;
    }
    if (cmdLower === 'uniq') {
        const arr = getArray(arrName);
        const uniqueArr = [];
        for (let i = 0; i < arr.length; i++) {
            let exists = false;
            for (let j = 0; j < uniqueArr.length; j++) {
                if (areCasicValuesEqual(uniqueArr[j], arr[i])) {
                    exists = true;
                    break;
                }
            }
            if (!exists) uniqueArr.push(arr[i]);
        }
        setArray(arrName, uniqueArr);
    }
}

function executeRenameCommand(restRaw) {
    const args = splitCommandTargetArgs(restRaw);
    if (args.length < 3) {
        throw new Error('rename命令には rename d{}, s1, s2 の形式で3つの引数が必要です');
    }
    const firstRaw = cleanText(args[0]);
    if (!firstRaw.endsWith('{}')) {
        throw new Error('rename命令の第1引数には辞書 d{} を指定してください');
    }
    const dictName = firstRaw.slice(0, -2);
    if (!hasDict(dictName)) {
        throw new Error('辞書 "' + dictName + '{}" は宣言されていません');
    }
    const oldKey = toDisplayString(evaluateExpression(args[1]));
    const newKey = toDisplayString(evaluateExpression(args[2]));
    const oldDict = getDict(dictName);

    if (!Object.prototype.hasOwnProperty.call(oldDict, oldKey)) {
        return;
    }

    const nextDict = {};
    const keys = Object.keys(oldDict);
    for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (k === oldKey) {
            nextDict[newKey] = oldDict[k];
        } else {
            nextDict[k] = oldDict[k];
        }
    }
    setDict(dictName, nextDict);
}

function executeSeedCommand(restRaw) {
    const trimmed = cleanText(restRaw);
    if (trimmed === '') {
        state.rngSeed = null;
        return;
    }
    const val = evaluateExpression(trimmed);
    const parsed = parseCasicNumber(val);
    state.rngSeed = Math.trunc(parsed.num) | 0;
}

function executeJsCommand(restRaw) {
    const trimmed = cleanText(restRaw);
    if (trimmed === '') return;
    const jsCode = toDisplayString(evaluateExpression(trimmed));
    const fn = new Function(jsCode);
    fn();
}

function executeFetchCommand(restRaw) {
    const parsed = parseCommandOptionAndTarget(restRaw);
    const args = splitCommandTargetArgs(parsed.targetStr);
    if (args.length < 2) throw new Error('fetch命令には代入先の変数とURLを指定してください');
    
    const varName = cleanText(args[0]);
    if (!isValidVarIdentifier(varName)) {
        throw new Error('fetch命令の代入先には有効な変数名を指定してください: ' + varName);
    }
    const urlStr = toDisplayString(evaluateExpression(args[1]));
    
    let isSync = true;
    if (parsed.optStr !== null && parsed.optStr !== '') {
        isSync = isCasicTruthy(evaluateExpression(parsed.optStr));
    }

    if (!isSync) {
        fetch(urlStr).then(function(res) {
            if (res.ok) return res.text();
            return "";
        }).then(function(text) {
            setVar(varName, text);
            if (typeof renderMemoryUI === 'function') renderMemoryUI();
        }).catch(function(e) {
            console.warn("Fetch (async) error:", e);
        });
        setVar(varName, "");
    } else {
        try {
            state.warnings.push('[警告] fetch命令(同期) が実行されました。通信中は画面がフリーズします。');
            const xhr = new XMLHttpRequest();
            xhr.open('GET', urlStr, false);
            xhr.send(null);
            if (xhr.status === 200) {
                setVar(varName, xhr.responseText);
            } else {
                setVar(varName, "");
            }
        } catch (e) {
            setVar(varName, "");
        }
    }
}

// ==========================================
// 4. 入出力の命令（in / charin / allin / resetin / out / put）
// ==========================================

function splitInTargetList(targetStr) {
    const s = cleanText(targetStr);
    if (s === '') return [];
    const items = [];
    let current = '';
    let bracketDepth = 0;
    let parenDepth = 0;
    let quoteChar = null;

    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if ((ch === '"' || ch === "'") && s[i - 1] !== CHAR_BSLASH) {
            if (quoteChar === null) quoteChar = ch;
            else if (quoteChar === ch) quoteChar = null;
            current += ch;
            continue;
        }
        if (quoteChar === null) {
            if (ch === '[') bracketDepth++;
            else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);
            else if (ch === '(') parenDepth++;
            else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);

            if (bracketDepth === 0 && parenDepth === 0 && (ch === ',' || isSpaceChar(ch))) {
                if (cleanText(current) !== '') {
                    items.push(cleanText(current));
                    current = '';
                }
                continue;
            }
        }
        current += ch;
    }
    if (cleanText(current) !== '') {
        items.push(cleanText(current));
    }
    return items;
}

function resolveInSeparatorOption(optStr) {
    if (optStr === null || optStr === undefined) return null;
    const s = cleanText(optStr);
    if (s === '') return null;
    if (s.length === 1 && isReservedSymbolChar(s[0])) {
        return s;
    }
    return toDisplayString(evaluateExpression(s));
}

function executeInCommand(restRaw) {
    const parsed = parseCommandOptionAndTarget(restRaw);
    const customSep = resolveInSeparatorOption(parsed.optStr);
    const rawTargets = splitInTargetList(parsed.targetStr);

    if (rawTargets.length === 0) {
        throw new Error('in命令の代入先となる変数または配列を指定してください');
    }

    const varTargets = [];
    const arrTargets = [];

    for (let i = 0; i < rawTargets.length; i++) {
        const t = rawTargets[i];
        const spec = parseArrayTargetSpec(t);
        if (spec.hasExplicitBrackets) {
            if (!isValidVarIdentifier(spec.name)) {
                throw new Error('in命令の配列名が正しくありません: ' + spec.name);
            }
            let maxCount = Infinity;
            if (spec.bracketInside !== null && spec.bracketInside !== '') {
                const nVal = evaluateExpression(spec.bracketInside);
                maxCount = Math.max(0, Math.trunc(parseCasicNumber(nVal).num));
            }
            arrTargets.push({
                name: spec.name,
                key: stripArraySuffix(spec.name),
                maxCount: maxCount,
                addedCount: 0
            });
        } else {
            if (!isValidVarIdentifier(t)) {
                throw new Error('in命令の変数名が正しくありません: ' + t);
            }
            varTargets.push(t);
        }
    }

    if (varTargets.length > 0 && arrTargets.length > 0) {
        throw new Error('in命令では変数と配列を混ぜて指定することはできません');
    }

    if (varTargets.length > 0) {
        for (let i = 0; i < varTargets.length; i++) {
            const tokRes = readNextInputToken(customSep, true);
            setVar(varTargets[i], tokRes.eof ? "" : String(tokRes.token));
        }
        return;
    }

    const workingArrays = {};
    for (let i = 0; i < arrTargets.length; i++) {
        const key = arrTargets[i].key;
        if (!Object.prototype.hasOwnProperty.call(workingArrays, key)) {
            workingArrays[key] = cloneArrayDeep(getArray(arrTargets[i].name));
        }
    }

    while (true) {
        let anyRemainingSlot = false;
        for (let i = 0; i < arrTargets.length; i++) {
            if (arrTargets[i].addedCount < arrTargets[i].maxCount) {
                anyRemainingSlot = true;
                break;
            }
        }
        if (!anyRemainingSlot) break;

        let eofReached = false;
        for (let i = 0; i < arrTargets.length; i++) {
            const target = arrTargets[i];
            if (target.addedCount >= target.maxCount) continue;

            const tokRes = readNextInputToken(customSep, true);
            if (tokRes.eof) {
                eofReached = true;
                break;
            }
            workingArrays[target.key].push(String(tokRes.token));
            target.addedCount++;
        }

        if (eofReached) break;
    }

    for (let i = 0; i < arrTargets.length; i++) {
        const name = arrTargets[i].name;
        const key = arrTargets[i].key;
        setArray(name, workingArrays[key]);
    }
}

function executeCharinCommand(restRaw) {
    const parsed = parseCommandOptionAndTarget(restRaw);
    const varName = cleanText(parsed.targetStr);
    if (!isValidVarIdentifier(varName)) {
        throw new Error('charin命令には有効な変数名を指定してください');
    }

    let nChars = 1;
    if (parsed.optStr !== null && parsed.optStr !== '') {
        const nVal = evaluateExpression(parsed.optStr);
        nChars = Math.max(0, Math.trunc(parseCasicNumber(nVal).num));
    }

    const str = readInputChars(nChars, true);
    setVar(varName, str);
}

function executeAllinCommand(restRaw) {
    const varName = cleanText(restRaw);
    if (!isValidVarIdentifier(varName)) {
        throw new Error('allin命令には有効な変数名を指定してください');
    }
    const remaining = readRemainingInput();
    setVar(varName, remaining);
}

function executeResetinCommand(restRaw) {
    const trimmed = cleanText(restRaw);
    if (trimmed !== '') {
        throw new Error('resetin命令に引数は指定できません');
    }
    state.inputPtr = 0;
}

function flushFunctionOutput(baseOut) {
    if (state.funcOutputBuffer !== '') {
        const combined = state.funcOutputBuffer + (baseOut || '');
        state.funcOutputBuffer = '';
        return combined;
    }
    return baseOut || '';
}

function executeOutputCommand(cmdLower, restRaw) {
    const isNewline = (cmdLower === 'out' || cmdLower === 'print');
    const suffix = isNewline ? '\n' : '';
    const trimmed = cleanText(restRaw);

    if (trimmed === '') {
        return suffix;
    }

    let sep = ' ';
    let targetExpr = trimmed;

    if (trimmed.startsWith('(')) {
        const paren = extractParenHead(trimmed);
        if (paren) {
            const inside = paren.inside;
            const after = paren.after;

            if (after === '') {
                if (inside === '') return suffix;
                targetExpr = trimmed;
            } else {
                const startsWithOperator = (
                    after.startsWith('+') || after.startsWith('-') || after.startsWith('*') ||
                    after.startsWith(CHAR_MUL_U) || after.startsWith(CHAR_DIV_U) ||
                    after.startsWith('/.') || after.startsWith('%') || after.startsWith('&') ||
                    after.startsWith(CHAR_CARET) || after.startsWith('<') || after.startsWith('>') ||
                    after.startsWith('=') || after.startsWith('!') || after.startsWith('|') ||
                    after.startsWith('{')
                );
                const lowerAfter = after.toLowerCase();
                const startsWithWordOp = (
                    (lowerAfter.startsWith('and') && isSpaceChar(lowerAfter[3])) ||
                    (lowerAfter.startsWith('xor') && isSpaceChar(lowerAfter[3])) ||
                    (lowerAfter.startsWith('or') && isSpaceChar(lowerAfter[2]))
                );
                const isSlashDiv = after.startsWith('/') && !after.startsWith('/.') && inside !== '' && !after.startsWith('/[');

                if (!startsWithOperator && !startsWithWordOp && !isSlashDiv) {
                    if (inside === '') {
                        sep = ' ';
                    } else if (inside.length === 1 && isReservedSymbolChar(inside[0])) {
                        sep = inside;
                    } else {
                        sep = toDisplayString(evaluateExpression(inside));
                    }
                    targetExpr = after;
                }
            }
        }
    }

    const val = evaluateExpression(targetExpr);
    if (Array.isArray(val)) {
        return val.map(toDisplayString).join(sep) + suffix;
    } else if (isPlainDictObject(val)) {
        return formatDictAsJsonString(val) + suffix;
    } else {
        return toDisplayString(val) + suffix;
    }
}

// ==========================================
// 5. 描画・音声命令（g_*, a_*）の実行
// ==========================================

const activeAudios = {};

function executeGraphicsOrAudioCommand(cmdLower, restRaw, lineNum) {
    if (cmdLower.startsWith('g_') && typeof casicCanvas !== 'undefined') {
        casicCanvas.show();
    }
    
    const parsed = parseCommandOptionAndTarget(restRaw);
    const args = splitCommandTargetArgs(parsed.targetStr);
    const offCtx = typeof casicCanvas !== 'undefined' ? casicCanvas.getOffscreenCtx() : null;

    function getOptDict() {
        if (parsed.optStr) {
            const v = evaluateExpression(parsed.optStr);
            if (isPlainDictObject(v)) return v;
            return parseCasicJsonToDict(v).dict || {};
        }
        return {};
    }

    function num(expr, def) {
        if (expr === undefined || expr === null || cleanText(expr) === '') return def;
        return parseCasicNumber(evaluateExpression(expr)).num;
    }
    
    function str(expr, def) {
        if (expr === undefined || expr === null || cleanText(expr) === '') return def;
        return toDisplayString(evaluateExpression(expr));
    }

    if (cmdLower === 'g_size') {
        if (typeof casicCanvas !== 'undefined') casicCanvas.setSize(num(args[0], 480), num(args[1], 360));
        return;
    }
    if (cmdLower === 'g_smooth') {
        if (typeof casicCanvas !== 'undefined') casicCanvas.setSmooth(isCasicTruthy(evaluateExpression(args[0] || "true")));
        return;
    }
    if (cmdLower === 'g_clear') {
        if (typeof casicCanvas !== 'undefined') casicCanvas.clear(str(args[0], "#ffffff"));
        return;
    }
    
    if (!offCtx && cmdLower.startsWith('g_')) return;

    if (cmdLower === 'g_line') {
        const optArgs = parsed.optStr ? splitTopLevelComma(parsed.optStr) : [];
        const w = num(optArgs[0], 1);
        const c = str(optArgs[1], "#000000");
        const b = isCasicTruthy(optArgs[2] ? evaluateExpression(optArgs[2]) : "0");

        let coords = [];
        if (args.length === 1) {
            const v = evaluateExpression(args[0]);
            if (Array.isArray(v)) {
                coords = coerceToArray(v).map(val => parseCasicNumber(val).num);
            } else {
                coords = [parseCasicNumber(v).num];
            }
        } else {
            coords = args.map(a => num(a, 0));
        }
        coords = coords.flat(Infinity).map(Number);

        if (coords.length < 4) return;

        offCtx.save();
        offCtx.lineWidth = w;
        offCtx.strokeStyle = c;
        if (b) {
            offCtx.lineCap = 'round';
            offCtx.lineJoin = 'round';
        }
        offCtx.beginPath();
        offCtx.moveTo(coords[0], casicCanvas.transformY(coords[1]));
        for (let i = 2; i + 1 < coords.length; i += 2) {
            offCtx.lineTo(coords[i], casicCanvas.transformY(coords[i+1]));
        }
        offCtx.stroke();
        offCtx.restore();
        return;
    }

    if (cmdLower === 'g_poly') {
        const d = getOptDict();
        const color = d['color'] !== undefined ? String(d['color']) : '#000000';
        const r = Number(d['r']) || 0;
        const alpha = d['alpha'] !== undefined ? Number(d['alpha']) : 1;
        const fill = d['fill'] !== undefined ? isCasicTruthy(d['fill']) : true;
        const frame = Number(d['frame']) || 1;

        let coords = [];
        if (args.length === 1) {
            const v = evaluateExpression(args[0]);
            coords = coerceToArray(v).flat(Infinity).map(val => parseCasicNumber(val).num);
        } else {
            coords = args.map(a => num(a, 0)).flat(Infinity);
        }

        if (coords.length < 6) return; // 最低3点必要

        offCtx.save();
        offCtx.globalAlpha = alpha;
        if (fill) {
            offCtx.fillStyle = color;
        } else {
            offCtx.strokeStyle = color;
            offCtx.lineWidth = frame;
        }
        if (r > 0) {
            offCtx.lineJoin = 'round';
        }

        offCtx.beginPath();
        offCtx.moveTo(coords[0], casicCanvas.transformY(coords[1]));
        for (let i = 2; i + 1 < coords.length; i += 2) {
            offCtx.lineTo(coords[i], casicCanvas.transformY(coords[i+1]));
        }
        offCtx.closePath();

        if (fill) offCtx.fill();
        else offCtx.stroke();
        offCtx.restore();
        return;
    }

    if (cmdLower === 'g_rect') {
        let d = {};
        if (args.length >= 3) {
            const c = str(args[0], "#000000");
            const x1 = num(args[1], 0);
            const y1 = num(args[2], 0);
            const x2 = num(args[3], x1);
            const y2 = num(args[4], y1);
            d = {
                color: c,
                x: (x1 + x2) / 2,
                y: (y1 + y2) / 2,
                w: Math.abs(x2 - x1),
                h: Math.abs(y2 - y1),
                fill: 1
            };
        } else {
            if (args.length === 1) {
                const v = evaluateExpression(args[0]);
                if (isPlainDictObject(v)) d = v;
            }
            if (Object.keys(d).length === 0) d = getOptDict();
        }

        const x = Number(d['x']) || 0;
        const y = Number(d['y']) || 0;
        const w = Number(d['w']) || 1;
        const h = Number(d['h']) || 1;
        const rot = Number(d['rot']) || 0;
        const r = Number(d['r']) || 0;
        const alpha = d['alpha'] !== undefined ? Number(d['alpha']) : 1;
        const color = d['color'] !== undefined ? String(d['color']) : '#000000';
        const fill = d['fill'] !== undefined ? isCasicTruthy(d['fill']) : true;
        const frame = Number(d['frame']) || 1;

        offCtx.save();
        offCtx.globalAlpha = alpha;
        offCtx.translate(x, casicCanvas.transformY(y));
        offCtx.rotate(rot * Math.PI / 180);
        
        if (fill) offCtx.fillStyle = color;
        else {
            offCtx.strokeStyle = color;
            offCtx.lineWidth = frame;
        }

        if (r > 0 && typeof offCtx.roundRect === 'function') {
            offCtx.beginPath();
            offCtx.roundRect(-w/2, -h/2, w, h, r);
            if (fill) offCtx.fill();
            else offCtx.stroke();
        } else {
            if (fill) offCtx.fillRect(-w/2, -h/2, w, h);
            else offCtx.strokeRect(-w/2, -h/2, w, h);
        }
        offCtx.restore();
        return;
    }

    if (cmdLower === 'g_circle') {
        let d = {};
        if (args.length >= 4) {
            d = {
                color: str(args[0], "#000000"),
                x: num(args[1], 0),
                y: num(args[2], 0),
                w: num(args[3], 0) * 2,
                h: num(args[3], 0) * 2,
                fill: 1
            };
        } else {
            if (args.length === 1) {
                const v = evaluateExpression(args[0]);
                if (isPlainDictObject(v)) d = v;
            }
            if (Object.keys(d).length === 0) d = getOptDict();
        }

        const x = Number(d['x']) || 0;
        const y = Number(d['y']) || 0;
        const w = Number(d['w']) || 1;
        const h = Number(d['h']) || 1;
        const alpha = d['alpha'] !== undefined ? Number(d['alpha']) : 1;
        const color = d['color'] !== undefined ? String(d['color']) : '#000000';
        const fill = d['fill'] !== undefined ? isCasicTruthy(d['fill']) : true;
        const frame = Number(d['frame']) || 1;
        const rot = Number(d['rot']) || 0;

        offCtx.save();
        offCtx.globalAlpha = alpha;
        offCtx.translate(x, casicCanvas.transformY(y));
        offCtx.rotate(rot * Math.PI / 180);

        offCtx.beginPath();
        offCtx.ellipse(0, 0, w/2, h/2, 0, 0, 2 * Math.PI);
        
        if (fill) {
            offCtx.fillStyle = color;
            offCtx.fill();
        } else {
            offCtx.strokeStyle = color;
            offCtx.lineWidth = frame;
            offCtx.stroke();
        }
        offCtx.restore();
        return;
    }

    if (cmdLower === 'g_image') {
        const d = getOptDict();
        const s = str(args[0], "");
        const imgAsset = typeof getImportedImage === 'function' ? getImportedImage(s) : null;
        if (!imgAsset || !imgAsset.img) {
            state.warnings.push('[Line ' + lineNum + '] 画像 "' + s + '" が見つからないかインポートされていません');
            return;
        }

        const img = imgAsset.img;
        let clipX = 0, clipY = 0, clipW = img.width, clipH = img.height;
        if (d['clip'] && d['clip'] !== '' && d['clip'] !== '[]') {
            const clipArr = coerceToArray(evaluateExpression(d['clip']));
            if (clipArr.length >= 4) {
                clipX = Number(clipArr[0]) || 0;
                clipY = Number(clipArr[1]) || 0;
                clipW = Number(clipArr[2]) || img.width;
                clipH = Number(clipArr[3]) || img.height;
                // CASIC側のclipは左下が基準。imgのdrawImageは左上が基準。
                clipY = img.height - clipY - clipH;
            }
        }

        const w = d['w'] !== undefined && d['w'] !== '' ? Number(d['w']) : clipW;
        const h = d['h'] !== undefined && d['h'] !== '' ? Number(d['h']) : clipH;
        const x = Number(d['x']) || 0;
        const y = Number(d['y']) || 0;
        const cx = d['cx'] !== undefined && d['cx'] !== '' ? Number(d['cx']) : w / 2;
        const cy = d['cy'] !== undefined && d['cy'] !== '' ? Number(d['cy']) : h / 2;
        const rot = Number(d['rot']) || 0;
        const alpha = d['alpha'] !== undefined ? Number(d['alpha']) : 1;
        const flipx = isCasicTruthy(d['flipx']);
        const flipy = isCasicTruthy(d['flipy']);
        const hue = Number(d['hue']) || 0;

        offCtx.save();
        offCtx.globalAlpha = alpha;
        if (hue !== 0) {
            offCtx.filter = `hue-rotate(${hue}deg)`;
        }

        offCtx.translate(x, casicCanvas.transformY(y));
        offCtx.rotate(rot * Math.PI / 180);
        offCtx.scale(flipx ? -1 : 1, flipy ? -1 : 1);
        offCtx.drawImage(img, clipX, clipY, clipW, clipH, -cx, -(h - cy), w, h);
        
        offCtx.restore();
        return;
    }

    if (cmdLower === 'g_text') {
        const d = getOptDict();
        const text = str(args[0], "");
        const x = Number(d['x']) || 0;
        const y = Number(d['y']) || 0;
        const size = Number(d['size']) || 30;
        const font = typeof resolveCasicFontFamily === 'function' ? resolveCasicFontFamily(String(d['font'] || '')) : 'sans-serif';
        const color = d['color'] !== undefined ? String(d['color']) : '#000000';
        const alpha = d['alpha'] !== undefined ? Number(d['alpha']) : 1;
        const rot = Number(d['rot']) || 0;
        
        const alignStr = String(d['align'] || 'left').toLowerCase();
        const valignStr = String(d['valign'] || 'up').toLowerCase();
        
        let hAlign = 'left';
        if (alignStr === 'middle' || alignStr === 'center') hAlign = 'center';
        if (alignStr === 'right') hAlign = 'right';
        
        let vAlign = 'top';
        if (valignStr === 'up') vAlign = 'top';
        if (valignStr === 'middle' || valignStr === 'center') vAlign = 'middle';
        if (valignStr === 'down') vAlign = 'bottom';

        offCtx.save();
        offCtx.globalAlpha = alpha;
        offCtx.font = `${size}px ${font}`;
        offCtx.fillStyle = color;
        offCtx.textAlign = hAlign;
        offCtx.textBaseline = vAlign;

        offCtx.translate(x, casicCanvas.transformY(y));
        offCtx.rotate(rot * Math.PI / 180);
        
        // 改行と幅制限
        const wLimit = d['w'] !== undefined && d['w'] !== '' && d['w'] !== '∞' ? Number(d['w']) : Infinity;
        const lineH = d['h'] !== undefined && d['h'] !== '' ? Number(d['h']) : size * 1.3;

        const lines = text.split('\n');
        const drawLines = [];
        for (let i = 0; i < lines.length; i++) {
            if (wLimit === Infinity) {
                drawLines.push(lines[i]);
            } else {
                let currentLine = '';
                for (let j = 0; j < lines[i].length; j++) {
                    const testLine = currentLine + lines[i][j];
                    const metrics = offCtx.measureText(testLine);
                    if (metrics.width > wLimit && j > 0) {
                        drawLines.push(currentLine);
                        currentLine = lines[i][j];
                    } else {
                        currentLine = testLine;
                    }
                }
                drawLines.push(currentLine);
            }
        }

        // HTML CanvasのY軸は下方向。CASICではYが増えると上方向だが
        // 文字列の複数行は下へ進むのが自然なので Canvas Y を足していく。
        let currentY = 0;
        if (vAlign === 'middle') {
            currentY = - (drawLines.length - 1) * lineH / 2;
        } else if (vAlign === 'bottom') {
            currentY = - (drawLines.length - 1) * lineH;
        }

        for (let i = 0; i < drawLines.length; i++) {
            offCtx.fillText(drawLines[i], 0, currentY);
            currentY += lineH;
        }

        offCtx.restore();
        return;
    }

    if (cmdLower === 'a_play') {
        const d = getOptDict();
        const s1 = str(args[0], "");
        const s2 = args.length > 1 ? str(args[1], "") : s1;

        const audioAsset = typeof getImportedAudio === 'function' ? getImportedAudio(s1) : null;
        if (!audioAsset || !audioAsset.url) {
            state.warnings.push('[Line ' + lineNum + '] 音声 "' + s1 + '" が見つからないかインポートされていません');
            return;
        }

        const vol = d['vol'] !== undefined ? Number(d['vol']) : 1;
        const loop = isCasicTruthy(d['loop']);
        const pitch = d['pitch'] !== undefined ? Number(d['pitch']) : 1;
        const startSec = Number(d['start']) || 0;
        const endSec = d['end'] !== undefined && d['end'] !== '' ? Number(d['end']) : null;

        const audio = new Audio(audioAsset.url);
        audio.volume = Math.max(0, Math.min(1, vol));
        audio.loop = loop;
        audio.playbackRate = Math.max(0.1, Math.min(16, pitch));
        audio.currentTime = startSec;
        
        if (endSec !== null) {
            audio.addEventListener('timeupdate', function handleTime() {
                if (audio.currentTime >= endSec) {
                    if (loop) {
                        audio.currentTime = startSec;
                    } else {
                        audio.pause();
                        audio.removeEventListener('timeupdate', handleTime);
                    }
                }
            });
        }

        audio.play().catch(e => console.warn("Audio play failed", e));
        activeAudios[s2] = audio;
        return;
    }

    if (cmdLower === 'a_stop') {
        const s = str(args[0], "");
        if (s === '') {
            for (const k in activeAudios) {
                activeAudios[k].pause();
            }
        } else {
            if (activeAudios[s]) {
                activeAudios[s].pause();
            }
        }
        return;
    }
}