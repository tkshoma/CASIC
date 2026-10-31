// ==========================================
// CASIC 実行エンジン (casic-engine.js)
// ==========================================

function getMainCodeLinesArray() {
    const codeEl = document.getElementById('code');
    if (!codeEl) return [];
    return String(codeEl.value).split('\r\n').join('\n').split('\n');
}

function handleActionTransition(action, lineIdx, lineNum, lineOutput, errors, labelMap, cfStructure, totalLines) {
    if (action.type === 'stop') {
        return { output: lineOutput, errors: errors, nextLineIdx: lineIdx + 1, nextEvalBranch: false, halted: false, stopped: true };
    }
    if (action.type === 'return') {
        return { output: lineOutput, errors: errors, nextLineIdx: totalLines, nextEvalBranch: false, halted: true, stopped: false, returnValue: action.value };
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


// ==========================================
// [同期] ユーザー定義関数実行エンジン (式内呼び出し用)
// ==========================================

function evaluateIfBranchAtSync(block, startBranchIdx, lineNum) {
    const branches = block.branches;
    for (let bIdx = startBranchIdx; bIdx < branches.length; bIdx++) {
        const br = branches[bIdx];
        const isTaken = (br.kind === 'else') ? true : isCasicTruthy(evaluateExpression(br.condExpr));
        const preOut = flushFunctionOutput('');
        if (isTaken) {
            let inlineRes = { output: preOut, error: null, action: null };
            if (br.inlineCode && br.inlineCode !== '') {
                const sub = executeInlineStatementsSync(br.inlineCode, startBranchIdx === bIdx ? lineNum : (br.lineIdx + 1));
                inlineRes = { output: preOut + sub.output, error: sub.error, action: sub.action };
            }
            return { taken: true, nextLineIdx: br.lineIdx + 1, evaluateBranchOnNext: false, inlineRes: inlineRes };
        }
        if (bIdx + 1 < branches.length) {
            return { taken: false, nextLineIdx: branches[bIdx + 1].lineIdx, evaluateBranchOnNext: true, inlineRes: { output: preOut, error: null, action: null } };
        }
        return { taken: false, nextLineIdx: block.endLine + 1, evaluateBranchOnNext: false, inlineRes: { output: preOut, error: null, action: null } };
    }
    return { taken: false, nextLineIdx: block.endLine + 1, evaluateBranchOnNext: false, inlineRes: { output: '', error: null, action: null } };
}

function executeStatementSync(stmtRaw, lineNum) {
    const trimmed = cleanText(stmtRaw);
    if (trimmed === '') return { output: '', error: null, action: null };

    state.totalSteps++;
    if (state.totalSteps > 200000) {
        return { output: '', error: '[Line ' + lineNum + '] 実行ステップ数が上限を超えました', action: { type: 'fin' } };
    }

    try {
        const dictAssignRes = tryExecuteDictBraceAssignment(trimmed, lineNum);
        if (dictAssignRes && dictAssignRes.executed) return { output: flushFunctionOutput(''), error: null, action: null };

        const bracketAssignRes = tryExecuteBracketAssignment(trimmed);
        if (bracketAssignRes && bracketAssignRes.executed) return { output: flushFunctionOutput(''), error: null, action: null };

        const varAssignRes = tryExecuteVariableAssignment(trimmed);
        if (varAssignRes && varAssignRes.executed) return { output: flushFunctionOutput(''), error: null, action: null };

        const cmdLen = readCommandWordLength(trimmed);
        if (cmdLen === 0) return { output: flushFunctionOutput(''), error: '[Line ' + lineNum + '] 解釈できない命令です: ' + trimmed, action: null };

        const rawCmdLower = trimmed.slice(0, cmdLen).toLowerCase();
        const cmdLower = normalizeCommandName(rawCmdLower);
        const rest = trimmed.slice(cmdLen);
        const restTrimmed = cleanText(rest);

        if (cmdLower === 'tick' && (rest === '' || isSpaceChar(rest[0]))) {
            if (restTrimmed !== '') return { output: '', error: 'tick命令に引数は指定できません', action: null };
            state.lastTickTime = performance.now();
            resetKeyTickState();
            return { output: flushFunctionOutput(''), error: null, action: null };
        }
        if (cmdLower === 'frame' && (rest === '' || isSpaceChar(rest[0]))) {
            if (restTrimmed !== '') return { output: '', error: 'frame命令に引数は指定できません', action: null };
            state.lastFrameTime = performance.now();
            return { output: flushFunctionOutput(''), error: null, action: null };
        }
        if (cmdLower === 'fetch') {
            executeFetchCommand(rest);
            return { output: flushFunctionOutput(''), error: null, action: null };
        }

        if (cmdLower === 'stop' && restTrimmed === '') return { output: flushFunctionOutput(''), error: null, action: { type: 'stop' } };
        if (cmdLower === 'js') { executeJsCommand(rest); return { output: flushFunctionOutput(''), error: null, action: null }; }
        
        if (cmdLower === 'wait' && (rest === '' || isSpaceChar(rest[0]) || rest[0] === '(')) {
            return { output: flushFunctionOutput(''), error: '[Line ' + lineNum + '] ユーザー定義関数内でwait命令は使用できません', action: null };
        }
        if (cmdLower === 'return' && (rest === '' || isSpaceChar(rest[0]) || rest[0] === '(' || rest[0] === '"' || rest[0] === "'" || rest[0] === '/' || rest[0] === '[' || rest[0] === '{')) {
            const retVal = restTrimmed === '' ? "" : evaluateExpression(restTrimmed);
            return { output: flushFunctionOutput(''), error: null, action: { type: 'return', value: retVal } };
        }

        if (cmdLower === 'fun' && (rest === '' || isSpaceChar(rest[0]))) {
            const parsedFun = parseFunHeader(restTrimmed);
            if (parsedFun.error) return { output: '', error: '[Line ' + lineNum + '] ' + parsedFun.error, action: null };
            if (parsedFun.inlineCode !== '') {
                state.functions[parsedFun.funcNameLower] = { name: parsedFun.funcName, nameLower: parsedFun.funcNameLower, params: parsedFun.params, isSingleLine: true, inlineCode: parsedFun.inlineCode, bodyLines: [], startLineOffset: lineNum };
            }
            return { output: '', error: null, action: null };
        }

        if (cmdLower === 'if') {
            const paren = extractParenHead(restTrimmed);
            if (!paren) return { output: '', error: '[Line ' + lineNum + '] if命令の条件括弧が正しくありません', action: null };
            if (paren.after === '') return { output: '', error: null, action: null };
            const condVal = evaluateExpression(paren.inside);
            const preOut = flushFunctionOutput('');
            if (isCasicTruthy(condVal)) {
                const subRes = executeInlineStatementsSync(paren.after, lineNum);
                return { output: preOut + subRes.output, error: subRes.error, action: subRes.action };
            }
            return { output: preOut, error: null, action: null };
        }

        if (cmdLower === 'for') {
            const paren = extractParenHead(restTrimmed);
            if (!paren) return { output: '', error: '[Line ' + lineNum + '] for命令の括弧が正しくありません', action: null };
            if (paren.after === '') return { output: '', error: null, action: null };
            const spec = parseForSpecAndEvaluateCount(paren.inside, lineNum);
            let totalOut = flushFunctionOutput('');
            for (let iter = 1; iter <= spec.count; iter++) {
                if (spec.varName) setVar(spec.varName, String(iter));
                const subRes = executeInlineStatementsSync(paren.after, lineNum);
                totalOut += subRes.output;
                if (subRes.error) return { output: totalOut, error: subRes.error, action: subRes.action };
                if (subRes.action) {
                    if (subRes.action.type === 'break') {
                        if (subRes.action.count > 1) return { output: totalOut, error: null, action: { type: 'break', count: subRes.action.count - 1 } };
                        break;
                    }
                    return { output: totalOut, error: null, action: subRes.action };
                }
            }
            return { output: totalOut, error: null, action: null };
        }

        if (cmdLower === 'while') {
            const paren = extractParenHead(restTrimmed);
            if (!paren) return { output: '', error: '[Line ' + lineNum + '] while命令の括弧が正しくありません', action: null };
            if (paren.after === '') return { output: '', error: null, action: null };
            let totalOut = '';
            let loopCounter = 0;
            while (true) {
                loopCounter++;
                if (loopCounter > 10000) return { output: totalOut, error: '[Line ' + lineNum + '] 無限ループの可能性があります', action: null };
                const condVal = evaluateExpression(paren.inside);
                totalOut += flushFunctionOutput('');
                if (!isCasicTruthy(condVal)) break;
                const subRes = executeInlineStatementsSync(paren.after, lineNum);
                totalOut += subRes.output;
                if (subRes.error) return { output: totalOut, error: subRes.error, action: subRes.action };
                if (subRes.action) {
                    if (subRes.action.type === 'break') {
                        if (subRes.action.count > 1) return { output: totalOut, error: null, action: { type: 'break', count: subRes.action.count - 1 } };
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
                    count = Math.max(1, Math.round(parseCasicNumber(evaluateExpression(exprStr)).num));
                }
            }
            return { output: flushFunctionOutput(''), error: null, action: { type: 'break', count: count } };
        }

        if (cmdLower === 'in') { executeInCommand(rest); return { output: flushFunctionOutput(''), error: null, action: null }; }
        if (cmdLower === 'charin') { executeCharinCommand(rest); return { output: flushFunctionOutput(''), error: null, action: null }; }
        if (cmdLower === 'allin') { executeAllinCommand(rest); return { output: flushFunctionOutput(''), error: null, action: null }; }
        if (cmdLower === 'resetin') { executeResetinCommand(rest); return { output: flushFunctionOutput(''), error: null, action: null }; }
        if (cmdLower === 'out' || cmdLower === 'put') {
            const outStr = executeOutputCommand(cmdLower, rest);
            return { output: flushFunctionOutput(outStr), error: null, action: null };
        }
        if (cmdLower === 'sort' || cmdLower === 'dsort' || cmdLower === 'rev') { executeSortOrRevCommand(cmdLower, rest); return { output: flushFunctionOutput(''), error: null, action: null }; }
        if (cmdLower === 'push') { executePushInsAddCommand(rawCmdLower, rest); return { output: flushFunctionOutput(''), error: null, action: null }; }
        if (cmdLower === 'replace') { executeReplaceCommand(rest); return { output: flushFunctionOutput(''), error: null, action: null }; }
        if (cmdLower === 'del') { executeDelCommand(rest); return { output: flushFunctionOutput(''), error: null, action: null }; }
        if (cmdLower === 'clear' || cmdLower === 'uniq') { executeClearOrUniqCommand(cmdLower, rest); return { output: flushFunctionOutput(''), error: null, action: null }; }
        if (cmdLower === 'rename') { executeRenameCommand(rest); return { output: flushFunctionOutput(''), error: null, action: null }; }
        if (cmdLower === 'seed') { executeSeedCommand(rest); return { output: flushFunctionOutput(''), error: null, action: null }; }
        
        if (cmdLower === 'to') {
            const parsed = parseToLabelLiteral(restTrimmed, lineNum);
            if (parsed.error) return { output: '', error: parsed.error, action: null };
            return { output: '', error: null, action: null };
        }
        if (cmdLower === 'go') {
            const target = evaluateGoTargetLabel(restTrimmed, lineNum);
            if (target.error) return { output: flushFunctionOutput(''), error: target.error, action: null };
            return { output: flushFunctionOutput(''), error: null, action: { type: 'go', targetLabel: target.label, lineNum: lineNum } };
        }
        if (cmdLower === 'exit') {
            if (restTrimmed !== '') return { output: '', error: '[Line ' + lineNum + '] ' + rawCmdLower + '命令に引数は指定できません', action: null };
            return { output: '', error: null, action: { type: 'fin' } };
        }
        if (restTrimmed.startsWith('(') && Object.prototype.hasOwnProperty.call(state.functions, rawCmdLower)) {
            evaluateExpression(trimmed);
            return { output: flushFunctionOutput(''), error: null, action: null };
        }
        return { output: flushFunctionOutput(''), error: '[Line ' + lineNum + '] 未実装または不明な命令です: ' + trimmed, action: null };
    } catch (e) {
        return { output: flushFunctionOutput(''), error: '[Line ' + lineNum + '] 実行エラー: ' + e.message, action: null };
    }
}

function executeInlineStatementsSync(codeStr, lineNum) {
    const stmts = splitStatementsByColon(codeStr);
    let out = '';
    for (let i = 0; i < stmts.length; i++) {
        const res = executeStatementSync(stmts[i], lineNum);
        out += res.output;
        if (res.error || res.action) return { output: out, error: res.error, action: res.action };
    }
    return { output: out, error: null, action: null };
}

function executeLineWithControlFlowSync(lineIdx, lines, startLineOffset, labelMap, cfStructure, evaluateBranchFlag) {
    const lineNum = startLineOffset + lineIdx;
    const info = cfStructure.lineInfos[lineIdx] || { kind: 'normal' };
    let lineOutput = '';
    let errors = [];

    try {
        if (info.kind === 'fun_single' || info.kind === 'fun_multi') {
            state.totalSteps++;
            return { output: '', errors: errors, nextLineIdx: info.kind === 'fun_multi' ? info.block.endLine + 1 : lineIdx + 1, nextEvalBranch: false, halted: false, stopped: false };
        }

        if (info.kind === 'if_multi') {
            state.totalSteps++;
            const branchDecision = evaluateIfBranchAtSync(info.block, 0, lineNum);
            lineOutput += branchDecision.inlineRes.output;
            if (branchDecision.inlineRes.error) errors.push(branchDecision.inlineRes.error);
            if (branchDecision.inlineRes.action) return handleActionTransition(branchDecision.inlineRes.action, lineIdx, lineNum, lineOutput, errors, labelMap, cfStructure, lines.length);
            return { output: lineOutput, errors: errors, nextLineIdx: branchDecision.nextLineIdx, nextEvalBranch: branchDecision.evaluateBranchOnNext, halted: false, stopped: false };
        }

        if (info.kind === 'elseif' || info.kind === 'else') {
            state.totalSteps++;
            if (!info.block) return { output: '', errors: errors, nextLineIdx: lineIdx + 1, nextEvalBranch: false, halted: false, stopped: false };
            if (!evaluateBranchFlag) return { output: '', errors: errors, nextLineIdx: info.block.endLine + 1, nextEvalBranch: false, halted: false, stopped: false };
            
            const branchDecision = evaluateIfBranchAtSync(info.block, info.branchIndex, lineNum);
            lineOutput += branchDecision.inlineRes.output;
            if (branchDecision.inlineRes.error) errors.push(branchDecision.inlineRes.error);
            if (branchDecision.inlineRes.action) return handleActionTransition(branchDecision.inlineRes.action, lineIdx, lineNum, lineOutput, errors, labelMap, cfStructure, lines.length);
            return { output: lineOutput, errors: errors, nextLineIdx: branchDecision.nextLineIdx, nextEvalBranch: branchDecision.evaluateBranchOnNext, halted: false, stopped: false };
        }

        if (info.kind === 'for_multi') {
            state.totalSteps++;
            const spec = parseForSpecAndEvaluateCount(info.condExpr, lineNum);
            lineOutput += flushFunctionOutput('');
            if (spec.count <= 0) {
                delete state.forStates[lineIdx];
                return { output: lineOutput, errors: errors, nextLineIdx: info.block.endLine + 1, nextEvalBranch: false, halted: false, stopped: false };
            }
            state.forStates[lineIdx] = { current: 1, max: spec.count, varName: spec.varName };
            if (spec.varName) setVar(spec.varName, "1");
            return { output: lineOutput, errors: errors, nextLineIdx: lineIdx + 1, nextEvalBranch: false, halted: false, stopped: false };
        }

        if (info.kind === 'while_multi') {
            state.totalSteps++;
            const condVal = evaluateExpression(info.condExpr);
            lineOutput += flushFunctionOutput('');
            if (!isCasicTruthy(condVal)) return { output: lineOutput, errors: errors, nextLineIdx: info.block.endLine + 1, nextEvalBranch: false, halted: false, stopped: false };
            return { output: lineOutput, errors: errors, nextLineIdx: lineIdx + 1, nextEvalBranch: false, halted: false, stopped: false };
        }

        if (info.kind === 'end') {
            state.totalSteps++;
            const blk = info.block;
            if (!blk) return { output: '', errors: errors, nextLineIdx: lineIdx + 1, nextEvalBranch: false, halted: false, stopped: false };
            if (blk.type === 'if' || blk.type === 'fun') return { output: '', errors: errors, nextLineIdx: lineIdx + 1, nextEvalBranch: false, halted: false, stopped: false };
            if (blk.type === 'for') {
                const fState = state.forStates[blk.startLine];
                if (fState && fState.current < fState.max) {
                    fState.current += 1;
                    if (fState.varName) setVar(fState.varName, String(fState.current));
                    return { output: '', errors: errors, nextLineIdx: blk.startLine + 1, nextEvalBranch: false, halted: false, stopped: false };
                } else {
                    delete state.forStates[blk.startLine];
                    return { output: '', errors: errors, nextLineIdx: lineIdx + 1, nextEvalBranch: false, halted: false, stopped: false };
                }
            }
            if (blk.type === 'while') {
                return { output: '', errors: errors, nextLineIdx: blk.startLine, nextEvalBranch: false, halted: false, stopped: false };
            }
        }

        const statements = splitStatementsByColon(lines[lineIdx]);
        for (let sIdx = 0; sIdx < statements.length; sIdx++) {
            const res = executeStatementSync(statements[sIdx], lineNum);
            lineOutput += res.output;
            if (res.error) errors.push(res.error);
            if (res.action) return handleActionTransition(res.action, lineIdx, lineNum, lineOutput, errors, labelMap, cfStructure, lines.length);
        }

        return { output: lineOutput, errors: errors, nextLineIdx: lineIdx + 1, nextEvalBranch: false, halted: false, stopped: false };
    } catch (e) {
        errors.push('[Line ' + lineNum + '] 実行エラー: ' + e.message);
        return { output: flushFunctionOutput(lineOutput), errors: errors, nextLineIdx: lineIdx + 1, nextEvalBranch: false, halted: false, stopped: false };
    }
}

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
            const res = executeInlineStatementsSync(funcDef.inlineCode, funcDef.startLineOffset);
            if (res.output) state.funcOutputBuffer += res.output;
            if (res.error) throw new Error(res.error);
            if (res.action && res.action.type === 'return') return res.action.value;
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

            const stepRes = executeLineWithControlFlowSync(lineIdx, bodyLines, offset, labelScan.labels, cfStructure, evalBranchFlag);
            if (stepRes.output) state.funcOutputBuffer += stepRes.output;
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
// 3. [非同期] メイン実行エンジン (wait 等に対応)
// ==========================================

function sleepAsync(ms) {
    return new Promise(function(resolve) {
        setTimeout(resolve, ms);
    });
}

function checkAbort() {
    if (state.isAborting) {
        throw new Error('実行がユーザーによって強制停止されました');
    }
}

async function executeStatementAsync(stmtRaw, lineNum) {
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

        checkAbort();

        if (cmdLower === 'tick' && (rest === '' || isSpaceChar(rest[0]))) {
            if (restTrimmed !== '') return { output: '', error: 'tick命令に引数は指定できません', action: null };
            state.lastTickTime = performance.now();
            resetKeyTickState();
            return { output: flushFunctionOutput(''), error: null, action: null };
        }
        if (cmdLower === 'frame' && (rest === '' || isSpaceChar(rest[0]))) {
            if (restTrimmed !== '') return { output: '', error: 'frame命令に引数は指定できません', action: null };
            state.lastFrameTime = performance.now();
            // [TODO: ここでCanvasの描画更新を行う]
            return { output: flushFunctionOutput(''), error: null, action: null };
        }
        
        if (cmdLower === 'fetch') {
            const parsed = parseCommandOptionAndTarget(restTrimmed);
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
            
            if (isSync) {
                try {
                    const response = await fetch(urlStr);
                    if (response.ok) {
                        const text = await response.text();
                        setVar(varName, text);
                    } else {
                        setVar(varName, "");
                    }
                } catch (e) {
                    setVar(varName, "");
                }
            } else {
                fetch(urlStr).then(function(res) {
                    if (res.ok) return res.text();
                    return "";
                }).then(function(text) {
                    setVar(varName, text);
                    if (typeof renderMemoryUI === 'function') renderMemoryUI();
                }).catch(function(e) {});
                setVar(varName, "");
            }
            return { output: flushFunctionOutput(''), error: null, action: null };
        }

        if (cmdLower === 'cont' && (rest === '' || isSpaceChar(rest[0]))) {
            return await executeCmdlineContAsync(restTrimmed);
        }
        if (cmdLower === 'run' && (rest === '' || isSpaceChar(rest[0]) || rest[0] === ':')) {
            return await executeCmdlineRunAsync(restTrimmed);
        }
        if (cmdLower === 'goto' && (rest === '' || isSpaceChar(rest[0]) || rest[0] === '(')) {
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
        if (cmdLower === 'step' && (rest === '' || isSpaceChar(rest[0]) || rest[0] === '(')) {
            return await executeCmdlineStepAsync(restTrimmed);
        }
        if (cmdLower === 'reset' && (rest === '' || isSpaceChar(rest[0]))) {
            if (restTrimmed !== '') {
                return { output: '', error: 'reset命令に引数は指定できません', action: null };
            }
            if (typeof resetEngine === 'function') {
                resetEngine();
            }
            return { output: '', error: null, action: null };
        }

        if (cmdLower === 'stop' && restTrimmed === '') {
            return {
                output: flushFunctionOutput(''),
                error: null,
                action: { type: 'stop' }
            };
        }
        if (cmdLower === 'js' && (rest === '' || isSpaceChar(rest[0]) || rest[0] === '"' || rest[0] === "'" || rest[0] === '/' || rest[0] === '(')) {
            executeJsCommand(rest);
            return { output: flushFunctionOutput(''), error: null, action: null };
        }
        if (cmdLower === 'wait' && (rest === '' || isSpaceChar(rest[0]) || rest[0] === '(')) {
            let ms = 1000;
            if (restTrimmed !== '') {
                const val = evaluateExpression(restTrimmed);
                ms = Math.max(0, Math.trunc(parseCasicNumber(val).num));
            }
            if (!state.isStepMode) {
                await sleepAsync(ms);
            }
            return { output: flushFunctionOutput(''), error: null, action: null };
        }
        if (cmdLower === 'return' && (rest === '' || isSpaceChar(rest[0]) || rest[0] === '(' || rest[0] === '"' || rest[0] === "'" || rest[0] === '/' || rest[0] === '[' || rest[0] === '{')) {
            const retVal = restTrimmed === '' ? "" : evaluateExpression(restTrimmed);
            return {
                output: flushFunctionOutput(''),
                error: null,
                action: { type: 'return', value: retVal }
            };
        }

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
            if (!paren) return { output: '', error: '[Line ' + lineNum + '] if命令の条件括弧が正しくありません', action: null };
            if (paren.after === '') return { output: '', error: null, action: null };
            const condVal = evaluateExpression(paren.inside);
            const preOut = flushFunctionOutput('');
            if (isCasicTruthy(condVal)) {
                const subRes = await executeInlineStatementsAsync(paren.after, lineNum);
                return { output: preOut + subRes.output, error: subRes.error, action: subRes.action };
            }
            return { output: preOut, error: null, action: null };
        }

        if (cmdLower === 'for') {
            const paren = extractParenHead(restTrimmed);
            if (!paren) return { output: '', error: '[Line ' + lineNum + '] for命令の括弧が正しくありません', action: null };
            if (paren.after === '') return { output: '', error: null, action: null };
            const spec = parseForSpecAndEvaluateCount(paren.inside, lineNum);
            let totalOut = flushFunctionOutput('');
            for (let iter = 1; iter <= spec.count; iter++) {
                if (spec.varName) setVar(spec.varName, String(iter));
                
                if (iter % 50 === 0) {
                    checkAbort();
                    await sleepAsync(0);
                }

                const subRes = await executeInlineStatementsAsync(paren.after, lineNum);
                totalOut += subRes.output;
                if (subRes.error) return { output: totalOut, error: subRes.error, action: subRes.action };
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
            if (!paren) return { output: '', error: '[Line ' + lineNum + '] while命令の括弧が正しくありません', action: null };
            if (paren.after === '') return { output: '', error: null, action: null };
            let totalOut = '';
            let loopCounter = 0;
            while (true) {
                loopCounter++;
                if (loopCounter % 50 === 0) {
                    checkAbort();
                    await sleepAsync(0);
                }
                const condVal = evaluateExpression(paren.inside);
                totalOut += flushFunctionOutput('');
                if (!isCasicTruthy(condVal)) break;

                const subRes = await executeInlineStatementsAsync(paren.after, lineNum);
                totalOut += subRes.output;
                if (subRes.error) return { output: totalOut, error: subRes.error, action: subRes.action };
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

        if (cmdLower === 'in') { executeInCommand(rest); return { output: flushFunctionOutput(''), error: null, action: null }; }
        if (cmdLower === 'charin') { executeCharinCommand(rest); return { output: flushFunctionOutput(''), error: null, action: null }; }
        if (cmdLower === 'allin') { executeAllinCommand(rest); return { output: flushFunctionOutput(''), error: null, action: null }; }
        if (cmdLower === 'resetin') { executeResetinCommand(rest); return { output: flushFunctionOutput(''), error: null, action: null }; }
        if (cmdLower === 'out' || cmdLower === 'put') {
            const outStr = executeOutputCommand(cmdLower, rest);
            return { output: flushFunctionOutput(outStr), error: null, action: null };
        }
        if (cmdLower === 'sort' || cmdLower === 'dsort' || cmdLower === 'rev') { executeSortOrRevCommand(cmdLower, rest); return { output: flushFunctionOutput(''), error: null, action: null }; }
        if (cmdLower === 'push') { executePushInsAddCommand(rawCmdLower, rest); return { output: flushFunctionOutput(''), error: null, action: null }; }
        if (cmdLower === 'replace') { executeReplaceCommand(rest); return { output: flushFunctionOutput(''), error: null, action: null }; }
        if (cmdLower === 'del') { executeDelCommand(rest); return { output: flushFunctionOutput(''), error: null, action: null }; }
        if (cmdLower === 'clear' || cmdLower === 'uniq') { executeClearOrUniqCommand(cmdLower, rest); return { output: flushFunctionOutput(''), error: null, action: null }; }
        if (cmdLower === 'rename') { executeRenameCommand(rest); return { output: flushFunctionOutput(''), error: null, action: null }; }
        if (cmdLower === 'seed') { executeSeedCommand(rest); return { output: flushFunctionOutput(''), error: null, action: null }; }
        
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
            // 式としての呼び出しは同期（wait不可）となる
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

async function executeInlineStatementsAsync(codeStr, lineNum) {
    const stmts = splitStatementsByColon(codeStr);
    let out = '';
    for (let i = 0; i < stmts.length; i++) {
        const res = await executeStatementAsync(stmts[i], lineNum);
        out += res.output;
        if (res.error || res.action) {
            return { output: out, error: res.error, action: res.action };
        }
    }
    return { output: out, error: null, action: null };
}

async function evaluateIfBranchAtAsync(block, startBranchIdx, lineNum) {
    const branches = block.branches;
    for (let bIdx = startBranchIdx; bIdx < branches.length; bIdx++) {
        const br = branches[bIdx];
        const isTaken = (br.kind === 'else') ? true : isCasicTruthy(evaluateExpression(br.condExpr));
        const preOut = flushFunctionOutput('');
        if (isTaken) {
            let inlineRes = { output: preOut, error: null, action: null };
            if (br.inlineCode && br.inlineCode !== '') {
                const sub = await executeInlineStatementsAsync(br.inlineCode, startBranchIdx === bIdx ? lineNum : (br.lineIdx + 1));
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

async function executeLineWithControlFlowAsync(lineIdx, lines, startLineOffset, labelMap, cfStructure, evaluateBranchFlag) {
    const lineNum = startLineOffset + lineIdx;
    const info = cfStructure.lineInfos[lineIdx] || { kind: 'normal' };
    let lineOutput = '';
    let errors = [];

    try {
        if (info.kind === 'fun_single' || info.kind === 'fun_multi') {
            state.totalSteps++;
            return {
                output: '',
                errors: errors,
                nextLineIdx: info.kind === 'fun_multi' ? info.block.endLine + 1 : lineIdx + 1,
                nextEvalBranch: false,
                halted: false,
                stopped: false
            };
        }

        if (info.kind === 'if_multi') {
            state.totalSteps++;
            const branchDecision = await evaluateIfBranchAtAsync(info.block, 0, lineNum);
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
            const branchDecision = await evaluateIfBranchAtAsync(info.block, info.branchIndex, lineNum);
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
            const res = await executeStatementAsync(statements[sIdx], lineNum);
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

async function runMainCodeSessionAsync(options) {
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
        checkAbort();
        stepsExecuted++;
        
        if (stepsExecuted % 50 === 0) {
            await sleepAsync(0);
        }

        const currentIdx = state.pc;
        const stepRes = await executeLineWithControlFlowAsync(currentIdx, lines, 1, labelMap, cfStructure, state.stepEvaluateBranch);

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

async function executeCmdlineGoto(restTrimmed) {
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

async function executeCmdlineStepAsync(restTrimmed) {
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
    state.isStepMode = true;
    const res = await runMainCodeSessionAsync({
        endLineIdx: lines.length - 1,
        maxSteps: n
    });
    return {
        output: res.output,
        error: res.errors.length > 0 ? res.errors.join('\n') : null,
        action: null
    };
}

async function executeCmdlineContAsync(restTrimmed) {
    if (restTrimmed !== '') {
        return { output: '', error: 'cont命令に引数は指定できません', action: null };
    }
    const lines = getMainCodeLinesArray();
    if (state.pc < 0 || state.pc >= lines.length) {
        return { output: '', error: null, action: null };
    }
    state.isStopped = false;
    state.isStepMode = false;
    const endIdx = (typeof state.runEndLineIdx === 'number') ? state.runEndLineIdx : (lines.length - 1);
    const res = await runMainCodeSessionAsync({
        endLineIdx: endIdx,
        maxSteps: 100000
    });
    return {
        output: res.output,
        error: res.errors.length > 0 ? res.errors.join('\n') : null,
        action: null
    };
}

async function executeCmdlineRunAsync(restTrimmed) {
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

    state.isStepMode = false;
    const res = await runMainCodeSessionAsync({
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

async function executeCasicCodeAsync(rawCode, startLineOffset = 1, isSubOrCmd = false) {
    const normalized = String(rawCode).split('\r\n').join('\n');
    const lines = normalized.split('\n');

    if (!isSubOrCmd) {
        state.warnings = [];
        const mainRes = await runMainCodeSessionAsync({
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
        checkAbort();
        transitions++;
        
        if (transitions % 50 === 0) {
            await sleepAsync(0);
        }

        if (transitions > MAX_LINE_TRANSITIONS) {
            const lineNum = startLineOffset + lineIdx;
            allErrors.push('[Line ' + lineNum + '] 実行ステップ数が上限(' + MAX_LINE_TRANSITIONS + '回)を超えたため停止しました（無限ループの可能性があります）');
            break;
        }

        const info = cfStructure.lineInfos[lineIdx] || { kind: 'normal' };
        let stepRes = null;

        if (info.kind === 'for_multi' || info.kind === 'end') {
            state.forStates = localForStates;
            stepRes = await executeLineWithControlFlowAsync(lineIdx, lines, startLineOffset, labelMap, cfStructure, evalBranchFlag);
            state.forStates = mainForStates;
        } else {
            state.forStates = mainForStates;
            stepRes = await executeLineWithControlFlowAsync(lineIdx, lines, startLineOffset, labelMap, cfStructure, evalBranchFlag);
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