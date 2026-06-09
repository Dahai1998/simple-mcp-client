import WebSocket from 'ws';
import fetch from 'node-fetch';

// ================== 配置区 ==================
const NETEASE_API_BASE = 'https://netease-cloud-music-api-production.up.railway.app';
const MCP_ENDPOINT = 'wss://api.xiaozhi.me/mcp/?token=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjkxMTg5NiwiYWdlbnRJZCI6MTg1MjQ4MCwiZW5kcG9pbnRJZCI6ImFnZW50XzE4NTI0ODAiLCJwdXJwb3NlIjoibWNwLWVuZHBvaW50IiwiaWF0IjoxNzgxMDAyMzUyLCJleHAiOjE4MTI1NTk5NTJ9.9NjQoPJW1UZZ7dWXxdzFC45mfI0lLyD1uJHekDxh6g5ncHK-TtnKsg7i4-yZm3-Yn-OvZ17gumm8FSYlYUhddA';

let ws;
let reconnectTimer;
let heartbeatInterval;

function connect() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);

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

      // 1. 处理初始化
      if (message.method === 'initialize') {
        sendResponse({
          id: message.id,
          jsonrpc: '2.0',
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            serverInfo: { name: 'netease-music-server', version: '3.0.0' }
          }
        });
      }

      // 2. 处理工具列表请求
      else if (message.method === 'tools/list') {
        sendResponse({
          id: message.id,
          jsonrpc: '2.0',
          result: {
            tools: [
              {
                name: 'my_search_music',
                description: '搜索网易云音乐真实歌曲，返回歌曲列表和ID',
                inputSchema: {
                  type: 'object',
                  properties: {
                    keyword: { type: 'string', description: '搜索关键词，可以是歌名或歌手名' }
                  },
                  required: ['keyword']
                }
              },
              {
                name: 'get_song_url',
                description: '根据歌曲ID获取在线播放链接',
                inputSchema: {
                  type: 'object',
                  properties: {
                    song_id: { type: 'string', description: '歌曲ID' }
                  },
                  required: ['song_id']
                }
              },
              {
                name: 'play_music_from_url',
                description: '直接播放指定的音频链接，用于在线音乐播放。返回的链接可直接用于播放',
                inputSchema: {
                  type: 'object',
                  properties: {
                    url: { type: 'string', description: '音频文件的在线播放链接' }
                  },
                  required: ['url']
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

        // --- my_search_music 搜索工具 ---
        if (toolName === 'my_search_music') {
          try {
            const keyword = args.keyword || '';
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
                return `${index + 1}. ${song.name} - ${song.artists.map(a => a.name).join('/')} [ID:${song.id}]`;
              }).join('\n');
              resultText = `🔍 搜索 "${keyword}" 的结果：\n${songs}\n\n请告诉我想听第几首，或者说“播放第X首”`;
            } else {
              resultText = `没有找到与 "${keyword}" 相关的歌曲`;
            }
            sendResponse({ id, jsonrpc: '2.0', result: { content: [{ type: 'text', text: resultText }] } });
            console.log('✅ 搜索完成');
          } catch (err) {
            sendResponse({ id, jsonrpc: '2.0', result: { content: [{ type: 'text', text: '搜索音乐时出错，请稍后再试' }] } });
          }
        }

        // --- get_song_url 获取链接工具 ---
        else if (toolName === 'get_song_url') {
          const songId = args.song_id;
          if (!songId) {
            sendResponse({ id, jsonrpc: '2.0', result: { content: [{ type: 'text', text: '错误：缺少歌曲ID' }] } });
            return;
          }
          try {
            console.log(`🔗 获取链接: ${songId}`);
            const detailUrl = `${NETEASE_API_BASE}/song/detail?ids=${songId}`;
            const detailResponse = await fetch(detailUrl);
            const detailData = await detailResponse.json();
            if (detailData.code === 200 && detailData.songs && detailData.songs.length > 0) {
              const song = detailData.songs[0];
              const playUrl = `https://music.163.com/song/media/outer/url?id=${songId}.mp3`;
              const resultText = `已获取歌曲播放链接。请立即调用 play_music_from_url 工具，传入以下链接进行播放：${playUrl}`;
              sendResponse({ id, jsonrpc: '2.0', result: { content: [{ type: 'text', text: resultText }] } });
              console.log('✅ 获取链接完成');
            } else {
              sendResponse({ id, jsonrpc: '2.0', result: { content: [{ type: 'text', text: '获取歌曲信息失败' }] } });
            }
          } catch (err) {
            sendResponse({ id, jsonrpc: '2.0', result: { content: [{ type: 'text', text: '获取链接时网络出错' }] } });
          }
        }

        // --- play_music_from_url 播放工具 ---
        else if (toolName === 'play_music_from_url') {
          const url = args.url;
          if (!url) {
            sendResponse({ id, jsonrpc: '2.0', result: { content: [{ type: 'text', text: '错误：缺少播放链接' }] } });
            return;
          }
          try {
            console.log(`▶️ 播放链接: ${url}`);
            // ⚠️ 这里不再返回 data 字段，只返回纯文本，避免连接断开
            sendResponse({
              id, jsonrpc: '2.0',
              result: {
                content: [{ type: 'text', text: `播放指令已接收，正在尝试播放：${url}` }]
              }
            });
            console.log('✅ 播放响应已发送');
          } catch (err) {
            sendResponse({ id, jsonrpc: '2.0', result: { content: [{ type: 'text', text: '播放时出错' }] } });
          }
        }

        // --- 未知工具 ---
        else {
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

console.log('🎵 网易云音乐 MCP 服务 v3.1 启动...');
connect();
