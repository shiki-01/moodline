# Moodline

![キービジュアル](./docs/images/keyvisual.png)

Moodle のカレンダーに課題のスケジュールを見やすく表示するブラウザ拡張です（Chrome / Firefox 対応）。

## できること

- 課題の期間をカレンダー上に表示
- 完了・未完了を色で区別
- ポップアップから色や見え方を自由に調整

## 必要な環境

- Google Chrome または Mozilla Firefox
- Moodle にログインできること

## インストール

### 1. ダウンロード
[GitHub Releases](https://github.com/shiki-01/moodline/releases) から最新の ZIP ファイルをダウンロードして解凍します。

Firefox Add-ons (AMO) 向けに手動提出する場合は、`manifest.json` が ZIP の直下に来る形式で作成してください。
開発環境で作る場合は次を使うと確実です。

```bash
npm run build:zip
```

### 2. ブラウザに読み込む

#### Chrome
1. `chrome://extensions` を開く
2. 右上の「デベロッパーモード」をオンにする
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. 解凍したフォルダを選択

#### Firefox
1. `about:debugging#/runtime/this-firefox` を開く
2. 「一時的なアドオンを読み込む」をクリック
3. 解凍したフォルダ内の `manifest.json` を選択

これで完了です！Moodle のカレンダーページを開くと自動で動作します。

## 注意事項

### データの正確性について
この拡張の表示は、Moodle の画面情報をもとにした補助表示です。表示が遅れたり一致しない場合があるため、提出前・受験前は必ず Moodle 本体の課題ページで締切や状態を最終確認してください。

### デベロッパーモードについて
デベロッパーモード（または一時的なアドオン読み込み）を使うと、通常ストア配布時とは異なる権限で動作します。信頼できるソースからのみインストールしてください。

### アップデート時の拡張機能の消失
Chrome のメジャーアップデート時に、パッケージ化されていない拡張機能が自動的に無効になったり消えたりすることがあります。Firefox の「一時的なアドオン」もブラウザ再起動で解除されます。その場合は再度読み込み直してください。

## 使い方

### ポップアップを開く
拡張アイコンをクリックして、課題一覧を確認できます。

### 色や見た目を変更する
設定タブで以下を調整できます：
- 完了・未完了・不明の色
- バーの透明度

詳しい技術情報は [DISTRIBUTION.md](DISTRIBUTION.md) をご覧ください。

## AMO 向けソースコード提出

Firefox Add-ons (AMO) の Source Code Submission では、配布 ZIP（`dist.zip`）とは別に「ソースコード ZIP」の提出が必要です。

### 提出するファイル

- 配布物: `dist.zip`（拡張機能そのもの。`manifest.json` が ZIP 直下）
- ソースコード: リポジトリ一式を ZIP 化したもの（ただし `node_modules/` と `dist/` は除外）

### ソース ZIP に含める内容

- ソースコード: `src/`
- マニフェストと HTML: `manifest.json`, `popup.html`
- ビルドスクリプト: `build.ts`, `scripts/package-zip.mjs`, `package.json`, `package-lock.json`
- ビルド設定: `tsconfig.json`, `vite.config.ts`
- 再現手順ドキュメント: この README と `DISTRIBUTION.md`

### ビルド環境要件

- OS: Windows 11 / macOS / Linux（Node.js が動作する環境）
- Node.js: 20 系（CI は Node 20 を使用）
- npm: Node.js 20 同梱版（npm 10 系想定）

### 再現ビルド手順（配布物を再生成）

1. 依存関係をインストール
	- `npm ci`
2. Firefox 提出向け一括ビルド
	- `npm run build:firefox`
3. 出力確認
	- `firedox-dist/dist.zip`, `firedox-dist/dist.xpi`, `firedox-dist/source.zip` が生成されていること
	- `dist/` 配下に `manifest.json`, `content.js`, `popup.js`, `popup.css`, `popup.html`, `icons/` があること
	- `firedox-dist/dist.zip` の直下に `manifest.json` があること

### レビューノートに書くと通りやすい内容

- この拡張は TypeScript/Svelte を Vite でビルドしています。
- 機械生成ファイル（`dist/*`）はソース ZIP に含めていません。
- 再現手順は README の「AMO 向けソースコード提出」に記載しています。

## ライセンス

MIT License - 詳細は [LICENSE](LICENSE) をご覧ください。
