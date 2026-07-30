# Android APK のビルド手順（さきいかビルダー）

オンコミは [さきいかビルダー](https://github.com/SakiikaVR/Sakiika-Builder) で署名済み APK にビルドします。
Java・Android SDK・Gradle は不要で、ビルドは数十ミリ秒で終わります。

> v2.0.x までは MedjedBuilder を使用していました。v2.1.0 からさきいかビルダーへ移行しています。
> 旧ビルド手順が必要な場合はタグ `v2.0.0` の BUILD_APK.md を参照してください。

## アプリの仕様

- 初回起動時に **本 (PDF/ZIP/CBZ) や音声/動画を入れたフォルダを選択**すると、
  そのフォルダ内 (サブフォルダ数階層まで) のファイルが自動でライブラリに並びます。
- ファイルの追加・削除はフォルダに直接行い、ホーム右上の「再スキャン」で反映されます。
- サムネイルと PDF の変換結果はアプリ内キャッシュ (IndexedDB) に保存され、2回目以降は高速に開きます。

## 必要なもの

- Windows PC
- [さきいかビルダー v0.2.1 以降](https://github.com/SakiikaVR/Sakiika-Builder/releases/latest) の CLI (`sakiika-cli-Windows-x64.zip`)

## 手順

```powershell
git clone https://github.com/SakiikaVR/ON-Comi.git
cd ON-Comi

# 1. web ファイルをステージング (www/ は .gitignore 済み)
New-Item -ItemType Directory -Force www\css, www\js, www\lib, www\assets | Out-Null
Copy-Item index.html, credit.html www\
Copy-Item css\* www\css\
Copy-Item js\* www\js\
Copy-Item lib\* www\lib\
Copy-Item assets\icon.png www\assets\

# 2. ビルド (設定はリポジトリ同梱の sakiika.json)
sakiika build .\sakiika.json
```

`sakiika-out\オンコミ-x.x.x.apk` が生成されます。

## 設定のポイント（sakiika.json 設定済み）

| 設定 | 値 | 理由 |
|---|---|---|
| `fileAccess` | `folder_pick` | ユーザーが選んだフォルダ（SAF）。**フォルダ自動ライブラリに必須** |
| `permissions` | `[]` | 完全オフライン。通信・カメラ・マイク等は使いません |
| `bridge.enableReflection` | `true` | ZIP ランダムアクセス読み出しのフォールバック（h2a-shim.js が使用） |
| `webview.htmlFileInput` | `true` | ブラウザ版と同じ `<input type="file">` 取り込みに対応 |
| `webview.allowUniversalFileAccess` | `true` | `file://` ページから content URI (選択フォルダ内ファイル) を読むために必要 |
| `theme` / 背景 | dark / `#000000` | ダークデザイン固定。起動時からダークテーマ |
| `splash.enabled` | `false` | スプラッシュなしで瞬時に起動 |

## ブリッジの使い方 (実装メモ)

アプリ本体 (`js/app.js`) はさきいかビルダーのブリッジをネイティブに使用します。

- フォルダ選択・一覧・削除: `Android.fs.chooseRoot` / `list` / `delete`
- 音声・動画の直接再生: `Android.fs.stat` の content URI を `<audio>` / `<video>` にそのまま渡す
- ZIP のランダムアクセス読み出し (`SakiikaRandomReader`): content URI を XHR で Blob 化して
  必要な範囲だけ読む。XHR が使えない環境では `Android.reflect` の `FileChannel` 位置読みへ
  自動フォールバック

## 署名鍵について

初回ビルドで `sakiika-out\sakiika-key.pem` が生成され、以後のビルドで再利用されます。
**Android は同じ証明書でないと上書き更新を受け付けないため、この鍵は必ず保管してください**
（このリポジトリには含めていません）。
