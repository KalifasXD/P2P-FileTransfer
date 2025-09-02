# Peer-to-Peer File Transfer Application

## 📖 Overview
This project is a **peer-to-peer (P2P) file transfer application** that allows users to send and receive files directly between devices, without relying on a central server for storage or relay.  
The server in this setup is used **only for signaling and exchanging connection metadata**, after which the devices establish a **direct, secure WebRTC data channel** for file transfer.

This approach ensures:
- **Faster transfers** since files are not uploaded/downloaded through a third-party server.
- **Enhanced privacy**, as files never leave the two connected devices.

---

## ✨ Core Features
- **Peer-to-peer file transfer** using WebRTC Data Channels.  
- **QR code session setup** for quick and simple device pairing.  
- **Chunked file transfer** allowing large files to be sent in small pieces to avoid memory issues.  
- **Cross-device compatibility** (desktop, laptop, mobile browsers).  

---

## 🛠 Technologies Used
- **Node.js + Express** → For running the signaling server.  
- **WebSockets (ws library)** → For real-time signaling between peers.  
- **WebRTC** → For secure peer-to-peer connections and file transfer.  
- **STUN/TURN servers** → For NAT traversal, ensuring connections work across different networks.  
- **JavaScript (frontend)** → Handles QR generation, WebRTC setup, and file transfer logic.  
- **jQuery** → Simplifies DOM manipulation and event handling.  
- **QRCode.js** → Generates QR codes for session sharing.  

---

## 🔒 Security Features
1. **Secure Session IDs**  
   - Each session is identified by a randomly generated 20-character alphanumeric string.  
   - Difficult to guess valid sessions.  

2. **Session Tokens**  
   - Along with the session ID, a unique 32-character token is generated.  
   - Both are required to join a room, preventing unauthorized access.  

3. **Temporary Rooms**  
   - Rooms are created dynamically and destroyed once clients disconnect.  
   - Eliminates the risk of abandoned sessions being hijacked.  

4. **TURN/STUN Servers**  
   - Fallback relay for peers that cannot connect directly.  
   - All traffic is encrypted.  

5. **No File Storage**  
   - Files are **never stored on the server** — only transmitted between peers.  

6. **WebSocket Input Validation**  
   - The signaling server validates room IDs and tokens before allowing connections.  
   - Invalid inputs are rejected immediately.  

7. **Optional JWT Authentication (future-ready)**  
   - Hook available for enforcing JWT validation.  
   - Useful for enterprise environments.  

---

## 🔄 How It Works (Simplified Flow)
1. **Receiver** creates a session → Session ID + token generated.  
2. A **QR code** is displayed containing the session details.  
3. **Sender** scans QR code and joins the session.  
4. Devices use the **signaling server** to exchange metadata (offer, answer, ICE candidates).  
5. Once connected, files are transferred via **WebRTC DataChannel**.  

---

## ✅ Advantages
- **Speed:** Direct transfers without uploading to third-party servers.  
- **Privacy:** Data stays between sender and receiver.  
- **Security:** Random session IDs and tokens act as strong access keys.  
- **Flexibility:** Works across devices and networks using WebRTC + TURN/STUN.  

---

## 🔒 System Architecture Graphical Analysis
![System_Architecture](https://github.com/user-attachments/assets/ae7c31f4-826c-4c72-8c16-662567a4ae21)

## 🔒 User Workflow Graphical Analysis
![User_Workflow](https://github.com/user-attachments/assets/493866be-a7af-478e-a129-c9a06d752241)


