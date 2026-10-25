// ==========================================
// 1. 構造ブロック解析（if / elseif / else / for / while / fun / end）
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
// 2. ユーザー定義関数の呼び出し実行エンジン
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
// 3. コマンドライン専用命令（cont, run n1:n2, goto n, step n）
// ==========================================

function getMainCodeLinesArray() {
    const el = document.getElementById('code');
    if (!el) return [''];
    return String(el.value).split('\r\n').join('\n').split('\n');
}

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
// 4. 制御フロー付きの行実行・コード一括実行
// ==========================================

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