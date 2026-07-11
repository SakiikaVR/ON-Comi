/*!
 * Media Library - app.js
 * オフラインで動作する漫画・音声・動画ライブラリ
 * Licensed under the MIT License. See LICENSE file in the project root.
 *
 * Third-party libraries (loaded via CDN, see credit.html for licenses):
 *   Alpine.js (MIT), @alpinejs/intersect (MIT), Dexie.js (Apache-2.0),
 *   zip.js (BSD-3-Clause), Lodash (MIT), Howler.js (MIT),
 *   PDF.js (Apache-2.0), Swiper (MIT)
 * Inline SVG icons are based on Feather Icons (MIT).
 */

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

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
        settings: { thumbSize:'small', accentColor:'#0095f6', darkMode:false, showAdult:true, scrollMode:'horizontal', direction:'rtl', doublePage:false, resume:true },
        filter:'all', searchQuery:'', selectionMode:false, selectedIds:[],
        loading:{show:false, text:'', progress:0, subText:'', minimal:false}, toast:{show:false, message:''},
        showAddMenu:false, showViewerMenu:false, showBookmarksModal:false, showListSelect:false,
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

        init() {
            const s = localStorage.getItem('appSettings');
            if(s) { _.assign(this.settings, JSON.parse(s)); }
            const l = localStorage.getItem('appLibrary');
            if(l) this.library = JSON.parse(l);
            const lst = localStorage.getItem('appLists');
            if(lst) this.lists = JSON.parse(lst);

            this.$watch('settings', v => { localStorage.setItem('appSettings', JSON.stringify(v)); this.applyTheme(); });

            this.applyTheme();

            window.addEventListener('popstate', (e) => { if(e.state && e.state.page) this.page = e.state.page; });
            this.$watch('page', (val) => {
                if(val === 'profile') this.calculateStorageUsage();
                history.pushState({page: val}, '', `#${val}`);
                if(val === 'reels' && this.currentItem && this.currentItem.type === 'book') { this.$nextTick(() => this.setupSwiper(this.viewerTotal ? null : [])); }
            });
        },

        applyTheme() {
            document.body.classList.toggle('dark-mode', this.settings.darkMode);
            document.documentElement.style.setProperty('--primary-color', this.settings.accentColor);
            document.body.style.setProperty('--primary-color', this.settings.accentColor);

            const sysColor = this.settings.darkMode ? '#121212' : '#ffffff';
            const metaThemeColor = document.querySelector('meta[name="theme-color"]');
            if(metaThemeColor) metaThemeColor.setAttribute('content', sysColor);
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
                let title = f.name.replace(/\.(zip|cbz|mp3|pdf)$/i,'');
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
                } catch(e){ console.error(e); alert("エラー: " + e); }
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
                const data = await db.files.get(item.id);
                if(item.isPdf && data.pdfBlob) {
                    alert("このPDFは古い形式です。再インポートすると高速化されます。");
                     const arrayBuffer = await data.pdfBlob.arrayBuffer();
                     const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
                     const numPages = pdf.numPages;
                     const urls = [];
                     this.loading.minimal = false;
                     this.loading.text = "PDF変換中(レガシーモード)...";
                     for(let i=1; i<=numPages; i++) {
                         this.loading.progress = (i/numPages)*100;
                         const page = await pdf.getPage(i);
                         const viewport = page.getViewport({scale: 1.5});
                         const canvas = document.createElement('canvas');
                         const context = canvas.getContext('2d');
                         canvas.height = viewport.height;
                         canvas.width = viewport.width;
                         await page.render({canvasContext: context, viewport: viewport}).promise;
                         const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.8));
                         urls.push(URL.createObjectURL(blob));
                     }
                     this.setupSwiper(urls);
                     this.page = 'reels';
                }
                else if(item.type === 'book' && data.zipBlob) {
                    const r = createZipReader(data.zipBlob);
                    const es = await r.getEntries();
                    const imgs = _.filter(es, x => !x.directory && x.filename.match(IMG_REGEX)).sort((a,b)=>a.filename.localeCompare(b.filename, undefined, {numeric:true}));
                    const blobs = await Promise.all(imgs.map(x => x.getData(new zip.BlobWriter())));
                    r.close();
                    const urls = blobs.map(b => URL.createObjectURL(b));
                    this.setupSwiper(urls);
                    if(urls.length > 0) {
                        await new Promise((resolve) => {
                            const img = new Image();
                            img.onload = resolve; img.onerror = resolve;
                            img.src = urls[0];
                        });
                    }
                    this.page = 'reels';
                } else {
                    if(data.zipBlob) {
                        const r = createZipReader(data.zipBlob);
                        const es = await r.getEntries();
                        this._allAudioEntries = es;
                        this.renderAudioDir("");
                    }
                    this.page = 'reels';
                }
            } catch(e) { alert(e); }
            this.loading.show = false;
        },

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
                    if(item.type === 'book' && !item.isPdf) {
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
                const data = await db.files.get(this.editModal.id);
                if(data && data.zipBlob) {
                    const r = createZipReader(data.zipBlob);
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
            } catch(e) { alert(e); }
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
                    if(rel.match(/\.(mp3|wav|ogg)$/i)) res.push({ type: 'file_audio', name: rel, full: p, entry });
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
            if(this.currentAudioDir === "") { this.page = 'home'; return; }
            const p = this.currentAudioDir.split('/'); p.pop(); p.pop();
            this.renderAudioDir(p.length > 0 ? p.join('/') + '/' : "");
        },

        async playAudioFile(f) {
            if(f.type === 'folder') { this.renderAudioDir(f.full); return; }
            if(f.type === 'file_image') { this.viewImage(f); return; }
            if(f.type === 'text') { this.viewText(f); return; }
            if(f.type === 'file_video') { this.playVideo(f); return; }

            if(this.currentHowl) { this.currentHowl.unload(); }
            const b = await f.entry.getData(new zip.BlobWriter());
            const url = URL.createObjectURL(b);
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
                const blob = await f.entry.getData(new zip.BlobWriter());
                const url = URL.createObjectURL(blob);
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
            } catch(e) { alert("動画再生エラー: "+e); }
            this.loading.show = false;
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
                const blob = await f.entry.getData(new zip.BlobWriter());
                this.imageViewer.src = URL.createObjectURL(blob);
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

        setupSwiper(urls) {
            if(urls) { this.viewerTotal = urls.length; this.viewerImages = urls; }
            const wrapper = document.getElementById('main-swiper').querySelector('.swiper-wrapper');
            let slides = [];
            const isV = this.settings.scrollMode === 'vertical';
            const dbl = this.settings.doublePage && !isV;
            const rtl = this.settings.direction === 'rtl';
            const wrapZoom = (content) => `<div class="swiper-zoom-container">${content}</div>`;
            if(!dbl) { slides = this.viewerImages.map(u => `<div class="swiper-slide">${wrapZoom(`<img src="${u}">`)}</div>`); }
            else {
                slides.push(`<div class="swiper-slide">${wrapZoom(`<img src="${this.viewerImages[0]}">`)}</div>`);
                for(let i=1; i<this.viewerImages.length; i+=2) {
                    const u1 = this.viewerImages[i], u2 = this.viewerImages[i+1];
                    const c = u2 ? (rtl ? `<div class="spread-container"><img src="${u2}" class="spread-page"><img src="${u1}" class="spread-page"></div>` : `<div class="spread-container"><img src="${u1}" class="spread-page"><img src="${u2}" class="spread-page"></div>`) : `<div class="spread-container"><img src="${u1}" class="spread-page"></div>`;
                    slides.push(`<div class="swiper-slide">${wrapZoom(c)}</div>`);
                }
            }
            wrapper.innerHTML = slides.join('');
            if(this.swiper) this.swiper.destroy();
            this.swiper = new Swiper('#main-swiper', { direction: isV?'vertical':'horizontal', zoom:true, spaceBetween: 0, centeredSlides: true, on: { slideChange: () => this.viewerPage = this.swiper.activeIndex } });
            if(rtl && !isV) this.swiper.changeLanguageDirection('rtl'); else this.swiper.changeLanguageDirection('ltr');
            if(this.settings.resume && this.currentItem.lastIndex) { this.viewerPage = this.currentItem.lastIndex; this.seekViewer(this.viewerPage); }
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

        deleteSelectedItems() {
            if(!confirm("削除しますか？")) return;
            if(this.currentList) {
                this.currentList.items = _.difference(this.currentList.items, this.selectedIds);
                localStorage.setItem('appLists', JSON.stringify(this.lists));
                this.showToast("リストから削除しました");
            }
            else {
                db.files.bulkDelete(this.selectedIds);
                this.selectedIds.forEach(id => db.files.delete(id+'_thumb'));
                this.library = _.filter(this.library, i => !this.selectedIds.includes(i.id));
                this.saveMeta();
                this.showToast("削除しました");
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

        getLabel(val) { const map = {'small':'小','medium':'中','large':'大','horizontal':'スワイプ','vertical':'縦スクロール','rtl':'右→左','ltr':'左→右'}; return map[val] || val; },
        getColorName(c) { const map = {'#0095f6':'ブルー','#ff75a0':'ピンク','#ff3b30':'レッド','#ff9500':'オレンジ'}; return map[c] || c; },

        async calculateStorageUsage() {
            this.storageSize = "計算中..."; let total = 0;
            await db.files.each(val => { if (val instanceof Blob) total += val.size; else if (val.zipBlob) total += val.zipBlob.size; else if(val.pdfBlob) total += val.pdfBlob.size; });
            if (total === 0) { this.storageSize = "0 MB"; return; }
            const k = 1024; const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']; const i = Math.floor(Math.log(total) / Math.log(k));
            this.storageSize = parseFloat((total / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        },

        async deleteAll() { if(confirm("全削除?")) { await db.files.clear(); localStorage.clear(); location.reload(); } },
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
