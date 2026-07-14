/*!
 * Media Library - app.js
 * オフラインで動作する漫画・音声・動画ライブラリ (フォルダ直接読み込み版)
 * Licensed under the MIT License. See LICENSE file in the project root.
 *
 * Third-party libraries (bundled locally in lib/, see credit.html for licenses):
 *   Alpine.js (MIT), @alpinejs/intersect (MIT), Dexie.js (Apache-2.0),
 *   zip.js (BSD-3-Clause), Lodash (MIT), Howler.js (MIT),
 *   PDF.js (Apache-2.0), Swiper (MIT)
 * Inline SVG icons are based on Feather Icons (MIT).
 *
 * Android (html2apk) では window.H2A ブリッジ経由で SAF 選択フォルダを読み込み、
 * PCブラウザでは File System Access API (showDirectoryPicker) を使用する。
 */

pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
// file:// (APK内) では Web Worker が使えないためメインスレッドで動かす。
// chunkSize を大きめにしてブリッジ越しの読み込み回数を減らす
zip.configure({ useWebWorkers: false, chunkSize: 4 * 1024 * 1024 });

const ICONS={
    book:'<svg viewBox="0 0 24 24" class="svg-icon"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>',
    audio:'<svg viewBox="0 0 24 24" class="svg-icon"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>',
    folder:'<svg viewBox="0 0 24 24" class="svg-icon-fill"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
    file_audio:'<svg viewBox="0 0 24 24" class="svg-icon"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>',
    file_image:'<svg viewBox="0 0 24 24" class="svg-icon"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>',
    file_video:'<svg viewBox="0 0 24 24" class="svg-icon"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>',
    text: '<svg viewBox="0 0 24 24" class="svg-icon"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>'
};
const IMG_REGEX = /\.(jpg|jpeg|png|gif|webp)$/i;
const BOOK_REGEX = /\.(zip|cbz|pdf)$/i;
const AUDIO_EXT_REGEX = /\.(mp3|wav|ogg|m4a|flac|aac)$/i;
const VIDEO_EXT_REGEX = /\.(mp4|webm|m4v)$/i;
const MEDIA_ENTRY_REGEX = /\.(mp3|wav|ogg|m4a|flac|aac|mp4|webm|m4v)$/i;
const SCAN_MAX_DEPTH = 4;

const MIME_MAP = {
    mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg', m4a:'audio/mp4', flac:'audio/flac', aac:'audio/aac',
    mp4:'video/mp4', webm:'video/webm', m4v:'video/x-m4v',
    zip:'application/zip', cbz:'application/zip', pdf:'application/pdf',
    jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif', webp:'image/webp'
};
function extOf(name) { return (name.split('.').pop() || '').toLowerCase(); }
function mimeOf(name) { return MIME_MAP[extOf(name)] || 'application/octet-stream'; }

function createZipReader(blob) {
    return new zip.ZipReader(new zip.BlobReader(blob), { filenameEncoding: 'shift-jis' });
}

function base64ToBlob(b64, mime) {
    const bin = atob(b64);
    const len = bin.length;
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime || 'application/octet-stream' });
}

// data: URL 経由のネイティブデコード(atobループより大幅に速い)。失敗時はJS実装へ
async function base64ToBlobAsync(b64, mime) {
    try {
        const resp = await fetch('data:' + (mime || 'application/octet-stream') + ';base64,' + b64);
        return await resp.blob();
    } catch (e) {
        return base64ToBlob(b64, mime);
    }
}

// パスからキャッシュディレクトリ名を作るための軽量ハッシュ
function pathHash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h.toString(36);
}

// IndexedDB: サムネイル・PDF変換結果のキャッシュ、フォルダハンドル(ブラウザ用)の保存
const DB_NAME = 'MediaLibDB_v70';
const db = new Dexie(DB_NAME);
db.version(1).stores({ files: '', kv: '' });

/* ==========================================================================
 * FS: フォルダアクセス層
 *   - h2a     : html2apk のネイティブブリッジ (ストレージモード「選択フォルダ(SAF)」)
 *   - browser : File System Access API (Chrome/Edge、開発・動作確認用)
 * パスはすべて選択フォルダからの相対パス('sub/dir/file.zip')
 *
 * 注意: html2apk は window.H2A を「ファイルAPI」設定に関係なく注入するが、
 * 実体の window.H2ANative は「ファイルAPI = ON」のときだけ存在する。
 * また window.H2A はページ読み込み完了後に注入されるため、
 * 起動直後から存在する H2ANative を直接使って呼び出す。
 * ========================================================================== */
function h2aAvailable() { return !!(window.H2ANative && typeof window.H2ANative.call === 'function'); }

function h2aCall(method, args) {
    return new Promise((resolve, reject) => {
        if (!h2aAvailable()) {
            reject(new Error('ネイティブブリッジ(H2ANative)が見つかりません。html2apk のビルド設定で「ファイルAPI」を ON にしてください。'));
            return;
        }
        try {
            const result = JSON.parse(window.H2ANative.call(method, JSON.stringify(args || [])));
            result.ok ? resolve(result.value) : reject(new Error(result.error));
        } catch (e) { reject(e); }
    });
}

// zip.js 用のカスタムReader: ネイティブのランダムアクセスAPI経由で
// 必要なバイト範囲だけを読む。ZIP全体を転送せずに目次と表示中のページだけ読める。
class H2ARandomReader extends zip.Reader {
    constructor(id, size) { super(); this.id = id; this.size = size; }
    init() {}
    async readUint8Array(index, length) {
        const b64 = await h2aCall('readRandom', [this.id, index, length]);
        if (!b64) return new Uint8Array(0);
        const blob = await base64ToBlobAsync(b64);
        return new Uint8Array(await blob.arrayBuffer());
    }
}

