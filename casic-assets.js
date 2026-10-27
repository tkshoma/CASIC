// ==========================================
// アセット（画像・音声・フォント・テキスト）インポート管理
// ==========================================

const casicAssets = {
    images: {}, // key(小文字ファイル名) -> { name, key, noExtKey, url, img, width, height }
    audios: {}, // key(小文字ファイル名) -> { name, key, noExtKey, url, duration }
    fonts: {},  // key(小文字ファイル名) -> { name, fontName, key, fontKey, familyName }
    texts: {}   // key(小文字ファイル名) -> { name, key, noExtKey, content, length }
};

let previewAudioElement = null;
let customFontCounter = 1;

function escapeAttrStr(str) {
    return String(str)
        .split('&').join('&amp;')
        .split('<').join('&lt;')
        .split('>').join('&gt;')
        .split('"').join('&quot;')
        .split("'").join('&#39;');
}

function stripFileExtension(filename) {
    const s = String(filename || '');
    const lastDot = s.lastIndexOf('.');
    if (lastDot <= 0) return s;
    return s.slice(0, lastDot);
}

function getFileExtensionLower(filename) {
    const s = String(filename || '');
    const lastDot = s.lastIndexOf('.');
    if (lastDot === -1) return '';
    return s.slice(lastDot + 1).toLowerCase();
}

function detectAssetCategory(file) {
    const ext = getFileExtensionLower(file.name);
    const mime = String(file.type || '').toLowerCase();

    if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].indexOf(ext) !== -1) {
        return 'image';
    }
    if (mime.startsWith('audio/') || ['wav', 'mp3', 'ogg', 'm4a', 'aac', 'flac', 'opus'].indexOf(ext) !== -1) {
        return 'audio';
    }
    if (['ttf', 'otf', 'woff', 'woff2'].indexOf(ext) !== -1 || mime.indexOf('font') !== -1) {
        return 'font';
    }
    return 'text';
}

function openImportModal() {
    renderAllAssetLists();
    const modal = document.getElementById('import-modal');
    if (modal) modal.classList.remove('hidden');
}

function closeImportModal() {
    if (previewAudioElement) {
        previewAudioElement.pause();
        previewAudioElement = null;
    }
    const modal = document.getElementById('import-modal');
    if (modal) modal.classList.add('hidden');
}

function handleImportModalOverlayClick(e) {
    if (e.target && e.target.id === 'import-modal') {
        closeImportModal();
    }
}

function triggerAssetFileInput(category) {
    const idMap = {
        all: 'asset-file-all',
        image: 'asset-file-image',
        audio: 'asset-file-audio',
        font: 'asset-file-font',
        text: 'asset-file-text'
    };
    const inputEl = document.getElementById(idMap[category]);
    if (inputEl) inputEl.click();
}

function handleAssetFilesSelected(fileList, forcedCategory) {
    if (!fileList || fileList.length === 0) return;

    for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        const category = (forcedCategory && forcedCategory !== 'auto')
            ? forcedCategory
            : detectAssetCategory(file);

        if (category === 'image') importImageFile(file);
        else if (category === 'audio') importAudioFile(file);
        else if (category === 'font') importFontFile(file);
        else importTextFile(file);
    }
}

