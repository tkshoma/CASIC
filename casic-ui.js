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

const MAIN_OUTPUT_DISPLAY_LIMIT = 20000;
let currentActiveTab = 'code';

const editorUpdateCallbacks = {};

// 実行中の非同期プロセスを管理する状態フラグ
let isExecutionRunning = false;

// UI上の実行ボタンを「■ 停止」状態に切り替える関数
function setExecutionUIMode(isRunning) {
    isExecutionRunning = isRunning;
    const mainRunBtn = document.querySelector('.button-cluster-row button:first-child');
    if (isRunning) {
        if (mainRunBtn) {
            mainRunBtn.textContent = '■ 停止';
            mainRunBtn.style.backgroundColor = '#b33939';
        }
    } else {
        if (mainRunBtn) {
            mainRunBtn.textContent = 'RUN';
            mainRunBtn.style.backgroundColor = '';
        }
    }
}

// 停止リクエスト
function abortCurrentExecution() {
    if (isExecutionRunning) {
        state.isAborting = true;
    }
}

// ==========================================
// 0. 仮想タブ切り替え制御 ＆ Code全画面表示切替
// ==========================================

function switchVirtualTab(tabName) {
    const validTabs = ['code', 'func', 'import', 'settings'];
    if (validTabs.indexOf(tabName) === -1) return;

    currentActiveTab = tabName;

    for (let i = 0; i < validTabs.length; i++) {
        const t = validTabs[i];
        const pane = document.getElementById('tab-pane-' + t);
        const btn = document.getElementById('tab-btn-' + t);
        if (pane) {
            if (t === tabName) pane.classList.remove('hidden');
            else pane.classList.add('hidden');
        }
        if (btn) {
            if (t === tabName) btn.classList.add('active');
            else btn.classList.remove('active');
        }
    }

    if (tabName === 'code') {
        syncMainFunctions();
        if (editorUpdateCallbacks['code']) editorUpdateCallbacks['code']();
    } else if (tabName === 'func') {
        if (editorUpdateCallbacks['func-code']) editorUpdateCallbacks['func-code']();
    } else if (tabName === 'import' && typeof renderAllAssetLists === 'function') {
        renderAllAssetLists();
    } else if (tabName === 'settings') {
        syncSettingsModalInputs();
    }
}

function toggleCodeFullscreen() {
    const codeCol = document.getElementById('code-column');
    const btn = document.getElementById('btn-code-fullscreen');
    if (!codeCol) return;

    const isFull = codeCol.classList.toggle('code-fullscreen');
    if (btn) {
        btn.textContent = isFull ? '全画面解除' : '全画面';
        btn.style.backgroundColor = isFull ? '#007acc' : '';
        btn.style.color = isFull ? '#ffffff' : '';
    }
    if (editorUpdateCallbacks['code']) {
        editorUpdateCallbacks['code']();
    }
}

// ==========================================
// 1. エディタ設定 & localStorage 保存・復元
// ==========================================
const SETTINGS_STORAGE_KEY = 'casic_editor_settings_v1';

const editorSettings = {
    editorFontSize: 18,
    tabSpaces: 4,
    autoIndent: true,
    autoCloseParen: true,
    autoCloseBracket: true,
    autoCloseQuote: true
};

function applyEditorCssVars() {
    const spaces = Math.max(1, Math.min(16, Number(editorSettings.tabSpaces) || 4));
    const fontSize = Math.max(10, Math.min(48, Number(editorSettings.editorFontSize) || 18));

    document.documentElement.style.setProperty('--tab-size', String(spaces));
    document.documentElement.style.setProperty('--editor-font-size', fontSize + 'px');

    const codeLabel = document.getElementById('code-font-size-label');
    const funcLabel = document.getElementById('func-font-size-label');
    const settingFontInput = document.getElementById('setting-editor-font-size');
    if (codeLabel) codeLabel.textContent = fontSize + 'px';
    if (funcLabel) funcLabel.textContent = fontSize + 'px';
    if (settingFontInput) settingFontInput.value = String(fontSize);

    if (typeof popupWindows !== 'undefined') {
        Object.keys(popupWindows).forEach(function(k) {
            const w = popupWindows[k];
            if (w && !w.closed && w.document && w.document.documentElement) {
                w.document.documentElement.style.setProperty('--tab-size', String(spaces));
            }
        });
    }

    Object.keys(editorUpdateCallbacks).forEach(function(id) {
        editorUpdateCallbacks[id]();
    });
}

function setEditorFontSize(newSize) {
    const clamped = Math.max(10, Math.min(48, Math.trunc(Number(newSize) || 18)));
    editorSettings.editorFontSize = clamped;
    saveEditorSettings();
}

function changeEditorFontSize(delta) {
    setEditorFontSize((Number(editorSettings.editorFontSize) || 18) + delta);
}

function loadEditorSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                if (typeof parsed.editorFontSize === 'number' && parsed.editorFontSize >= 10 && parsed.editorFontSize <= 48) {
                    editorSettings.editorFontSize = Math.trunc(parsed.editorFontSize);
                }
                if (typeof parsed.tabSpaces === 'number' && parsed.tabSpaces >= 1 && parsed.tabSpaces <= 16) {
                    editorSettings.tabSpaces = Math.trunc(parsed.tabSpaces);
                }
                if (typeof parsed.autoIndent === 'boolean') {
                    editorSettings.autoIndent = parsed.autoIndent;
                }
                if (typeof parsed.autoCloseParen === 'boolean') {
                    editorSettings.autoCloseParen = parsed.autoCloseParen;
                }
                if (typeof parsed.autoCloseBracket === 'boolean') {
                    editorSettings.autoCloseBracket = parsed.autoCloseBracket;
                }
                if (typeof parsed.autoCloseQuote === 'boolean') {
                    editorSettings.autoCloseQuote = parsed.autoCloseQuote;
                }
            }
        }
    } catch (e) {
    }
    applyEditorCssVars();
}

function saveEditorSettings() {
    try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(editorSettings));
    } catch (e) {
    }
    applyEditorCssVars();
}

function ensureBracketSettingItemExists() {
    if (document.getElementById('setting-auto-bracket')) return;
    const parenChk = document.getElementById('setting-auto-paren');
    if (!parenChk || !parenChk.parentElement || !parenChk.parentElement.parentElement) return;
    const modalBody = parenChk.parentElement.parentElement;
    const itemDiv = document.createElement('div');
    itemDiv.className = 'setting-item';
    itemDiv.innerHTML =
        '<label for="setting-auto-bracket">「[」入力時の自動閉じ括弧「]」</label>' +
        '<input type="checkbox" id="setting-auto-bracket" checked>';
    modalBody.insertBefore(itemDiv, parenChk.parentElement.nextSibling);
}

function syncSettingsModalInputs() {
    const fontInput = document.getElementById('setting-editor-font-size');
    const tabInput = document.getElementById('setting-tab-spaces');
    const indentChk = document.getElementById('setting-auto-indent');
    const parenChk = document.getElementById('setting-auto-paren');
    const bracketChk = document.getElementById('setting-auto-bracket');
    const quoteChk = document.getElementById('setting-auto-quote');

    if (fontInput) fontInput.value = String(editorSettings.editorFontSize);
    if (tabInput) tabInput.value = String(editorSettings.tabSpaces);
    if (indentChk) indentChk.checked = editorSettings.autoIndent;
    if (parenChk) parenChk.checked = editorSettings.autoCloseParen;
    if (bracketChk) bracketChk.checked = editorSettings.autoCloseBracket;
    if (quoteChk) quoteChk.checked = editorSettings.autoCloseQuote;
}

