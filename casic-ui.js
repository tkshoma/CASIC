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

// ==========================================
// 1. エディタ設定 & localStorage 保存・復元
// ==========================================
const SETTINGS_STORAGE_KEY = 'casic_editor_settings_v1';

const editorSettings = {
    tabSpaces: 4,
    autoIndent: true,
    autoCloseParen: true,
    autoCloseQuote: true
};

function loadEditorSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            if (typeof parsed.tabSpaces === 'number' && parsed.tabSpaces >= 1 && parsed.tabSpaces <= 16) {
                editorSettings.tabSpaces = Math.trunc(parsed.tabSpaces);
            }
            if (typeof parsed.autoIndent === 'boolean') {
                editorSettings.autoIndent = parsed.autoIndent;
            }
            if (typeof parsed.autoCloseParen === 'boolean') {
                editorSettings.autoCloseParen = parsed.autoCloseParen;
            }
            if (typeof parsed.autoCloseQuote === 'boolean') {
                editorSettings.autoCloseQuote = parsed.autoCloseQuote;
            }
        }
    } catch (e) {
    }
}

function saveEditorSettings() {
    try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(editorSettings));
    } catch (e) {
    }
}

function syncSettingsModalInputs() {
    const tabInput = document.getElementById('setting-tab-spaces');
    const indentChk = document.getElementById('setting-auto-indent');
    const parenChk = document.getElementById('setting-auto-paren');
    const quoteChk = document.getElementById('setting-auto-quote');

    if (tabInput) tabInput.value = String(editorSettings.tabSpaces);
    if (indentChk) indentChk.checked = editorSettings.autoIndent;
    if (parenChk) parenChk.checked = editorSettings.autoCloseParen;
    if (quoteChk) quoteChk.checked = editorSettings.autoCloseQuote;
}

function initSettingsModalEvents() {
    const tabInput = document.getElementById('setting-tab-spaces');
    const indentChk = document.getElementById('setting-auto-indent');
    const parenChk = document.getElementById('setting-auto-paren');
    const quoteChk = document.getElementById('setting-auto-quote');

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
    if (quoteChk) {
        quoteChk.addEventListener('change', function() {
            editorSettings.autoCloseQuote = quoteChk.checked;
            saveEditorSettings();
        });
    }
}

function openSettingsModal() {
    syncSettingsModalInputs();
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.remove('hidden');
}

function closeSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.add('hidden');
}

