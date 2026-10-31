# 進捗管理（司法書士試験）

司法書士試験に向けた学習進捗の PWA です。ホームからテキストまとめ・択一対策・スピードチェックへ進みます。

公開URLの想定は https://tanatos0209.github.io/shoshi-progress/ です。択一アプリ（https://tanatos0209.github.io/shoshi-ox/ ）や、以前進捗を載せてしまった総合アプリ（https://tanatos0209.github.io/shoshi-sogo/ ）とは別のアドレスです。

## パス

配信パスは `/shoshi-progress/` です。HTML・CSS・JS・画像・manifest・Service Worker は相対パスです。`manifest` の `start_url` と `scope` は `./`、キャッシュ名は `shoshi-progress-v1` です。

## GitHub Pages

**Settings → Pages → Build and deployment → Deploy from a branch → Branch: `main` / Folder: `/ (root)`**

`main` に載ると https://tanatos0209.github.io/shoshi-progress/ に出ます。このリポジトリには `.nojekyll` を置いてあります。

## 画面

- **ホーム** … 本試験の日付と残日数（`本試験　YYYY年M月D日　あとN日`）、今日の学習時間、連続日数、今週のグラフ、今日の進捗、科目別進捗。試験日はアジア/東京の「次の7月最初の日曜日」です。試験当日はあと0日、その翌日に次年へ移ります。
- **連続日数** … その日の記録が30分以上になったときだけ +1。アプリを開いただけでは増えません。当日がまだ30分未満でも、前日までが続いていればその連続は残ります。
- **テキストまとめ** **択一対策** **スピードチェック** … 「学習を始めますか？」のあと、その学習画面へ進みます。計測は画面右上の `計測中 MM:SS` で進み、25分・休憩・次のセットは学習画面の上にカードで出ます。テキストまとめとスピードチェックの中身は準備中です。択一対策は https://tanatos0209.github.io/shoshi-ox/ をその画面の中で開きます。終了すると学習時間を記録してホームへ戻ります。
- **今日の学習を開始** … https://tanatos0209.github.io/shoshi-ox/ を同じタブで開きます。
- **パーフェクトコントロール** **カレンダー** … 準備中。
- **記録する** … 今日の学習時間、解いた問題数、メイン／マイナー科目の択一・記述を手入力します。計測で溜まった時間も同じ記録に足します。この端末の localStorage（キー `shoshi-progress-v1`）に、今日の分数・今週のグラフ・連続日数・試験日を保存します。
- **設定** … 1日の目標時間、週の目標時間、1日の目標問題数。試験日は自動で、設定画面にはその日付だけ出します。

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

日付・連続・タイマーのルールは `node --test test/rules.test.js` で確認できます。