function initSettingsModalEvents() {
    const fontInput = document.getElementById('setting-editor-font-size');
    const tabInput = document.getElementById('setting-tab-spaces');
    const indentChk = document.getElementById('setting-auto-indent');
    const parenChk = document.getElementById('setting-auto-paren');
    const bracketChk = document.getElementById('setting-auto-bracket');
    const quoteChk = document.getElementById('setting-auto-quote');

    if (fontInput) {
        fontInput.addEventListener('change', function() {
            const val = Math.max(10, Math.min(48, Math.trunc(Number(fontInput.value) || 18)));
            editorSettings.editorFontSize = val;
            fontInput.value = String(val);
            saveEditorSettings();
        });
    }
    if (tabInput) {
        tabInput.addEventListener('change', function() {
            const val = Math.max(1, Math.min(16, Math.trunc(Number(tabInput.value) || 4)));
            editorSettings.tabSpaces = val;
            tabInput.value = String(val);
            saveEditorSettings();
        });
    }
    if (indentChk) {
        indentChk.addEventListener('change', function() {
            editorSettings.autoIndent = indentChk.checked;
            saveEditorSettings();
        });
    }
    if (parenChk) {
        parenChk.addEventListener('change', function() {
            editorSettings.autoCloseParen = parenChk.checked;
            saveEditorSettings();
        });
    }
    if (bracketChk) {
        bracketChk.addEventListener('change', function() {
            editorSettings.autoCloseBracket = bracketChk.checked;
            saveEditorSettings();
        });
    }
    if (quoteChk) {
        quoteChk.addEventListener('change', function() {
            editorSettings.autoCloseQuote = quoteChk.checked;
            saveEditorSettings();
        });
    }
}

function openSettingsModal() {
    switchVirtualTab('settings');
}

function closeSettingsModal() {
    switchVirtualTab('code');
}

function openImportModal() {
    switchVirtualTab('import');
}

function closeImportModal() {
    if (typeof previewAudioElement !== 'undefined' && previewAudioElement) {
        previewAudioElement.pause();
        previewAudioElement = null;
    }
    switchVirtualTab('code');
}

// ==========================================
// 1.5 検索・置換バー ＆ 同一文字列ハイライト機能
// ==========================================

function toggleReplaceBar(editorId) {
    const bar = document.getElementById(editorId + '-replace-bar');
    if (!bar) return;
    const isHidden = bar.classList.contains('hidden');
    if (isHidden) {
        openReplaceBar(editorId);
    } else {
        closeReplaceBar(editorId);
    }
}

function openReplaceBar(editorId) {
    const bar = document.getElementById(editorId + '-replace-bar');
    const findInput = document.getElementById(editorId + '-find-input');
    const textarea = document.getElementById(editorId);
    if (!bar || !findInput || !textarea) return;

    bar.classList.remove('hidden');

    if (textarea.selectionStart !== textarea.selectionEnd) {
        const sel = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
        if (sel.indexOf('\n') === -1 && sel.length > 0) {
            findInput.value = sel;
        }
    }

    onFindInputChanged(editorId);
    findInput.focus();
    findInput.select();
}

function closeReplaceBar(editorId) {
    const bar = document.getElementById(editorId + '-replace-bar');
    if (bar) bar.classList.add('hidden');
    if (editorUpdateCallbacks[editorId]) editorUpdateCallbacks[editorId]();
    const textarea = document.getElementById(editorId);
    if (textarea) textarea.focus();
}

function countOccurrencesInText(text, target) {
    if (!target || target.length === 0) return 0;
    let count = 0;
    let pos = 0;
    while (pos <= text.length - target.length) {
        const idx = text.indexOf(target, pos);
        if (idx === -1) break;
        count++;
        pos = idx + target.length;
    }
    return count;
}

function onFindInputChanged(editorId) {
    const textarea = document.getElementById(editorId);
    const findInput = document.getElementById(editorId + '-find-input');
    const countBadge = document.getElementById(editorId + '-find-count');
    if (!textarea || !findInput) return;

    const needle = findInput.value;
    const count = countOccurrencesInText(textarea.value, needle);
    if (countBadge) {
        countBadge.textContent = count + '件';
    }
    if (editorUpdateCallbacks[editorId]) {
        editorUpdateCallbacks[editorId]();
    }
}

function findNextMatch(editorId) {
    const textarea = document.getElementById(editorId);
    const findInput = document.getElementById(editorId + '-find-input');
    if (!textarea || !findInput) return;

    const needle = findInput.value;
    if (!needle) return;

    const text = textarea.value;
    const searchFrom = textarea.selectionEnd;
    let idx = text.indexOf(needle, searchFrom);
    if (idx === -1) {
        idx = text.indexOf(needle, 0);
    }
    if (idx === -1) return;

    textarea.focus();
    textarea.selectionStart = idx;
    textarea.selectionEnd = idx + needle.length;
    if (editorUpdateCallbacks[editorId]) editorUpdateCallbacks[editorId]();
    scrollCaretIntoView(textarea);
}

function replaceSingleMatch(editorId) {
    const textarea = document.getElementById(editorId);
    const findInput = document.getElementById(editorId + '-find-input');
    const replaceInput = document.getElementById(editorId + '-replace-input');
    if (!textarea || !findInput || !replaceInput) return;

    const needle = findInput.value;
    if (!needle) return;
    const replacement = replaceInput.value;
    const text = textarea.value;

    let targetStart = -1;
    if (textarea.selectionStart !== textarea.selectionEnd &&
        text.slice(textarea.selectionStart, textarea.selectionEnd) === needle) {
        targetStart = textarea.selectionStart;
    } else {
        targetStart = text.indexOf(needle, textarea.selectionEnd);
        if (targetStart === -1) {
            targetStart = text.indexOf(needle, 0);
        }
    }

    if (targetStart === -1) return;

    textarea.value = text.slice(0, targetStart) + replacement + text.slice(targetStart + needle.length);
    const afterReplacePos = targetStart + replacement.length;

    const nextIdx = textarea.value.indexOf(needle, afterReplacePos);
    textarea.focus();
    if (nextIdx !== -1) {
        textarea.selectionStart = nextIdx;
        textarea.selectionEnd = nextIdx + needle.length;
    } else {
        textarea.selectionStart = textarea.selectionEnd = afterReplacePos;
    }

    onFindInputChanged(editorId);
    if (editorId === 'func-code') syncMainFunctions();
    if (editorId === 'code' && typeof syncPopupCode === 'function') syncPopupCode();
    scrollCaretIntoView(textarea);
}

function replaceAllMatches(editorId) {
    const textarea = document.getElementById(editorId);
    const findInput = document.getElementById(editorId + '-find-input');
    const replaceInput = document.getElementById(editorId + '-replace-input');
    if (!textarea || !findInput || !replaceInput) return;

    const needle = findInput.value;
    if (!needle) return;
    const replacement = replaceInput.value;
    const text = textarea.value;

    if (text.indexOf(needle) === -1) return;

    textarea.value = text.split(needle).join(replacement);
    onFindInputChanged(editorId);
    if (editorId === 'func-code') syncMainFunctions();
    if (editorId === 'code' && typeof syncPopupCode === 'function') syncPopupCode();
    scrollCaretIntoView(textarea);
}

function handleReplaceBarKeyDown(e, editorId, mode) {
    if (e.isComposing) return;
    if (e.key === 'Enter') {
        e.preventDefault();
        if (mode === 'find') {
            findNextMatch(editorId);
        } else {
            replaceSingleMatch(editorId);
        }
    } else if (e.key === 'Escape') {
        e.preventDefault();
        closeReplaceBar(editorId);
    }
}

