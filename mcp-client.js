import WebSocket from 'ws';
import fetch from 'node-fetch';

// ================== 配置区 ==================
// 1. 你的网易云音乐 API 地址 (已在 Railway 上部署好的)
const NETEASE_API_BASE = 'https://netease-cloud-music-api-production.up.railway.app';

// 2. 从小智后台获取的 MCP 接入点 (已填入你的Token)
const MCP_ENDPOINT = 'wss://api.xiaozhi.me/mcp/?token=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjkxMTg5NiwiYWdlbnRJZCI6MTg1MjQ4MCwiZW5kcG9pbnRJZCI6ImFnZW50XzE4NTI0ODAiLCJwdXJwb3NlIjoibWNwLWVuZHBvaW50IiwiaWF0IjoxNzgxMDk4ODMwLCJleHAiOjE4MTI2NTY0MzB9.qxYrLdBZOqHFkkQfaQEo44WEMHFO3IqVRCJX_4LGADFzzfdUagOkeMJYtjcjUaufHDhw2JeF_5u4NP9bVcXCtQ';
// ===========================================

let ws;
let reconnectTimer;

function connect() {
  ws = new WebSocket(MCP_ENDPOINT);

  ws.on('open', () => {
    console.log('已连接到小智 MCP 服务');
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
            serverInfo: {
              name: 'netease-music-server',
              version: '1.0.0'
            }
          }
        });
      }

      // 2. 处理工具列表请求
      else if (message.method === 'tools/list') {
        sendResponse({
          id: message.id,
          jsonrpc: '2.0',
          result: {
            tools: [{
              name: 'my_search_music',
              description: '搜索网易云音乐真实歌曲，返回可播放的歌曲列表',
              inputSchema: {
                type: 'object',
                properties: {
                  keyword: {
                    type: 'string',
                    description: '搜索关键词，可以是歌名或歌手名'
                  }
                },
                required: ['keyword']
              }
            }]
          }
        });
      }

      // 3. 处理工具调用 (最关键的部分!)
      else if (message.method === 'tools/call') {
        const { id, params } = message;
        const toolName = params.name;
        const args = params.arguments;

        console.log(`🔧 调用工具: ${toolName}`, args);

        if (toolName === 'my_search_music') {
          try {
            // 获取搜索关键词
            const keyword = args.keyword || args.song_name || '';
            if (!keyword) {
              sendResponse({
                id, jsonrpc: '2.0',
                result: {
                  content: [{ type: 'text', text: '错误：请提供歌曲名或歌手名' }]
                }
              });
              return;
            }

            // 调用你的网易云 API
            console.log(`🎵 搜索: ${keyword}`);
            const apiUrl = `${NETEASE_API_BASE}/search?keywords=${encodeURIComponent(keyword)}`;
            const response = await fetch(apiUrl);
            const data = await response.json();

            // 提取歌曲信息
            let resultText = '';
            if (data.result && data.result.songs && data.result.songs.length > 0) {
              const songs = data.result.songs.slice(0, 5).map((song, index) => {
                const name = song.name;
                const artists = song.artists.map(a => a.name).join('/');
                return `${index + 1}. ${name} - ${artists}`;
              }).join('\n');
              resultText = `🔍 搜索 "${keyword}" 的结果：\n${songs}\n\n你可以说“播放第X首”来选择歌曲`;
            } else {
              resultText = `没有找到与 "${keyword}" 相关的歌曲`;
            }

            sendResponse({
              id, jsonrpc: '2.0',
              result: {
                content: [{ type: 'text', text: resultText }]
              }
            });
            console.log('✅ 工具调用完成');
          } catch (err) {
            console.error('❌ 搜索失败:', err.message);
            sendResponse({
              id, jsonrpc: '2.0',
              result: {
                content: [{ type: 'text', text: '搜索音乐时出错，请稍后再试' }]
              }
            });
          }
        } else {
          // 未知工具
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

// 启动连接
console.log('🎵 网易云音乐 MCP 服务启动...');
connect();
