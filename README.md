# 進捗管理（司法書士試験）

司法書士試験に向けた学習進捗の PWA です。ホームからテキストまとめ・択一対策・スピードチェックへ進みます。

公開URLの想定は https://tanatos0209.github.io/shoshi-progress/ です。択一アプリ（https://tanatos0209.github.io/shoshi-ox/ ）や、以前進捗を載せてしまった総合アプリ（https://tanatos0209.github.io/shoshi-sogo/ ）とは別のアドレスです。

## パス

配信パスは `/shoshi-progress/` です。HTML・CSS・JS・画像・manifest・Service Worker は相対パスです。`manifest` の `start_url` と `scope` は `./`、キャッシュ名は `shoshi-progress-v1` です。

## GitHub Pages

**Settings → Pages → Build and deployment → Deploy from a branch → Branch: `main` / Folder: `/ (root)`**

`main` に載ると https://tanatos0209.github.io/shoshi-progress/ に出ます。このリポジトリには `.nojekyll` を置いてあります。

## 画面

- **ホーム** … 本試験までの日数、今日の学習時間、連続日数、今週のグラフ、今日の進捗、科目別進捗。
- **択一対策** と **今日の学習を開始** … https://tanatos0209.github.io/shoshi-ox/ を同じタブで開きます。
- **テキストまとめ** **スピードチェック** **パーフェクトコントロール** **カレンダー** … 準備中。
- **記録する** … 今日の学習時間、解いた問題数、メイン／マイナー科目の択一・記述を手入力します。この端末の localStorage（キー `shoshi-progress-v1`）に保存します。
- **設定** … 試験日、1日の目標時間、週の目標時間、1日の目標問題数。初期の試験日は、開いた日から 150 日後です。

## ローカル確認

リポジトリのルートで:

```bash
python3 -m http.server 4173
```

ブラウザで http://127.0.0.1:4173/ を開きます。

GitHub Pages と同じ `/shoshi-progress/` で確認する場合は、ひとつ上のディレクトリからこのフォルダを配信します。

```bash
cd ..
python3 -m http.server 4173
```

ブラウザで http://127.0.0.1:4173/shoshi-progress/ を開きます。
