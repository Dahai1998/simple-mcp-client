// mcp-client.js (v7.3 - 适配 meting API 直接返回 MP3 的情况)
import WebSocket from 'ws';
import fetch from 'node-fetch';

const NETEASE_API_BASE = 'https://netease-cloud-music-api-production.up.railway.app';
const MCP_ENDPOINT = 'wss://api.xiaozhi.me/mcp/?token=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjkxMTg5NiwiYWdlbnRJZCI6MTg1MjQ4MCwiZW5kcG9pbnRJZCI6ImFnZW50XzE4NTI0ODAiLCJwdXJwb3NlIjoibWNwLWVuZHBvaW50IiwiaWF0IjoxNzgxMTAxMzE5LCJleHAiOjE4MTI2NTg5MTl9.qcWcYVUA5-Oeg48WfresqJqQ9eF4wAK4bvQMrN_HSHe1JCc1-6l11g4_nqJCzFniJk-CYz5IdT9akiKI_hxWGA';

let ws, reconnectTimer, reconnectAttempts = 0, pingInterval;
const maxReconnectDelay = 30000;

async function searchMusic(keyword, limit = 5) {
  const res = await fetch(`${NETEASE_API_BASE}/search?keywords=${encodeURIComponent(keyword)}&limit=${limit}&type=1`);
  const data = await res.json();
  if (!data.result || !data.result.songs) return [];
  return data.result.songs.map(s => ({
    id: s.id, name: s.name,
    artists: (s.artists || []).map(a => a.name).join('/'),
    album: s.album?.name || ''
  }));
}

// ★ 修改点：适配 meting API 直接返回 MP3 的情况
async function getSongUrl(songId) {
  const apiUrl = `https://api.injahow.cn/meting/?type=url&id=${songId}`;
  console.log(`请求播放链接: ${apiUrl}`);
  try {
    const res = await fetch(apiUrl);
    const data = await res.json();
    if (data && data.url) {
      return { url: data.url, type: 'mp3' };
    }
  } catch (e) {
    // JSON 解析失败，说明 API 直接返回了 MP3 数据，此时把 API 地址本身作为播放链接
    console.log('API 返回非 JSON，将直接使用查询地址作为播放链接');
  }
  // 返回 API 查询地址，让设备直接下载
  return { url: apiUrl, type: 'mp3' };
}

const toolsDef = [
  {
    name: 'my_search_music',
    description: '搜索网易云音乐真实歌曲，返回结构化的歌曲列表（包含id、名称、歌手）',
    inputSchema: {
      type: 'object',
      properties: { keyword: { type: 'string', description: '搜索关键词' } },
      required: ['keyword']
    }
  },
  {
    name: 'my_play_music',
    description: '根据歌曲ID获取可播放的音乐链接，并返回播放指令',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '歌曲ID' },
        songId: { type: 'string', description: '歌曲ID (兼容)' }
      },
      required: []
    }
  },
  {
    name: 'play_music',
    description: '根据歌曲ID获取可播放的音乐链接（备用）',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '歌曲ID' },
        songId: { type: 'string', description: '歌曲ID (兼容)' }
      },
      required: []
    }
  }
];

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
      console.log(`📩 ${method || 'response'}`, JSON.stringify(msg).slice(0, 200));

      if (method === 'initialize') {
        send({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'netease-music-server', version: '7.3.0' } } });
      }
      else if (method === 'tools/list') {
        send({ jsonrpc: '2.0', id, result: { tools: toolsDef } });
      }
      else if (method === 'tools/call') {
        const { name: toolName, arguments: args } = msg.params;
        console.log(`🔧 ${toolName}`, JSON.stringify(args));

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
            const result = { text: `搜索"${keyword}"的结果：\n${songListText}\n\n可以说“播放第X首”来选择。`, songs };
            send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } });
            console.log(`✅ 搜索完成，返回 ${songs.length} 首`);
          }
          else if (toolName === 'my_play_music' || toolName === 'play_music') {
            const songId = args.id || args.songId;
            if (!songId) throw new Error('缺少歌曲ID参数 (需要 id 或 songId)');
            console.log(`🔗 获取播放链接: songId=${songId}`);
            const urlInfo = await getSongUrl(songId);
            if (!urlInfo || !urlInfo.url) throw new Error('无法获取播放链接');
            const playCmd = {
              message: "请立即使用 self.music.play_song 工具播放此链接，该工具在设备本地执行",
              song_name: urlInfo.url,
              artist_name: ""
            };
            send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(playCmd) }] } });
            console.log(`✅ 播放指令已发送: ${urlInfo.url.slice(0, 60)}...`);
          }
          else { throw new Error(`未知工具: ${toolName}`); }
        } catch (err) {
          console.error(`❌ ${toolName}`, err.message);
          send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: err.message }], isError: true } });
        }
      }
      else if (method === 'ping') { send({ jsonrpc: '2.0', id, result: 'pong' }); }
      else if (method?.startsWith('notifications/')) { console.log(`📬 ${method}`); }
    } catch (err) { console.error('消息处理异常:', err); }
  });

  ws.on('close', (code) => { console.log(`🔌 断开 (code: ${code})`); clearInterval(pingInterval); scheduleReconnect(); });
  ws.on('error', (err) => { console.error('WS错误:', err.message); clearInterval(pingInterval); });
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), maxReconnectDelay);
  reconnectAttempts++;
  console.log(`⏳ ${Math.round(delay / 1000)}秒后重连...`);
  reconnectTimer = setTimeout(connect, delay);
}

function send(data) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }

console.log('🎵 网易云音乐 MCP v7.3 (适配 meting API) 启动');
connect();
process.on('SIGTERM', () => { clearInterval(pingInterval); if (ws) ws.close(); process.exit(0); });
