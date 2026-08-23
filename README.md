# sdServer

`sdServer` は、Stable Diffusion サーバー（例: `stable-diffusion.cpp` などの OpenAI 互換 `/v1/images/generations` エンドポイントを持つサーバー）と連携し、Webブラウザから直感的に画像生成・履歴管理・再生成を行える Web アプリケーションです。

超軽量 Web フレームワーク `maachang` ベースで構築されているので、bunをインストールして、maachang(https://github.com/maachang/maachang)リポジトリをcloneして、$MAACHANG_HOME + PATH=$PATH:$MAACHANG_HOME/bin の環境変数を設定する必要があります。

---

## 🌟 主な機能

- **画像生成インターフェース (`/generate.html`)**
  - プロンプト (Prompt) およびネガティブプロンプト (Negative Prompt) の入力
  - 解像度 (Width / Height)、サンプラー (Sampler)、ステップ数 (Steps)、CFG Scale、Seed値の柔軟な設定
  - 生成進行中のスピナー表示および所要時間（リアルタイム秒数・ミリ秒）の計測・表示
  - 生成中断（キャンセル）リクエスト対応
- **生成履歴・ギャラリー (`/menu.html`)**
  - 生成した画像一覧のグリッド表示（最新順）
  - プロンプト / ネガティブプロンプトでのキーワード検索
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
│   ├── sdServer.json         # Stable Diffusion サーバー連携設定（URL、デフォルト値、選択肢）
│   ├── server.json           # HTTP サーバー設定（ポート・ホスト）
│   └── session.json          # セッション設定
├── lib/                      # サーバーサイド共通ライブラリ
│   ├── imageModel.js         # SQLite を用いた images テーブルの CRUD 処理
│   └── sdClient.js           # sd-server との HTTP 通信・生成・キャンセル・画像保存処理
├── public/                   # 静的ファイルおよび Web エンドポイント (.mt.js)
│   ├── api/
│   │   ├── config.mt.js      # GET /api/config (設定値・UI選択肢取得)
│   │   ├── delete.mt.js      # POST /api/delete (画像削除)
│   │   ├── generate.mt.js    # POST /api/generate (画像生成実行)
│   │   ├── image.mt.js       # GET /api/image (単一画像詳細取得)
│   │   └── images.mt.js      # GET /api/images (画像一覧・検索取得)
│   ├── uploads/              # 生成された画像ファイル保存先 (.png)
│   ├── generate.html         # 画像生成画面
│   ├── index.html            # ルートリダイレクト画面 (/menu.html へ転送)
│   └── menu.html             # 生成履歴・ギャラリー画面
├── schema/                   # DB スキーマ定義
│   └── images.sql            # images テーブル DDL
├── validates/                # 入力値バリデーション定義
│   └── image.js              # 画像生成リクエストスキーマ
├── package.json
└── README.md
```

---

## ⚙️ 設定

### 1. Stable Diffusion サーバー設定 (`conf/sdServer.json`)
連携先の Stable Diffusion サーバー情報やデフォルト値を設定します。

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
  "options": {
    "resolutions": [
      { "width": 512, "height": 512, "label": "512 x 512 (標準・正方形)" }
    ],
    "samplers": [
      { "value": "euler_a", "label": "Euler a (Euler Ancestral)" }
    ],
    "stepsRange": { "min": 1, "max": 150 },
    "cfgScaleRange": { "min": 1.0, "max": 30.0, "step": 0.5 }
  }
}
```

> **Note**: 環境依存の設定を行いたい場合は、`conf/sdServer.local.json` を作成することで設定を上書きできます。

### 2. HTTP サーバー設定 (`conf/server.json`)

```json
{
  "port": 3000,
  "hostname": "0.0.0.0"
}
```

---

## 🚀 起動方法

### 前提条件
- Node.js 環境
- `maachang` CLI がインストールされていること

### 起動コマンド

```bash
# サーバー起動
npm start
# または
maachang
```

起動後、ブラウザで `http://localhost:3000/` または `http://localhost:3000/menu.html` にアクセスします。

---

## 🔌 API エンドポイント仕様

| メソッド | パス | 説明 | 主なパラメータ |
|---|---|---|---|
| `GET` | `/api/config` | UI生成用の設定・デフォルト値取得 | なし |
| `POST` | `/api/generate` | 画像生成実行 | `prompt`, `negative_prompt`, `width`, `height`, `steps`, `cfg_scale`, `seed`, `sampler_name` |
| `GET` | `/api/images` | 生成履歴一覧取得 | `keyword`, `limit` (デフォルト: 20), `offset` (デフォルト: 0) |
| `GET` | `/api/image` | 単一画像詳細取得 | `id` |
| `POST` | `/api/delete` | 画像レコードおよびファイルの削除 | `id` |

---

## 🗄️ データベース (`images` テーブル)

`schema/images.sql` に基づいて SQLite 上に管理されます。

| カラム名 | 型 | 説明 |
|---|---|---|
| `id` | INTEGER PRIMARY KEY | 画像レコードID (AUTOINCREMENT) |
| `title` | TEXT | タイトル（オプション） |
| `prompt` | TEXT | 生成プロンプト |
| `negative_prompt` | TEXT | ネガティブプロンプト |
| `width` | INTEGER | 画像横幅 (px) |
| `height` | INTEGER | 画像縦幅 (px) |
| `steps` | INTEGER | サンプリングステップ数 |
| `cfg_scale` | REAL | CFG Scale (Guidance Scale) |
| `seed` | INTEGER | 生成シード値 (-1 はランダム) |
| `sampler_name` | TEXT | サンプラー方式名 |
| `image_path` | TEXT | Web公開パス (`/uploads/...`) |
| `parent_id` | INTEGER | 派生元画像ID（バリエーション生成時） |
| `generation_time_ms`| INTEGER | 生成所要時間 (ミリ秒) |
| `created_at` | TEXT | 作成日時 (ISO文字列) |
| `updated_at` | TEXT | 更新日時 (ISO文字列) |
