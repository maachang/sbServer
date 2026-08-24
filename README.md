# sdServer

`sdServer` は、Stable Diffusion サーバー（例: `stable-diffusion.cpp` などの OpenAI 互換 `/v1/images/generations` エンドポイントを持つサーバー）と連携し、Webブラウザから直感的に画像生成・履歴管理・再生成・LLMモデル管理を行える Web アプリケーションです。

軽量 Web フレームワーク「maachang」ベースで構築されています。

---

## 🌟 主な機能

### 1. 画像生成インターフェース (`/generate.html`)
- **プロンプト入力 & ✨ AIプロンプト自動最適化（アシスト機能）**:
  - プロンプト (Prompt) およびネガティブプロンプト (Negative Prompt) の日本語入力対応。
  - **✨ AI最適化ボタン**: 日本語の曖昧な入力や意図（例: 「危険で恐ろしい魔剣を表現して」）から、Stable Diffusion が誤認しないよう「アイテム単体（`item focus, solo, no humans`）」「構図」「品質タグ」を展開し、推奨ネガティブプロンプトを自動生成・入力欄に展開。
  - **自動アシストトグル**: ON の場合、生成時にバックエンドで自動的に AI アシスト最適化を適用。OFF にすると忠実な英語直訳モードとして動作。
  - **🌐 翻訳プレビュー**: 事前に英語直訳結果を確認可能。
- **入力パラメータの自動保持 & リセット**:
  - プロンプトや生成設定（解像度・Steps・CFG・Sampler・Seed・アシストトグル状態）をブラウザ（LocalStorage）に自動保存。
  - 「🔄 既定値に戻す」ボタンで初期デフォルト設定へ一発クリア可能。
- **生成完了時の保存確認**:
  - 生成完了時にモーダルが表示され、「💾 保存する」「🗑️ 保存しない」を選択可能。
  - 「保存しない」を選んだ場合はサーバーディスク（`uploads/`）や DB にゴミデータを残さず、画面上の一時プレビュー＆ダウンロードのみ行えます（後から手動保存も可能）。
- **リアルタイム生成タイマー & キャンセル**:
  - 生成進行中の経過秒数計測および、処理の中断（キャンセル）リクエスト対応。

### 2. Transformers.js + ローカルLLM による高速翻訳 & AIプロンプトアシスト
- **純粋な Node.js (JavaScript) 完結**:
  - Python や外部プロセス不要で、同一 Node.js プロセス内に ONNX モデルを常駐。
- **デフォルトモデル**: `onnx-community/Qwen2.5-1.5B-Instruct` (Q4量子化)
- **モデル選定基準（1B〜3B Instruct モデル推奨）**:
  - 単なる単語直訳ではなく、JSON 形式でのタグ最適化や構図・ネガティブプロンプトの指示追従（Instruct）を行うため、**1B〜3B クラスのモデル（Qwen 2.5 1.5B / 3B など）** を標準採用。
  - 0.5B 以下（270M, 0.5B）の超極小モデルに見られる誤訳や指示崩れ（ハルシネーション）を防止。
- **推論OFF（決定論的・高速出力）**:
  - `do_sample: false` (Greedy Search) により、安定かつ高速なプロンプト生成を実現。

### 3. LLM モデル管理・動的切り替え & キャッシュ管理 (`/models.html`)
- **モデルの選択・ロード・メモリ常駐**:
  - 画面上からワンクリックで翻訳・アシスト用モデルの切り替え・メモリ常駐化。
- **リアルタイムダウンロード進捗表示**:
  - 未ダウンロードのモデルを選択した場合、ダウンロード中のファイル名・進捗率（0%〜100%）・プログレスバーをリアルタイム表示。
- **ダウンロード済みキャッシュの容量表示 & 個別削除**:
  - 各モデルがディスク上で占有しているファイル容量（例: `1.7 GB`）を表示。
  - 「💾 キャッシュ削除」ボタンで設定は残したまま実体ファイルのみを削除し、ディスク容量を即座に解放可能。
- **モデル項目の削除（設定一覧からの削除）**:
  - 不要になったモデル定義を一覧から削除（キャッシュファイルも同時に削除するか選択可能）。
- **未登録のダウンロード済みキャッシュの自動検出 & 解放**:
  - 設定一覧から外れたもののディスク上に残っている過去のキャッシュファイルを検出し、「➕ 一覧に再追加」または「🗑️ キャッシュ完全消去」が可能。
- **状態バッジ表示**:
  - `⚡ メモリ常駐中`、`✔ 設定選択中`、`💾 ダウンロード済 (容量)`、`☁️ 未ダウンロード` を明確に可視化。
- **新規 HuggingFace ONNX モデルの自由追加**:
  - 任意の Hugging Face Transformers.js 互換 ONNX モデル（Qwen 2.5 1.5B/3B, Gemma 3 1B, LFM2.5 など）をフォームから登録可能。

