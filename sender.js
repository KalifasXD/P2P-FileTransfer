import {
  isValidSessionId,
  isValidToken,
  fetchTurnServers,
  getJWT
} from './helpers.js';

const sessionIdInput = document.getElementById('sessionIdInput');
const tokenInput = document.getElementById('tokenInput');
const connectBtn = document.getElementById('connectBtn');
const statusDiv = document.getElementById('status');
const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');
const sendBtn = document.getElementById('sendBtn');

let ws;
let pc;
let dataChannel;

$(function(){
  const url = new URLSearchParams(window.location.search);
  let sessionFromQR = (url.get('session') || '').toLowerCase();
  let tokenFromQR = (url.get('token') || '').toLowerCase();

  if (isValidSessionId(sessionFromQR) && isValidToken(tokenFromQR)) {
    sessionIdInput.value = sessionFromQR;
    connectBtn.onclick = () => connectToSession(sessionFromQR, tokenFromQR);
    connectBtn.click(); // auto-connect
  } else {
    statusDiv.textContent = 'Invalid session or token.';
  }
});

connectBtn.onclick = () => {
  const sessionId = (sessionIdInput.value || '').trim().toLowerCase();
  const token = (tokenInput.value || '').trim().toLowerCase();
  if (!isValidSessionId(sessionId)) { alert('Invalid session ID'); return; }
  if (!isValidToken(token)) { alert('Invalid token'); return; }
  connectToSession(sessionId, token);
};

async function connectToSession(sessionId, token) {
  statusDiv.textContent = 'Connecting to signaling server...';
  console.log('[Sender] Connecting to signaling server...');

  ws = new WebSocket('ws://localhost:8081');

  ws.onopen = async () => {
    console.log('[Sender] WebSocket connection opened');
    const payload = { type: 'join', room: sessionId, token };
    const jwt = getJWT();
    if (jwt) payload.jwt = jwt; // optional JWT
    ws.send(JSON.stringify(payload));
    statusDiv.textContent = `Joined ${sessionId}, setting up connection...`;

    // Fetch TURN credentials for this room and create peer connection using them
    const iceServers = await fetchTurnServers(sessionId);
    setupPeerConnection(iceServers); 
  };

  ws.onmessage = async (event) => {
    // be explicit: signaling is text JSON
    console.log('[Sender] Received message (type):', typeof event.data);
    try {
      const data = JSON.parse(event.data);

      if (data.type === 'answer') {
        console.log('[Sender] Received answer, setting remote description');
        // setRemoteDescription can accept the plain object containing { type, sdp }
        await pc.setRemoteDescription(data.sdp);
        statusDiv.textContent = 'Connection established! Ready to send photos.';
        uploadZone.style.display = 'block';
        sendBtn.disabled = false;

         // Auto-open file dialog if this was launched from QR code
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('session')) {
          fileInput.click();
        }
      } else if (data.type === 'candidate') {
        try {
          console.log('[Sender] Adding ICE candidate');
          await pc.addIceCandidate(data.candidate);
        } catch (e) {
          console.warn('[Sender] Error adding ICE candidate:', e);
        }
      } else if (data.type === 'error') {
        statusDiv.textContent = `Error: ${data.error}`;
      }
    } catch (e) {
      // if non-JSON arrives, warn — but ideally this never happens
      console.warn('[Sender] Received non-JSON on signaling channel (should not happen)', e);
    }
  };

  ws.onclose = (event) => {
    console.log('[Sender] WebSocket closed', event);
    
    // Update UI status
    statusDiv.textContent = 'Disconnected from signaling server';

    // Hide file input and disable send button
    uploadZone.style.display = 'none';
    sendBtn.disabled = true;
  };

  ws.onerror = (err) => {
    console.error('[Sender] WebSocket error:', err);
    statusDiv.textContent = 'Signaling error';
  };

  // do NOT call setupPeerConnection() again here (was duplicate in your original)
}

