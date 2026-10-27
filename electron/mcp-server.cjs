const http = require('node:http');
const { Readable } = require('node:stream');
const { McpServer, createMcpHandler } = require('@modelcontextprotocol/server');
const { z } = require('zod');

const MCP_PORT = 43177;
const seats = ['northWest', 'northEast', 'southEast', 'southWest'];
const zones = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command', 'stack'];
const point = z.number().finite().min(0).max(2000);
const action = z.discriminatedUnion('type', [
  z.object({ type: z.literal('DRAW'), amount: z.number().int().min(1).max(10).optional() }),
  z.object({ type: z.literal('MULLIGAN') }), z.object({ type: z.literal('KEEP_HAND'), bottomCardIds: z.array(z.string()).max(7).optional() }),
  z.object({ type: z.literal('PLAY_LAND'), cardId: z.string(), x: point.optional(), y: point.optional() }),
  z.object({ type: z.literal('REPOSITION_CARD'), cardId: z.string(), x: point, y: point }),
  z.object({ type: z.literal('MOVE_CARD'), cardId: z.string(), zone: z.enum(zones), x: point.optional(), y: point.optional() }),
  z.object({ type: z.literal('TAP'), cardId: z.string() }), z.object({ type: z.literal('SET_LIFE'), amount: z.number().int().min(-1000).max(1000), seatId: z.string().optional() }),
  z.object({ type: z.literal('CHANGE_COUNTER'), counter: z.string().min(1).max(24), amount: z.number().int().min(-1000).max(1000), seatId: z.string().optional(), cardId: z.string().optional() }),
  z.object({ type: z.literal('ADJUST_COMMANDER_DAMAGE'), commanderCardId: z.string(), amount: z.union([z.literal(-1), z.literal(1)]) }),
  z.object({ type: z.literal('COMMANDER_DAMAGE'), commanderCardId: z.string(), defenderId: z.string(), amount: z.number().int().min(1).max(1000) }),
  z.object({ type: z.literal('FLIP_FACE'), cardId: z.string() }), z.object({ type: z.literal('SET_FACE_DOWN'), cardId: z.string(), faceDown: z.boolean() }),
  z.object({ type: z.literal('CAST'), cardId: z.string(), x: point.optional(), y: point.optional(), target: z.string().max(128).optional() }),
  z.object({ type: z.literal('CAST_ABILITY'), sourceId: z.string(), name: z.string().max(120), target: z.string().max(128).optional() }),
  z.object({ type: z.literal('PASS_PRIORITY') }), z.object({ type: z.literal('RESOLVE_TOP') }),
  z.object({ type: z.literal('PHASE'), step: z.string().max(64) }), z.object({ type: z.literal('ADVANCE_TURN') }), z.object({ type: z.literal('SHUFFLE') }),
  z.object({ type: z.literal('REVEAL'), cardIds: z.array(z.string()).min(1).max(20) }),
  z.object({ type: z.literal('SEARCH_LIBRARY'), cardIds: z.array(z.string()).min(1).max(20), destination: z.enum(['hand', 'battlefield', 'graveyard', 'exile']).optional() }),
  z.object({ type: z.literal('CREATE_TOKEN'), name: z.string().max(80), x: point.optional(), y: point.optional() }),
  z.object({ type: z.literal('TRANSFER_CONTROL'), cardId: z.string(), seatId: z.enum(seats) }), z.object({ type: z.literal('CONCEDE') }),
]);

let server;
let dispatchTool;

function invokeTool(name, schema, description) {
  return async args => {
    try {
      const result = await dispatchTool(name, args);
      const text = JSON.stringify(result);
      return { content: [{ type: 'text', text }], structuredContent: result && typeof result === 'object' ? result : { result } };
    } catch (error) {
      return { content: [{ type: 'text', text: error instanceof Error ? error.message : 'Falha ao executar a ferramenta.' }], isError: true };
    }
  };
}

