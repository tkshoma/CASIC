// ==========================================
// CASIC Canvas 描画エンジン (casic-canvas.js)
// ==========================================

const casicCanvas = (function() {
    let windowEl = null;
    let headerEl = null;
    let canvasEl = null;
    let ctx = null;
    let offscreenCanvas = null;
    let offCtx = null;
    
    let canvasWidth = 480;
    let canvasHeight = 360;
    let isAntiAlias = true;
    let isFullscreen = false;

    let isDragging = false;
    let dragStartX = 0, dragStartY = 0, winStartX = 0, winStartY = 0;
    let isCanvasDragging = false;

    function init() {
        windowEl = document.getElementById('canvas-floating-window');
        headerEl = document.getElementById('canvas-floating-header');
        canvasEl = document.getElementById('casic-main-canvas');
        if (!windowEl || !headerEl || !canvasEl) return;

        ctx = canvasEl.getContext('2d', { alpha: false });
        offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = canvasWidth;
        offscreenCanvas.height = canvasHeight;
        offCtx = offscreenCanvas.getContext('2d', { alpha: false });
        
        resetCanvasState();

        headerEl.addEventListener('pointerdown', function(e) { if (e.button !== 0 || isFullscreen) return; startDrag(e); });
        canvasEl.addEventListener('pointerdown', function(e) { if (e.button !== 2 || isFullscreen) return; isCanvasDragging = true; startDrag(e); canvasEl.style.cursor = 'grabbing'; });
        document.addEventListener('pointermove', onDragMove);
        document.addEventListener('pointerup', onDragEnd);
        canvasEl.addEventListener('contextmenu', e => e.preventDefault());

        const fsBtn = document.getElementById('btn-canvas-fullscreen');
        if (fsBtn) fsBtn.addEventListener('click', toggleFullscreen);
        document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && isFullscreen) toggleFullscreen(); });
    }

    function startDrag(e) {
        isDragging = true;
        dragStartX = e.clientX; dragStartY = e.clientY;
        const rect = windowEl.getBoundingClientRect();
        winStartX = rect.left; winStartY = rect.top;
        e.preventDefault();
    }

    function onDragMove(e) {
        if (!isDragging) return;
        const dx = e.clientX - dragStartX, dy = e.clientY - dragStartY;
        let newX = winStartX + dx, newY = winStartY + dy;
        const maxX = window.innerWidth - 40, maxY = window.innerHeight - 40;
        
        if (newX > maxX) newX = maxX;
        if (newY > maxY) newY = maxY;
        if (newX < -windowEl.offsetWidth + 40) newX = -windowEl.offsetWidth + 40;
        if (newY < 0) newY = 0;

        windowEl.style.left = newX + 'px';
        windowEl.style.top = newY + 'px';
    }

    function onDragEnd() {
        if (isDragging) isDragging = false;
        if (isCanvasDragging) { isCanvasDragging = false; canvasEl.style.cursor = 'default'; }
    }

    function toggleVisibility() {
        if (!windowEl) init();
        if (!windowEl) return;
        if (windowEl.classList.contains('hidden')) {
            windowEl.classList.remove('hidden');
            if (!isFullscreen) {
                const rect = windowEl.getBoundingClientRect();
                const cx = Math.max(10, (window.innerWidth - rect.width) / 2);
                const cy = Math.max(10, (window.innerHeight - rect.height) / 2);
                windowEl.style.left = cx + 'px'; windowEl.style.top = cy + 'px';
            }
        } else {
            windowEl.classList.add('hidden');
            if (isFullscreen) toggleFullscreen();
        }
    }

    function show() {
        if (!windowEl) init();
        if (windowEl && windowEl.classList.contains('hidden')) toggleVisibility();
    }

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
            canvasEl.style.width = ''; 
            canvasEl.style.height = '';
        }
        updateVisualScale();
    }
    
    function adjustCanvasScale() {
        if (!isFullscreen || !canvasEl) return;
        const winWidth = window.innerWidth;
        const winHeight = window.innerHeight;
        const scale = Math.min(winWidth / canvasWidth, winHeight / canvasHeight);
        
        canvasEl.style.transformOrigin = 'center center';
        canvasEl.style.transform = `scale(${scale})`;
        
        // CSSのscaleで拡大するため、元の物理サイズは維持する
        canvasEl.style.width = canvasWidth + 'px';
        canvasEl.style.height = canvasHeight + 'px';
    }

    // ★新規追加: 解像度が10x10等の時に、UIが極小になって操作できなくなるのを防ぐ
    function updateVisualScale() {
        if (!canvasEl) return;
        if (isFullscreen) return; // 全画面時はスケール変形が優先
        
        // 少なくとも240pxの操作領域を確保
        const MIN_SIZE = 240;
        let displayW = canvasWidth;
        let displayH = canvasHeight;
        
        if (canvasWidth < MIN_SIZE || canvasHeight < MIN_SIZE) {
            const scale = Math.max(MIN_SIZE / canvasWidth, MIN_SIZE / canvasHeight);
            displayW = Math.round(canvasWidth * scale);
            displayH = Math.round(canvasHeight * scale);
        }
        
        canvasEl.style.width = displayW + 'px';
        canvasEl.style.height = displayH + 'px';
    }

    // ★新規追加: ぼやけ対策 (Canvasサイズが小さい時、または g_smooth false の時はくっきり表示する)
    function updateImageRendering() {
        const isSmall = (canvasWidth <= 240 || canvasHeight <= 240);
        const renderStyle = (!isAntiAlias || isSmall) ? 'pixelated' : 'auto';
        
        if (canvasEl) {
            canvasEl.style.imageRendering = renderStyle;
        }
        // 別窓側のキャンバスにも適用
        if (typeof popupWindows !== 'undefined' && popupWindows.canvas && !popupWindows.canvas.closed) {
            const pCanv = popupWindows.canvas.document.getElementById('popup-canvas');
            if (pCanv) pCanv.style.imageRendering = renderStyle;
        }
    }

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
        
        if (canvasEl) { canvasEl.width = canvasWidth; canvasEl.height = canvasHeight; }
        if (offscreenCanvas) { offscreenCanvas.width = canvasWidth; offscreenCanvas.height = canvasHeight; }
        
        const titleEl = document.getElementById('canvas-title');
        if (titleEl) titleEl.textContent = 'Canvas (' + canvasWidth + 'x' + canvasHeight + ')';
        
        if (isFullscreen) {
            adjustCanvasScale();
        }
        updateVisualScale();
        updateImageRendering();
        
        clear('#ffffff');
        flush();
    }

    function setSmooth(isSmooth) {
        isAntiAlias = !!isSmooth;
        if (offCtx) offCtx.imageSmoothingEnabled = isAntiAlias;
        if (ctx) ctx.imageSmoothingEnabled = isAntiAlias;
        updateImageRendering();
    }

    function clear(colorStr) {
        if (!offCtx) return;
        offCtx.save();
        offCtx.fillStyle = colorStr || '#ffffff';
        offCtx.fillRect(0, 0, canvasWidth, canvasHeight);
        offCtx.restore();
    }

    function flush() {
        if (!ctx || !offscreenCanvas) return;
        ctx.drawImage(offscreenCanvas, 0, 0);
        
        if (typeof syncPopupCanvas === 'function') syncPopupCanvas();
        updateImageRendering();
    }

    function transformY(casicY) { return canvasHeight - casicY; }

    function getPixelColorHex(x, y) {
        if (!offCtx) return "#ffffff"; // デフォルトを白に修正
        const cx = Math.trunc(x);
        const cy = Math.trunc(transformY(y));
        if (cx < 0 || cx >= canvasWidth || cy < 0 || cy >= canvasHeight) return "#ffffff";
        
        const pixel = offCtx.getImageData(cx, cy, 1, 1).data;
        const r = pixel[0].toString(16).padStart(2, '0');
        const g = pixel[1].toString(16).padStart(2, '0');
        const b = pixel[2].toString(16).padStart(2, '0');
        return '#' + r + g + b;
    }

    return {
        init: init, toggleVisibility: toggleVisibility, show: show, toggleFullscreen: toggleFullscreen,
        reset: resetCanvasState, setSize: setSize, setSmooth: setSmooth, clear: clear, flush: flush,
        transformY: transformY, getPixelColorHex: getPixelColorHex,
        getOffscreenCtx: function() { return offCtx; },
        getOffscreenCanvas: function() { return offscreenCanvas; },
        getWidth: function() { return canvasWidth; }, getHeight: function() { return canvasHeight; }
    };
})();

// DOM構築後に初期化
window.addEventListener('DOMContentLoaded', casicCanvas.init);