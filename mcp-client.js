const WebSocket = require('ws');
const axios = require('axios');

// 您的 MCP 接入点
const WS_URL = 'wss://api.xiaozhi.me/mcp/?token=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjkxMTg5NiwiYWdlbnRJZCI6MTg1MjQ4MCwiZW5kcG9pbnRJZCI6ImFnZW50XzE4NTI0ODAiLCJwdXJwb3NlIjoibWNwLWVuZHBvaW50IiwiaWF0IjoxNzgwODA4MTA3LCJleHAiOjE4MTIzNjU3MDd9.pukOrYTd3n4M1Wmmf_C4UPiPBDqT93Sz9auU7yqDgqHOBu5hH1OMLAGPLBUkdQyLHEKKGZlHsZsLFXNUKG83LQ';
// 您的 SSE 服务地址
const SSE_URL = 'https://mcp-proxy-production-a5db.up.railway.app/mcp';

let ws = null;
let reconnectTimer = null;

function connect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log('Connected to Xiaozhi MCP endpoint');
    // 发送 initialize 请求
    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {}
      }
    }));
  });

  ws.on('message', async (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (e) {
      console.error('Invalid JSON:', data);
      return;
    }
    console.log('Received from endpoint:', JSON.stringify(msg, null, 2));

    // 处理 tools/list
    if (msg.method === 'tools/list') {
      const toolList = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          tools: [{
            name: 'my_search_music',
            description: '搜索网易云音乐歌曲',
            inputSchema: {
              type: 'object',
              properties: {
                song_name: { type: 'string', description: '歌曲名称' },
                author_name: { type: 'string', description: '歌手名称' }
              },
              required: []
            }
          }]
        }
      };
      console.log('Sending tools/list response:', JSON.stringify(toolList));
      ws.send(JSON.stringify(toolList));
    }
    // 处理 tools/call
    else if (msg.method === 'tools/call') {
      const { id, params } = msg;
      const toolName = params.name;
      const argumentsObj = params.arguments || {};

      if (toolName === 'my_search_music') {
        // 将参数转换为 SSE 服务需要的格式
        let keyword = '';
        if (argumentsObj.song_name) keyword = argumentsObj.song_name;
        else if (argumentsObj.author_name) keyword = argumentsObj.author_name;
        else if (argumentsObj.keyword) keyword = argumentsObj.keyword;
        
        if (!keyword) {
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: id,
            error: { code: -32602, message: 'Missing search keyword' }
          }));
          return;
        }
        const convertedArgs = { keywords: keyword };
        console.log(`Calling SSE with converted args:`, convertedArgs);
        try {
          const response = await axios.post(SSE_URL, {
            jsonrpc: '2.0',
            id: id,
            method: 'tools/call',
            params: {
              name: 'search_music',
              arguments: convertedArgs
            }
          }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000
          });
          console.log('SSE response:', JSON.stringify(response.data, null, 2));
          ws.send(JSON.stringify(response.data));
        } catch (err) {
          console.error('Error calling SSE service:', err.message);
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: id,
            error: { code: -32000, message: 'SSE service error: ' + err.message }
          }));
        }
      } else {
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: id,
          error: { code: -32601, message: `Tool ${toolName} not found` }
        }));
      }
    }
    // 处理 initialize 响应
    else if (msg.method === 'initialize') {
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: 'simple-mcp-proxy', version: '1.0.0' }
        }
      }));
    }
    // 忽略 ping / notifications
    else if (msg.method === 'ping' || msg.method === 'notifications/initialized') {
      // 不回复或忽略
    }
    else {
      console.log('Unhandled method:', msg.method);
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });

  ws.on('close', () => {
    console.log('Disconnected, reconnecting in 5 seconds...');
    reconnectTimer = setTimeout(connect, 5000);
  });
}

connect();

process.on('SIGINT', () => {
  if (ws) ws.close();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  process.exit(0);
});