function buildSelectionMatchHighlightHtml(text, targetStr) {
    if (!targetStr || targetStr.length === 0 || targetStr.indexOf('\n') !== -1) {
        return '';
    }
    let result = '';
    let pos = 0;
    const tLen = targetStr.length;

    while (pos < text.length) {
        const idx = text.indexOf(targetStr, pos);
        if (idx === -1) {
            result += escapeHtml(text.slice(pos));
            break;
        }
        result += escapeHtml(text.slice(pos, idx));
        result += '<span class="selection-match-highlight">' + escapeHtml(text.slice(idx, idx + tLen)) + '</span>';
        pos = idx + tLen;
    }
    if (text.endsWith('\n')) result += ' ';
    return result;
}

function getActiveHighlightQueryForEditor(textarea) {
    if (!textarea) return '';
    if (textarea.selectionStart !== textarea.selectionEnd) {
        const sel = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
        if (sel.indexOf('\n') === -1 && cleanText(sel) !== '') {
            return sel;
        }
    }
    const bar = document.getElementById(textarea.id + '-replace-bar');
    const findInput = document.getElementById(textarea.id + '-find-input');
    if (bar && !bar.classList.contains('hidden') && findInput && findInput.value !== '') {
        return findInput.value;
    }
    return '';
}

// ==========================================
// 2. 予測変換（サジェスト機能）エンジン
// ==========================================

const suggestState = {
    activeEditor: null,
    isCycling: false,
    isTabHeld: false,
    replaceStart: 0,
    replaceEnd: 0,
    originalPrefix: '',
    candidates: [],
    selectedIndex: -1
};

function getTargetSuggestBar() {
    if (suggestState.activeEditor && suggestState.activeEditor.id === 'func-code') {
        const funcBar = document.getElementById('func-suggest-bar');
        if (funcBar) return funcBar;
    }
    return document.getElementById('suggest-bar');
}

function resetSuggestCycle() {
    suggestState.isCycling = false;
    suggestState.selectedIndex = -1;
}

function isKnownDictNameSafe(name) {
    const key = stripDictSuffix(name);
    return Object.prototype.hasOwnProperty.call(state.dicts, key);
}

function extractSymbolsFromStatement(stmtRaw, varMap, funcSet) {
    const stmt = cleanText(stmtRaw);
    if (!stmt) return;

    if (stmt.length > 4 && stmt.slice(0, 3).toLowerCase() === 'fun' && isSpaceChar(stmt[3])) {
        const parsedFun = parseFunHeader(stmt.slice(4));
        if (!parsedFun.error) {
            funcSet.add(parsedFun.funcNameLower);
            parsedFun.params.forEach(function(p) { varMap.set(p, p); });
            if (parsedFun.inlineCode) {
                extractSymbolsFromStatement(parsedFun.inlineCode, varMap, funcSet);
            }
        }
        return;
    }

    const cmdLen = readCommandWordLength(stmt);
    if (cmdLen > 0) {
        const rawCmd = stmt.slice(0, cmdLen).toLowerCase();
        const normCmd = normalizeCommandName(rawCmd);
        const restAfterCmd = cleanText(stmt.slice(cmdLen));

        if (rawCmd === 'for') {
            const paren = extractParenHead(restAfterCmd);
            if (paren) {
                const parts = splitTopLevelComma(paren.inside);
                if (parts.length === 2 && isValidVarIdentifier(parts[0])) {
                    const vName = cleanText(parts[0]);
                    varMap.set(vName.toLowerCase(), vName);
                }
                if (paren.after) {
                    extractSymbolsFromStatement(paren.after, varMap, funcSet);
                }
                return;
            }
        }

        if (rawCmd === 'if' || rawCmd === 'elseif' || rawCmd === 'while') {
            const paren = extractParenHead(restAfterCmd);
            if (paren && paren.after) {
                extractSymbolsFromStatement(paren.after, varMap, funcSet);
                return;
            }
        }

        if (rawCmd === 'else' && restAfterCmd !== '' && matchAssignmentOp(restAfterCmd) === null) {
            extractSymbolsFromStatement(restAfterCmd, varMap, funcSet);
            return;
        }

        if (normCmd === 'in' && matchAssignmentOp(restAfterCmd) === null && !restAfterCmd.startsWith('[')) {
            const parsedIn = parseCommandOptionAndTarget(restAfterCmd);
            const inTargets = splitInTargetList(parsedIn.targetStr);
            for (let tIdx = 0; tIdx < inTargets.length; tIdx++) {
                const spec = parseArrayTargetSpec(inTargets[tIdx]);
                if (spec.hasExplicitBrackets && isValidVarIdentifier(spec.name)) {
                    varMap.set(spec.name.toLowerCase() + '[]', spec.name + '[]');
                } else if (isValidVarIdentifier(inTargets[tIdx])) {
                    const vName = cleanText(inTargets[tIdx]);
                    varMap.set(vName.toLowerCase(), vName);
                }
            }
            return;
        }

        if ((normCmd === 'charin' || normCmd === 'allin') && matchAssignmentOp(restAfterCmd) === null && !restAfterCmd.startsWith('[')) {
            const parsedChar = parseCommandOptionAndTarget(restAfterCmd);
            const vName = cleanText(parsedChar.targetStr);
            if (isValidVarIdentifier(vName)) {
                varMap.set(vName.toLowerCase(), vName);
            }
            return;
        }
    }

    if (isVarStartChar(stmt[0])) {
        let i = 1;
        while (i < stmt.length && isIdentPartChar(stmt[i])) i++;
        const ident = stmt.slice(0, i);
        const lowerIdent = ident.toLowerCase();
        if (!COMMAND_KEYWORDS.has(lowerIdent)) {
            const rest = cleanText(stmt.slice(i));
            if (rest.startsWith('[]') || (rest.startsWith('[') && !isKnownDictNameSafe(ident))) {
                varMap.set(lowerIdent + '[]', ident + '[]');
            } else if (rest.startsWith('{}')) {
                varMap.set(lowerIdent + '{}', ident + '{}');
            } else if (matchAssignmentOp(rest) !== null) {
                varMap.set(lowerIdent, ident);
            }
        }
    }
}

function collectCodeSymbols() {
    const varMap = new Map();
    const funcSet = new Set();

    try {
        varMap.set('true', 'true');
        varMap.set('false', 'false');
        Object.keys(state.vars).forEach(function(k) { varMap.set(k.toLowerCase(), k); });
        Object.keys(state.arrays).forEach(function(k) { varMap.set(k.toLowerCase() + '[]', k + '[]'); });
        Object.keys(state.dicts).forEach(function(k) { varMap.set(k.toLowerCase() + '{}', k + '{}'); });
        Object.keys(state.functions).forEach(function(k) { funcSet.add(k.toLowerCase()); });

        const editorIds = ['func-code', 'code', 'sub-code1', 'sub-code2'];
        for (let eIdx = 0; eIdx < editorIds.length; eIdx++) {
            const el = document.getElementById(editorIds[eIdx]);
            if (!el) continue;
            const lines = String(el.value).split('\n');
            for (let lIdx = 0; lIdx < lines.length; lIdx++) {
                const stmts = splitStatementsByColon(lines[lIdx]);
                for (let sIdx = 0; sIdx < stmts.length; sIdx++) {
                    extractSymbolsFromStatement(stmts[sIdx], varMap, funcSet);
                }
            }
        }
    } catch (e) {
    }

    return { varMap: varMap, funcSet: funcSet };
}

