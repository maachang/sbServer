# sdServer プロジェクト固有の情報

このファイルは Claude Code や agy (Google Antigravity) がセッション開始時に自動的に読み込みます。ここにはプロジェクト固有の事実および maachang フレームワークの利用ルールを記載します。

# プロジェクト概要

このプロジェクトは [maachang](https://github.com/maachang/maachang)（オンプレミス向けの Bun.serve 実行による超最小・高速 Web アプリケーションフレームワーク）を使って構築された Stable Diffusion 画像生成・履歴管理・AIプロンプト最適化・複数サーバー連携 Web アプリケーション / API です。

ローカルやリモートの Stable Diffusion サーバー（`stable-diffusion.cpp` 等）と連携し、Web ブラウザからプロンプト入力、モデル系統別 AI プロンプト最適化、非同期生成ポーリング、画像永続保存、生成履歴管理、複数 SD サーバーの動的切り替えを行います。

# 設計思想: 「ファイル配置 ＝ URL」の直感的な PHP 的アプローチ

- **認知負荷ゼロ**: `public/` 配下のファイル構造がそのまま URL パスに対応するクラシカルな SSR / API 構造。SPA や複雑なルーティング設定、巨大な npm 依存による複雑さを排除しています。
- **AI Native**: 1〜2 ファイルでバックエンド処理と画面描画が完結するため、AI エージェントが迷わず、コンテキストを浪費せずに迅速な機能開発が可能です。
- **ゼロ外部依存 ＆ 爆速**: Bun 組み込み機能と SQLite3 (`bun:sqlite`) のみで動作し、ミリ秒起動と単一ファイル運用を実現しています。

# インフラ・HTTPS 運用仕様

- **Nginx リバースプロキシ構成**: オンプレミス本番環境では Nginx を前面に配置して運用します。
- **無料 SSL 証明書 (Let's Encrypt / Certbot)**:
  - HTTPS (443) 終端、および HTTP (80) での ACME チャレンジ (HTTP-01) はすべて Nginx 側で一元管理します。
  - 証明書自動更新時は `nginx -s reload` による無停止反映を行います。
  - maachang (Bun.serve) 側はローカルポート（HTTP: localhost:3000 等）でリクエストを受け付けます。
  - クライアント IP 等の取得は Nginx から渡される `X-Forwarded-For` / `X-Real-IP` を利用します。

# 作業領域（.claudeWork）

- プロジェクト直下の `.claudeWork/` は AI 専用の作業領域（Git には一切コミットしない、`.gitignore` 済み）。
- セッション再起動時の引き継ぎ用メモや、調査結果・設計方針のドラフト置き場として利用する。
- プロジェクト固有の永続的な仕様は本ファイル（`CLAUDE.md`）に記載する。

# コーディング規約 & AI 開発ルール

- **独断での仕様決定禁止**: 実装を任された際、詳細仕様（データフィルタリング手法、抽出ロジック、制限値、除外基準など）を独断で決定・補完することは禁止。必ずユーザーの承認を得ること。
- **車輪の再発明の禁止**: maachang が標準提供しているモジュール（`session.js`, `logger.js`, `validate.js` 等）や組み込みヘルパー（`$request`, `$response`, `$db` 等）を優先活用し、独自ライブラリを安易に自作しない。
- **テーブルスキーマ定義の出力・管理**: データベース（SQLite3 等）のテーブルを作成・変更した場合は、テーブルスキーマ定義（DDL、SQL、テーブル定義書等）を必ず `schema/` ディレクトリ配下に出力・更新して管理すること。実装やクエリ作成時には `schema/` 内の定義を参照すること。
- **バリデーション定義の出力・管理**: フォーム入力や API リクエストの検証スキーマは、必ず `validates/` ディレクトリ配下にモジュールとして定義・出力すること（例: `validates/image.js`）。ページや API 実装時はこれを `$loadLib` で読み込み、`validate.js` を用いて検証を行うこと。
- **既存コメントの維持**: 処理内容が変わって意味が通じなくなる場合を除き、既存コメントを削除しない。
- **言語ルール**: コメントおよびユーザーへの返答・要約・説明文は常に**日本語**で記述する。
- **バグ修正フロー**: バグやエラーの原因調査を依頼された場合、即座に修正せず、まず原因と修正方針を報告して承認を得てから修正に着手する。
- **CommonJS 形式**: モジュールやスクリプトは CommonJS 形式（`require` / `module.exports`）で統一する。

# maachang フレームワーク原則 & アーキテクチャ

本プロジェクトは maachang 環境（`${MAACHANG_HOME}`）上で動作します。

- **`${MAACHANG_HOME}/src/index.js`**: Bun.serve によるサーバー起動エントリ。
- **`${MAACHANG_HOME}/src/router.js`**: ルーティング・静的配信・動的 JS/JHTML 実行・フィルター処理。
- **`${MAACHANG_HOME}/modules/`**: 共通モジュール群（`session.js`, `logger.js` 等）。
  - `$loadLib("モジュール名.js")` でフラットにロード可能。
  - プロジェクト側の `lib/` に同名ファイルがある場合はプロジェクト側が優先される。
- **`${MAACHANG_HOME}/bin/`**: maachang コマンド群（`initMaachang`, `mkmc`, `maachang`, `mcbuild`）。

---

# グローバルオブジェクト & 組み込みヘルパー

maachang の `*.mt.js` / `*.mt.html` (JHTML) / `filter.mt.js` 内では以下のヘルパーが事前定義なしで利用できます（関数呼び出し `$request()` / `$response()` とオブジェクトアクセス `$request` / `$response` の両対応）。

| ヘルパー | 説明 | 主なメソッド / プロパティ |
|---|---|---|
| `$request` / `$request()` | リクエスト情報の取得 | `.path`, `.method`, `.query`, `.body`, `.cookies`, `.ip`<br>`.getHeader(key)`, `.getQuery(key, def)`, `.getCookie(key, def)` |
| `$response` / `$response()` | レスポンスの生成・返却 | `.status(code)`, `.contentType(type, charset)`, `.header(key, val)`, `.setCookie(name, val, opt)`, `.deleteCookie(name)`<br>`.json(data, status)`, `.html(str, status)`, `.text(str, status)`, `.redirect(url, status)`, `.body(val)` |
| `$include(path, params)` | 別テンプレート/HTMLのインクルード | `${$include("./parts/header.mt.html", { title: "..." })}`<br>（`${$include(...)}` は自動で await 補完） |
| `$params` | インクルードパラメータの参照 | テンプレートやパーツ内で `${$params.title}` や `${$params.user}` としてアクセス |
| `$loadLib("name.js")` | モジュールのロード | `lib/` → `validates/` → `${MAACHANG_HOME}/modules/` の順で検索してロード |
| `$loadConf("conf名")` | 設定 JSON の取得 | `conf/{conf名}.local.json`（ローカル優先）→ `conf/{conf名}.json` を取得 |
| `$db` | SQLite3 データベース操作 | `bun:sqlite` ラッパー。<br>`$db.get(sql, params)`, `$db.all(sql, params)`, `$db.run(sql, params)`, `$db.exec(sql)`, `$db.transaction(fn)` |
| `$require(mod)` | 標準ライブラリ require | `crypto`, `path`, `fs` 等の安全な呼び出し |

---

# 環境変数 & 設定ファイル定義 (`conf/*.json`, `process.env`, `$loadConf`)

- **JS コメント (JSONC) 対応**: すべての `conf/*.json`（`env.json`, `server.json`, `session.json`, `log.json`, カスタム設定）で **JavaScript コメント（`//` 単一行、`/* ... */` 複数行）** および末尾カンマが自由に使用可能です。
- **環境変数の自動展開**: `conf/env.json` にキー・バリュー形式で定義した設定は、サーバー起動時およびリクエスト実行時に自動的に `process.env` に直接展開されます。
- **プログラム内からの参照**: スクリプト内（`.mt.js`, `.jhtml`, `lib/` 等）から `process.env.APP_NAME` や `process.env.API_KEY` のように標準の環境変数としてそのまま参照できます。
- **ローカル環境の上書き (`conf/env.local.json`, `conf/*.local.json`)**:
  - `conf/{name}.local.json` が存在する場合はローカル値が最優先で上書き適用されます（`.gitignore` 済みのため機密情報や開発用キーの保存に利用）。
  - 例 (`conf/env.json`):
    ```json
    // アプリケーション全体設定
    {
      "APP_ENV": "development", // 開発環境
      /* 外部連携APIエンドポイント */
      "API_BASE_URL": "https://api.example.com",
      "DEBUG_MODE": "true",
    }
    ```

---

# 主要モジュール クイックリファレンス (`$loadLib`)

### 1. `session.js`（SQLite3 セッション管理）
- **`sessionMod.createSession($response, initialData)`**: セッション新規作成 ＆ Cookie 自動発行。
- **`sessionMod.getSession($request)`**: セッションデータ取得（有効期限切れ時は自動削除＆`null` 返却）。
- **`sessionMod.setSession(sid, data)`**: セッションデータ更新。
- **`sessionMod.deleteSession($request, $response)`**: セッション削除 ＆ Cookie 破棄。
- **`sessionMod.cleanExpiredSessions()`**: 期限切れセッションの一括クリーンアップ。

### 2. `logger.js` / `localLog.js`（日別ローテーションロガー）
- **`logger.info(...)`, `logger.warn(...)`, `logger.error(...)`, `logger.debug(...)`, `logger.trace(...)`**:
  - `[YYYY-MM-DD HH:mm:ss.SSS] [LEVEL] メッセージ` 形式で標準出力および `./log/{file}.YYYY-MM-DD.log` へ出力。
- **`logger.setting({ dir, file, level, stdout })`**: ログ設定変更（`conf/log.json` による自動設定にも対応）。

### 3. `dateEx.js`（日付操作・フォーマット・期間判定ユーティリティ）
- **`DateEx.create(...)` または `DateEx(...)`**: 日付インスタンス生成（文字列、数値、Date、DateEx から生成可能）。
- **`d.change(mode, val)`**: 日時加減算（`year`, `month`, `week`, `date`, `hours`, `minutes`, `seconds`, `milliseconds`）。
- **`d.clear(mode)`**: 日時リセット（`date`, `hours` 等）。
- **`d.toString(mode, format)` / `d.toFormatString(pattern)`**: 日時フォーマット出力（`{yyyy}/{MM}/{dd}({dj}) {hh}:{mm}:{ss}` 等）。
- **`DateEx.between(date, mode).isBetween(target)`**: 月始・月末などの期間取得および範囲内外判定。

### 4. `password.js` / `jwt.js` / `csrf.js` / `rbac.js`（セキュリティ・認証）
- **`password.hash(pwd)` / `password.verify(pwd, hashed)`**: PBKDF2-HMAC-SHA256 による安全なパスワードハッシュ化・照合。
- **`jwt.sign(payload, secret, opt)` / `jwt.verify(token, secret)`**: HS256 による JWT トークン署名・検証。
- **`csrf.generateToken(sid?)` / `csrf.verify(sid?, token?)`**: セッション連携 CSRF トークン生成・検証。
- **`rbac.hasRole(role, target)` / `rbac.hasPermission(role, perm)`**: ロール・権限の検証およびルート保護。

### 5. `csvReader.js` / `csvWriter.js`（CSV 操作）
- **`csvWriter.writeCsv(headers, rows)`**: 配列/オブジェクトデータから CSV 文字列を生成。
- **`csvReader.readCsv(csvString)`**: CSV 文字列をパースして `{ headers, rows }` オブジェクト配列を取得。

### 6. `validate.js`（バリデーション & `validates/` 定義）
- **`validate.check(data, schema)`**: スキーマ定義に従って JS オブジェクトを検証（戻り値: `{ valid, errors: [{field, rule, message}], data }`）。
- **スキーマ定義の作成方法 (`validates/{name}.js`)**:
  ```javascript
  // validates/image.js
  module.exports = {
      prompt:       { type: 'string', required: true, minLen: 1, messages: { required: 'プロンプトは必須です' } },
      width:        { type: 'int', range: [64, 4096], default: 512 },
      height:       { type: 'int', range: [64, 4096], default: 512 },
      steps:        { type: 'int', range: [1, 150], default: 20 },
      cfg_scale:    { type: 'float', range: [1.0, 30.0], default: 7.0 },
      sampler_name: { type: 'string', default: 'euler_a' }
  };
  ```
- **サポート属性・ルール一覧**:
  - `type`: `'string'` / `'int'` / `'float'` / `'boolean'` / `'date'`
  - `required`: `true` / `false`（必須チェック）
  - `minLen` / `maxLen`: 文字列の最小・最大長
  - `min` / `max`: 数値・日付の最小・最大値
  - `range`: 範囲検証 (`[min, max]` または `{ min, max }`)
  - `mail`: メールアドレス形式チェック (`true`)
  - `url`: URL (`http`/`https`) 形式チェック (`true`)
  - `zip`: 郵便番号形式チェック (`true`)
  - `tel`: 電話番号形式チェック (`true`)
  - `date`: 日付形式チェック (`true`)
  - `time`: 時刻形式チェック (`true`)
  - `alphaNum`: 半角英数字チェック (`true`)
  - `pattern`: 任意正規表現 (`RegExp`)
  - `enum`: 許可値の配列 (`['euler_a', 'euler']` 等)
  - `custom`: カスタム検証関数 `(val, allData) => boolean | string`
  - `default`: 未指定時の補完値または生成関数
  - `messages`: ルール別カスタムエラーメッセージ

### 7. `sendSlack.js` / `multipart.js`（通信・ファイルアップロード）
- **`sendSlack.send(webhookUrl, message)`**: Slack Webhook への通知送信。
- **`multipart.parse(req)`**: `multipart/form-data` によるファイルアップロードの解析。

### 8. `format.js` / `encrypt.js` / `http.js`（整形・暗号化・HTTPクライアント）
- **`format.money(val)` / `format.parseMoney(str)` / `format.toHalfWidth(str)` / `format.bytes(n)` / `format.mask(str)` / `format.truncate(str, len)`**: 日本語業務画面向けフォーマット。
- **`encrypt.encrypt(plain, key)` / `encrypt.decrypt(cipher, key)`**: AES-256-GCM 可逆暗号化・復号。
- **`encrypt.randomToken(len)` / `encrypt.sha256(str)` / `encrypt.hmac(str, key)`**: ランダムトークン・ハッシュ生成。
- **`http.get(url, opt)` / `http.postJson(url, data, opt)` / `http.getJson(url, opt)`**: タイムアウト・リトライ付き HTTP クライアント。

### 9. `fileUtil.js` / `file.js`（ファイル・JSON入出力支援）
- **`fileUtil.readJson(path, def)` / `fileUtil.writeJson(path, data)`**: JSON の安全な読み書き。
- **`fileUtil.readText(path)` / `fileUtil.writeText(path, text)`**: テキストファイルの読み書き。
- **`fileUtil.list(dir, { ext, recursive })`**: 拡張子フィルタ・再帰探索付きファイル一覧。
- **`fileUtil.safeFileName(origName, allowedExts, prefix)`**: アップロードファイル名の安全な生成。

---

# ローカル実行・デプロイ手順

`${MAACHANG_HOME}/bin` に PATH が通っているため、以下のコマンドがそのまま実行できます。

- `maachang`: カレントプロジェクトでローカル開発サーバー起動（デフォルト `http://localhost:3000/`）。
  - `-p <port>`: ポート番号指定（例: `maachang -p 8080`）
  - `-h <host>`: バインドホスト指定
  - `--prod`: 本番モード起動
- `mcbuild`: 本番デプロイ用にプロジェクト内の JHTML テンプレートを一括で `.jhtml.js` に事前コンパイル。
- `bun test`: 単体・結合テストの実行。

---

# sdServer 固有アーキテクチャ & システム仕様

## 1. 全体構造

```
┌─────────────────────────────────────────────────────────────┐
│                      Web Browser (UI)                       │
│  - /generate.html  : 画像生成・AIアシスト・進捗ポーリング・中断    │
│  - /sdServers.html : SDサーバー設定 (モデル系統/defaults/テスト)│
│  - /menu.html      : ギャラリー・履歴・再編集・削除           │
│  - /models.html    : ローカルLLM管理 (ダウンロード/メモリ常駐) │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / JSON
┌──────────────────────────────▼──────────────────────────────┐
│             maachang Backend (public/api/*.mt.js)           │
│  - /api/generate   : 非同期タスク作成・ポーリング・キャンセル     │
│  - /api/assist     : モデル系統別 AI プロンプト最適化         │
│  - /api/sdServers  : サーバー設定 CRUD & 疎通テスト          │
│  - /api/models     : LLM 切替・ダウンロード進捗・キャッシュ   │
│  - /api/images     : 画像一覧・詳細・検索・DB 管理           │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
┌──────────────▼──────────────┐┌──────────────▼───────────────┐
│     lib/translator.js       ││       lib/sdClient.js        │
│  - Transformers.js 常駐     ││  - /sdcpp/v1/img_gen (Job)   │
│  - Qwen2.5 / Gemma3 ONNX    ││  - /sdcpp/v1/jobs/{id}/cancel│
│  - モデル系統別プロンプト生成││  - /sdapi/v1/txt2img (Sync)  │
└─────────────────────────────┘└──────────────┬───────────────┘
                                              │ HTTP
                               ┌──────────────▼───────────────┐
                               │  stable-diffusion.cpp サーバー │
                               │  - server-1 (192.168.0.233)  │
                               │  - server-2 (192.168.0.229)  │
                               └──────────────────────────────┘
```

## 2. 複数 SD サーバー管理とモデル系統 (Model Architecture)

- **設定ファイル**: `conf/sdServer.json`
- **モデル系統 (`modelType`)**:
  - `sd15` (**SD 1.5系**): Danbooruタグ、カンマ区切り単語、品質タグ（`masterpiece, best quality`）、ネガティブタグ（`worst quality, bad anatomy`）。AnyLoRA, Anything, Realistic Vision 等。
  - `sdxl` (**SDXL系**): クオリティスコア（`score_9, score_8_up`）＋ 短いシチュエーション文のハイブリッド。Pony Diffusion XL, Animagine XL 等。
  - `natural` (**自然言語型**): 主語・環境・照明・構図を詳細に記述した自然な英文段落。品質タグやネガティブタグは排除。FLUX, Qwen-Image, SD 3.5, DiT 等。
- **パラメータ継承優先度**:
  `リクエスト指定値` > `サーバー個別 defaults` > `共通 defaults` > `ハードコード規定値 (512x512, 20 steps, euler_a)`

## 3. 非同期タスク & タイムアウト完全回避アーキテクチャ

- **課題**: `Bun.serve` のソケットアイドル制限（最大 255 秒）および Linux TCP アイドル制限（約 280 秒）により、単一の同期接続では長時間推論（qwen-image 等で 3〜5分以上）時に `The operation timed out.` が発生する。
- **2重の非同期化による解決**:
  1. **UI ⇔ 中間サーバー (`generate.mt.js`)**:
     - `POST /api/generate` でタスク開始後、即座に `taskId` を返却（数ms）。
     - UI は `GET /api/generate?taskId=xxx` を 1 秒間隔でポーリング。
  2. **中間サーバー ⇔ SD サーバー (`sdClient.js`)**:
     - まず SD サーバーの非同期ジョブ API (`POST /sdcpp/v1/img_gen`) を呼び出しジョブ ID を取得。
     - `GET /sdcpp/v1/jobs/{id}` を 1.5 秒間隔で軽量ポーリングし、完了時に画像を取得。
     - ソケットを長時間開いたまま放置しないため、長大生成でもタイムアウトが原理的に発生しない。

## 4. 画面遷移・中断処理と SD サーバー制御

- **UI 側の保護**:
  - 生成中のリンククリック時に確認ダイアログを表示。
  - ブラウザバック、タブクローズ、リロード時に `beforeunload` で警告。
  - 離脱時は `fetch(..., { keepalive: true })` と `navigator.sendBeacon` を併用して確実にキャンセル命令を送信。
- **SD サーバーの中断**:
  - 中間サーバーは `AbortController` でタスクを破棄し、対象サーバーへ `POST /sdcpp/v1/jobs/{id}/cancel` を送信。

## 5. ローカル LLM プロンプト最適化 (`lib/translator.js`)

- Transformers.js により同一プロセス内で ONNX モデルを実行。
- `assistPrompt(text, currentNegative, modelType)`:
  - 渡された `modelType`（`sd15` / `sdxl` / `natural`）に応じてシステムプロンプトを切り替え、LLM に最適なプロンプト形式を出力させる。

## 6. 履歴管理とデータ整合性 (`lib/imageModel.js`)

- SQLite `images` テーブルに `server_id` と `server_name` を保存。
- 過去データ（未設定）の取得時は `server-1` / `[低速]画像汎用` に自動フォールバック。
- ギャラリーの「✏️ 再編集」時は、生成当時のプロンプト・サーバー設定が忠実に復元される。
- **編集モード時のサーバー変更制御**: 編集画面で画像生成サーバーを変更した場合は確認ダイアログを表示。「OK」を選択した場合、解像度（幅・高さ）およびプロンプトを維持したまま、対象サーバーの推奨パラメータ（ステップ数、CFGスケール、サンプラー等）のみを安全に置き換える。

---

# REST API エンドポイントリファレンス

| メソッド | パス | 説明 | 主なパラメータ / ボディ |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/generate` | 生成タスク作成 / キャンセル | `{ prompt, width, height, steps, cfg_scale, sampler_name, seed, serverId, promptMode }` または `{ action: "cancel", taskId }` |
| `GET` | `/api/generate` | タスクステータス確認 | `?taskId=task_xxx` |
| `POST` | `/api/assist` | モデル系統別 AI プロンプト最適化 | `{ prompt, negative_prompt, serverId, modelType }` |
| `POST` | `/api/translate` | プロンプト英語直訳 | `{ text }` |
| `GET` | `/api/sdServers` | SD サーバー全設定取得 | なし |
| `POST` | `/api/sdServers` | サーバー保存 / 削除 / 接続テスト | `{ action: "saveServer"|"deleteServer"|"setActive"|"testConnection", ... }` |
| `GET` | `/api/models` | LLM モデル一覧・進捗取得 | なし |
| `POST` | `/api/models` | LLM 切替・追加・キャッシュ削除 | `{ action: "load"|"add"|"delete"|"deleteCache", modelId }` |
| `GET` | `/api/images` | 画像履歴一覧・検索取得 | `?page=1&limit=20&keyword=xxx` |
| `POST` | `/api/save` | 一時生成画像の永続保存 | `{ base64Data, prompt, negative_prompt, seed, ... }` |
| `POST` | `/api/delete` | 画像と DB レコードの完全削除 | `{ id }` |

---

# ディレクトリ構成

| ディレクトリ・ファイル | 役割 |
|---|---|
| `public/` | Web コンテンツ・動的スクリプト (`*.mt.js` / `*.html`) の配置先 |
| `public/filter.mt.js` | 共通リクエストフィルター（認証・認可・共通前処理） |
| `lib/` | プロジェクト固有モジュール (`imageModel.js`, `sdClient.js`, `translator.js`) |
| `conf/` | 設定 JSON (`sdServer.json`, `localLlm.json`, `server.json`, `env.json`) |
| `data/` | SQLite3 DB ファイル (`sdServer.db`, `session.db`) の配置先 |
| `schema/` | テーブルスキーマ定義 (`images.sql`) の保存・出力先 |
| `validates/` | バリデーション定義ファイル (`image.js`) の保存・配置先 |
| `log/` | 日別ローテーションログファイルの出力先 |
| `package.json` | プロジェクト設定・npm scripts |
| `.claude/CLAUDE.md` | 本ファイル |

---

# あえてやってないこと

- **プロンプト入力値のブラウザ LocalStorage 一次保存**:
  - 複数サーバーやモデル系統、デフォルト値機能が拡張されたため、新規作成時は常にサーバーの defaults を適用し、誤ったプロンプトが予期せず引き継がれるのを防止。
- **同期型ソケット接続での長時間待機**:
  - タイムアウトの原因となるため、すべて非同期タスク・ポーリング方式で統一。

# 未対応・残課題(随時更新)

- stable-diffusion.cpp 側のサンプリング中（generating）の割り込み中断機能の公式対応待ち（現状はキュー待機中の中断に対応）。
