const WebSocket = require('ws');
const crypto = require('crypto');
const cors = require("cors");
const express = require('express');
const http = require('http');

const app = express();
const PORT = 8081; // single port for both HTTP + WS

// Allow all origins for now (dev only)
app.use(cors());

app.use(express.json());

// TURN credentials endpoint
app.post('/turn-credentials', async (req, res) => {
  try {
    const response = await fetch("https://eas-uploader.metered.live/api/v1/turn/credentials?apiKey=9a890c59555dc08abfd4ee9b6a67fda29869");
    const iceServers = await response.json();

    console.log(iceServers);
    return res.json({ iceServers });
  } catch (e) {
    console.error('Error issuing TURN credentials', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// Create one HTTP server
const server = http.createServer(app);

// Attach WebSocket to same server/port
const wss = new WebSocket.Server({ server });

const VALID_ROOM_RE = /^[a-z0-9]{20}$/;
const VALID_TOKEN_RE = /^[a-z0-9]{32}$/;

let rooms = {}; // { roomId: [ws1, ws2] }

// ---- JWT verification hook (prepare for later) ----
const ENABLE_JWT = false; // flip to true when ready
function verifyJWT(maybeJWT) {
  if (!ENABLE_JWT) return { ok: true, user: null };
  try {
    // Example for HS256:
    // const decoded = jwt.verify(maybeJWT, process.env.JWT_SHARED_SECRET, { algorithms: ['HS256'] });
    // Example for RS256:
    // const decoded = jwt.verify(maybeJWT, process.env.JWT_PUBLIC_KEY, { algorithms: ['RS256'] });
    // Add issuer/audience checks as needed:
    // if (decoded.iss !== process.env.JWT_ISSUER) throw new Error('bad iss');
    return { ok: true, user: null /* or decoded.sub / claims */ };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

wss.on('connection', (ws) => {
  console.log('New client connected');

  ws.on('message', (message, isBinary) => {
    if (isBinary) {
      console.warn('⚠ Dropping unexpected binary message on signaling channel');
      return;
    }

    let data;
    try {
      data = JSON.parse(message.toString());
    } catch (e) {
      console.error('Invalid JSON from client, dropping message:', message.toString());
      return;
    }

    if (data.type === 'join') {
      const room = String(data.room || '').toLowerCase();
      const token = String(data.token || '').toLowerCase();

      if (!VALID_ROOM_RE.test(room)) {
        ws.send(JSON.stringify({ type: 'error', error: 'invalid_room' }));
        ws.close();
        return;
      }
      if (!VALID_TOKEN_RE.test(token)) {
        ws.send(JSON.stringify({ type: 'error', error: 'invalid_token' }));
        ws.close();
        return;
      }

      if (!rooms[room]) {
        // First joiner sets the token
        rooms[room] = { token, clients: [], createdAt: Date.now() };
      } else if (rooms[room].token !== token) {
        ws.send(JSON.stringify({ type: 'error', error: 'token_mismatch' }));
        ws.close();
        return;
      }

      rooms[room].clients.push(ws);
      ws.room = room;
      console.log(`Client joined room ${room}. Clients: ${rooms[room].clients.length}`);

      ws.send(JSON.stringify({ type: 'room-info', clients: rooms[room].clients.length }));
      return;
    }

    // All other signaling must come from an authenticated client in a room
    if (!ws.room || !rooms[ws.room]) {
      console.warn('Received signaling message from client not in a valid room');
      ws.send(JSON.stringify({ type: 'error', error: 'not_in_room' }));
      return;
    }

    // Relay JSON signaling to other clients in the same room
    rooms[ws.room].clients.forEach(client => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  });

  ws.on('close', () => {
    if (ws.room && rooms[ws.room]) {
      const room = rooms[ws.room];
      room.clients = room.clients.filter(c => c !== ws);
      console.log(`Client disconnected from room ${ws.room}. Remaining: ${room.clients.length}`);
      if (room.clients.length === 0) {
        delete rooms[ws.room];
        console.log(`Deleted empty room ${ws.room}`);
      }
    } else {
      console.log('Client disconnected (not in a room)');
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

// Start both Express + WS
server.listen(PORT, () => {
  console.log(`Server running on http://192.168.56.1:${PORT}`);
});