function escapeHtml(str) {
    return String(str)
        .split('&').join('&amp;')
        .split('<').join('&lt;')
        .split('>').join('&gt;');
}

function highlightCasic(text) {
    const lines = String(text).split('\n');
    const highlightedLines = lines.map(function(line) {
        let result = '';
        let i = 0;
        let isExprStart = true;

        while (i < line.length) {
            const ch = line[i];

            if (ch === '"') {
                let end = i + 1;
                while (end < line.length && !(line[end] === '"' && line[end - 1] !== CHAR_BSLASH)) end++;
                const token = line.slice(i, end + 1);
                result += '<span style="color: #ce9178;">' + escapeHtml(token) + '</span>';
                i = end + 1;
                isExprStart = false;
                continue;
            }

            if (ch === '/' && (isExprStart || isSlashStringStartInLine(line, i))) {
                if (line[i + 1] !== '=' && line[i + 1] !== '.') {
                    const end = findSlashStringEnd(line, i);
                    const token = line.slice(i, end);
                    result += '<span style="color: #ce9178;">' + escapeHtml(token) + '</span>';
                    i = end;
                    isExprStart = false;
                    continue;
                }
            }

            if (ch === '#' || ch === "'") {
                const commentToken = line.slice(i);
                result += '<span style="color: #6a9955;">' + escapeHtml(commentToken) + '</span>';
                break;
            }

            if (ch === ':') {
                result += '<span style="color: #d48844; font-weight: bold;">:</span>';
                i++;
                isExprStart = true;
                continue;
            }

            if (ch === '$') {
                result += '<span style="color: #dcdcaa; font-weight: bold;">$</span>';
                i++;
                isExprStart = false;
                continue;
            }

            if (ch === '=') {
                result += '<span style="color: #d4d4d4;">=</span>';
                i++;
                isExprStart = true;
                continue;
            }

            if (ch === '(' || ch === '[' || ch === '{' || ch === ',') {
                result += escapeHtml(ch);
                i++;
                isExprStart = true;
                continue;
            }

            if (isSpaceChar(ch)) {
                result += escapeHtml(ch);
                i++;
                continue;
            }

            if (isVarStartChar(ch)) {
                let end = i + 1;
                while (end < line.length && isIdentPartChar(line[end])) end++;
                const word = line.slice(i, end);
                const lower = word.toLowerCase();

                const restAfterWord = cleanText(line.slice(end));
                const isFollowedByAssign = matchAssignmentOp(restAfterWord) !== null || restAfterWord.startsWith('[') || restAfterWord.startsWith('{');

                if (!isFollowedByAssign && COMMAND_KEYWORDS.has(lower)) {
                    result += '<span style="color: #569cd6; font-weight: bold;">' + escapeHtml(word) + '</span>';
                    isExprStart = true;
                } else if (lower === 'true' || lower === 'false' || lower === 'and' || lower === 'xor' || lower === 'or') {
                    result += '<span style="color: #4fc1ff;">' + escapeHtml(word) + '</span>';
                    isExprStart = (lower === 'and' || lower === 'xor' || lower === 'or');
                } else if (word.startsWith('_')) {
                    result += '<span style="color: #4ec9b0;">' + escapeHtml(word) + '</span>';
                    isExprStart = false;
                } else {
                    result += '<span style="color: #9cdcfe;">' + escapeHtml(word) + '</span>';
                    isExprStart = false;
                }
                i = end;
                continue;
            }

            result += escapeHtml(ch);
            isExprStart = false;
            i++;
        }
        return result;
    });

    let html = highlightedLines.join('\n');
    if (text.endsWith('\n')) html += ' ';
    return html;
}

function updateLineNumbers() {
    const textarea = document.getElementById('code');
    const gutter = document.getElementById('line-numbers');
    const lineCount = textarea.value.split('\n').length;
    let html = '';
    for (let i = 1; i <= lineCount; i++) {
        const activeClass = (state.pc === i - 1) ? ' active-line' : '';
        html += '<div class="line-num' + activeClass + '" onclick="runClickedLine(' + (i - 1) + ')" title="' + i + '行目だけを実行">' + i + '</div>';
    }
    gutter.innerHTML = html;
}

