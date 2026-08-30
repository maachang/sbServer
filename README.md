# sdServer

`sdServer` は、ローカルやリモートの Stable Diffusion サーバー（`stable-diffusion.cpp` 等）と連携し、Web ブラウザから直感的に画像生成・履歴管理・AIプロンプト最適化・複数サーバー管理を行える Web アプリケーションです。

軽量 Web フレームワーク「**maachang**」（Bun / Node.js 実行環境）ベースで構築されています。

---

## 🌟 主な機能

### 1. 🖼️ 画像生成インターフェース (`/generate.html`)
- **複数 SD サーバー切り替え & 固有 defaults 適用**:
  - 生成画面上部のセレクトボックスから、目的の SD サーバー（例: `[低速] 画像汎用` / `[高速] アニメ調`）を即時選択。
  - 各サーバーに設定された固有の推奨解像度・ステップ数・CFGスケール・サンプラーが自動的に初期値として反映されます。
- **🎭 生成テーマ（スタイル）選択 & プロンプト自動修飾**:
  - 「🎀 かわいい」「🌸 アニメ」「📷 実写リアル」「🔮 ダークファンタジー」「⚡ サイバーパンク」「🎨 水彩画」「📼 90sレトロ」「🧊 3Dミニチュア」「🎬 シネマティック」「👾 ドット絵」「⚙️ スチームパンク」など、AI画像生成に効果的なテーマを選択可能。
  - 選択したテーマに合わせてプロンプトやネガティブプロンプトが自動修飾され、生成画像ごとにテーマが記憶（DB保存）されます。
- **モデル系統別 ✨ AI プロンプト自動最適化（アシスト機能）**:
  - 選択されたサーバーのモデル系統（`SD 1.5系` / `SDXL系` / `自然言語型`）および選択テーマを自動判別し、同一の日本語入力からモデル特性に最適なプロンプト形式へ自動展開。
  - **🏷️ SD 1.5系**: Danbooruタグ＋品質強調タグ＋ネガティブタグを自動生成
  - **⚡ SDXL系**: `score_9, score_8_up` 等のクオリティスコア＋シチュエーション文を生成
  - **🧠 自然言語型**: DiT / FLUX / Qwen-Image 向けに、主語・情景・ライティングを詳細に記述した自然な英文段落を生成（不要なネガティブタグは排除）
  - **🌐 翻訳プレビュー**: 事前に英語直訳結果を確認可能。
- **非同期タスク ＆ リアルタイム経過タイマー**:
  - バックエンドでの非同期タスク管理と軽量ポーリング（1秒間隔）により、5分〜10分かかる長大生成でもネットワークタイムアウトなく安定動作。
- **生成中の画面遷移保護 & キャンセル**:
  - 生成中に画面を移動しようとすると警告ダイアログを表示。
  - 「生成中止」やページ離脱時は、SD サーバーへ即座に中断シグナル（`/sdcpp/v1/jobs/{id}/cancel`）を発行。
- **生成完了時の保存確認**:
  - 生成完了時にモーダルが表示され、「💾 保存する」「🗑️ 保存しない（破棄）」を選択可能。

---

### 2. 🖥️ 複数 SD サーバー管理 (`/sdServers.html`)
- **Web 画面でのサーバー追加・編集・削除**:
  - サーバー表示名、識別 ID、Base URL、エンドポイント種別、タイムアウト秒数、説明メモを自由に追加・管理。
- **モデル系統 (Model Architecture) 設定**:
  - `🏷️ SD 1.5系 (タグ羅列型)` / `⚡ SDXL系 (ハイブリッド型)` / `🧠 自然言語型 (DiT/FLUX/Qwen-Image)` を指定。
- **サーバー専用 defaults パラメータ設定**:
  - サーバーごとに最適な幅・高さ・ステップ数・CFG・サンプラーを個別定義。
- **リアルタイム接続テスト**:
  - 画面上から「⚡ 接続テスト」ボタンで即座に通信確認が可能。

---

### 3. 🧠 ローカル LLM 管理・動的切替 (`/models.html`)
- **Transformers.js (ONNX) 完全ローカル動作**:
  - 外部プロセスや Python 不要で、同一 Node.js / Bun プロセス内に LLM（Qwen 2.5 1.5B/3B, Gemma 3 1B 等）を常駐。