const FS = {
    mode: null,
    dirHandle: null,

    init() {
        // H2ANative はWebView生成時に注入されるため起動直後から検出できる。
        // window.H2A しか無い場合(=ファイルAPI OFFビルド)も 'h2a' とみなし、
        // 呼び出し時に分かりやすいエラーを出す。
        if (window.H2ANative || window.H2A || navigator.userAgent.includes('; wv')) this.mode = 'h2a';
        else if (window.showDirectoryPicker) this.mode = 'browser';
        else this.mode = null;
        return this.mode;
    },

    // 前回のフォルダをそのまま使えるか(権限が残っているか)
    async restore() {
        if (this.mode === 'h2a') {
            try { await h2aCall('list', ['saf:']); return true; } catch (e) { return false; }
        }
        if (this.mode === 'browser') {
            try {
                const h = await db.kv.get('dirHandle');
                if (!h) return false;
                this.dirHandle = h;
                return (await h.queryPermission({ mode: 'read' })) === 'granted';
            } catch (e) { return false; }
        }
        return false;
    },

    // フォルダ選択(要ユーザー操作)。forceNew=true で必ず選択ダイアログを出す
    // 成功: true / キャンセル: false / 設定ミス等: Error を throw
    async pickFolder(forceNew) {
        if (this.mode === 'h2a') {
            return new Promise((resolve, reject) => {
                const handler = (e) => {
                    window.removeEventListener('h2astorage', handler);
                    const d = e.detail || {};
                    if (d.mode && d.mode !== 'saf') {
                        reject(new Error('ストレージモードが「選択フォルダ(SAF)」ではありません (現在: ' + d.mode + ')。\nhtml2apk のビルド設定で「選択フォルダ」を選んで再ビルドしてください。'));
                        return;
                    }
                    resolve(!!d.granted);
                };
                window.addEventListener('h2astorage', handler);
                h2aCall('requestStorage').catch((err) => {
                    window.removeEventListener('h2astorage', handler);
                    reject(err);
                });
            });
        }
        if (this.mode === 'browser') {
            if (!forceNew && this.dirHandle) {
                try {
                    if ((await this.dirHandle.requestPermission({ mode: 'read' })) === 'granted') return true;
                } catch (e) {}
            }
            try {
                this.dirHandle = await window.showDirectoryPicker();
                await db.kv.put(this.dirHandle, 'dirHandle');
                return true;
            } catch (e) { return false; } // キャンセル
        }
        throw new Error('この環境ではフォルダアクセスが利用できません。');
    },

    async _browserDir(path) {
        let dir = this.dirHandle;
        if (!path) return dir;
        for (const seg of path.split('/')) {
            if (!seg) continue;
            dir = await dir.getDirectoryHandle(seg);
        }
        return dir;
    },

    async _browserFile(path) {
        const idx = path.lastIndexOf('/');
        const dir = await this._browserDir(idx === -1 ? '' : path.substring(0, idx));
        return dir.getFileHandle(path.substring(idx + 1));
    },

    // -> [{name, directory, size, modified}]
    async listDir(path) {
        if (this.mode === 'h2a') {
            const items = await h2aCall('list', ['saf:' + (path || '')]);
            return items.map(x => ({ name: x.name, directory: !!x.directory, size: x.size || 0, modified: x.modified || 0 }));
        }
        if (this.mode === 'browser') {
            const dir = await this._browserDir(path);
            const res = [];
            for await (const [name, handle] of dir.entries()) {
                if (handle.kind === 'directory') {
                    res.push({ name, directory: true, size: 0, modified: 0 });
                } else {
                    const f = await handle.getFile();
                    res.push({ name, directory: false, size: f.size, modified: f.lastModified });
                }
            }
            return res;
        }
        throw new Error('フォルダアクセス手段がありません');
    },

    async readBlob(path) {
        if (this.mode === 'h2a') {
            // チャンク読み込みAPI(新しいビルドのhtml2apk)。巨大ファイルでも
            // JavaヒープのOOMを起こさず読める。古いビルドでは一括読み込みにフォールバック。
            let id = null;
            try {
                id = await h2aCall('openRead', ['saf:' + path]);
            } catch (e) {
                if (!/不明なAPI/.test(e.message || '')) throw e;
                const b64 = await h2aCall('readBase64', ['saf:' + path]);
                return base64ToBlobAsync(b64, mimeOf(path));
            }
            try {
                // ブリッジ呼び出しは同期でUIをブロックするため、
                // 1チャンクごとにイベントループへ制御を返し、タッチ操作が固まらないようにする
                const CHUNK = 8 * 1024 * 1024;
                const parts = [];
                while (true) {
                    const b64 = await h2aCall('readChunk', [id, CHUNK]);
                    if (!b64) break;
                    const blob = await base64ToBlobAsync(b64);
                    parts.push(blob);
                    if (blob.size < CHUNK) break;
                    await new Promise(r => setTimeout(r, 0));
                }
                return new Blob(parts, { type: mimeOf(path) });
            } finally {
                h2aCall('closeRead', [id]).catch(() => {});
            }
        }
        if (this.mode === 'browser') {
            const fh = await this._browserFile(path);
            return fh.getFile();
        }
        throw new Error('フォルダアクセス手段がありません');
    },

    // <video>/<audio>/<img> の src に使えるURLを返す
    async fileUrl(path) {
        if (this.mode === 'h2a') {
            return h2aCall('toUrl', ['saf:' + path]); // content:// URI
        }
        const blob = await this.readBlob(path);
        return URL.createObjectURL(blob);
    },

    /* ---- アプリ専用領域ヘルパー: h2aモード専用(旧バージョンのキャッシュ掃除等) ---- */

    async privList(path) { return h2aCall('list', [path]); },
    async privRemove(path) { return h2aCall('remove', [path]); },

    // 実ファイルの削除
    async removeFile(path) {
        if (this.mode === 'h2a') {
            return h2aCall('remove', ['saf:' + path]);
        }
        if (this.mode === 'browser') {
            if ((await this.dirHandle.requestPermission({ mode: 'readwrite' })) !== 'granted') {
                throw new Error('書き込み権限がありません');
            }
            const idx = path.lastIndexOf('/');
            const dir = await this._browserDir(idx === -1 ? '' : path.substring(0, idx));
            await dir.removeEntry(path.substring(idx + 1));
            return true;
        }
        throw new Error('フォルダアクセス手段がありません');
    }
};

const KANA_MAP = {
    'あ':'a','い':'i','う':'u','え':'e','お':'o',
    'か':'ka','き':'ki','く':'ku','け':'ke','こ':'ko',
    'さ':'sa','し':'shi','す':'su','せ':'se','そ':'so',
    'た':'ta','ち':'chi','つ':'tsu','て':'te','と':'to',
    'な':'na','に':'ni','ぬ':'nu','ね':'ne','の':'no',
    'は':'ha','ひ':'hi','ふ':'fu','へ':'he','ほ':'ho',
    'ま':'ma','み':'mi','む':'mu','め':'me','も':'mo',
    'や':'ya','ゆ':'yu','よ':'yo',
    'ら':'ra','り':'ri','る':'ru','れ':'re','ろ':'ro',
    'わ':'wa','を':'wo','ん':'n',
    'が':'ga','ぎ':'gi','ぐ':'gu','げ':'ge','ご':'go',
    'ざ':'za','じ':'ji','ず':'zu','ぜ':'ze','ぞ':'zo',
    'だ':'da','ぢ':'ji','づ':'zu','で':'de','ど':'do',
    'ば':'ba','び':'bi','ぶ':'bu','べ':'be','ぼ':'bo',
    'ぱ':'pa','ぴ':'pi','ぷ':'pu','ぺ':'pe','ぽ':'po',
    'きゃ':'kya','きゅ':'kyu','きょ':'kyo',
    'しゃ':'sha','しゅ':'shu','しょ':'sho',
    'ちゃ':'cha','ちゅ':'chu','ちょ':'cho',
    'にゃ':'nya','にゅ':'nyu','にょ':'nyo',
    'ひゃ':'hya','ひゅ':'hyu','ひょ':'hyo',
    'みゃ':'mya','みゅ':'myu','みょ':'myo',
    'りゃ':'rya','りゅ':'ryu','りょ':'ryo',
    'ぎゃ':'gya','ぎゅ':'gyu','ぎょ':'gyo',
    'じゃ':'ja','じゅ':'ju','じょ':'jo',
    'びゃ':'bya','びゅ':'byu','びょ':'byo',
    'ぴゃ':'pya','ぴゅ':'pyu','ぴょ':'pyo',
    'ー':'-'
};

function toRomaji(str) {
    let s = str.replace(/[ァ-ヶ]/g, function(match) {
        var chr = match.charCodeAt(0) - 0x60;
        return String.fromCharCode(chr);
    });
    let res = '';
    let i = 0;
    while(i < s.length) {
        let two = s.substr(i, 2);
        if (KANA_MAP[two]) { res += KANA_MAP[two]; i+=2; continue; }
        let one = s.substr(i, 1);
        if (KANA_MAP[one]) { res += KANA_MAP[one]; i++; continue; }
        res += one; i++;
    }
    return res.toLowerCase();
}

