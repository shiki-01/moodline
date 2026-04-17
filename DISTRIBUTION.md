# 配布・開発ガイド

このドキュメントは、Moodline の配布と開発に関する技術情報をまとめたものです。

## リリース方法

### リリース手順

このリポジトリでは、`npm run release` を実行すると Git タグを push し、そのタグをトリガーに GitHub Actions がリリースを作成します。

1. `package.json` の version を更新する
2. 変更を commit する
3. `npm run release` を実行する
4. GitHub Actions が `dist` を ZIP 化し、GitHub Release を作成する

### 手動で流れだけ確認する場合

```bash
npm run release -- --dry-run --allow-dirty
```

## 開発方法

### 依存関係のインストール

```bash
npm install
```

### 開発ビルド

```bash
npm run build
```

### 監視ビルド

```bash
npm run dev
```

## 配布物の作成

配布用ファイルは `npm run build` で `dist/` に出力されます。

```bash
npm run build
cd dist
zip -r ../moodline-v0.1.0.zip .
```

配布物は `manifest.json` が直下にあるフォルダ構成になっています。

## トラブルシュート

### 画面に反映されない

- 拡張機能ページで再読み込みしてください
- Moodle のページを更新してください
- 古い `dist/content.js` が残っていると動作がずれることがあります

### 完了状況が出ない

- Moodle 側の表示内容や権限によって、完了情報が取得できないことがあります
- カレンダーが未描画の状態では一時的に `unknown` になることがあります

### ホバーの見た目がちらつく

- 拡張は自前の再描画を避けるようにしていますが、古いビルドを読んでいると改善が反映されません
- `npm run build` 後に拡張を再読み込みしてください

## 開発者向けメモ

- コンテンツスクリプトのソースは `src/content/index.ts` です
- ビルド出力のコンテンツスクリプトは `dist/content.js` です
- リリース workflow は `.github/workflows/release.yml` です
- リリースコマンドは `npm run release` です