function handleModalOverlayClick(e) {
    if (e.target && e.target.id === 'settings-modal') {
        closeSettingsModal();
    }
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

function resetSuggestCycle() {
    suggestState.isCycling = false;
    suggestState.selectedIndex = -1;
}

// コード内の変数・配列・辞書・ユーザー定義関数名をスキャンして候補に加える
function collectCodeSymbols() {
    const varMap = new Map();
    const funcSet = new Set();

    // 1. 組み込み定数とメモリ内の変数・配列・辞書・関数
    varMap.set('true', 'true');
    varMap.set('false', 'false');
    Object.keys(state.vars).forEach(function(k) { varMap.set(k.toLowerCase(), k); });
    Object.keys(state.arrays).forEach(function(k) { varMap.set(k.toLowerCase() + '[]', k + '[]'); });
    Object.keys(state.dicts).forEach(function(k) { varMap.set(k.toLowerCase() + '{}', k + '{}'); });
    Object.keys(state.functions).forEach(function(k) { funcSet.add(k.toLowerCase()); });

    // 2. エディタに書かれているコードからも変数・配列・辞書・関数名を抽出
    const editorIds = ['code', 'sub-code1', 'sub-code2'];
    for (let eIdx = 0; eIdx < editorIds.length; eIdx++) {
        const el = document.getElementById(editorIds[eIdx]);
        if (!el) continue;
        const lines = String(el.value).split('\n');
        for (let lIdx = 0; lIdx < lines.length; lIdx++) {
            const stmts = splitStatementsByColon(lines[lIdx]);
            for (let sIdx = 0; sIdx < stmts.length; sIdx++) {
                const stmt = cleanText(stmts[sIdx]);
                if (!stmt) continue;

                // fun 関数名(引数...) の抽出
                if (stmt.length > 4 && stmt.slice(0, 3).toLowerCase() === 'fun' && isSpaceChar(stmt[3])) {
                    const parsedFun = parseFunHeader(stmt.slice(4));
                    if (!parsedFun.error) {
                        funcSet.add(parsedFun.funcNameLower);
                        parsedFun.params.forEach(function(p) { varMap.set(p, p); });
                    }
                    continue;
                }

                // for(i, n) のカウンタ変数抽出
                if (stmt.length > 4 && stmt.slice(0, 3).toLowerCase() === 'for') {
                    const paren = extractParenHead(stmt.slice(3));
                    if (paren && paren.inside.indexOf(',') !== -1) {
                        const parts = splitTopLevelComma(paren.inside);
                        if (parts.length === 2 && isValidVarIdentifier(parts[0])) {
                            const vName = cleanText(parts[0]);
                            varMap.set(vName.toLowerCase(), vName);
                        }
                    }
                }

                // 代入文の左辺 (v = ..., a[] = ..., d{} = ...) の抽出
                if (isVarStartChar(stmt[0])) {
                    let i = 1;
                    while (i < stmt.length && isIdentPartChar(stmt[i])) i++;
                    const ident = stmt.slice(0, i);
                    const lowerIdent = ident.toLowerCase();
                    if (!COMMAND_KEYWORDS.has(lowerIdent)) {
                        const rest = cleanText(stmt.slice(i));
                        if (rest.startsWith('[]') || (rest.startsWith('[') && !hasDict(ident))) {
                            varMap.set(lowerIdent + '[]', ident + '[]');
                        } else if (rest.startsWith('{}')) {
                            varMap.set(lowerIdent + '{}', ident + '{}');
                        } else if (matchAssignmentOp(rest) !== null) {
                            varMap.set(lowerIdent, ident);
                        }
                    }
                }
            }
        }
    }

    return { varMap: varMap, funcSet: funcSet };
}

// キャレット位置の文脈（インデントのみか、文頭/コロン直後の命令か、引数の場所か）を解析する
function analyzeCursorSuggestContext(text, cursorPos) {
    const lineStart = text.lastIndexOf('\n', cursorPos - 1) + 1;
    const lineBeforeCursor = text.slice(lineStart, cursorPos);

    // 1. その行のキャレット以前に空白以外の文字がない場合 -> インデントモード
    if (cleanText(lineBeforeCursor) === '') {
        return { hasTextBeforeCursor: false };
    }

    // 2. 文字列リテラル "..." 内やコメント # ' 内かどうかチェック
    let inQuotes = false;
    let lastColonOutsideParens = -1;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;

    for (let i = 0; i < lineBeforeCursor.length; i++) {
        const ch = lineBeforeCursor[i];
        if (ch === '"' && lineBeforeCursor[i - 1] !== CHAR_BSLASH) {
            inQuotes = !inQuotes;
            continue;
        }
        if (!inQuotes) {
            if (ch === '/' && isSlashStringStartInLine(lineBeforeCursor, i)) {
                if (lineBeforeCursor[i + 1] !== '=' && lineBeforeCursor[i + 1] !== '.') {
                    const slashEnd = findSlashStringEnd(lineBeforeCursor, i);
                    if (slashEnd >= lineBeforeCursor.length) {
                        // スラッシュ文字列を入力中
                        return { hasTextBeforeCursor: true, inStringOrComment: true };
                    }
                    i = slashEnd - 1;
                    continue;
                }
            }
            if (ch === '#' || ch === "'") {
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

    if (inQuotes) {
        return { hasTextBeforeCursor: true, inStringOrComment: true };
    }

    // 3. カーソル直前の入力中トークン（prefix）を切り出す
    let wordStartInLine = lineBeforeCursor.length;
    while (wordStartInLine > 0) {
        const prevCh = lineBeforeCursor[wordStartInLine - 1];
        if (isVarStartChar(prevCh) || isIdentPartChar(prevCh) || isDigitChar(prevCh)) {
            wordStartInLine--;
        } else {
            break;
        }
    }
    const prefix = lineBeforeCursor.slice(wordStartInLine);
    if (prefix.length > 0 && isDigitChar(prefix[0])) {
        // 数字リテラル入力中はサジェストしない
        return { hasTextBeforeCursor: true, inStringOrComment: true };
    }

    // 4. 文脈判定：文頭または `:` の直後なら「命令(cmd)」、それ以外なら「引数の場所＝関数・変数(arg)」
    const stmtStartInLine = (lastColonOutsideParens !== -1) ? (lastColonOutsideParens + 1) : 0;
    const beforeWordInStmt = cleanText(lineBeforeCursor.slice(stmtStartInLine, wordStartInLine));

    let contextType = 'arg';
    if (beforeWordInStmt === '' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        contextType = 'cmd';
    } else {
        // 1行 if(b) や elseif(b) や else や for(...) や while(b) の直後の命令位置も cmd として扱う
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
        replaceEnd: cursorPos
    };
}

// 入力された prefix と文脈からサジェスト候補リストを生成する
// 優先度: (先頭一致) -> (途中一致)
function buildSuggestionsList(prefix, contextType) {
    const pLower = String(prefix || '').toLowerCase();
    const rawItems = [];

    if (contextType === 'cmd') {
        // 命令のサジェスト（水色）
        COMMAND_KEYWORDS.forEach(function(cmd) {
            rawItems.push({
                key: cmd.toLowerCase(),
                display: '[c]' + cmd,
                insertText: cmd,
                isFunc: false,
                colorClass: 'kind-cyan'
            });
        });
    } else {
        // 引数の場所：関数（水色）および変数（オレンジ色）のサジェスト
        const symbols = collectCodeSymbols();

        // 組み込み関数 + ユーザー定義関数
        const allFuncs = new Set(BUILTIN_FUNCTION_NAMES);
        symbols.funcSet.forEach(function(fn) { allFuncs.add(fn); });

        allFuncs.forEach(function(fn) {
            rawItems.push({
                key: fn.toLowerCase(),
                display: '[f]' + fn + '()',
                insertText: fn + '()',
                isFunc: true,
                colorClass: 'kind-cyan'
            });
        });

        // 変数・配列・辞書
        symbols.varMap.forEach(function(origName, lowerKey) {
            const pureKey = lowerKey.replace(/\[\]$/, '').replace(/\{\}$/, '');
            rawItems.push({
                key: pureKey,
                display: '[v]' + origName,
                insertText: origName,
                isFunc: false,
                colorClass: 'kind-orange'
            });
        });
    }

    const prefixMatches = [];
    const substringMatches = [];

    for (let i = 0; i < rawItems.length; i++) {
        const item = rawItems[i];
        if (pLower === '') {
            prefixMatches.push(item);
        } else if (item.key.indexOf(pLower) === 0) {
            prefixMatches.push(item);
        } else if (item.key.indexOf(pLower) > 0) {
            substringMatches.push(item);
        }
    }

    // 見やすさのため同じグループ内は文字数の短い順 → 辞書順で整列
    function sortByLenAndAlpha(a, b) {
        if (a.key.length !== b.key.length) return a.key.length - b.key.length;
        return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0);
    }

    prefixMatches.sort(sortByLenAndAlpha);
    substringMatches.sort(sortByLenAndAlpha);

    return prefixMatches.concat(substringMatches);
}

// サジェストバーのDOM描画
function renderSuggestBar() {
    const bar = document.getElementById('suggest-bar');
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
        const selEl = document.getElementById('suggest-item-' + suggestState.selectedIndex);
        if (selEl) {
            selEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        }
    }
}

// エディタのカーソル位置からサジェスト候補を更新する
function updateSuggestionsForEditor(textarea) {
    if (suggestState.isCycling) return;

    suggestState.activeEditor = textarea;
    const ctx = analyzeCursorSuggestContext(textarea.value, textarea.selectionStart);

    if (!ctx.hasTextBeforeCursor || ctx.inStringOrComment) {
        suggestState.candidates = [];
        suggestState.selectedIndex = -1;
        const bar = document.getElementById('suggest-bar');
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

// 指定したインデックスのサジェスト候補をエディタに適用する
function applySuggestionByIndex(textarea, index, updateEditorCallback) {
    const list = suggestState.candidates;
    if (!list || index < 0 || index >= list.length) return false;

    const item = list[index];
    const val = textarea.value;
    const start = suggestState.replaceStart;
    const end = suggestState.replaceEnd;

    let insertStr = item.insertText;
    const afterText = val.slice(end);

    // もし関数の補完で、すでに直後に `(` がある場合は `()` を重複させない
    let placeCursorInsideParen = false;
    if (item.isFunc) {
        if (afterText.startsWith('(')) {
            insertStr = insertStr.slice(0, -2);
        } else {
            placeCursorInsideParen = true;
        }
    }

    textarea.value = val.slice(0, start) + insertStr + afterText;
    const newEnd = start + insertStr.length;

    // 関数 `replace()` を挿入した場合はキャレットを `replace(|)` の中に置くとすぐ引数を入力でき、
    // かつ suggestState.replaceEnd には `)` までを含めて記録しておくことで次のTab押下時にも綺麗に置換できる
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
    renderSuggestBar();
    return true;
}

function handleSuggestItemMouseDown(e, index) {
    e.preventDefault();
    const textarea = suggestState.activeEditor || document.getElementById('code');
    if (!textarea) return;
    textarea.focus();
    applySuggestionByIndex(textarea, index, function() {
        const highlightDiv = document.getElementById(textarea.id + '-highlight');
        if (highlightDiv) highlightDiv.innerHTML = highlightCasic(textarea.value, textarea.selectionStart);
        if (textarea.id === 'code') {
            updateLineNumbers();
            updateCodeStats();
        }
    });
}

// ==========================================
// 3. シンタックスハイライト・エディタ制御
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

    textarea.addEventListener('input', function() {
        resetSuggestCycle();
        update();
        updateSuggestionsForEditor(textarea);
    });

    textarea.addEventListener('click', function() {
        resetSuggestCycle();
        update();
        updateSuggestionsForEditor(textarea);
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
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Home' || e.key === 'End') {
            resetSuggestCycle();
            update();
            updateSuggestionsForEditor(textarea);
        }
    });

    textarea.addEventListener('blur', function() {
        suggestState.isTabHeld = false;
        resetSuggestCycle();
    });

    textarea.addEventListener('scroll', function() {
        highlightDiv.scrollTop = textarea.scrollTop;
        highlightDiv.scrollLeft = textarea.scrollLeft;
        if (gutter) gutter.scrollTop = textarea.scrollTop;
    });

    textarea.addEventListener('keydown', function(e) {
        if (e.isComposing) return;

        // 0. Tabを押しながら数字キー (1〜9) を押した場合：その番号のサジェスト候補に直接変換
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

        // 1. Tabキー：キャレット以前に文字がない場合はインデント、文字がある場合は予測変換
        if (e.key === 'Tab') {
            e.preventDefault();
            suggestState.isTabHeld = true;

            // すでに予測変換のTabサイクル中の場合（2回目、3回目のTab押下）
            if (suggestState.isCycling && suggestState.activeEditor === this && suggestState.candidates.length > 0) {
                // 長押しリピート時は勝手に進まないようにし、Tab+数字を押しやすくする
                if (e.repeat) return;
                const nextIdx = (suggestState.selectedIndex + 1) % suggestState.candidates.length;
                applySuggestionByIndex(this, nextIdx, update);
                return;
            }

            const ctx = analyzeCursorSuggestContext(this.value, this.selectionStart);

            // キャレット以前に空白以外の文字がない場合は今まで通りインデント
            if (!ctx.hasTextBeforeCursor) {
                const spacesCount = Math.max(1, Math.min(16, Number(editorSettings.tabSpaces) || 4));
                const indentSpaces = ' '.repeat(spacesCount);
                const start = this.selectionStart;
                const end = this.selectionEnd;
                const val = this.value;
                this.value = val.substring(0, start) + indentSpaces + val.substring(end);
                this.selectionStart = this.selectionEnd = start + indentSpaces.length;
                update();
                return;
            }

            // キャレット以前に文字がある場合はサジェストの1番目に変換
            if (e.repeat) return;
            updateSuggestionsForEditor(this);
            if (suggestState.candidates.length > 0) {
                applySuggestionByIndex(this, 0, update);
            }
            return;
        }

        // Tab以外のキーが押されたらTabサイクル状態を解除
        resetSuggestCycle();

        // 2. Enterキーによる自動インデント
        if (e.key === 'Enter' && editorSettings.autoIndent) {
            e.preventDefault();
            const start = this.selectionStart;
            const end = this.selectionEnd;
            const val = this.value;

            const lineStart = val.lastIndexOf('\n', start - 1) + 1;
            let currentIndent = '';
            for (let i = lineStart; i < start; i++) {
                const ch = val[i];
                if (ch === ' ' || ch === '\t' || ch === CHAR_FW_SP) {
                    currentIndent += ch;
                } else {
                    break;
                }
            }

            const insertText = '\n' + currentIndent;
            this.value = val.substring(0, start) + insertText + val.substring(end);
            this.selectionStart = this.selectionEnd = start + insertText.length;
            update();
            updateSuggestionsForEditor(this);
            return;
        }

        // 3. `(` 入力時の自動閉じ括弧 `)`
        if (e.key === '(' && editorSettings.autoCloseParen) {
            e.preventDefault();
            const start = this.selectionStart;
            const end = this.selectionEnd;
            const val = this.value;
            const selected = val.substring(start, end);
            this.value = val.substring(0, start) + '(' + selected + ')' + val.substring(end);
            this.selectionStart = start + 1;
            this.selectionEnd = end + 1;
            update();
            updateSuggestionsForEditor(this);
            return;
        }

        // 4. `"` 入力時の自動閉じダブルクォーテーション `"`
        if (e.key === '"' && editorSettings.autoCloseQuote) {
            e.preventDefault();
            const start = this.selectionStart;
            const end = this.selectionEnd;
            const val = this.value;
            const selected = val.substring(start, end);
            this.value = val.substring(0, start) + '"' + selected + '"' + val.substring(end);
            this.selectionStart = start + 1;
            this.selectionEnd = end + 1;
            update();
            updateSuggestionsForEditor(this);
            return;
        }
    });

    update();
}

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

function appendOutputAndErrors(output, errors, isReplace = false, currentLineDisplay = '-', warnings = [], echoCmd = null) {
    const outDiv = document.getElementById('output');
    if (outDiv) {
        if (isReplace) {
            outDiv.innerHTML = '';
        }
        if (output) {
            const span = document.createElement('span');
            span.textContent = output;
            outDiv.appendChild(span);
        }
        outDiv.scrollTop = outDiv.scrollHeight;
    }

    appendCmdlineMessages(errors, warnings, echoCmd);

    const nextLineLabel = (state.pc >= 0 && state.pc < getMainCodeLinesArray().length) ? (state.pc + 1) : '-';
    const statsEl = document.getElementById('exec-stats');
    if (statsEl) {
        statsEl.innerText = 'Next: ' + nextLineLabel + ' | InPtr: ' + state.inputPtr + ' | Steps: ' + state.totalSteps;
    }
    renderMemoryUI();
    updateLineNumbers();
    syncPopupOutput();
}

function executeCommandLineString(cmdText) {
    const trimmed = cleanText(cmdText);
    if (trimmed === '') return;
    syncMainFunctions();
    const res = executeCasicCode(cmdText, 1, true);
    appendOutputAndErrors(res.output, res.errors, false, 'Cmd', res.warnings, trimmed);
}

function runCommandLineFromMain() {
    const inputEl = document.getElementById('cmdline-input');
    if (!inputEl) return;
    executeCommandLineString(inputEl.value);
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
        appendCmdlineMessages(['[メモリ設定エラー] ' + e.message], []);
    }
}

function clearOutputOnly() {
    const outDiv = document.getElementById('output');
    if (outDiv) outDiv.innerHTML = '';
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
    state.isStopped = false;
    state.runEndLineIdx = null;
    state.lastModified = null;
    state.pc = 0;
    state.totalSteps = 0;
    state.warnings = [];

    syncMainFunctions();

    const outDiv = document.getElementById('output');
    if (outDiv) outDiv.innerHTML = '';
    const logDiv = document.getElementById('cmdline-log');
    if (logDiv) logDiv.innerHTML = '';
    const statsEl = document.getElementById('exec-stats');
    if (statsEl) statsEl.innerText = 'Next: 1 | InPtr: 0 | Steps: 0';
    renderMemoryUI();
    updateLineNumbers();
    syncPopupOutput();
    syncPopupCmdline();
}

function runMain() {
    resetEngine();
    const code = document.getElementById('code').value;
    const res = executeCasicCode(code, 1, false);
    appendOutputAndErrors(res.output, res.errors, true, 'All', res.warnings);
}

function stepMain() {
    const lines = getMainCodeLinesArray();
    if (state.pc >= lines.length || state.pc < 0) {
        state.pc = 0;
        state.stepEvaluateBranch = false;
    }
    const lineIdx = state.pc;
    state.warnings = [];
    const res = runMainCodeSession({
        endLineIdx: lines.length - 1,
        maxSteps: 1
    });
    appendOutputAndErrors(res.output, res.errors, false, lineIdx + 1, state.warnings);
}

function runClickedLine(lineIdx) {
    const lines = getMainCodeLinesArray();
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
    const subEl = document.getElementById('sub-code' + num);
    if (!subEl) return;
    const code = subEl.value;
    const res = executeCasicCode(code, 1, true);
    appendOutputAndErrors(res.output, res.errors, false, 'Sub' + num, res.warnings);
}

window.onload = function() {
    loadEditorSettings();
    initSettingsModalEvents();

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

    document.getElementById('code').value = [
        'repair = "apple_pie"',
        'out "hello1"',
        'out "hello2"',
        'for(i, 10)',
        '    put i',
        '    if(i = 5) stop',
        'end',
        'out'
    ].join('\n');

    document.getElementById('cmdline-input').value = 'cont';

    document.getElementById('sub-code1').value = [
        'for(5)',
        '    goto 5',
        '    step 2',
        'end'
    ].join('\n');

    document.getElementById('sub-code2').value = 'run 2:3';

    setupEditor('code', true);
    for (let i = 1; i <= 2; i++) {
        setupEditor('sub-code' + i, false);
    }
    syncMainFunctions();
    renderMemoryUI();
};