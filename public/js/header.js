/**
 * header.js - sdServer 共通ナビゲーションヘッダー
 *
 * JHTML (jhtml.browser.js) を活用し、各画面のヘッダーを一括レンダリングします。
 */
(function(global) {
    'use strict';

    const NAV_ITEMS = [
        { key: 'generate', href: '/generate.html?mode=new', text: '➕ 新規作成', btnClass: 'btn-primary' },
        { key: 'sdServers', href: '/sdServers.html', text: '⚙️ sd-server設定', btnClass: 'btn-secondary' },
        { key: 'models', href: '/models.html', text: '🤖 LLM設定', btnClass: 'btn-secondary' },
        { key: 'menu', href: '/menu.html', text: '一覧へ戻る', btnClass: 'btn-secondary' }
    ];

    /**
     * 共通ヘッダーをレンダリングする
     * @param {Object} options
     * @param {string|Element} [options.target='header'] - マウント先セレクタまたはElement
     * @param {string} [options.currentPage] - 現在のページ ('menu' | 'generate' | 'sdServers' | 'models')
     * @param {string} [options.subTitle] - 画面サブタイトル（例: '画像管理・生成'）
     * @param {string} [options.badgeId] - サブタイトルに割り当てるID（例: 'pageModeBadge'）
     */
    async function renderHeader(options = {}) {
        const target = typeof options.target === 'string'
            ? document.querySelector(options.target)
            : (options.target || document.querySelector('header'));

        if (!target) return;

        // 現在のページ判定（指定がない場合は pathname から自動推測）
        const pathname = window.location.pathname;
        let currentPage = options.currentPage;
        if (!currentPage) {
            if (pathname.includes('generate.html')) currentPage = 'generate';
            else if (pathname.includes('sdServers.html')) currentPage = 'sdServers';
            else if (pathname.includes('models.html')) currentPage = 'models';
            else currentPage = 'menu';
        }

        const subTitle = options.subTitle !== undefined ? options.subTitle : (
            currentPage === 'menu' ? '画像管理・生成' :
            currentPage === 'generate' ? '新規画像生成' :
            currentPage === 'sdServers' ? 'sd-server設定' :
            currentPage === 'models' ? '🤖 LLM アシスト・翻訳設定' : ''
        );

        const badgeId = options.badgeId || (currentPage === 'generate' ? 'pageModeBadge' : '');

        // 表示するナビゲーションアクションを構築
        // menu.htmlでは「一覧へ戻る」は不要
        const actions = NAV_ITEMS.filter(item => {
            if (currentPage === 'menu' && item.key === 'menu') return false;
            return true;
        });

        // JHTML テンプレート
        const tpl = `
            <div class="header-title">
                <a href="/menu.html" style="text-decoration: none; color: inherit; display: flex; align-items: center; gap: 4px;">
                    <span>🎨 sdServer</span>
                </a>
                <span <% if (badgeId) { %>id="\${badgeId}"<% } %> style="font-size: 13px; font-weight: normal; color: #6b7280; margin-left: 8px;">\${subTitle}</span>
            </div>
            <div class="header-actions">
                <% actions.forEach(action => { %>
                    <a href="\${action.href}" class="btn \${action.btnClass}">\${action.text}</a>
                <% }); %>
            </div>
        `;

        const html = await jhtml.compile(tpl)({
            currentPage,
            subTitle,
            badgeId,
            actions
        });

        target.innerHTML = html;
    }

    // グローバル公開
    global.renderHeader = renderHeader;

    // ヘッダー初期化関数
    function initHeader() {
        const headerEl = document.querySelector('header');
        if (headerEl) {
            return renderHeader({
                target: headerEl,
                currentPage: headerEl.dataset.currentPage,
                subTitle: headerEl.dataset.subTitle,
                badgeId: headerEl.dataset.badgeId
            });
        }
        return Promise.resolve();
    }

    global.headerInitPromise = initHeader();
})(window);
