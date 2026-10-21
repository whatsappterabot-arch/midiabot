// config.js
export const CONFIG = {
    // Webhook exclusivo para o fluxo de autenticação (index.html)
    LOGIN_URL: 'https://awkwardgiantpanda-n8n.cloudfy.live/webhook/f9f1ae2e-018c-4d02-b121-b346d641bbf1',

    // Webhook para todas as outras atividades (CRUD, listagem, etc)
    API_URL: 'https://awkwardgiantpanda-n8n.cloudfy.live/webhook/df72b1bc-ce3b-456b-a0b6-dfa8ecc34408',

    // Webhook exclusivo do modo suporte (admin "ver como cliente")
    SUPORTE_URL: 'https://awkwardgiantpanda-n8n.cloudfy.live/webhook/3cd95c6d-b704-488c-841e-765f3fbbf740',

    APP_NAME: 'MidiaBot'
};

const TOAST_COLORS = {
    success: 'bg-[#00b34d]',
    error: 'bg-red-500',
    warning: 'bg-amber-500',
    info: 'bg-[#001f3f]'
};

export async function chamarApi(origem, acao, dadosExtra, user, plataforma = 'whatsapp') {
    const payload = {
        origem,
        plataforma,
        acao,
        id_cliente: user?.id_cliente ?? user?.id,
        token: user?.token,
        dados: dadosExtra
    };

    const res = await fetch(CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('Erro na API');
    return res.json();
}

export async function verificarLinkConfiguracao(user) {
    const link = document.getElementById('link-completar-config');
    if (!link) return;
    try {
        const res = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                origem: 'dashboard',
                plataforma: 'whatsapp',
                acao: 'verificar_status_cliente',
                id_cliente: user?.id_cliente ?? user?.id,
                token: user?.token,
                dados: {}
            })
        });
        const resultado = await res.json();
        const dados = Array.isArray(resultado) ? resultado[0] : resultado;
        const naoConfigurado = Number(dados?.salas_ativas) === 0;
        link.classList.toggle('hidden', !naoConfigurado);
    } catch (e) {
        console.error('Falha ao verificar status de configuração:', e);
    }
}

export async function listarClientesSuporte(user) {
    const res = await fetch(CONFIG.SUPORTE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'listar_clientes', token: user?.token })
    });
    if (!res.ok) throw new Error('Erro ao listar clientes');
    return res.json();
}

export async function entrarComoCliente(user, idCliente) {
    const res = await fetch(CONFIG.SUPORTE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'entrar_como_cliente', token: user?.token, dados: { id_cliente: idCliente } })
    });
    const data = await res.json();
    if (!res.ok || !data?.autorizado) throw new Error(data?.erro || 'Erro ao entrar como cliente');
    return data;
}

// Restaura a sessão original do admin guardada antes de entrar em modo suporte. Retorna false se não havia nenhuma.
export function sairDoModoSuporte() {
    const original = localStorage.getItem('midiabot_admin_original');
    if (!original) return false;
    localStorage.setItem('midiabot_user', original);
    localStorage.removeItem('midiabot_admin_original');
    return true;
}

export function showToast(message, type = 'info') {
    let container = document.getElementById('midiabot-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'midiabot-toast-container';
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