function analyzeCursorSuggestContext(text, cursorPos) {
    const safePos = Math.max(0, Math.min(text.length, cursorPos));
    const lineStart = (safePos === 0) ? 0 : (text.lastIndexOf('\n', safePos - 1) + 1);
    const lineBeforeCursor = text.slice(lineStart, safePos);

    if (cleanText(lineBeforeCursor) === '') {
        return { hasTextBeforeCursor: false };
    }

    let quoteChar = null;
    let lastColonOutsideParens = -1;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;

    for (let i = 0; i < lineBeforeCursor.length; i++) {
        const ch = lineBeforeCursor[i];
        if (ch === '"' || ch === "'") {
            if (quoteChar === null) quoteChar = ch;
            else if (quoteChar === ch) quoteChar = null;
            continue;
        }
        if (quoteChar === null) {
            if (ch === '/' && isSlashStringStartInLine(lineBeforeCursor, i)) {
                if (lineBeforeCursor[i + 1] !== '=' && lineBeforeCursor[i + 1] !== '.') {
                    const slashEnd = findSlashStringEnd(lineBeforeCursor, i);
                    if (slashEnd >= lineBeforeCursor.length) {
                        return { hasTextBeforeCursor: true, inStringOrComment: true };
                    }
                    i = slashEnd - 1;
                    continue;
                }
            }
            if (ch === '#') {
                return { hasTextBeforeCursor: true, inStringOrComment: true };
            }
            if (ch === '(') parenDepth++;
            else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
            else if (ch === '[') bracketDepth++;
            else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);
            else if (ch === '{') braceDepth++;
            else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
            else if (ch === ':' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
                if (!isRunCommandAwaitingRangeColon(lineBeforeCursor.slice(0, i))) {
                    lastColonOutsideParens = i;
                }
            }
        }
    }

    if (quoteChar !== null) {
        return { hasTextBeforeCursor: true, inStringOrComment: true };
    }

    let wordStartInLine = lineBeforeCursor.length;
    if (wordStartInLine > 0 && lineBeforeCursor[wordStartInLine - 1] === '.') {
        wordStartInLine--;
    }
    while (wordStartInLine > 0) {
        const prevCh = lineBeforeCursor[wordStartInLine - 1];
        if (isVarStartChar(prevCh) || isIdentPartChar(prevCh) || isDigitChar(prevCh)) {
            wordStartInLine--;
        } else {
            break;
        }
    }
    const prefix = lineBeforeCursor.slice(wordStartInLine);

    if (prefix === '' || isDigitChar(prefix[0]) || prefix === '.') {
        return { hasTextBeforeCursor: true, inStringOrComment: true };
    }

    const stmtStartInLine = (lastColonOutsideParens !== -1) ? (lastColonOutsideParens + 1) : 0;
    const beforeWordInStmt = cleanText(lineBeforeCursor.slice(stmtStartInLine, wordStartInLine));

    let contextType = 'arg';
    if (beforeWordInStmt === '' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        contextType = 'cmd';
    } else {
        const ctrlCheck = classifyControlLine(lineBeforeCursor.slice(stmtStartInLine, wordStartInLine));
        if ((ctrlCheck.kind === 'if_multi' || ctrlCheck.kind === 'for_multi' || ctrlCheck.kind === 'while_multi' || ctrlCheck.kind === 'elseif' || ctrlCheck.kind === 'else') && ctrlCheck.inlineCode === '') {
            contextType = 'cmd';
        }
    }

    return {
        hasTextBeforeCursor: true,
        inStringOrComment: false,
        contextType: contextType,
        prefix: prefix,
        replaceStart: lineStart + wordStartInLine,
        replaceEnd: safePos
    };
}

function buildSuggestionsList(prefix, contextType) {
    const pLower = String(prefix || '').toLowerCase();
    if (pLower === '') return [];

    const rawItems = [];
    const symbols = collectCodeSymbols();

    if (contextType === 'cmd') {
        COMMAND_KEYWORDS.forEach(function(cmd) {
            rawItems.push({
                key: cmd.toLowerCase(),
                display: '[c]' + cmd,
                insertText: cmd,
                isFunc: false,
                typeOrder: 1,
                colorClass: 'kind-cyan'
            });
        });

        symbols.varMap.forEach(function(origName, lowerKey) {
            if (lowerKey === 'true' || lowerKey === 'false') return;
            const pureKey = lowerKey.replace(/\[\]$/, '').replace(/\{\}$/, '');
            if (COMMAND_KEYWORDS.has(pureKey)) return;
            rawItems.push({
                key: pureKey,
                display: '[v]' + origName,
                insertText: origName,
                isFunc: false,
                typeOrder: 2,
                colorClass: 'kind-orange'
            });
        });
    } else {
        const allFuncs = new Set(BUILTIN_FUNCTION_NAMES);
        symbols.funcSet.forEach(function(fn) { allFuncs.add(fn); });

        allFuncs.forEach(function(fn) {
            rawItems.push({
                key: fn.toLowerCase(),
                display: '[f]' + fn + '()',
                insertText: fn + '()',
                isFunc: true,
                typeOrder: 1,
                colorClass: 'kind-cyan'
            });
        });

        symbols.varMap.forEach(function(origName, lowerKey) {
            const pureKey = lowerKey.replace(/\[\]$/, '').replace(/\{\}$/, '');
            rawItems.push({
                key: pureKey,
                display: '[v]' + origName,
                insertText: origName,
                isFunc: false,
                typeOrder: 2,
                colorClass: 'kind-orange'
            });
        });
    }

    const prefixMatches = [];
    const substringMatches = [];

    for (let i = 0; i < rawItems.length; i++) {
        const item = rawItems[i];
        if (item.key.indexOf(pLower) === 0) {
            prefixMatches.push(item);
        } else if (item.key.indexOf(pLower) > 0) {
            substringMatches.push(item);
        }
    }

    function sortCandidates(a, b) {
        if (a.key.length !== b.key.length) return a.key.length - b.key.length;
        if (a.typeOrder !== b.typeOrder) return a.typeOrder - b.typeOrder;
        return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0);
    }

    prefixMatches.sort(sortCandidates);
    substringMatches.sort(sortCandidates);

    return prefixMatches.concat(substringMatches);
}

function renderSuggestBar() {
    const bar = getTargetSuggestBar();
    if (!bar) return;

    const list = suggestState.candidates;
    if (!list || list.length === 0) {
        bar.innerHTML = '<span class="suggest-placeholder">予測変換: 候補なし</span>';
        return;
    }

    let html = '';
    const maxDisplay = Math.min(list.length, 30);
    for (let i = 0; i < maxDisplay; i++) {
        const item = list[i];
        const isSel = (i === suggestState.selectedIndex);
        html += '<div class="suggest-item ' + item.colorClass + (isSel ? ' selected' : '') + '" ' +
                'id="suggest-item-' + i + '" ' +
                'onmousedown="handleSuggestItemMouseDown(event, ' + i + ')">' +
                '<span class="suggest-idx">[' + (i + 1) + ']</span>' +
                '<span>' + escapeHtml(item.display) + '</span>' +
                '</div>';
    }
    bar.innerHTML = html;

    if (suggestState.selectedIndex >= 0 && suggestState.selectedIndex < maxDisplay) {
        const items = bar.querySelectorAll('.suggest-item');
        const selEl = items[suggestState.selectedIndex];
        if (selEl) {
            selEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        }
    }
}