function updateCodeStats() {
    const textarea = document.getElementById('code');
    const stats = document.getElementById('code-stats');
    if (textarea && stats) {
        const lines = textarea.value.split('\n').length;
        stats.innerText = 'Lines: ' + lines + ' | Length: ' + textarea.value.length + ' | Pos: ' + textarea.selectionStart;
    }
}

function setupEditor(id, isMain = false) {
    const textarea = document.getElementById(id);
    const highlightDiv = document.getElementById(id + '-highlight');
    const gutter = isMain ? document.getElementById('line-numbers') : null;

    const update = function() {
        highlightDiv.innerHTML = highlightCasic(textarea.value);
        if (isMain) {
            updateLineNumbers();
            updateCodeStats();
        }
    };

    textarea.addEventListener('input', update);
    textarea.addEventListener('keyup', update);
    textarea.addEventListener('click', update);
    textarea.addEventListener('focus', update);

    textarea.addEventListener('scroll', function() {
        highlightDiv.scrollTop = textarea.scrollTop;
        highlightDiv.scrollLeft = textarea.scrollLeft;
        if (gutter) gutter.scrollTop = textarea.scrollTop;
    });

    textarea.addEventListener('keydown', function(e) {
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = this.selectionStart;
            const end = this.selectionEnd;
            const val = this.value;
            this.value = val.substring(0, start) + '    ' + val.substring(end);
            this.selectionStart = this.selectionEnd = start + 4;
            update();
        }
    });

    update();
}

function renderMemoryUI() {
    const memDiv = document.getElementById('memory');
    const varKeys = Object.keys(state.vars);
    const arrKeys = Object.keys(state.arrays);
    const dictKeys = Object.keys(state.dicts);

    if (varKeys.length === 0 && arrKeys.length === 0 && dictKeys.length === 0) {
        memDiv.innerHTML = '<div class="memory-empty">メモリは空です</div>';
        return;
    }

    let html = '';
    for (const k of varKeys) {
        const val = state.vars[k];
        const isActive = state.lastModified && state.lastModified.kind === 'var' && state.lastModified.key === k;
        html += '<div class="memory-cell' + (isActive ? ' active' : '') + '">' +
                '<span class="cell-name">' + escapeHtml(k) + '</span>' +
                '<span class="cell-value">"' + escapeHtml(val) + '"</span>' +
                '</div>';
    }

    for (const k of arrKeys) {
        const arr = state.arrays[k];
        const isActive = state.lastModified && state.lastModified.kind === 'arr' && state.lastModified.key === k;
        html += '<div class="memory-array-box' + (isActive ? ' active' : '') + '">' +
                '<div class="memory-array-header">' +
                    '<span class="cell-name">' + escapeHtml(k) + '[]</span>' +
                    '<span class="array-len-badge">Len: ' + arr.length + '</span>' +
                '</div>' +
                '<div class="memory-array-list">';

        if (arr.length === 0) {
            html += '<div style="color:#666; font-size:11px; text-align:center; padding:8px 0;">(空配列)</div>';
        } else {
            for (let i = 0; i < arr.length; i++) {
                const elem = arr[i];
                const elemDisp = Array.isArray(elem) ? formatArrayAsCasicString(elem) : ('"' + String(elem) + '"');
                html += '<div class="memory-array-item">' +
                        '<span class="array-item-idx">[' + (i + 1) + ']</span>' +
                        '<span class="array-item-val">' + escapeHtml(elemDisp) + '</span>' +
                        '</div>';
            }
        }
        html += '</div></div>';
    }

    for (const k of dictKeys) {
        const dictObj = state.dicts[k];
        const dKeys = Object.keys(dictObj);
        const isActive = state.lastModified && state.lastModified.kind === 'dict' && state.lastModified.key === k;
        html += '<div class="memory-array-box' + (isActive ? ' active' : '') + '">' +
                '<div class="memory-array-header">' +
                    '<span class="cell-name">' + escapeHtml(k) + '{}</span>' +
                    '<span class="array-len-badge">Keys: ' + dKeys.length + '</span>' +
                '</div>' +
                '<div class="memory-array-list">';

        if (dKeys.length === 0) {
            html += '<div style="color:#666; font-size:11px; text-align:center; padding:8px 0;">(空辞書)</div>';
        } else {
            for (let i = 0; i < dKeys.length; i++) {
                const keyName = dKeys[i];
                const val = dictObj[keyName];
                const valDisp = Array.isArray(val) ? formatArrayAsCasicString(val) : (isPlainDictObject(val) ? formatDictAsJsonString(val) : ('"' + String(val) + '"'));
                html += '<div class="memory-array-item">' +
                        '<span class="array-item-idx">["' + escapeHtml(keyName) + '"]</span>' +
                        '<span class="array-item-val">' + escapeHtml(valDisp) + '</span>' +
                        '</div>';
            }
        }
        html += '</div></div>';
    }

    memDiv.innerHTML = html;
}

