// mcp-client.js (播放功能修复版)
import WebSocket from 'ws';
import fetch from 'node-fetch';

// ================== 你的配置（已填入） ==================
const NETEASE_API_BASE = 'https://netease-cloud-music-api-production.up.railway.app';
const MCP_ENDPOINT = 'wss://api.xiaozhi.me/mcp/?token=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjkxMTg5NiwiYWdlbnRJZCI6MTg1MjQ4MCwiZW5kcG9pbnRJZCI6ImFnZW50XzE4NTI0ODAiLCJwdXJwb3NlIjoibWNwLWVuZHBvaW50IiwiaWF0IjoxNzgxMTAxMzE5LCJleHAiOjE4MTI2NTg5MTl9.qcWcYVUA5-Oeg48WfresqJqQ9eF4wAK4bvQMrN_HSHe1JCc1-6l11g4_nqJCzFniJk-CYz5IdT9akiKI_hxWGA';

// ================== 全局状态 ==================
let ws;
let reconnectTimer;
let reconnectAttempts = 0;
const maxReconnectDelay = 30000; // 最大重连间隔 30 秒
let pingInterval;

// ================== 网易云 API 封装 ==================
async function searchMusic(keyword, limit = 5) {
  const res = await fetch(`${NETEASE_API_BASE}/search?keywords=${encodeURIComponent(keyword)}&limit=${limit}&type=1`);
  const data = await res.json();
  if (!data.result || !data.result.songs) return [];
  return data.result.songs.map(s => ({
    id: s.id,
    name: s.name,
    artists: (s.artists || []).map(a => a.name).join('/'),
    album: s.album?.name || ''
  }));
}

async function getSongUrl(songId) {
  const res = await fetch(`${NETEASE_API_BASE}/song/url?id=${songId}`);
  const data = await res.json();
  const song = data.data?.[0];
  if (!song || !song.url) throw new Error('无法获取播放链接，该歌曲可能需要付费或已下架');
  return {
    url: song.url,
    type: song.type || 'mp3',
    expire: song.expire || 0
  };
}

// ================== MCP 工具定义 ==================
const toolsDef = [
  {
    name: 'my_search_music',
    description: '搜索网易云音乐真实歌曲，返回结构化的歌曲列表（包含id、名称、歌手）',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键词，可以是歌名或歌手名' }
      },
      required: ['keyword']
    }
  },
  {
    name: 'play_music',
    description: '根据歌曲ID获取可播放的音乐链接',
    inputSchema: {
      type: 'object',
      properties: {
        songId: { type: 'string', description: '歌曲ID，由搜索接口返回' }
      },
      required: ['songId']
    }
  }
];

// ================== 连接管理 ==================
function connect() {
  ws = new WebSocket(MCP_ENDPOINT);

  ws.on('open', () => {
    console.log('✅ 已连接到小智 MCP Broker');
    reconnectAttempts = 0;

    clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: Date.now() }));
      }
    }, 25000);
  });

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      const { id, method } = msg;
      console.log(`📩 收到: ${method || 'response'}`, JSON.stringify(msg).slice(0, 200));

      if (method === 'initialize') {
        send({
          jsonrpc: '2.0', id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'netease-music-server', version: '2.2.0' }
          }
        });
      }
      else if (method === 'tools/list') {
        send({ jsonrpc: '2.0', id, result: { tools: toolsDef } });
      }
      else if (method === 'tools/call') {
        const { name: toolName, arguments: args } = msg.params;
        console.log(`🔧 调用工具: ${toolName}`, JSON.stringify(args));

        try {
          if (toolName === 'my_search_music') {
            const keyword = args.keyword;
            if (!keyword) throw new Error('缺少搜索关键词');
            const songs = await searchMusic(keyword);
            if (songs.length === 0) {
              send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `没有找到与"${keyword}"相关的歌曲` }] } });
              return;
            }
            const songListText = songs.map((s, i) => `${i+1}. ${s.name} - ${s.artists} (id:${s.id})`).join('\n');
            const result = {
              text: `搜索"${keyword}"的结果：\n${songListText}\n\n可以说“播放第X首”来选择。`,
              songs: songs
            };
            send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } });
            console.log(`✅ 搜索完成，返回 ${songs.length} 首`);
          }
          else if (toolName === 'play_music') {
            // 使用 songId，与工具定义一致
            const songId = args.songId;
            if (!songId) {
              console.error('❌ 缺少 songId，收到的参数:', args);
              throw new Error('缺少 songId 参数');
            }
            console.log(`🔗 获取播放链接: songId=${songId}`);
            const songInfo = await getSongUrl(songId);
            send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(songInfo) }] } });
            console.log(`✅ 播放链接已发送: ${songInfo.url.slice(0, 60)}...`);
          }
          else {
            throw new Error(`未知工具: ${toolName}`);
          }
        } catch (err) {
          console.error(`❌ 工具执行失败: ${toolName}`, err.message);
          send({
            jsonrpc: '2.0', id,
            result: { content: [{ type: 'text', text: err.message }], isError: true }
          });
        }
      }
      else if (method === 'ping') {
        send({ jsonrpc: '2.0', id, result: 'pong' });
      }
      else if (method?.startsWith('notifications/')) {
        console.log(`📬 收到通知: ${method}`);
      }

    } catch (err) {
      console.error('消息处理异常:', err);
    }
  });

  ws.on('close', (code) => {
    console.log(`🔌 连接已断开 (code: ${code})`);
    clearInterval(pingInterval);
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error('WebSocket 错误:', err.message);
    clearInterval(pingInterval);
  });
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), maxReconnectDelay);
  reconnectAttempts++;
  console.log(`⏳ 将在 ${Math.round(delay / 1000)} 秒后重连...`);
  reconnectTimer = setTimeout(connect, delay);
}

function send(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ================== 启动 ==================
console.log('🎵 网易云音乐 MCP 客户端 v2.2 启动');
console.log('  → 网易云 API:', NETEASE_API_BASE);
console.log('  → MCP Broker:', MCP_ENDPOINT.split('?')[0]);
connect();

process.on('SIGTERM', () => {
  clearInterval(pingInterval);
  if (ws) ws.close();
  process.exit(0);
});
