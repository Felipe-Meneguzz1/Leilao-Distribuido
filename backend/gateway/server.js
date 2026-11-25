'use strict';
/** Dashboard acadêmico: gerenciamento local de membros pré-provisionados e quórum seguro. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createAuth, validateOrigin } = require('./auth');
const PORT = Number(process.env.PORT || 8080);
const TOKEN = process.env.CONTROL_TOKEN || 'lab-local-demo';
const NODES = new Map((process.env.CLUSTER_NODES || '1=http://localhost:3001,2=http://localhost:3002,3=http://localhost:3003').split(',').map(x => { const i = x.indexOf('='); return [Number(x.slice(0, i)), x.slice(i + 1).replace(/\/$/, '')]; }));
const defaultActive = (process.env.CLUSTER_INITIAL_ACTIVE || '1,2,3').split(',').map(Number).sort((a, b) => a - b);
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), '.data', 'dashboard');
const STORE = path.join(DATA_DIR, 'cluster-config.json');
fs.mkdirSync(DATA_DIR, { recursive: true });
const auth = createAuth(DATA_DIR);
const original = { epoch: 0, activeIds: defaultActive, writeQuorum: Math.floor(defaultActive.length / 2) + 1, names: Object.fromEntries([...NODES.keys()].map(id => [id, `Nó ${id}`])) };
let config = fs.existsSync(STORE) ? JSON.parse(fs.readFileSync(STORE, 'utf8')) : original;
const pub = path.resolve(process.env.FRONTEND_DIST || path.join(__dirname, '../../frontend/dist'));
let serial = Promise.resolve(), reconfiguring = false;
const json = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(data)); };
const fail = (code, message) => Object.assign(new Error(message), { status: code });
const strictMajority = ids => Math.floor(ids.length / 2) + 1;
function validate(c) { return c && Number.isInteger(c.epoch) && Array.isArray(c.activeIds) && c.activeIds.length >= 2 && new Set(c.activeIds).size === c.activeIds.length && c.activeIds.every(id => NODES.has(id)) && Number.isInteger(c.writeQuorum) && c.writeQuorum >= strictMajority(c.activeIds) && c.writeQuorum <= c.activeIds.length && c.names && [...NODES.keys()].every(id => typeof c.names[id] === 'string' && c.names[id].length >= 2 && c.names[id].length <= 40); }
if (!validate(config)) throw Error('Configuração do dashboard inválida');
function storeConfig(c) { const tmp = STORE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(c, null, 2)); fs.renameSync(tmp, STORE); }
function body(req) { return new Promise((resolve, reject) => { let bufs = [], size = 0; req.on('data', b => { size += b.length; if (size > 32768) { reject(fail(413, 'Requisição muito grande')); req.destroy(); } else bufs.push(b); }); req.on('end', () => { try { resolve(bufs.length ? JSON.parse(Buffer.concat(bufs).toString()) : {}); } catch { reject(fail(400, 'JSON inválido')); } }); req.on('error', reject); }); }
async function call(id, route, method = 'GET', payload, { admin = false, timeout = 1400 } = {}) { const base = NODES.get(Number(id)); if (!base) throw fail(404, 'Nó inexistente'); const res = await fetch(base + route, { method, headers: { 'content-type': 'application/json', 'x-control-token': TOKEN }, body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(timeout) }); const data = await res.json().catch(() => ({})); if (!res.ok) throw fail(res.status, data.error || `Falha HTTP ${res.status}`); return data; }
async function inspect() {
    const checks = await Promise.all([...NODES.keys()].map(async id => { try { const a = await call(id, '/_admin/state', 'GET', undefined, { admin: true, timeout: 1100 }); return { id, name: config.names[id], member: config.activeIds.includes(id), reachable: !!(config.activeIds.includes(id) && !a.paused && a.member), connected: true, paused: a.paused, leaderId: a.leaderId, term: a.term, seq: a.seq, lamport: a.lamport, configEpoch: a.configEpoch, events: a.events || [] }; } catch { return { id, name: config.names[id], member: config.activeIds.includes(id), reachable: false, connected: false, paused: null, leaderId: null, term: null, seq: null, lamport: null, configEpoch: null, events: [] }; } }));
    const live = checks.filter(n => n.reachable), claims = live.filter(n => n.leaderId === n.id), winner = claims.sort((a, b) => (b.term || 0) - (a.term || 0))[0]; const configured = checks.filter(n => n.member); const synchronized = checks.every(n => !n.connected || n.configEpoch === config.epoch) && configured.every(n => n.connected && n.configEpoch === config.epoch);
    return { nodes: checks, leaderId: winner?.id || null, quorum: config.writeQuorum, minimumQuorum: strictMajority(config.activeIds), configuredCount: config.activeIds.length, capacity: NODES.size, activeIds: config.activeIds, epoch: config.epoch, liveCount: live.length, majority: live.length >= config.writeQuorum && synchronized, synchronized, reconfiguring };
}
async function forward(route, method, payload, receiver) { const s = await inspect(); if (!s.majority) throw fail(503, s.synchronized ? 'Sem quórum de nós disponíveis. Operação bloqueada.' : 'Configuração ainda não sincronizada; operação bloqueada.'); const chosen = receiver ? s.nodes.find(n => n.id === Number(receiver) && n.reachable) : s.nodes.find(n => n.id === s.leaderId && n.reachable); if (!chosen) throw fail(503, 'Nó escolhido indisponível ou líder ainda não eleito'); return call(chosen.id, route, method, payload, { timeout: 6500 }); }
async function allAdminsConnected() { const all = await Promise.all([...NODES.keys()].map(async id => { try { await call(id, '/_admin/state', 'GET', undefined, { admin: true, timeout: 1700 }); return true; } catch { return false; } })); if (!all.every(Boolean)) throw fail(503, 'Para alterar os membros ou o quórum, os 5 contêineres devem estar iniciados (mesmo os inativos). Confira docker compose ps.'); }
/** API de configuração centralizada apenas para demonstração local; não é consenso distribuído. */
async function changeConfig(next, bootstrapId) {
    if (!validate(next)) throw fail(400, 'Configuração inválida; quórum deve ser pelo menos a maioria dos membros.'); if (reconfiguring) throw fail(409, 'Alteração de configuração em andamento'); const status = await inspect(); if (!status.majority || !status.leaderId) throw fail(503, 'Reconfiguração requer líder eleito e quórum da configuração atual');
    reconfiguring = true; const previous = config;
    try {
        await allAdminsConnected(); if (bootstrapId) { await call(bootstrapId, '/_admin/failure', 'POST', { paused: false }, { admin: true, timeout: 1700 }); await call(bootstrapId, '/_admin/bootstrap', 'POST', { sourceId: status.leaderId }, { admin: true, timeout: 4500 }); } const proposal = { ...next, activeIds: [...next.activeIds].sort((a, b) => a - b), epoch: previous.epoch + 1 }; const attempts = await Promise.allSettled([...NODES.keys()].map(id => call(id, '/_admin/config', 'POST', { config: proposal }, { admin: true, timeout: 3300 })));
        if (attempts.some(r => r.status === 'rejected')) { const rollback = { ...previous, epoch: proposal.epoch + 1 }; config = rollback; storeConfig(rollback); await Promise.allSettled([...NODES.keys()].map(id => call(id, '/_admin/config', 'POST', { config: rollback }, { admin: true, timeout: 3300 }))); throw fail(503, 'Falha ao distribuir configuração; tentativa de reversão enviada. Verifique os nós e tente novamente.'); }
        config = proposal; storeConfig(config); return { ok: true, config };
    } finally { reconfiguring = false; }
}
function mutation(fn) { const next = serial.then(fn); serial = next.catch(() => { }); return next; }
async function handler(req, res) {
    const url = new URL(req.url, `http://localhost:${PORT}`), p = url.pathname;
    if (p.startsWith('/api/')) {
        validateOrigin(req);
        if (req.method === 'POST' && p === '/api/auth/register') return json(res, 201, await auth.register(req, res, await body(req)));
        if (req.method === 'POST' && p === '/api/auth/login') return json(res, 200, await auth.login(req, res, await body(req)));
        if (req.method === 'POST' && p === '/api/auth/logout') return json(res, 200, auth.logout(req, res));
        const user = auth.current(req);
        if (req.method === 'GET' && p === '/api/auth/me') return json(res, 200, { user });
        const clientAllowed = (req.method === 'GET' && p === '/api/auctions') || (req.method === 'POST' && /^\/api\/auctions\/[A-Za-z0-9-]+\/bids$/.test(p));
        if (user.role !== 'admin' && !clientAllowed) throw fail(403, 'Acesso exclusivo do administrador.');
        if (req.method === 'GET' && p === '/api/cluster') return json(res, 200, await inspect());
        if (req.method === 'GET' && p === '/api/events') { const s = await inspect(); const all = s.nodes.flatMap(n => n.events).sort((a, b) => b.time.localeCompare(a.time)).slice(0, 75); return json(res, 200, { events: all }); }
        if (req.method === 'GET' && p === '/api/auctions') { const s = await inspect(); const chosen = s.nodes.find(n => n.id === s.leaderId && n.reachable) || s.nodes.filter(n => n.reachable).sort((a, b) => b.seq - a.seq)[0]; if (!chosen) return json(res, 200, { auctions: [], stale: true }); const result = await call(chosen.id, '/auctions'); return json(res, 200, { ...result, stale: !s.majority || !s.leaderId }); }
        if (req.method === 'POST' && p === '/api/auctions') { const b = await body(req); return json(res, 201, await forward('/auctions', 'POST', { ...b, requestId: b.requestId || crypto.randomUUID() })); }
        const op = p.match(/^\/api\/auctions\/([A-Za-z0-9-]+)\/(bids|close)$/);
        if (req.method === 'POST' && op) {
            const b = await body(req);
            if (user.role === 'client') {
                // Identidade e destino são definidos pelo servidor, não pelo cliente.
                const requestId = 'client-' + user.id + '-' + crypto.createHash('sha256').update(op[1] + ':' + (typeof b.requestId === 'string' ? b.requestId : crypto.randomUUID())).digest('hex');
                return json(res, 200, await forward(`/auctions/${op[1]}/bids`, 'POST', { bidder: user.name, amount: b.amount, requestId }));
            }
            return json(res, 200, await forward(`/auctions/${op[1]}/${op[2]}`, 'POST', { ...b, requestId: b.requestId || crypto.randomUUID() }, b.receiverNode));
        }
        const node = p.match(/^\/api\/nodes\/(\d+)\/(failure|deactivate)$/);
        if (req.method === 'POST' && node) {
            const id = Number(node[1]); if (!NODES.has(id)) throw fail(404, 'Nó inexistente'); if (node[2] === 'failure') { const b = await body(req); if (typeof b.paused !== 'boolean') throw fail(400, 'Campo paused inválido'); if (!config.activeIds.includes(id)) throw fail(409, 'Nó inativo; ative-o antes de simular falha'); return json(res, 200, await call(id, '/_admin/failure', 'POST', { paused: b.paused }, { admin: true, timeout: 1800 })); }
            return json(res, 200, await mutation(async () => { if (!config.activeIds.includes(id)) throw fail(409, 'Nó já está desativado'); if (config.activeIds.length <= 2) throw fail(409, 'Mantenha ao menos 2 nós ativos; adicione outro antes de desativar este'); const members = config.activeIds.filter(n => n !== id); return changeConfig({ ...config, activeIds: members, writeQuorum: Math.max(strictMajority(members), Math.min(config.writeQuorum, members.length)) }); }));
        }
        if (req.method === 'PATCH' && /^\/api\/nodes\/\d+$/.test(p)) { const id = Number(p.split('/')[3]); if (!NODES.has(id)) throw fail(404, 'Nó inexistente'); const b = await body(req); const name = String(b.name || '').trim(); if (name.length < 2 || name.length > 40 || /[\x00-\x1f\x7f]/.test(name)) throw fail(400, 'Nome deve conter de 2 a 40 caracteres'); return json(res, 200, await mutation(() => changeConfig({ ...config, names: { ...config.names, [id]: name } }))); }
        if (req.method === 'POST' && p === '/api/nodes') { const b = await body(req); return json(res, 201, await mutation(async () => { const id = [...NODES.keys()].find(n => !config.activeIds.includes(n)); if (!id) throw fail(409, `Capacidade máxima de ${NODES.size} nós atingida; configure novos contêineres para expandir.`); const name = String(b.name || `Nó ${id}`).trim(); if (name.length < 2 || name.length > 40 || /[\x00-\x1f\x7f]/.test(name)) throw fail(400, 'Nome deve conter de 2 a 40 caracteres'); const members = [...config.activeIds, id].sort((a, b) => a - b); return changeConfig({ ...config, activeIds: members, writeQuorum: Math.max(strictMajority(members), config.writeQuorum), names: { ...config.names, [id]: name } }, id); })); }
        if (req.method === 'PATCH' && p === '/api/cluster/quorum') { const b = await body(req); return json(res, 200, await mutation(() => changeConfig({ ...config, writeQuorum: Number(b.quorum) }))); }
        if (req.method === 'POST' && p === '/api/demo') {
            const b = await body(req); const s = await inspect(); if (!s.majority || !s.leaderId) throw fail(503, 'Aguarde a eleição e o quórum de escrita'); const existing = (await call(s.leaderId, '/auctions')).auctions; let auction;
            if (b.auctionId) { auction = existing.find(a => a.id === b.auctionId); if (!auction) throw fail(404, 'Leilão selecionado não encontrado'); if (auction.status !== 'aberto') throw fail(409, 'O leilão selecionado está encerrado'); }
            else { auction = existing.find(a => a.status === 'aberto'); if (!auction) auction = (await forward('/auctions', 'POST', { item: 'Notebook Gamer', description: 'Leilão de demonstração para Sistemas Distribuídos', openingBid: 100, requestId: crypto.randomUUID() })).auction; }
            const names = ['Ana', 'Bruno', 'Carla'], results = []; for (let i = 0; i < 3; i++) { const fresh = await inspect(); const chosen = fresh.nodes.find(n => n.id === fresh.leaderId && n.reachable); if (!chosen) throw fail(503, 'Líder não disponível durante a simulação'); const latest = (await call(chosen.id, '/auctions')).auctions.find(a => a.id === auction.id); const amount = Math.round((latest.highestBid + (i + 1) * 25) * 100) / 100; const r = await forward(`/auctions/${auction.id}/bids`, 'POST', { bidder: names[i], amount, requestId: crypto.randomUUID() }); results.push({ bidder: names[i], amount, seq: r.seq }); } return json(res, 200, { ok: true, auctionId: auction.id, results });
        }
        throw fail(404, 'API não encontrada');
    }
    // O gateway serve o build estático do Vite e mantém a API na mesma origem.
    if (req.method !== 'GET' && req.method !== 'HEAD') throw fail(405, 'Método não permitido');
    const file = p === '/' || p === '/index.html' ? 'index.html' : /^\/assets\/[A-Za-z0-9_.-]+$/.test(p) ? p.slice(1) : null;
    if (!file) throw fail(404, 'Arquivo não encontrado');
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
    let contents;
    try { contents = await fs.promises.readFile(path.join(pub, file)); }
    catch (err) { if (err.code !== 'ENOENT') throw err; throw fail(file === 'index.html' ? 503 : 404, file === 'index.html' ? 'Frontend não compilado. Execute npm run frontend:build.' : 'Arquivo não encontrado'); }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : contents);
}
http.createServer((req, res) => handler(req, res).catch(err => { console.error('[dashboard]', err.message); if (!res.writableEnded) json(res, err.status || 500, { ok: false, error: err.message }); })).listen(PORT, '0.0.0.0', () => console.log(`Dashboard na porta ${PORT} · membros ${config.activeIds.join(',')} · quorum ${config.writeQuorum}`));