function appendOutputAndErrors(output, errors, isReplace = false, currentLineDisplay = '-', warnings = []) {
    const outDiv = document.getElementById('output');
    if (isReplace) {
        outDiv.innerHTML = '';
    }

    if (output) {
        const span = document.createElement('span');
        span.textContent = output;
        outDiv.appendChild(span);
    }

    if (warnings && warnings.length > 0) {
        for (const w of warnings) {
            const warnDiv = document.createElement('div');
            warnDiv.className = 'warn-text';
            warnDiv.textContent = w;
            outDiv.appendChild(warnDiv);
        }
    }

    if (errors && errors.length > 0) {
        for (const err of errors) {
            const errDiv = document.createElement('div');
            errDiv.className = 'error-text';
            errDiv.textContent = err;
            outDiv.appendChild(errDiv);
        }
    }

    outDiv.scrollTop = outDiv.scrollHeight;
    document.getElementById('exec-stats').innerText = 'Line: ' + currentLineDisplay + ' | InPtr: ' + state.inputPtr + ' | Steps: ' + state.totalSteps;
    renderMemoryUI();
    updateLineNumbers();
}

// メインのCode欄に書かれている関数定義(fun)をスキャンして state.functions に同期する
function syncMainFunctions() {
    const codeEl = document.getElementById('code');
    if (!codeEl) return [];
    const normalized = String(codeEl.value).split('\r\n').join('\n');
    const lines = normalized.split('\n');
    const cf = buildControlFlowStructure(lines, 1, true);
    return cf.errors;
}

function setManualMemory() {
    const nameInput = cleanText(document.getElementById('manual-mem-name').value);
    const valInput = cleanText(document.getElementById('manual-mem-val').value);
    if (!nameInput) return;

    try {
        syncMainFunctions();
        const evaluated = evaluateExpression(valInput);
        if (nameInput.endsWith('{}') || isPlainDictObject(evaluated)) {
            const parsed = parseCasicJsonToDict(evaluated);
            setDict(nameInput, parsed.valid ? parsed.dict : {});
        } else if (nameInput.endsWith('[]') || Array.isArray(evaluated)) {
            setArray(nameInput, coerceToArray(evaluated));
        } else {
            setVar(nameInput, evaluated);
        }
        renderMemoryUI();
    } catch (e) {
        alert('メモリ設定エラー: ' + e.message);
    }
}

function clearOutputOnly() {
    document.getElementById('output').innerHTML = '';
}

function resetEngine() {
    state.vars = {};
    state.arrays = {};
    state.dicts = {};
    state.functions = {};
    state.callStack = [];
    state.funcOutputBuffer = '';
    state.forStates = {};
    state.inputPtr = 0;
    state.rngSeed = null;
    state.stepEvaluateBranch = false;
    state.lastModified = null;
    state.pc = 0;
    state.totalSteps = 0;
    state.warnings = [];

    // 初期化直後でもメインCode欄の関数が呼べるよう同期しておく
    syncMainFunctions();

    document.getElementById('output').innerHTML = '';
    document.getElementById('exec-stats').innerText = 'Line: - | InPtr: 0 | Steps: 0';
    renderMemoryUI();
    updateLineNumbers();
}

function runMain() {
    resetEngine();
    const code = document.getElementById('code').value;
    const res = executeCasicCode(code, 1);
    state.pc = 0;
    appendOutputAndErrors(res.output, res.errors, true, 'All', res.warnings);
}

