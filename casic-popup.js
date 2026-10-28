// ==========================================
// ポップアップウィンドウ（別窓）の生成と同期処理
// ==========================================

const popupWindows = {
    code: null,
    input: null,
    output: null,
    memory: null,
    cmdline: null
};

const popupFontSizes = {
    code: 18,
    input: 18,
    output: 18,
    memory: 15,
    cmdline: 15
};

// Output別窓のページネーション状態（1ページあたり5,000文字）
const OUTPUT_PAGE_SIZE = 5000;
const outputPagination = {
    currentPage: 1,
    totalPages: 1
};

function getFullOutputText() {
    if (typeof state !== 'undefined' && typeof state.outputBuffer === 'string') {
        return state.outputBuffer;
    }
    const mainOut = document.getElementById('output');
    return mainOut ? (mainOut.textContent || '') : '';
}

function getOutputTotalPages(fullText) {
    if (!fullText || fullText.length === 0) return 1;
    return Math.ceil(fullText.length / OUTPUT_PAGE_SIZE);
}

function getOutputPageSlice(fullText, pageNum) {
    if (!fullText || fullText.length === 0) return '';
    const total = getOutputTotalPages(fullText);
    const p = Math.max(1, Math.min(total, pageNum));
    const start = (p - 1) * OUTPUT_PAGE_SIZE;
    const end = Math.min(fullText.length, start + OUTPUT_PAGE_SIZE);
    return fullText.slice(start, end);
}

function copyTextToClipboard(text, win, onSuccess) {
    if (win && win.navigator && win.navigator.clipboard && win.navigator.clipboard.writeText) {
        win.navigator.clipboard.writeText(text).then(function() {
            if (onSuccess) onSuccess();
        }).catch(function() {
            fallbackCopyText(text, win, onSuccess);
        });
    } else {
        fallbackCopyText(text, win, onSuccess);
    }
}

function fallbackCopyText(text, win, onSuccess) {
    const doc = (win && !win.closed) ? win.document : document;
    const ta = doc.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    doc.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
        doc.execCommand('copy');
        if (onSuccess) onSuccess();
    } catch (e) {
        alert('コピーに失敗しました: ' + e.message);
    }
    doc.body.removeChild(ta);
}

