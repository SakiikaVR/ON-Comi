# オンコミ

<p align="center">
  <img src="assets/icon.png" alt="オンコミ" width="128">
</p>

<p align="center">
  <a href="https://github.com/SakiikaVR/ON-Comi/releases/latest">
    <img src="https://img.shields.io/github/v/release/SakiikaVR/ON-Comi?style=for-the-badge&label=%E2%AC%87%20APK&color=ff9f0a" alt="最新APKをダウンロード">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="MIT License">
  </a>
</p>

オンコミは、漫画・音声・動画を端末内で管理・再生する、完全オフライン対応のライブラリアプリです。
Androidアプリとブラウザの両方で動作し、作品を外部サーバーへアップロードしません。

現在の仕様は **v2.9.1** です。

## スクリーンショット

<p align="center">
  <img src="docs/screenshot-light.png" alt="オンコミ ライトテーマ" width="300">
  <img src="docs/screenshot-dark.png" alt="オンコミ ダークテーマ" width="300">
</p>

## 特長

- 選択した端末フォルダを自動でライブラリ化（Android版）
- ZIP / CBZ内の漫画と音声アルバムを内容から自動判別
- 漫画ページを現在位置の周辺だけ読み込む省メモリビューアー
- 大きなZIPを全展開せず、必要な範囲から読み始めるランダムアクセス
- WAVの先頭部分から再生を始め、残りをバックグラウンド展開
- PDF・漫画・音声・動画・テキストを1つのアプリで閲覧
- すべてのライブラリをローカル同梱し、通信権限なしで動作
- ライト / ダークテーマとiOS風のアニメーションUI

## 対応形式

| 種別 | 対応形式 |
|---|---|
| 漫画・書籍 | ZIP, CBZ, PDF |
| 画像 | JPG, JPEG, PNG, GIF, WebP |
| 音声 | MP3, WAV, OGG, OGA, M4A, FLAC, AAC, Opus |
| 動画 | MP4, WebM, M4V, MOV |
| ZIP内テキスト | TXT, Markdown, URL, INI（UTF-8 / Shift_JIS自動判定） |

## 機能

### ライブラリ

- AndroidのStorage Access Frameworkで選択したフォルダを起動時に自動スキャン
- サブフォルダ内の対応ファイルも再帰的に検出
- ファイルサイズの変更を検知し、古いサムネイルキャッシュを自動更新
- ZIP / CBZ / PDF / 音声 / 動画の手動インポート（ブラウザ版を含む）
- ZIP内の `ComicInfo.xml` からタイトル・作者を取得
- タイトル・作者の編集と `ComicInfo.xml` への書き戻し
- サムネイル自動生成、画像アップロードまたは漫画ページからの表紙変更
- タイトル・作者検索（ひらがな・カタカナのローマ字検索に対応）
- 種別フィルター（すべて / 漫画 / 音声・動画）
- 成人向け（R-18）タグと表示切り替え
- 長押し / 右クリックでの複数選択、一括編集・削除・リスト追加
- 表紙コラージュ付きリストの作成・改名・削除

### 漫画ビューアー

- 横スワイプ / 縦スクロール
- 右から左（右綴じ）/ 左から右（左綴じ）
- 横表示向けの見開き2ページ表示
- ピンチズーム、シークバーによるページジャンプ
- しおりの追加・削除・一覧・ジャンプ
- 前回位置からの再開
- 現在ページの前後だけを先読みし、範囲外のBlob URLを自動解放
- PDFページの遅延レンダリング

### 音声・動画プレイヤー

- ZIPアルバム内のフォルダ階層を維持したブラウズ
- 再生 / 一時停止 / 前後トラック / シーク
- 全曲リピート、1曲リピート、シャッフル
- ロック画面・通知からの操作（Media Session API）
- 動画のフルスクリーン再生
- Androidではcontent URIから音声・動画を直接再生
- content URIを直接再生できない環境ではBlob読み込みへ自動フォールバック
- 次トラックのバックグラウンド展開と、タップしたトラックの優先処理