function importImageFile(file) {
    const key = file.name.toLowerCase();
    if (casicAssets.images[key] && casicAssets.images[key].url) {
        URL.revokeObjectURL(casicAssets.images[key].url);
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    const entry = {
        name: file.name,
        key: key,
        noExtKey: stripFileExtension(file.name).toLowerCase(),
        url: url,
        img: img,
        width: 0,
        height: 0
    };
    casicAssets.images[key] = entry;

    img.onload = function() {
        entry.width = img.naturalWidth || img.width;
        entry.height = img.naturalHeight || img.height;
        renderAssetTier('image');
    };
    img.src = url;
    renderAssetTier('image');
}

function importAudioFile(file) {
    const key = file.name.toLowerCase();
    if (casicAssets.audios[key] && casicAssets.audios[key].url) {
        URL.revokeObjectURL(casicAssets.audios[key].url);
    }
    const url = URL.createObjectURL(file);
    const tempAudio = new Audio();
    const entry = {
        name: file.name,
        key: key,
        noExtKey: stripFileExtension(file.name).toLowerCase(),
        url: url,
        duration: 0
    };
    casicAssets.audios[key] = entry;

    tempAudio.addEventListener('loadedmetadata', function() {
        if (Number.isFinite(tempAudio.duration)) {
            entry.duration = Math.round(tempAudio.duration * 10) / 10;
            renderAssetTier('audio');
        }
    });
    tempAudio.src = url;
    renderAssetTier('audio');
}

function importFontFile(file) {
    const key = file.name.toLowerCase();
    const fontName = stripFileExtension(file.name);
    const fontKey = fontName.toLowerCase();
    const familyName = 'CasicCustomFont_' + (customFontCounter++);

    const reader = new FileReader();
    reader.onload = function(e) {
        const arrayBuffer = e.target.result;
        if (typeof FontFace !== 'undefined') {
            const fontFace = new FontFace(familyName, arrayBuffer);
            fontFace.load().then(function(loadedFace) {
                document.fonts.add(loadedFace);
                casicAssets.fonts[key] = {
                    name: file.name,
                    fontName: fontName,
                    key: key,
                    fontKey: fontKey,
                    familyName: familyName
                };
                renderAssetTier('font');
            }).catch(function(err) {
                alert('フォント "' + file.name + '" の読み込みに失敗しました: ' + err.message);
            });
        }
    };
    reader.readAsArrayBuffer(file);
}

function importTextFile(file) {
    const key = file.name.toLowerCase();
    const reader = new FileReader();
    reader.onload = function(e) {
        const content = String(e.target.result || '');
        casicAssets.texts[key] = {
            name: file.name,
            key: key,
            noExtKey: stripFileExtension(file.name).toLowerCase(),
            content: content,
            length: Array.from(content).length
        };
        renderAssetTier('text');
    };
    reader.readAsText(file, 'UTF-8');
}

// インポート後のアセット名変更（リネーム）処理
function renameImportedAsset(category, oldKey, rawNewName) {
    const trimmed = cleanText(rawNewName);
    if (!trimmed) {
        renderAssetTier(category);
        return;
    }

    const storeMap = {
        image: casicAssets.images,
        audio: casicAssets.audios,
        font: casicAssets.fonts,
        text: casicAssets.texts
    };
    const store = storeMap[category];
    if (!store || !store[oldKey]) return;

    const entry = store[oldKey];

    // フォントの場合：拡張子を除いたフォント名としてリネーム
    if (category === 'font') {
        const newFontName = stripFileExtension(trimmed);
        const newFontKey = newFontName.toLowerCase();
        const origExt = getFileExtensionLower(entry.name);
        const newFullName = origExt ? (newFontName + '.' + origExt) : newFontName;
        const newKey = newFullName.toLowerCase();

        if (newKey !== oldKey && store[newKey]) {
            alert('同じ名前のフォント "' + newFontName + '" が既に存在します。');
            renderAssetTier(category);
            return;
        }

        delete store[oldKey];
        entry.name = newFullName;
        entry.fontName = newFontName;
        entry.key = newKey;
        entry.fontKey = newFontKey;
        store[newKey] = entry;
        renderAssetTier(category);
        return;
    }

    // 画像・音声・テキストの場合：拡張子を省略して入力されたら元の拡張子を自動で補う
    const origExt = getFileExtensionLower(entry.name);
    const hasNewExt = trimmed.indexOf('.') !== -1;
    const finalName = (!hasNewExt && origExt) ? (trimmed + '.' + origExt) : trimmed;
    const newKey = finalName.toLowerCase();

    if (newKey === oldKey) {
        entry.name = finalName;
        renderAssetTier(category);
        return;
    }

    if (store[newKey]) {
        alert('同じ名前のファイル "' + finalName + '" が既に存在します。');
        renderAssetTier(category);
        return;
    }

    delete store[oldKey];
    entry.name = finalName;
    entry.key = newKey;
    entry.noExtKey = stripFileExtension(finalName).toLowerCase();
    store[newKey] = entry;
    renderAssetTier(category);
}

function handleAssetNameKeyDown(e, inputEl) {
    if (e.isComposing) return;
    if (e.key === 'Enter') {
        e.preventDefault();
        inputEl.blur();
    } else if (e.key === 'Escape') {
        e.preventDefault();
        const cat = inputEl.getAttribute('data-cat');
        renderAssetTier(cat);
    }
}

function handleAssetNameCommit(inputEl) {
    const cat = inputEl.getAttribute('data-cat');
    const oldKey = inputEl.getAttribute('data-key');
    renameImportedAsset(cat, oldKey, inputEl.value);
}

function handleAssetDeleteByBtn(btnEl) {
    const cat = btnEl.getAttribute('data-cat');
    const key = btnEl.getAttribute('data-key');
    removeImportedAsset(cat, key);
}

function handleAssetPlayByBtn(btnEl) {
    const key = btnEl.getAttribute('data-key');
    togglePreviewAudio(key);
}

function removeImportedAsset(category, key) {
    if (category === 'image' && casicAssets.images[key]) {
        URL.revokeObjectURL(casicAssets.images[key].url);
        delete casicAssets.images[key];
    } else if (category === 'audio' && casicAssets.audios[key]) {
        URL.revokeObjectURL(casicAssets.audios[key].url);
        delete casicAssets.audios[key];
    } else if (category === 'font' && casicAssets.fonts[key]) {
        delete casicAssets.fonts[key];
    } else if (category === 'text' && casicAssets.texts[key]) {
        delete casicAssets.texts[key];
    }
    renderAssetTier(category);
}

function clearAllImportedAssets() {
    Object.keys(casicAssets.images).forEach(function(k) {
        URL.revokeObjectURL(casicAssets.images[k].url);
    });
    Object.keys(casicAssets.audios).forEach(function(k) {
        URL.revokeObjectURL(casicAssets.audios[k].url);
    });
    casicAssets.images = {};
    casicAssets.audios = {};
    casicAssets.fonts = {};
    casicAssets.texts = {};
    renderAllAssetLists();
}

function togglePreviewAudio(key) {
    const item = casicAssets.audios[key];
    if (!item) return;
    if (previewAudioElement) {
        previewAudioElement.pause();
        if (previewAudioElement.dataset.key === key) {
            previewAudioElement = null;
            return;
        }
    }
    previewAudioElement = new Audio(item.url);
    previewAudioElement.dataset.key = key;
    previewAudioElement.play().catch(function() {});
}

function renderAssetTier(category) {
    if (category === 'image') {
        const listEl = document.getElementById('asset-list-image');
        const countEl = document.getElementById('count-asset-image');
        const keys = Object.keys(casicAssets.images);
        if (countEl) countEl.textContent = '(' + keys.length + ')';
        if (!listEl) return;

        if (keys.length === 0) {
            listEl.innerHTML = '<div class="asset-empty">インポートされた画像はありません (例: thonk.png)</div>';
            return;
        }
        let html = '';
        for (let i = 0; i < keys.length; i++) {
            const item = casicAssets.images[keys[i]];
            const sizeStr = (item.width > 0) ? (item.width + ' × ' + item.height + ' px') : 'サイズ取得中...';
            html +=
                '<div class="asset-card" style="width:180px; min-width:180px; max-width:180px; height:100%; overflow:hidden;">' +
                    '<div class="asset-card-top">' +
                        '<input type="text" class="asset-name-input" value="' + escapeAttrStr(item.name) + '" data-cat="image" data-key="' + escapeAttrStr(item.key) + '" title="クリックして名前を変更 (Enterで確定)" onkeydown="handleAssetNameKeyDown(event, this)" onchange="handleAssetNameCommit(this)">' +
                        '<button class="asset-del-btn" data-cat="image" data-key="' + escapeAttrStr(item.key) + '" onclick="handleAssetDeleteByBtn(this)" title="削除">×</button>' +
                    '</div>' +
                    '<div class="asset-preview-box" style="position:relative; width:100%; flex:1; min-height:0; overflow:hidden;">' +
                        '<img src="' + item.url + '" alt="' + escapeAttrStr(item.name) + '" style="position:absolute; top:4px; left:4px; width:calc(100% - 8px); height:calc(100% - 8px); object-fit:contain; display:block;">' +
                    '</div>' +
                    '<div class="asset-card-meta">' +
                        '<span class="asset-meta-type">サイズ</span>' +
                        '<span class="asset-meta-size">' + sizeStr + '</span>' +
                    '</div>' +
                '</div>';
        }
        listEl.innerHTML = html;
    } else if (category === 'audio') {
        const listEl = document.getElementById('asset-list-audio');
        const countEl = document.getElementById('count-asset-audio');
        const keys = Object.keys(casicAssets.audios);
        if (countEl) countEl.textContent = '(' + keys.length + ')';
        if (!listEl) return;

        if (keys.length === 0) {
            listEl.innerHTML = '<div class="asset-empty">インポートされた音声はありません (例: pop.wav)</div>';
            return;
        }
        let html = '';
        for (let i = 0; i < keys.length; i++) {
            const item = casicAssets.audios[keys[i]];
            const durStr = (item.duration > 0) ? (item.duration + ' 秒') : '音声';
            html +=
                '<div class="asset-card" style="width:180px; min-width:180px; max-width:180px; height:100%; overflow:hidden;">' +
                    '<div class="asset-card-top">' +
                        '<input type="text" class="asset-name-input" value="' + escapeAttrStr(item.name) + '" data-cat="audio" data-key="' + escapeAttrStr(item.key) + '" title="クリックして名前を変更 (Enterで確定)" onkeydown="handleAssetNameKeyDown(event, this)" onchange="handleAssetNameCommit(this)">' +
                        '<button class="asset-del-btn" data-cat="audio" data-key="' + escapeAttrStr(item.key) + '" onclick="handleAssetDeleteByBtn(this)" title="削除">×</button>' +
                    '</div>' +
                    '<div class="asset-preview-box">' +
                        '<button class="asset-play-btn" data-key="' + escapeAttrStr(item.key) + '" onclick="handleAssetPlayByBtn(this)">▶ 試聴 / 停止</button>' +
                    '</div>' +
                    '<div class="asset-card-meta">' +
                        '<span class="asset-meta-type">長さ</span>' +
                        '<span class="asset-meta-size">' + durStr + '</span>' +
                    '</div>' +
                '</div>';
        }
        listEl.innerHTML = html;
    } else if (category === 'font') {
        const listEl = document.getElementById('asset-list-font');
        const countEl = document.getElementById('count-asset-font');
        const keys = Object.keys(casicAssets.fonts);
        if (countEl) countEl.textContent = '(' + keys.length + ')';
        if (!listEl) return;

        if (keys.length === 0) {
            listEl.innerHTML = '<div class="asset-empty">インポートされたフォントはありません (.ttf等 / 拡張子なしで指定可)</div>';
            return;
        }
        let html = '';
        for (let i = 0; i < keys.length; i++) {
            const item = casicAssets.fonts[keys[i]];
            html +=
                '<div class="asset-card" style="width:180px; min-width:180px; max-width:180px; height:100%; overflow:hidden;">' +
                    '<div class="asset-card-top">' +
                        '<input type="text" class="asset-name-input" value="' + escapeAttrStr(item.fontName) + '" data-cat="font" data-key="' + escapeAttrStr(item.key) + '" title="クリックしてフォント名を変更 (Enterで確定)" onkeydown="handleAssetNameKeyDown(event, this)" onchange="handleAssetNameCommit(this)">' +
                        '<button class="asset-del-btn" data-cat="font" data-key="' + escapeAttrStr(item.key) + '" onclick="handleAssetDeleteByBtn(this)" title="削除">×</button>' +
                    '</div>' +
                    '<div class="asset-preview-box">' +
                        '<span class="asset-font-sample" style="font-family: \'' + item.familyName + '\', sans-serif;">あいうABC123</span>' +
                    '</div>' +
                    '<div class="asset-card-meta">' +
                        '<span class="asset-meta-type">指定名</span>' +
                        '<span class="asset-meta-size">' + escapeHtml(item.fontName) + '</span>' +
                    '</div>' +
                '</div>';
        }
        listEl.innerHTML = html;
    } else if (category === 'text') {
        const listEl = document.getElementById('asset-list-text');
        const countEl = document.getElementById('count-asset-text');
        const keys = Object.keys(casicAssets.texts);
        if (countEl) countEl.textContent = '(' + keys.length + ')';
        if (!listEl) return;

        if (keys.length === 0) {
            listEl.innerHTML = '<div class="asset-empty">インポートされたテキストはありません (.txt, .csv, .json等)</div>';
            return;
        }
        let html = '';
        for (let i = 0; i < keys.length; i++) {
            const item = casicAssets.texts[keys[i]];
            const previewSnippet = item.content.slice(0, 80);
            html +=
                '<div class="asset-card" style="width:180px; min-width:180px; max-width:180px; height:100%; overflow:hidden;">' +
                    '<div class="asset-card-top">' +
                        '<input type="text" class="asset-name-input" value="' + escapeAttrStr(item.name) + '" data-cat="text" data-key="' + escapeAttrStr(item.key) + '" title="クリックして名前を変更 (Enterで確定)" onkeydown="handleAssetNameKeyDown(event, this)" onchange="handleAssetNameCommit(this)">' +
                        '<button class="asset-del-btn" data-cat="text" data-key="' + escapeAttrStr(item.key) + '" onclick="handleAssetDeleteByBtn(this)" title="削除">×</button>' +
                    '</div>' +
                    '<div class="asset-preview-box">' +
                        '<div class="asset-text-sample">' + escapeHtml(previewSnippet) + '</div>' +
                    '</div>' +
                    '<div class="asset-card-meta">' +
                        '<span class="asset-meta-type">文字数</span>' +
                        '<span class="asset-meta-size">' + item.length.toLocaleString() + ' 文字</span>' +
                    '</div>' +
                '</div>';
        }
        listEl.innerHTML = html;
    }
}

function renderAllAssetLists() {
    renderAssetTier('image');
    renderAssetTier('audio');
    renderAssetTier('font');
    renderAssetTier('text');
}

// ==========================================
// 描画・音声・テキスト関数から呼び出すための検索ヘルパー
// ==========================================

function getImportedImage(name) {
    const key = cleanText(name).toLowerCase();
    if (casicAssets.images[key]) return casicAssets.images[key];
    const keys = Object.keys(casicAssets.images);
    for (let i = 0; i < keys.length; i++) {
        if (casicAssets.images[keys[i]].noExtKey === key) {
            return casicAssets.images[keys[i]];
        }
    }
    return null;
}

function getImportedAudio(name) {
    const key = cleanText(name).toLowerCase();
    if (casicAssets.audios[key]) return casicAssets.audios[key];
    const keys = Object.keys(casicAssets.audios);
    for (let i = 0; i < keys.length; i++) {
        if (casicAssets.audios[keys[i]].noExtKey === key) {
            return casicAssets.audios[keys[i]];
        }
    }
    return null;
}

function resolveCasicFontFamily(rawFontName) {
    const f = cleanText(rawFontName).toLowerCase();
    if (f === '' || f === 'sans-serif') return 'sans-serif';
    if (f === 'monospace' || f === 'serif' || f === 'cursive') return f;
    if (f === 'pixel' || f === 'dotgothic16') return '"DotGothic16", sans-serif';
    if (f === 'marugo' || f === 'zen maru gothic') return '"Zen Maru Gothic", sans-serif';

    if (casicAssets.fonts[f]) {
        return '"' + casicAssets.fonts[f].familyName + '", sans-serif';
    }
    const keys = Object.keys(casicAssets.fonts);
    for (let i = 0; i < keys.length; i++) {
        const entry = casicAssets.fonts[keys[i]];
        if (entry.fontKey === f) {
            return '"' + entry.familyName + '", sans-serif';
        }
    }
    return rawFontName;
}

function getImportedText(name) {
    const key = cleanText(name).toLowerCase();
    if (casicAssets.texts[key]) return casicAssets.texts[key].content;
    const keys = Object.keys(casicAssets.texts);
    for (let i = 0; i < keys.length; i++) {
        if (casicAssets.texts[keys[i]].noExtKey === key) {
            return casicAssets.texts[keys[i]].content;
        }
    }
    return "";
}

window.addEventListener('DOMContentLoaded', function() {
    const dropZone = document.getElementById('import-drop-zone');
    if (!dropZone) return;

    dropZone.addEventListener('dragover', function(e) {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', function(e) {
        dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', function(e) {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer && e.dataTransfer.files) {
            handleAssetFilesSelected(e.dataTransfer.files, 'auto');
        }
    });
});