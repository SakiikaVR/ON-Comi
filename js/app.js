/*!
 * オンコミ - app.js
 * オフラインで動作する漫画・音声・動画ライブラリ
 * Licensed under the MIT License. See LICENSE file in the project root.
 *
 * Third-party libraries (loaded via CDN, see credit.html for licenses):
 *   Alpine.js (MIT), @alpinejs/intersect (MIT), Dexie.js (Apache-2.0),
 *   zip.js (BSD-3-Clause), Lodash (MIT), Howler.js (MIT),
 *   PDF.js (Apache-2.0), Swiper (MIT)
 * Inline SVG icons are based on Feather Icons (MIT).
 */

pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';

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

function createZipReader(blob) {
    return new zip.ZipReader(new zip.BlobReader(blob), { filenameEncoding: 'shift-jis' });
}

/* ---- さきいかビルダー reflect フォールバック: FileChannel の位置指定読み ---- */
async function openReflectChannel(uri) {
    const R = Android.reflect;
    const ctx = await R.context();
    const resolver = await R.call({ ref: ctx.__ref, method: 'getContentResolver' });
    const uriObj = await R.staticCall({ class: 'android.net.Uri', method: 'parse', args: [uri] });
    const pfd = await R.call({ ref: resolver.__ref, method: 'openFileDescriptor', args: [{ __ref: uriObj.__ref }, 'r'] });
    const size = await R.call({ ref: pfd.__ref, method: 'getStatSize' });
    const fd = await R.call({ ref: pfd.__ref, method: 'getFileDescriptor' });
    const fis = await R['new']({ class: 'java.io.FileInputStream', args: [{ __ref: fd.__ref }] });
    const ch = await R.call({ ref: fis.__ref, method: 'getChannel' });
    for (const h of [resolver, uriObj, fd]) { try { await R.release({ ref: h.__ref }); } catch (e) {} }
    return { pfd, fis, ch, size: Number(size) };
}
async function reflectRead(refl, offset, length) {
    const R = Android.reflect;
    const bb = await R.staticCall({ class: 'java.nio.ByteBuffer', method: 'allocate', args: [length] });
    try {
        const n = await R.call({ ref: refl.ch.__ref, method: 'read', args: [{ __ref: bb.__ref }, { type: 'long', value: offset }] });
        if (typeof n !== 'number' || n <= 0) return new Uint8Array(0);
        const arr = await R.call({ ref: bb.__ref, method: 'array' });
        try {
            /* Base64.encodeToString(byte[], offset, count, NO_WRAP=2) で一括転送 */
            const b64 = await R.staticCall({ class: 'android.util.Base64', method: 'encodeToString', args: [{ __ref: arr.__ref }, 0, n, 2] });
            const buf = await (await fetch('data:application/octet-stream;base64,' + b64)).arrayBuffer();
            return new Uint8Array(buf);
        } finally {
            try { await R.release({ ref: arr.__ref }); } catch (e) {}
        }
    } finally {
        try { await R.release({ ref: bb.__ref }); } catch (e) {}
    }
}
async function closeReflectChannel(refl) {
    const R = Android.reflect;
    for (const [h, close] of [[refl.ch, true], [refl.fis, true], [refl.pfd, true]]) {
        if (close) { try { await R.call({ ref: h.__ref, method: 'close' }); } catch (e) {} }
        try { await R.release({ ref: h.__ref }); } catch (e) {}
    }
}

/**
 * さきいかビルダーのブリッジで選択フォルダー内のファイルをランダムアクセス読みする
 * zip.js Reader。ファイル全体の転送を待たずに読み始められるハイブリッド構成:
 *   1. reflect の FileChannel 位置読みを即オープン → ZIP の目次など小さな読みは即応
 *   2. 裏で content URI を XHR で Blob 化 (ディスクバックで低メモリ)。完了後は
 *      ブリッジを介さないスライス読みに切り替わり、ページ読みが最速になる
 * opts.noPrefetch: サムネイル作成など少量読みの用途で全体 Blob 取得を行わない
 */
class SakiikaRandomReader extends zip.Reader {
    constructor(path, opts) {
        super();
        this.path = path; this.opts = opts || {};
        this.blob = null; this.refl = null; this.size = 0;
        this._ready = null; this._blobPromise = null; this._xhr = null;
    }
    init() {
        if (this._ready) return this._ready;
        this._ready = (async () => {
            const st = await Android.fs.stat({ path: this.path });
            if (!st || st.isDir || !st.uri) throw new Error('開けません: ' + this.path);
            this.size = st.size;
            this._uri = st.uri;
            try {
                this.refl = await openReflectChannel(st.uri);
                if (this.refl.size > 0) this.size = this.refl.size;
            } catch (e) { this.refl = null; }
            if (!this.opts.noPrefetch || !this.refl) {
                this.startPrefetch();
                if (!this.refl) {
                    const b = await this._blobPromise;
                    if (!b) throw new Error('開けません: ' + this.path);
                }
            }
        })();
        return this._ready;
    }
    /* ファイル全体の Blob 先読みを開始する (完了後はブリッジ不要のスライス読みに切替) */
    startPrefetch() {
        if (this._blobPromise || this.blob || !this._uri) return this._blobPromise;
        this._blobPromise = new Promise((resolve) => {
            try {
                const x = new XMLHttpRequest();
                this._xhr = x;
                x.open('GET', this._uri, true);
                x.responseType = 'blob';
                x.onload = () => {
                    this._xhr = null;
                    if (x.response && x.response.size > 0) { this.blob = x.response; this.size = this.blob.size; resolve(this.blob); }
                    else resolve(null);
                };
                x.onerror = () => { this._xhr = null; resolve(null); };
                x.onabort = () => { this._xhr = null; resolve(null); };
                x.send();
            } catch (e) { this._xhr = null; resolve(null); }
        });
        return this._blobPromise;
    }
    async readUint8Array(index, length) {
        await this.init();
        if (!this.blob && !this.refl && this._blobPromise) await this._blobPromise;
        if (index >= this.size) return new Uint8Array(0);
        const len = Math.min(length, this.size - index);
        if (this.blob) return new Uint8Array(await this.blob.slice(index, index + len).arrayBuffer());
        if (this.refl) {
            /* 逐次読み (zip.js の展開) を想定した投機的ダブルバッファ:
               大きなチャンクを渡している間に次のチャンクをブリッジで先行読みする */
            let cur;
            if (this._spec && this._spec.index === index && this._spec.length === len) cur = this._spec.p;
            else cur = reflectRead(this.refl, index, len);
            this._spec = null;
            const nIdx = index + len;
            if (len >= 1024 * 1024 && nIdx < this.size) {
                const nLen = Math.min(length, this.size - nIdx);
                this._spec = { index: nIdx, length: nLen, p: reflectRead(this.refl, nIdx, nLen) };
                this._spec.p.catch(() => {});
            }
            return cur;
        }
        throw new Error('開けません: ' + this.path);
    }
    /* ファイル全体を Blob で取得 (PDF など)。XHR の進捗も通知する */
    async whole(onProgress) {
        await this.init();
        if (this.blob) return this.blob;
        if (this._blobPromise) {
            if (this._xhr && onProgress) {
                this._xhr.onprogress = (e) => { if (e.total) onProgress(e.loaded / e.total * 100); };
            }
            const b = await this._blobPromise;
            if (b) return b;
        }
        const parts = [];
        let off = 0;
        while (off < this.size) {
            const len = Math.min(8 * 1024 * 1024, this.size - off);
            if (onProgress) onProgress(off / this.size * 100);
            const part = await this.readUint8Array(off, len);
            if (!part.length) break;
            parts.push(part);
            off += part.length;
        }
        return new Blob(parts);
    }
    async dispose() {
        this._spec = null;
        if (this._xhr) { try { this._xhr.abort(); } catch (e) {} this._xhr = null; }
        if (this.refl) { try { await closeReflectChannel(this.refl); } catch (e) {} this.refl = null; }
        this.blob = null;
    }
}

/* ================================================================
   プログレッシブ展開 — 先頭だけ展開して即再生し、続きは同じストリームで
   最後まで展開する。巨大な WAV トラックの「展開待ち」をなくすための仕組み。
================================================================ */