### 設定・安定性

- ライト / ダークテーマ
- アクセントカラー（ブルー / ピンク / レッド / オレンジ）
- サムネイルサイズ（小 / 中 / 大）
- ストレージ使用量表示と全データ削除
- 壊れた設定JSONが残っていても既定値で起動
- 連続タップ時は最新の作品・トラックだけを開く競合防止
- ZIP / PDF / SAFリーダーとBlob URLを画面終了時に解放
- 重い処理中もアニメーションと画面操作をできるだけ妨げない設計

## Android版をインストール

動作要件は **Android 9（API 28）以上**です。

1. [最新リリース](https://github.com/SakiikaVR/ON-Comi/releases/latest)から `ONComi-x.x.x.apk` をダウンロードします。
2. APKを開いてインストールします。端末によっては「提供元不明のアプリ」の許可が必要です。
3. ホーム画面の「フォルダを選択」から、作品を保存したフォルダを選びます。

以後は起動時に同じフォルダを再スキャンします。フォルダ内の作品本体はアプリへ全コピーせず、
必要なファイルを選択フォルダから直接読みます。

> v2.1.0からAPK生成を[さきいかビルダー](https://github.com/SakiikaVR/Sakiika-Builder)へ移行しました。
> パッケージ名は `com.sakiikavr.oncomi` です。旧MedjedBuilder版とは別アプリとして扱われます。

## ブラウザで使う

静的ファイルだけで動作します。ローカルHTTPサーバーで配信してください。

```bash
git clone https://github.com/SakiikaVR/ON-Comi.git
cd ON-Comi
python -m http.server 8000
```

ブラウザで `http://localhost:8000` を開き、右上の「＋」から作品をインポートします。

ブラウザ版ではAndroidブリッジを利用できないため、フォルダ自動スキャンではなくファイル選択方式になります。
インポートしたデータはIndexedDB、設定・メタデータはlocalStorageへ保存されます。

## Android APKをビルド

### 必要なもの

- Windows
- [さきいかビルダー v0.2.1以上](https://github.com/SakiikaVR/Sakiika-Builder/releases/latest)

Java、Android SDK、Gradleは不要です。HTML・JavaScript・CSSと同梱ライブラリを `www/` へステージングし、
リポジトリ同梱の [sakiika.json](sakiika.json) から署名APKを作成します。

```powershell
New-Item -ItemType Directory -Force www\css, www\js, www\lib, www\assets | Out-Null

Copy-Item index.html, credit.html www\ -Force
Copy-Item css\* www\css\ -Force
Copy-Item js\* www\js\ -Force
Copy-Item lib\* www\lib\ -Force
Copy-Item assets\icon.png www\assets\ -Force

sakiika build .\sakiika.json --release
```

出力先は `sakiika-out/` です。詳しい手順は [BUILD_APK.md](BUILD_APK.md) を参照してください。

### Androidビルド設定

| 設定 | 現在値 | 説明 |
|---|---:|---|
| `versionName` | `2.9.1` | 公開バージョン |
| `versionCode` | `15` | Android更新判定用コード |
| `minSdk` | `28` | Android 9以上 |
| `targetSdk` | `34` | Android 14 |
| `fileAccess` | `folder_pick` | ユーザーが選択したフォルダだけにアクセス |
| `permissions` | `[]` | 通信・カメラ・マイク等の追加権限なし |
| `bridge.enableReflection` | `true` | ZIPのランダムアクセス読み込みに使用 |
| `webview.htmlFileInput` | `true` | WebView内の手動ファイル選択を有効化 |
| `webview.debuggable` | `false` | リリースWebViewのデバッグを無効化 |
| `release` | `true` | リリース署名APKを生成 |

アプリ本体が使用するネイティブブリッジは主に `Android.fs`、`Android.ui`、`Android.reflect` です。
ブリッジがない通常ブラウザでは、自動的に手動インポート方式で動作します。

### 署名鍵について

初回ビルド時に `sakiika-out/sakiika-key.pem` が生成されます。v0.2.1以降のさきいかビルダーでは、
Androidの更新互換性に必要な秘密鍵と証明書が同じPEMへ保存されます。

**このファイルを紛失すると、公開済みAPKへ上書き更新できません。**
リポジトリへコミットせず、安全な場所へバックアップしてください。

## テスト

Node.js 18以上で、外部パッケージを追加せずに回帰テストを実行できます。

```powershell
node --test tests\*.test.js
node --check js\app.js
git diff --check
```

テスト対象:

- 保存JSON破損時の起動
- 検索、自然順ソート、リスト抽出
- 見開きページ計算
- Blob URLとZIP / SAFリーダーの解放
- 音声状態の初期化
- Androidブリッジ用Base64変換
- WAVメタデータ解析
- HTMLイベントとリソース解放処理の接続
- HTMLから参照するローカル資産とJavaScript構文

## 軽量化の仕組み

- サムネイルは画面内へ入った作品から遅延生成
- 生成したサムネイルは最大辺480pxへ縮小してIndexedDBへ保存
- 漫画は現在位置の前後だけを読み込み、離れたページのBlob URLを解放
- SAF上のZIPはJava `FileChannel`による位置指定読み込みを優先
- 大きな音声ZIPはファイル全体のメモリ複製を避けて必要なエントリから展開
- 一時停止中の再生位置更新は低頻度化し、不要な60fpsループを回避
- 検索欄が空のときは作品名・作者のローマ字変換を省略
- リーダー、PDFドキュメント、音声・動画・画像URLを利用終了時に破棄

## 技術構成

本体はVanilla JavaScript + Alpine.jsのSPAです。フロントエンドのコンパイルやバンドルは不要です。
すべての依存ライブラリを `lib/` に同梱しています。

| ライブラリ | 用途 | ライセンス |
|---|---|---|
| [Alpine.js](https://alpinejs.dev/) / [Intersect](https://alpinejs.dev/plugins/intersect) | UIリアクティビティ、遅延サムネイル | MIT |
| [Dexie.js](https://dexie.org/) | IndexedDB操作 | Apache-2.0 |
| [zip.js](https://gildas-lormeau.github.io/zip.js/) | ZIP読み書き、Shift_JISファイル名 | BSD-3-Clause |
| [Lodash](https://lodash.com/) | コレクション・ユーティリティ | MIT |
| [Howler.js](https://howlerjs.com/) | 音声再生 | MIT |
| [PDF.js](https://mozilla.github.io/pdf.js/) | PDF解析・ページ描画 | Apache-2.0 |
| [Swiper](https://swiperjs.com/) | 漫画のスワイプ・ズーム | MIT |
| [Feather Icons](https://feathericons.com/) | インラインSVGアイコン | MIT |

著作権表記はアプリ内の「設定 → オープンソースライセンス」または
[credit.html](credit.html)を参照してください。

## ファイル構成

```text
├── index.html          # SPAのマークアップ
├── css/style.css       # テーマ、レイアウト、アニメーション
├── js/app.js           # ライブラリ、ビューアー、プレイヤー
├── lib/                # オフライン動作用ライブラリ
├── assets/icon.png     # アプリアイコン
├── docs/               # README用スクリーンショット
├── tests/              # Node.js回帰テスト
├── credit.html         # サードパーティライセンス
├── sakiika.json        # Androidビルド設定
├── BUILD_APK.md        # APKビルド詳細
├── LICENSE             # MIT License
└── README.md
```

## プライバシー

- 外部サーバーへの作品アップロードや解析送信は行いません。
- Androidのフォルダ作品は、選択したフォルダから直接読みます。
- ブラウザで手動インポートした作品と、生成したサムネイルはIndexedDBへ保存します。
- 設定、ライブラリ情報、しおり、リストはlocalStorageへ保存します。
- Android版はインターネット権限、カメラ、マイク、位置情報を要求しません。
- ブラウザのサイトデータまたはアプリの全データを削除すると、保存済みメタデータとキャッシュも消去されます。

## ライセンス

[MIT License](LICENSE)
