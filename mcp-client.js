const WebSocket = require('ws');
const axios = require('axios');
const http = require('http');

// 您的 MCP 接入点和 SSE 地址
const WS_URL = 'wss://api.xiaozhi.me/mcp/?token=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjkxMTg5NiwiYWdlbnRJZCI6MTg1MjQ4MCwiZW5kcG9pbnRJZCI6ImFnZW50XzE4NTI0ODAiLCJwdXJwb3NlIjoibWNwLWVuZHBvaW50IiwiaWF0IjoxNzgwODA4MTA3LCJleHAiOjE4MTIzNjU3MDd9.pukOrYTd3n4M1Wmmf_C4UPiPBDqT93Sz9auU7yqDgqHOBu5hH1OMLAGPLBUkdQyLHEKKGZlHsZsLFXNUKG83LQ';
const SSE_URL = 'https://mcp-proxy-production-a5db.up.railway.app/mcp';

let ws = null;
let reconnectTimer = null;

// 创建 HTTP 服务器（用于健康检查，满足 Render 要求）
const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  } else {
    res.writeHead(404);
    res.end();
  }
});
server.listen(PORT, () => {
  console.log(`Health check server listening on port ${PORT}`);
});

function connect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log('Connected to Xiaozhi MCP endpoint');
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

    if (msg.method === 'tools/call') {
      const { id, params } = msg;
      const toolName = params.name;
      let argumentsObj = params.arguments || {};

      if (toolName === 'search_music') {
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
          ws.send(JSON.stringify(response.data));
        } catch (err) {
          console.error('Error calling SSE service:', err.message);
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: id,
            error: { code: -32000, message: 'SSE service error: ' + err.message }
          }));
        }
      } else if (toolName === 'play_music') {
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: id,
          result: {
            content: [{ type: 'text', text: '请先搜索歌曲，然后告诉我具体要播放哪一首。' }]
          }
        }));
      } else {
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: id,
          error: { code: -32601, message: `Tool ${toolName} not found` }
        }));
      }
    } else if (msg.method === 'tools/list') {
      const toolList = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          tools: [{
            name: 'search_music',
            description: '搜索网易云音乐歌曲',
            inputSchema: {
              type: 'object',
              properties: {
                song_name: { type: 'string', description: '歌曲名称' },
                author_name: { type: 'string', description: '歌手名称' }
              }
            }
          }]
        }
      };
      ws.send(JSON.stringify(toolList));
    } else if (msg.method === 'initialize') {
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'simple-mcp-proxy', version: '1.0.0' }
        }
      }));
    } else if (msg.method === 'ping') {
      // 忽略
    } else {
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