function updateSuggestionsForEditor(textarea) {
    if (!textarea || suggestState.isCycling) return;

    suggestState.activeEditor = textarea;
    const bar = getTargetSuggestBar();
    const ctx = analyzeCursorSuggestContext(textarea.value, textarea.selectionStart);

    if (!ctx.hasTextBeforeCursor || ctx.inStringOrComment) {
        suggestState.candidates = [];
        suggestState.selectedIndex = -1;
        if (bar) {
            bar.innerHTML = '<span class="suggest-placeholder">予測変換: 文字を入力すると候補が表示されます (Tabで選択 / Tab+数字で直接指定)</span>';
        }
        return;
    }

    const candidates = buildSuggestionsList(ctx.prefix, ctx.contextType);
    suggestState.replaceStart = ctx.replaceStart;
    suggestState.replaceEnd = ctx.replaceEnd;
    suggestState.originalPrefix = ctx.prefix;
    suggestState.candidates = candidates;
    suggestState.selectedIndex = -1;
    renderSuggestBar();
}

function applySuggestionByIndex(textarea, index, updateEditorCallback) {
    const list = suggestState.candidates;
    if (!list || index < 0 || index >= list.length) return false;

    const item = list[index];
    const val = textarea.value;
    const start = suggestState.replaceStart;
    const end = suggestState.replaceEnd;

    let insertStr = item.insertText;
    const afterText = val.slice(end);

    let placeCursorInsideParen = false;
    if (item.isFunc) {
        if (afterText.startsWith('(')) {
            insertStr = insertStr.slice(0, -2);
        } else {
            placeCursorInsideParen = true;
        }
    }

    const editorBody = textarea.parentElement;
    const savedScrollTop = editorBody ? editorBody.scrollTop : 0;
    const savedScrollLeft = editorBody ? editorBody.scrollLeft : 0;

    textarea.value = val.slice(0, start) + insertStr + afterText;
    const newEnd = start + insertStr.length;

    if (placeCursorInsideParen) {
        textarea.selectionStart = textarea.selectionEnd = newEnd - 1;
    } else {
        textarea.selectionStart = textarea.selectionEnd = newEnd;
    }

    suggestState.replaceEnd = newEnd;
    suggestState.selectedIndex = index;
    suggestState.isCycling = true;

    if (typeof updateEditorCallback === 'function') {
        updateEditorCallback();
    }
    if (editorBody) {
        editorBody.scrollTop = savedScrollTop;
        editorBody.scrollLeft = savedScrollLeft;
    }
    if (textarea.id === 'code' && typeof syncPopupCode === 'function') {
        syncPopupCode();
    }
    scrollCaretIntoView(textarea);
    renderSuggestBar();
    return true;
}

function handleSuggestItemMouseDown(e, index) {
    e.preventDefault();
    const textarea = suggestState.activeEditor || document.getElementById('code');
    if (!textarea) return;
    textarea.focus();
    applySuggestionByIndex(textarea, index, editorUpdateCallbacks[textarea.id]);
}

