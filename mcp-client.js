import WebSocket from 'ws';
import fetch from 'node-fetch';

const NETEASE_API_BASE = 'https://netease-cloud-music-api-production.up.railway.app';
// 请务必替换成你从小智后台最新获取的Token！
const MCP_ENDPOINT = 'wss://api.xiaozhi.me/mcp/?token=wss://api.xiaozhi.me/mcp/?token=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjkxMTg5NiwiYWdlbnRJZCI6MTg1MjQ4MCwiZW5kcG9pbnRJZCI6ImFnZW50XzE4NTI0ODAiLCJwdXJwb3NlIjoibWNwLWVuZHBvaW50IiwiaWF0IjoxNzgxMDk1MTUzLCJleHAiOjE4MTI2NTI3NTN9.eTsb5B04Q1k0vvgIOQ7U-yNovA_nnFfPjAWSScuzRWBucwjObhQXlyKpaTGFmPOhQ0mCjY7K4QDWPUnCGpLNdw';

let ws;
let reconnectTimer;

function connect() {
  ws = new WebSocket(MCP_ENDPOINT);

  ws.on('open', () => {
    console.log('已连接到小智 MCP 服务');
  });

  ws.on('message', async (data) => {
    let message;
    try {
      // 解析JSON消息可能失败
      message = JSON.parse(data.toString());
    } catch (parseError) {
      console.error('❌ 解析JSON消息失败:', parseError.message);
      return; // 解析失败就忽略这条消息，防止崩溃
    }

    // 这个大的 try...catch 包裹所有工具处理逻辑，是防止崩溃的关键
    try {
      console.log('收到消息:', JSON.stringify(message).substring(0, 200) + '...');

      if (message.method === 'initialize') {
        sendResponse({
          id: message.id, jsonrpc: '2.0',
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            serverInfo: { name: 'netease-music-server', version: '4.0.1' }
          }
        });
      }
      else if (message.method === 'tools/list') {
        sendResponse({
          id: message.id, jsonrpc: '2.0',
          result: {
            tools: [
              {
                name: 'my_search_music',
                description: '搜索网易云音乐真实歌曲，返回歌曲列表和ID',
                inputSchema: {
                  type: 'object',
                  properties: { keyword: { type: 'string', description: '搜索关键词' } },
                  required: ['keyword']
                }
              },
              {
                name: 'get_song_url',
                description: '根据歌曲ID获取在线播放链接',
                inputSchema: {
                  type: 'object',
                  properties: { song_id: { type: 'string', description: '歌曲ID' } },
                  required: ['song_id']
                }
              }
            ]
          }
        });
      }
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
            console.log(`🎵 搜索: ${keyword}`);
            const response = await fetch(apiUrl);
            
            // 检查HTTP状态码，防止非JSON响应导致解析失败
            if (!response.ok) {
              console.error(`❌ API请求失败，状态码: ${response.status}`);
              sendResponse({ id, jsonrpc: '2.0', result: { content: [{ type: 'text', text: '搜索音乐时出错，API服务异常' }] } });
              return;
            }

            const data = await response.json();
            let resultText = '';
            if (data.result && data.result.songs && data.result.songs.length > 0) {
              const songs = data.result.songs.slice(0, 5).map((song, index) => {
                return `${index + 1}. ${song.name} - ${song.artists.map(a => a.name).join('/')} [ID:${song.id}]`;
              }).join('\n');
              resultText = `🔍 搜索 "${keyword}" 的结果：\n${songs}\n\n请告诉我想听第几首`;
            } else {
              resultText = `没有找到与 "${keyword}" 相关的歌曲`;
            }
            sendResponse({ id, jsonrpc: '2.0', result: { content: [{ type: 'text', text: resultText }] } });
            console.log('✅ 搜索完成');
          } catch (err) {
            console.error('❌ 搜索失败:', err.message);
            sendResponse({ id, jsonrpc: '2.0', result: { content: [{ type: 'text', text: '搜索音乐时出错，请稍后再试' }] } });
          }
        }
        else if (toolName === 'get_song_url') {
          const songId = args.song_id;
          if (!songId) {
            sendResponse({ id, jsonrpc: '2.0', result: { content: [{ type: 'text', text: '错误：缺少歌曲ID' }] } });
            return;
          }
          try {
            const detailUrl = `${NETEASE_API_BASE}/song/detail?ids=${songId}`;
            console.log(`🔗 获取链接: ${songId}`);
            const detailResponse = await fetch(detailUrl);
            if (!detailResponse.ok) {
              console.error(`❌ API请求失败，状态码: ${detailResponse.status}`);
              sendResponse({ id, jsonrpc: '2.0', result: { content: [{ type: 'text', text: '获取歌曲信息失败，API服务异常' }] } });
              return;
            }
            const detailData = await detailResponse.json();
            if (detailData.code === 200 && detailData.songs && detailData.songs.length > 0) {
              const song = detailData.songs[0];
              const playUrl = `https://music.163.com/song/media/outer/url?id=${songId}.mp3`;
              const resultText = `已获取歌曲播放链接。请立即使用内置的音频播放能力播放该链接：${playUrl}`;
              sendResponse({ id, jsonrpc: '2.0', result: { content: [{ type: 'text', text: resultText }] } });
              console.log('✅ 获取链接完成');
            } else {
              sendResponse({ id, jsonrpc: '2.0', result: { content: [{ type: 'text', text: '获取歌曲信息失败' }] } });
            }
          } catch (err) {
            console.error('❌ 获取链接失败:', err.message);
            sendResponse({ id, jsonrpc: '2.0', result: { content: [{ type: 'text', text: '获取链接时网络出错' }] } });
          }
        }
        else {
          sendResponse({ id, jsonrpc: '2.0', error: { code: -32601, message: `Unknown tool: ${toolName}` } });
        }
      }
    } catch (handlerError) {
      // 这是最后的保护伞，任何未预料的错误都会被捕获，防止进程崩溃
      console.error('❌ 处理消息时发生严重错误:', handlerError.message, handlerError.stack);
      // 如果可能，尝试给客户端返回一个通用错误
      if (message && message.id) {
        try {
          sendResponse({ id: message.id, jsonrpc: '2.0', result: { content: [{ type: 'text', text: '服务内部错误，请稍后重试' }] } });
        } catch (sendError) {
          console.error('发送错误响应也失败了:', sendError.message);
        }
      }
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

console.log('🎵 网易云音乐 MCP 服务启动...');
connect();