function setupPeerConnection(iceServers = [{ urls: 'stun:stun.l.google.com:19302' }]) {
  if (pc) {
    console.warn('[Sender] PeerConnection already exists — skipping duplicate setup');
    return;
  }

  console.log('[Sender] Setting up RTCPeerConnection');
   pc = new RTCPeerConnection({ iceServers });

  // create the data channel for file transfer
  dataChannel = pc.createDataChannel('fileTransfer');
  setupDataChannel();

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      console.log('[Sender] Sending ICE candidate over WebSocket (JSON only)');
      ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate }));
    }
  };

  pc.onconnectionstatechange = () => {
    console.log('[Sender] Connection state:', pc.connectionState);
    statusDiv.textContent = `Connection state: ${pc.connectionState}`;
    if (pc.connectionState === 'connected') {
      statusDiv.textContent = 'Connected to receiver!';
    } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      statusDiv.textContent = 'Connection lost';
    }
  };

  // create and send offer once
  pc.createOffer()
    .then((offer) => pc.setLocalDescription(offer))
    .then(() => {
      console.log('[Sender] Sending offer (JSON over WebSocket)');
      ws.send(JSON.stringify({ type: 'offer', sdp: pc.localDescription }));
    })
    .catch((err) => {
      console.error('[Sender] Error creating/sending offer', err);
    });
}

function setupDataChannel() {
  dataChannel.binaryType = 'arraybuffer';

  dataChannel.onopen = () => {
    console.log('[Sender] DataChannel open');
    statusDiv.textContent = 'DataChannel open — you can send photos now!';
    // wire up send button when data channel open
    sendBtn.disabled = false;
  };

  dataChannel.onclose = () => {
    console.log('[Sender] DataChannel closed');
    statusDiv.textContent = 'DataChannel closed';
    sendBtn.disabled = true;
  };

  dataChannel.onerror = (error) => {
    console.error('[Sender] DataChannel error:', error);
  };
}

// --- File sending logic (chunked, DataChannel only) ---
sendBtn.onclick = async () => {
  if (!fileInput.files.length) {
    alert('Please pick at least one file');
    return;
  }
  if (!dataChannel || dataChannel.readyState !== 'open') {
    alert('DataChannel not open yet — wait until connection is established.');
    return;
  }

  for (const file of fileInput.files) {
    try {
      await sendFileOverDataChannel(file);
    } catch (err) {
      console.error('[Sender] Error sending file:', err);
      statusDiv.textContent = 'Error sending file';
      return; // stop if one fails
    }
  }

  statusDiv.textContent = 'All files sent!';
};

async function sendFileOverDataChannel(file) {
  const chunkSize = 16 * 1024; // 16 KB
  const fileSize = file.size;
  let offset = 0;

  // Send metadata first
  const meta = { name: file.name, type: file.type, size: fileSize };
  dataChannel.send(`meta:${JSON.stringify(meta)}`);

  while (offset < fileSize) {
    const slice = file.slice(offset, offset + chunkSize);
    const arrayBuffer = await slice.arrayBuffer();

    if (dataChannel.bufferedAmount > chunkSize * 16) {
      await new Promise(resolve => {
        dataChannel.onbufferedamountlow = () => {
          dataChannel.onbufferedamountlow = null;
          resolve();
        };
        if ('bufferedAmountLowThreshold' in dataChannel) {
          dataChannel.bufferedAmountLowThreshold = chunkSize * 8;
        }
      });
    }

    dataChannel.send(arrayBuffer);
    offset += arrayBuffer.byteLength;
    statusDiv.textContent = `Sending ${file.name}: ${offset}/${fileSize} bytes`;
  }
}

function showQRCode(sessionId) {
  const safeId = sessionId.toLowerCase();
  const safeToken = (tokenInput.value || '').toLowerCase();

  if (!isValidSessionId(safeId) || !isValidToken(safeToken)) {
    console.warn('Refusing to render QR for invalid session/token');
    return;
  }
  
  $('#qrcode').empty();
  const joinUrl = `${location.origin}/client.html?session=${encodeURIComponent(safeId)}&token=${encodeURIComponent(safeToken)}`;
  new QRCode(document.getElementById("qrcode"), {
    text: joinUrl,
    width: 200,
    height: 200
  });
}
