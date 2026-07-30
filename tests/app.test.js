const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function makeApp(storageValues = {}) {
    let alpineInit;
    let factory;
    const storage = new Map(Object.entries(storageValues));
    const revoked = [];

    class Reader {}
    class Dexie {
        constructor() {
            this.files = {
                clear: async () => {},
                delete: async () => {},
                bulkDelete: async () => {},
                get: async () => undefined,
                put: async () => {},
                each: async () => {},
            };
        }
        version() { return { stores: () => this }; }
    }

    const style = { setProperty() {} };
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        Blob,
        Uint8Array,
        ArrayBuffer,
        Intl,
        Set,
        Map,
        Promise,
        TextDecoder,
        DOMParser: class {},
        XMLSerializer: class {},
        Image: class {},
        MediaMetadata: class {},
        atob,
        fetch,
        setTimeout,
        clearTimeout,
        requestAnimationFrame() {},
        location: { reload() {} },
        history: { replaceState() {}, pushState() {} },
        navigator: {},
        localStorage: {
            getItem: key => storage.has(key) ? storage.get(key) : null,
            setItem: (key, value) => storage.set(key, value),
            clear: () => storage.clear(),
        },
        URL: {
            createObjectURL: () => 'blob:created',
            revokeObjectURL: value => revoked.push(value),
        },
        document: {
            addEventListener(name, callback) {
                if(name === 'alpine:init') alpineInit = callback;
            },
            documentElement: { style, setAttribute() {} },
            body: { style },
            querySelector: () => null,
            querySelectorAll: () => [],
            getElementById: () => ({ querySelector: () => ({ innerHTML: '' }) }),
            createElement: () => ({ getContext: () => ({}), toBlob: callback => callback(new Blob()) }),
        },
        window: {
            addEventListener() {},
            innerWidth: 1000,
        },
        pdfjsLib: { GlobalWorkerOptions: {}, getDocument() {} },
        zip: {
            Reader,
            ZipReader: class {},
            BlobReader: class {},
            BlobWriter: class {},
            TextWriter: class {},
            TextReader: class {},
            Uint8ArrayWriter: class {},
        },
        Dexie,
        Howl: class {},
        Swiper: class {},
    });
    context.window.window = context.window;
    context.window.document = context.document;
    context.window.Android = undefined;

    vm.runInContext(fs.readFileSync(path.join(root, 'lib/lodash.min.js'), 'utf8'), context);
    context._ = context.window._ || context._;
    context.Alpine = { data(name, value) { if(name === 'app') factory = value; } };
    vm.runInContext(fs.readFileSync(path.join(root, 'js/app.js'), 'utf8'), context);
    alpineInit();

    const app = factory();
    app.$watch = () => {};
    app.$nextTick = callback => callback();
    app.$refs = {};
    app.detectBridge = () => {};
    return { app, context, revoked, storage };
}

test('壊れた保存JSONがあっても既定値で起動できる', () => {
    const { app } = makeApp({
        appSettings: '{broken',
        appLibrary: 'null',
        appLists: '{"not":"an array"}',
    });
    assert.doesNotThrow(() => app.init());
    assert.equal(app.settings.theme, 'light');
    assert.deepEqual(Array.from(app.library), []);
    assert.deepEqual(Array.from(app.lists), []);
});

test('検索なしの一覧とローマ字検索が自然順で動作する', () => {
    const { app } = makeApp();
    app.library = [
        { id: 1, type: 'book', title: '本10', author: '不明' },
        { id: 2, type: 'book', title: 'かな2', author: 'さくら' },
        { id: 3, type: 'book', title: '本2', author: '不明' },
    ];
    assert.deepEqual(Array.from(app.filteredLibrary, item => item.id), [2, 3, 1]);
    app.searchQuery = 'sakura';
    assert.deepEqual(Array.from(app.filteredLibrary, item => item.id), [2]);
});