// ==========================================
// 3. シンタックスハイライト・サイズ同期・オートスクロール制御
// ==========================================

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

            if (ch === '"' || ch === "'") {
                const q = ch;
                let end = i + 1;
                while (end < line.length && line[end] !== q) end++;
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

            if (ch === '#') {
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

function syncEditorDimensions(textarea, highlightDiv, matchDiv, gutter, allowScrollBeyondLastLine) {
    const editorBody = textarea.parentElement;
    if (!editorBody) return;

    const computed = window.getComputedStyle(textarea);
    const lineHeight = parseFloat(computed.lineHeight) || 27;
    const padTop = parseFloat(computed.paddingTop) || 15;
    const padBottom = parseFloat(computed.paddingBottom) || 15;

    const lineCount = textarea.value.split('\n').length;
    const viewHeight = editorBody.clientHeight || 300;

    const extraBottom = allowScrollBeyondLastLine ? Math.max(0, viewHeight - lineHeight - padTop) : 0;
    const totalHeight = Math.max(viewHeight, Math.ceil(lineCount * lineHeight + padTop + padBottom + extraBottom));

    highlightDiv.style.width = 'auto';
    const contentWidth = Math.max(editorBody.clientWidth || 0, highlightDiv.scrollWidth);

    textarea.style.height = totalHeight + 'px';
    highlightDiv.style.height = totalHeight + 'px';
    if (matchDiv) matchDiv.style.height = totalHeight + 'px';

    textarea.style.width = contentWidth + 'px';
    highlightDiv.style.width = contentWidth + 'px';
    if (matchDiv) matchDiv.style.width = contentWidth + 'px';

    if (gutter) {
        gutter.style.paddingBottom = (padBottom + extraBottom) + 'px';
        gutter.scrollTop = editorBody.scrollTop;
    }
}

function scrollCaretIntoView(textarea) {
    const editorBody = textarea.parentElement;
    if (!editorBody) return;

    const computed = window.getComputedStyle(textarea);
    const lineHeight = parseFloat(computed.lineHeight) || 27;
    const padTop = parseFloat(computed.paddingTop) || 15;

    const pos = textarea.selectionEnd;
    const textBefore = textarea.value.slice(0, pos);
    const linesBefore = textBefore.split('\n');
    const lineIdx = linesBefore.length - 1;

    const caretTop = padTop + lineIdx * lineHeight;
    const caretBottom = caretTop + lineHeight;

    const viewTop = editorBody.scrollTop;
    const viewHeight = editorBody.clientHeight;
    const viewBottom = viewTop + viewHeight;

    if (caretTop < viewTop + padTop) {
        editorBody.scrollTop = Math.max(0, caretTop - padTop);
    } else if (caretBottom > viewBottom - padTop) {
        editorBody.scrollTop = Math.max(0, caretBottom - viewHeight + padTop);
    }

    const gutter = (textarea.id === 'code')
        ? document.getElementById('line-numbers')
        : (textarea.id === 'func-code' ? document.getElementById('func-line-numbers') : null);
    if (gutter) {
        gutter.scrollTop = editorBody.scrollTop;
    }
}

function updateLineNumbers() {
    const textarea = document.getElementById('code');
    const gutter = document.getElementById('line-numbers');
    if (!textarea || !gutter) return;
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

function updateFuncLineNumbers() {
    const textarea = document.getElementById('func-code');
    const gutter = document.getElementById('func-line-numbers');
    if (!textarea || !gutter) return;
    const lineCount = textarea.value.split('\n').length;
    let html = '';
    for (let i = 1; i <= lineCount; i++) {
        html += '<div class="line-num">' + i + '</div>';
    }
    gutter.innerHTML = html;
}

function updateFuncCodeStats() {
    const textarea = document.getElementById('func-code');
    const stats = document.getElementById('func-code-stats');
    if (textarea && stats) {
        const lines = textarea.value.split('\n').length;
        stats.innerText = 'Lines: ' + lines + ' | Length: ' + textarea.value.length + ' | Pos: ' + textarea.selectionStart;
    }
}

function shouldAddExtraBlockIndent(lineBeforeCursor, lineAfterCursor) {
    const afterUncommented = cleanText(stripLineComment(lineAfterCursor));
    if (afterUncommented !== '') return false;

    const info = classifyControlLine(lineBeforeCursor);
    if (info.kind === 'if_multi' || info.kind === 'for_multi' || info.kind === 'while_multi' || info.kind === 'fun_multi') {
        return true;
    }
    if ((info.kind === 'elseif' || info.kind === 'else') && (!info.inlineCode || info.inlineCode === '')) {
        return true;
    }
    return false;
}

function setupEditor(id, isMain = false, isFuncEditor = false) {
    const textarea = document.getElementById(id);
    const highlightDiv = document.getElementById(id + '-highlight');
    const matchDiv = document.getElementById(id + '-match-highlight');
    const gutter = isMain ? document.getElementById('line-numbers') : (isFuncEditor ? document.getElementById('func-line-numbers') : null);
    const editorBody = textarea ? textarea.parentElement : null;
    const allowScrollBeyond = (isMain || isFuncEditor);

    if (!textarea || !highlightDiv || !editorBody) return;

    const update = function() {
        highlightDiv.innerHTML = highlightCasic(textarea.value, textarea.selectionStart);
        if (matchDiv) {
            const query = getActiveHighlightQueryForEditor(textarea);
            matchDiv.innerHTML = buildSelectionMatchHighlightHtml(textarea.value, query);
        }
        if (isMain) {
            updateLineNumbers();
            updateCodeStats();
        } else if (isFuncEditor) {
            updateFuncLineNumbers();
            updateFuncCodeStats();
        }
        syncEditorDimensions(textarea, highlightDiv, matchDiv, gutter, allowScrollBeyond);
    };

    editorUpdateCallbacks[id] = update;

    function applyValueEditAndScroll(mutateFn) {
        const savedTop = editorBody.scrollTop;
        const savedLeft = editorBody.scrollLeft;
        mutateFn();
        update();
        editorBody.scrollTop = savedTop;
        editorBody.scrollLeft = savedLeft;
        if (isMain && typeof syncPopupCode === 'function') {
            syncPopupCode();
        }
        scrollCaretIntoView(textarea);
    }

    textarea.addEventListener('input', function() {
        resetSuggestCycle();
        if (isFuncEditor) {
            syncMainFunctions();
        }
        update();
        if (isMain && typeof syncPopupCode === 'function') {
            syncPopupCode();
        }
        scrollCaretIntoView(textarea);
        updateSuggestionsForEditor(textarea);
    });

    textarea.addEventListener('click', function() {
        resetSuggestCycle();
        update();
        updateSuggestionsForEditor(textarea);
    });

    textarea.addEventListener('mouseup', function() {
        update();
    });

    textarea.addEventListener('select', function() {
        update();
    });

    textarea.addEventListener('focus', function() {
        suggestState.activeEditor = textarea;
        update();
        updateSuggestionsForEditor(textarea);
    });

    textarea.addEventListener('keyup', function(e) {
        if (e.key === 'Tab') {
            suggestState.isTabHeld = false;
            return;
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Home' || e.key === 'End' || e.key === 'Shift') {
            resetSuggestCycle();
            update();
            updateSuggestionsForEditor(textarea);
        }
    });

    textarea.addEventListener('blur', function() {
        suggestState.isTabHeld = false;
        resetSuggestCycle();
        update();
    });

    editorBody.addEventListener('scroll', function() {
        if (gutter) gutter.scrollTop = editorBody.scrollTop;
    });

    textarea.addEventListener('keydown', function(e) {
        if (e.isComposing) return;

        if (e.key === 'Escape' && isMain) {
            const codeCol = document.getElementById('code-column');
            if (codeCol && codeCol.classList.contains('code-fullscreen')) {
                e.preventDefault();
                toggleCodeFullscreen();
                return;
            }
        }

        if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'f' || e.key.toLowerCase() === 'h')) {
            if (isMain || isFuncEditor) {
                e.preventDefault();
                openReplaceBar(id);
                return;
            }
        }

        if (suggestState.isTabHeld && e.key >= '1' && e.key <= '9') {
            e.preventDefault();
            const numIdx = parseInt(e.key, 10) - 1;
            if (!suggestState.isCycling) {
                updateSuggestionsForEditor(this);
            }
            if (suggestState.candidates.length > numIdx) {
                applySuggestionByIndex(this, numIdx, update);
            }
            return;
        }

        if (e.key === 'Tab') {
            e.preventDefault();
            suggestState.isTabHeld = true;

            if (suggestState.isCycling && suggestState.activeEditor === this && suggestState.candidates.length > 0) {
                if (e.repeat) return;
                const nextIdx = (suggestState.selectedIndex + 1) % suggestState.candidates.length;
                applySuggestionByIndex(this, nextIdx, update);
                return;
            }

            const ctx = analyzeCursorSuggestContext(this.value, this.selectionStart);

            if (!ctx.hasTextBeforeCursor) {
                const spacesCount = Math.max(1, Math.min(16, Number(editorSettings.tabSpaces) || 4));
                const indentSpaces = ' '.repeat(spacesCount);
                const self = this;
                applyValueEditAndScroll(function() {
                    const start = self.selectionStart;
                    const end = self.selectionEnd;
                    const val = self.value;
                    self.value = val.substring(0, start) + indentSpaces + val.substring(end);
                    self.selectionStart = self.selectionEnd = start + indentSpaces.length;
                });
                return;
            }

            if (e.repeat) return;
            updateSuggestionsForEditor(this);
            if (suggestState.candidates.length > 0) {
                applySuggestionByIndex(this, 0, update);
            }
            return;
        }

        resetSuggestCycle();

        if (e.key === 'Enter' && editorSettings.autoIndent) {
            e.preventDefault();
            const self = this;
            applyValueEditAndScroll(function() {
                const start = self.selectionStart;
                const end = self.selectionEnd;
                const val = self.value;

                const lineStart = (start === 0) ? 0 : (val.lastIndexOf('\n', start - 1) + 1);
                const nextNewlineIdx = val.indexOf('\n', end);
                const lineEnd = (nextNewlineIdx === -1) ? val.length : nextNewlineIdx;

                let currentIndent = '';
                for (let i = lineStart; i < start; i++) {
                    const ch = val[i];
                    if (ch === ' ' || ch === '\t' || ch === CHAR_FW_SP) {
                        currentIndent += ch;
                    } else {
                        break;
                    }
                }

                const lineBeforeCursor = val.slice(lineStart, start);
                const lineAfterCursor = val.slice(end, lineEnd);
                let extraIndent = '';

                if (shouldAddExtraBlockIndent(lineBeforeCursor, lineAfterCursor)) {
                    const spacesCount = Math.max(1, Math.min(16, Number(editorSettings.tabSpaces) || 4));
                    extraIndent = ' '.repeat(spacesCount);
                }

                const insertText = '\n' + currentIndent + extraIndent;
                self.value = val.substring(0, start) + insertText + val.substring(end);
                self.selectionStart = self.selectionEnd = start + insertText.length;
            });
            updateSuggestionsForEditor(this);
            return;
        }

        if (e.key === '(' && editorSettings.autoCloseParen) {
            e.preventDefault();
            const self = this;
            applyValueEditAndScroll(function() {
                const start = self.selectionStart;
                const end = self.selectionEnd;
                const val = self.value;
                const selected = val.substring(start, end);
                self.value = val.substring(0, start) + '(' + selected + ')' + val.substring(end);
                self.selectionStart = start + 1;
                self.selectionEnd = end + 1;
            });
            updateSuggestionsForEditor(this);
            return;
        }

        if (e.key === '[' && editorSettings.autoCloseBracket) {
            e.preventDefault();
            const self = this;
            applyValueEditAndScroll(function() {
                const start = self.selectionStart;
                const end = self.selectionEnd;
                const val = self.value;
                const selected = val.substring(start, end);
                self.value = val.substring(0, start) + '[' + selected + ']' + val.substring(end);
                self.selectionStart = start + 1;
                self.selectionEnd = end + 1;
            });
            updateSuggestionsForEditor(this);
            return;
        }

        if ((e.key === '"' || e.key === "'") && editorSettings.autoCloseQuote) {
            e.preventDefault();
            const q = e.key;
            const self = this;
            applyValueEditAndScroll(function() {
                const start = self.selectionStart;
                const end = self.selectionEnd;
                const val = self.value;
                const selected = val.substring(start, end);
                self.value = val.substring(0, start) + q + selected + q + val.substring(end);
                self.selectionStart = start + 1;
                self.selectionEnd = end + 1;
            });
            updateSuggestionsForEditor(this);
            return;
        }
    });

    update();
}

window.addEventListener('resize', function() {
    Object.keys(editorUpdateCallbacks).forEach(function(id) {
        editorUpdateCallbacks[id]();
    });
});

document.addEventListener('selectionchange', function() {
    const active = document.activeElement;
    if (active && active.tagName === 'TEXTAREA' && editorUpdateCallbacks[active.id]) {
        const matchDiv = document.getElementById(active.id + '-match-highlight');
        if (matchDiv) {
            const query = getActiveHighlightQueryForEditor(active);
            matchDiv.innerHTML = buildSelectionMatchHighlightHtml(active.value, query);
        }
    }
});

// ==========================================
// 4. メモリ描画・コマンドラインログ・実行ボタン制御
// ==========================================

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
    if (memDiv) memDiv.innerHTML = html;
    syncPopupMemory();
}

