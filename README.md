# sdServer

`sdServer` は、Stable Diffusion サーバー（例: `stable-diffusion.cpp` などの OpenAI 互換 `/v1/images/generations` エンドポイントを持つサーバー）と連携し、Webブラウザから直感的に画像生成・履歴管理・再生成を行える Web アプリケーションです。

軽量 Web フレームワーク「maachang」ベースで構築されています。

---

## 🌟 主な機能

- **画像生成インターフェース (`/generate.html`)**
  - プロンプト (Prompt) およびネガティブプロンプト (Negative Prompt) の入力（**日本語入力 & 自動翻訳対応**）
  - 「🌐 翻訳プレビュー」による事前英訳確認
  - 解像度 (Width / Height)、サンプラー (Sampler)、ステップ数 (Steps)、CFG Scale、Seed値の柔軟な設定
  - 生成進行中のスピナー表示および所要時間（リアルタイム秒数・ミリ秒）の計測・表示
  - 生成中断（キャンセル）リクエスト対応
- **Transformers.js + Qwen 3.5 (0.8B) による高速プロンプト自動翻訳**
  - Node.js 内で `onnx-community/Qwen3.5-0.8B-ONNX` (Q4) をデフォルト使用
  - **推論サンプリングOFF (`do_sample: false`)** による決定論的かつ高速な翻訳処理
  - 外部プロセスや Python 不要で、同一 Node.js プロセス内で完結
- **LLM モデル管理・動的切り替え (`/models.html`)**
  - Web UI 上から現在使用する翻訳 LLM モデルをワンクリックで切り替え・ロード
  - ダウンロード済みキャッシュ状態の確認
  - 任意の HuggingFace Transformers.js 互換 ONNX モデル（Qwen 3.5, LFM2.5, Gemma 3 など）を新規追加・削除可能
- **生成履歴・ギャラリー (`/menu.html`)**
  - 生成した画像一覧のグリッド表示（最新順）
  - 日本語プロンプトをそのまま保持・表示（英訳もサブ表示）
  - プロンプト / ネガティブプロンプト / 英訳でのキーワード検索
  - ページネーション（次へ / 前へ）対応
  - 画像ごとの詳細モーダル表示（解像度・シード値・サンプラー・ステップ数・生成所要時間・日時など）
  - 詳細からの「この設定をコピーして生成画面を開く」連携
  - 画像および履歴レコードの削除機能
- **バックエンド API / DB 永続化**
  - リクエストバリデーション（`validates/image.js`）
  - SQLite による生成パラメータ・生成所要時間・ファイルパスの履歴管理（`schema/images.sql`）
  - 生成画像の自動ファイル保存 (`public/uploads/`)

---

## 📁 ディレクトリ構成

```text
sdServer/
├── conf/                     # 設定ファイル
│   ├── env.json              # 環境変数・共通環境設定
│   ├── sdServer.json         # SD サーバー & LLM モデル連携設定
│   ├── server.json           # HTTP サーバー設定（ポート・ホスト）
│   └── session.json          # セッション設定
├── lib/                      # サーバーサイド共通ライブラリ
│   ├── imageModel.js         # SQLite を用いた images テーブルの CRUD 処理
│   ├── sdClient.js           # sd-server との HTTP 通信・生成・キャンセル・画像保存処理
│   └── translator.js         # Transformers.js 常駐・動的切替型 翻訳モジュール
├── public/                   # 静的ファイルおよび Web エンドポイント (.mt.js)
│   ├── api/
│   │   ├── config.mt.js      # GET /api/config (設定値・UI選択肢取得)
│   │   ├── delete.mt.js      # POST /api/delete (画像削除)
│   │   ├── generate.mt.js    # POST /api/generate (画像生成実行・自動翻訳連携)
│   │   ├── image.mt.js       # GET /api/image (単一画像詳細取得)
│   │   ├── images.mt.js      # GET /api/images (画像一覧・検索取得)
│   │   ├── models.mt.js      # GET/POST /api/models (LLMモデル一覧・切替・追加・削除)
│   │   └── translate.mt.js   # POST /api/translate (日本語→英語翻訳API)
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

## 🚀 起動方法

```bash
npm start
# または
maachang
```

- **画像一覧 / メイン画面**: `http://localhost:3000/menu.html`
- **画像生成画面**: `http://localhost:3000/generate.html`
- **LLM モデル管理画面**: `http://localhost:3000/models.html`
