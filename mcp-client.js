import WebSocket from 'ws';
import fetch from 'node-fetch';

const NETEASE_API_BASE = 'https://netease-cloud-music-api-production.up.railway.app';
const MCP_ENDPOINT = 'wss://api.xiaozhi.me/mcp/?token=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjkxMTg5NiwiYWdlbnRJZCI6MTc2MDM0MywiZW5kcG9pbnRJZCI6ImFnZW50XzE3NjAzNDMiLCJwdXJwb3NlIjoibWNwLWVuZHBvaW50IiwiaWF0IjoxNzgwOTM2MTYzLCJleHAiOjE4MTI0OTM3NjN9.eRWQQPDcsv-kYlRdKJJcyPvydgos7QaQbUwey44AdoCXXlFjq3cz0K0hDQKjgBsrpTcya9hQetu_8DdXUbpZnQ';

let ws;
let reconnectTimer;

function connect() {
  ws = new WebSocket(MCP_ENDPOINT);

  ws.on('open', () => {
    console.log('已连接到小智 MCP 服务');
    setInterval(() => {
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

      // 初始化
      if (message.method === 'initialize') {
        sendResponse({
          id: message.id, jsonrpc: '2.0',
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            serverInfo: { name: 'netease-music-server', version: '3.0.0' }
          }
        });
      }
      // 工具列表
      else if (message.method === 'tools/list') {
        sendResponse({
          id: message.id, jsonrpc: '2.0',
          result: {
            tools: [
              {
                name: 'my_search_music',
                description: '搜索网易云音乐真实歌曲，返回歌曲列表，包含歌曲ID',
                inputSchema: {
                  type: 'object',
                  properties: {
                    keyword: { type: 'string', description: '搜索关键词，可以是歌名或歌手名' }
                  },
                  required: ['keyword']
                }
              },
              {
                name: 'my_play_music',
                description: '获取推荐歌曲列表，用于连续播放',
                inputSchema: {
                  type: 'object',
                  properties: {
                    keyword: { type: 'string', description: '用于推荐的关键词，通常是歌手的名字' }
                  },
                  required: ['keyword']
                }
              },
              {
                name: 'get_song_url',
                description: '根据歌曲ID获取在线播放链接，用于实际播放音乐',
                inputSchema: {
                  type: 'object',
                  properties: {
                    song_id: { type: 'string', description: '歌曲ID，从搜索结果中获取' }
                  },
                  required: ['song_id']
                }
              }
            ]
          }
        });
      }
      // 工具调用
      else if (message.method === 'tools/call') {
        const { id, params } = message;
        const toolName = params.name;
        const args = params.arguments;
        console.log(`🔧 调用工具: ${toolName}`, args);

        if (toolName === 'my_search_music') {
          const keyword = args.keyword || '';
          if (!keyword) {
            sendResponse({ id, jsonrpc: '2.0', result: { content: [{ type: 'text', text: '错误：请提供歌曲名或歌手名' }] } });
            return;
          }
          try {
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
          } catch (err) {
            sendResponse({ id, jsonrpc: '2.0', result: { content: [{ type: 'text', text: '搜索音乐时出错，请稍后再试' }] } });
          }
        }
        else if (toolName === 'my_play_music') {
          const keyword = args.keyword || '';
          try {
            const apiUrl = `${NETEASE_API_BASE}/search?keywords=${encodeURIComponent(keyword)}&limit=10`;
            const response = await fetch(apiUrl);
            const data = await response.json();
            let resultText = '';
            if (data.result && data.result.songs && data.result.songs.length > 0) {
              const songs = data.result.songs.slice(0, 5).map((song, index) => {
                return `${index + 1}. ${song.name} - ${song.artists.map(a => a.name).join('/')} [ID:${song.id}]`;
              }).join('\n');
              resultText = `🎶 为你推荐 ${keyword} 的歌曲：\n${songs}\n\n正在播放第一首，结束后将自动播放下一首`;
            } else {
              resultText = `没有找到与 "${keyword}" 相关的歌曲`;
            }
            sendResponse({ id, jsonrpc: '2.0', result: { content: [{ type: 'text', text: resultText }] } });
          } catch (err) {
            sendResponse({ id, jsonrpc: '2.0', result: { content: [{ type: 'text', text: '推荐音乐时出错，请稍后再试' }] } });
          }
        }
        else if (toolName === 'get_song_url') {
          const songId = args.song_id;
          if (!songId) {
            sendResponse({ id, jsonrpc: '2.0', result: { content: [{ type: 'text', text: '错误：缺少歌曲ID，无法获取播放链接' }] } });
            return;
          }
          try {
            const detailUrl = `${NETEASE_API_BASE}/song/detail?ids=${songId}`;
            const detailResponse = await fetch(detailUrl);
            const detailData = await detailResponse.json();
            if (detailData.code === 200 && detailData.songs && detailData.songs.length > 0) {
              const song = detailData.songs[0];
              const playUrl = `https://music.163.com/song/media/outer/url?id=${songId}.mp3`;
              const resultText = `已为你准备好歌曲：${song.name} - ${song.ar?.map(a => a.name).join('/')}，正在为你播放...\n播放链接：${playUrl}`;
              sendResponse({ id, jsonrpc: '2.0', result: { content: [{ type: 'text', text: resultText }] } });
            } else {
              sendResponse({ id, jsonrpc: '2.0', result: { content: [{ type: 'text', text: '获取歌曲信息失败，请稍后重试' }] } });
            }
          } catch (err) {
            sendResponse({ id, jsonrpc: '2.0', result: { content: [{ type: 'text', text: '获取播放链接时发生网络错误，请稍后再试' }] } });
          }
        }
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

console.log('🎵 网易云音乐 MCP 服务 v3.0 启动...');
connect();
