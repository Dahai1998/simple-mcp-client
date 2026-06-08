import WebSocket from 'ws';
import fetch from 'node-fetch';

const NETEASE_API_BASE = 'https://netease-cloud-music-api-production.up.railway.app';
const MCP_ENDPOINT = 'wss://api.xiaozhi.me/mcp/?token=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjkxMTg5NiwiYWdlbnRJZCI6MTg1MjQ4MCwiZW5kcG9pbnRJZCI6ImFnZW50XzE4NTI0ODAiLCJwdXJwb3NlIjoibWNwLWVuZHBvaW50IiwiaWF0IjoxNzgwOTI4MzIzLCJleHAiOjE4MTI0ODU5MjN9.W87P41S1tMy8VPDyUB3FsnUBxMvhJq7UqtCBnBIFaDSqYwL7LbxuqyzxqwjTBHYMwBIDzCaCCv9y5n7EbAWVuA';

let ws;
let reconnectTimer;
let lastSearchKeyword = '';  // 记住上次搜索的关键词，用于连续播放

function connect() {
  ws = new WebSocket(MCP_ENDPOINT);

  ws.on('open', () => {
    console.log('已连接到小智 MCP 服务');

    // 每30秒发送一次心跳包，保持连接活跃
    setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        console.log('💓 发送心跳包');
      }
    }, 30000);
  });

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log('收到消息:', JSON.stringify(message).substring(0, 200) + '...');

      // 1. 处理初始化
      if (message.method === 'initialize') {
        sendResponse({
          id: message.id, jsonrpc: '2.0',
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            serverInfo: { name: 'netease-music-server', version: '2.0.0' }
          }
        });
      }

      // 2. 处理工具列表请求
      else if (message.method === 'tools/list') {
        sendResponse({
          id: message.id, jsonrpc: '2.0',
          result: {
            tools: [
              {
                name: 'my_search_music',
                description: '搜索网易云音乐真实歌曲，返回可播放的歌曲列表',
                inputSchema: {
                  type: 'object',
                  properties: {
                    keyword: { type: 'string', description: '搜索关键词，可以是歌名、歌手名或组合' }
                  },
                  required: ['keyword']
                }
              },
              {
                name: 'my_play_music',
                description: '获取推荐歌曲并播放。当一首歌结束后自动调用此工具，传入当前歌手名来获取推荐',
                inputSchema: {
                  type: 'object',
                  properties: {
                    keyword: { type: 'string', description: '用于推荐的关键词，通常是当前歌手的名字' }
                  },
                  required: ['keyword']
                }
              }
            ]
          }
        });
      }

      // 3. 处理工具调用
      else if (message.method === 'tools/call') {
        const { id, params } = message;
        const toolName = params.name;
        const args = params.arguments;
        console.log(`🔧 调用工具: ${toolName}`, args);

        if (toolName === 'my_search_music' || toolName === 'my_play_music') {
          try {
            const keyword = args.keyword || args.song_name || '';
            if (!keyword) {
              sendResponse({
                id, jsonrpc: '2.0',
                result: { content: [{ type: 'text', text: '错误：请提供歌曲名或歌手名' }] }
              });
              return;
            }

            // 如果是搜索，记住关键词
            if (toolName === 'my_search_music') {
              lastSearchKeyword = keyword;
            }

            // 调用网易云API
            const apiUrl = toolName === 'my_search_music'
              ? `${NETEASE_API_BASE}/search?keywords=${encodeURIComponent(keyword)}`
              : `${NETEASE_API_BASE}/search?keywords=${encodeURIComponent(keyword)}&limit=10`;
            
            console.log(`🎵 ${toolName === 'my_search_music' ? '搜索' : '推荐'}: ${keyword}`);
            const response = await fetch(apiUrl);
            const data = await response.json();

            let resultText = '';
            if (data.result && data.result.songs && data.result.songs.length > 0) {
              const songs = data.result.songs.slice(0, 5).map((song, index) => {
                const name = song.name;
                const artists = song.artists.map(a => a.name).join('/');
                return `${index + 1}. ${name} - ${artists}`;
              }).join('\n');

              if (toolName === 'my_search_music') {
                resultText = `🔍 搜索 "${keyword}" 的结果：\n${songs}\n\n请告诉我想听第几首，或者说“随便放一首”`;
              } else {
                resultText = `🎶 为你推荐 ${keyword} 的歌曲：\n${songs}\n\n正在播放第一首，结束后将自动播放下一首`;
              }
            } else {
              resultText = `没有找到与 "${keyword}" 相关的歌曲`;
            }

            sendResponse({
              id, jsonrpc: '2.0',
              result: { content: [{ type: 'text', text: resultText }] }
            });
            console.log('✅ 工具调用完成');
          } catch (err) {
            console.error('❌ 请求失败:', err.message);
            sendResponse({
              id, jsonrpc: '2.0',
              result: { content: [{ type: 'text', text: '音乐服务暂时不可用，请稍后再试' }] }
            });
          }
        } else {
          sendResponse({
            id, jsonrpc: '2.0',
            error: { code: -32601, message: `Unknown tool: ${toolName}` }
          });
        }
      }

    } catch (err) {
      console.error('处理消息出错:', err.message);
    }
  });

  ws.on('close', () => {
    console.log('连接已断开，5秒后重连...');
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

console.log('🎵 网易云音乐 MCP 服务 v2.0 启动...');
connect();
