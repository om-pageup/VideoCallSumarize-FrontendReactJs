import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import "./App.css";

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

function App() {
  const [roomId, setRoomId] = useState("");
  const [joined, setJoined] = useState(false);
  const socketRef = useRef();
  const localVideoRef = useRef();
  const peersRef = useRef({});
  const localStreamRef = useRef();
  const [remoteStreams, setRemoteStreams] = useState({});

  useEffect(() => {
    if (joined && localStreamRef.current && localVideoRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [joined]);

  useEffect(() => {
    socketRef.current = io(
      process.env.REACT_APP_BACKEND_URL || "http://localhost:5001",
    );

    socketRef.current.on("other-users", (users) => {
      users.forEach((userId) => createPeerConnection(userId, true));
    });

    socketRef.current.on("user-joined", (userId) => {
      createPeerConnection(userId, false);
    });

    socketRef.current.on("offer", async ({ offer, from }) => {
      const peer = peersRef.current[from];
      if (peer) {
        await peer.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socketRef.current.emit("answer", { answer, to: from });
      }
    });

    socketRef.current.on("answer", async ({ answer, from }) => {
      const peer = peersRef.current[from];
      if (peer) {
        await peer.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    socketRef.current.on("ice-candidate", async ({ candidate, from }) => {
      const peer = peersRef.current[from];
      if (peer && candidate) {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
      }
    });

    socketRef.current.on("user-left", (userId) => {
      if (peersRef.current[userId]) {
        peersRef.current[userId].close();
        delete peersRef.current[userId];
        setRemoteStreams((prev) => {
          const updated = { ...prev };
          delete updated[userId];
          return updated;
        });
      }
    });

    return () => {
      socketRef.current.disconnect();
      Object.values(peersRef.current).forEach((peer) => peer.close());
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const createPeerConnection = (userId, initiator) => {
    const peer = new RTCPeerConnection(ICE_SERVERS);
    peersRef.current[userId] = peer;

    localStreamRef.current.getTracks().forEach((track) => {
      peer.addTrack(track, localStreamRef.current);
    });

    peer.ontrack = (event) => {
      setRemoteStreams((prev) => ({ ...prev, [userId]: event.streams[0] }));
    };

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit("ice-candidate", {
          candidate: event.candidate,
          to: userId,
        });
      }
    };

    if (initiator) {
      peer.createOffer().then((offer) => {
        peer.setLocalDescription(offer);
        socketRef.current.emit("offer", { offer, to: userId });
      });
    }
  };

  const joinRoom = async () => {
    if (!roomId.trim()) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      localStreamRef.current = stream;

      setJoined(true);

      // Set video source after state update and render
      setTimeout(() => {
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      }, 100);

      socketRef.current.emit("join-room", roomId);
    } catch (error) {
      console.error("Error accessing media devices:", error);
      alert("Please allow camera and microphone access: " + error.message);
    }
  };

  return (
    <div className="app">
      {!joined ? (
        <div className="join-screen">
          <h1>Group Video Call</h1>
          <input
            type="text"
            placeholder="Enter Room ID"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && joinRoom()}
          />
          <button onClick={joinRoom}>Join Room</button>
        </div>
      ) : (
        <div className="video-container">
          <div className="video-grid">
            <div className="video-wrapper">
              <video ref={localVideoRef} autoPlay muted playsInline />
              <span className="video-label">You</span>
            </div>
            {Object.entries(remoteStreams).map(([userId, stream]) => (
              <RemoteVideo key={userId} stream={stream} userId={userId} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RemoteVideo({ stream, userId }) {
  const ref = useRef();

  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="video-wrapper">
      <video ref={ref} autoPlay playsInline />
      <span className="video-label">User {userId.slice(0, 6)}</span>
    </div>
  );
}

export default App;