function createMcpServer() {
  const mcp = new McpServer({ name: 'meu-magic', version: '0.1.0' });
  const tool = (name, description, inputSchema) => mcp.registerTool(name, { description, inputSchema }, invokeTool(name));
  tool('join_room', 'Entra como jogador de IA em uma vaga livre do lobby. Guarde o agentToken recebido e reutilize o mesmo requestId se a resposta da entrada precisar ser repetida.', z.object({ code: z.string().min(6).max(16), name: z.string().min(2).max(28), password: z.string().max(64).optional(), requestId: z.string().min(8).max(128) }));
  tool('list_decks', 'Lista decks Commander válidos salvos no computador do anfitrião.', z.object({ agentToken: z.string() }));
  tool('select_deck', 'Seleciona um deck salvo para este lugar.', z.object({ agentToken: z.string(), deckId: z.string(), requestId: z.string().min(8).max(128) }));
  tool('set_ready', 'Confirma ou retira a prontidão deste lugar.', z.object({ agentToken: z.string(), ready: z.boolean(), requestId: z.string().min(8).max(128) }));
  tool('get_state', 'Lê a sala e a partida, incluindo apenas a mão e a biblioteca desta IA.', z.object({ agentToken: z.string() }));
  tool('send_chat', 'Envia uma mensagem curta para o chat da mesa. Use quando quiser comentar uma jogada ou interagir com os outros jogadores.', z.object({ agentToken: z.string(), message: z.string().min(1).max(100) }));
  tool('table_status', 'Retorna os acontecimentos públicos do histórico desde a chamada anterior desta ferramenta. Na primeira chamada, retorna todo o histórico retido.', z.object({ agentToken: z.string() }));
  tool('wait_for_update', 'Aguarda até 30 segundos por uma nova revisão da partida ou mudança na conexão; devolve o estado visível a esta IA.', z.object({ agentToken: z.string(), afterRevision: z.number().int().nonnegative().nullable(), afterConnectionState: z.enum(['connecting', 'synchronizing', 'connected', 'reconnecting', 'transferring', 'disconnected']), timeoutMs: z.number().int().min(1).max(30000) }));
  tool('get_card', 'Consulta uma carta visível para esta IA pelo identificador da instância.', z.object({ agentToken: z.string(), cardId: z.string() }));
  tool('set_playmat', 'Escolhe ou remove o playmat deste lugar.', z.object({ agentToken: z.string(), playmatId: z.string().nullable(), requestId: z.string().min(8).max(128) }));
  tool('perform_action', 'Executa qualquer ação de jogo permitida para este lugar.', z.object({ agentToken: z.string(), requestId: z.string().min(8).max(128), action }));
  tool('undo', 'Desfaz a ação mais recente desta IA quando ainda for permitido.', z.object({ agentToken: z.string(), requestId: z.string().min(8).max(128), expectedRevision: z.number().int().nonnegative() }));
  tool('redo', 'Refaz a ação desfeita desta IA quando ainda for permitido.', z.object({ agentToken: z.string(), requestId: z.string().min(8).max(128), expectedRevision: z.number().int().nonnegative() }));
  tool('leave_room', 'Libera o lugar desta IA e encerra sua sessão.', z.object({ agentToken: z.string() }));
  return mcp;
}

function isLoopbackOrigin(value) {
  if (!value) return true;
  if (value === 'app://meu-magic') return true;
  try {
    const parsed = new URL(value);
    return ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  } catch { return false; }
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024) throw Object.assign(new Error('MCP request too large.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function start({ window, dispatch }) {
  if (server) return `http://127.0.0.1:${MCP_PORT}/mcp`;
  dispatchTool = dispatch;
  const handler = createMcpHandler(() => createMcpServer(), { legacy: 'stateless', responseMode: 'json' });
  const nextServer = http.createServer(async (req, res) => {
    const allowedHost = new Set([`127.0.0.1:${MCP_PORT}`, `localhost:${MCP_PORT}`]);
    if (!allowedHost.has(String(req.headers.host ?? '').toLowerCase()) || !isLoopbackOrigin(req.headers.origin)) {
      res.writeHead(403).end('Forbidden'); return;
    }
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    try {
      const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
      const request = new Request(`http://127.0.0.1:${MCP_PORT}${req.url}`, { method: req.method, headers: req.headers, ...(body ? { body } : {}) });
      const response = await handler.fetch(request);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      if (!response.body || req.method === 'HEAD') res.end();
      else Readable.fromWeb(response.body).pipe(res);
    } catch (error) {
      if (!res.headersSent) res.writeHead(Number(error?.statusCode) || 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(error instanceof Error ? error.message : 'MCP request failed.');
    }
  });
  try {
    await new Promise((resolve, reject) => { nextServer.once('error', reject); nextServer.listen(MCP_PORT, '127.0.0.1', resolve); });
  } catch (error) {
    nextServer.closeAllConnections();
    dispatchTool = undefined;
    if (error?.code === 'EADDRINUSE') throw new Error(`A porta MCP local ${MCP_PORT} já está em uso. Feche o outro processo ou libere a porta e tente novamente.`);
    throw error;
  }
  server = nextServer;
  return `http://127.0.0.1:${MCP_PORT}/mcp`;
}

async function stop() {
  if (!server) return;
  const current = server;
  server = undefined;
  dispatchTool = undefined;
  current.closeAllConnections();
  await new Promise(resolve => current.close(() => resolve()));
}

module.exports = { start, stop };
