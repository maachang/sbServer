-- 画像生成履歴・管理テーブル
CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT DEFAULT '',
    prompt TEXT NOT NULL,
    negative_prompt TEXT DEFAULT '',
    translated_prompt TEXT DEFAULT '',
    translated_negative_prompt TEXT DEFAULT '',
    width INTEGER DEFAULT 512,
    height INTEGER DEFAULT 512,
    steps INTEGER DEFAULT 20,
    cfg_scale REAL DEFAULT 7.0,
    seed INTEGER DEFAULT -1,
    sampler_name TEXT DEFAULT 'euler_a',
    image_path TEXT NOT NULL,
    parent_id INTEGER DEFAULT NULL,
    server_id TEXT DEFAULT '',
    server_name TEXT DEFAULT '',
    theme TEXT DEFAULT '',
    generation_time_ms INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_images_parent_id ON images(parent_id);
CREATE INDEX IF NOT EXISTS idx_images_theme ON images(theme);