/* ZIP ローカルヘッダを読み、エントリの圧縮データ実体の範囲を求める */
async function entryDataRange(reader, entry) {
    const lh = await reader.readUint8Array(entry.offset, 30);
    if (lh.length < 30 || lh[0] !== 0x50 || lh[1] !== 0x4b || lh[2] !== 3 || lh[3] !== 4) {
        throw new Error('local header not found');
    }
    const nameLen = lh[26] | (lh[27] << 8);
    const extraLen = lh[28] | (lh[29] << 8);
    const start = entry.offset + 30 + nameLen + extraLen;
    return { start, end: start + entry.compressedSize };
}

/* 展開済み先頭バイト列から WAV の再生レートを読む (秒数換算用)。非WAVなら null */
function parseWavMeta(head) {
    if (head.length < 44) return null;
    const tag = (o) => String.fromCharCode(head[o], head[o + 1], head[o + 2], head[o + 3]);
    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
    let o = 12, byteRate = 0, dataOffset = 0;
    while (o + 8 <= Math.min(head.length, 4096)) {
        const id = tag(o);
        const size = head[o + 4] | (head[o + 5] << 8) | (head[o + 6] << 16) | (head[o + 7] << 24);
        if (id === 'fmt ') byteRate = head[o + 16] | (head[o + 17] << 8) | (head[o + 18] << 16) | (head[o + 19] << 24);
        if (id === 'data') { dataOffset = o + 8; break; }
        o += 8 + size + (size % 2);
    }
    return byteRate > 0 ? { byteRate, dataOffset } : null;
}

/**
 * エントリを先頭から逐次展開する。展開済みが headBytes に達した時点で
 * onHead(部分Blob, メタ) を一度呼び、その後も最後まで展開を続けて全体Blobを返す。
 * 無圧縮(stored)は読んだ端から、Deflate は DecompressionStream で展開する。
 * DecompressionStream 非対応環境では従来の一括展開へフォールバック。
 */
async function extractEntryProgressive(reader, entry, { headBytes, onHead, onProgress, isAlive }) {
    const method = entry.compressionMethod;
    const supported = method === 0 || (method === 8 && typeof DecompressionStream === 'function');
    if (!supported) {
        const blob = await entry.getData(new zip.BlobWriter(), {
            onprogress: (done, total) => { if (onProgress && total) onProgress(done, total); }
        });
        if (onHead) onHead(blob, null);
        return blob;
    }
    const { start, end } = await entryDataRange(reader, entry);
    const blobParts = [];
    let pending = [], pendingBytes = 0, out = 0, headDone = false, firstBytes = null;
    const flush = () => {
        if (pending.length) { blobParts.push(new Blob(pending)); pending = []; pendingBytes = 0; }
    };
    const push = (u8) => {
        if (!firstBytes) firstBytes = u8.slice(0, 4096);
        pending.push(u8); pendingBytes += u8.byteLength; out += u8.byteLength;
        if (pendingBytes >= 32 * 1024 * 1024) flush();
        if (!headDone && headBytes && out >= headBytes && onHead) {
            headDone = true;
            onHead(new Blob([...blobParts, ...pending]), parseWavMeta(firstBytes));
        }
        if (onProgress) onProgress(out, entry.uncompressedSize);
    };
    if (method === 0) {
        let off = start;
        while (off < end) {
            if (isAlive && !isAlive()) throw new Error('aborted');
            const len = Math.min(8 * 1024 * 1024, end - off);
            const part = await reader.readUint8Array(off, len);
            if (!part.length) break;
            push(part); off += part.length;
        }
    } else {
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        const rdr = ds.readable.getReader();
        const pump = (async () => {
            while (true) {
                const { done, value } = await rdr.read();
                if (done) break;
                push(value);
            }
        })();
        let off = start;
        try {
            while (off < end) {
                if (isAlive && !isAlive()) throw new Error('aborted');
                const len = Math.min(4 * 1024 * 1024, end - off);
                const part = await reader.readUint8Array(off, len);
                if (!part.length) break;
                await writer.write(part); off += part.length;
            }
            await writer.close();
        } catch (e) { try { writer.abort(); } catch (e2) {} throw e; }
        await pump;
    }
    flush();
    const full = new Blob(blobParts);
    if (!headDone && onHead) onHead(full, parseWavMeta(firstBytes || new Uint8Array(0)));
    return full;
}

const MEDIA_REGEX = /\.(mp3|wav|ogg|oga|m4a|flac|aac|opus|mp4|webm|m4v|mov)$/i;
const VIDEO_REGEX = /\.(mp4|webm|m4v|mov)$/i;
const LIB_FILE_REGEX = /\.(zip|cbz|pdf|mp3|wav|ogg|oga|m4a|flac|aac|opus|mp4|webm|m4v|mov)$/i;