function stepMain() {
    const lines = document.getElementById('code').value.split('\n');
    if (state.pc >= lines.length || state.pc < 0) {
        state.pc = 0;
        state.stepEvaluateBranch = false;
    }
    const lineIdx = state.pc;
    state.warnings = [];
    const labelScan = buildLabelMap(lines, 1);
    const cfStructure = buildControlFlowStructure(lines, 1, true);
    const res = executeLineWithControlFlow(lineIdx, lines, 1, labelScan.labels, cfStructure, state.stepEvaluateBranch);
    const allErrors = labelScan.errors.concat(cfStructure.errors, res.errors);

    if (res.nextLineIdx >= lines.length || res.halted) {
        state.pc = 0;
        state.stepEvaluateBranch = false;
    } else {
        state.pc = res.nextLineIdx;
        state.stepEvaluateBranch = res.nextEvalBranch;
    }
    appendOutputAndErrors(res.output, allErrors, false, lineIdx + 1, state.warnings);
}

function runClickedLine(lineIdx) {
    const lines = document.getElementById('code').value.split('\n');
    if (lineIdx < 0 || lineIdx >= lines.length) return;
    state.pc = lineIdx;
    state.warnings = [];
    const labelScan = buildLabelMap(lines, 1);
    const cfStructure = buildControlFlowStructure(lines, 1, true);
    const res = executeLineWithControlFlow(lineIdx, lines, 1, labelScan.labels, cfStructure, true);
    const allErrors = labelScan.errors.concat(cfStructure.errors, res.errors);

    if (res.nextLineIdx < lines.length && res.nextLineIdx !== lineIdx + 1) {
        state.pc = res.nextLineIdx;
        state.stepEvaluateBranch = res.nextEvalBranch;
    }
    appendOutputAndErrors(res.output, allErrors, false, lineIdx + 1, state.warnings);
}

function runSub(num) {
    // 追加実行の前にメインのCode欄の関数定義を同期する
    syncMainFunctions();
    const code = document.getElementById('sub-code' + num).value;
    const res = executeCasicCode(code, 1);
    appendOutputAndErrors(res.output, res.errors, false, 'Sub' + num, res.warnings);
}

function initCheckboxes() {
    const checkboxes = document.querySelectorAll('.sub-chk');
    checkboxes.forEach(function(chk) {
        chk.addEventListener('change', function() {
            const checkedCount = document.querySelectorAll('.sub-chk:checked').length;
            if (checkedCount > 3) {
                alert('画面スペースの都合上、同時に表示できる追加実行枠は最大3つまでです。\n（※非表示にしても内容は保持されます）');
                this.checked = false;
                return;
            }
            updateVisibility();
        });
    });
    updateVisibility();
}

function updateVisibility() {
    for (let i = 1; i <= 6; i++) {
        const chk = document.getElementById('chk-sub' + i);
        const box = document.getElementById('box-sub' + i);
        if (chk && box) {
            if (chk.checked) box.classList.remove('hidden');
            else box.classList.add('hidden');
        }
    }
}

window.onload = function() {
    document.getElementById('code').value = [
        '# 1. 1行定義のユーザー定義関数 (仕様書の例)',
        'fun f(x, y) return x*5 + y*2',
        'out "f(2, 3) = " & f(2, 3)',
        '',
        '# 2. 複数行定義とローカル変数 _i, _ans (仕様書の例)',
        'fun s(x)',
        '    for(_i, x)',
        '        _ans += _i',
        '    end',
        '    return _ans',
        'end',
        'out "s(10) = " & s(10)',
        '',
        '# 3. returnで途中終了する確認 & グローバル変数の変更確認',
        'fun g(x)',
        '    globalCounter += 1',
        '    return x + 4',
        '    out "ここは実行されません"',
        'end',
        'out "g(5) = " & g(5) & " / globalCounter = " & globalCounter'
    ].join('\n');

    document.getElementById('sub-code1').value = [
        '# 初期化直後でもCode欄の関数 s(x) を呼び出せます',
        'out "s(100) = " & s(100)'
    ].join('\n');

    document.getElementById('sub-code2').value = [
        '# 関数外で _ から始まる変数を使うとエラーになるテスト',
        '_local = 10'
    ].join('\n');

    setupEditor('code', true);
    for (let i = 1; i <= 6; i++) {
        setupEditor('sub-code' + i, false);
    }
    initCheckboxes();
    syncMainFunctions();
    renderMemoryUI();
};