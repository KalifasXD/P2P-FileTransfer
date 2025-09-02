import {
  generateSecureId,
  generateSecureToken,
  isValidSessionId,
  fetchTurnServers,
  getJWT,
  SESSION_ID_LENGTH,
} from './helpers.js';

const sessionIdInput = document.getElementById('sessionIdInput');
const statusDiv = document.getElementById('status');
const receivedFilesDiv = document.getElementById('receivedFiles');
const qrcodeEl = document.getElementById('qrcode');

let ws;
let pc;
let dataChannel;
let currentToken = null;

// Initialization Function
$(function(){
  // Generate unique session ID
  const id = generateSecureId();

  // Also prep a fresh token so QR is ready after connect
  currentToken = generateSecureToken();

  // Create QR code for sender to scan
  const joinUrl = `${location.origin}/client.html?session=${encodeURIComponent(id)}&token=${encodeURIComponent(currentToken)}`;
  new QRCode(document.getElementById("qrcode"), {
    text: joinUrl,
    width: 200,
    height: 200
  });

  // Auto-join as receiver
  joinSession(id, currentToken);
});

function startKeepAlive() {
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 25000); // every 25 seconds
}

async function joinSession(sessionId, token) {
  statusDiv.textContent = 'Connecting to signaling server...';
  console.log('[Receiver] Connecting to signaling server...');

  ws = new WebSocket('ws://localhost:8081');

  ws.onopen = async () => {
    console.log('[Receiver] WebSocket connection opened');

    const payload = { type: 'join', room: sessionId, token };
    const jwt = getJWT();
    if (jwt) payload.jwt = jwt; // optional JWT
    ws.send(JSON.stringify(payload));

    statusDiv.textContent = `Hosting room with Session ID: ${sessionId} & Token: ${token}. Waiting for sender...`;
    startKeepAlive();

    // Request TURN credentials for this room and create peer connection using them
    const iceServers = await fetchTurnServers(sessionId);
    setupPeerConnection(iceServers);

    // Render QR with both session & token
    renderQRCode(sessionId, token);
  };

  ws.onmessage = async (event) => {
    console.log('[Receiver] Received message:', event.data);
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (e) {
      console.warn('[Receiver] Ignoring non-JSON message on signaling channel', event.data);
      return; // ignore this message
    }


    if (data.type === 'offer') {
      console.log('[Receiver] Received offer, setting remote description');
      await pc.setRemoteDescription(data.sdp);

      console.log('[Receiver] Creating answer...');
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log('[Receiver] Sending answer');
      ws.send(JSON.stringify({ type: 'answer', sdp: pc.localDescription }));
      statusDiv.textContent = 'Sender connected. Establishing secure channel...';
    } else if (data.type === 'candidate') {
      try {
        console.log('[Receiver] Adding ICE candidate');
        await pc.addIceCandidate(data.candidate);
      } catch (e) {
        console.warn('[Receiver] Error adding ICE candidate:', e);
      }
    } else if (data.type === 'error') {
      statusDiv.textContent = `Error: ${data.error}`;
    }
  };

  ws.onclose = () => {
    console.log('[Receiver] WebSocket closed');
    statusDiv.textContent = 'Disconnected from signaling server';
  };

  ws.onerror = (err) => {
    console.error('[Receiver] WebSocket error:', err);
    statusDiv.textContent = 'Signaling error';
  };

  setupPeerConnection();
}

function setupPeerConnection(iceServers = [{ urls: 'stun:stun.l.google.com:19302' }]) {
  console.log('[Receiver] Setting up RTCPeerConnection');
  pc = new RTCPeerConnection({ iceServers });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      console.log('[Receiver] Sending ICE candidate');
      ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate }));
    }
  };

  pc.onconnectionstatechange = () => {
    console.log('[Receiver] Connection state:', pc.connectionState);
    statusDiv.textContent = `Connection state: ${pc.connectionState}`;
    if (pc.connectionState === 'connected') {
      statusDiv.textContent = 'Connected to sender!';
    } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      statusDiv.textContent = 'Connection lost';
    }
  };

  pc.ondatachannel = (event) => {
    console.log('[Receiver] Data channel received');
    dataChannel = event.channel;
    statusDiv.textContent = 'DataChannel opened, waiting for files...';

    let receiveBuffer = [];
    let receivedSize = 0;
    let fileSize = 0;

    dataChannel.binaryType = 'arraybuffer';

    dataChannel.onopen = () => {
      console.log('[Receiver] Data channel open');
      statusDiv.textContent = 'DataChannel open, ready to receive files!';
    };

    dataChannel.onclose = () => {
      console.log('[Receiver] Data channel closed');
      statusDiv.textContent = 'DataChannel closed';
    };

    dataChannel.onmessage = (event) => {
    if (typeof event.data === 'string') {
      if (event.data.startsWith('meta:')) {
        const meta = JSON.parse(event.data.slice(5));
        currentFileName = meta.name;
        currentFileType = meta.type || 'application/octet-stream';
        expectedFileSize = meta.size;
        receivedSize = 0;
        receiveBuffer = [];
        console.log(`[Receiver] Receiving "${currentFileName}" (${expectedFileSize} bytes)`);
        statusDiv.textContent = `Receiving ${currentFileName}...`;
        return;
      }
    }

    // Binary chunk
    receiveBuffer.push(event.data);
    receivedSize += event.data.byteLength;
    console.log(`[Receiver] Received ${receivedSize}/${expectedFileSize} bytes of ${currentFileName}`);

    if (receivedSize >= expectedFileSize) {
      const receivedBlob = new Blob(receiveBuffer, { type: currentFileType });
      addReceivedFile(receivedBlob, currentFileName);
      statusDiv.textContent = 'File received! Waiting for more...';
    }
  };
  };
}

// Simple QR renderer (requires QRCode lib + <div id="qrcode">)
function renderQRCode(sessionId, token) {
  if (!qrcodeEl) return;
  qrcodeEl.innerHTML = '';
  const joinUrl = `${location.origin}/sender.html?session=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}`;
  new QRCode(qrcodeEl, { text: joinUrl, width: 200, height: 200 });
}

function saveReceivedFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `received_${Date.now()}`;
  a.textContent = `Download ${filename} (${(blob.size / 1024).toFixed(2)} KB)`;
  a.style.display = 'block';
  receivedFilesDiv.appendChild(a);
}