### 4. 生成履歴・ギャラリー (`/menu.html`)
- **画像一覧グリッド & ページネーション**:
  - 保存された画像一覧を最新順で表示。
  - 日本語プロンプトをそのまま保持・表示（英訳・最適化プロンプトもサブ表示）。
- **検索 & 詳細モーダル**:
  - キーワード検索（プロンプト・ネガティブ・英訳対応）。
  - 詳細モーダルからの「✏️ この設定をコピーして生成画面を開く」連携。
  - 不要になった画像の削除機能（ファイルとDBレコードを完全削除）。

---

## 📁 ディレクトリ構成

```text
sdServer/
├── conf/                     # 設定ファイル
│   ├── env.json              # 共通環境設定
│   ├── sdServer.json         # SD サーバー連携 & LLM モデル定義設定
│   ├── server.json           # HTTP サーバー設定（ポート・ホスト）
│   └── session.json          # セッション設定
├── lib/                      # サーバーサイド共通ライブラリ
│   ├── imageModel.js         # SQLite を用いた images テーブルの CRUD 処理
│   ├── sdClient.js           # SD サーバー通信・生成・画像保存処理
│   └── translator.js         # Transformers.js 常駐・動的切替・進捗追跡・直訳 & AIアシストモジュール
├── public/                   # 静的ファイルおよび Web エンドポイント (.mt.js)
│   ├── api/
│   │   ├── assist.mt.js      # POST /api/assist (SD向けAIプロンプト最適化・ネガティブ生成)
│   │   ├── config.mt.js      # GET /api/config (設定値・現在モデル名・UI選択肢取得)
│   │   ├── delete.mt.js      # POST /api/delete (画像削除)
│   │   ├── generate.mt.js    # POST /api/generate (画像生成実行・AIアシスト/自動翻訳連携)
│   │   ├── image.mt.js       # GET /api/image (単一画像詳細取得)
│   │   ├── images.mt.js      # GET /api/images (画像一覧・検索取得)
│   │   ├── models.mt.js      # GET/POST /api/models (モデル一覧・進捗・切替・追加・削除)
│   │   ├── save.mt.js        # POST /api/save (画像ファイル・DB永続保存)
│   │   └── translate.mt.js   # POST /api/translate (プロンプト直訳API)
│   ├── uploads/              # 生成された画像ファイル保存先 (.png)
│   ├── generate.html         # 画像生成画面
│   ├── index.html            # ルートリダイレクト画面 (/menu.html へ転送)
│   ├── menu.html             # 生成履歴・ギャラリー画面
│   └── models.html           # LLM モデル管理画面
├── schema/                   # DB スキーマ定義
│   └── images.sql            # images テーブル DDL
├── validates/                # 入力値バリデーション定義
│   └── image.js              # 画像生成リクエストスキーマ
├── package.json
└── README.md
```

---

## ⚙️ 設定例 (`conf/sdServer.json`)

```json
{
  "baseUrl": "http://192.168.0.229:8080",
  "endpoint": "/v1/images/generations",
  "timeoutMs": 600000,
  "defaults": {
    "width": 512,
    "height": 512,
    "steps": 20,
    "cfg_scale": 7.0,
    "sampler_name": "euler_a",
    "seed": -1
  },
  "llm": {
    "activeModel": "onnx-community/Qwen2.5-1.5B-Instruct",
    "models": [
      {
        "id": "onnx-community/Qwen2.5-1.5B-Instruct",
        "name": "Qwen 2.5 1.5B Instruct (ONNX Q4)",
        "description": "高精度な翻訳とプロンプト最適化・ネガティブ補完を両立した推奨モデル（デフォルト）",
        "dtype": "q4",
        "task": "text-generation"
      },
      {
        "id": "onnx-community/Qwen2.5-3B-Instruct",
        "name": "Qwen 2.5 3B Instruct (ONNX Q4)",
        "description": "より高度な表現力と複雑なプロンプト展開に対応した高品質モデル",
        "dtype": "q4",
        "task": "text-generation"
      },
      {
        "id": "onnx-community/gemma-3-1b-it-ONNX",
        "name": "Gemma 3 1B IT (ONNX Q4)",
        "description": "バランスの取れた Google Gemma 3 (1B) モデル",
        "dtype": "q4",
        "task": "text-generation"
      },
      {
        "id": "LiquidAI/LFM2.5-1.2B-JP-ONNX",
        "name": "LFM2.5 1.2B JP (ONNX Q4)",
        "description": "日本語ニュアンスの解釈に優れた軽量モデル",
        "dtype": "q4",
        "task": "text-generation"
      }
    ]
  }
}
```

---

## 🚀 起動方法

```bash
npm start
# または
maachang
```

- **画像ギャラリー / 一覧画面**: `http://localhost:3000/menu.html`
- **画像生成画面**: `http://localhost:3000/generate.html`
- **LLM モデル設定画面**: `http://localhost:3000/models.html`
