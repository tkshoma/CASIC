// ==========================================
// ポップアップウィンドウ（別窓）の生成と同期処理
// ==========================================

const popupWindows = {
    input: null,
    output: null,
    memory: null,
    cmdline: null
};

const popupFontSizes = {
    input: 18,
    output: 18,
    memory: 15,
    cmdline: 15
};

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
        memory: 'CASIC - Memory (メモリ可視化)',
        cmdline: 'CASIC - Command Line (コマンドライン・エラーログ)'
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
    } else if (type === 'cmdline') {
        extraControlsHtml =
            '<label class="wrap-label"><input type="checkbox" id="chk-wrap" checked> 端で折り返す</label>' +
            '<button id="btn-clear-cmdline" class="action-btn clear-btn">ログクリア</button>';
    }

    let bodyContentHtml = '';
    if (type === 'input') {
        bodyContentHtml = '<textarea id="popup-input-area" spellcheck="false" placeholder="ここに入力データを書く..."></textarea>';
    } else if (type === 'output') {
        bodyContentHtml = '<div id="popup-output-area" class="popup-output-area"></div>';
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
        '.run-cmd-btn { background-color: #007acc; width: 80px; height: 100%; font-size: 15px; }' +
        '.run-cmd-btn:hover { background-color: #005f9e; }' +
        '.clear-btn { background-color: #555; font-weight: normal; font-size: 12px; }' +
        '.clear-btn:hover { background-color: #777; }' +
        '.update-msg { font-size: 12px; color: #4ec9b0; font-weight: bold; }' +
        '#popup-input-area { flex: 1; width: 100%; resize: none; background: #1e1e1e; color: #d4d4d4; border: 1px solid #444; border-radius: 4px; padding: 12px; box-sizing: border-box; font-family: var(--vscode-font); font-size: var(--content-font-size); line-height: 1.5; white-space: pre-wrap; overflow: auto; outline: none; }' +
        '#popup-input-area:focus { border-color: #007acc; }' +
        '.popup-output-area { flex: 1; width: 100%; background: #1e1e1e; color: #d4d4d4; border: 1px solid #444; border-radius: 4px; padding: 12px; box-sizing: border-box; font-family: var(--vscode-font); font-size: var(--content-font-size); line-height: 1.45; white-space: pre-wrap; word-break: break-all; overflow: auto; }' +
        '.popup-cmd-row { display: flex; gap: 8px; height: 90px; flex-shrink: 0; }' +
        '#popup-cmdline-input { flex: 1; resize: none; background: #252526; color: #d4d4d4; border: 1px solid #555; border-radius: 4px; padding: 8px 10px; font-family: var(--vscode-font); font-size: var(--content-font-size); line-height: 1.4; outline: none; }' +
        '#popup-cmdline-input:focus { border-color: #007acc; }' +
        '.error-text { color: #ff6b6b; }' +
        '.warn-text { color: #dcdcaa; }' +
        '.info-text { color: #4fc1ff; }' +
        '.cmd-echo-text { color: #888; }' +
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
        if (clearBtn) {
            clearBtn.addEventListener('click', function() {
                clearOutputOnly();
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
    if (type === 'input') syncPopupInput();
    else if (type === 'output') syncPopupOutput();
    else if (type === 'memory') syncPopupMemory();
    else if (type === 'cmdline') syncPopupCmdline();
}