const DB_NAME='MediaLibDB_v64';
const db = new Dexie(DB_NAME);
db.version(1).stores({ files: '' });

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
        settings: { theme:'dark', thumbSize:'small', accentColor:'#7bb3d7', showAdult:true, scrollMode:'horizontal', direction:'rtl', doublePage:false, resume:true },
        filter:'all', searchQuery:'', selectionMode:false, selectedIds:[],
        loading:{show:false, text:'', progress:0, subText:'', minimal:false}, toast:{show:false, message:''},
        showAddMenu:false, showViewerMenu:false, showBookmarksModal:false, showListSelect:false,
        editModal: { show:false, id:null, title:'', author:'', isAdult:false, type:'', tempThumb:null, isBatch:false, batchAdultMode:'no_change' },
        coverSelector: { show:false, images:[], loading:false },
        textViewer: { show:false, title:'', content:'' },
        imageViewer: { show:false, src:'' },
        videoPlayer: { show:false, playing:false },
        promptData: { show:false, title:'', inputValue:'', onConfirm:null, confirm() { if(this.inputValue.trim()) { this.onConfirm(this.inputValue.trim()); } this.show=false; this.inputValue=''; } },
        confirmData: { show:false, title:'', message:'', okText:'OK', danger:false, onConfirm:null },
        sheetData: { show:false, title:'', actions:[] },
        storageSize: '計算中...', currentItem:null, currentList:null,
        hasBridge:false, folderGranted:false, folderScanning:false,
        thumbnails: {},
        viewerPage:0, viewerTotal:0, swiper:null,
        audioFiles:[], currentAudioDir:"", currentTrack:null, currentTrackName:'', playing:false,
        audioTime:0, audioDuration:0, sliderTime:0, isDragging:false,
        repeatMode:0, isShuffle:false,
        currentHowl: null,
        longPressTimer: null, ignoreClick: false,

        init() {
            const s = localStorage.getItem('appSettings');
            if(s) { _.assign(this.settings, JSON.parse(s)); }
            // 旧バージョンのカラー値を新パレットへ移行
            const colorMigration = { '#0095f6': '#7bb3d7', '#ff3b30': '#ff453a', '#ff9500': '#ff9f0a' };
            if(colorMigration[this.settings.accentColor]) this.settings.accentColor = colorMigration[this.settings.accentColor];
            delete this.settings.darkMode;
            const l = localStorage.getItem('appLibrary');
            if(l) this.library = JSON.parse(l);
            const lst = localStorage.getItem('appLists');
            if(lst) this.lists = JSON.parse(lst);

            this.$watch('settings', v => { localStorage.setItem('appSettings', JSON.stringify(v)); this.applyTheme(); this._viewerDirty = true; });

            this.applyTheme();

            // さきいかビルダーのブリッジは注入タイミングが前後しうるため、しばらくポーリングして検出する
            this.detectBridge();

            this._saveMetaDebounced = _.debounce(() => this.saveMeta(), 500);

            window.addEventListener('popstate', (e) => { if(e.state && e.state.page) { this._fromPopstate = true; this.page = e.state.page; } });
            history.replaceState({page: this.page}, '', `#${this.page}`);
            this.$watch('page', (val) => {
                if(val === 'profile') this.calculateStorageUsage();
                if(this._fromPopstate) { this._fromPopstate = false; }
                else { history.pushState({page: val}, '', `#${val}`); }
                if(val === 'reels' && this.currentItem && this.currentItem.type === 'book') {
                    this.$nextTick(() => {
                        // 設定変更が無ければ再構築せずサイズ更新のみ (タブ切替時の再描画防止)
                        if(this._viewerDirty || !this.swiper) { this.buildSwiper(); this._viewerDirty = false; }
                        else { this.swiper.update(); }
                    });
                }
            });
        },

        applyTheme() {
            document.documentElement.style.setProperty('--primary-color', this.settings.accentColor);
            document.body.style.setProperty('--primary-color', this.settings.accentColor);
            const light = this.settings.theme === 'light';
            document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
            const meta = document.querySelector('meta[name="theme-color"]');
            if(meta) meta.setAttribute('content', light ? '#f9f9fb' : '#000000');
            // アプリ内ではステータスバー/ナビゲーションバーの配色も切り替える
            if(window.Android && Android.available && Android.ui) {
                Android.ui.setDark({ dark: !light }).catch(() => {});
            }
        },

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
            if(!this.currentList) return [];
            const items = _.filter(this.library, i => this.currentList.items.includes(i.id));
            return items.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }));
        },

        async handleFile(e, type) {
            const files = e.target.files;
            if(!files.length) return;
            this.loading.show = true;
            this.loading.minimal = false;
            this.loading.text = "処理中...";

            let count = 0;
            for(const f of files) {
                count++;
                this.loading.progress = (count / files.length) * 100;
                this.loading.subText = f.name;
                const id = Date.now() + Math.floor(Math.random()*1000);
                let thumb = null;
                let title = f.name.replace(/\.(zip|cbz|pdf|mp3|wav|ogg|oga|m4a|flac|aac|opus|mp4|webm|m4v|mov)$/i,'');
                let author = '不明';

                try {
                    if(f.type === 'application/pdf' || f.name.match(/\.pdf$/i)) {
                        this.loading.text = "PDF変換中...";
                        this.loading.subText = "ページ解析を開始します";
                        const pdfData = await f.arrayBuffer();
                        const pdf = await pdfjsLib.getDocument({data: pdfData}).promise;
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
                            if(i===1) { await db.files.put(blob, id+'_thumb'); thumb = true; }
                        }
                        this.loading.subText = "ファイルを保存中...";
                        const newZipBlob = await zipWriter.close();
                        await db.files.put({zipBlob: newZipBlob}, id);
                        this.library.push({ id, type: 'book', title: title, author: author, isAdult: false, hasThumb: !!thumb, bookmarks: [] });
                    }
                    else if(f.name.match(/\.(zip|cbz)$/i)) {
                        const r = createZipReader(f);
                        const es = await r.getEntries();
                        const infoEntry = _.find(es, x => x.filename.toLowerCase() === 'comicinfo.xml');
                        if(infoEntry) {
                            const text = await infoEntry.getData(new zip.TextWriter());
                            const parser = new DOMParser();
                            const doc = parser.parseFromString(text, "application/xml");
                            const s = doc.querySelector('Series')?.textContent;
                            const p = doc.querySelector('Penciller')?.textContent || doc.querySelector('Writer')?.textContent;
                            if(s) title = s;
                            if(p) author = p;
                        }
                        const imgs = _.filter(es, x => !x.directory && x.filename.match(IMG_REGEX)).sort((a,b)=>a.filename.localeCompare(b.filename, undefined, {numeric:true}));
                        if(imgs.length > 0) thumb = await imgs[0].getData(new zip.BlobWriter());
                        r.close();
                        await db.files.put({zipBlob:f}, id);
                        if(thumb) await db.files.put(thumb, id+'_thumb');
                        this.library.push({ id, type: type, title: title, author: author, isAdult: false, hasThumb: !!thumb, bookmarks: [] });
                    }
                    else {
                        await db.files.put(f, id);
                        this.library.push({ id, type: type, title: title, author: author, isAdult: false, hasThumb: false, bookmarks: [] });
                    }
                } catch(e){ console.error(e); this.showToast("取り込みエラー: " + f.name); }
                await new Promise(r=>setTimeout(r,10));
            }
            this.saveMeta();
            this.loading.show = false; e.target.value = '';
            this.showToast(count+"件追加しました");
        },

        async loadThumb(id) {
            if(this.thumbnails[id]) return;
            try { const blob = await db.files.get(id+'_thumb'); if(blob) this.thumbnails[id] = URL.createObjectURL(blob); } catch(e) {}
        },

        /* ===== ライブラリフォルダ (さきいかビルダー / SAF) ===== */

        detectBridge() {
            let tries = 0;
            const check = () => {
                if(window.Android && Android.available && Android.fs) {
                    this.hasBridge = true;
                    this.initFolder();
                    return;
                }
                if(++tries < 40) setTimeout(check, 100);
            };
            check();
        },
        async initFolder() {
            try {
                const root = await Android.fs.root();
                if(root && root.kind === 'tree') { this.folderGranted = true; await this.scanFolder(); }
                else { this.folderGranted = false; }
            } catch(e) { this.folderGranted = false; }
        },
        async selectFolder() {
            try {
                const r = await Android.fs.chooseRoot();
                if(r && r.ok !== false) { this.folderGranted = true; this.scanFolder(); }
                else { this.showToast('フォルダが選択されませんでした'); }
            } catch(e) { this.showToast('フォルダ選択を開けませんでした'); }
        },
        pathId(path) {
            let h = 5381;
            for(let i = 0; i < path.length; i++) { h = ((h * 33) ^ path.charCodeAt(i)) >>> 0; }
            return 'p_' + h.toString(36) + '_' + path.length;
        },
        async scanFolder() {
            if(this.folderScanning) return;
            this.folderScanning = true;
            try {
                const found = [];
                await this._walkFolder('', found, 0);
                const byPath = {};
                this.library.forEach(i => { if(i.path) byPath[i.path] = i; });
                const keep = this.library.filter(i => !i.path);
                const items = found.map(f => {
                    const existing = byPath[f.path];
                    if(existing) return existing;
                    const ext = f.name.split('.').pop().toLowerCase();
                    const isBook = ['zip','cbz','pdf'].includes(ext);
                    return {
                        id: this.pathId(f.path), path: f.path,
                        type: isBook ? 'book' : 'audio',
                        title: f.name.replace(/\.[^.]+$/, ''), author: '不明',
                        isAdult: false, hasThumb: false, bookmarks: [], indexed: false
                    };
                });
                this.library = keep.concat(items);
                this.saveMeta();
                this.processIndexQueue();
            } catch(e) { console.error(e); this.showToast('フォルダを読み込めませんでした'); }
            this.folderScanning = false;
        },
        async _walkFolder(dir, found, depth) {
            if(depth > 6) return;
            const r = await Android.fs.list({ path: dir });
            for(const e of (r.entries || [])) {
                if(!e.name || e.name.startsWith('.')) continue;
                const p = dir ? dir + '/' + e.name : e.name;
                if(e.isDir) { await this._walkFolder(p, found, depth + 1); }
                else if(LIB_FILE_REGEX.test(e.name)) { found.push({ path: p, name: e.name, size: e.size }); }
            }
        },
        // 新規ファイルの種別判定とサムネイル生成をバックグラウンドで順次行う
        async processIndexQueue() {
            if(this._indexing) return;
            this._indexing = true;
            for(const item of this.library) {
                if(!item.path || item.indexed) continue;
                try { await this.indexFolderItem(item); }
                catch(e) { console.error('index error:', item.path, e); item.indexed = true; }
                this.saveMeta();
                await new Promise(r => setTimeout(r, 30));
            }
            this._indexing = false;
        },
        async indexFolderItem(item) {
            const ext = item.path.split('.').pop().toLowerCase();
            if(!['zip','cbz'].includes(ext)) { item.indexed = true; return; }
            // サムネイル作成は目次と先頭画像しか読まないため、全体の先読みはしない
            const src = new SakiikaRandomReader(item.path, { noPrefetch: true });
            const r = new zip.ZipReader(src, { filenameEncoding: 'shift-jis' });
            try {
                const es = await r.getEntries();
                const hasMedia = es.some(x => !x.directory && MEDIA_REGEX.test(x.filename));
                item.type = hasMedia ? 'audio' : 'book';
                const infoEntry = _.find(es, x => x.filename.toLowerCase() === 'comicinfo.xml');
                if(infoEntry) {
                    const text = await infoEntry.getData(new zip.TextWriter());
                    const doc = new DOMParser().parseFromString(text, 'application/xml');
                    const s = doc.querySelector('Series')?.textContent;
                    const p = doc.querySelector('Penciller')?.textContent || doc.querySelector('Writer')?.textContent;
                    if(s) item.title = s;
                    if(p) item.author = p;
                }
                const imgs = _.filter(es, x => !x.directory && x.filename.match(IMG_REGEX))
                    .sort((a,b) => a.filename.localeCompare(b.filename, undefined, {numeric:true}));
                if(imgs.length > 0) {
                    const blob = await imgs[0].getData(new zip.BlobWriter());
                    const small = await this.shrinkImage(blob);
                    await db.files.put(small, item.id + '_thumb');
                    item.hasThumb = true;
                }
            } finally {
                try { await r.close(); } catch(e) {}
                await src.dispose();
            }
            item.indexed = true;
        },
        // キャッシュ節約のためサムネイルを縮小して保存する
        async shrinkImage(blob) {
            try {
                const url = URL.createObjectURL(blob);
                const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
                const scale = Math.min(1, 480 / Math.max(img.width, img.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(img.width * scale));
                canvas.height = Math.max(1, Math.round(img.height * scale));
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                URL.revokeObjectURL(url);
                const out = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.82));
                return out || blob;
            } catch(e) { return blob; }
        },
        // SAF上のファイル全体をBlobとして読み込む (PDFなど)
        async readPathBlob(path, mime) {
            const src = new SakiikaRandomReader(path);
            await src.init();
            try {
                const blob = await src.whole(p => { this.loading.progress = p; });
                return mime ? new Blob([blob], { type: mime }) : blob;
            } finally { await src.dispose(); }
        },

        async openPathItem(item) {
            const ext = item.path.split('.').pop().toLowerCase();
            if(['zip','cbz'].includes(ext)) {
                // まず目次だけを reflect で即読みし、全体先読みの要否は種別とサイズで決める
                const src = new SakiikaRandomReader(item.path, { noPrefetch: true });
                const r = new zip.ZipReader(src, { filenameEncoding: 'shift-jis' });
                const es = await r.getEntries();
                this._openSrcReader = src;
                if(item.type === 'book') {
                    src.startPrefetch();   // 漫画はランダムアクセスが主なので全体 Blob 化が最速
                    const imgs = _.filter(es, x => !x.directory && x.filename.match(IMG_REGEX))
                        .sort((a,b) => a.filename.localeCompare(b.filename, undefined, {numeric:true}));
                    this.initViewer(imgs.length, (i) => imgs[i].getData(new zip.BlobWriter()));
                    this._viewerDirty = false;
                } else {
                    // 音声: 巨大な作品はファイル全体の複製を作らず reflect 直読みで展開する
                    if(src.size <= 1.5 * 1024 * 1024 * 1024) src.startPrefetch();
                    this._allAudioEntries = es;
                    this.renderAudioDir("");
                    this._audioAlbum = item;
                    this.cacheAlbumTracks();
                }
                this.page = 'reels';
            } else if(ext === 'pdf') {
                this.loading.minimal = false;
                this.loading.text = 'PDF読み込み中...';
                const blob = await this.readPathBlob(item.path, 'application/pdf');
                const pdf = await pdfjsLib.getDocument({ data: await blob.arrayBuffer() }).promise;
                this._openPdfDoc = pdf;
                this.initViewer(pdf.numPages, (i) => this.renderPdfPage(pdf, i + 1));
                this._viewerDirty = false;
                if(!item.hasThumb) {
                    this.renderPdfPage(pdf, 1).then(async (pageBlob) => {
                        const small = await this.shrinkImage(pageBlob);
                        await db.files.put(small, item.id + '_thumb');
                        item.hasThumb = true;
                        this.saveMeta();
                    }).catch(() => {});
                }
                this.page = 'reels';
            } else {
                // 単体の音声/動画ファイル: content URIで直接再生する
                this.loadThumb(item.id);
                const name = item.path.split('/').pop();
                let url = null;
                try { url = (await Android.fs.stat({ path: item.path })).uri || null; } catch(e) {}
                this._allAudioEntries = [];
                this.currentAudioDir = "";
                this.audioFiles = [{
                    type: VIDEO_REGEX.test(name) ? 'file_video' : 'file_audio',
                    name, full: 'saf_' + item.id, url, path: item.path
                }];
                this.page = 'reels';
            }
        },

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
                this._albumCacheToken = (this._albumCacheToken || 0) + 1;
                this._trackCache = {};
                this._partialInfo = null; this._pendingFullSwap = null;
                this._resumeAt = null; this._awaitFullResume = false;
                if(this._openSrcReader) {
                    await this._openSrcReader.dispose();
                    this._openSrcReader = null;
                    // 破棄したZIPに紐づくトラックは読めないため自動送りの対象から外す
                    if(this.playlist) this.playlist = this.playlist.filter(t => t.blob || t.url);
                }
                if(this._openZipReader) { try { await this._openZipReader.close(); } catch(e) {} this._openZipReader = null; }
                if(this._openPdfDoc) { try { this._openPdfDoc.destroy(); } catch(e) {} this._openPdfDoc = null; }
                this._audioAlbum = null;
                if(item.path) {
                    await this.openPathItem(item);
                    this.loading.show = false;
                    return;
                }
                const data = await db.files.get(item.id);
                if(item.isPdf && data.pdfBlob) {
                    this.showToast("古い形式のPDFです。再インポートすると高速化されます");
                    const arrayBuffer = await data.pdfBlob.arrayBuffer();
                    const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
                    this._openPdfDoc = pdf;
                    this.initViewer(pdf.numPages, (i) => this.renderPdfPage(pdf, i + 1));
                    this.page = 'reels';
                }
                else if(item.type === 'book' && data.zipBlob) {
                    const r = createZipReader(data.zipBlob);
                    const es = await r.getEntries();
                    const imgs = _.filter(es, x => !x.directory && x.filename.match(IMG_REGEX)).sort((a,b)=>a.filename.localeCompare(b.filename, undefined, {numeric:true}));
                    this._openZipReader = r; // ページ読み込みのため開いたままにする
                    this.initViewer(imgs.length, (i) => imgs[i].getData(new zip.BlobWriter()));
                    this.page = 'reels';
                } else {
                    this.loadThumb(item.id);
                    if(data && data.zipBlob) {
                        const r = createZipReader(data.zipBlob);
                        const es = await r.getEntries();
                        this._openZipReader = r;
                        this._allAudioEntries = es;
                        this.renderAudioDir("");
                        this.cacheAlbumTracks();
                    } else if(data instanceof Blob) {
                        // ZIPではない単体の音声/動画ファイル
                        this._allAudioEntries = [];
                        this.currentAudioDir = "";
                        const fname = data.name || item.title;
                        const isVideo = (data.type || '').startsWith('video') || /\.(mp4|webm|m4v|mov)$/i.test(fname);
                        this.audioFiles = [{ type: isVideo ? 'file_video' : 'file_audio', name: fname, full: 'single_' + item.id, blob: data }];
                    }
                    this.page = 'reels';
                }
            } catch(e) { console.error(e); this.showToast("読み込みエラーが発生しました"); }
            this.loading.show = false;
        },

        selectAll() { this.selectedIds = (this.page === 'lists' && this.currentList) ? this.getListItems().map(i => i.id) : this.filteredLibrary.map(i => i.id); },
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
        async saveEdit() {
            this.loading.show = true;
            this.loading.minimal = false;
            this.loading.text = "保存中...";
            this.loading.subText = "ファイルを更新しています";
            const targets = this.editModal.isBatch ? this.selectedIds : [this.editModal.id];
            let count = 0;
            for (const id of targets) {
                const item = _.find(this.library, {id});
                if (!item) continue;
                let newAuthor = item.author;
                let newAdult = item.isAdult;
                let newTitle = item.title;
                if (this.editModal.isBatch) {
                    if (this.editModal.author && this.editModal.author.trim() !== "") newAuthor = this.editModal.author;
                    if (this.editModal.batchAdultMode === 'true') newAdult = true;
                    else if (this.editModal.batchAdultMode === 'false') newAdult = false;
                } else {
                    newTitle = this.editModal.title;
                    newAuthor = this.editModal.author;
                    newAdult = this.editModal.isAdult;
                }
                item.title = newTitle;
                item.author = newAuthor;
                item.isAdult = newAdult;
                try {
                    if(!this.editModal.isBatch && this.editModal.tempThumb) {
                        const resp = await fetch(this.editModal.tempThumb);
                        const blob = await resp.blob();
                        await db.files.put(blob, item.id+'_thumb');
                        this.thumbnails[item.id] = this.editModal.tempThumb;
                        item.hasThumb = true;
                    }
                    if(item.type === 'book' && !item.isPdf && !item.path) {
                        const fileEntry = await db.files.get(item.id);
                        if(fileEntry && fileEntry.zipBlob) {
                            const zipReader = createZipReader(fileEntry.zipBlob);
                            const entries = await zipReader.getEntries();
                            let xmlContent = `<?xml version="1.0"?>\n<ComicInfo>\n  <Series>${_.escape(item.title)}</Series>\n  <Penciller>${_.escape(item.author)}</Penciller>\n  <Title>${_.escape(item.title)}</Title>\n</ComicInfo>`;
                            const existingXml = _.find(entries, e => e.filename.toLowerCase() === 'comicinfo.xml');
                            if(existingXml) {
                                const text = await existingXml.getData(new zip.TextWriter());
                                const parser = new DOMParser();
                                const doc = parser.parseFromString(text, "application/xml");
                                let seriesNode = doc.querySelector('Series');
                                if(!seriesNode) { seriesNode = doc.createElement('Series'); doc.documentElement.appendChild(seriesNode); }
                                seriesNode.textContent = item.title;
                                let pencillerNode = doc.querySelector('Penciller');
                                if(!pencillerNode) { pencillerNode = doc.createElement('Penciller'); doc.documentElement.appendChild(pencillerNode); }
                                pencillerNode.textContent = item.author;
                                const serializer = new XMLSerializer();
                                xmlContent = serializer.serializeToString(doc);
                            }
                            const zipWriter = new zip.ZipWriter(new zip.BlobWriter("application/zip"));
                            for (const entry of entries) {
                                if (entry.filename.toLowerCase() !== 'comicinfo.xml') {
                                    const writer = entry.directory ? undefined : new zip.BlobWriter();
                                    const data = entry.directory ? undefined : await entry.getData(writer);
                                    await zipWriter.add(entry.filename, data ? new zip.BlobReader(data) : undefined, { directory: entry.directory });
                                }
                            }
                            await zipWriter.add("ComicInfo.xml", new zip.TextReader(xmlContent));
                            await zipReader.close();
                            const newBlob = await zipWriter.close();
                            await db.files.put({zipBlob: newBlob}, item.id);
                        }
                    }
                } catch(e) { console.error("Save error for " + item.title, e); }
                count++;
                this.loading.progress = (count / targets.length) * 100;
            }
            this.saveMeta();
            this.showToast("保存しました");
            this.loading.show = false;
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
                let r = null;
                if(item && item.path && /\.(zip|cbz)$/i.test(item.path)) {
                    r = new zip.ZipReader(new SakiikaRandomReader(item.path, { noPrefetch: true }), { filenameEncoding: 'shift-jis' });
                } else {
                    const data = await db.files.get(this.editModal.id);
                    if(data && data.zipBlob) r = createZipReader(data.zipBlob);
                }
                if(r) {
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
                if(this._tempZipReader) this._tempZipReader.close();
            } catch(e) { console.error(e); this.showToast("表紙を読み込めませんでした"); }
            this.loading.show = false;
        },

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
                    if(rel.match(/\.(mp3|wav|ogg|oga|m4a|flac|aac|opus)$/i)) res.push({ type: 'file_audio', name: rel, full: p, entry });
                    else if(rel.match(/\.(mp4|webm|m4v|mov)$/i)) res.push({ type: 'file_video', name: rel, full: p, entry });
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
            if(this.currentAudioDir === "") { this.page = 'home'; return; }
            const p = this.currentAudioDir.split('/'); p.pop(); p.pop();
            this.renderAudioDir(p.length > 0 ? p.join('/') + '/' : "");
        },

        // 音声アルバムの全トラックを裏で展開キャッシュし、どのトラックを選んでも即再生できるようにする。
        // 全体先読みの完了は待たず、開いた直後から表示順に展開を始める。
        // ユーザーがトラックをタップしたときは、そのオンデマンド展開を優先して裏の展開を一時停止する。
        async cacheAlbumTracks() {
            const token = this._albumCacheToken = (this._albumCacheToken || 0) + 1;
            const entries = _.filter(this._allAudioEntries || [],
                e => !e.directory && MEDIA_REGEX.test(e.filename) && !VIDEO_REGEX.test(e.filename));
            this._trackCache = {};
            if(entries.length === 0) return;
            for(const entry of entries) {
                if(token !== this._albumCacheToken) return;
                if(this._trackCache[entry.filename]) continue;
                while(this._onDemandExtracting) {
                    await new Promise(r => setTimeout(r, 150));
                    if(token !== this._albumCacheToken) return;
                }
                try {
                    const blob = await entry.getData(new zip.BlobWriter());
                    if(token !== this._albumCacheToken) return;
                    this._trackCache[entry.filename] = blob;
                } catch(e) {}
            }
        },
        // WAV ストリーミング再生の開始: 先頭ブロックの展開完了で部分Blobを返し、
        // 残りは裏で展開を続けて完了後に _pendingFullSwap へ積む
        async startProgressiveTrack(f) {
            const reader = this._openSrcReader;
            const entry = f.entry;
            const token = this._albumCacheToken || 0;
            this._onDemandExtracting = (this._onDemandExtracting || 0) + 1;
            this.loading.show = true; this.loading.minimal = false;
            this.loading.text = 'トラック展開中...'; this.loading.progress = 0;
            let headResolve;
            const headPromise = new Promise(res => { headResolve = res; });
            const run = extractEntryProgressive(reader, entry, {
                headBytes: 12 * 1024 * 1024,
                isAlive: () => (this._albumCacheToken || 0) === token && this._openSrcReader === reader,
                onHead: (blob, wavMeta) => {
                    if(blob.size < entry.uncompressedSize) {
                        let coverage = 0;
                        if(wavMeta && wavMeta.byteRate) coverage = Math.max(0, (blob.size - wavMeta.dataOffset) / wavMeta.byteRate);
                        this._partialInfo = { full: f.full, coverage };
                    }
                    headResolve(blob);
                },
                onProgress: (done, total) => { if(total) this.loading.progress = done / total * 100; }
            });
            run.then((fullBlob) => {
                if(this._trackCache && (this._albumCacheToken || 0) === token) this._trackCache[entry.filename] = fullBlob;
                if(this._partialInfo && this._partialInfo.full === f.full) {
                    this._pendingFullSwap = { full: f.full, f };
                    if(this._awaitFullResume) {
                        this._awaitFullResume = false;
                        this.loading.show = false;
                        this.maybeSwapToFull(this._partialInfo.coverage || null);
                    }
                }
            }).catch(() => {}).finally(() => { this._onDemandExtracting--; });
            try {
                return await Promise.race([headPromise, run]);
            } finally { this.loading.show = false; }
        },
        // 全体版が揃っていれば現在位置を引き継いで差し替える
        maybeSwapToFull(targetTime) {
            const pend = this._pendingFullSwap;
            if(!pend || pend.full !== this.currentTrack) return false;
            const cached = (this._trackCache && pend.f.entry) ? this._trackCache[pend.f.entry.filename] : null;
            if(!cached) return false;
            const pos = targetTime != null ? targetTime : (this.currentHowl ? (this.currentHowl.seek() || 0) : 0);
            this._pendingFullSwap = null;
            this._partialInfo = null;
            this._resumeAt = pos;
            this.playAudioFile(pend.f);
            return true;
        },
        async playAudioFile(f) {
            if(f.type === 'folder') { this.renderAudioDir(f.full); return; }
            if(f.type === 'file_image') { this.viewImage(f); return; }
            if(f.type === 'text') { this.viewText(f); return; }
            if(f.type === 'file_video') { this.playVideo(f); return; }

            if(this.currentHowl) { this.currentHowl.unload(); this.currentHowl = null; }
            if(this._trackUrl) { URL.revokeObjectURL(this._trackUrl); this._trackUrl = null; }
            // 別トラックへ移るときはプログレッシブ再生の状態を破棄 (差し替え再入時は同一トラックなので保持)
            if(this.currentTrack !== f.full) {
                this._partialInfo = null; this._pendingFullSwap = null; this._resumeAt = null;
                if(this._awaitFullResume) { this._awaitFullResume = false; this.loading.show = false; }
            }
            let url;
            try {
                if(f.url) {
                    // 選択フォルダー内ファイルのcontent URIをそのまま再生 (コピー転送なし)
                    url = f.url;
                } else {
                    const cached = (f.entry && this._trackCache) ? this._trackCache[f.entry.filename] : null;
                    let b = f.blob || cached;
                    if(!b && f.entry && this._openSrcReader && /\.wav$/i.test(f.name)
                        && typeof f.entry.offset === 'number' && typeof f.entry.compressedSize === 'number') {
                        // WAV ストリーミング再生: 先頭 (約1分強) だけ展開して即再生し、
                        // 残りは同じストリームで裏展開 → 完了後に自然なタイミングで全体版へ差し替える
                        b = await this.startProgressiveTrack(f);
                    } else if(!b) {
                        // タップされたトラックを最優先で展開する (裏のキャッシュ展開は一時停止)
                        this._onDemandExtracting = (this._onDemandExtracting || 0) + 1;
                        this.loading.show = true; this.loading.minimal = false;
                        this.loading.text = 'トラック展開中...'; this.loading.progress = 0;
                        try {
                            b = await f.entry.getData(new zip.BlobWriter(), {
                                onprogress: (done, total) => { if(total) this.loading.progress = done / total * 100; }
                            });
                        } finally {
                            this._onDemandExtracting--;
                            this.loading.show = false;
                        }
                    }
                    if(f.entry && this._trackCache && !this._partialInfo && !this._trackCache[f.entry.filename]) this._trackCache[f.entry.filename] = b;
                    url = URL.createObjectURL(b);
                    this._trackUrl = url;
                }
            } catch(e) {
                console.error(e);
                this.showToast('再生できません。アルバムを開き直してください');
                return;
            }
            const ext = f.name.split('.').pop().toLowerCase();
            this.currentTrack = f.full;
            this.currentTrackName = f.name.replace(/\.[^.]+$/, '');
            this.playlist = _.filter(this.audioFiles, {type:'file_audio'});
            this.audioTime = 0; this.sliderTime = 0; this.audioDuration = 0;
            this.currentHowl = new Howl({
                src: [url], format: [ext], html5: true,
                onplay: () => {
                    this.playing = true;
                    if(this._resumeAt != null) { const at = this._resumeAt; this._resumeAt = null; this.currentHowl.seek(at); }
                    this.audioDuration = this.currentHowl.duration();
                    this.updateMediaSession();
                    this.startStep();
                },
                onpause: () => this.playing = false,
                onend: () => {
                    if(this._partialInfo && this._partialInfo.full === this.currentTrack) {
                        // 部分データの終端に到達: 全体版が用意でき次第そこから再開する
                        const at = this._partialInfo.coverage || (this.currentHowl ? (this.currentHowl.seek() || 0) : 0);
                        if(this.maybeSwapToFull(at)) return;
                        this._awaitFullResume = true;
                        this.playing = false;
                        this.loading.show = true; this.loading.minimal = true; this.loading.text = '';
                        return;
                    }
                    if(this.repeatMode === 2) { this.currentHowl.play(); }
                    else { this.playing = false; this.nextTrack(true); }
                },
                onstop: () => this.playing = false,
                onloaderror: async () => {
                    // content URIが再生できない環境ではネイティブコピー→file://で再試行
                    if(f.url && f.path && !f._triedBlob) {
                        f._triedBlob = true;
                        try {
                            this.loading.show = true; this.loading.minimal = false; this.loading.text = "読み込み中...";
                            const blob = await this.readPathBlob(f.path);
                            this.loading.show = false;
                            this.playAudioFile(Object.assign({}, f, { url: null, blob }));
                            return;
                        } catch(e) { this.loading.show = false; }
                    }
                    this.playing = false;
                    this.showToast("このファイルは再生できません");
                },
                onplayerror: () => { this.currentHowl.once('unlock', () => this.currentHowl.play()); }
            });
            this.currentHowl.play();
        },

        updateMediaSession() {
            if(!('mediaSession' in navigator)) return;
            try {
                const art = this.currentItem ? this.thumbnails[this.currentItem.id] : null;
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: this.currentTrackName,
                    artist: (this.currentItem?.author && this.currentItem.author !== '不明') ? this.currentItem.author : '',
                    album: this.currentItem?.title || '',
                    artwork: art ? [{ src: art, sizes: '512x512' }] : []
                });
                navigator.mediaSession.setActionHandler('play', () => this.togglePlay());
                navigator.mediaSession.setActionHandler('pause', () => this.togglePlay());
                navigator.mediaSession.setActionHandler('previoustrack', () => this.prevTrack());
                navigator.mediaSession.setActionHandler('nexttrack', () => this.nextTrack());
            } catch(e) { /* MediaMetadata非対応環境は無視 */ }
        },

        async playVideo(f) {
            if(this.currentHowl) { this.currentHowl.stop(); }
            this.loading.show = true;
            try {
                let url = f.url;
                if(!url) {
                    const blob = f.blob || await f.entry.getData(new zip.BlobWriter());
                    if(this._videoUrl) { URL.revokeObjectURL(this._videoUrl); }
                    url = URL.createObjectURL(blob);
                    this._videoUrl = url;
                }
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
            } catch(e) { console.error(e); this.showToast("動画を再生できませんでした"); }
            this.loading.show = false;
        },
        onVideoEnded() {
            this.videoPlayer.playing = false;
        },
        closeVideo() {
            const v = this.$refs.videoRef;
            v.pause();
            v.removeAttribute('src');
            v.load();
            if(this._videoUrl) { URL.revokeObjectURL(this._videoUrl); this._videoUrl = null; }
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
                const blob = await f.entry.getData(new zip.BlobWriter());
                this.imageViewer.src = URL.createObjectURL(blob);
                this.imageViewer.show = true;
            } catch(e) { console.error(e); this.showToast("画像を読み込めませんでした"); }
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
            } catch(e) { console.error(e); this.showToast("テキストを読み込めませんでした"); }
            this.loading.show = false;
        },

        startStep() {
            if(this._rafActive) return;
            this._rafActive = true;
            requestAnimationFrame(() => this.step());
        },
        step() {
            if (!this.currentHowl) { this._rafActive = false; return; }
            if (this.currentHowl.playing()) {
                const t = this.currentHowl.seek();
                if (typeof t === 'number') {
                    this.audioTime = t;
                    if (!this.isDragging) { this.sliderTime = t; }
                }
                const d = this.currentHowl.duration();
                if (d && d !== this.audioDuration) this.audioDuration = d;
                // 部分再生の終端が近づいたら、全体版へ位置を引き継いで差し替える
                if(this._partialInfo && this._partialInfo.full === this.currentTrack && this._pendingFullSwap
                    && this._partialInfo.coverage > 0 && typeof t === 'number' && t > this._partialInfo.coverage - 12) {
                    this.maybeSwapToFull();
                }
            }
            requestAnimationFrame(() => this.step());
        },
        togglePlay() { if(this.currentHowl) { this.currentHowl.playing() ? this.currentHowl.pause() : this.currentHowl.play(); } },
        seekAudio(v) {
            this.isDragging = false;
            if (!this.currentHowl) return;
            const t = parseFloat(v);
            if(this._partialInfo && this._partialInfo.full === this.currentTrack
                && this._partialInfo.coverage > 0 && t > this._partialInfo.coverage - 3) {
                // 展開済み範囲を超えるシーク: 全体版があれば差し替え、なければ端でとどめる
                if(this.maybeSwapToFull(t)) return;
                const clamp = Math.max(0, this._partialInfo.coverage - 3);
                this.currentHowl.seek(clamp);
                this.audioTime = clamp; this.sliderTime = clamp;
                this.showToast('この先はまだ展開中です');
                return;
            }
            this.currentHowl.seek(t);
            this.audioTime = t;
            this.sliderTime = t;
        },
        toggleRepeat() { this.repeatMode = (this.repeatMode+1)%3; this.showToast(this.repeatMode===0?"リピートOFF":this.repeatMode===1?"全曲リピート":"1曲リピート"); },
        toggleShuffle() { this.isShuffle = !this.isShuffle; this.showToast(this.isShuffle?"シャッフルON":"シャッフルOFF"); },
        prevTrack() {
            if(!this.playlist || this.playlist.length === 0 || !this.currentHowl) return;
            if(this.currentHowl.seek() > 3) { this.currentHowl.seek(0); return; }
            const idx = _.findIndex(this.playlist, {full: this.currentTrack});
            let prevIdx = idx - 1;
            if (prevIdx < 0) prevIdx = this.playlist.length - 1;
            this.playAudioFile(this.playlist[prevIdx]);
        },
        nextTrack(auto = false) {
            if(!this.playlist || this.playlist.length === 0) return;
            const idx = _.findIndex(this.playlist, {full: this.currentTrack});
            let nextIdx;
            if(this.isShuffle && this.playlist.length > 1) {
                do { nextIdx = Math.floor(Math.random() * this.playlist.length); } while(nextIdx === idx);
            } else {
                nextIdx = idx + 1;
                if(nextIdx >= this.playlist.length) {
                    if(auto && this.repeatMode !== 1) return;
                    nextIdx = 0;
                }
            }
            this.playAudioFile(this.playlist[nextIdx]);
        },

        /* ===== 漫画ビューアー (遅延ページ読み込み) =====
           全ページを事前に読み込まず、現在ページの前後2スライド分だけを
           読み込み・保持する。範囲外のページはBlob URLを解放してメモリを節約。 */

        initViewer(count, loader) {
            this._viewerToken = (this._viewerToken || 0) + 1;
            this.releaseViewerPages();
            this.viewerTotal = count;
            this._pageLoader = loader;
            this.buildSwiper();
        },
        releaseViewerPages() {
            Object.values(this._pageUrls || {}).forEach(u => URL.revokeObjectURL(u));
            this._pageUrls = {};
            this._pendingPages = {};
        },
        isDoubleMode() { return this.settings.doublePage && this.settings.scrollMode !== 'vertical'; },
        slideCount() {
            if(!this.isDoubleMode()) return this.viewerTotal;
            return this.viewerTotal <= 1 ? this.viewerTotal : 1 + Math.ceil((this.viewerTotal - 1) / 2);
        },
        pagesForSlide(s) {
            if(!this.isDoubleMode()) return [s];
            if(s === 0) return [0];
            const first = 2 * s - 1;
            const pages = [first];
            if(first + 1 < this.viewerTotal) pages.push(first + 1);
            return pages;
        },
        buildSwiper() {
            if(!this._pageLoader) return;
            const wrapper = document.getElementById('main-swiper').querySelector('.swiper-wrapper');
            const isV = this.settings.scrollMode === 'vertical';
            const dbl = this.isDoubleMode();
            const rtl = this.settings.direction === 'rtl';
            const wrapZoom = (content) => `<div class="swiper-zoom-container">${content}</div>`;
            const imgTag = (i, cls) => `<img class="page-img${cls ? ' ' + cls : ''}" data-page="${i}">`;
            const slides = [];
            if(!dbl) {
                for(let i = 0; i < this.viewerTotal; i++) slides.push(`<div class="swiper-slide">${wrapZoom(imgTag(i))}</div>`);
            } else {
                slides.push(`<div class="swiper-slide">${wrapZoom(imgTag(0))}</div>`);
                for(let i = 1; i < this.viewerTotal; i += 2) {
                    const a = imgTag(i, 'spread-page');
                    const b = i + 1 < this.viewerTotal ? imgTag(i + 1, 'spread-page') : '';
                    const content = `<div class="spread-container">${b ? (rtl ? b + a : a + b) : a}</div>`;
                    slides.push(`<div class="swiper-slide">${wrapZoom(content)}</div>`);
                }
            }
            wrapper.innerHTML = slides.join('');
            if(this.swiper) this.swiper.destroy();
            this.swiper = new Swiper('#main-swiper', { direction: isV?'vertical':'horizontal', zoom:true, spaceBetween: 0, centeredSlides: true, on: { slideChange: () => {
                this.viewerPage = this.swiper.activeIndex;
                if(this.currentItem) { this.currentItem.lastIndex = this.viewerPage; this._saveMetaDebounced(); }
                this.queuePageWindow();
            } } });
            if(rtl && !isV) this.swiper.changeLanguageDirection('rtl'); else this.swiper.changeLanguageDirection('ltr');
            if(this.settings.resume && this.currentItem && this.currentItem.lastIndex) {
                this.viewerPage = Math.min(this.currentItem.lastIndex, this.slideCount() - 1);
                this.swiper.slideTo(this.viewerPage, 0);
            }
            // 再構築時、読み込み済みページを再適用
            Object.entries(this._pageUrls || {}).forEach(([p, u]) => this.applyPageUrl(p, u));
            this.queuePageWindow();
        },
        applyPageUrl(page, url) {
            document.querySelectorAll(`#main-swiper img[data-page="${page}"]`)
                .forEach(el => { el.src = url; el.classList.add('page-loaded'); });
        },
        queuePageWindow() {
            clearTimeout(this._pageWindowTimer);
            this._pageWindowTimer = setTimeout(() => this.loadPageWindow(), 50);
        },
        async loadPageWindow() {
            if(!this._pageLoader || !this.swiper) return;
            const token = this._viewerToken;
            const active = this.swiper.activeIndex;
            const total = this.slideCount();
            // 現在→進行方向→逆方向 の優先順で読み込む (めくった向きを優先して先読み)
            const dir = (this._lastActiveSlide !== undefined && active < this._lastActiveSlide) ? -1 : 1;
            this._lastActiveSlide = active;
            const offs = dir >= 0 ? [0, 1, -1, 2, 3, -2] : [0, -1, 1, -2, -3, 2];
            const want = [];
            for(const off of offs) {
                const s = active + off;
                if(s < 0 || s >= total) continue;
                this.pagesForSlide(s).forEach(p => { if(!want.includes(p)) want.push(p); });
            }
            // 前後3スライドの範囲外は解放
            const keep = new Set();
            for(let s = active - 3; s <= active + 3; s++) {
                if(s < 0 || s >= total) continue;
                this.pagesForSlide(s).forEach(p => keep.add(p));
            }
            Object.keys(this._pageUrls).forEach(k => {
                const p = parseInt(k);
                if(!keep.has(p)) {
                    URL.revokeObjectURL(this._pageUrls[p]);
                    delete this._pageUrls[p];
                    document.querySelectorAll(`#main-swiper img[data-page="${p}"]`)
                        .forEach(el => { el.removeAttribute('src'); el.classList.remove('page-loaded'); });
                }
            });
            for(const p of want) {
                if(this._viewerToken !== token) return;
                if(this._pageUrls[p] || this._pendingPages[p]) continue;
                this._pendingPages[p] = true;
                try {
                    const blob = await this._pageLoader(p);
                    if(this._viewerToken === token && !this._pageUrls[p]) {
                        const url = URL.createObjectURL(blob);
                        this._pageUrls[p] = url;
                        this.applyPageUrl(p, url);
                    }
                } catch(e) { console.error('page load error:', p, e); }
                delete this._pendingPages[p];
            }
        },
        async renderPdfPage(pdf, pageNumber) {
            const pdfPage = await pdf.getPage(pageNumber);
            const viewport = pdfPage.getViewport({ scale: 1.5 });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            return await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.8));
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

        askConfirm(title, message, opts = {}) {
            this.confirmData.title = title;
            this.confirmData.message = message;
            this.confirmData.okText = opts.okText || 'OK';
            this.confirmData.danger = !!opts.danger;
            this.confirmData.onConfirm = opts.onConfirm || null;
            this.confirmData.show = true;
        },
        showSheet(title, actions) { this.sheetData.title = title; this.sheetData.actions = actions; this.sheetData.show = true; },
        runSheetAction(a) { this.sheetData.show = false; a.handler && a.handler(); },
        // ネイティブ<select>の代わりに使うiOS風の選択シート
        openPicker(key) {
            const defs = {
                theme: { title: 'テーマ', options: [['dark','ダーク'],['light','ライト']] },
                thumbSize: { title: 'サムネイルサイズ', options: [['small','小'],['medium','中'],['large','大']] },
                accentColor: { title: 'アクセントカラー', options: [['#7bb3d7','ブルー'],['#ff75a0','ピンク'],['#ff453a','レッド'],['#ff9f0a','オレンジ']] },
                scrollMode: { title: 'スクロール設定', options: [['horizontal','スワイプ'],['vertical','縦スクロール']] },
                direction: { title: '読む方向', options: [['rtl','右 → 左'],['ltr','左 → 右']] },
            };
            const def = defs[key];
            if(!def) return;
            this.showSheet(def.title, def.options.map(([value, label]) => ({
                label,
                active: this.settings[key] === value,
                handler: () => { this.settings[key] = value; }
            })));
        },
        openBatchAdultPicker() {
            const options = [['no_change','変更しない'],['true','成人向け (R-18) にする'],['false','一般 (全年齢) にする']];
            this.showSheet('成人向けタグ設定', options.map(([value, label]) => ({
                label,
                active: this.editModal.batchAdultMode === value,
                handler: () => { this.editModal.batchAdultMode = value; }
            })));
        },
        getBatchAdultLabel() {
            return { no_change: '変更しない', true: '成人向け (R-18) にする', false: '一般 (全年齢) にする' }[this.editModal.batchAdultMode] || '変更しない';
        },

        saveLists() { localStorage.setItem('appLists', JSON.stringify(this.lists)); },
        openPrompt(title, initial, onConfirm) {
            this.promptData.title = title;
            this.promptData.inputValue = initial || '';
            this.promptData.onConfirm = onConfirm;
            this.promptData.show = true;
            this.$nextTick(() => { this.$refs.promptInput.focus(); });
        },
        createList() {
            this.openPrompt('新しいリスト', '', (val) => {
                this.lists.push({id:Date.now(), title:val, items:[]});
                this.saveLists();
                this.showToast('リストを作成しました');
            });
        },
        createListAndAdd() {
            this.showListSelect = false;
            this.openPrompt('新しいリスト', '', (val) => {
                const l = {id:Date.now(), title:val, items:[]};
                this.lists.push(l);
                this.addSelectedToList(l);
            });
        },
        renameList(l) {
            this.openPrompt('リスト名を変更', l.title, (val) => {
                l.title = val;
                this.saveLists();
                this.showToast('変更しました');
            });
        },
        openListActions(l) {
            if(!l) return;
            this.showSheet(l.title, [
                { label: '名前を変更', handler: () => this.renameList(l) },
                { label: 'リストを削除', danger: true, handler: () => this.deleteList(l) },
            ]);
        },
        getListCoverIds(l) {
            return l.items.map(id => _.find(this.library, {id})).filter(i => i && i.hasThumb).slice(0, 3).map(i => i.id);
        },
        handleListClick(l) { if(this._listPressed) return; this.currentList = l; },
        listTouchStart(l) { this._listPressTimer = setTimeout(() => { this._listPressed = true; this.openListActions(l); navigator.vibrate?.(50); }, 500); },
        listTouchEnd() { clearTimeout(this._listPressTimer); if(this._listPressed) { setTimeout(() => { this._listPressed = false; }, 200); } },

        deleteList(l = this.currentList) {
            if(!l) return;
            this.askConfirm('リストを削除', `「${l.title}」を削除しますか？作品自体は削除されません。`, { okText: '削除', danger: true, onConfirm: () => {
                this.lists = _.reject(this.lists, {id: l.id});
                this.saveLists();
                if(this.currentList && this.currentList.id === l.id) this.currentList = null;
                this.showToast('削除しました');
            }});
        },

        touchStart(id) { this.longPressTimer = setTimeout(() => { this.ignoreClick = true; this.enterSelect(id); }, 500); },
        touchEnd() { clearTimeout(this.longPressTimer); if(this.ignoreClick) { setTimeout(() => { this.ignoreClick = false; }, 200); } },
        enterSelect(id) { this.selectionMode = true; this.selectedIds = [id]; navigator.vibrate?.(50); },
        exitSelectionMode() { this.selectionMode = false; this.selectedIds = []; },

        deleteSelectedItems() {
            const inList = this.page === 'lists' && this.currentList;
            const n = this.selectedIds.length;
            const targets = this.selectedIds.map(id => _.find(this.library, {id})).filter(Boolean);
            const pathTargets = targets.filter(i => i.path);
            const message = inList
                ? `選択した ${n} 件をこのリストから外しますか？作品自体は削除されません。`
                : (pathTargets.length > 0
                    ? `選択した ${n} 件を削除しますか？フォルダ内のファイル本体も端末から削除されます。この操作は取り消せません。`
                    : `選択した ${n} 件を完全に削除しますか？この操作は取り消せません。`);
            this.askConfirm(
                inList ? 'リストから削除' : '完全に削除',
                message,
                { okText: '削除', danger: true, onConfirm: async () => {
                    if(inList) {
                        this.currentList.items = _.difference(this.currentList.items, this.selectedIds);
                        this.saveLists();
                        this.showToast("リストから削除しました");
                    }
                    else {
                        for(const it of pathTargets) {
                            try { await Android.fs.delete({ path: it.path, recursive: true }); } catch(e) { console.error(e); }
                        }
                        db.files.bulkDelete(this.selectedIds);
                        this.selectedIds.forEach(id => db.files.delete(id+'_thumb'));
                        this.library = _.filter(this.library, i => !this.selectedIds.includes(i.id));
                        this.saveMeta();
                        this.showToast("削除しました");
                    }
                    this.selectionMode = false;
                    this.selectedIds = [];
                }}
            );
        },
        openToList() { this.showListSelect = true; },
        addSelectedToList(list) {
            list.items = _.union(list.items, this.selectedIds);
            this.saveLists();
            this.showListSelect = false;
            this.selectionMode = false;
            this.selectedIds = [];
            this.showToast("追加しました");
        },

        getLabel(val) { const map = {'small':'小','medium':'中','large':'大','horizontal':'スワイプ','vertical':'縦スクロール','rtl':'右→左','ltr':'左→右','dark':'ダーク','light':'ライト'}; return map[val] || val; },
        getColorName(c) { const map = {'#7bb3d7':'ブルー','#ff75a0':'ピンク','#ff453a':'レッド','#ff9f0a':'オレンジ'}; return map[c] || c; },

        async calculateStorageUsage() {
            this.storageSize = "計算中..."; let total = 0;
            await db.files.each(val => { if (val instanceof Blob) total += val.size; else if (val.zipBlob) total += val.zipBlob.size; else if(val.pdfBlob) total += val.pdfBlob.size; });
            if (total === 0) { this.storageSize = "0 MB"; return; }
            const k = 1024; const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']; const i = Math.floor(Math.log(total) / Math.log(k));
            this.storageSize = parseFloat((total / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        },

        deleteAll() {
            this.askConfirm('全データ削除', 'キャッシュ・リスト・設定がすべて削除されます。フォルダ内のファイル本体は削除されません。', { okText: '削除', danger: true, onConfirm: async () => {
                await db.files.clear(); localStorage.clear(); location.reload();
            }});
        },
        saveMeta() { localStorage.setItem('appLibrary', JSON.stringify(this.library)); },
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
