// 元のBrainfuck実行環境と同じネスト深さカラーパレット
const bracketColors = [
    '#4ea8de', // 1重: 青系
    '#40c463', // 2重: 緑系
    '#d48844', // 3重: オレンジ系
    '#d4c428', // 4重: マスタードイエロー
    '#ff77cc', // 5重: ピンク
    '#9999ff', // 6重: 青紫色
    '#00ffff', // 7重: 明るい水色
    '#ffffff'  // 8重: 真っ白
];

// 別ウィンドウ（ポップアップ）管理オブジェクト
const popupWindows = {
    input: null,
    output: null,
    memory: null
};

const popupFontSizes = {
    input: 18,
    output: 18,
    memory: 15
};

function escapeHtml(str) {
    return String(str)
        .split('&').join('&amp;')
        .split('<').join('&lt;')
        .split('>').join('&gt;');
}

function analyzeBlockNestingForHighlight(lines) {
    const lineMeta = new Array(lines.length).fill(null);
    const stack = [];
    let nextGroupId = 1;

    for (let idx = 0; idx < lines.length; idx++) {
        const info = classifyControlLine(lines[idx]);

        if (info.kind === 'if_multi' || info.kind === 'for_multi' || info.kind === 'while_multi' || info.kind === 'fun_multi') {
            const depth = stack.length;
            const groupId = nextGroupId++;
            const groupObj = {
                groupId: groupId,
                type: info.keyword,
                depth: depth,
                hasElse: false,
                lines: [idx]
            };
            stack.push(groupObj);
            lineMeta[idx] = {
                depth: depth,
                unmatched: false,
                groupId: groupId,
                groupRef: groupObj
            };
        } else if (info.kind === 'elseif') {
            const top = stack.length > 0 ? stack[stack.length - 1] : null;
            if (!top || top.type !== 'if' || top.hasElse) {
                lineMeta[idx] = { depth: 0, unmatched: true, groupId: -1, groupRef: null };
            } else {
                top.lines.push(idx);
                lineMeta[idx] = {
                    depth: top.depth,
                    unmatched: false,
                    groupId: top.groupId,
                    groupRef: top
                };
            }
        } else if (info.kind === 'else') {
            const top = stack.length > 0 ? stack[stack.length - 1] : null;
            if (!top || top.type !== 'if' || top.hasElse) {
                lineMeta[idx] = { depth: 0, unmatched: true, groupId: -1, groupRef: null };
            } else {
                top.hasElse = true;
                top.lines.push(idx);
                lineMeta[idx] = {
                    depth: top.depth,
                    unmatched: false,
                    groupId: top.groupId,
                    groupRef: top
                };
            }
        } else if (info.kind === 'end') {
            const top = stack.length > 0 ? stack.pop() : null;
            if (!top) {
                lineMeta[idx] = { depth: 0, unmatched: true, groupId: -1, groupRef: null };
            } else {
                top.lines.push(idx);
                lineMeta[idx] = {
                    depth: top.depth,
                    unmatched: false,
                    groupId: top.groupId,
                    groupRef: top
                };
            }
        }
    }

    return lineMeta;
}