test('リスト抽出は対象作品だけを自然順で返す', () => {
    const { app } = makeApp();
    app.library = [
        { id: 'a', title: '12' },
        { id: 'b', title: '2' },
        { id: 'c', title: '1' },
    ];
    app.currentList = { items: ['a', 'b'] };
    assert.deepEqual(Array.from(app.getListItems(), item => item.id), ['b', 'a']);
});

test('見開きモードのスライド数とページ対応が正しい', () => {
    const { app } = makeApp();
    app.settings.doublePage = true;
    app.settings.scrollMode = 'horizontal';
    app.viewerTotal = 6;
    assert.equal(app.slideCount(), 4);
    assert.deepEqual(Array.from(app.pagesForSlide(0)), [0]);
    assert.deepEqual(Array.from(app.pagesForSlide(1)), [1, 2]);
    assert.deepEqual(Array.from(app.pagesForSlide(3)), [5]);
});

test('表紙・画像・サムネイルのBlob URLを差し替え時に解放する', () => {
    const { app, revoked } = makeApp();
    app.editModal.tempThumb = 'blob:temp';
    app.releaseTempThumb();
    app.imageViewer = { show: true, src: 'blob:image' };
    app.closeImageViewer();
    app.thumbnails.x = 'blob:old';
    app.replaceThumbnailUrl('x', 'blob:new');
    assert.deepEqual(revoked, ['blob:temp', 'blob:image', 'blob:old']);
    assert.equal(app.imageViewer.src, '');
    assert.equal(app.thumbnails.x, 'blob:new');
});

test('表紙候補のZIPとSAFリーダーを両方閉じる', async () => {
    const { app } = makeApp();
    let zipClosed = 0;
    let sourceDisposed = 0;
    app._tempZipReader = { close: async () => { zipClosed++; } };
    app._tempSrcReader = { dispose: async () => { sourceDisposed++; } };
    await app.closeCoverSource();
    assert.equal(zipClosed, 1);
    assert.equal(sourceDisposed, 1);
    assert.equal(app._tempZipReader, null);
    assert.equal(app._tempSrcReader, null);
});

test('音声ソース終了時に再生表示とリーダーを初期化する', async () => {
    const { app } = makeApp();
    let zipClosed = 0;
    let sourceDisposed = 0;
    app.audioFiles = [{ name: 'old.mp3' }];
    app.currentTrack = 'old.mp3';
    app.currentTrackName = 'old';
    app.audioTime = 10;
    app.audioDuration = 20;
    app._audioZipReader = { close: async () => { zipClosed++; } };
    app._audioSrcReader = { dispose: async () => { sourceDisposed++; } };
    await app.closeAudioSource();
    assert.equal(zipClosed, 1);
    assert.equal(sourceDisposed, 1);
    assert.deepEqual(Array.from(app.audioFiles), []);
    assert.equal(app.currentTrack, null);
    assert.equal(app.audioDuration, 0);
});

test('Base64ブリッジ変換とWAVメタデータ解析が正しい', () => {
    const { context } = makeApp();
    const bytes = vm.runInContext(`Array.from(decodeBase64Bytes('AAEC/w=='))`, context);
    assert.deepEqual(Array.from(bytes), [0, 1, 2, 255]);

    const wav = Buffer.alloc(44);
    wav.write('RIFF', 0);
    wav.write('WAVE', 8);
    wav.write('fmt ', 12);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt32LE(176400, 28);
    wav.write('data', 36);
    const parsed = vm.runInContext(`parseWavMeta(Uint8Array.from([${Array.from(wav)}]))`, context);
    assert.equal(parsed.byteRate, 176400);
    assert.equal(parsed.dataOffset, 44);
});

test('HTMLの閉じる操作がリソース解放メソッドへ接続されている', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.match(html, /@click="closeEditModal\(\)"/);
    assert.match(html, /@click="closeCoverSelector\(\)"/);
    assert.match(html, /@click="closeImageViewer\(\)"/);
    assert.doesNotMatch(html, /@click="coverSelector\.show=false"/);
});
