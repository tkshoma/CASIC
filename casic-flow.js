// ==========================================
// CASIC 構造ブロック解析エンジン (casic-flow.js)
// ==========================================

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
        if (rawAfterKw !== '' && !isSpaceChar(rawAfterKw[0]) && rawAfterKw[0] !== ':' && rawAfterKw[0] !== '"' && rawAfterKw[0] !== "'" && rawAfterKw[0] !== '/') {
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

function resolveBreakTargetLine(lineIdx, count, cfStructure, totalLines) {
    const enclosing = cfStructure.enclosingByLine[lineIdx] || [];
    if (enclosing.length === 0) {
        return totalLines;
    }
    const targetIdx = Math.max(0, enclosing.length - count);
    const targetBlock = enclosing[targetIdx];
    return targetBlock.endLine + 1;
}