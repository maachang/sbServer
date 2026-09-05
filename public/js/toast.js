/**
 * toast.js - sdServer 共通トースト・アラート通知コンポーネント
 * 
 * JHTML (jhtml.browser.js) を活用し、各画面共通のフローティング通知（トースト）を提供します。
 * 使用法:
 *   showToast('保存しました', 'success');
 *   showToast('エラーが発生しました: ' + err.message, 'error', 5000);
 */
(function(global) {
    'use strict';

    let toastContainer = null;

    function ensureContainer() {
        if (!toastContainer || !document.body.contains(toastContainer)) {
            toastContainer = document.getElementById('toastContainer');
            if (!toastContainer) {
                toastContainer = document.createElement('div');
                toastContainer.id = 'toastContainer';
                toastContainer.style.cssText = `
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    z-index: 10000;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    max-width: 380px;
                    width: calc(100% - 40px);
                    pointer-events: none;
                `;
                document.body.appendChild(toastContainer);
            }
        }
        return toastContainer;
    }

    /**
     * トースト通知を表示する
     * @param {string} message - 表示メッセージ
     * @param {'success'|'error'|'info'|'warning'} [type='success'] - 通知種別
     * @param {number} [duration=4000] - 表示時間(ミリ秒)
     */
    async function showToast(message, type = 'success', duration = 4000) {
        const container = ensureContainer();

        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };

        const bgColors = {
            success: '#f0fdf4',
            error: '#fef2f2',
            warning: '#fffbeb',
            info: '#eff6ff'
        };

        const borderColors = {
            success: '#bbf7d0',
            error: '#fecaca',
            warning: '#fde68a',
            info: '#bfdbfe'
        };

        const textColors = {
            success: '#166534',
            error: '#991b1b',
            warning: '#92400e',
            info: '#1e40af'
        };

        const toastEl = document.createElement('div');
        toastEl.style.cssText = `
            pointer-events: auto;
            display: flex;
            align-items: flex-start;
            gap: 10px;
            padding: 12px 16px;
            background: ${bgColors[type] || '#ffffff'};
            border: 1px solid ${borderColors[type] || '#cbd5e1'};
            color: ${textColors[type] || '#1e293b'};
            border-radius: 8px;
            box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05);
            font-size: 13px;
            line-height: 1.4;
            transition: all 0.25s ease-out;
            transform: translateX(30px);
            opacity: 0;
            word-break: break-all;
        `;

        toastEl.innerHTML = jhtml.html`
            <span style="font-size: 16px; line-height: 1; flex-shrink: 0;">${icons[type] || 'ℹ️'}</span>
            <div style="flex: 1; font-weight: 500;">${message}</div>
            <button type="button" style="background: none; border: none; cursor: pointer; color: inherit; opacity: 0.6; font-size: 16px; line-height: 1; padding: 0;" title="閉じる">✕</button>
        `;

        container.appendChild(toastEl);

        // フェードイン
        requestAnimationFrame(() => {
            toastEl.style.transform = 'translateX(0)';
            toastEl.style.opacity = '1';
        });

        const closeBtn = toastEl.querySelector('button');
        let timer = null;

        const dismiss = () => {
            if (timer) clearTimeout(timer);
            toastEl.style.transform = 'translateX(30px)';
            toastEl.style.opacity = '0';
            setTimeout(() => {
                if (toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
            }, 250);
        };

        if (closeBtn) closeBtn.addEventListener('click', dismiss);
        if (duration > 0) timer = setTimeout(dismiss, duration);
    }

    global.showToast = showToast;
})(window);