- **ダウンロード進捗表示 & ディスクキャッシュ容量管理**:
  - モデルダウンロード中の進捗率をプログレスバーでリアルタイム表示。
  - ディスクキャッシュ容量の確認・ワンクリック削除機能。

---

### 4. 📚 生成履歴・ギャラリー (`/menu.html`)
- **画像一覧グリッド & 上下デュアルページネーション**:
  - 保存された画像を最新順で表示。一覧の上部・下部の両方にページング表示（最初/前へ/ページ番号/次へ/最後、件数情報）を配置し、スクロールすることなく快適にページ切り替えが可能。
  - 日本語プロンプト・英訳・生成パラメータ・**「生成時の利用サーバー」**・**「生成テーマバッジ」** を記録・表示。
- **検索 & 再編集連携**:
  - プロンプトおよびテーマ名でのキーワード検索。
  - 詳細モーダルの「✏️ 編集」から、当時のパラメータ・テーマ・利用サーバーをそのまま復元して再生成。

---

## 📁 ディレクトリ構成

```text
sdServer/
├── conf/                     # 設定ファイル
│   ├── env.json              # 共通環境設定
│   ├── localLlm.json         # ローカル LLM 設定
│   ├── sdServer.json         # SD サーバー定義・共通defaults・モデル系統設定
│   └── server.json           # HTTP サーバー設定 (ポート 3000)
├── lib/                      # サーバーサイド共通ライブラリ
│   ├── imageModel.js         # SQLite を用いた images テーブルの CRUD & 自動補完
│   ├── sdClient.js           # SD サーバー通信 (/sdcpp/v1 非同期ジョブ & 中断)
│   ├── translator.js         # Transformers.js 常駐・モデル系統別 AI アシスト
│   └── validate.js           # バリデーションユーティリティ
├── public/                   # 静的ファイルおよび Web エンドポイント (.mt.js)
│   ├── api/
│   │   ├── assist.mt.js      # POST /api/assist (モデル系統連動 AI プロンプト最適化)
│   │   ├── config.mt.js      # GET /api/config (設定情報取得)
│   │   ├── delete.mt.js      # POST /api/delete (画像・DB削除)
│   │   ├── generate.mt.js    # POST/GET /api/generate (非同期生成タスク & ポーリング & キャンセル)
│   │   ├── image.mt.js       # GET /api/image (画像詳細取得)
│   │   ├── images.mt.js      # GET /api/images (画像一覧・検索)
│   │   ├── models.mt.js      # GET/POST /api/models (LLM 切替・進捗・キャッシュ管理)
│   │   ├── save.mt.js        # POST /api/save (画像ファイル・DB保存)
│   │   ├── sdServers.mt.js   # GET/POST /api/sdServers (SD サーバー CRUD & 接続テスト)
│   │   └── translate.mt.js   # POST /api/translate (直訳 API)
│   ├── uploads/              # 生成された画像ファイル保存先 (.png)
│   ├── generate.html         # 画像生成画面
│   ├── menu.html             # 生成履歴・ギャラリー画面
│   ├── models.html           # LLM モデル管理画面
│   ├── sdServers.html        # SD サーバー設定画面
│   └── index.html            # ルートリダイレクト (/menu.html へ転送)
├── schema/                   # DB スキーマ定義
│   └── images.sql            # images テーブル DDL
├── validates/                # 入力値バリデーション定義
│   └── image.js              # 画像生成リクエストスキーマ
├── .claude/
│   └── CLAUDE.md             # 開発・アーキテクチャ詳細ガイド
├── package.json
└── README.md
```

---

## 🚀 起動方法

```bash
# サーバー起動 (maachang / Bun)
bun run /home/maachang/project/maachang/src/index.js
# または
npm start
```

### 🌐 アクセス URL
- **画像履歴・ギャラリー**: [http://localhost:3000/menu.html](http://localhost:3000/menu.html)
- **画像生成**: [http://localhost:3000/generate.html](http://localhost:3000/generate.html)
- **SD サーバー設定**: [http://localhost:3000/sdServers.html](http://localhost:3000/sdServers.html)
- **LLM モデル設定**: [http://localhost:3000/models.html](http://localhost:3000/models.html)