function highlightCasic(text, cursorPos = -1) {
    const lines = String(text).split('\n');
    const blockMetaByLine = analyzeBlockNestingForHighlight(lines);

    let activeGroupId = -1;
    if (cursorPos >= 0) {
        let charCount = 0;
        for (let lIdx = 0; lIdx < lines.length; lIdx++) {
            const lineLen = lines[lIdx].length;
            if (cursorPos >= charCount && cursorPos <= charCount + lineLen) {
                const meta = blockMetaByLine[lIdx];
                if (meta && !meta.unmatched && meta.groupId !== -1) {
                    activeGroupId = meta.groupId;
                }
                break;
            }
            charCount += lineLen + 1;
        }
    }

    const highlightedLines = lines.map(function(line, lineIdx) {
        let result = '';
        let i = 0;
        let isExprStart = true;
        let isFirstWordInLine = true;
        const lineMeta = blockMetaByLine[lineIdx];

        while (i < line.length) {
            const ch = line[i];

            if (ch === '"') {
                let end = i + 1;
                while (end < line.length && !(line[end] === '"' && line[end - 1] !== CHAR_BSLASH)) end++;
                const token = line.slice(i, end + 1);
                result += '<span style="color: #ce9178;">' + escapeHtml(token) + '</span>';
                i = end + 1;
                isExprStart = false;
                isFirstWordInLine = false;
                continue;
            }

            if (ch === '/' && (isExprStart || isSlashStringStartInLine(line, i))) {
                if (line[i + 1] !== '=' && line[i + 1] !== '.') {
                    const end = findSlashStringEnd(line, i);
                    const token = line.slice(i, end);
                    result += '<span style="color: #ce9178;">' + escapeHtml(token) + '</span>';
                    i = end;
                    isExprStart = false;
                    isFirstWordInLine = false;
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
                isFirstWordInLine = false;
                continue;
            }

            if (ch === '$') {
                result += '<span style="color: #dcdcaa; font-weight: bold;">$</span>';
                i++;
                isExprStart = false;
                isFirstWordInLine = false;
                continue;
            }

            if (ch === '=') {
                result += '<span style="color: #d4d4d4;">=</span>';
                i++;
                isExprStart = true;
                isFirstWordInLine = false;
                continue;
            }

            if (ch === '(' || ch === '[' || ch === '{' || ch === ',') {
                result += escapeHtml(ch);
                i++;
                isExprStart = true;
                isFirstWordInLine = false;
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
                const isFollowedByParen = restAfterWord.startsWith('(') || restAfterWord.startsWith('.(');

                if (isFirstWordInLine && lineMeta && !isFollowedByAssign) {
                    const isGlow = (activeGroupId !== -1 && lineMeta.groupId === activeGroupId);
                    const glowCSS = isGlow ? ' outline: 1px solid rgba(255,255,255,0.45); background-color: rgba(255,255,255,0.12); border-radius: 2px;' : '';

                    if (lineMeta.unmatched) {
                        result += '<span style="color: #ff4d4d; font-weight: bold; background-color: rgba(255,0,0,0.2);' + glowCSS + '">' + escapeHtml(word) + '</span>';
                    } else {
                        const depthColor = bracketColors[lineMeta.depth % bracketColors.length];
                        result += '<span style="color: ' + depthColor + '; font-weight: bold;' + glowCSS + '">' + escapeHtml(word) + '</span>';
                    }
                    isExprStart = true;
                    isFirstWordInLine = false;
                    i = end;
                    continue;
                }

                isFirstWordInLine = false;

                if (!isFollowedByAssign && COMMAND_KEYWORDS.has(lower) && (!isFollowedByParen || lower === 'if' || lower === 'elseif' || lower === 'for' || lower === 'while' || lower === 'break')) {
                    result += '<span style="color: #569cd6; font-weight: bold;">' + escapeHtml(word) + '</span>';
                    isExprStart = true;
                } else if (isFollowedByParen && (BUILTIN_FUNCTION_NAMES.has(lower) || Object.prototype.hasOwnProperty.call(state.functions, lower))) {
                    result += '<span style="color: #dcdcaa;">' + escapeHtml(word) + '</span>';
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
            isFirstWordInLine = false;
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
        highlightDiv.innerHTML = highlightCasic(textarea.value, textarea.selectionStart);
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

function buildMemoryItemsHtml() {
    const varKeys = Object.keys(state.vars);
    const arrKeys = Object.keys(state.arrays);
    const dictKeys = Object.keys(state.dicts);

    if (varKeys.length === 0 && arrKeys.length === 0 && dictKeys.length === 0) {
        return '<div class="memory-empty">メモリは空です</div>';
    }

    let html = '';
    for (const k of varKeys) {
        const val = state.vars[k];
        const isActive = state.lastModified && state.lastModified.kind === 'var' && state.lastModified.key === k;
        html += '<div class="memory-cell' + (isActive ? ' active' : '') + '">' +
                '<span class="cell-name">' + escapeHtml(k) + '</span>' +
                '<span class="cell-value" title="' + escapeHtml(val) + '">"' + escapeHtml(val) + '"</span>' +
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
                        '<span class="array-item-val" title="' + escapeHtml(elemDisp) + '">' + escapeHtml(elemDisp) + '</span>' +
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
                        '<span class="array-item-val" title="' + escapeHtml(valDisp) + '">' + escapeHtml(valDisp) + '</span>' +
                        '</div>';
            }
        }
        html += '</div></div>';
    }

    return html;
}

function renderMemoryUI() {
    const memDiv = document.getElementById('memory');
    const html = buildMemoryItemsHtml();
    memDiv.innerHTML = html;
    syncPopupMemory();
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
    syncPopupOutput();
}

// ==========================================
// ポップアップウィンドウ（別窓）の生成と同期処理
// ==========================================

function openPopupWindow(type) {
    const existing = popupWindows[type];
    if (existing && !existing.closed) {
        existing.focus();
        syncSpecificPopup(type);
        return;
    }

    const titles = {
        input: 'CASIC - Input (入力データ編集)',
        output: 'CASIC - Output (出力結果確認)',
        memory: 'CASIC - Memory (メモリ可視化)'
    };

    const specs = 'width=680,height=540,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes';
    const win = window.open('', 'casic_popup_' + type, specs);
    if (!win) {
        alert('ポップアップウィンドウがブロックされました。ブラウザの設定でポップアップを許可してください。');
        return;
    }

    popupWindows[type] = win;
    const initSize = popupFontSizes[type] || 16;

    let extraControlsHtml = '';
    if (type === 'input') {
        extraControlsHtml =
            '<label class="wrap-label"><input type="checkbox" id="chk-wrap" checked> 端で折り返す</label>' +
            '<button id="btn-update-input" class="action-btn update-btn" title="Ctrl+Enterでも更新可能">更新 (元のInputへ反映)</button>' +
            '<span id="update-msg" class="update-msg"></span>';
    } else if (type === 'output') {
        extraControlsHtml =
            '<label class="wrap-label"><input type="checkbox" id="chk-wrap" checked> 端で折り返す</label>' +
            '<button id="btn-clear-output" class="action-btn clear-btn">出力クリア</button>';
    }

    let bodyContentHtml = '';
    if (type === 'input') {
        bodyContentHtml = '<textarea id="popup-input-area" spellcheck="false" placeholder="ここに入力データを書く..."></textarea>';
    } else if (type === 'output') {
        bodyContentHtml = '<div id="popup-output-area" class="popup-output-area"></div>';
    } else if (type === 'memory') {
        bodyContentHtml = '<div id="popup-memory-area" class="popup-memory-area"></div>';
    }

    const htmlDoc =
        '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">' +
        '<title>' + titles[type] + '</title>' +
        '<style>' +
        ':root { --vscode-font: Menlo, Monaco, Consolas, "Courier New", monospace; --content-font-size: ' + initSize + 'px; }' +
        'body { font-family: sans-serif; margin: 0; padding: 12px; background-color: #1e1e1e; color: #d4d4d4; height: 100vh; box-sizing: border-box; display: flex; flex-direction: column; gap: 10px; overflow: hidden; }' +
        '.toolbar { display: flex; align-items: center; justify-content: space-between; background: #252526; padding: 8px 12px; border: 1px solid #444; border-radius: 6px; flex-wrap: wrap; gap: 10px; flex-shrink: 0; }' +
        '.font-controls { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #ccc; }' +
        '.size-btn { width: 28px; height: 26px; background: #3c3c3c; color: #fff; border: 1px solid #555; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 14px; }' +
        '.size-btn:hover { background: #007acc; border-color: #007acc; }' +
        '#font-slider { width: 100px; accent-color: #007acc; cursor: pointer; }' +
        '#font-size-label { font-family: var(--vscode-font); min-width: 42px; text-align: center; color: #9cdcfe; font-weight: bold; }' +
        '.right-controls { display: flex; align-items: center; gap: 10px; }' +
        '.wrap-label { font-size: 12px; color: #ccc; display: flex; align-items: center; gap: 4px; cursor: pointer; user-select: none; }' +
        '.action-btn { padding: 5px 12px; font-size: 13px; font-weight: bold; color: #fff; border: none; border-radius: 4px; cursor: pointer; }' +
        '.update-btn { background-color: #0f8f62; }' +
        '.update-btn:hover { background-color: #0b6b49; }' +
        '.clear-btn { background-color: #555; font-weight: normal; font-size: 12px; }' +
        '.clear-btn:hover { background-color: #777; }' +
        '.update-msg { font-size: 12px; color: #4ec9b0; font-weight: bold; }' +
        '#popup-input-area { flex: 1; width: 100%; resize: none; background: #1e1e1e; color: #d4d4d4; border: 1px solid #444; border-radius: 4px; padding: 12px; box-sizing: border-box; font-family: var(--vscode-font); font-size: var(--content-font-size); line-height: 1.5; white-space: pre-wrap; overflow: auto; outline: none; }' +
        '#popup-input-area:focus { border-color: #007acc; }' +
        '.popup-output-area { flex: 1; width: 100%; background: #1e1e1e; color: #d4d4d4; border: 1px solid #444; border-radius: 4px; padding: 12px; box-sizing: border-box; font-family: var(--vscode-font); font-size: var(--content-font-size); line-height: 1.45; white-space: pre-wrap; word-break: break-all; overflow: auto; }' +
        '.error-text { color: #ff6b6b; }' +
        '.warn-text { color: #dcdcaa; }' +
        '.popup-memory-area { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 4px; font-size: var(--content-font-size); }' +
        '.memory-cell { width: 100%; min-height: 34px; display: flex; align-items: center; justify-content: space-between; box-sizing: border-box; padding: 6px 10px; border: 1px solid #555; background-color: #333; font-family: var(--vscode-font); border-radius: 4px; gap: 12px; flex-shrink: 0; overflow: hidden; }' +
        '.memory-cell.active { background-color: #094771; border-color: #00a8ff; color: white; }' +
        '.cell-name { color: #9cdcfe; font-size: 1em; font-weight: bold; flex-shrink: 0; }' +
        '.cell-value { font-size: 1em; color: #ce9178; white-space: nowrap; overflow-x: auto; overflow-y: hidden; flex: 1; min-width: 0; text-align: right; }' +
        '.memory-array-box { width: 100%; max-height: 260px; display: flex; flex-direction: column; box-sizing: border-box; border: 1px solid #555; background-color: #2b2b2c; font-family: var(--vscode-font); border-radius: 4px; flex-shrink: 0; overflow: hidden; }' +
        '.memory-array-box.active { border-color: #00a8ff; }' +
        '.memory-array-header { display: flex; justify-content: space-between; align-items: center; padding: 5px 10px; background-color: #383839; border-bottom: 1px solid #4a4a4a; flex-shrink: 0; }' +
        '.memory-array-box.active .memory-array-header { background-color: #094771; }' +
        '.array-len-badge { font-size: 0.85em; color: #aaa; }' +
        '.memory-array-list { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 6px; display: flex; flex-direction: column; gap: 3px; }' +
        '.memory-array-item { display: flex; justify-content: space-between; align-items: center; padding: 3px 6px; background-color: #333; border-radius: 2px; font-size: 0.95em; gap: 8px; flex-shrink: 0; overflow: hidden; }' +
        '.array-item-idx { color: #888; font-size: 0.9em; flex-shrink: 0; }' +
        '.array-item-val { color: #ce9178; white-space: nowrap; overflow-x: auto; overflow-y: hidden; flex: 1; min-width: 0; text-align: right; }' +
        '.memory-empty { color: #666; text-align: center; margin-top: 30px; font-family: var(--vscode-font); }' +
        '</style></head><body>' +
        '<div class="toolbar">' +
            '<div class="font-controls">' +
                '<span>文字サイズ:</span>' +
                '<button class="size-btn" id="btn-font-dec" title="小さくする">-</button>' +
                '<input type="range" id="font-slider" min="10" max="48" value="' + initSize + '">' +
                '<button class="size-btn" id="btn-font-inc" title="大きくする">+</button>' +
                '<span id="font-size-label">' + initSize + 'px</span>' +
            '</div>' +
            '<div class="right-controls">' + extraControlsHtml + '</div>' +
        '</div>' +
        bodyContentHtml +
        '</body></html>';

    win.document.open();
    win.document.write(htmlDoc);
    win.document.close();

    // 文字サイズ変更イベントの設定
    const slider = win.document.getElementById('font-slider');
    const decBtn = win.document.getElementById('btn-font-dec');
    const incBtn = win.document.getElementById('btn-font-inc');
    const sizeLabel = win.document.getElementById('font-size-label');

    function applyFontSize(newSize) {
        const clamped = Math.max(10, Math.min(48, Number(newSize) || 16));
        popupFontSizes[type] = clamped;
        slider.value = String(clamped);
        sizeLabel.textContent = clamped + 'px';
        win.document.documentElement.style.setProperty('--content-font-size', clamped + 'px');
    }

    slider.addEventListener('input', function() { applyFontSize(slider.value); });
    decBtn.addEventListener('click', function() { applyFontSize(popupFontSizes[type] - 2); });
    incBtn.addEventListener('click', function() { applyFontSize(popupFontSizes[type] + 2); });

    // 端で折り返すチェックボックスの設定（改行位置の厳密な確認用）
    const chkWrap = win.document.getElementById('chk-wrap');
    if (chkWrap) {
        chkWrap.addEventListener('change', function() {
            const targetEl = win.document.getElementById(type === 'input' ? 'popup-input-area' : 'popup-output-area');
            if (targetEl) {
                targetEl.style.whiteSpace = chkWrap.checked ? 'pre-wrap' : 'pre';
                targetEl.style.wordBreak = chkWrap.checked ? 'break-all' : 'normal';
            }
        });
    }

    // Input専用の「更新」ボタン設定
    if (type === 'input') {
        const updateBtn = win.document.getElementById('btn-update-input');
        const popupInputArea = win.document.getElementById('popup-input-area');
        const updateMsg = win.document.getElementById('update-msg');

        function pushInputToMain() {
            const mainInput = document.getElementById('input-data');
            if (mainInput && popupInputArea) {
                mainInput.value = popupInputArea.value;
                if (updateMsg) {
                    updateMsg.textContent = '✓ 反映しました';
                    setTimeout(function() {
                        if (!win.closed && updateMsg) updateMsg.textContent = '';
                    }, 1500);
                }
            }
        }

        if (updateBtn) {
            updateBtn.addEventListener('click', pushInputToMain);
        }
        if (popupInputArea) {
            popupInputArea.addEventListener('keydown', function(e) {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    pushInputToMain();
                }
            });
        }
    }

    // Output専用の「出力クリア」ボタン設定
    if (type === 'output') {
        const clearBtn = win.document.getElementById('btn-clear-output');
        if (clearBtn) {
            clearBtn.addEventListener('click', function() {
                clearOutputOnly();
            });
        }
    }

    syncSpecificPopup(type);
}

function syncPopupInput() {
    const win = popupWindows.input;
    if (!win || win.closed) return;
    const popupInputArea = win.document.getElementById('popup-input-area');
    const mainInput = document.getElementById('input-data');
    if (popupInputArea && mainInput) {
        popupInputArea.value = mainInput.value;
    }
}

function syncPopupOutput() {
    const win = popupWindows.output;
    if (!win || win.closed) return;
    const popupOut = win.document.getElementById('popup-output-area');
    const mainOut = document.getElementById('output');
    if (popupOut && mainOut) {
        popupOut.innerHTML = mainOut.innerHTML;
        popupOut.scrollTop = popupOut.scrollHeight;
    }
}

function syncPopupMemory() {
    const win = popupWindows.memory;
    if (!win || win.closed) return;
    const popupMem = win.document.getElementById('popup-memory-area');
    if (popupMem) {
        popupMem.innerHTML = buildMemoryItemsHtml();
    }
}

function syncSpecificPopup(type) {
    if (type === 'input') syncPopupInput();
    else if (type === 'output') syncPopupOutput();
    else if (type === 'memory') syncPopupMemory();
}

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
    syncPopupOutput();
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

    syncMainFunctions();

    document.getElementById('output').innerHTML = '';
    document.getElementById('exec-stats').innerText = 'Line: - | InPtr: 0 | Steps: 0';
    renderMemoryUI();
    updateLineNumbers();
    syncPopupOutput();
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
    syncMainFunctions();
    const code = document.getElementById('sub-code' + num).value;
    const res = executeCasicCode(code, 1);
    appendOutputAndErrors(res.output, res.errors, false, 'Sub' + num, res.warnings);
}

window.onload = function() {
    document.getElementById('input-data').value = [
        '3',
        '10 20',
        '30 40',
        '50 60'
    ].join('\n');

    // メイン側のInputを編集したときも開いているInput別窓へ自動同期
    document.getElementById('input-data').addEventListener('input', function() {
        syncPopupInput();
    });

    document.getElementById('code').value = [
        '# 1. ネストの深さによる色分け確認 (fun -> for -> while -> if -> for)',
        'fun check_nest(n)',
        '    for(_i, n)',
        '        _w = 0',
        '        while(_w < 1)',
        '            if(_i % 2 = 0)',
        '                for(_k, 2)',
        '                    _ans += _k',
        '                end',
        '            else',
        '                _ans += 10',
        '            end',
        '            _w += 1',
        '        end',
        '    end',
        '    return _ans',
        'end',
        'out "check_nest(4) = " & check_nest(4)',
        '',
        '# 2. とても長い文字列を変数に入れたときの横スクロール確認',
        'long_str = rep("CASIC_LONG_STRING_TEST_", 10)',
        'out "long_str length = " & len(long_str)'
    ].join('\n');

    document.getElementById('sub-code1').value = 'out check_nest(6)';
    document.getElementById('sub-code2').value = 'long_str &= "_APPENDED"';
    document.getElementById('sub-code3').value = 'resetin : in n : in a[], b[] : out(,) a[] : out(,) b[]';

    setupEditor('code', true);
    for (let i = 1; i <= 3; i++) {
        setupEditor('sub-code' + i, false);
    }
    syncMainFunctions();
    renderMemoryUI();
};