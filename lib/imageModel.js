/**
 * 画像データモデル (SQLite3 - 永続化ファイルストレージ)
 */
const fs = require('node:fs');
const path = require('node:path');

const DB_PATH = path.join(process.cwd(), 'data', 'images.sqlite3');

function getDbModule() {
    if (typeof $db !== 'undefined') {
        return $db;
    }
    try {
        const maachangHome = process.env.MAACHANG_HOME || path.resolve(__dirname, '../../maachang');
        return require(path.join(maachangHome, 'src', 'db.js'));
    } catch (e) {
        throw new Error('Database module not accessible: ' + e.message);
    }
}

function getDb() {
    const dbModule = getDbModule();
    return {
        get: (sql, params = []) => dbModule.get(sql, params, DB_PATH),
        all: (sql, params = []) => dbModule.all(sql, params, DB_PATH),
        run: (sql, params = []) => dbModule.run(sql, params, DB_PATH),
        exec: (sql) => dbModule.exec(sql, DB_PATH)
    };
}

/**
 * PNGファイル内の tEXt / iTXt チャンクから生成パラメータを抽出
 * @param {string} filePath 
 */
function parsePngMetadata(filePath) {
    try {
        const buf = fs.readFileSync(filePath);
        let offset = 8;
        let paramsText = '';
        while (offset < buf.length) {
            const length = buf.readUInt32BE(offset);
            const type = buf.toString('ascii', offset + 4, offset + 8);
            if (type === 'tEXt' || type === 'iTXt') {
                const chunkStr = buf.slice(offset + 8, offset + 8 + length).toString('utf8');
                if (chunkStr.startsWith('parameters\0') || chunkStr.startsWith('parameters ')) {
                    paramsText = chunkStr.replace(/^parameters[\0 ]/, '');
                    break;
                }
            }
            offset += 12 + length;
        }

        let prompt = '';
        let negative_prompt = '';
        let width = 512;
        let height = 512;
        let steps = 20;
        let cfg_scale = 7.0;
        let seed = -1;
        let sampler_name = 'euler_a';

        if (paramsText) {
            // SDCPP JSON 形式の抽出
            const sdcppMatch = paramsText.match(/SDCPP:\s*(\{.*\})/s);
            if (sdcppMatch) {
                try {
                    const sdcpp = JSON.parse(sdcppMatch[1]);
                    if (sdcpp.prompt) {
                        prompt = sdcpp.prompt.positive || '';
                        negative_prompt = sdcpp.prompt.negative || '';
                    }
                    if (sdcpp.width) width = sdcpp.width;
                    if (sdcpp.height) height = sdcpp.height;
                    if (sdcpp.seed !== undefined) seed = sdcpp.seed;
                    if (sdcpp.sampling?.steps) steps = sdcpp.sampling.steps;
                    if (sdcpp.sampling?.guidance?.txt_cfg) cfg_scale = sdcpp.sampling.guidance.txt_cfg;
                } catch (e) {}
            }

            if (!prompt) {
                // A1111 互換テキスト形式
                const lines = paramsText.split('\n');
                let negIdx = -1;
                let stepsIdx = -1;
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].startsWith('Negative prompt:')) negIdx = i;
                    if (lines[i].startsWith('Steps:')) stepsIdx = i;
                }

                if (negIdx !== -1) {
                    prompt = lines.slice(0, negIdx).join('\n').trim();
                    const negEnd = stepsIdx !== -1 ? stepsIdx : lines.length;
                    negative_prompt = lines.slice(negIdx, negEnd).join('\n').replace(/^Negative prompt:\s*/, '').trim();
                } else if (stepsIdx !== -1) {
                    prompt = lines.slice(0, stepsIdx).join('\n').trim();
                } else {
                    prompt = paramsText.trim();
                }
            }
        }

        return { prompt, negative_prompt, width, height, steps, cfg_scale, seed, sampler_name };
    } catch (e) {
        return null;
    }
}

/**
 * uploads フォルダ内の実体ファイルと DB レコードの同期（未登録ファイルのリカバリ）
 */
function syncUploadsFolder(db) {
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    if (!fs.existsSync(uploadsDir)) return;

    try {
        const files = fs.readdirSync(uploadsDir).filter(f => f.toLowerCase().endsWith('.png'));
        if (files.length === 0) return;

        const existingRows = db.all('SELECT image_path FROM images');
        const existingPaths = new Set((existingRows || []).map(r => r.image_path));

        for (const file of files) {
            const relPath = `/uploads/${file}`;
            if (!existingPaths.has(relPath)) {
                const fullPath = path.join(uploadsDir, file);
                const stat = fs.statSync(fullPath);
                
                // ファイル名タイムスタンプ (1787574629276_... 形式) または mtime
                let createdAtDate = stat.mtime;
                const tsMatch = file.match(/^(\d{13})/);
                if (tsMatch) {
                    const parsedTs = parseInt(tsMatch[1], 10);
                    if (!isNaN(parsedTs)) createdAtDate = new Date(parsedTs);
                }
                const createdAtIso = createdAtDate.toISOString();

                // PNG メタデータ解析
                const meta = parsePngMetadata(fullPath) || {};
                const prompt = meta.prompt || file.replace(/\.png$/i, '');
                const negative_prompt = meta.negative_prompt || '';
                const width = meta.width || 512;
                const height = meta.height || 512;
                const steps = meta.steps || 20;
                const cfg_scale = meta.cfg_scale || 7.0;
                const seed = meta.seed !== undefined ? meta.seed : -1;
                const sampler_name = meta.sampler_name || 'euler_a';

                db.run(`
                    INSERT INTO images (
                        prompt, negative_prompt, translated_prompt, translated_negative_prompt,
                        width, height, steps, cfg_scale, seed, sampler_name,
                        image_path, parent_id, generation_time_ms, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    prompt,
                    negative_prompt,
                    prompt, // translated_prompt
                    negative_prompt,
                    width,
                    height,
                    steps,
                    cfg_scale,
                    seed,
                    sampler_name,
                    relPath,
                    null,
                    0,
                    createdAtIso,
                    createdAtIso
                ]);
                console.log(`[imageModel] Restored image record from uploads: ${relPath}`);
            }
        }
    } catch (e) {
        console.error('[imageModel] Error syncing uploads folder:', e);
    }
}

function initTable() {
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    const db = getDb();
    const sqlPath = path.join(process.cwd(), 'schema', 'images.sql');
    if (fs.existsSync(sqlPath)) {
        const sql = fs.readFileSync(sqlPath, 'utf8');
        db.exec(sql);
    }

    // 既存テーブルへのカラム追加マイグレーション
    try {
        const columns = db.all("PRAGMA table_info(images)");
        const colNames = (columns || []).map(c => c.name);

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
        console.error('[imageModel] Migration error:', e);
    }

    // uploads フォルダ内の実体ファイルとの自動同期
    syncUploadsFolder(db);
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
