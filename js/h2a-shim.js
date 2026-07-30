/*!
 * h2a-shim.js — さきいかビルダー用 H2A 互換レイヤー
 * Copyright (c) 2026 SakiikaVR / MIT License
 *
 * MedjedBuilder の H2A ブリッジ API のうち、オンコミ本体 (app.js) が使う範囲を
 * さきいかビルダーのブリッジ (window.Android) の上に再現する。
 *   - requestStorage / list / exists / remove / toUrl
 *   - openRandom / readRandom / closeRandom (ZIP のランダムアクセス読み出し)
 * ネイティブ ZIP 展開系 (extractZip* / copyIn / writeText) は提供しない。
 * app.js 側は capability を確認して JS 実装へフォールバックする。
 *
 * パス規約: Medjed の "saf:相対パス" を、さきいか fs (folder_pick) の
 * 「選択フォルダー起点の相対パス」へ写像する。それ以外のパス
 * (アプリ専用キャッシュ "albums/…" など) は未対応として扱う。
 */
(function () {
    'use strict';
    if (typeof window.H2A !== 'undefined') return;              // 本物の H2A がいるなら何もしない
    if (!(window.Android && Android.available)) return;         // さきいかアプリ内でのみ有効

    var FS = Android.fs;
    var seq = 1;
    var handles = new Map();   // id -> {size, blob} | {size, refl:{pfd,fis,ch}}

    function safPath(p) {
        if (typeof p !== 'string' || p.indexOf('saf:') !== 0) return null;
        return p.slice(4).replace(/^\/+/, '');
    }

    /* content:// を XHR で Blob として読む (WebView は allowContentAccess 有効) */
    function fetchContentBlob(uri) {
        return new Promise(function (resolve, reject) {
            try {
                var x = new XMLHttpRequest();
                x.open('GET', uri, true);
                x.responseType = 'blob';
                x.onload = function () {
                    if (x.response && x.response.size > 0) resolve(x.response);
                    else reject(new Error('empty response'));
                };
                x.onerror = function () { reject(new Error('xhr error')); };
                x.send();
            } catch (e) { reject(e); }
        });
    }

    function blobToBase64(blob) {
        return new Promise(function (resolve, reject) {
            var r = new FileReader();
            r.onload = function () {
                var s = String(r.result);
                resolve(s.slice(s.indexOf(',') + 1));
            };
            r.onerror = function () { reject(r.error); };
            r.readAsDataURL(blob);
        });
    }

    /* ---- reflect フォールバック: FileChannel の位置指定読み出し ---- */
    async function openReflect(uri) {
        var R = Android.reflect;
        var ctx = await R.context();
        var resolver = await R.call({ ref: ctx.__ref, method: 'getContentResolver' });
        var uriObj = await R.staticCall({ class: 'android.net.Uri', method: 'parse', args: [uri] });
        var pfd = await R.call({ ref: resolver.__ref, method: 'openFileDescriptor', args: [{ __ref: uriObj.__ref }, 'r'] });
        var size = await R.call({ ref: pfd.__ref, method: 'getStatSize' });
        var fd = await R.call({ ref: pfd.__ref, method: 'getFileDescriptor' });
        var fis = await R['new']({ class: 'java.io.FileInputStream', args: [{ __ref: fd.__ref }] });
        var ch = await R.call({ ref: fis.__ref, method: 'getChannel' });
        try { await R.release({ ref: resolver.__ref }); } catch (e) {}
        try { await R.release({ ref: uriObj.__ref }); } catch (e) {}
        try { await R.release({ ref: fd.__ref }); } catch (e) {}
        return { pfd: pfd, fis: fis, ch: ch, size: Number(size) };
    }
    async function readReflect(refl, offset, length) {
        var R = Android.reflect;
        var bb = await R.staticCall({ class: 'java.nio.ByteBuffer', method: 'allocate', args: [length] });
        try {
            var n = await R.call({ ref: refl.ch.__ref, method: 'read', args: [{ __ref: bb.__ref }, { type: 'long', value: offset }] });
            if (typeof n !== 'number' || n <= 0) return '';
            var arr = await R.call({ ref: bb.__ref, method: 'array' });
            try {
                /* Base64.encodeToString(byte[], offset, count, NO_WRAP=2) */
                return await R.staticCall({ class: 'android.util.Base64', method: 'encodeToString', args: [{ __ref: arr.__ref }, 0, n, 2] });
            } finally {
                try { await R.release({ ref: arr.__ref }); } catch (e) {}
            }
        } finally {
            try { await R.release({ ref: bb.__ref }); } catch (e) {}
        }
    }
    async function closeReflect(refl) {
        var R = Android.reflect;
        try { await R.call({ ref: refl.ch.__ref, method: 'close' }); } catch (e) {}
        try { await R.call({ ref: refl.fis.__ref, method: 'close' }); } catch (e) {}
        try { await R.call({ ref: refl.pfd.__ref, method: 'close' }); } catch (e) {}
        [refl.ch, refl.fis, refl.pfd].forEach(function (h) {
            try { R.release({ ref: h.__ref }); } catch (e) {}
        });
    }

    async function statUri(rel) {
        var st = await FS.stat({ path: rel });
        if (!st || st.isDir || !st.uri) throw new Error('no uri for: ' + rel);
        return st;
    }

    window.H2A = {
        /* フォルダー選択。完了時に Medjed 互換の h2astorage イベントを発火する */
        requestStorage: function () {
            FS.chooseRoot().then(function (r) {
                window.dispatchEvent(new CustomEvent('h2astorage', { detail: { granted: !!(r && r.ok !== false) } }));
            }).catch(function () {
                window.dispatchEvent(new CustomEvent('h2astorage', { detail: { granted: false } }));
            });
        },

        /* "saf:dir" の一覧。Medjed 互換の {name, directory, size} 配列を返す */
        list: async function (p) {
            var rel = safPath(p);
            if (rel === null) throw new Error('unsupported path: ' + p);
            var root = await FS.root();
            if (!root || root.kind !== 'tree') throw new Error('folder not granted');
            var r = await FS.list({ path: rel, hidden: false });
            return (r.entries || []).map(function (e) {
                return { name: e.name, directory: !!e.isDir, size: e.size };
            });
        },

        exists: async function (p) {
            var rel = safPath(p);
            if (rel === null) return false;                      // キャッシュ領域は未対応
            try { return !!(await FS.exists({ path: rel })); } catch (e) { return false; }
        },

        remove: async function (p) {
            var rel = safPath(p);
            if (rel === null) throw new Error('unsupported path: ' + p);
            await FS.delete({ path: rel, recursive: true });
        },

        /* 再生用 URL: 選択フォルダー内ファイルの content:// URI をそのまま返す */
        toUrl: async function (p) {
            var rel = safPath(p);
            if (rel === null) throw new Error('unsupported path: ' + p);
            return (await statUri(rel)).uri;
        },

        /* ---- ランダムアクセス読み出し ---- */
        openRandom: async function (p) {
            var rel = safPath(p);
            if (rel === null) throw new Error('unsupported path: ' + p);
            var st = await statUri(rel);
            var id = seq++;
            var rec = null;
            try {
                var blob = await fetchContentBlob(st.uri);       // Blob はディスクバックで低メモリ
                rec = { size: blob.size || st.size, blob: blob };
            } catch (e) {
                var refl = await openReflect(st.uri);            // XHR 不可なら reflect で位置読み
                rec = { size: refl.size > 0 ? refl.size : st.size, refl: refl };
            }
            handles.set(id, rec);
            return { id: id, size: rec.size };
        },

        readRandom: async function (id, offset, length) {
            var rec = handles.get(id);
            if (!rec) throw new Error('bad handle: ' + id);
            if (offset >= rec.size) return '';
            var len = Math.min(length, rec.size - offset);
            if (rec.blob) return blobToBase64(rec.blob.slice(offset, offset + len));
            return readReflect(rec.refl, offset, len);
        },

        closeRandom: async function (id) {
            var rec = handles.get(id);
            handles.delete(id);
            if (rec && rec.refl) await closeReflect(rec.refl);
        }
    };
})();
