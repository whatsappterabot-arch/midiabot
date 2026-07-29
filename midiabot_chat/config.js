// config.js — Midiabot_chat (produto separado do painel admin, config própria)
export const CONFIG = {
    API_URL: 'https://awkwardgiantpanda-n8n.cloudfy.live/webhook/3321f05a-290e-484a-9298-8804daee55d2',

    APP_NAME: 'Midiabot_chat'
};

const TOAST_COLORS = {
    success: 'bg-[#00b34d]',
    error: 'bg-red-500',
    warning: 'bg-amber-500',
    info: 'bg-[#001f3f]'
};

export function showToast(message, type = 'info') {
    let container = document.getElementById('midiachat-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'midiachat-toast-container';
        container.className = 'fixed top-4 right-4 z-50 flex flex-col gap-2 items-end';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `${TOAST_COLORS[type] || TOAST_COLORS.info} text-white text-sm font-medium px-5 py-3 rounded-xl shadow-lg transition-all duration-300 opacity-0 translate-x-4 max-w-xs`;
    toast.innerText = message;
    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.remove('opacity-0', 'translate-x-4');
    });

    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-x-4');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
