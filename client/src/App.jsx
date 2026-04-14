import React, { useState, useEffect, useRef, useMemo } from 'react';
import io from 'socket.io-client';
import { Send, Hash, MessageSquare, Menu, X, User, LogIn, Sparkles, Paperclip, File, Image as ImageIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const API_URL = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000').replace(/\/$/, "");

function App() {
  // Reactive Socket Initialization
  const socket = useMemo(() => io(API_URL, {
    transports: ['polling', 'websocket'],
    withCredentials: true,
    reconnectionAttempts: 15,
    reconnectionDelay: 2000,
    autoConnect: true
  }), []);

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [room, setRoom] = useState('');
  const [username, setUsername] = useState('');
  const [message, setMessage] = useState('');
  const [messageList, setMessageList] = useState([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summary, setSummary] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [suggestionLatency, setSuggestionLatency] = useState(null);
  const [typingUsers, setTypingUsers] = useState({}); // { username: timestamp }
  const typingTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);
  
  // Robustness States
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [errorMsg, setErrorMsg] = useState('');
  const [showReconnected, setShowReconnected] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [aiState, setAiState] = useState('idle'); // 'idle', 'loading', 'error', 'disabled'
  const [aiErrorCount, setAiErrorCount] = useState(0);
  
  const scrollRef = useRef();
  const rooms = ['General', 'Tech', 'Design', 'Random'];
  const [isLoggedOut, setIsLoggedOut] = useState(false); // Helper for session clearing

  // Safety helper for timestamp formatting
  const formatTime = (timestamp) => {
    try {
      if (!timestamp) return '--:--';
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) return '--:--';
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '--:--';
    }
  };

  // 1. Connection Monitoring (Runs on Mount)
  useEffect(() => {
    const onConnect = () => {
      console.log("✅ [Socket] Connected:", socket.id);
      setIsConnected(true);
      setErrorMsg('');
      setShowReconnected(true);
      setTimeout(() => setShowReconnected(false), 3000);
    };

    const onDisconnect = (reason) => {
      console.log("❌ [Socket] Disconnected:", reason);
      setIsConnected(false);
    };

    const onConnectError = (err) => {
      console.error(`🔴 [Socket] Connection Error: ${err.message}`);
      setErrorMsg(err.message);
      setIsConnected(false);
    };

    // Initialize state
    setIsConnected(socket.connected);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
    };
  }, []); // Only on mount

  // 2. Room & Message Logic (Runs when logged in or room changes)
  useEffect(() => {
    if (!isLoggedIn) return;

    // Clear any existing listeners to prevent duplicates
    socket.off('room_history');
    socket.off('receive_message');
    socket.off('user_typing');
    socket.off('user_stop_typing');

    console.log(`🏠 [UI] Joining Room: ${room} as ${username}`);

    // Join room
    setIsLoadingHistory(true);
    socket.emit('join_room', room);
    
    // Listen for history
    socket.on('room_history', (history) => {
      console.log(`📜 [UI] Received history for ${room}:`, history.length, "messages");
      setMessageList(history);
      setIsLoadingHistory(false);
    });

    // Listen for new messages
    let lastSuggestionTime = 0;
    socket.on('receive_message', (data) => {
      console.log(`📩 [UI] New message in ${room}:`, data.content);
      setMessageList((list) => [...list, data]);
      
      // Only fetch suggestions if someone else speaks AND we haven't asked in the last 15 seconds
      // This protects your Gemini Free Tier quota.
      const now = Date.now();
      if (data.sender !== username && (now - lastSuggestionTime > 15000)) {
        lastSuggestionTime = now;
        fetchSuggestions();
      }
    });

    // Listen for typing events
    socket.on('user_typing', (data) => {
      if (data.sender !== username) {
        setTypingUsers(prev => ({ ...prev, [data.sender]: Date.now() }));
      }
    });

    socket.on('user_stop_typing', (data) => {
      setTypingUsers(prev => {
        const newTyping = { ...prev };
        delete newTyping[data.sender];
        return newTyping;
      });
    });

    return () => {
      console.log(`🧹 [UI] Cleaning up listeners for room: ${room}`);
      socket.off('room_history');
      socket.off('receive_message');
      socket.off('user_typing');
      socket.off('user_stop_typing');
    };
  }, [room, isLoggedIn, username]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messageList]);

  const handleReconnect = () => {
    socket.connect();
    setErrorMsg('Attempting manual reconnect...');
  };

  const sendMessage = async () => {
    if (message !== '') {
      const messageData = {
        roomId: room,
        sender: username,
        content: message,
      };

      socket.emit('send_message', messageData);
      socket.emit('stop_typing', { roomId: room, sender: username });
      setMessage('');
    }
  };

  const handleInputChange = (e) => {
    setMessage(e.target.value);
    
    // Emit typing event
    socket.emit('typing', { roomId: room, sender: username });

    // Clear existing timeout
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    // Set timeout to stop typing
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('stop_typing', { roomId: room, sender: username });
    }, 3000);
  };

  const handleSummarize = async () => {
    if (aiState === 'disabled') return;
    setIsSummarizing(true);
    setAiState('loading');
    try {
      const response = await fetch(`${API_URL}/api/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: room }),
      });
      
      if (!response.ok) throw new Error("API Error");
      
      const data = await response.json();
      if (data.summary) {
        setSummary(data.summary);
        setShowModal(true);
        setAiState('idle');
        setAiErrorCount(0);
      }
    } catch (err) {
      console.error("Summarization failed:", err);
      const newCount = aiErrorCount + 1;
      setAiErrorCount(newCount);
      setAiState(newCount >= 3 ? 'disabled' : 'error');
    } finally {
      setIsSummarizing(false);
    }
  };

  const fetchSuggestions = async () => {
    if (aiState === 'disabled') return;
    setIsSuggesting(true);
    const startTime = performance.now();
    try {
      const response = await fetch(`${API_URL}/api/suggest-replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: room }),
      });
      
      if (!response.ok) throw new Error("API Error");
      
      const data = await response.json();
      if (data.suggestions) {
        setSuggestions(data.suggestions);
        const endTime = performance.now();
        const latency = (endTime - startTime).toFixed(0);
        setSuggestionLatency(latency);
        console.log(`[QA LOG] AI Suggestion Latency: ${latency}ms`);
        setAiErrorCount(0);
        if (aiState === 'error') setAiState('idle');
      }
    } catch (err) {
      console.error("Suggestions failed:", err);
      // We don't necessarily disable AI immediately on background suggestion failure
      // but we do increment the count to be safe.
      setAiErrorCount(prev => prev + 1);
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      alert("File is too large! Maximum size is 10MB.");
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${API_URL}/api/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error("Upload failed");

      const data = await response.json();
      
      // Send message with file URL
      const messageData = {
        roomId: room,
        sender: username,
        content: '', // Optional text can be added later
        fileUrl: data.fileUrl,
        fileType: data.fileType
      };

      socket.emit('send_message', messageData);
    } catch (err) {
      console.error("File upload error:", err);
      alert("Failed to upload file.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  console.log("[UI] isLoggedIn:", isLoggedIn, "isConnected:", isConnected);

  const handleJoin = (e) => {
    e.preventDefault();
    console.log("[UI] Attempting to join with:", username, room);
    if (username && room) {
      setIsLoggedIn(true);
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="app-container" style={{ 
        justifyContent: 'center', 
        alignItems: 'center', 
        display: 'flex', 
        minHeight: '100vh', 
        width: '100vw',
        background: '#0f172a',
        color: 'white'
      }}>
        <div className="glass-card" style={{ padding: '40px', borderRadius: '24px', width: '400px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(20px)' }}>
          <h1 style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '12px', fontSize: '1.8rem' }}>
            <MessageSquare color="#6366f1" size={32} /> Join Chat
          </h1>
          <form onSubmit={handleJoin} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', color: '#94a3b8' }}>Username</label>
              <input 
                type="text" 
                placeholder="Enter your name..."
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', color: 'white' }}
                required
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', color: '#94a3b8' }}>Room ID</label>
              <input 
                type="text" 
                placeholder="e.g. Room 101"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', color: 'white' }}
                required
              />
            </div>
            <button className="send-btn" type="submit" style={{ width: '100%', height: '50px', borderRadius: '12px', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer', background: '#6366f1', color: 'white', border: 'none' }}>
              Join Chat <LogIn size={20} style={{ marginLeft: '8px' }} />
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container" style={{ display: 'flex', height: '100vh', width: '100vw', background: '#0f172a' }}>
      {isSidebarOpen && <div className="overlay" onClick={() => setIsSidebarOpen(false)}></div>}

      <AnimatePresence mode="wait">
        <motion.div 
          key={room}
          initial={{ x: -320, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -320, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className={`sidebar ${isSidebarOpen ? 'open' : ''}`}
        >
          <div className="sidebar-header">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MessageSquare color="#6366f1" /> Nexus Chat
            </h2>
          </div>
          <div className="rooms-list">
            <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '12px', paddingLeft: '8px' }}>FAST CHANNELS</p>
            {rooms.map((r) => (
              <div 
                key={r} 
                className={`room-item ${room === r ? 'active' : ''}`}
                onClick={() => { setRoom(r); setMessageList([]); setIsSidebarOpen(false); }}
              >
                <Hash size={18} style={{ marginRight: '8px' }} /> {r}
              </div>
            ))}
            <div className="room-item active" style={{ marginTop: '20px' }}>
              <Hash size={18} style={{ marginRight: '8px' }} /> {room} (Current)
            </div>
          </div>
          <div style={{ padding: '16px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ padding: '8px', background: 'rgba(99, 102, 241, 0.1)', borderRadius: '50%' }}>
              <User size={20} color="#6366f1" />
            </div>
            <div>
              <p style={{ fontSize: '14px', fontWeight: '600' }}>{username}</p>
              <p style={{ fontSize: '12px', color: '#94a3b8' }}>Online</p>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>

      <div className="chat-window">
        {!isConnected && (
          <div className="connection-banner banner-offline">
            <div>
              <X size={14} /> Connection Lost. Reconnecting...
            </div>
            <div style={{ fontSize: '11px', marginTop: '4px', opacity: 0.9 }}>
              Note: If the server was idle, it may take 30-60s to wake up.
            </div>
            {errorMsg && (
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#ffeb3b', marginTop: '2px' }}>
                Status: {errorMsg}
              </div>
            )}
            <div style={{ fontSize: '10px', opacity: 0.8, marginTop: '4px' }}>
              Backend: {API_URL}
            </div>
            <button 
              onClick={handleReconnect}
              style={{ 
                marginTop: '10px', 
                background: 'rgba(255,255,255,0.15)', 
                border: 'none', 
                padding: '4px 12px', 
                borderRadius: '6px', 
                color: 'white', 
                fontSize: '11px', 
                cursor: 'pointer',
                fontWeight: '600'
              }}
            >
              Retry Connection ↻
            </button>
          </div>
        )}
        {showReconnected && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="connection-banner banner-reconnected"
          >
            Reconnected Successfully
          </motion.div>
        )}
        <div className="chat-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Menu className="mobile-only" style={{ cursor: 'pointer', display: 'none' }} onClick={() => setIsSidebarOpen(true)} />
            <h2># {room}</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {aiState === 'error' && (
              <button 
                className="summarize-btn" 
                onClick={handleSummarize}
                style={{ background: 'rgba(244, 63, 94, 0.1)', color: '#f43f5e', border: '1px solid rgba(244, 63, 94, 0.2)' }}
              >
                Retry AI ↻
              </button>
            )}
            {aiState === 'disabled' && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', opacity: 0.7 }}>
                AI temporarily unavailable
              </span>
            )}
            <button 
              className="summarize-btn" 
              onClick={handleSummarize} 
              disabled={isSummarizing || messageList.length === 0 || aiState === 'disabled' || aiState === 'error'}
            >
              {isSummarizing ? (
                <span className="loader"></span>
              ) : (
                <><Sparkles size={16} /> Summarize</>
              )}
            </button>
          </div>
        </div>

        <div className="messages-container" ref={scrollRef}>
          {isLoadingHistory ? (
            <>
              <div className="skeleton-bubble skeleton-other"></div>
              <div className="skeleton-bubble skeleton-mine"></div>
              <div className="skeleton-bubble skeleton-other"></div>
              <div className="skeleton-bubble skeleton-mine" style={{ width: '40%' }}></div>
              <div className="skeleton-bubble skeleton-other" style={{ width: '50%' }}></div>
            </>
          ) : (
            <AnimatePresence initial={false}>
              {(Array.isArray(messageList) ? messageList : []).map((msg, index) => (
                <motion.div 
                  key={msg._id || index} 
                  initial={{ opacity: 0, y: 20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.2 }}
                  className={`message-bubble ${msg.sender === username ? 'message-mine' : 'message-other'}`}
                >
                  <div style={{ fontWeight: '600', fontSize: '0.75rem', marginBottom: '2px', opacity: 0.9 }}>
                    {msg.sender}
                  </div>
                  
                  {msg.fileUrl && (
                    <div className="file-attachment">
                      {msg.fileType === 'image' ? (
                        <a href={msg.fileUrl} target="_blank" rel="noopener noreferrer" className="image-link">
                          <img src={msg.fileUrl} alt="attachment" className="chat-image" />
                        </a>
                      ) : (
                        <a 
                          href={msg.fileUrl} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="file-link"
                          title="Open Document"
                        >
                          <div className="file-icon-box">
                            {msg.fileType === 'pdf' ? <File size={24} color="#f43f5e" /> : <Paperclip size={24} />}
                          </div>
                          <div className="file-name-info">
                            <span className="file-name-text">
                              {msg.fileName || (msg.fileType === 'pdf' ? 'PDF Document' : 'Attachment')}
                            </span>
                            <span className="file-meta-text">
                              {(msg.fileUrl.split('.').pop() || 'file').toUpperCase()} • Click to view
                            </span>
                          </div>
                        </a>
                      )}
                    </div>
                  )}
                  
                  {msg.content && <div>{msg.content}</div>}
                  
                  <div className="message-info">
                    {formatTime(msg.timestamp)}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>

        {(isSuggesting || suggestions.length > 0) && (
          <div className="suggestions-container">
            {isSuggesting ? (
              <>
                <div className="shimmer"></div>
                <div className="shimmer"></div>
                <div className="shimmer"></div>
              </>
            ) : (
              suggestions.map((s, i) => (
                <button 
                  key={i} 
                  className="suggestion-chip"
                  onClick={() => {
                    const messageData = { roomId: room, sender: username, content: s };
                    socket.emit('send_message', messageData);
                    setSuggestions([]);
                  }}
                >
                  {s}
                </button>
              ))
            )}
            {suggestionLatency && !isSuggesting && (
              <span style={{ fontSize: '0.65rem', color: suggestionLatency > 2000 ? '#f43f5e' : '#64748b', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px' }}>
                {suggestionLatency > 2000 && <Sparkles size={10} />}
                AI: {suggestionLatency}ms {suggestionLatency > 2000 && "(High Latency)"}
              </span>
            )}
          </div>
        )}

        <div className="input-bar">
          <input 
            type="file" 
            style={{ display: 'none' }} 
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/*,application/pdf"
          />
          <button 
            className="attachment-btn" 
            onClick={() => fileInputRef.current.click()}
            disabled={isUploading}
          >
            {isUploading ? <span className="loader" style={{ width: '16px', height: '16px' }}></span> : <Paperclip size={20} />}
          </button>
          
          <AnimatePresence>
            {Object.keys(typingUsers).length > 0 && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                style={{ 
                  position: 'absolute', 
                  top: '-30px', 
                  left: '32px', 
                  fontSize: '0.75rem', 
                  color: 'var(--accent-secondary)',
                  fontStyle: 'italic',
                  zIndex: 10
                }}
              >
                {Object.keys(typingUsers).join(', ')} {Object.keys(typingUsers).length > 1 ? 'are' : 'is'} typing...
              </motion.div>
            )}
          </AnimatePresence>
          <input 
            type="text" 
            placeholder={isUploading ? "Uploading file..." : `Message #${room}...`}
            value={message}
            onChange={handleInputChange}
            onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
            disabled={isUploading}
          />
          <button className="send-btn" onClick={sendMessage} disabled={isUploading || message === ''}>
            <Send size={20} />
          </button>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Sparkles color="#6366f1" /> Discussion Summary
              </h2>
              <button className="close-btn" onClick={() => setShowModal(false)}>
                <X size={24} />
              </button>
            </div>
            <div className="summary-text" style={{ 
              background: 'rgba(0,0,0,0.2)', 
              padding: '24px', 
              borderRadius: '16px', 
              border: '1px solid rgba(255,255,255,0.05)',
              color: 'var(--text-primary)'
            }}>
              {summary.split('\n').map((line, i) => {
                const trimmed = line.trim();
                if (!trimmed) return <div key={i} style={{ height: '12px' }} />;
                
                // Handle bullet points properly
                const isBullet = trimmed.startsWith('*') || trimmed.startsWith('-') || /^\d+\./.test(trimmed);
                const content = isBullet ? trimmed.replace(/^[\*\-]\s*|^\d+\.\s*/, '') : trimmed;
                
                return (
                  <div key={i} style={{ 
                    marginBottom: '10px', 
                    display: 'flex', 
                    gap: '12px',
                    alignItems: 'flex-start',
                    fontSize: '1.05rem',
                    lineHeight: '1.6'
                  }}>
                    {isBullet && <div style={{ marginTop: '8px', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent-primary)', flexShrink: 0 }} />}
                    <div style={{ flex: 1 }}>{content}</div>
                  </div>
                );
              })}
            </div>
            <button 
              className="send-btn" 
              style={{ width: '100%', marginTop: '32px', height: '54px', borderRadius: '14px', fontSize: '1rem', fontWeight: 'bold' }} 
              onClick={() => setShowModal(false)}
            >
              Great, thanks!
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
