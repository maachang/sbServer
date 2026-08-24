/**
 * 画像データモデル (SQLite3)
 */
const fs = require('node:fs');
const path = require('node:path');

function getDb() {
    if (typeof $db !== 'undefined') {
        return $db;
    }
    try {
        const maachangHome = process.env.MAACHANG_HOME || path.resolve(__dirname, '../../maachang');
        const dbWrapper = require(path.join(maachangHome, 'src', 'db.js'));
        return dbWrapper;
    } catch (e) {
        throw new Error('Database module not accessible: ' + e.message);
    }
}

function initTable() {
    const db = getDb();
    const sqlPath = path.join(process.cwd(), 'schema', 'images.sql');
    if (fs.existsSync(sqlPath)) {
        const sql = fs.readFileSync(sqlPath, 'utf8');
        db.exec(sql);
    }

    // 既存テーブルへのカラム追加マイグレーション
    try {
        const columns = db.all("PRAGMA table_info(images)");
        const colNames = columns.map(c => c.name);

        if (!colNames.includes('generation_time_ms')) {
            db.exec("ALTER TABLE images ADD COLUMN generation_time_ms INTEGER DEFAULT 0");
        }
        if (!colNames.includes('translated_prompt')) {
            db.exec("ALTER TABLE images ADD COLUMN translated_prompt TEXT DEFAULT ''");
        }
        if (!colNames.includes('translated_negative_prompt')) {
            db.exec("ALTER TABLE images ADD COLUMN translated_negative_prompt TEXT DEFAULT ''");
        }
    } catch (e) {
        console.error('Migration error:', e);
    }
}

// 初回テーブル作成
try {
    initTable();
} catch (e) {
    console.error('Error initializing images table:', e);
}

module.exports = {
    /**
     * 画像一覧取得（検索・ページネーション対応）
     */
    findImages(options = {}) {
        const db = getDb();
        const { keyword = '', limit = 20, offset = 0 } = options;
        let sql = 'SELECT * FROM images';
        const params = [];

        if (keyword && keyword.trim() !== '') {
            sql += ' WHERE prompt LIKE ? OR negative_prompt LIKE ? OR translated_prompt LIKE ? OR translated_negative_prompt LIKE ?';
            const k = `%${keyword.trim()}%`;
            params.push(k, k, k, k);
        }

        sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const rows = db.all(sql, params);

        let countSql = 'SELECT COUNT(*) as count FROM images';
        const countParams = [];
        if (keyword && keyword.trim() !== '') {
            countSql += ' WHERE prompt LIKE ? OR negative_prompt LIKE ? OR translated_prompt LIKE ? OR translated_negative_prompt LIKE ?';
            const k = `%${keyword.trim()}%`;
            countParams.push(k, k, k, k);
        }
        const totalResult = db.get(countSql, countParams);
        const total = totalResult ? totalResult.count : 0;

        return {
            items: rows || [],
            total,
            limit,
            offset
        };
    },

    /**
     * ID指定で画像取得
     */
    getImageById(id) {
        const db = getDb();
        return db.get('SELECT * FROM images WHERE id = ?', [id]);
    },

    /**
     * 画像データ挿入
     */
    createImage(data) {
        const db = getDb();
        const now = new Date().toISOString();
        const sql = `
            INSERT INTO images (
                prompt, negative_prompt, translated_prompt, translated_negative_prompt,
                width, height, steps, cfg_scale, seed, sampler_name,
                image_path, parent_id, generation_time_ms, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const result = db.run(sql, [
            data.prompt,
            data.negative_prompt || '',
            data.translated_prompt || '',
            data.translated_negative_prompt || '',
            data.width || 512,
            data.height || 512,
            data.steps || 20,
            data.cfg_scale || 7.0,
            data.seed !== undefined ? data.seed : -1,
            data.sampler_name || 'euler_a',
            data.image_path,
            data.parent_id || null,
            data.generation_time_ms || 0,
            now,
            now
        ]);
        return result.lastInsertRowid;
    },

    /**
     * 画像削除
     */
    deleteImage(id) {
        const db = getDb();
        const item = this.getImageById(id);
        if (!item) return false;

        // DBレコード削除
        db.run('DELETE FROM images WHERE id = ?', [id]);

        // 実画像ファイルの削除（存在する場合）
        try {
            if (item.image_path) {
                const fullPath = path.join(process.cwd(), 'public', item.image_path.replace(/^\//, ''));
                if (fs.existsSync(fullPath)) {
                    fs.unlinkSync(fullPath);
                }
            }
        } catch (e) {
            console.error('Failed to delete image file:', e);
        }

        return true;
    }
};
