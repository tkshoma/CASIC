// ==========================================
// 1. 構造ブロック解析（if / elseif / else / for / while / fun / end）
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

function parseFunHeader(restAfterFun) {
    const s = cleanText(restAfterFun);
    if (s === '' || !isIdentStartChar(s[0])) {
        return { error: 'fun命令の後に有効な関数名がありません' };
    }

    let i = 1;
    while (i < s.length && isIdentPartChar(s[i])) i++;
    const funcName = s.slice(0, i);
    const funcNameLower = funcName.toLowerCase();

    if (BUILTIN_FUNCTION_NAMES.has(funcNameLower)) {
        return { error: '組み込み関数 "' + funcName + '" と同じ名前の関数は定義できません' };
    }

    const afterName = cleanText(s.slice(i));
    const paren = extractParenHead(afterName);
    if (!paren) {
        return { error: 'fun ' + funcName + ' の後に引数括弧 (...) がありません' };
    }

    const params = [];
    if (paren.inside !== '') {
        const rawParams = splitTopLevelComma(paren.inside);
        for (let pIdx = 0; pIdx < rawParams.length; pIdx++) {
            const pName = cleanText(rawParams[pIdx]);
            if (!isValidVarIdentifier(pName)) {
                return { error: '関数 "' + funcName + '" の引数名 "' + pName + '" が正しくありません' };
            }
            params.push(pName.toLowerCase());
        }
    }

    return {
        error: null,
        funcName: funcName,
        funcNameLower: funcNameLower,
        params: params,
        inlineCode: paren.after
    };
}

function classifyControlLine(rawLine) {
    const uncommented = cleanText(stripLineComment(rawLine));
    if (uncommented === '') return { kind: 'normal' };

    const i = readCommandWordLength(uncommented);
    if (i === 0) return { kind: 'normal' };

    const kw = uncommented.slice(0, i).toLowerCase();
    const rawAfterKw = uncommented.slice(i);
    const rest = cleanText(rawAfterKw);

    if (matchAssignmentOp(rest) !== null || rest.startsWith('[') || rest.startsWith('{')) {
        return { kind: 'normal' };
    }

    if (kw === 'fun' && (rawAfterKw === '' || isSpaceChar(rawAfterKw[0]))) {
        const parsedFun = parseFunHeader(rest);
        if (parsedFun.error) {
            return { kind: 'error', keyword: 'fun', message: parsedFun.error };
        }
        const isSingle = (parsedFun.inlineCode !== '');
        return {
            kind: isSingle ? 'fun_single' : 'fun_multi',
            keyword: 'fun',
            funcName: parsedFun.funcName,
            funcNameLower: parsedFun.funcNameLower,
            params: parsedFun.params,
            inlineCode: parsedFun.inlineCode
        };
    }

    if (kw === 'if' || kw === 'for' || kw === 'while') {
        const paren = extractParenHead(rest);
        if (!paren) {
            return { kind: 'error', keyword: kw, message: kw + '命令の後に正しい (条件) がありません' };
        }
        const isSingleLine = (paren.after !== '');
        return {
            kind: isSingleLine ? (kw + '_single') : (kw + '_multi'),
            keyword: kw,
            condExpr: paren.inside,
            inlineCode: paren.after
        };
    }

    if (kw === 'elseif') {
        const paren = extractParenHead(rest);
        if (!paren) {
            return { kind: 'error', keyword: 'elseif', message: 'elseif命令の後に正しい (条件) がありません' };
        }
        return {
            kind: 'elseif',
            keyword: 'elseif',
            condExpr: paren.inside,
            inlineCode: paren.after
        };
    }

    if (kw === 'else') {
        if (rawAfterKw !== '' && !isSpaceChar(rawAfterKw[0]) && rawAfterKw[0] !== ':' && rawAfterKw[0] !== '"' && rawAfterKw[0] !== '/') {
            return { kind: 'normal' };
        }
        return {
            kind: 'else',
            keyword: 'else',
            inlineCode: rest
        };
    }

    if (kw === 'end') {
        if (rest === '') {
            return { kind: 'end', keyword: 'end' };
        }
    }

    return { kind: 'normal' };
}