function openPopupWindow(type) {
    const existing = popupWindows[type];
    if (existing && !existing.closed) {
        existing.focus();
        syncSpecificPopup(type);
        return;
    }

    const titles = {
        code: 'CASIC - Code (コード編集・全画面対応)',
        input: 'CASIC - Input (入力データ編集)',
        output: 'CASIC - Output (出力結果確認・5000文字改ページ)',
        memory: 'CASIC - Memory (メモリ可視化)',
        cmdline: 'CASIC - Command Line (コマンドライン・エラーログ)'
    };

    const specs = (type === 'code')
        ? 'width=920,height=700,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes'
        : 'width=740,height=580,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes';

    const win = window.open('', 'casic_popup_' + type, specs);
    if (!win) {
        alert('ポップアップウィンドウがブロックされました。ブラウザの設定でポップアップを許可してください。');
        return;
    }

    popupWindows[type] = win;
    if (type === 'code' && typeof editorSettings !== 'undefined' && editorSettings.editorFontSize) {
        popupFontSizes.code = editorSettings.editorFontSize;
    }
    const initSize = popupFontSizes[type] || 18;
    const tabSizeVal = (typeof editorSettings !== 'undefined' && editorSettings.tabSpaces) ? editorSettings.tabSpaces : 4;

    let extraControlsHtml = '';
    if (type === 'code') {
        extraControlsHtml =
            '<button id="btn-run-from-popup" class="action-btn run-cmd-btn" style="width:auto; padding:5px 14px;" title="メインのRUNを実行">▶ RUN</button>' +
            '<button id="btn-update-code" class="action-btn update-btn" title="Ctrl+Enterでも反映可能">更新 (元のCodeへ反映)</button>' +
            '<span id="update-msg" class="update-msg"></span>';
    } else if (type === 'input') {
        extraControlsHtml =
            '<label class="wrap-label"><input type="checkbox" id="chk-wrap" checked> 端で折り返す</label>' +
            '<button id="btn-update-input" class="action-btn update-btn" title="Ctrl+Enterでも更新可能">更新 (元のInputへ反映)</button>' +
            '<span id="update-msg" class="update-msg"></span>';
    } else if (type === 'output') {
        extraControlsHtml =
            '<label class="wrap-label"><input type="checkbox" id="chk-wrap" checked> 端で折り返す</label>' +
            '<button id="btn-copy-all-output" class="action-btn update-btn" title="全ページの出力をまとめてコピーします">コピー</button>' +
            '<button id="btn-clear-output" class="action-btn clear-btn">出力クリア</button>' +
            '<span id="copy-msg" class="update-msg"></span>';
    } else if (type === 'cmdline') {
        extraControlsHtml =
            '<label class="wrap-label"><input type="checkbox" id="chk-wrap" checked> 端で折り返す</label>' +
            '<button id="btn-clear-cmdline" class="action-btn clear-btn">ログクリア</button>';
    }

    let bodyContentHtml = '';
    if (type === 'code') {
        bodyContentHtml =
            '<div class="popup-code-container">' +
                '<div id="popup-code-gutter" class="popup-code-gutter"></div>' +
                '<div id="popup-code-body" class="popup-code-body">' +
                    '<div id="popup-code-highlight" class="popup-code-highlight"></div>' +
                    '<textarea id="popup-code-area" spellcheck="false" placeholder="ここにCASICのコードを書く..."></textarea>' +
                '</div>' +
            '</div>';
    } else if (type === 'input') {
        bodyContentHtml = '<textarea id="popup-input-area" spellcheck="false" placeholder="ここに入力データを書く..."></textarea>';
    } else if (type === 'output') {
        bodyContentHtml =
            '<div class="pagination-bar">' +
                '<div class="page-nav-buttons">' +
                    '<button id="btn-page-first" class="page-btn" title="最初のページへ">|&lt;&lt;</button>' +
                    '<button id="btn-page-prev" class="page-btn" title="前の5000文字へ">&lt; 前へ</button>' +
                    '<span class="page-indicator">Page <input type="number" id="page-num-input" min="1" value="1"> / <span id="page-total-label">1</span></span>' +
                    '<button id="btn-page-next" class="page-btn" title="次の5000文字へ">次へ &gt;</button>' +
                    '<button id="btn-page-last" class="page-btn" title="最後のページへ">&gt;&gt;|</button>' +
                '</div>' +
                '<div class="page-stats-info" id="output-char-stats">全 0 文字 (0〜0文字目を表示)</div>' +
            '</div>' +
            '<div id="popup-output-area" class="popup-output-area"></div>';
    } else if (type === 'memory') {
        bodyContentHtml = '<div id="popup-memory-area" class="popup-memory-area"></div>';
    } else if (type === 'cmdline') {
        bodyContentHtml =
            '<div id="popup-cmdline-log" class="popup-output-area"></div>' +
            '<div class="popup-cmd-row">' +
                '<textarea id="popup-cmdline-input" spellcheck="false" placeholder="コマンドを入力 (cont, run 2:3, goto 2, step 2, またはCASICコード... Ctrl+Enterで実行)"></textarea>' +
                '<button id="btn-popup-cmd-run" class="action-btn run-cmd-btn">実行</button>' +
            '</div>';
    }

    const htmlDoc =
        '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">' +
        '<title>' + titles[type] + '</title>' +
        '<style>' +
        ':root { --vscode-font: Menlo, Monaco, Consolas, "Courier New", monospace; --content-font-size: ' + initSize + 'px; --tab-size: ' + tabSizeVal + '; }' +
        'body { font-family: sans-serif; margin: 0; padding: 12px; background-color: #1e1e1e; color: #d4d4d4; height: 100vh; box-sizing: border-box; display: flex; flex-direction: column; gap: 8px; overflow: hidden; }' +
        '.toolbar { display: flex; align-items: center; justify-content: space-between; background: #252526; padding: 8px 12px; border: 1px solid #444; border-radius: 6px; flex-wrap: wrap; gap: 10px; flex-shrink: 0; }' +
        '.font-controls { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #ccc; }' +
        '.size-btn { width: 28px; height: 26px; background: #3c3c3c; color: #fff; border: 1px solid #555; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 14px; }' +
        '.size-btn:hover { background: #007acc; border-color: #007acc; }' +
        '#font-slider { width: 110px; accent-color: #007acc; cursor: pointer; }' +
        '#font-size-label { font-family: var(--vscode-font); min-width: 42px; text-align: center; color: #9cdcfe; font-weight: bold; }' +
        '.right-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }' +
        '.wrap-label { font-size: 12px; color: #ccc; display: flex; align-items: center; gap: 4px; cursor: pointer; user-select: none; }' +
        '.action-btn { padding: 5px 12px; font-size: 13px; font-weight: bold; color: #fff; border: none; border-radius: 4px; cursor: pointer; }' +
        '.update-btn { background-color: #0f8f62; }' +
        '.update-btn:hover { background-color: #0b6b49; }' +
        '.run-cmd-btn { background-color: #007acc; width: 80px; height: 100%; font-size: 14px; }' +
        '.run-cmd-btn:hover { background-color: #005f9e; }' +
        '.clear-btn { background-color: #555; font-weight: normal; font-size: 12px; }' +
        '.clear-btn:hover { background-color: #777; }' +
        '.update-msg { font-size: 12px; color: #4ec9b0; font-weight: bold; }' +
        '.popup-code-container { flex: 1; display: flex; flex-direction: row; border: 1px solid #444; border-radius: 4px; background: #1e1e1e; overflow: hidden; min-height: 0; }' +
        '.popup-code-gutter { min-width: 48px; background: #252526; border-right: 1px solid #3c3c3c; padding: 15px 0; box-sizing: border-box; font-family: var(--vscode-font); font-size: var(--content-font-size); line-height: 1.5; text-align: right; user-select: none; overflow: hidden; flex-shrink: 0; color: #858585; }' +
        '.popup-line-num { padding: 0 8px 0 6px; }' +
        '.popup-code-body { position: relative; flex: 1; height: 100%; overflow-y: auto; overflow-x: auto; }' +
        '.popup-code-body::-webkit-scrollbar { width: 10px; height: 0px; }' +
        '.popup-code-body::-webkit-scrollbar:horizontal { height: 0px !important; display: none !important; }' +
        '.popup-code-body::-webkit-scrollbar-thumb:vertical { background: #4a4a4a; border-radius: 5px; }' +
        '.popup-code-highlight, #popup-code-area { position: absolute; top: 0; left: 0; min-width: 100%; min-height: 100%; padding: 15px; box-sizing: border-box; font-family: var(--vscode-font); font-size: var(--content-font-size); line-height: 1.5; margin: 0; border: none; overflow: hidden; white-space: pre; tab-size: var(--tab-size, 4); -moz-tab-size: var(--tab-size, 4); font-variant-ligatures: none; font-feature-settings: "palt" 0; }' +
        '.popup-code-highlight { color: #d4d4d4; pointer-events: none; z-index: 1; }' +
        '#popup-code-area { background: transparent; color: transparent; caret-color: #d4d4d4; resize: none; outline: none; z-index: 2; }' +
        '.pagination-bar { display: flex; align-items: center; justify-content: space-between; background: #2d2d2d; padding: 6px 12px; border: 1px solid #444; border-radius: 6px; flex-wrap: wrap; gap: 8px; flex-shrink: 0; font-size: 13px; }' +
        '.page-nav-buttons { display: flex; align-items: center; gap: 6px; }' +
        '.page-btn { padding: 3px 9px; background: #3c3c3c; color: #e0e0e0; border: 1px solid #555; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold; }' +
        '.page-btn:hover:not(:disabled) { background: #007acc; border-color: #007acc; color: #fff; }' +
        '.page-btn:disabled { opacity: 0.4; cursor: default; }' +
        '.page-indicator { display: inline-flex; align-items: center; gap: 4px; color: #ccc; font-family: var(--vscode-font); }' +
        '#page-num-input { width: 58px; padding: 2px 4px; background: #1e1e1e; color: #9cdcfe; border: 1px solid #555; border-radius: 3px; font-family: var(--vscode-font); font-size: 13px; text-align: center; font-weight: bold; }' +
        '.page-stats-info { font-family: var(--vscode-font); font-size: 12px; color: #aaa; }' +
        '#popup-input-area { flex: 1; width: 100%; resize: none; background: #1e1e1e; color: #d4d4d4; border: 1px solid #444; border-radius: 4px; padding: 12px; box-sizing: border-box; font-family: var(--vscode-font); font-size: var(--content-font-size); line-height: 1.5; white-space: pre-wrap; overflow-y: auto; overflow-x: hidden; outline: none; tab-size: var(--tab-size, 4); -moz-tab-size: var(--tab-size, 4); font-variant-ligatures: none; font-feature-settings: "palt" 0; }' +
        '#popup-input-area:focus { border-color: #007acc; }' +
        '.popup-output-area { flex: 1; width: 100%; background: #1e1e1e; color: #d4d4d4; border: 1px solid #444; border-radius: 4px; padding: 12px; box-sizing: border-box; font-family: var(--vscode-font); font-size: var(--content-font-size); line-height: 1.45; white-space: pre-wrap; word-break: break-all; overflow-y: auto; overflow-x: hidden; tab-size: var(--tab-size, 4); -moz-tab-size: var(--tab-size, 4); font-variant-ligatures: none; font-feature-settings: "palt" 0; }' +
        '.popup-cmd-row { display: flex; gap: 8px; height: 90px; flex-shrink: 0; }' +
        '#popup-cmdline-input { flex: 1; resize: none; background: #252526; color: #d4d4d4; border: 1px solid #555; border-radius: 4px; padding: 8px 10px; font-family: var(--vscode-font); font-size: var(--content-font-size); line-height: 1.4; outline: none; tab-size: var(--tab-size, 4); -moz-tab-size: var(--tab-size, 4); font-variant-ligatures: none; }' +
        '#popup-cmdline-input:focus { border-color: #007acc; }' +
        '.error-text { color: #ff6b6b; }' +
        '.warn-text { color: #dcdcaa; }' +
        '.info-text { color: #4fc1ff; }' +
        '.cmd-echo-text { color: #888; }' +
        '.popup-memory-area { flex: 1; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; gap: 8px; padding-right: 4px; font-size: var(--content-font-size); }' +
        '.memory-cell { width: 100%; min-height: 34px; display: flex; align-items: center; justify-content: space-between; box-sizing: border-box; padding: 6px 10px; border: 1px solid #555; background-color: #333; font-family: var(--vscode-font); border-radius: 4px; gap: 12px; flex-shrink: 0; overflow: hidden; }' +
        '.memory-cell.active { background-color: #094771; border-color: #00a8ff; color: white; }' +
        '.cell-name { color: #9cdcfe; font-size: 1em; font-weight: bold; flex-shrink: 0; }' +
        '.cell-value { font-size: 1em; color: #ce9178; white-space: nowrap; overflow-x: auto; overflow-y: hidden; flex: 1; min-width: 0; text-align: right; tab-size: var(--tab-size, 4); -moz-tab-size: var(--tab-size, 4); }' +
        '.memory-array-box { width: 100%; max-height: 260px; display: flex; flex-direction: column; box-sizing: border-box; border: 1px solid #555; background-color: #2b2b2c; font-family: var(--vscode-font); border-radius: 4px; flex-shrink: 0; overflow: hidden; }' +
        '.memory-array-box.active { border-color: #00a8ff; }' +
        '.memory-array-header { display: flex; justify-content: space-between; align-items: center; padding: 5px 10px; background-color: #383839; border-bottom: 1px solid #4a4a4a; flex-shrink: 0; }' +
        '.memory-array-box.active .memory-array-header { background-color: #094771; }' +
        '.array-len-badge { font-size: 0.85em; color: #aaa; }' +
        '.memory-array-list { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 4px 6px; display: flex; flex-direction: column; gap: 3px; }' +
        '.memory-array-item { display: flex; justify-content: space-between; align-items: center; padding: 3px 6px; background-color: #333; border-radius: 2px; font-size: 0.95em; gap: 8px; flex-shrink: 0; overflow: hidden; }' +
        '.array-item-idx { color: #888; font-size: 0.9em; flex-shrink: 0; }' +
        '.array-item-val { color: #ce9178; white-space: nowrap; overflow-x: auto; overflow-y: hidden; flex: 1; min-width: 0; text-align: right; tab-size: var(--tab-size, 4); -moz-tab-size: var(--tab-size, 4); }' +
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
        if (type === 'code') {
            if (typeof setEditorFontSize === 'function') {
                setEditorFontSize(clamped);
            }
            if (typeof win.updatePopupCodeLayout === 'function') {
                win.updatePopupCodeLayout();
            }
        }
    }

    slider.addEventListener('input', function() { applyFontSize(slider.value); });
    decBtn.addEventListener('click', function() { applyFontSize(popupFontSizes[type] - 2); });
    incBtn.addEventListener('click', function() { applyFontSize(popupFontSizes[type] + 2); });

    const chkWrap = win.document.getElementById('chk-wrap');
    if (chkWrap) {
        chkWrap.addEventListener('change', function() {
            let targetId = 'popup-output-area';
            if (type === 'input') targetId = 'popup-input-area';
            else if (type === 'cmdline') targetId = 'popup-cmdline-log';
            const targetEl = win.document.getElementById(targetId);
            if (targetEl) {
                targetEl.style.whiteSpace = chkWrap.checked ? 'pre-wrap' : 'pre';
                targetEl.style.wordBreak = chkWrap.checked ? 'break-all' : 'normal';
            }
        });
    }

    if (type === 'code') {
        const popupCodeArea = win.document.getElementById('popup-code-area');
        const popupHighlight = win.document.getElementById('popup-code-highlight');
        const popupGutter = win.document.getElementById('popup-code-gutter');
        const popupBody = win.document.getElementById('popup-code-body');
        const updateBtn = win.document.getElementById('btn-update-code');
        const runBtn = win.document.getElementById('btn-run-from-popup');
        const updateMsg = win.document.getElementById('update-msg');

        win.updatePopupCodeLayout = function() {
            if (!popupCodeArea || !popupHighlight || !popupGutter || !popupBody) return;
            popupHighlight.innerHTML = highlightCasic(popupCodeArea.value, popupCodeArea.selectionStart);

            const lineCount = popupCodeArea.value.split('\n').length;
            let gHtml = '';
            for (let i = 1; i <= lineCount; i++) {
                gHtml += '<div class="popup-line-num">' + i + '</div>';
            }
            popupGutter.innerHTML = gHtml;

            const computed = win.getComputedStyle(popupCodeArea);
            const lineHeight = parseFloat(computed.lineHeight) || (popupFontSizes.code * 1.5);
            const padTop = parseFloat(computed.paddingTop) || 15;
            const padBottom = parseFloat(computed.paddingBottom) || 15;
            const viewHeight = popupBody.clientHeight || 400;
            const extraBottom = Math.max(0, viewHeight - lineHeight - padTop);
            const totalHeight = Math.max(viewHeight, Math.ceil(lineCount * lineHeight + padTop + padBottom + extraBottom));

            popupHighlight.style.width = 'auto';
            const contentWidth = Math.max(popupBody.clientWidth || 0, popupHighlight.scrollWidth);

            popupCodeArea.style.height = totalHeight + 'px';
            popupHighlight.style.height = totalHeight + 'px';
            popupCodeArea.style.width = contentWidth + 'px';
            popupHighlight.style.width = contentWidth + 'px';
            popupGutter.style.paddingBottom = (padBottom + extraBottom) + 'px';
            popupGutter.scrollTop = popupBody.scrollTop;
        };

        function pushCodeToMain(showMessage) {
            const mainCode = document.getElementById('code');
            if (mainCode && popupCodeArea) {
                mainCode.value = popupCodeArea.value;
                if (typeof editorUpdateCallbacks !== 'undefined' && editorUpdateCallbacks['code']) {
                    editorUpdateCallbacks['code']();
                }
                if (showMessage && updateMsg) {
                    updateMsg.textContent = '✓ 反映しました';
                    setTimeout(function() {
                        if (!win.closed && updateMsg) updateMsg.textContent = '';
                    }, 1500);
                }
            }
        }

        if (updateBtn) updateBtn.addEventListener('click', function() { pushCodeToMain(true); });
        if (runBtn) {
            runBtn.addEventListener('click', function() {
                pushCodeToMain(false);
                if (typeof runMain === 'function') runMain();
            });
        }

        if (popupBody && popupGutter) {
            popupBody.addEventListener('scroll', function() {
                popupGutter.scrollTop = popupBody.scrollTop;
            });
        }

        if (popupCodeArea) {
            popupCodeArea.addEventListener('input', function() {
                win.updatePopupCodeLayout();
                pushCodeToMain(false);
            });
            popupCodeArea.addEventListener('click', win.updatePopupCodeLayout);
            popupCodeArea.addEventListener('keyup', win.updatePopupCodeLayout);
            popupCodeArea.addEventListener('keydown', function(e) {
                if (e.isComposing) return;
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    pushCodeToMain(true);
                    return;
                }
                if (e.key === 'Tab') {
                    e.preventDefault();
                    const spacesCount = Math.max(1, Math.min(16, Number(editorSettings.tabSpaces) || 4));
                    const indentSpaces = ' '.repeat(spacesCount);
                    const start = this.selectionStart;
                    const end = this.selectionEnd;
                    const val = this.value;
                    this.value = val.substring(0, start) + indentSpaces + val.substring(end);
                    this.selectionStart = this.selectionEnd = start + indentSpaces.length;
                    win.updatePopupCodeLayout();
                    pushCodeToMain(false);
                    return;
                }
                if (e.key === 'Enter' && editorSettings.autoIndent) {
                    e.preventDefault();
                    const start = this.selectionStart;
                    const end = this.selectionEnd;
                    const val = this.value;
                    const lineStart = (start === 0) ? 0 : (val.lastIndexOf('\n', start - 1) + 1);
                    const nextNewlineIdx = val.indexOf('\n', end);
                    const lineEnd = (nextNewlineIdx === -1) ? val.length : nextNewlineIdx;
                    let currentIndent = '';
                    for (let i = lineStart; i < start; i++) {
                        const ch = val[i];
                        if (ch === ' ' || ch === '\t' || ch === CHAR_FW_SP) currentIndent += ch;
                        else break;
                    }
                    let extraIndent = '';
                    if (typeof shouldAddExtraBlockIndent === 'function' &&
                        shouldAddExtraBlockIndent(val.slice(lineStart, start), val.slice(end, lineEnd))) {
                        const spacesCount = Math.max(1, Math.min(16, Number(editorSettings.tabSpaces) || 4));
                        extraIndent = ' '.repeat(spacesCount);
                    }
                    const insertText = '\n' + currentIndent + extraIndent;
                    this.value = val.substring(0, start) + insertText + val.substring(end);
                    this.selectionStart = this.selectionEnd = start + insertText.length;
                    win.updatePopupCodeLayout();
                    pushCodeToMain(false);
                    return;
                }
                if (e.key === '(' && editorSettings.autoCloseParen) {
                    e.preventDefault();
                    const start = this.selectionStart;
                    const end = this.selectionEnd;
                    const val = this.value;
                    this.value = val.substring(0, start) + '(' + val.substring(start, end) + ')' + val.substring(end);
                    this.selectionStart = start + 1;
                    this.selectionEnd = end + 1;
                    win.updatePopupCodeLayout();
                    pushCodeToMain(false);
                    return;
                }
                if (e.key === '[' && editorSettings.autoCloseBracket) {
                    e.preventDefault();
                    const start = this.selectionStart;
                    const end = this.selectionEnd;
                    const val = this.value;
                    this.value = val.substring(0, start) + '[' + val.substring(start, end) + ']' + val.substring(end);
                    this.selectionStart = start + 1;
                    this.selectionEnd = end + 1;
                    win.updatePopupCodeLayout();
                    pushCodeToMain(false);
                    return;
                }
                if ((e.key === '"' || e.key === "'") && editorSettings.autoCloseQuote) {
                    e.preventDefault();
                    const q = e.key;
                    const start = this.selectionStart;
                    const end = this.selectionEnd;
                    const val = this.value;
                    this.value = val.substring(0, start) + q + val.substring(start, end) + q + val.substring(end);
                    this.selectionStart = start + 1;
                    this.selectionEnd = end + 1;
                    win.updatePopupCodeLayout();
                    pushCodeToMain(false);
                    return;
                }
            });
        }
        win.addEventListener('resize', function() {
            if (typeof win.updatePopupCodeLayout === 'function') win.updatePopupCodeLayout();
        });
    }

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

        if (updateBtn) updateBtn.addEventListener('click', pushInputToMain);
        if (popupInputArea) {
            popupInputArea.addEventListener('keydown', function(e) {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    pushInputToMain();
                }
            });
        }
    }

    if (type === 'output') {
        const clearBtn = win.document.getElementById('btn-clear-output');
        const copyAllBtn = win.document.getElementById('btn-copy-all-output');
        const copyMsg = win.document.getElementById('copy-msg');
        const btnFirst = win.document.getElementById('btn-page-first');
        const btnPrev = win.document.getElementById('btn-page-prev');
        const btnNext = win.document.getElementById('btn-page-next');
        const btnLast = win.document.getElementById('btn-page-last');
        const pageInput = win.document.getElementById('page-num-input');

        if (clearBtn) {
            clearBtn.addEventListener('click', function() {
                clearOutputOnly();
            });
        }

        if (copyAllBtn) {
            copyAllBtn.addEventListener('click', function() {
                const fullText = getFullOutputText();
                copyTextToClipboard(fullText, win, function() {
                    if (copyMsg) {
                        copyMsg.textContent = '✓ 全' + fullText.length.toLocaleString() + '文字をコピーしました';
                        setTimeout(function() {
                            if (!win.closed && copyMsg) copyMsg.textContent = '';
                        }, 2000);
                    }
                });
            });
        }

        function setOutputPage(newPage) {
            const fullText = getFullOutputText();
            const total = getOutputTotalPages(fullText);
            outputPagination.totalPages = total;
            outputPagination.currentPage = Math.max(1, Math.min(total, Math.trunc(Number(newPage) || 1)));
            syncPopupOutput();
        }

        if (btnFirst) btnFirst.addEventListener('click', function() { setOutputPage(1); });
        if (btnPrev) btnPrev.addEventListener('click', function() { setOutputPage(outputPagination.currentPage - 1); });
        if (btnNext) btnNext.addEventListener('click', function() { setOutputPage(outputPagination.currentPage + 1); });
        if (btnLast) btnLast.addEventListener('click', function() { setOutputPage(outputPagination.totalPages); });
        if (pageInput) {
            pageInput.addEventListener('change', function() {
                setOutputPage(pageInput.value);
            });
        }
    }

    if (type === 'cmdline') {
        const clearBtn = win.document.getElementById('btn-clear-cmdline');
        const runBtn = win.document.getElementById('btn-popup-cmd-run');
        const cmdInput = win.document.getElementById('popup-cmdline-input');

        if (clearBtn) {
            clearBtn.addEventListener('click', function() {
                clearCmdlineLog();
            });
        }
        function triggerPopupCmd() {
            if (!cmdInput) return;
            const mainCmdInput = document.getElementById('cmdline-input');
            if (mainCmdInput) mainCmdInput.value = cmdInput.value;
            executeCommandLineString(cmdInput.value);
        }
        if (runBtn) runBtn.addEventListener('click', triggerPopupCmd);
        if (cmdInput) {
            cmdInput.addEventListener('keydown', function(e) {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    triggerPopupCmd();
                }
            });
        }
    }

    syncSpecificPopup(type);
}