function appendCmdlineMessages(errors, warnings, echoCmd = null) {
    const logDiv = document.getElementById('cmdline-log');
    if (!logDiv) return;

    if (echoCmd !== null && cleanText(echoCmd) !== '') {
        const echoEl = document.createElement('div');
        echoEl.className = 'cmd-echo-text';
        echoEl.textContent = '> ' + echoCmd.split('\n').join(' : ');
        logDiv.appendChild(echoEl);
    }

    if (warnings && warnings.length > 0) {
        for (const w of warnings) {
            const warnDiv = document.createElement('div');
            warnDiv.className = w.indexOf('stop命令により') !== -1 ? 'info-text' : 'warn-text';
            warnDiv.textContent = w;
            logDiv.appendChild(warnDiv);
        }
    }

    if (errors && errors.length > 0) {
        for (const err of errors) {
            const errDiv = document.createElement('div');
            errDiv.className = 'error-text';
            errDiv.textContent = err;
            logDiv.appendChild(errDiv);
        }
    }

    logDiv.scrollTop = logDiv.scrollHeight;
    syncPopupCmdline();
}

function clearCmdlineLog() {
    const logDiv = document.getElementById('cmdline-log');
    if (logDiv) logDiv.innerHTML = '';
    syncPopupCmdline();
}

function renderMainOutputBox() {
    const outDiv = document.getElementById('output');
    if (!outDiv) return;
    const buf = state.outputBuffer || '';
    if (buf.length > MAIN_OUTPUT_DISPLAY_LIMIT) {
        outDiv.textContent = buf.slice(-5000);
    } else {
        outDiv.textContent = buf;
    }
    outDiv.scrollTop = outDiv.scrollHeight;
}

function appendOutputAndErrors(output, errors, isReplace = false, currentLineDisplay = '-', warnings = [], echoCmd = null) {
    if (typeof state.outputBuffer !== 'string' || isReplace) {
        state.outputBuffer = '';
        state.outputTruncateWarned = false;
        if (typeof outputPagination !== 'undefined') {
            outputPagination.currentPage = 1;
        }
    }

    if (output) {
        state.outputBuffer += output;
    }

    renderMainOutputBox();

    const mergedWarnings = Array.isArray(warnings) ? warnings.slice() : [];
    const bufLen = (state.outputBuffer || '').length;
    if (bufLen > MAIN_OUTPUT_DISPLAY_LIMIT && !state.outputTruncateWarned) {
        state.outputTruncateWarned = true;
        mergedWarnings.push(
            '※出力が長いためメイン画面では末尾5,000文字のみ表示しています（全' +
            bufLen.toLocaleString() +
            '文字の確認・コピーは出力の「別窓」を開いてください）'
        );
    }

    appendCmdlineMessages(errors, mergedWarnings, echoCmd);

    const nextLineLabel = (state.pc >= 0 && state.pc < getMainCodeLinesArray().length) ? (state.pc + 1) : '-';
    const statsEl = document.getElementById('exec-stats');
    if (statsEl) {
        statsEl.innerText = 'Next: ' + nextLineLabel + ' | InPtr: ' + state.inputPtr + ' | Steps: ' + state.totalSteps;
    }
    renderMemoryUI();
    updateLineNumbers();
    syncPopupOutput();
}

function syncMainFunctions() {
    state.functions = {};
    let allErrors = [];

    const funcEl = document.getElementById('func-code');
    if (funcEl) {
        const funcNormalized = String(funcEl.value).split('\r\n').join('\n');
        const funcLines = funcNormalized.split('\n');
        const funcCf = buildControlFlowStructure(funcLines, 1, true);

        for (let i = 0; i < funcCf.errors.length; i++) {
            allErrors.push('[関数タブ] ' + funcCf.errors[i]);
        }

        for (let idx = 0; idx < funcLines.length; idx++) {
            const uncommented = cleanText(stripLineComment(funcLines[idx]));
            if (uncommented === '') continue;

            const info = funcCf.lineInfos[idx] || { kind: 'normal' };
            const enclosing = funcCf.enclosingByLine[idx] || [];
            const isInsideFunBlock = enclosing.some(function(b) { return b.type === 'fun'; });

            if (info.kind === 'fun_single' || info.kind === 'fun_multi') {
                continue;
            }
            if (info.kind === 'end' && info.block && info.block.type === 'fun') {
                continue;
            }
            if (!isInsideFunBlock) {
                allErrors.push('[関数タブ Line ' + (idx + 1) + '] 関数画面ではユーザー定義関数 (fun) の定義のみ可能です: ' + uncommented);
            }
        }
    }

    const codeEl = document.getElementById('code');
    if (codeEl) {
        const normalized = String(codeEl.value).split('\r\n').join('\n');
        const lines = normalized.split('\n');
        const cf = buildControlFlowStructure(lines, 1, true);
        allErrors = allErrors.concat(cf.errors);
    }

    return allErrors;
}

// 実行を非同期関数（async function）でラップする
async function runMainAsync() {
    if (isExecutionRunning) {
        abortCurrentExecution();
        return;
    }
    isExecutionRunning = true;
    setExecutionUIMode(true);

    try {
        resetEngine();
        state.isStepMode = false;
        const funcErrs = syncMainFunctions();
        const code = document.getElementById('code').value;
        const res = await executeCasicCodeAsync(code, 1, false);
        appendOutputAndErrors(res.output, funcErrs.concat(res.errors), true, 'All', res.warnings);
    } catch (e) {
        appendCmdlineMessages(['実行エラー: ' + e.message], []);
    } finally {
        isExecutionRunning = false;
        setExecutionUIMode(false);
    }
}

async function stepMainAsync() {
    if (isExecutionRunning) {
        abortCurrentExecution();
        return;
    }
    isExecutionRunning = true;
    setExecutionUIMode(true);

    try {
        const funcErrs = syncMainFunctions();
        const lines = getMainCodeLinesArray();
        if (state.pc >= lines.length || state.pc < 0) {
            state.pc = 0;
            state.stepEvaluateBranch = false;
        }
        const lineIdx = state.pc;
        state.warnings = [];
        state.isStepMode = true;
        const res = await runMainCodeSessionAsync({
            endLineIdx: lines.length - 1,
            maxSteps: 1
        });
        appendOutputAndErrors(res.output, funcErrs.concat(res.errors), false, lineIdx + 1, state.warnings);
    } catch (e) {
        appendCmdlineMessages(['ステップ実行エラー: ' + e.message], []);
    } finally {
        isExecutionRunning = false;
        setExecutionUIMode(false);
    }
}