function buildControlFlowStructure(lines, startLineOffset = 1, registerFunctions = true) {
    const lineInfos = [];
    const stack = [];
    const errors = [];
    const enclosingBlockStackByLine = [];
    const multiFunBlocks = [];

    for (let idx = 0; idx < lines.length; idx++) {
        const lineNum = startLineOffset + idx;
        const info = classifyControlLine(lines[idx]);
        info.lineIdx = idx;
        lineInfos.push(info);

        enclosingBlockStackByLine[idx] = stack.slice();

        if (info.kind === 'error') {
            errors.push('[Line ' + lineNum + '] ' + info.message);
            continue;
        }

        if (info.kind === 'fun_single') {
            if (registerFunctions) {
                state.functions[info.funcNameLower] = {
                    name: info.funcName,
                    nameLower: info.funcNameLower,
                    params: info.params,
                    isSingleLine: true,
                    inlineCode: info.inlineCode,
                    bodyLines: [],
                    startLineOffset: lineNum
                };
            }
        } else if (info.kind === 'fun_multi') {
            const block = {
                type: 'fun',
                funcName: info.funcName,
                funcNameLower: info.funcNameLower,
                params: info.params,
                startLine: idx,
                endLine: lines.length
            };
            info.block = block;
            stack.push(block);
            multiFunBlocks.push(block);
        } else if (info.kind === 'if_multi') {
            const block = {
                type: 'if',
                startLine: idx,
                branches: [{ lineIdx: idx, kind: 'if', condExpr: info.condExpr, inlineCode: '' }],
                hasElse: false,
                endLine: lines.length
            };
            info.block = block;
            info.branchIndex = 0;
            stack.push(block);
        } else if (info.kind === 'for_multi') {
            const block = {
                type: 'for',
                startLine: idx,
                condExpr: info.condExpr,
                endLine: lines.length
            };
            info.block = block;
            stack.push(block);
        } else if (info.kind === 'while_multi') {
            const block = {
                type: 'while',
                startLine: idx,
                condExpr: info.condExpr,
                endLine: lines.length
            };
            info.block = block;
            stack.push(block);
        } else if (info.kind === 'elseif') {
            const top = stack.length > 0 ? stack[stack.length - 1] : null;
            if (!top || top.type !== 'if') {
                errors.push('[Line ' + lineNum + '] 対応する複数行ifがない場所でelseifが使用されています');
            } else if (top.hasElse) {
                errors.push('[Line ' + lineNum + '] elseの後にelseifを記述することはできません');
            } else {
                info.block = top;
                info.branchIndex = top.branches.length;
                top.branches.push({
                    lineIdx: idx,
                    kind: 'elseif',
                    condExpr: info.condExpr,
                    inlineCode: info.inlineCode
                });
            }
        } else if (info.kind === 'else') {
            const top = stack.length > 0 ? stack[stack.length - 1] : null;
            if (!top || top.type !== 'if') {
                errors.push('[Line ' + lineNum + '] 対応する複数行ifがない場所でelseが使用されています');
            } else if (top.hasElse) {
                errors.push('[Line ' + lineNum + '] 1つのif文にelseは1つしか記述できません');
            } else {
                top.hasElse = true;
                info.block = top;
                info.branchIndex = top.branches.length;
                top.branches.push({
                    lineIdx: idx,
                    kind: 'else',
                    condExpr: null,
                    inlineCode: info.inlineCode
                });
            }
        } else if (info.kind === 'end') {
            const top = stack.length > 0 ? stack.pop() : null;
            if (!top) {
                errors.push('[Line ' + lineNum + '] 対応するif, for, while, funがない余分なendがあります');
            } else {
                top.endLine = idx;
                info.block = top;
            }
        }
    }

    if (registerFunctions) {
        for (let i = 0; i < multiFunBlocks.length; i++) {
            const fb = multiFunBlocks[i];
            const bodyLines = lines.slice(fb.startLine + 1, fb.endLine);
            state.functions[fb.funcNameLower] = {
                name: fb.funcName,
                nameLower: fb.funcNameLower,
                params: fb.params,
                isSingleLine: false,
                inlineCode: '',
                bodyLines: bodyLines,
                startLineOffset: startLineOffset + fb.startLine + 1
            };
        }
    }

    return {
        lineInfos: lineInfos,
        enclosingByLine: enclosingBlockStackByLine,
        errors: errors
    };
}

function parseForSpecAndEvaluateCount(condExpr, lineNum) {
    const parts = splitTopLevelComma(condExpr);
    let varName = null;
    let countExpr = '';

    if (parts.length === 1 && parts[0] !== '') {
        countExpr = parts[0];
    } else if (parts.length === 2) {
        varName = parts[0];
        if (!isValidVarIdentifier(varName)) {
            throw new Error('forの第1引数 "' + varName + '" は有効な変数名ではありません');
        }
        countExpr = parts[1];
    } else {
        throw new Error('forの引数は for(n) または for(v, n) の形式で指定してください');
    }

    const rawVal = evaluateExpression(countExpr);
    const parsed = parseCasicNumber(rawVal);

    let count = 0;
    if (parsed.kind === 'float' || (Number.isFinite(parsed.num) && Math.floor(parsed.num) !== parsed.num)) {
        count = Math.round(parsed.num);
        state.warnings.push('[Line ' + lineNum + '] [警告] forの繰り返し回数に小数(' + toDisplayString(rawVal) + ')が指定されたため、四捨五入して ' + count + ' 回として実行します');
    } else if (parsed.kind === 'bigint') {
        count = Number(parsed.big);
    } else {
        count = Math.round(parsed.num);
    }

    return { varName: varName, count: count };
}

// ==========================================
// 1.5 ユーザー定義関数の呼び出し実行エンジン
// ==========================================

function invokeUserDefinedFunction(funcDef, argResults) {
    if (state.callStack.length >= 200) {
        throw new Error('関数呼び出しのネストが深すぎます（無限再帰の可能性があります）: ' + funcDef.name + '()');
    }

    const frame = {
        funcName: funcDef.name,
        locals: {},
        localArrays: {},
        localDicts: {},
        paramSet: new Set(funcDef.params),
        forStates: {}
    };

    for (let i = 0; i < funcDef.params.length; i++) {
        const pKey = funcDef.params[i];
        const argVal = (i < argResults.length) ? argResults[i].value : "";
        frame.locals[pKey] = Array.isArray(argVal) ? formatArrayAsCasicString(argVal) : String(argVal);
    }

    const savedForStates = state.forStates;
    state.callStack.push(frame);
    state.forStates = frame.forStates;

    try {
        if (funcDef.isSingleLine) {
            const res = executeInlineStatements(funcDef.inlineCode, funcDef.startLineOffset);
            if (res.output) {
                state.funcOutputBuffer += res.output;
            }
            if (res.error) {
                throw new Error(res.error);
            }
            if (res.action && res.action.type === 'return') {
                return res.action.value;
            }
            return "";
        }

        const bodyLines = funcDef.bodyLines;
        const offset = funcDef.startLineOffset;
        const labelScan = buildLabelMap(bodyLines, offset);
        const cfStructure = buildControlFlowStructure(bodyLines, offset, false);

        if (labelScan.errors.length > 0) throw new Error(labelScan.errors[0]);
        if (cfStructure.errors.length > 0) throw new Error(cfStructure.errors[0]);

        let lineIdx = 0;
        let evalBranchFlag = false;
        const MAX_FUNC_STEPS = 100000;
        let steps = 0;

        while (lineIdx >= 0 && lineIdx < bodyLines.length) {
            steps++;
            if (steps > MAX_FUNC_STEPS) {
                throw new Error('関数 "' + funcDef.name + '" 内の実行ステップ数が上限を超えました');
            }

            const stepRes = executeLineWithControlFlow(lineIdx, bodyLines, offset, labelScan.labels, cfStructure, evalBranchFlag);
            if (stepRes.output) {
                state.funcOutputBuffer += stepRes.output;
            }
            if (stepRes.errors && stepRes.errors.length > 0) {
                throw new Error(stepRes.errors[0]);
            }
            if (Object.prototype.hasOwnProperty.call(stepRes, 'returnValue')) {
                return stepRes.returnValue;
            }
            if (stepRes.halted || stepRes.stopped) {
                break;
            }

            lineIdx = stepRes.nextLineIdx;
            evalBranchFlag = stepRes.nextEvalBranch;
        }

        return "";
    } finally {
        state.callStack.pop();
        state.forStates = savedForStates;
    }
}