function syncPopupCode() {
    const win = popupWindows.code;
    if (!win || win.closed) return;
    const popupCodeArea = win.document.getElementById('popup-code-area');
    const mainCode = document.getElementById('code');
    if (popupCodeArea && mainCode && win.document.activeElement !== popupCodeArea) {
        popupCodeArea.value = mainCode.value;
        if (typeof win.updatePopupCodeLayout === 'function') {
            win.updatePopupCodeLayout();
        }
    }
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
    const pageInput = win.document.getElementById('page-num-input');
    const totalLabel = win.document.getElementById('page-total-label');
    const charStats = win.document.getElementById('output-char-stats');
    const btnFirst = win.document.getElementById('btn-page-first');
    const btnPrev = win.document.getElementById('btn-page-prev');
    const btnNext = win.document.getElementById('btn-page-next');
    const btnLast = win.document.getElementById('btn-page-last');

    const fullText = getFullOutputText();
    const totalPages = getOutputTotalPages(fullText);
    outputPagination.totalPages = totalPages;

    if (outputPagination.currentPage > totalPages) {
        outputPagination.currentPage = totalPages;
    }
    if (outputPagination.currentPage < 1) {
        outputPagination.currentPage = 1;
    }

    const curPage = outputPagination.currentPage;
    const pageText = getOutputPageSlice(fullText, curPage);

    if (popupOut) {
        popupOut.textContent = pageText;
    }
    if (pageInput) {
        pageInput.max = String(totalPages);
        pageInput.value = String(curPage);
    }
    if (totalLabel) {
        totalLabel.textContent = String(totalPages);
    }
    if (charStats) {
        if (fullText.length === 0) {
            charStats.textContent = '全 0 文字';
        } else {
            const startIdx = (curPage - 1) * OUTPUT_PAGE_SIZE + 1;
            const endIdx = Math.min(fullText.length, curPage * OUTPUT_PAGE_SIZE);
            charStats.textContent = '全 ' + fullText.length.toLocaleString() + ' 文字 (' + startIdx.toLocaleString() + '〜' + endIdx.toLocaleString() + '文字目を表示)';
        }
    }

    if (btnFirst) btnFirst.disabled = (curPage <= 1);
    if (btnPrev) btnPrev.disabled = (curPage <= 1);
    if (btnNext) btnNext.disabled = (curPage >= totalPages);
    if (btnLast) btnLast.disabled = (curPage >= totalPages);
}

function syncPopupMemory() {
    const win = popupWindows.memory;
    if (!win || win.closed) return;
    const popupMem = win.document.getElementById('popup-memory-area');
    if (popupMem) {
        popupMem.innerHTML = buildMemoryItemsHtml();
    }
}

function syncPopupCmdline() {
    const win = popupWindows.cmdline;
    if (!win || win.closed) return;
    const popupLog = win.document.getElementById('popup-cmdline-log');
    const mainLog = document.getElementById('cmdline-log');
    if (popupLog && mainLog) {
        popupLog.innerHTML = mainLog.innerHTML;
        popupLog.scrollTop = popupLog.scrollHeight;
    }
}

function syncSpecificPopup(type) {
    if (type === 'code') syncPopupCode();
    else if (type === 'input') syncPopupInput();
    else if (type === 'output') syncPopupOutput();
    else if (type === 'memory') syncPopupMemory();
    else if (type === 'cmdline') syncPopupCmdline();
}