async function runClickedLineAsync(lineIdx) {
    if (isExecutionRunning) {
        abortCurrentExecution();
        return;
    }
    isExecutionRunning = true;
    setExecutionUIMode(true);

    try {
        const funcErrs = syncMainFunctions();
        const lines = getMainCodeLinesArray();
        if (lineIdx < 0 || lineIdx >= lines.length) {
            isExecutionRunning = false;
            setExecutionUIMode(false);
            return;
        }
        state.pc = lineIdx;
        state.warnings = [];
        const labelScan = buildLabelMap(lines, 1);
        const cfStructure = buildControlFlowStructure(lines, 1, true);
        const res = await executeLineWithControlFlowAsync(lineIdx, lines, 1, labelScan.labels, cfStructure, true);
        const allErrors = funcErrs.concat(labelScan.errors, cfStructure.errors, res.errors);

        if (res.nextLineIdx < lines.length && res.nextLineIdx !== lineIdx + 1) {
            state.pc = res.nextLineIdx;
            state.stepEvaluateBranch = res.nextEvalBranch;
        }
        appendOutputAndErrors(res.output, allErrors, false, lineIdx + 1, state.warnings);
    } catch (e) {
        appendCmdlineMessages(['行実行エラー: ' + e.message], []);
    } finally {
        isExecutionRunning = false;
        setExecutionUIMode(false);
    }
}

async function runSubAsync(num) {
    if (isExecutionRunning) {
        abortCurrentExecution();
        return;
    }
    isExecutionRunning = true;
    setExecutionUIMode(true);

    try {
        const funcErrs = syncMainFunctions();
        const subEl = document.getElementById('sub-code' + num);
        if (!subEl) return;
        const code = subEl.value;
        const res = await executeCasicCodeAsync(code, 1, true);
        appendOutputAndErrors(res.output, funcErrs.concat(res.errors), false, 'Sub' + num, res.warnings);
    } catch (e) {
        appendCmdlineMessages(['サブ実行エラー: ' + e.message], []);
    } finally {
        isExecutionRunning = false;
        setExecutionUIMode(false);
    }
}

async function executeCommandLineStringAsync(cmdText) {
    const trimmed = cleanText(cmdText);
    if (trimmed === '') return;
    
    if (isExecutionRunning) {
        abortCurrentExecution();
        return;
    }
    isExecutionRunning = true;
    setExecutionUIMode(true);

    try {
        const funcErrs = syncMainFunctions();
        const res = await executeCasicCodeAsync(cmdText, 1, true);
        appendOutputAndErrors(res.output, funcErrs.concat(res.errors), false, 'Cmd', res.warnings, trimmed);
    } catch (e) {
        appendCmdlineMessages(['コマンドライン実行エラー: ' + e.message], []);
    } finally {
        isExecutionRunning = false;
        setExecutionUIMode(false);
    }
}

function runCommandLineFromMain() {
    const inputEl = document.getElementById('cmdline-input');
    if (!inputEl) return;
    executeCommandLineStringAsync(inputEl.value);
}

// HTMLのonclick等から呼び出されるラッパー
function runMain() { runMainAsync(); }
function stepMain() { stepMainAsync(); }
function runClickedLine(idx) { runClickedLineAsync(idx); }
function runSub(num) { runSubAsync(num); }

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
        appendCmdlineMessages(['[メモリ設定エラー] ' + e.message], []);
    }
}

function clearOutputOnly() {
    state.outputBuffer = '';
    state.outputTruncateWarned = false;
    if (typeof outputPagination !== 'undefined') {
        outputPagination.currentPage = 1;
        outputPagination.totalPages = 1;
    }
    renderMainOutputBox();
    syncPopupOutput();
}

function resetEngine() {
    if (isExecutionRunning) {
        abortCurrentExecution();
    }
    
    state.vars = {};
    state.arrays = {};
    state.dicts = {};
    state.functions = {};
    state.callStack = [];
    state.funcOutputBuffer = '';
    state.outputBuffer = '';
    state.outputTruncateWarned = false;
    state.forStates = {};
    state.inputPtr = 0;
    state.rngSeed = null;
    state.stepEvaluateBranch = false;
    state.isStopped = false;
    state.runEndLineIdx = null;
    state.lastModified = null;
    state.pc = 0;
    state.totalSteps = 0;
    state.warnings = [];
    
    state.isAborting = false;
    state.isStepMode = false;
    
    state.lastTickTime = null;
    state.lastFrameTime = null;

    if (typeof outputPagination !== 'undefined') {
        outputPagination.currentPage = 1;
        outputPagination.totalPages = 1;
    }

    syncMainFunctions();

    renderMainOutputBox();
    const logDiv = document.getElementById('cmdline-log');
    if (logDiv) logDiv.innerHTML = '';
    const statsEl = document.getElementById('exec-stats');
    if (statsEl) statsEl.innerText = 'Next: 1 | InPtr: 0 | Steps: 0';
    renderMemoryUI();
    updateLineNumbers();
    syncPopupOutput();
    syncPopupCmdline();
}

window.onload = function() {
    loadEditorSettings();
    initSettingsModalEvents();

    state.outputBuffer = '';
    state.outputTruncateWarned = false;

    document.getElementById('input-data').value = [
        '3',
        '10 20',
        '30 40',
        '50 60'
    ].join('\n');

    document.getElementById('input-data').addEventListener('input', function() {
        syncPopupInput();
    });

    const cmdInputEl = document.getElementById('cmdline-input');
    if (cmdInputEl) {
        cmdInputEl.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                runCommandLineFromMain();
            }
        });
    }

    const funcCodeEl = document.getElementById('func-code');
    if (funcCodeEl) {
        funcCodeEl.value = [
            '# ユーザー定義関数（このタブでは fun の定義のみ記述できます）',
            'fun calc_score(x, y) return x * 5 + y * 2',
            '',
            'fun sum_to(n)',
            '    for(_i, n)',
            '        _ans += _i',
            '    end',
            '    return _ans',
            'end'
        ].join('\n');
    }

    document.getElementById('code').value = [
        '# 新規追加機能のテスト',
        'out "wait 1000..."',
        'wait 1000',
        'out "Done!"',
        '',
        '# キーボード入力判定',
        'out "Right Shift Pressed? : " & key("right_shift")',
        'out "Keys: " & join(keys())',
        '',
        '# Fetchの非同期テスト (1秒くらいで変数に値が入る)',
        'fetch(false) mytext, "https://example.com/"',
        'out "Fetch sent (async). Check memory later."',
        '',
        '# tps() / fps() テスト',
        'tick',
        'wait 100',
        'tick',
        'out "TPS: " & tps()'
    ].join('\n');

    document.getElementById('cmdline-input').value = 'cont';

    // 10万ループ（非同期なのでブラウザがフリーズしないかテスト用）
    document.getElementById('sub-code1').value = [
        'for(100000)',
        '    # 途中で「■ 停止」ボタンを押せば止まります',
        '    a += 1',
        'end',
        'out "Count=" & a'
    ].join('\n');

    document.getElementById('sub-code2').value = 'run 1:3';

    setupEditor('code', true, false);
    setupEditor('func-code', false, true);
    for (let i = 1; i <= 2; i++) {
        setupEditor('sub-code' + i, false, false);
    }
    syncMainFunctions();
    renderMemoryUI();
};