document.addEventListener('alpine:init', () => {
    Alpine.data('app', () => ({
        page: 'home', library: [], lists: [],
        settings: { thumbSize:'small', accentColor:'#0095f6', darkMode:false, showAdult:true, scrollMode:'horizontal', direction:'rtl', doublePage:false, resume:true },
        filter:'all', searchQuery:'', selectionMode:false, selectedIds:[],
        loading:{show:false, text:'', progress:0, subText:'', minimal:false}, toast:{show:false, message:''},
        showViewerMenu:false, showBookmarksModal:false, showListSelect:false,
        folderReady:false, folderMode:null, scanning:false,
        editModal: { show:false, id:null, title:'', author:'', isAdult:false, type:'', tempThumb:null, isBatch:false, batchAdultMode:'no_change' },
        coverSelector: { show:false, images:[], loading:false },
        textViewer: { show:false, title:'', content:'' },
        imageViewer: { show:false, src:'' },
        videoPlayer: { show:false, playing:false },
        promptData: { show:false, title:'', inputValue:'', onConfirm:null, confirm() { if(this.inputValue) { this.onConfirm(this.inputValue); } this.show=false; this.inputValue=''; } },
        storageSize: '計算中...', currentItem:null, currentList:null,
        thumbnails: {},
        viewerPage:0, viewerTotal:0, swiper:null,
        audioFiles:[], currentAudioDir:"", currentTrack:null, currentTrackName:'', playing:false,
        audioTime:0, audioDuration:0, sliderTime:0, isDragging:false,
        repeatMode:0, isShuffle:false,
        currentHowl: null,
        longPressTimer: null, ignoreClick: false,
        _thumbChain: Promise.resolve(),

        async init() {
            const s = localStorage.getItem('appSettings');
            if(s) { _.assign(this.settings, JSON.parse(s)); }
            const lst = localStorage.getItem('appLists');
            if(lst) this.lists = JSON.parse(lst);

            this.saveMetaDebounced = _.debounce(() => this.saveMeta(), 800);

            this.$watch('settings', v => { localStorage.setItem('appSettings', JSON.stringify(v)); this.applyTheme(); });

            this.applyTheme();

            window.addEventListener('popstate', (e) => { if(e.state && e.state.page) this.page = e.state.page; });
            this.$watch('page', (val) => {
                if(val === 'profile') this.calculateStorageUsage();
                try { history.pushState({page: val}, '', `#${val}`); } catch(e) {}
                if(val === 'reels' && this.currentItem && this.currentItem.type === 'book' && this.viewerEntries?.length) { this.$nextTick(() => this.setupSwiperLazy()); }
            });

            this.folderMode = FS.init();
            if (await FS.restore()) {
                this.folderReady = true;
                await this.scanLibrary(true);
            }
        },

        applyTheme() {
            document.body.classList.toggle('dark-mode', this.settings.darkMode);
            document.documentElement.style.setProperty('--primary-color', this.settings.accentColor);
            document.body.style.setProperty('--primary-color', this.settings.accentColor);

            const sysColor = this.settings.darkMode ? '#121212' : '#ffffff';
            const metaThemeColor = document.querySelector('meta[name="theme-color"]');
            if(metaThemeColor) metaThemeColor.setAttribute('content', sysColor);
        },

        /* ---------- フォルダ選択・スキャン ---------- */

        async selectFolder(forceNew) {
            if (!this.folderMode) {
                alert('この環境ではフォルダアクセスが利用できません。\nAndroidアプリ版 (html2apk / ストレージ「選択フォルダ」) か、Chrome/Edge で開いてください。');
                return;
            }
            try {
                const ok = await FS.pickFolder(forceNew);
                if (ok) {
                    this.folderReady = true;
                    await this.scanLibrary(false);
                } else {
                    this.showToast('フォルダが選択されませんでした');
                }
            } catch(e) {
                alert('フォルダを選択できません:\n' + (e.message || e));
            }
        },

        // ブリッジの状態を確認するための診断 (設定画面から実行)
        async runDiagnostics() {
            const lines = [];
            lines.push('動作モード: ' + (this.folderMode || 'なし'));
            lines.push('H2ANative (ファイルAPI): ' + (window.H2ANative ? 'あり' : 'なし'));
            lines.push('H2A ブリッジ: ' + (window.H2A ? 'あり' : 'なし'));
            if (this.folderMode === 'h2a') {
                try {
                    const items = await h2aCall('list', ['saf:']);
                    lines.push('選択フォルダ: OK (' + items.length + '件)');
                } catch(e) {
                    lines.push('選択フォルダ: エラー: ' + (e.message || e));
                }
            } else if (this.folderMode === 'browser') {
                lines.push('フォルダ: ' + (this.folderReady ? '選択済み' : '未選択'));
            }
            alert(lines.join('\n'));
        },

        async scanLibrary(silent) {
            if (this.scanning) return;
            this.scanning = true;
            if (!silent) {
                this.loading.show = true;
                this.loading.minimal = false;
                this.loading.text = 'フォルダをスキャン中...';
                this.loading.progress = 0;
                this.loading.subText = '';
            }
            try {
                const meta = JSON.parse(localStorage.getItem('folderMeta') || '{}');
                const found = [];
                // 幅優先でフォルダを走査
                const queue = [{ path: '', depth: 0 }];
                while (queue.length) {
                    const { path, depth } = queue.shift();
                    if (!silent) this.loading.subText = path || '(ルート)';
                    let entries = [];
                    try { entries = await FS.listDir(path); }
                    catch(e) {
                        if (path === '') throw e; // ルートが読めない場合は設定の問題なのでエラー表示する
                        console.warn('listDir failed:', path, e); continue;
                    }
                    for (const ent of entries) {
                        if (!ent.name || ent.name.startsWith('.')) continue;
                        const full = path ? path + '/' + ent.name : ent.name;
                        if (ent.directory) {
                            if (depth < SCAN_MAX_DEPTH) queue.push({ path: full, depth: depth + 1 });
                        } else if (BOOK_REGEX.test(ent.name) || AUDIO_EXT_REGEX.test(ent.name) || VIDEO_EXT_REGEX.test(ent.name)) {
                            found.push({ ...ent, path: full });
                        }
                    }
                }

                const items = found.map(f => {
                    const m = meta[f.path] || {};
                    const isBookFile = BOOK_REGEX.test(f.name);
                    const ext = extOf(f.name);
                    // zip は中身が音声中心の場合があり、初回オープン時に判定して type を保存する
                    const type = m.type || (isBookFile ? 'book' : 'audio');
                    return {
                        id: f.path,
                        path: f.path,
                        name: f.name,
                        ext,
                        size: f.size,
                        modified: f.modified,
                        isFile: !isBookFile,
                        type,
                        title: m.title || f.name.replace(/\.(zip|cbz|pdf|mp3|wav|ogg|m4a|flac|aac|mp4|webm|m4v)$/i, ''),
                        author: m.author || '不明',
                        isAdult: !!m.isAdult,
                        hasThumb: isBookFile && !m.noThumb,
                        bookmarks: m.bookmarks || [],
                        lastIndex: m.lastIndex || 0
                    };
                });
                this.library = items;
                this.saveMeta();
                if (!silent) this.showToast(items.length + '件のファイルを見つけました');
            } catch(e) {
                console.error(e);
                alert('スキャンに失敗しました: ' + (e.message || e));
            }
            this.loading.show = false;
            this.scanning = false;
        },

        /* ---------- ライブラリ表示 ---------- */

        get gridClass() { return 'library-grid ' + (this.settings.thumbSize==='small'?'grid-small':(this.settings.thumbSize==='large'?'grid-large':'')); },
        get filteredLibrary() {
            const qRaw = this.searchQuery.toLowerCase();
            const qRomaji = toRomaji(qRaw);

            const filtered = _.filter(this.library, i => {
                if(!this.settings.showAdult && i.isAdult) return false;
                if(this.filter!=='all' && ((this.filter==='book' && i.type!=='book') || (this.filter==='audio' && i.type==='book'))) return false;

                const tRaw = (i.title || '').toLowerCase();
                const aRaw = (i.author || '').toLowerCase();
                const tRomaji = toRomaji(tRaw);
                const aRomaji = toRomaji(aRaw);

                const matchTitle = tRaw.includes(qRaw) || tRomaji.includes(qRomaji);
                const matchAuthor = aRaw.includes(qRaw) || aRomaji.includes(qRomaji);

                return matchTitle || matchAuthor;
            });

            return filtered.sort((a, b) => {
                return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
            });
        },
        getListItems() {
            const items = _.filter(this.library, i => this.currentList.items.includes(i.id));
            return items.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }));
        },

        /* ---------- サムネイル ---------- */

        thumbKey(item) { return 'thumb:' + item.path + ':' + item.size + ':' + item.modified; },
        pdfCacheKey(item) { return 'pdfzip:' + item.path + ':' + item.size + ':' + item.modified; },

        loadThumb(id) {
            if(this.thumbnails[id]) return;
            const item = _.find(this.library, {id});
            if(!item || !item.hasThumb) return;
            // 大きなファイルを開くため、生成は1件ずつ順番に行う
            this._thumbChain = this._thumbChain.then(async () => {
                if(this.thumbnails[id]) return;
                try {
                    const key = this.thumbKey(item);
                    let blob = await db.files.get(key);
                    if(!blob) {
                        blob = await this.generateThumb(item);
                        if(blob) await db.files.put(blob, key);
                    }
                    if(blob) {
                        this.thumbnails[id] = URL.createObjectURL(blob);
                    } else {
                        item.hasThumb = false;
                        this.saveMetaDebounced();
                    }
                } catch(e) {
                    console.warn('thumb failed:', item.path, e);
                    item.hasThumb = false;
                    this.saveMetaDebounced();
                }
            });
        },

        async generateThumb(item) {
            if(item.ext === 'pdf') {
                // 変換済みキャッシュがあればそこから、なければ1ページ目のみレンダリング
                const cached = await db.files.get(this.pdfCacheKey(item));
                if(cached) return await this.firstImageFromZip(cached, item);
                const srcBlob = await FS.readBlob(item.path);
                const pdf = await pdfjsLib.getDocument({data: await srcBlob.arrayBuffer()}).promise;
                const page = await pdf.getPage(1);
                let viewport = page.getViewport({scale: 1});
                const scale = 320 / viewport.width;
                viewport = page.getViewport({scale});
                const canvas = document.createElement('canvas');
                canvas.width = viewport.width; canvas.height = viewport.height;
                await page.render({canvasContext: canvas.getContext('2d'), viewport}).promise;
                const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.8));
                pdf.destroy();
                return blob;
            }
            // zip / cbz: ランダムアクセスで目次と先頭画像だけ読む(全体の転送不要で高速)
            let closer = null;
            let reader = null;
            if(FS.mode === 'h2a') {
                try {
                    const info = await h2aCall('openRandom', ['saf:' + item.path]);
                    reader = new H2ARandomReader(info.id, info.size);
                    closer = () => h2aCall('closeRandom', [info.id]).catch(() => {});
                } catch(e) {
                    if(!/不明なAPI/.test(e.message || '')) throw e;
                }
            }
            if(!reader && FS.mode === 'h2a' && item.size > 150 * 1024 * 1024) {
                // 旧ビルド(ランダムアクセス無し)では巨大ファイルの自動生成をスキップ
                return null;
            }
            try {
                if(!reader) reader = new zip.BlobReader(await FS.readBlob(item.path));
                const r = new zip.ZipReader(reader, { filenameEncoding: 'shift-jis' });
                const es = await r.getEntries();
                await this.applyComicInfo(es, item);
                const imgs = _.filter(es, x => !x.directory && x.filename.match(IMG_REGEX))
                    .sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }));
                let thumb = null;
                if(imgs.length > 0) thumb = await imgs[0].getData(new zip.BlobWriter());
                else if(_.some(es, x => !x.directory && x.filename.match(MEDIA_ENTRY_REGEX))) {
                    if(item.type !== 'audio') { item.type = 'audio'; this.saveMetaDebounced(); }
                }
                await r.close();
                return thumb;
            } finally {
                if(closer) closer();
            }
        },

        async firstImageFromZip(blob, item) {
            const r = createZipReader(blob);
            const es = await r.getEntries();
            // ComicInfo.xml があればタイトル・作者を反映(未編集の場合のみ)
            try {
                const infoEntry = _.find(es, x => x.filename.toLowerCase() === 'comicinfo.xml');
                if(infoEntry) {
                    const text = await infoEntry.getData(new zip.TextWriter());
                    const doc = new DOMParser().parseFromString(text, "application/xml");
                    const s = doc.querySelector('Series')?.textContent;
                    const p = doc.querySelector('Penciller')?.textContent || doc.querySelector('Writer')?.textContent;
                    const defaultTitle = item.name.replace(/\.(zip|cbz|pdf)$/i,'');
                    if(s && item.title === defaultTitle) item.title = s;
                    if(p && item.author === '不明') item.author = p;
                    this.saveMetaDebounced();
                }
            } catch(e) {}
            const imgs = _.filter(es, x => !x.directory && x.filename.match(IMG_REGEX)).sort((a,b)=>a.filename.localeCompare(b.filename, undefined, {numeric:true}));
            let thumb = null;
            if(imgs.length > 0) {
                thumb = await imgs[0].getData(new zip.BlobWriter());
            } else if(_.some(es, x => !x.directory && x.filename.match(MEDIA_ENTRY_REGEX))) {
                // 音声/動画アーカイブだった → タイプを更新
                if(item.type !== 'audio') { item.type = 'audio'; this.saveMetaDebounced(); }
            }
            await r.close();
            return thumb;
        },

        /* ---------- アイテムを開く ---------- */

        async handleClick(item) { if(this.ignoreClick) return; if(this.selectionMode) { this.selectedIds = _.xor(this.selectedIds, [item.id]); } else { this.openItem(item); } },

        async openItem(item) {
            this.loading.show = true;
            this.currentItem = item;

            if (item.type === 'book') {
                this.loading.minimal = true;
                this.loading.text = '';
            } else {
                this.loading.minimal = false;
                this.loading.text = "読み込み中...";
            }

            try {
                await this.closeBookSource();
                if(item.isFile) {
                    // フォルダ内の単体 音声/動画 ファイル
                    const url = await FS.fileUrl(item.path);
                    if(VIDEO_EXT_REGEX.test(item.name)) {
                        this.loading.show = false;
                        this.playVideoUrl(url);
                        return;
                    }
                    this._allAudioEntries = null;
                    this.audioFiles = [{ type:'file_audio', name:item.name, full:item.path, url }];
                    this.page = 'reels';
                    this.loading.show = false;
                    this.playAudioFile(this.audioFiles[0]);
                    return;
                }

                if(item.ext === 'pdf') {
                    const blob = await this.getPdfAsZip(item);
                    const zr = new zip.ZipReader(new zip.BlobReader(blob), { filenameEncoding: 'shift-jis' });
                    const es = await zr.getEntries();
                    this._openZipReader = zr;
                    await this.presentZipEntries(es, item);
                } else {
                    const es = await this.openZipSource(item.path);
                    await this.presentZipEntries(es, item);
                }
            } catch(e) { console.error(e); alert(e.message || e); }
            this.loading.show = false;
        },

        /* ---------- ランダムアクセスによる高速オープン(展開・全体読み込みなし) ---------- */

        // 開いている本のリーダー・ネイティブハンドル・ページURLを解放する
        async closeBookSource() {
            try { if (this._openZipReader) await this._openZipReader.close(); } catch(e) {}
            this._openZipReader = null;
            if (this._sourceCloser) { try { this._sourceCloser(); } catch(e) {} this._sourceCloser = null; }
            for (const k of Object.keys(this._pageUrls || {})) URL.revokeObjectURL(this._pageUrls[k]);
            this._pageUrls = {};
            this._pageJobs = {};
            this.viewerEntries = null;
        },

        // zipをランダムアクセスで開いてエントリ一覧を返す(目次だけ読むので巨大ファイルでも一瞬)。
        // 旧ビルドのAPKやブラウザでは Blob 経由にフォールバックする。
        async openZipSource(path) {
            let reader = null;
            if (FS.mode === 'h2a') {
                try {
                    const info = await h2aCall('openRandom', ['saf:' + path]);
                    reader = new H2ARandomReader(info.id, info.size);
                    this._sourceCloser = () => h2aCall('closeRandom', [info.id]).catch(() => {});
                } catch(e) {
                    if (!/不明なAPI/.test(e.message || '')) throw e;
                }
            }
            if (!reader) {
                const blob = await FS.readBlob(path);
                reader = new zip.BlobReader(blob);
            }
            const zr = new zip.ZipReader(reader, { filenameEncoding: 'shift-jis' });
            const es = await zr.getEntries();
            this._openZipReader = zr;
            return es;
        },

        // ComicInfo.xml からタイトル・作者を補完(未編集の場合のみ読む)
        async applyComicInfo(es, item) {
            try {
                const defaultTitle = item.name.replace(/\.(zip|cbz|pdf)$/i,'');
                if(item.title !== defaultTitle && item.author !== '不明') return;
                const infoEntry = _.find(es, x => x.filename.toLowerCase() === 'comicinfo.xml');
                if(!infoEntry) return;
                const text = await infoEntry.getData(new zip.TextWriter());
                const doc = new DOMParser().parseFromString(text, "application/xml");
                const s = doc.querySelector('Series')?.textContent;
                const p = doc.querySelector('Penciller')?.textContent || doc.querySelector('Writer')?.textContent;
                if(s && item.title === defaultTitle) item.title = s;
                if(p && item.author === '不明') item.author = p;
                this.saveMetaDebounced();
            } catch(e) {}
        },

        // エントリ一覧から漫画ビューアー/音声ブラウザへ振り分ける
        async presentZipEntries(es, item) {
            await this.applyComicInfo(es, item);
            const imgs = _.filter(es, x => !x.directory && x.filename.match(IMG_REGEX))
                .sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }));
            const hasMedia = _.some(es, x => !x.directory && x.filename.match(MEDIA_ENTRY_REGEX));

            if (item.ext !== 'cbz' && hasMedia) {
                if (item.type !== 'audio') { item.type = 'audio'; this.saveMetaDebounced(); }
                this._allAudioEntries = es;
                this.renderAudioDir('');
                this.page = 'reels';
                return;
            }

            if (imgs.length === 0) throw new Error('表示できるファイルがありません');
            this.viewerEntries = imgs;

            this.setupSwiperLazy();
            // 最初に表示するページだけ待つ(先読みとサムネ保存は裏で進める)
            await this.ensurePage((this._slidePages[this.viewerPage] || [0])[0]);
            this.page = 'reels';

            // サムネイル未キャッシュなら裏で保存(オープンをブロックしない)
            (async () => {
                try {
                    const key = this.thumbKey(item);
                    if (!(await db.files.get(key)) && this.viewerEntries === imgs) {
                        const blob = await imgs[0].getData(new zip.BlobWriter());
                        await db.files.put(blob, key);
                        if (!this.thumbnails[item.id]) this.thumbnails[item.id] = URL.createObjectURL(blob);
                    }
                } catch(e) {}
            })();
        },

        // PDF → 画像zip 変換(初回のみ。結果はキャッシュ)
        async getPdfAsZip(item) {
            const key = this.pdfCacheKey(item);
            const cached = await db.files.get(key);
            if(cached) return cached;

            this.loading.minimal = false;
            this.loading.text = "PDF変換中...(初回のみ)";
            this.loading.subText = "ページ解析を開始します";
            const srcBlob = await FS.readBlob(item.path);
            const pdf = await pdfjsLib.getDocument({data: await srcBlob.arrayBuffer()}).promise;
            const numPages = pdf.numPages;
            const zipWriter = new zip.ZipWriter(new zip.BlobWriter("application/zip"));
            for(let i=1; i<=numPages; i++) {
                this.loading.progress = (i/numPages)*100;
                this.loading.subText = `${i} / ${numPages} ページ変換中...`;
                const page = await pdf.getPage(i);
                const viewport = page.getViewport({scale: 1.5});
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.height = viewport.height;
                canvas.width = viewport.width;
                await page.render({canvasContext: context, viewport: viewport}).promise;
                const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.8));
                const fname = `page_${String(i).padStart(4,'0')}.jpg`;
                await zipWriter.add(fname, new zip.BlobReader(blob));
            }
            pdf.destroy();
            this.loading.subText = "キャッシュに保存中...";
            const newZipBlob = await zipWriter.close();
            await db.files.put(newZipBlob, key);
            this.loading.minimal = true;
            this.loading.text = '';
            this.loading.subText = '';
            return newZipBlob;
        },

        /* ---------- 選択・編集 ---------- */

        selectAll() { this.selectedIds = this.filteredLibrary.map(i => i.id); },
        openEditModal() {
            if (this.selectedIds.length === 0) return;
            this.editModal.isBatch = this.selectedIds.length > 1;
            this.editModal.show = true;
            if (this.editModal.isBatch) {
                this.editModal.title = "";
                this.editModal.author = "";
                this.editModal.tempThumb = null;
                this.editModal.batchAdultMode = 'no_change';
            } else {
                const id = this.selectedIds[0];
                const item = _.find(this.library, {id});
                if(!item) return;
                this.editModal.id = item.id;
                this.editModal.title = item.title;
                this.editModal.author = item.author;
                this.editModal.isAdult = item.isAdult;
                this.editModal.type = item.type;
                this.editModal.tempThumb = null;
            }
        },
        // 編集はメタデータのみ(元ファイルには書き込まない)
        async saveEdit() {
            const targets = this.editModal.isBatch ? this.selectedIds : [this.editModal.id];
            for (const id of targets) {
                const item = _.find(this.library, {id});
                if (!item) continue;
                if (this.editModal.isBatch) {
                    if (this.editModal.author && this.editModal.author.trim() !== "") item.author = this.editModal.author;
                    if (this.editModal.batchAdultMode === 'true') item.isAdult = true;
                    else if (this.editModal.batchAdultMode === 'false') item.isAdult = false;
                } else {
                    item.title = this.editModal.title;
                    item.author = this.editModal.author;
                    item.isAdult = this.editModal.isAdult;
                    if(this.editModal.tempThumb) {
                        try {
                            const resp = await fetch(this.editModal.tempThumb);
                            const blob = await resp.blob();
                            await db.files.put(blob, this.thumbKey(item));
                            this.thumbnails[item.id] = this.editModal.tempThumb;
                            item.hasThumb = true;
                        } catch(e) { console.error(e); }
                    }
                }
            }
            this.saveMeta();
            this.showToast("保存しました");
            this.editModal.show = false;
            this.selectionMode = false;
            this.selectedIds = [];
        },
        uploadCover(e) {
            const file = e.target.files[0];
            if(file) { this.editModal.tempThumb = URL.createObjectURL(file); }
            e.target.value = '';
        },
        async openCoverSelector() {
            this.coverSelector.show = true;
            this.coverSelector.loading = true;
            this.coverSelector.images = [];
            try {
                const item = _.find(this.library, {id: this.editModal.id});
                if(item) {
                    let reader = null;
                    this._tempCloser = null;
                    if(item.ext === 'pdf') {
                        reader = new zip.BlobReader(await this.getPdfAsZip(item));
                    } else if(FS.mode === 'h2a') {
                        try {
                            const info = await h2aCall('openRandom', ['saf:' + item.path]);
                            reader = new H2ARandomReader(info.id, info.size);
                            this._tempCloser = () => h2aCall('closeRandom', [info.id]).catch(() => {});
                        } catch(e) {
                            if(!/不明なAPI/.test(e.message || '')) throw e;
                        }
                    }
                    if(!reader) reader = new zip.BlobReader(await FS.readBlob(item.path));
                    const r = new zip.ZipReader(reader, { filenameEncoding: 'shift-jis' });
                    const es = await r.getEntries();
                    const imgs = _.filter(es, x => !x.directory && x.filename.match(IMG_REGEX)).sort((a,b)=>a.filename.localeCompare(b.filename, undefined, {numeric:true}));
                    this.coverSelector.images = imgs;
                    this._tempZipReader = r;
                }
            } catch(e) { console.error(e); }
            this.coverSelector.loading = false;
        },
        async previewCover(entry) {
            this.loading.show = true;
            try {
                const blob = await entry.getData(new zip.BlobWriter());
                this.editModal.tempThumb = URL.createObjectURL(blob);
                this.coverSelector.show = false;
                if(this._tempZipReader) { try { await this._tempZipReader.close(); } catch(e) {} this._tempZipReader = null; }
                if(this._tempCloser) { this._tempCloser(); this._tempCloser = null; }
            } catch(e) { alert(e); }
            this.loading.show = false;
        },

        /* ---------- 音声/動画ブラウザ ---------- */

        renderAudioDir(path) {
            this.currentAudioDir = path;
            const res = [];
            _.forEach(this._allAudioEntries, entry => {
                const p = entry.filename;
                if(!p.startsWith(path)) return;
                const rel = p.substring(path.length);
                if(!rel) return;
                const slash = rel.indexOf('/');
                if(slash === -1) {
                    if(rel.match(/\.(mp3|wav|ogg|m4a|flac|aac)$/i)) res.push({ type: 'file_audio', name: rel, full: p, entry });
                    else if(rel.match(/\.(mp4|webm|m4v)$/i)) res.push({ type: 'file_video', name: rel, full: p, entry });
                    else if(rel.match(IMG_REGEX)) res.push({ type: 'file_image', name: rel, full: p, entry });
                    else if(rel.match(/\.(txt|md|url|ini)$/i)) res.push({ type: 'text', name: rel, full: p, entry });
                } else {
                    const fname = rel.substring(0, slash);
                    if(!_.find(res, {name: fname, type: 'folder'})) res.push({ type: 'folder', name: fname, full: path + fname + '/' });
                }
            });
            this.audioFiles = _.orderBy(res, [f => f.type === 'folder', 'name'], ['desc', 'asc']);
        },
        getIcon(f) {
            if (f.type === 'folder') return ICONS.folder;
            if (f.type === 'file_video') return ICONS.file_video;
            if (f.type === 'file_image') return ICONS.file_image;
            if (f.type === 'text') return ICONS.text;
            return ICONS.file_audio;
        },
        audioBack() {
            if(this.currentAudioDir === "" || !this._allAudioEntries) { this.page = 'home'; return; }
            const p = this.currentAudioDir.split('/'); p.pop(); p.pop();
            this.renderAudioDir(p.length > 0 ? p.join('/') + '/' : "");
        },

        async entryOrUrl(f) {
            if(f.url) return f.url;
            if(f.entry && f.entry.url) return f.entry.url; // ネイティブ展開済みファイル
            const b = await f.entry.getData(new zip.BlobWriter());
            return URL.createObjectURL(b);
        },

        async playAudioFile(f) {
            if(f.type === 'folder') { this.renderAudioDir(f.full); return; }
            if(f.type === 'file_image') { this.viewImage(f); return; }
            if(f.type === 'text') { this.viewText(f); return; }
            if(f.type === 'file_video') { this.playVideo(f); return; }

            if(this.currentHowl) { this.currentHowl.unload(); }
            const url = await this.entryOrUrl(f);
            const ext = f.name.split('.').pop().toLowerCase();
            this.currentTrack = f.full;
            this.currentTrackName = f.name;
            this.currentHowl = new Howl({
                src: [url], format: [ext], html5: true,
                onplay: () => {
                    this.playing = true;
                    this.audioDuration = this.currentHowl.duration();
                    requestAnimationFrame(this.step.bind(this));
                },
                onpause: () => this.playing = false,
                onend: () => {
                    if(this.repeatMode === 2) { this.currentHowl.play(); } else { this.nextTrack(true); }
                },
                onstop: () => this.playing = false
            });
            this.currentHowl.play();
            this.playlist = _.filter(this.audioFiles, {type:'file_audio'});
        },

        async playVideo(f) {
            if(this.currentHowl) { this.currentHowl.stop(); }
            this.loading.show = true;
            try {
                const url = await this.entryOrUrl(f);
                this.playVideoUrl(url);
            } catch(e) { alert("動画再生エラー: "+e); }
            this.loading.show = false;
        },
        playVideoUrl(url) {
            if(this.currentHowl) { this.currentHowl.stop(); }
            this.videoPlayer.show = true;
            this.$nextTick(() => {
                const v = this.$refs.videoRef;
                v.src = url;
                v.load();
                v.play().then(() => {
                    if (v.requestFullscreen) v.requestFullscreen();
                    else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
                }).catch(e => console.log("Auto-play blocked or fullscreen error:", e));
                this.videoPlayer.playing = true;
            });
        },
        onVideoEnded() {
            this.videoPlayer.playing = false;
        },
        closeVideo() {
            this.$refs.videoRef.pause();
            this.videoPlayer.show = false;
            if (document.fullscreenElement || document.webkitFullscreenElement) {
                if (document.exitFullscreen) document.exitFullscreen();
                else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
            }
        },

        async viewImage(f) {
            this.loading.show = true;
            this.loading.minimal = false;
            this.loading.text = "読み込み中...";
            try {
                this.imageViewer.src = await this.entryOrUrl(f);
                this.imageViewer.show = true;
            } catch(e) { alert("読み込みエラー: " + e); }
            this.loading.show = false;
        },

        async viewText(f) {
            this.loading.show = true;
            this.loading.minimal = false;
            this.loading.text = "読み込み中...";
            try {
                const data = await f.entry.getData(new zip.Uint8ArrayWriter());
                let text = "";
                try {
                    const decoder = new TextDecoder('utf-8', { fatal: true });
                    text = decoder.decode(data);
                } catch (e) {
                    const decoder = new TextDecoder('shift-jis');
                    text = decoder.decode(data);
                }
                this.textViewer.title = f.name;
                this.textViewer.content = text;
                this.textViewer.show = true;
            } catch(e) { alert("読み込みエラー: " + e); }
            this.loading.show = false;
        },

        step() {
            if (!this.currentHowl) return;
            if (this.currentHowl.playing()) {
                this.audioTime = this.currentHowl.seek();
                if (!this.isDragging) { this.sliderTime = this.audioTime; }
            }
            requestAnimationFrame(this.step.bind(this));
        },
        togglePlay() { if(this.currentHowl) { this.currentHowl.playing() ? this.currentHowl.pause() : this.currentHowl.play(); } },
        seekAudio(v) {
            this.isDragging = false;
            if (this.currentHowl) {
                this.currentHowl.seek(parseFloat(v));
                this.audioTime = parseFloat(v);
                this.sliderTime = parseFloat(v);
            }
        },
        toggleRepeat() { this.repeatMode = (this.repeatMode+1)%3; this.showToast(this.repeatMode===0?"リピートOFF":this.repeatMode===1?"全曲リピート":"1曲リピート"); },
        toggleShuffle() { this.isShuffle = !this.isShuffle; this.showToast(this.isShuffle?"シャッフルON":"シャッフルOFF"); },
        prevTrack() {
            if(!this.playlist || !this.currentHowl) return;
            if(this.currentHowl.seek() > 3) { this.currentHowl.seek(0); return; }
            const idx = _.findIndex(this.playlist, {full: this.currentTrack});
            let prevIdx = idx - 1;
            if (prevIdx < 0) prevIdx = this.playlist.length - 1;
            this.playAudioFile(this.playlist[prevIdx]);
        },
        nextTrack(auto = false) {
            if(!this.playlist) return;
            const idx = _.findIndex(this.playlist, {full: this.currentTrack});
            let nextIdx;
            if(this.isShuffle) {
                nextIdx = Math.floor(Math.random() * this.playlist.length);
            } else {
                nextIdx = idx + 1;
                if(nextIdx >= this.playlist.length) {
                    if(this.repeatMode === 1) nextIdx = 0;
                    else if(auto) return;
                    else nextIdx = 0;
                }
            }
            this.playAudioFile(this.playlist[nextIdx]);
        },

        /* ---------- 漫画ビューアー ---------- */

        // 遅延読み込みビューアー: スライドは空の<img data-page>で組み立て、
        // 表示中のページと前後だけをzipから取り出す。遠いページは解放してメモリを一定に保つ。
        setupSwiperLazy() {
            const entries = this.viewerEntries || [];
            const n = entries.length;
            const wrapper = document.getElementById('main-swiper').querySelector('.swiper-wrapper');
            const isV = this.settings.scrollMode === 'vertical';
            const dbl = this.settings.doublePage && !isV;
            const rtl = this.settings.direction === 'rtl';

            // スライド → ページ番号の対応表(見開きは [1,2],[3,4],...)
            const slides = [];
            if(!dbl) { for(let i=0; i<n; i++) slides.push([i]); }
            else {
                if(n > 0) slides.push([0]);
                for(let i=1; i<n; i+=2) slides.push(i+1 < n ? [i, i+1] : [i]);
            }
            this._slidePages = slides;

            const wrapZoom = (content) => `<div class="swiper-zoom-container">${content}</div>`;
            const html = slides.map(pages => {
                if(pages.length === 1) return `<div class="swiper-slide">${wrapZoom(`<img data-page="${pages[0]}">`)}</div>`;
                const [a, b] = pages;
                const inner = rtl
                    ? `<div class="spread-container"><img data-page="${b}" class="spread-page"><img data-page="${a}" class="spread-page"></div>`
                    : `<div class="spread-container"><img data-page="${a}" class="spread-page"><img data-page="${b}" class="spread-page"></div>`;
                return `<div class="swiper-slide">${wrapZoom(inner)}</div>`;
            }).join('');
            wrapper.innerHTML = html;
            this.viewerTotal = slides.length;

            if(this.swiper) this.swiper.destroy();
            this.swiper = new Swiper('#main-swiper', { direction: isV?'vertical':'horizontal', zoom:true, spaceBetween: 0, centeredSlides: true, on: { slideChange: () => {
                this.viewerPage = this.swiper.activeIndex;
                if(this.currentItem) { this.currentItem.lastIndex = this.swiper.activeIndex; this.saveMetaDebounced(); }
                this.loadAroundSlide(this.swiper.activeIndex);
            } } });
            if(rtl && !isV) this.swiper.changeLanguageDirection('rtl'); else this.swiper.changeLanguageDirection('ltr');

            let start = 0;
            if(this.settings.resume && this.currentItem?.lastIndex) {
                start = Math.min(this.currentItem.lastIndex, Math.max(0, slides.length - 1));
                this.viewerPage = start;
                this.swiper.slideTo(start, 0);
            }
            this.loadAroundSlide(start);
        },

        // 指定ページをzipから取り出して<img>にセットする(実行中の重複はまとめる)
        async ensurePage(p) {
            const entries = this.viewerEntries;
            if(!entries || p < 0 || p >= entries.length) return;
            if(!this._pageUrls) this._pageUrls = {};
            if(!this._pageJobs) this._pageJobs = {};
            if(this._pageUrls[p]) return;
            if(this._pageJobs[p]) return this._pageJobs[p];
            this._pageJobs[p] = (async () => {
                try {
                    const blob = await entries[p].getData(new zip.BlobWriter());
                    const url = URL.createObjectURL(blob);
                    this._pageUrls[p] = url;
                    document.querySelectorAll('#main-swiper img[data-page="' + p + '"]').forEach(img => { img.src = url; });
                } catch(e) { console.warn('ページ読み込み失敗:', p, e); }
                delete this._pageJobs[p];
            })();
            return this._pageJobs[p];
        },

        // 現在のスライドを最優先に前後を先読みし、遠いページのURLを解放する
        async loadAroundSlide(slideIdx) {
            const slides = this._slidePages || [];
            const want = [];
            for(const d of [0, 1, -1, 2, -2]) {
                const s = slides[slideIdx + d];
                if(s) want.push(...s);
            }
            for(const p of want) await this.ensurePage(p);

            const keep = new Set();
            for(let d = -4; d <= 4; d++) { const s = slides[slideIdx + d]; if(s) s.forEach(p => keep.add(p)); }
            for(const key of Object.keys(this._pageUrls || {})) {
                const p = parseInt(key);
                if(!keep.has(p)) {
                    URL.revokeObjectURL(this._pageUrls[p]);
                    delete this._pageUrls[p];
                    document.querySelectorAll('#main-swiper img[data-page="' + p + '"]').forEach(img => { img.removeAttribute('src'); });
                }
            }
        },
        seekViewer(val) { this.swiper.slideTo(parseInt(val)); },
        onViewerClick(e) {
            if(e.target.tagName === 'INPUT' || e.target.closest('#viewer-menu-btn')) return;
            if(this.swiper && this.swiper.zoom && this.swiper.zoom.scale > 1) return;
            const x = e.clientX;
            const rtl = this.settings.direction === 'rtl';
            (rtl ? x < window.innerWidth/2 : x > window.innerWidth/2) ? this.swiper.slideNext() : this.swiper.slidePrev();
        },

        hasBookmark() { return _.includes(this.currentItem?.bookmarks, this.viewerPage); },
        toggleBookmark() {
            if(!this.currentItem.bookmarks) this.currentItem.bookmarks = [];
            this.currentItem.bookmarks = _.xor(this.currentItem.bookmarks, [this.viewerPage]).sort((a,b)=>a-b);
            this.saveMeta(); this.showToast("変更しました"); this.showViewerMenu = false;
        },
        openBookmarks() { this.showViewerMenu=false; this.showBookmarksModal=true; },
        jumpTo(p) { this.seekViewer(p); this.showBookmarksModal=false; },

        /* ---------- リスト ---------- */

        createList() {
            this.promptData.title = 'リスト名';
            this.promptData.onConfirm = (val) => {
                this.lists.push({id:Date.now(), title:val, items:[]});
                localStorage.setItem('appLists', JSON.stringify(this.lists));
            };
            this.promptData.show = true;
            this.promptData.onConfirm && this.$nextTick(() => { this.$refs.promptInput.focus(); });
        },

        deleteList() { if(confirm("削除しますか？")) { this.lists = _.reject(this.lists, {id: this.currentList.id}); localStorage.setItem('appLists', JSON.stringify(this.lists)); this.currentList = null; } },

        touchStart(id) { this.longPressTimer = setTimeout(() => { this.ignoreClick = true; this.enterSelect(id); }, 500); },
        touchEnd() { clearTimeout(this.longPressTimer); if(this.ignoreClick) { setTimeout(() => { this.ignoreClick = false; }, 200); } },
        enterSelect(id) { this.selectionMode = true; this.selectedIds = [id]; navigator.vibrate?.(50); },
        exitSelectionMode() { this.selectionMode = false; this.selectedIds = []; },

        async deleteSelectedItems() {
            if(this.currentList) {
                if(!confirm("リストから削除しますか？")) return;
                this.currentList.items = _.difference(this.currentList.items, this.selectedIds);
                localStorage.setItem('appLists', JSON.stringify(this.lists));
                this.showToast("リストから削除しました");
            }
            else {
                if(!confirm("選択した " + this.selectedIds.length + " 件のファイルを端末(選択フォルダ)から完全に削除します。\nよろしいですか？")) return;
                this.loading.show = true;
                this.loading.minimal = false;
                this.loading.text = "削除中...";
                let ok = 0, fail = 0;
                for(const id of this.selectedIds) {
                    const item = _.find(this.library, {id});
                    if(!item) continue;
                    try {
                        await FS.removeFile(item.path);
                        await db.files.delete(this.thumbKey(item));
                        await db.files.delete(this.pdfCacheKey(item));
                        ok++;
                    } catch(e) { console.error(e); fail++; }
                }
                this.library = _.filter(this.library, i => !this.selectedIds.includes(i.id));
                this.saveMeta();
                this.loading.show = false;
                this.showToast(fail ? `${ok}件削除 / ${fail}件失敗` : "削除しました");
            }
            this.selectionMode = false;
            this.selectedIds = [];
        },
        openToList() { this.showListSelect = true; },
        addSelectedToList(list) {
            list.items = _.union(list.items, this.selectedIds);
            localStorage.setItem('appLists', JSON.stringify(this.lists));
            this.showListSelect = false;
            this.selectionMode = false;
            this.selectedIds = [];
            this.showToast("追加しました");
        },

        /* ---------- 設定 ---------- */

        getLabel(val) { const map = {'small':'小','medium':'中','large':'大','horizontal':'スワイプ','vertical':'縦スクロール','rtl':'右→左','ltr':'左→右'}; return map[val] || val; },
        getColorName(c) { const map = {'#0095f6':'ブルー','#ff75a0':'ピンク','#ff3b30':'レッド','#ff9500':'オレンジ'}; return map[c] || c; },
        getFolderModeLabel() {
            if(this.folderMode === 'h2a') return this.folderReady ? '選択済み (Android)' : '未選択';
            if(this.folderMode === 'browser') return this.folderReady ? '選択済み (ブラウザ)' : '未選択';
            return '利用不可';
        },

        async privDirSize(path) {
            let sum = 0;
            const entries = await FS.privList(path);
            for (const e of entries) {
                sum += e.directory ? await this.privDirSize(path + '/' + e.name) : (e.size || 0);
            }
            return sum;
        },

        async calculateStorageUsage() {
            this.storageSize = "計算中..."; let total = 0;
            await db.files.each(val => { if (val instanceof Blob) total += val.size; });
            if (FS.mode === 'h2a') { try { total += await this.privDirSize('zipcache'); } catch(e) {} }
            if (total === 0) { this.storageSize = "0 MB"; return; }
            const k = 1024; const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']; const i = Math.floor(Math.log(total) / Math.log(k));
            this.storageSize = parseFloat((total / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        },

        async clearCache() {
            if(!confirm("サムネイル・PDF変換・展開キャッシュを削除しますか？\n(フォルダ内のファイルは削除されません)")) return;
            await db.files.clear();
            if (FS.mode === 'h2a') { try { await FS.privRemove('zipcache'); } catch(e) {} }
            this.thumbnails = {};
            this.calculateStorageUsage();
            this.showToast("キャッシュを削除しました");
        },

        async deleteAll() {
            if(confirm("アプリの設定・キャッシュ・リストをすべて初期化しますか？\n(フォルダ内のファイルは削除されません)")) {
                await db.files.clear();
                await db.kv.clear();
                if (FS.mode === 'h2a') { try { await FS.privRemove('zipcache'); } catch(e) {} }
                localStorage.clear();
                location.reload();
            }
        },

        saveMeta() {
            const meta = {};
            for (const item of this.library) {
                meta[item.path] = {
                    title: item.title,
                    author: item.author,
                    isAdult: item.isAdult,
                    bookmarks: item.bookmarks,
                    lastIndex: item.lastIndex || 0,
                    type: item.type,
                    noThumb: item.hasThumb === false && !item.isFile && !!item.ext.match(/^(zip|cbz|pdf)$/)
                };
            }
            localStorage.setItem('folderMeta', JSON.stringify(meta));
        },
        showToast(msg) { this.toast.message = msg; this.toast.show = true; _.delay(() => this.toast.show = false, 2000); },
        fmtTime(s) { if(!s || isNaN(s)) return "0:00"; const m = Math.floor(s/60), sec = Math.floor(s%60); return `${m}:${sec<10?'0':''}${sec}`; },

        getMarkerStyle(p) {
            const pct = (p/(this.viewerTotal-1 || 1))*100;
            return this.settings.direction === 'rtl' ? `right:${pct}%;` : `left:${pct}%;`;
        },

        triggerAnim(el, anim) {
              el.classList.remove('anim-active', 'anim-'+anim);
              void el.offsetWidth;
              el.classList.add('anim-active', 'anim-'+anim);
        }
    }))
});
