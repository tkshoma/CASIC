// ==========================================
// CASIC Canvas 描画エンジン (フローティングウィンドウ)
// ==========================================

const casicCanvas = (function() {
    let windowEl = null;
    let headerEl = null;
    let canvasEl = null;
    let ctx = null;
    
    // 裏バッファ（描画コマンドはこちらに書き込み、frameで表に転送する）
    let offscreenCanvas = null;
    let offCtx = null;
    
    let canvasWidth = 480;
    let canvasHeight = 360;
    let isAntiAlias = true;
    let isFullscreen = false;

    // フローティングウィンドウのドラッグ状態
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let winStartX = 0;
    let winStartY = 0;

    // Canvas領域の右ドラッグ状態（自由移動用）
    let isCanvasDragging = false;

    function init() {
        windowEl = document.getElementById('canvas-floating-window');
        headerEl = document.getElementById('canvas-floating-header');
        canvasEl = document.getElementById('casic-main-canvas');
        
        if (!windowEl || !headerEl || !canvasEl) return;

        ctx = canvasEl.getContext('2d', { alpha: false });
        
        // 裏バッファの初期化
        offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = canvasWidth;
        offscreenCanvas.height = canvasHeight;
        offCtx = offscreenCanvas.getContext('2d', { alpha: false });
        
        resetCanvasState();

        // ヘッダーでのドラッグイベント設定（左クリック）
        headerEl.addEventListener('pointerdown', function(e) {
            if (e.button !== 0 || isFullscreen) return; // 左クリック以外、または全画面時は無視
            startDrag(e);
        });
        
        // Canvas領域でのドラッグイベント設定（右クリック）
        canvasEl.addEventListener('pointerdown', function(e) {
            if (e.button !== 2 || isFullscreen) return; // 右クリック以外、または全画面時は無視
            isCanvasDragging = true;
            startDrag(e);
            canvasEl.style.cursor = 'grabbing';
        });

        // 共通のドラッグ移動・終了処理
        document.addEventListener('pointermove', onDragMove);
        document.addEventListener('pointerup', onDragEnd);
        
        // 右クリック時のコンテキストメニューを無効化（右ドラッグ用）
        canvasEl.addEventListener('contextmenu', function(e) {
            e.preventDefault();
        });

        // Canvasの全画面ボタン処理
        const fsBtn = document.getElementById('btn-canvas-fullscreen');
        if (fsBtn) {
            fsBtn.addEventListener('click', toggleFullscreen);
        }
        
        // Escapeキーで全画面解除
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && isFullscreen) {
                toggleFullscreen();
            }
        });
    }

    function startDrag(e) {
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        const rect = windowEl.getBoundingClientRect();
        winStartX = rect.left;
        winStartY = rect.top;
        e.preventDefault(); // テキスト選択などを防ぐ
    }

    function onDragMove(e) {
        if (!isDragging) return;
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        
        // 画面外に完全に消えないように制限
        let newX = winStartX + dx;
        let newY = winStartY + dy;
        const maxX = window.innerWidth - 40;
        const maxY = window.innerHeight - 40;
        
        if (newX > maxX) newX = maxX;
        if (newY > maxY) newY = maxY;
        if (newX < -windowEl.offsetWidth + 40) newX = -windowEl.offsetWidth + 40;
        if (newY < 0) newY = 0;

        windowEl.style.left = newX + 'px';
        windowEl.style.top = newY + 'px';
    }

    function onDragEnd() {
        if (isDragging) {
            isDragging = false;
        }
        if (isCanvasDragging) {
            isCanvasDragging = false;
            canvasEl.style.cursor = 'default';
        }
    }

    function toggleVisibility() {
        if (!windowEl) init();
        if (!windowEl) return;
        
        if (windowEl.classList.contains('hidden')) {
            windowEl.classList.remove('hidden');
            // 全画面モードでなければ画面中央付近に配置
            if (!isFullscreen) {
                const rect = windowEl.getBoundingClientRect();
                const cx = Math.max(10, (window.innerWidth - rect.width) / 2);
                const cy = Math.max(10, (window.innerHeight - rect.height) / 2);
                windowEl.style.left = cx + 'px';
                windowEl.style.top = cy + 'px';
            }
        } else {
            windowEl.classList.add('hidden');
            // 非表示時は全画面モードも解除
            if (isFullscreen) {
                toggleFullscreen();
            }
        }
    }

    function show() {
        if (!windowEl) init();
        if (windowEl && windowEl.classList.contains('hidden')) {
            toggleVisibility();
        }
    }

    // 全画面表示の切り替え
    function toggleFullscreen() {
        if (!windowEl) return;
        
        isFullscreen = !isFullscreen;
        
        if (isFullscreen) {
            windowEl.classList.add('canvas-fullscreen');
            adjustCanvasScale();
            window.addEventListener('resize', adjustCanvasScale);
        } else {
            windowEl.classList.remove('canvas-fullscreen');
            window.removeEventListener('resize', adjustCanvasScale);
            canvasEl.style.transform = '';
            canvasEl.style.transformOrigin = 'top left';
            windowEl.style.width = '';
            windowEl.style.height = '';
        }
    }
    
    function adjustCanvasScale() {
        if (!isFullscreen || !canvasEl) return;
        const winWidth = window.innerWidth;
        const winHeight = window.innerHeight;
        const scale = Math.min(winWidth / canvasWidth, winHeight / canvasHeight);
        
        canvasEl.style.transformOrigin = 'center center';
        canvasEl.style.transform = `scale(${scale})`;
    }

    // ぼやけ対策 (Canvasサイズが小さい時、または g_smooth false の時はくっきり表示する)
    function updateImageRendering() {
        const isSmall = (canvasWidth <= 240 || canvasHeight <= 240);
        const renderStyle = (!isAntiAlias || isSmall) ? 'pixelated' : 'auto';
        
        if (canvasEl) {
            canvasEl.style.imageRendering = renderStyle;
        }
        if (typeof popupWindows !== 'undefined' && popupWindows.canvas && !popupWindows.canvas.closed) {
            const pCanv = popupWindows.canvas.document.getElementById('popup-canvas');
            if (pCanv) pCanv.style.imageRendering = renderStyle;
        }
    }

    // --- CASIC描画API ---

    function resetCanvasState() {
        if (!offCtx) return;
        setSize(480, 360);
        setSmooth(true);
        clear('#ffffff');
        flush();
    }

    function setSize(w, h) {
        canvasWidth = Math.max(1, Math.trunc(w));
        canvasHeight = Math.max(1, Math.trunc(h));
        
        if (canvasEl) {
            canvasEl.width = canvasWidth;
            canvasEl.height = canvasHeight;
        }
        if (offscreenCanvas) {
            offscreenCanvas.width = canvasWidth;
            offscreenCanvas.height = canvasHeight;
        }
        
        const titleEl = document.getElementById('canvas-title');
        if (titleEl) {
            titleEl.textContent = 'Canvas (' + canvasWidth + 'x' + canvasHeight + ')';
        }
        
        if (isFullscreen) {
            adjustCanvasScale();
        }
        
        updateImageRendering();
        
        // サイズ変更時は画面を白紙に初期化して即座に反映する
        clear('#ffffff');
        flush();
    }

    function setSmooth(isSmooth) {
        isAntiAlias = !!isSmooth;
        if (offCtx) {
            offCtx.imageSmoothingEnabled = isAntiAlias;
        }
        if (ctx) {
            ctx.imageSmoothingEnabled = isAntiAlias;
        }
        updateImageRendering();
    }

    function clear(colorStr) {
        if (!offCtx) return;
        offCtx.save();
        offCtx.fillStyle = colorStr || '#ffffff';
        offCtx.fillRect(0, 0, canvasWidth, canvasHeight);
        offCtx.restore();
    }

    // 表のCanvasに転送 (frame命令、または実行終了時・ステップ時に呼ばれる)
    function flush() {
        if (!ctx || !offscreenCanvas) return;
        ctx.drawImage(offscreenCanvas, 0, 0);
        
        if (typeof syncPopupCanvas === 'function') {
            syncPopupCanvas();
        }
        updateImageRendering();
    }

    // 座標変換ヘルパー: 左下(0,0) → 左上(0,0)
    function transformY(casicY) {
        return canvasHeight - casicY;
    }

    // 取得用関数 (g_color用)
    function getPixelColorHex(x, y) {
        if (!offCtx) return "#ffffff"; // 真っ白をデフォルトに
        const cx = Math.trunc(x);
        const cy = Math.trunc(transformY(y));
        if (cx < 0 || cx >= canvasWidth || cy < 0 || cy >= canvasHeight) return "#ffffff";
        
        const pixel = offCtx.getImageData(cx, cy, 1, 1).data;
        const r = pixel[0].toString(16).padStart(2, '0');
        const g = pixel[1].toString(16).padStart(2, '0');
        const b = pixel[2].toString(16).padStart(2, '0');
        return '#' + r + g + b;
    }

    // --- 外部公開API ---
    return {
        init: init,
        toggleVisibility: toggleVisibility,
        show: show,
        toggleFullscreen: toggleFullscreen,
        reset: resetCanvasState,
        setSize: setSize,
        setSmooth: setSmooth,
        clear: clear,
        flush: flush,
        transformY: transformY,
        getPixelColorHex: getPixelColorHex,
        getOffscreenCtx: function() { return offCtx; },
        getOffscreenCanvas: function() { return offscreenCanvas; }, // 別窓転送用
        getWidth: function() { return canvasWidth; },
        getHeight: function() { return canvasHeight; }
    };
})();

// DOM構築後に初期化
window.addEventListener('DOMContentLoaded', casicCanvas.init);