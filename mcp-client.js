import WebSocket from 'ws';
import fetch from 'node-fetch';

const NETEASE_API_BASE = 'https://netease-cloud-music-api-production.up.railway.app';
const MCP_ENDPOINT = 'wss://api.xiaozhi.me/mcp/?token=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjkxMTg5NiwiYWdlbnRJZCI6MTg1MjQ4MCwiZW5kcG9pbnRJZCI6ImFnZW50XzE4NTI0ODAiLCJwdXJwb3NlIjoibWNwLWVuZHBvaW50IiwiaWF0IjoxNzgxMDAyMzUyLCJleHAiOjE4MTI1NTk5NTJ9.9NjQoPJW1UZZ7dWXxdzFC45mfI0lLyD1uJHekDxh6g5ncHK-TtnKsg7i4-yZm3-Yn-OvZ17gumm8FSYlYUhddA';

let ws;
let reconnectTimer;
let heartbeatInterval;

function connect() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }

  ws = new WebSocket(MCP_ENDPOINT);

  ws.on('open', () => {
    console.log('已连接到小智 MCP 服务');
    heartbeatInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.ping();
        console.log('💓 发送心跳包');
      }
    }, 30000);
  });

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log('收到消息:', JSON.stringify(message).substring(0, 200) + '...');

      if (message.method === 'initialize') {
        sendResponse({
          id: message.id,
          jsonrpc: '2.0',
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            serverInfo: { name: 'netease-music-server', version: '1.0.0' }
          }
        });
      } else if (message.method === 'tools/list') {
        sendResponse({
          id: message.id,
          jsonrpc: '2.0',
          result: {
            tools: [{
              name: 'my_search_music',
              description: '搜索网易云音乐真实歌曲',
              inputSchema: {
                type: 'object',
                properties: {
                  keyword: { type: 'string', description: '搜索关键词' }
                },
                required: ['keyword']
              }
            }]
          }
        });
      } else if (message.method === 'tools/call') {
        const { id, params } = message;
        const toolName = params.name;
        const args = params.arguments;
        console.log(`🔧 调用工具: ${toolName}`, args);

        if (toolName === 'my_search_music') {
          try {
            const keyword = args.keyword || args.song_name || '';
            if (!keyword) {
              sendResponse({ id, jsonrpc: '2.0', result: { content: [{ type: 'text', text: '错误：请提供歌曲名或歌手名' }] } });
              return;
            }
            console.log(`🎵 搜索: ${keyword}`);
            const apiUrl = `${NETEASE_API_BASE}/search?keywords=${encodeURIComponent(keyword)}`;
            const response = await fetch(apiUrl);
            const data = await response.json();
            let resultText = '';
            if (data.result && data.result.songs && data.result.songs.length > 0) {
              const songs = data.result.songs.slice(0, 5).map((song, index) => {
                return `${index + 1}. ${song.name} - ${song.artists.map(a => a.name).join('/')}`;
              }).join('\n');
              resultText = `🔍 搜索 "${keyword}" 的结果：\n${songs}\n\n请告诉我想听第几首`;
            } else {
              resultText = `没有找到与 "${keyword}" 相关的歌曲`;
            }
            sendResponse({ id, jsonrpc: '2.0', result: { content: [{ type: 'text', text: resultText }] } });
            console.log('✅ 工具调用完成');
          } catch (err) {
            console.error('❌ 请求失败:', err.message);
            sendResponse({ id, jsonrpc: '2.0', result: { content: [{ type: 'text', text: '音乐服务暂时不可用' }] } });
          }
        } else {
          sendResponse({ id, jsonrpc: '2.0', error: { code: -32601, message: `Unknown tool: ${toolName}` } });
        }
      }
    } catch (err) {
      console.error('处理消息出错:', err.message);
    }
  });

  ws.on('close', () => {
    console.log('连接已断开，5秒后重连...');
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 5000);
  });

  ws.on('error', (err) => {
    console.error('WebSocket 错误:', err.message);
  });
}

function sendResponse(response) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(response));
  }
}

console.log('🎵 网易云音乐 MCP 服务启动...');
connect();