// ==========================================
// 2. 辞書・配列・変数の代入命令 & 操作命令
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
    let inQuotes = false;
    let closeBracketIdx = -1;
    for (let j = i; j < trimmed.length; j++) {
        const ch = trimmed[j];
        if (ch === '"' && trimmed[j - 1] !== CHAR_BSLASH) {
            inQuotes = !inQuotes;
            continue;
        }
        if (!inQuotes) {
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

function executeSortOrRevCommand(cmdLower, restRaw) {
    const parsed = parseCommandOptionAndTarget(restRaw);
    const targetName = cleanText(parsed.targetStr);
    if (targetName === '') {
        throw new Error(cmdLower + '命令の対象となる変数または配列を指定してください');
    }

    const isArrayTarget = targetName.endsWith('[]') || (hasArray(targetName) && !Object.prototype.hasOwnProperty.call(state.vars, targetName.toLowerCase()));

    if (cmdLower === 'rev') {
        if (isArrayTarget) {
            const arr = cloneArrayDeep(getArray(targetName));
            arr.reverse();
            setArray(targetName, arr);
        } else {
            const str = toDisplayString(getVar(targetName));
            const reversed = Array.from(str).reverse().join('');
            setVar(targetName, reversed);
        }
        return;
    }

    let nLimit = Infinity;
    if (parsed.optStr !== null && parsed.optStr !== '') {
        nLimit = Math.max(0, Math.trunc(parseCasicNumber(evaluateExpression(parsed.optStr)).num));
    }

    if (isArrayTarget) {
        const arr = cloneArrayDeep(getArray(targetName));
        const count = Math.min(arr.length, nLimit);
        const head = arr.slice(0, count);
        const tail = arr.slice(count);
        if (cmdLower === 'sort') {
            head.sort(compareCasicNumericSort);
        } else {
            head.sort(compareCasicDictSort);
        }
        setArray(targetName, head.concat(tail));
    } else {
        const chars = Array.from(toDisplayString(getVar(targetName)));
        const count = Math.min(chars.length, nLimit);
        const head = chars.slice(0, count).sort();
        const tail = chars.slice(count);
        setVar(targetName, head.concat(tail).join(''));
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

// 7章: js s 命令（文字列sをJavaScriptのコードとして実行する）
function executeJsCommand(restRaw) {
    const trimmed = cleanText(restRaw);
    if (trimmed === '') return;
    const jsCode = toDisplayString(evaluateExpression(trimmed));
    const fn = new Function(jsCode);
    fn();
}

// ==========================================
// 2.5 入出力の命令（in / charin / allin / resetin）
// ==========================================

function splitInTargetList(targetStr) {
    const s = cleanText(targetStr);
    if (s === '') return [];
    const items = [];
    let current = '';
    let bracketDepth = 0;
    let parenDepth = 0;
    let inQuotes = false;

    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '"' && s[i - 1] !== CHAR_BSLASH) {
            inQuotes = !inQuotes;
            current += ch;
            continue;
        }
        if (!inQuotes) {
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

// ==========================================
// 2.8 コマンドライン専用命令（cont, run n1:n2, goto n, step n）
// ==========================================

function getMainCodeLinesArray() {
    const el = document.getElementById('code');
    if (!el) return [''];
    return String(el.value).split('\r\n').join('\n').split('\n');
}

// メインCode欄を現在の state.pc（または指定範囲）から maxSteps ステップ分実行する
function runMainCodeSession(options) {
    const opts = options || {};
    const lines = getMainCodeLinesArray();
    let totalOutput = '';
    let allErrors = [];

    const labelScan = buildLabelMap(lines, 1);
    const cfStructure = buildControlFlowStructure(lines, 1, true);
    allErrors = allErrors.concat(labelScan.errors, cfStructure.errors);
    const labelMap = labelScan.labels;

    if (typeof opts.startLineIdx === 'number') {
        state.pc = Math.max(0, opts.startLineIdx);
        state.stepEvaluateBranch = false;
        state.isStopped = false;
    }

    const endLineIdx = (typeof opts.endLineIdx === 'number')
        ? opts.endLineIdx
        : (typeof state.runEndLineIdx === 'number' ? state.runEndLineIdx : (lines.length - 1));
    state.runEndLineIdx = endLineIdx;

    const maxSteps = (typeof opts.maxSteps === 'number') ? opts.maxSteps : 100000;
    let stepsExecuted = 0;

    while (state.pc >= 0 && state.pc <= endLineIdx && state.pc < lines.length && stepsExecuted < maxSteps) {
        stepsExecuted++;
        const currentIdx = state.pc;
        const stepRes = executeLineWithControlFlow(currentIdx, lines, 1, labelMap, cfStructure, state.stepEvaluateBranch);

        totalOutput += stepRes.output;
        if (stepRes.errors && stepRes.errors.length > 0) {
            allErrors = allErrors.concat(stepRes.errors);
        }

        state.pc = stepRes.nextLineIdx;
        state.stepEvaluateBranch = stepRes.nextEvalBranch;

        if (stepRes.stopped) {
            state.isStopped = true;
            state.warnings.push('[Line ' + (currentIdx + 1) + '] stop命令により一時停止しました (続行するには cont を実行)');
            break;
        }

        if (stepRes.halted) {
            state.isStopped = false;
            state.pc = 0;
            state.stepEvaluateBranch = false;
            break;
        }
    }

    if (stepsExecuted >= 100000 && maxSteps >= 100000 && state.pc <= endLineIdx && state.pc < lines.length && !state.isStopped) {
        allErrors.push('[Line ' + (state.pc + 1) + '] 実行ステップ数が上限(100000回)を超えたため停止しました（無限ループの可能性があります）');
    }

    return { output: totalOutput, errors: allErrors };
}

function executeCmdlineGoto(restTrimmed) {
    const lines = getMainCodeLinesArray();
    let n = 1;
    if (restTrimmed !== '') {
        const val = evaluateExpression(restTrimmed);
        n = Math.trunc(parseCasicNumber(val).num);
    }
    if (n < 1) n = 1;
    state.pc = Math.min(Math.max(0, n - 1), Math.max(0, lines.length - 1));
    state.stepEvaluateBranch = false;
    state.isStopped = false;
    state.runEndLineIdx = lines.length - 1;
    return { output: '', error: null, action: null };
}

function executeCmdlineStep(restTrimmed) {
    const lines = getMainCodeLinesArray();
    let n = 1;
    if (restTrimmed !== '') {
        const val = evaluateExpression(restTrimmed);
        n = Math.max(0, Math.trunc(parseCasicNumber(val).num));
    }
    if (n === 0) return { output: '', error: null, action: null };
    if (state.pc < 0 || state.pc >= lines.length) {
        state.pc = 0;
        state.stepEvaluateBranch = false;
    }
    const res = runMainCodeSession({
        endLineIdx: lines.length - 1,
        maxSteps: n
    });
    return {
        output: res.output,
        error: res.errors.length > 0 ? res.errors.join('\n') : null,
        action: null
    };
}

function executeCmdlineCont(restTrimmed) {
    if (restTrimmed !== '') {
        return { output: '', error: 'cont命令に引数は指定できません', action: null };
    }
    const lines = getMainCodeLinesArray();
    if (state.pc < 0 || state.pc >= lines.length) {
        return { output: '', error: null, action: null };
    }
    state.isStopped = false;
    const endIdx = (typeof state.runEndLineIdx === 'number') ? state.runEndLineIdx : (lines.length - 1);
    const res = runMainCodeSession({
        endLineIdx: endIdx,
        maxSteps: 100000
    });
    return {
        output: res.output,
        error: res.errors.length > 0 ? res.errors.join('\n') : null,
        action: null
    };
}

function executeCmdlineRun(restTrimmed) {
    const lines = getMainCodeLinesArray();
    let n1 = 1;
    let n2 = lines.length;

    if (restTrimmed !== '') {
        if (restTrimmed.indexOf(':') !== -1) {
            const parts = restTrimmed.split(':');
            if (cleanText(parts[0]) !== '') {
                n1 = Math.trunc(parseCasicNumber(evaluateExpression(parts[0])).num);
            }
            if (cleanText(parts[1]) !== '') {
                n2 = Math.trunc(parseCasicNumber(evaluateExpression(parts[1])).num);
            }
        } else {
            n1 = Math.trunc(parseCasicNumber(evaluateExpression(restTrimmed)).num);
            n2 = n1;
        }
    }

    n1 = Math.max(1, n1);
    n2 = Math.min(lines.length, n2);
    if (n1 > n2 || n1 > lines.length) {
        return { output: '', error: null, action: null };
    }

    const res = runMainCodeSession({
        startLineIdx: n1 - 1,
        endLineIdx: n2 - 1,
        maxSteps: 100000
    });
    return {
        output: res.output,
        error: res.errors.length > 0 ? res.errors.join('\n') : null,
        action: null
    };
}

// ==========================================
// 3. 出力命令・ラベル移動命令・行実行エンジン
// ==========================================

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

function parseToLabelLiteral(rawArg, lineNum) {
    const s = cleanText(rawArg);
    if (s === '') {
        return { label: null, error: '[Line ' + lineNum + '] to命令には移動先ラベルが必要です' };
    }
    if (s.endsWith('$')) {
        return { label: null, error: '[Line ' + lineNum + '] to命令には変数・式($)は指定できません: ' + s };
    }
    let literal = s;
    if (literal.startsWith('"') && literal.endsWith('"') && literal.length >= 2) {
        literal = unescapeCasicString(literal.slice(1, -1));
    } else if (literal.startsWith('/')) {
        literal = unescapeCasicString(literal.slice(1));
    }
    return { label: literal.toLowerCase(), error: null };
}

function evaluateGoTargetLabel(rawArg, lineNum) {
    const s = cleanText(rawArg);
    if (s === '') {
        return { label: null, error: '[Line ' + lineNum + '] go命令には移動先ラベルが必要です' };
    }
    if (s.endsWith('$')) {
        const exprPart = cleanText(s.slice(0, -1));
        if (exprPart === '') {
            return { label: null, error: '[Line ' + lineNum + '] go命令の$の前に式がありません' };
        }
        const evaluated = toDisplayString(evaluateExpression(exprPart));
        return { label: String(evaluated).toLowerCase(), error: null };
    }

    let literal = s;
    if (literal.startsWith('"') && literal.endsWith('"') && literal.length >= 2) {
        literal = unescapeCasicString(literal.slice(1, -1));
    } else if (literal.startsWith('/')) {
        literal = unescapeCasicString(literal.slice(1));
    }
    return { label: literal.toLowerCase(), error: null };
}

function buildLabelMap(lines, startLineOffset = 1) {
    const labels = {};
    const errors = [];

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const lineNum = startLineOffset + lineIdx;
        const stmts = splitStatementsByColon(lines[lineIdx]);

        for (let stmtIdx = 0; stmtIdx < stmts.length; stmtIdx++) {
            const stmt = cleanText(stmts[stmtIdx]);
            if (stmt === '') continue;

            const i = readCommandWordLength(stmt);
            if (i === 0) continue;

            const wordLower = stmt.slice(0, i).toLowerCase();
            const rest = stmt.slice(i);
            const restTrimmed = cleanText(rest);

            if (matchAssignmentOp(restTrimmed) !== null || restTrimmed.startsWith('[') || restTrimmed.startsWith('{')) continue;

            if (wordLower === 'to' && (rest === '' || isSpaceChar(rest[0]) || rest[0] === '"' || rest[0] === '/')) {
                const parsed = parseToLabelLiteral(restTrimmed, lineNum);
                if (parsed.error) {
                    errors.push(parsed.error);
                } else if (parsed.label !== null) {
                    if (Object.prototype.hasOwnProperty.call(labels, parsed.label)) {
                        const firstLine = labels[parsed.label].lineIdx + startLineOffset;
                        errors.push('[Line ' + lineNum + '] 同じラベル "' + parsed.label + '" を持つto命令は複数記述できません (1つ目: Line ' + firstLine + ')');
                    } else {
                        labels[parsed.label] = { lineIdx: lineIdx, stmtIdx: stmtIdx };
                    }
                }
            }
        }
    }

    return { labels, errors };
}

function executeStatement(stmtRaw, lineNum) {
    const trimmed = cleanText(stmtRaw);
    if (trimmed === '') return { output: '', error: null, action: null };

    state.totalSteps++;
    if (state.totalSteps > 200000) {
        return {
            output: '',
            error: '[Line ' + lineNum + '] 実行ステップ数が上限を超えたため強制終了しました（無限ループの可能性があります）',
            action: { type: 'fin' }
        };
    }

    try {
        const dictAssignRes = tryExecuteDictBraceAssignment(trimmed, lineNum);
        if (dictAssignRes && dictAssignRes.executed) {
            return { output: flushFunctionOutput(''), error: null, action: null };
        }

        const bracketAssignRes = tryExecuteBracketAssignment(trimmed);
        if (bracketAssignRes && bracketAssignRes.executed) {
            return { output: flushFunctionOutput(''), error: null, action: null };
        }

        const varAssignRes = tryExecuteVariableAssignment(trimmed);
        if (varAssignRes && varAssignRes.executed) {
            return { output: flushFunctionOutput(''), error: null, action: null };
        }

        const cmdLen = readCommandWordLength(trimmed);
        if (cmdLen === 0) {
            return {
                output: flushFunctionOutput(''),
                error: '[Line ' + lineNum + '] 解釈できない命令です: ' + trimmed,
                action: null
            };
        }

        const rawCmdLower = trimmed.slice(0, cmdLen).toLowerCase();
        const cmdLower = normalizeCommandName(rawCmdLower);
        const rest = trimmed.slice(cmdLen);
        const restTrimmed = cleanText(rest);

        // コマンドライン専用命令 (cont, run, goto, step)
        if (cmdLower === 'cont' && (rest === '' || isSpaceChar(rest[0]))) {
            return executeCmdlineCont(restTrimmed);
        }
        if (cmdLower === 'run' && (rest === '' || isSpaceChar(rest[0]) || rest[0] === ':')) {
            return executeCmdlineRun(restTrimmed);
        }
        if (cmdLower === 'goto' && (rest === '' || isSpaceChar(rest[0]) || rest[0] === '(')) {
            return executeCmdlineGoto(restTrimmed);
        }
        if (cmdLower === 'step' && (rest === '' || isSpaceChar(rest[0]) || rest[0] === '(')) {
            return executeCmdlineStep(restTrimmed);
        }

        // stop 命令
        if (cmdLower === 'stop' && restTrimmed === '') {
            return {
                output: flushFunctionOutput(''),
                error: null,
                action: { type: 'stop' }
            };
        }

        // js 命令
        if (cmdLower === 'js' && (rest === '' || isSpaceChar(rest[0]) || rest[0] === '"' || rest[0] === '/' || rest[0] === '(')) {
            executeJsCommand(rest);
            return { output: flushFunctionOutput(''), error: null, action: null };
        }

        // wait 命令 (同期エンジン内では警告を出さず指定ミリ秒の認識のみ行う)
        if (cmdLower === 'wait' && (rest === '' || isSpaceChar(rest[0]) || rest[0] === '(')) {
            if (restTrimmed !== '') {
                evaluateExpression(restTrimmed);
            }
            return { output: flushFunctionOutput(''), error: null, action: null };
        }

        // return 命令
        if (cmdLower === 'return' && (rest === '' || isSpaceChar(rest[0]) || rest[0] === '(' || rest[0] === '"' || rest[0] === '/' || rest[0] === '[' || rest[0] === '{')) {
            const retVal = restTrimmed === '' ? "" : evaluateExpression(restTrimmed);
            return {
                output: flushFunctionOutput(''),
                error: null,
                action: { type: 'return', value: retVal }
            };
        }

        // 1行 fun 命令
        if (cmdLower === 'fun' && (rest === '' || isSpaceChar(rest[0]))) {
            const parsedFun = parseFunHeader(restTrimmed);
            if (parsedFun.error) {
                return { output: '', error: '[Line ' + lineNum + '] ' + parsedFun.error, action: null };
            }
            if (parsedFun.inlineCode !== '') {
                state.functions[parsedFun.funcNameLower] = {
                    name: parsedFun.funcName,
                    nameLower: parsedFun.funcNameLower,
                    params: parsedFun.params,
                    isSingleLine: true,
                    inlineCode: parsedFun.inlineCode,
                    bodyLines: [],
                    startLineOffset: lineNum
                };
            }
            return { output: '', error: null, action: null };
        }

        if (cmdLower === 'if') {
            const paren = extractParenHead(restTrimmed);
            if (!paren) {
                return { output: '', error: '[Line ' + lineNum + '] if命令の条件括弧が正しくありません', action: null };
            }
            if (paren.after === '') {
                return { output: '', error: null, action: null };
            }
            const condVal = evaluateExpression(paren.inside);
            const preOut = flushFunctionOutput('');
            if (isCasicTruthy(condVal)) {
                const subRes = executeInlineStatements(paren.after, lineNum);
                return { output: preOut + subRes.output, error: subRes.error, action: subRes.action };
            }
            return { output: preOut, error: null, action: null };
        }

        if (cmdLower === 'for') {
            const paren = extractParenHead(restTrimmed);
            if (!paren) {
                return { output: '', error: '[Line ' + lineNum + '] for命令の括弧が正しくありません', action: null };
            }
            if (paren.after === '') {
                return { output: '', error: null, action: null };
            }
            const spec = parseForSpecAndEvaluateCount(paren.inside, lineNum);
            let totalOut = flushFunctionOutput('');
            for (let iter = 1; iter <= spec.count; iter++) {
                if (spec.varName) {
                    setVar(spec.varName, String(iter));
                }
                const subRes = executeInlineStatements(paren.after, lineNum);
                totalOut += subRes.output;
                if (subRes.error) {
                    return { output: totalOut, error: subRes.error, action: subRes.action };
                }
                if (subRes.action) {
                    if (subRes.action.type === 'break') {
                        if (subRes.action.count > 1) {
                            return { output: totalOut, error: null, action: { type: 'break', count: subRes.action.count - 1 } };
                        }
                        break;
                    }
                    return { output: totalOut, error: null, action: subRes.action };
                }
            }
            return { output: totalOut, error: null, action: null };
        }

        if (cmdLower === 'while') {
            const paren = extractParenHead(restTrimmed);
            if (!paren) {
                return { output: '', error: '[Line ' + lineNum + '] while命令の括弧が正しくありません', action: null };
            }
            if (paren.after === '') {
                return { output: '', error: null, action: null };
            }
            let totalOut = '';
            while (true) {
                const condVal = evaluateExpression(paren.inside);
                totalOut += flushFunctionOutput('');
                if (!isCasicTruthy(condVal)) break;

                const subRes = executeInlineStatements(paren.after, lineNum);
                totalOut += subRes.output;
                if (subRes.error) {
                    return { output: totalOut, error: subRes.error, action: subRes.action };
                }
                if (subRes.action) {
                    if (subRes.action.type === 'break') {
                        if (subRes.action.count > 1) {
                            return { output: totalOut, error: null, action: { type: 'break', count: subRes.action.count - 1 } };
                        }
                        break;
                    }
                    return { output: totalOut, error: null, action: subRes.action };
                }
            }
            return { output: totalOut, error: null, action: null };
        }

        if (cmdLower === 'break') {
            let count = 1;
            if (restTrimmed !== '') {
                const paren = extractParenHead(restTrimmed);
                const exprStr = paren ? paren.inside : restTrimmed;
                if (exprStr !== '') {
                    const parsed = parseCasicNumber(evaluateExpression(exprStr));
                    count = Math.max(1, Math.round(parsed.num));
                }
            }
            return { output: flushFunctionOutput(''), error: null, action: { type: 'break', count: count } };
        }

        if (cmdLower === 'in') {
            executeInCommand(rest);
            return { output: flushFunctionOutput(''), error: null, action: null };
        }

        if (cmdLower === 'charin') {
            executeCharinCommand(rest);
            return { output: flushFunctionOutput(''), error: null, action: null };
        }

        if (cmdLower === 'allin') {
            executeAllinCommand(rest);
            return { output: flushFunctionOutput(''), error: null, action: null };
        }

        if (cmdLower === 'resetin') {
            executeResetinCommand(rest);
            return { output: flushFunctionOutput(''), error: null, action: null };
        }

        if (cmdLower === 'out' || cmdLower === 'put') {
            const outStr = executeOutputCommand(cmdLower, rest);
            return { output: flushFunctionOutput(outStr), error: null, action: null };
        }

        if (cmdLower === 'sort' || cmdLower === 'dsort' || cmdLower === 'rev') {
            executeSortOrRevCommand(cmdLower, rest);
            return { output: flushFunctionOutput(''), error: null, action: null };
        }

        if (cmdLower === 'push') {
            executePushInsAddCommand(rawCmdLower, rest);
            return { output: flushFunctionOutput(''), error: null, action: null };
        }

        if (cmdLower === 'replace') {
            executeReplaceCommand(rest);
            return { output: flushFunctionOutput(''), error: null, action: null };
        }

        if (cmdLower === 'del') {
            executeDelCommand(rest);
            return { output: flushFunctionOutput(''), error: null, action: null };
        }

        if (cmdLower === 'clear' || cmdLower === 'uniq') {
            executeClearOrUniqCommand(cmdLower, rest);
            return { output: flushFunctionOutput(''), error: null, action: null };
        }

        if (cmdLower === 'rename') {
            executeRenameCommand(rest);
            return { output: flushFunctionOutput(''), error: null, action: null };
        }

        if (cmdLower === 'seed') {
            executeSeedCommand(rest);
            return { output: flushFunctionOutput(''), error: null, action: null };
        }

        if (cmdLower === 'to') {
            const parsed = parseToLabelLiteral(restTrimmed, lineNum);
            if (parsed.error) {
                return { output: '', error: parsed.error, action: null };
            }
            return { output: '', error: null, action: null };
        }

        if (cmdLower === 'go') {
            const target = evaluateGoTargetLabel(restTrimmed, lineNum);
            if (target.error) {
                return { output: flushFunctionOutput(''), error: target.error, action: null };
            }
            return {
                output: flushFunctionOutput(''),
                error: null,
                action: { type: 'go', targetLabel: target.label, lineNum: lineNum }
            };
        }

        if (cmdLower === 'exit') {
            if (restTrimmed !== '') {
                return {
                    output: '',
                    error: '[Line ' + lineNum + '] ' + rawCmdLower + '命令に引数は指定できません',
                    action: null
                };
            }
            return { output: '', error: null, action: { type: 'fin' } };
        }

        if (restTrimmed.startsWith('(') && Object.prototype.hasOwnProperty.call(state.functions, rawCmdLower)) {
            evaluateExpression(trimmed);
            return { output: flushFunctionOutput(''), error: null, action: null };
        }

        return {
            output: flushFunctionOutput(''),
            error: '[Line ' + lineNum + '] 未実装または不明な命令です: ' + trimmed,
            action: null
        };
    } catch (e) {
        return { output: flushFunctionOutput(''), error: '[Line ' + lineNum + '] 実行エラー: ' + e.message, action: null };
    }
}

function executeInlineStatements(codeStr, lineNum) {
    const stmts = splitStatementsByColon(codeStr);
    let out = '';
    for (let i = 0; i < stmts.length; i++) {
        const res = executeStatement(stmts[i], lineNum);
        out += res.output;
        if (res.error || res.action) {
            return { output: out, error: res.error, action: res.action };
        }
    }
    return { output: out, error: null, action: null };
}

function evaluateIfBranchAt(block, startBranchIdx, lineNum) {
    const branches = block.branches;
    for (let bIdx = startBranchIdx; bIdx < branches.length; bIdx++) {
        const br = branches[bIdx];
        const isTaken = (br.kind === 'else') ? true : isCasicTruthy(evaluateExpression(br.condExpr));
        const preOut = flushFunctionOutput('');
        if (isTaken) {
            let inlineRes = { output: preOut, error: null, action: null };
            if (br.inlineCode && br.inlineCode !== '') {
                const sub = executeInlineStatements(br.inlineCode, startBranchIdx === bIdx ? lineNum : (br.lineIdx + 1));
                inlineRes = { output: preOut + sub.output, error: sub.error, action: sub.action };
            }
            return {
                taken: true,
                nextLineIdx: br.lineIdx + 1,
                evaluateBranchOnNext: false,
                inlineRes: inlineRes
            };
        }
        if (bIdx + 1 < branches.length) {
            return {
                taken: false,
                nextLineIdx: branches[bIdx + 1].lineIdx,
                evaluateBranchOnNext: true,
                inlineRes: { output: preOut, error: null, action: null }
            };
        }
        return {
            taken: false,
            nextLineIdx: block.endLine + 1,
            evaluateBranchOnNext: false,
            inlineRes: { output: preOut, error: null, action: null }
        };
    }
    return {
        taken: false,
        nextLineIdx: block.endLine + 1,
        evaluateBranchOnNext: false,
        inlineRes: { output: '', error: null, action: null }
    };
}

function resolveBreakTargetLine(lineIdx, count, cfStructure, totalLines) {
    const enclosing = cfStructure.enclosingByLine[lineIdx] || [];
    if (enclosing.length === 0) {
        return totalLines;
    }
    const targetIdx = Math.max(0, enclosing.length - count);
    const targetBlock = enclosing[targetIdx];
    return targetBlock.endLine + 1;
}

function executeLineWithControlFlow(lineIdx, lines, startLineOffset, labelMap, cfStructure, evaluateBranchFlag) {
    const lineNum = startLineOffset + lineIdx;
    const info = cfStructure.lineInfos[lineIdx] || { kind: 'normal' };
    let lineOutput = '';
    let errors = [];

    try {
        if (info.kind === 'fun_single') {
            state.totalSteps++;
            return {
                output: '',
                errors: errors,
                nextLineIdx: lineIdx + 1,
                nextEvalBranch: false,
                halted: false,
                stopped: false
            };
        }
        if (info.kind === 'fun_multi') {
            state.totalSteps++;
            return {
                output: '',
                errors: errors,
                nextLineIdx: info.block.endLine + 1,
                nextEvalBranch: false,
                halted: false,
                stopped: false
            };
        }

        if (info.kind === 'if_multi') {
            state.totalSteps++;
            const branchDecision = evaluateIfBranchAt(info.block, 0, lineNum);
            lineOutput += branchDecision.inlineRes.output;
            if (branchDecision.inlineRes.error) errors.push(branchDecision.inlineRes.error);

            if (branchDecision.inlineRes.action) {
                return handleActionTransition(branchDecision.inlineRes.action, lineIdx, lineNum, lineOutput, errors, labelMap, cfStructure, lines.length);
            }
            return {
                output: lineOutput,
                errors: errors,
                nextLineIdx: branchDecision.nextLineIdx,
                nextEvalBranch: branchDecision.evaluateBranchOnNext,
                halted: false,
                stopped: false
            };
        }

        if (info.kind === 'elseif' || info.kind === 'else') {
            state.totalSteps++;
            if (!info.block) {
                return { output: '', errors: errors, nextLineIdx: lineIdx + 1, nextEvalBranch: false, halted: false, stopped: false };
            }
            if (!evaluateBranchFlag) {
                return {
                    output: '',
                    errors: errors,
                    nextLineIdx: info.block.endLine + 1,
                    nextEvalBranch: false,
                    halted: false,
                    stopped: false
                };
            }
            const branchDecision = evaluateIfBranchAt(info.block, info.branchIndex, lineNum);
            lineOutput += branchDecision.inlineRes.output;
            if (branchDecision.inlineRes.error) errors.push(branchDecision.inlineRes.error);

            if (branchDecision.inlineRes.action) {
                return handleActionTransition(branchDecision.inlineRes.action, lineIdx, lineNum, lineOutput, errors, labelMap, cfStructure, lines.length);
            }
            return {
                output: lineOutput,
                errors: errors,
                nextLineIdx: branchDecision.nextLineIdx,
                nextEvalBranch: branchDecision.evaluateBranchOnNext,
                halted: false,
                stopped: false
            };
        }

        if (info.kind === 'for_multi') {
            state.totalSteps++;
            const spec = parseForSpecAndEvaluateCount(info.condExpr, lineNum);
            lineOutput += flushFunctionOutput('');
            if (spec.count <= 0) {
                delete state.forStates[lineIdx];
                return {
                    output: lineOutput,
                    errors: errors,
                    nextLineIdx: info.block.endLine + 1,
                    nextEvalBranch: false,
                    halted: false,
                    stopped: false
                };
            }
            state.forStates[lineIdx] = {
                current: 1,
                max: spec.count,
                varName: spec.varName
            };
            if (spec.varName) {
                setVar(spec.varName, "1");
            }
            return {
                output: lineOutput,
                errors: errors,
                nextLineIdx: lineIdx + 1,
                nextEvalBranch: false,
                halted: false,
                stopped: false
            };
        }

        if (info.kind === 'while_multi') {
            state.totalSteps++;
            const condVal = evaluateExpression(info.condExpr);
            lineOutput += flushFunctionOutput('');
            if (!isCasicTruthy(condVal)) {
                return {
                    output: lineOutput,
                    errors: errors,
                    nextLineIdx: info.block.endLine + 1,
                    nextEvalBranch: false,
                    halted: false,
                    stopped: false
                };
            }
            return {
                output: lineOutput,
                errors: errors,
                nextLineIdx: lineIdx + 1,
                nextEvalBranch: false,
                halted: false,
                stopped: false
            };
        }

        if (info.kind === 'end') {
            state.totalSteps++;
            const blk = info.block;
            if (!blk) {
                return { output: '', errors: errors, nextLineIdx: lineIdx + 1, nextEvalBranch: false, halted: false, stopped: false };
            }
            if (blk.type === 'if' || blk.type === 'fun') {
                return { output: '', errors: errors, nextLineIdx: lineIdx + 1, nextEvalBranch: false, halted: false, stopped: false };
            }
            if (blk.type === 'for') {
                const fState = state.forStates[blk.startLine];
                if (fState && fState.current < fState.max) {
                    fState.current += 1;
                    if (fState.varName) {
                        setVar(fState.varName, String(fState.current));
                    }
                    return {
                        output: '',
                        errors: errors,
                        nextLineIdx: blk.startLine + 1,
                        nextEvalBranch: false,
                        halted: false,
                        stopped: false
                    };
                } else {
                    delete state.forStates[blk.startLine];
                    return {
                        output: '',
                        errors: errors,
                        nextLineIdx: lineIdx + 1,
                        nextEvalBranch: false,
                        halted: false,
                        stopped: false
                    };
                }
            }
            if (blk.type === 'while') {
                return {
                    output: '',
                    errors: errors,
                    nextLineIdx: blk.startLine,
                    nextEvalBranch: false,
                    halted: false,
                    stopped: false
                };
            }
        }

        const statements = splitStatementsByColon(lines[lineIdx]);
        for (let sIdx = 0; sIdx < statements.length; sIdx++) {
            const res = executeStatement(statements[sIdx], lineNum);
            lineOutput += res.output;
            if (res.error) errors.push(res.error);

            if (res.action) {
                return handleActionTransition(res.action, lineIdx, lineNum, lineOutput, errors, labelMap, cfStructure, lines.length);
            }
        }

        return {
            output: lineOutput,
            errors: errors,
            nextLineIdx: lineIdx + 1,
            nextEvalBranch: false,
            halted: false,
            stopped: false
        };
    } catch (e) {
        errors.push('[Line ' + lineNum + '] 実行エラー: ' + e.message);
        return {
            output: flushFunctionOutput(lineOutput),
            errors: errors,
            nextLineIdx: lineIdx + 1,
            nextEvalBranch: false,
            halted: false,
            stopped: false
        };
    }
}

function handleActionTransition(action, lineIdx, lineNum, lineOutput, errors, labelMap, cfStructure, totalLines) {
    if (action.type === 'stop') {
        return {
            output: lineOutput,
            errors: errors,
            nextLineIdx: lineIdx + 1,
            nextEvalBranch: false,
            halted: false,
            stopped: true
        };
    }
    if (action.type === 'return') {
        return {
            output: lineOutput,
            errors: errors,
            nextLineIdx: totalLines,
            nextEvalBranch: false,
            halted: true,
            stopped: false,
            returnValue: action.value
        };
    }
    if (action.type === 'fin') {
        return { output: lineOutput, errors: errors, nextLineIdx: totalLines, nextEvalBranch: false, halted: true, stopped: false };
    }
    if (action.type === 'break') {
        const targetLine = resolveBreakTargetLine(lineIdx, action.count, cfStructure, totalLines);
        return { output: lineOutput, errors: errors, nextLineIdx: targetLine, nextEvalBranch: false, halted: false, stopped: false };
    }
    if (action.type === 'go') {
        const dest = labelMap && labelMap[action.targetLabel];
        if (!dest) {
            errors.push('[Line ' + lineNum + '] 移動先の "to ' + action.targetLabel + '" が見つかりません');
            return { output: lineOutput, errors: errors, nextLineIdx: lineIdx + 1, nextEvalBranch: false, halted: false, stopped: false };
        }
        return { output: lineOutput, errors: errors, nextLineIdx: dest.lineIdx, nextEvalBranch: false, halted: false, stopped: false };
    }
    return { output: lineOutput, errors: errors, nextLineIdx: lineIdx + 1, nextEvalBranch: false, halted: false, stopped: false };
}

// 追加実行1〜3 または コマンドラインのコードを実行する（メインCode欄の forStates や pc と干渉しないよう分離）
function executeCasicCode(rawCode, startLineOffset = 1, isSubOrCmd = false) {
    const normalized = String(rawCode).split('\r\n').join('\n');
    const lines = normalized.split('\n');

    if (!isSubOrCmd) {
        state.warnings = [];
        const mainRes = runMainCodeSession({
            startLineIdx: 0,
            endLineIdx: lines.length - 1,
            maxSteps: 100000
        });
        return {
            output: mainRes.output,
            errors: mainRes.errors,
            warnings: state.warnings.slice()
        };
    }

    state.warnings = [];
    let totalOutput = '';
    const labelScan = buildLabelMap(lines, startLineOffset);
    const cfStructure = buildControlFlowStructure(lines, startLineOffset, true);
    let allErrors = labelScan.errors.concat(cfStructure.errors);
    const labelMap = labelScan.labels;

    // サブ実行・コマンドライン用の独立した forStates を用意し、内部で goto/step を呼ぶ瞬間だけメインの forStates に切り替える
    const localForStates = {};
    const mainForStates = state.forStates;

    const MAX_LINE_TRANSITIONS = 100000;
    let transitions = 0;
    let lineIdx = 0;
    let evalBranchFlag = false;

    while (lineIdx >= 0 && lineIdx < lines.length) {
        transitions++;
        if (transitions > MAX_LINE_TRANSITIONS) {
            const lineNum = startLineOffset + lineIdx;
            allErrors.push('[Line ' + lineNum + '] 実行ステップ数が上限(' + MAX_LINE_TRANSITIONS + '回)を超えたため停止しました（無限ループの可能性があります）');
            break;
        }

        const info = cfStructure.lineInfos[lineIdx] || { kind: 'normal' };
        let stepRes = null;

        if (info.kind === 'for_multi' || info.kind === 'end') {
            state.forStates = localForStates;
            stepRes = executeLineWithControlFlow(lineIdx, lines, startLineOffset, labelMap, cfStructure, evalBranchFlag);
            state.forStates = mainForStates;
        } else {
            state.forStates = mainForStates;
            stepRes = executeLineWithControlFlow(lineIdx, lines, startLineOffset, labelMap, cfStructure, evalBranchFlag);
        }

        totalOutput += stepRes.output;
        if (stepRes.errors.length > 0) {
            allErrors = allErrors.concat(stepRes.errors);
        }
        if (stepRes.halted || stepRes.stopped) break;

        lineIdx = stepRes.nextLineIdx;
        evalBranchFlag = stepRes.nextEvalBranch;
    }

    state.forStates = mainForStates;
    return { output: totalOutput, errors: allErrors, warnings: state.warnings.slice() };
}