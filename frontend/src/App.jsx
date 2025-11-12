import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import DrawOutlinedIcon from "@mui/icons-material/DrawOutlined";
import MicNoneOutlinedIcon from "@mui/icons-material/MicNoneOutlined";
import PauseOutlinedIcon from "@mui/icons-material/PauseOutlined";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import EditIcon from "@mui/icons-material/Edit";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";

// Use proxy in development, direct URL in production
const API_BASE_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "" : "http://localhost:4000");

const IconButton = ({ label, children, ...props }) => (
  <button
    type="button"
    className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[#1f1f1f] text-white transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
    aria-label={label}
    title={label}
    {...props}
  >
    {children}
  </button>
);

const formatTimestamp = (value) => {
  if (!value) {
    return null;
  }
  const stamp = new Date(value);
  if (Number.isNaN(stamp.getTime())) {
    return null;
  }
  return stamp.toLocaleString();
};

const getFeedbackClasses = (variant) => {
  switch (variant) {
    case "success":
      return "text-emerald-400";
    case "error":
      return "text-rose-400";
    case "pending":
      return "text-sky-400";
    default:
      return "text-slate-400";
  }
};

const sanitizeAppState = (appState) => {
  if (!appState) {
    return {};
  }
  // Drop collaborator metadata and transient props before storing.
  // eslint-disable-next-line no-unused-vars
  const { collaborators, ...rest } = appState;
  return rest;
};

export default function App() {
  const excalidrawAPIRef = useRef(null);
  const [sketchTitle] = useState("Homepage concept");
  const [feedback, setFeedback] = useState({
    variant: "idle",
    message: "Sketch first, then send it to the backend with Generate.",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastSketch, setLastSketch] = useState(null);
  const [sketchCount, setSketchCount] = useState(0);
  const [generatedHTML, setGeneratedHTML] = useState(null);
  const [backendStatus, setBackendStatus] = useState({
    ready: false,
    message: "Checking backend connection...",
  });
  const [inputMode, setInputMode] = useState("sketch");
  const [chatMessages, setChatMessages] = useState([]);
  const [chatSessionId] = useState(() => `chat-${Date.now()}`);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editedContent, setEditedContent] = useState("");
  const chatInputRef = useRef(null);
  
  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [micStatus, setMicStatus] = useState("idle"); // idle, checking, ready, error
  const [availableMicrophones, setAvailableMicrophones] = useState([]);
  const [selectedMicrophoneId, setSelectedMicrophoneId] = useState(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioStreamRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);
  const voiceSessionIdRef = useRef(`voice-${Date.now()}`);
  const isMonitoringRef = useRef(false);

  const changeInputMode = useCallback((newInputMode) => {
    // Stop recording if switching away from voice mode
    if (inputMode === "speak" && isRecording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
    setInputMode(newInputMode);
  }, [inputMode, isRecording]);

  // Enumerate available audio input devices
  const enumerateMicrophones = useCallback(async () => {
    try {
      // Request permission first to get device labels (but stop the stream immediately)
      let tempStream = null;
      try {
        tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (permError) {
        console.warn("Permission request failed:", permError);
        // Continue anyway - we might still get device list
      }
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices
        .filter(device => device.kind === 'audioinput')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${device.deviceId.substring(0, 8)}`,
          groupId: device.groupId
        }));
      
      // Stop the temporary stream if we got one
      if (tempStream) {
        tempStream.getTracks().forEach(track => track.stop());
      }
      
      console.log("Found microphones:", audioInputs.length, audioInputs);
      setAvailableMicrophones(audioInputs);
      
      // Set default microphone if none selected
      setSelectedMicrophoneId(prev => {
        if (!prev && audioInputs.length > 0) {
          return audioInputs[0].deviceId;
        }
        // If previously selected device is no longer available, reset to first
        if (prev && !audioInputs.find(mic => mic.deviceId === prev) && audioInputs.length > 0) {
          return audioInputs[0].deviceId;
        }
        return prev;
      });
    } catch (error) {
      console.error("Error enumerating microphones:", error);
    }
  }, []);

  // Handle device changes
  useEffect(() => {
    const handleDeviceChange = () => {
      enumerateMicrophones();
    };

    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    
    // Initial enumeration when entering voice mode
    if (inputMode === "speak") {
      enumerateMicrophones();
    }

    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [inputMode, enumerateMicrophones]);

  const checkMicrophoneAccess = useCallback(async () => {
    setMicStatus("checking");
    
    // Stop any existing stream first
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
      audioStreamRef.current = null;
    }
    
    // Cancel any existing monitoring
    isMonitoringRef.current = false;
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    
    try {
      const constraints = {
        audio: selectedMicrophoneId 
          ? { 
              deviceId: { ideal: selectedMicrophoneId },
              echoCancellation: false,  // Disable to see raw audio
              autoGainControl: false,   // Disable to see raw audio
              noiseSuppression: false,  // Disable to see raw audio
              sampleRate: 44100
            }
          : {
              echoCancellation: false,
              autoGainControl: false,
              noiseSuppression: false,
              sampleRate: 44100
            }
      };
      
      console.log("Requesting microphone with constraints:", constraints);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Check track details
      const tracks = stream.getAudioTracks();
      const trackDetails = tracks.map(t => {
        const settings = t.getSettings();
        return {
          id: t.id,
          enabled: t.enabled,
          muted: t.muted,
          readyState: t.readyState,
          label: t.label,
          settings: settings,
          constraints: t.getConstraints(),
          // Check for volume/gain settings
          volume: settings.volume,
          sampleRate: settings.sampleRate,
          channelCount: settings.channelCount,
          echoCancellation: settings.echoCancellation,
          autoGainControl: settings.autoGainControl,
          noiseSuppression: settings.noiseSuppression
        };
      });
      console.log("Audio tracks (full details):", JSON.stringify(trackDetails, null, 2));
      
      // Ensure tracks are enabled and not muted
      tracks.forEach(track => {
        if (!track.enabled) {
          console.warn("Track is disabled, enabling...");
          track.enabled = true;
        }
        if (track.muted) {
          console.warn("Track is muted! Attempting to unmute...");
          // Try to apply constraints to unmute
          track.applyConstraints({}).catch(err => {
            console.error("Failed to apply constraints:", err);
          });
        }
      });
      
      // Set up audio analysis for level visualization
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      console.log("AudioContext state:", audioContext.state);
      
      // Resume audio context if suspended (required for user interaction)
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
        console.log("AudioContext resumed, new state:", audioContext.state);
      }
      
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048; // Larger FFT size for better time domain resolution
      analyser.smoothingTimeConstant = 0.0; // No smoothing for immediate response
      analyser.minDecibels = -90;
      analyser.maxDecibels = -10;
      
      const microphone = audioContext.createMediaStreamSource(stream);
      
      // Add a gain node to amplify the signal (helps detect very quiet audio)
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 5.0; // Amplify by 5x
      microphone.connect(gainNode);
      gainNode.connect(analyser);
      
      analyserRef.current = analyser;
      audioStreamRef.current = stream;
      
      // Wait a bit for the stream to start producing data (especially for Bluetooth devices)
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Verify stream is still active
      const activeTracks = stream.getAudioTracks().filter(t => t.readyState === 'live');
      console.log("Active tracks after delay:", activeTracks.length);
      if (activeTracks.length === 0) {
        throw new Error("No active audio tracks after initialization");
      }
      
      // Start monitoring audio levels
      isMonitoringRef.current = true;
      let frameCount = 0;
      let consecutiveZeroFrames = 0;
      const monitorAudioLevel = () => {
        if (!analyserRef.current || !isMonitoringRef.current) return;
        
        // Use Float32Array for better precision (values between -1 and 1)
        const bufferLength = analyserRef.current.fftSize;
        const dataArray = new Float32Array(bufferLength);
        analyserRef.current.getFloatTimeDomainData(dataArray);
        
        // Calculate RMS (Root Mean Square) for audio level
        let sum = 0;
        let maxAmplitude = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const value = Math.abs(dataArray[i]);
          sum += dataArray[i] * dataArray[i];
          maxAmplitude = Math.max(maxAmplitude, value);
        }
        const rms = Math.sqrt(sum / dataArray.length);
        // Amplify and normalize (RMS is typically 0-0.1 for normal speech, scale it up)
        const normalizedLevel = Math.min(rms * 20, 1);
        
        // Check for consecutive zero frames
        if (maxAmplitude < 0.0001) {
          consecutiveZeroFrames++;
        } else {
          consecutiveZeroFrames = 0;
        }
        
        // Debug logging every 60 frames (roughly once per second at 60fps)
        if (frameCount % 60 === 0) {
          const nonZeroSamples = Array.from(dataArray).filter(v => Math.abs(v) > 0.001).length;
          const sampleValues = Array.from(dataArray).slice(0, 10); // First 10 samples for debugging
          console.log(`Audio level: ${normalizedLevel.toFixed(4)}, RMS: ${rms.toFixed(6)}, Max amplitude: ${maxAmplitude.toFixed(6)}, Non-zero samples: ${nonZeroSamples}/${dataArray.length}, First 10 samples: [${sampleValues.map(v => v.toFixed(4)).join(', ')}]`);
          
          // Check if track is still active
          const currentTracks = audioStreamRef.current?.getAudioTracks() || [];
          currentTracks.forEach(track => {
            if (track.muted) {
              console.warn("Track became muted!");
            }
            if (!track.enabled) {
              console.warn("Track became disabled!");
            }
            if (track.readyState !== 'live') {
              console.warn(`Track readyState changed to: ${track.readyState}`);
            }
          });
          
          // Warn if we've had many consecutive zero frames
          if (consecutiveZeroFrames > 180) { // 3 seconds at 60fps
            console.warn("No audio detected for 3+ seconds. Check microphone permissions and system settings.");
          }
        }
        frameCount++;
        
        setAudioLevel(normalizedLevel);
        
        // Continue monitoring
        if (isMonitoringRef.current) {
          animationFrameRef.current = requestAnimationFrame(monitorAudioLevel);
        }
      };
      
      setMicStatus("ready");
      monitorAudioLevel();
      
      // Keep stream open for level monitoring, will be stopped when recording starts or mode changes
    } catch (error) {
      console.error("Microphone access error:", error);
      setMicStatus("error");
      setFeedback({
        variant: "error",
        message: `Microphone access denied: ${error.message}`,
      });
    }
  }, [selectedMicrophoneId]);

  // Check microphone access when entering voice mode
  useEffect(() => {
    if (inputMode === "speak" && micStatus === "idle") {
      checkMicrophoneAccess();
    }
    
    // Reset mic status when leaving voice mode
    if (inputMode !== "speak" && micStatus !== "idle") {
      setMicStatus("idle");
      setAudioLevel(0);
    }
    
    return () => {
      // Cleanup audio analysis
      isMonitoringRef.current = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioStreamRef.current && !isRecording) {
        audioStreamRef.current.getTracks().forEach((track) => track.stop());
        audioStreamRef.current = null;
      }
    };
  }, [inputMode, micStatus, isRecording, checkMicrophoneAccess]);

  const uiOptions = useMemo(
    () => ({
      canvasActions: {
        changeViewBackgroundColor: true,
        clearCanvas: true,
        export: false,
        loadScene: false,
        saveAsImage: false,
        saveToActiveFile: false,
        toggleTheme: false,
      },
      dockedToolbar: true,
    }),
    []
  );

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        console.log(`Bootstrap: Attempting to connect to ${API_BASE_URL}`);
        const [statusRes, sketchesRes] = await Promise.all([
          fetch(`${API_BASE_URL}/api/status`, {
            method: 'GET',
            mode: 'cors',
            credentials: 'omit',
          }).catch((err) => {
            console.error("Failed to fetch /api/status:", err);
            console.error("Error details:", {
              name: err.name,
              message: err.message,
              stack: err.stack
            });
            return null;
          }),
          fetch(`${API_BASE_URL}/api/sketches`, {
            method: 'GET',
            mode: 'cors',
            credentials: 'omit',
          }).catch((err) => {
            console.error("Failed to fetch /api/sketches:", err);
            return null;
          }),
        ]);

        if (cancelled) {
          return;
        }

        if (statusRes?.ok) {
          const data = await statusRes.json();
          setBackendStatus({
            ready: true,
            message: `Backend online - ${data.service ?? "FrameForge API"}`,
          });
        } else {
          const errorMsg = statusRes 
            ? `Backend returned ${statusRes.status}: ${statusRes.statusText}`
            : `Failed to connect to backend at ${API_BASE_URL}. Make sure the backend is running.`;
          throw new Error(errorMsg);
        }

        if (sketchesRes?.ok) {
          const data = await sketchesRes.json();
          setSketchCount(
            Array.isArray(data.sketches) ? data.sketches.length : 0
          );
          if (data.sketches?.length) {
            setLastSketch(data.sketches[0]);
          }
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Backend connection error:", error);
          setBackendStatus({
            ready: false,
            message: error.message || "Backend unavailable - start the API to enable saving.",
          });
        }
      }
    };

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!excalidrawAPIRef.current) {
      setFeedback({
        variant: "error",
        message: "Canvas is not ready yet. Please wait a moment.",
      });
      return;
    }

    const elements = excalidrawAPIRef.current.getSceneElements();
    const hasDrawableElement = elements.some((element) => !element.isDeleted);

    if (!hasDrawableElement) {
      setFeedback({
        variant: "error",
        message: "Add at least one shape or stroke before generating.",
      });
      return;
    }

    setIsGenerating(true);
    setFeedback({
      variant: "pending",
      message: "Generating UI from sketch...",
    });

    try {
      const rawAppState = excalidrawAPIRef.current.getAppState();
      const files = excalidrawAPIRef.current.getFiles();
      const serialized = serializeAsJSON(
        elements,
        sanitizeAppState(rawAppState),
        files,
        "database"
      );

      const parsed = JSON.parse(serialized);
      
      // First save the sketch
      console.log("Saving sketch...");
      let saveResponse;
      try {
        saveResponse = await fetch(`${API_BASE_URL}/api/sketches`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: sketchTitle,
            scene: {
              elements: parsed.elements ?? [],
              appState: parsed.appState ?? {},
              files: parsed.files ?? {},
            },
          }),
          mode: 'cors',
        });
        console.log(`Save response status: ${saveResponse.status}`);
      } catch (saveError) {
        console.error("Failed to save sketch:", saveError);
        throw new Error(`Failed to save sketch: ${saveError.message}. Check backend connection.`);
      }

      if (!saveResponse.ok) {
        const errorBody = await saveResponse.json().catch(() => ({}));
        throw new Error(errorBody.error ?? "Unable to save sketch.");
      }

      const savePayload = await saveResponse.json();
      setLastSketch(savePayload.sketch);
      setSketchCount((count) => count + 1);

      // Then generate UI from the sketch
      setFeedback({
        variant: "pending",
        message: "Generating HTML/CSS from your sketch...",
      });

      // Get recent chat context for better generation
      const recentChatContext = chatMessages
        .slice(-4)
        .map(msg => `${msg.role}: ${msg.content}`)
        .join('\n');

      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout

      // Log the request details for debugging
      const requestBody = {
        prompt: recentChatContext || "Generate a modern, clean UI based on this sketch",
        sketches: [{
          id: savePayload.sketch.id,
          title: sketchTitle,
          elements: parsed.elements ?? [],
          appState: parsed.appState ?? {},
        }],
      };
      
      const bodyString = JSON.stringify(requestBody);
      const bodySize = new Blob([bodyString]).size;
      
      console.log(`Making request to ${API_BASE_URL}/api/mockups`);
      console.log(`Current origin: ${window.location.origin}`);
      console.log(`Request body size: ${bodySize} bytes (${(bodySize / 1024).toFixed(2)} KB)`);
      
      // Limit the size of elements array if it's too large
      if (bodySize > 10 * 1024 * 1024) { // 10MB limit
        console.warn("Request body is very large, truncating elements array");
        requestBody.sketches[0].elements = requestBody.sketches[0].elements.slice(0, 100);
      }

      let generateResponse;
      try {
        // Try without abort signal first to see if that's the issue
        console.log("Attempting fetch...");
        generateResponse = await fetch(`${API_BASE_URL}/api/mockups`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: bodyString,
          mode: 'cors',
          credentials: 'omit', // Don't send credentials to avoid CORS issues
        });
        clearTimeout(timeoutId);
        console.log(`Response status: ${generateResponse.status} ${generateResponse.statusText}`);
      } catch (fetchError) {
        clearTimeout(timeoutId);
        console.error("Fetch error details:", {
          name: fetchError.name,
          message: fetchError.message,
          stack: fetchError.stack,
          url: `${API_BASE_URL}/api/mockups`,
          origin: window.location.origin,
          errorType: fetchError.constructor.name
        });
        
        // Try a simpler test request to verify connectivity
        try {
          console.log("Testing simple connectivity...");
          const testResponse = await fetch(`${API_BASE_URL}/api/status`, {
            method: "GET",
            mode: 'cors',
          });
          console.log(`Test request status: ${testResponse.status}`);
        } catch (testError) {
          console.error("Even simple GET request failed:", testError);
        }
        
        if (fetchError.name === 'AbortError') {
          throw new Error(`Request timed out after 60 seconds. The backend may be processing a large request.`);
        } else if (fetchError.message.includes('Failed to fetch') || fetchError.message.includes('NetworkError')) {
          throw new Error(`Failed to connect to backend at ${API_BASE_URL}. Check that the backend is running and CORS is configured correctly. Current origin: ${window.location.origin}. Error: ${fetchError.message}`);
        } else {
          throw new Error(`Failed to connect to backend: ${fetchError.message}. Make sure the backend is running on ${API_BASE_URL}`);
        }
      }

      if (!generateResponse.ok) {
        const errorBody = await generateResponse.json().catch(() => ({}));
        const errorMessage = errorBody.error || errorBody.details || `HTTP ${generateResponse.status}: ${generateResponse.statusText}`;
        throw new Error(errorMessage);
      }

      const generatePayload = await generateResponse.json();
      
      if (!generatePayload.html) {
        throw new Error("Backend returned no HTML content.");
      }
      
      setGeneratedHTML(generatePayload.html);
      
      setFeedback({
        variant: "success",
        message: "UI generated successfully! Check the preview pane.",
      });
    } catch (error) {
      console.error("Generate error:", error);
      setFeedback({
        variant: "error",
        message: error.message || "Something went wrong while generating.",
      });
    } finally {
      setIsGenerating(false);
    }
  }, [sketchTitle, chatMessages]);

  const handleSendChatMessage = useCallback(async () => {
    const input = chatInputRef.current;
    if (!input || !input.value.trim() || isSendingChat || !backendStatus.ready) {
      return;
    }

    const userMessage = input.value.trim();
    input.value = "";

    // Add user message to chat
    const newUserMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: userMessage,
      timestamp: new Date().toISOString(),
    };
    setChatMessages((prev) => [...prev, newUserMessage]);
    setIsSendingChat(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: userMessage,
          sessionId: chatSessionId,
          context: {
            lastSketch: lastSketch?.id || null,
            sketchCount,
            currentHTML: generatedHTML, // Include current HTML for modification
          },
        }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.error ?? "Failed to send message.");
      }

      const data = await response.json();
      const assistantMessage = {
        id: `msg-${Date.now()}`,
        role: "assistant",
        content: data.message,
        timestamp: data.timestamp || new Date().toISOString(),
      };
      setChatMessages((prev) => [...prev, assistantMessage]);

      // If the response includes updated HTML, update the preview
      if (data.html && data.html !== generatedHTML) {
        console.log("Updating HTML from chat response");
        setGeneratedHTML(data.html);
        setFeedback({
          variant: "success",
          message: "HTML updated based on your request.",
        });
      }
    } catch (error) {
      const errorMessage = {
        id: `msg-${Date.now()}`,
        role: "system",
        content: `Error: ${error.message || "Failed to send message."}`,
        timestamp: new Date().toISOString(),
      };
      setChatMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsSendingChat(false);
    }
  }, [chatSessionId, backendStatus.ready, lastSketch, sketchCount, isSendingChat, generatedHTML]);

  // Check if message contains code blocks (HTML, CSS, JS, etc.)
  const hasCodeContent = useCallback((content) => {
    return /```[\s\S]*?```|`[^`]+`|<[^>]+>|\.css|\.html|\.js|\.tsx?|\.jsx/.test(content);
  }, []);

  // Start editing a message
  const handleStartEdit = useCallback((messageId, content) => {
    setEditingMessageId(messageId);
    setEditedContent(content);
  }, []);

  // Cancel editing
  const handleCancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditedContent("");
  }, []);

  // Save edited message and send as follow-up
  const handleSaveEdit = useCallback(async (messageId, originalContent) => {
    if (!editedContent.trim() || editedContent === originalContent) {
      handleCancelEdit();
      return;
    }

    // Update the message in the chat
    setChatMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId
          ? { ...msg, content: editedContent }
          : msg
      )
    );

    // Send the edited content as a follow-up message
    const followUpMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: `I've edited the previous response:\n\n${editedContent}`,
      timestamp: new Date().toISOString(),
    };
    setChatMessages((prev) => [...prev, followUpMessage]);
    setIsSendingChat(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: `I've edited the previous response:\n\n${editedContent}`,
          sessionId: chatSessionId,
          context: {
            lastSketch: lastSketch?.id || null,
            sketchCount,
            editedMessage: originalContent,
            currentHTML: generatedHTML, // Include current HTML for modification
          },
        }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.error ?? "Failed to send edited message.");
      }

      const data = await response.json();
      const assistantMessage = {
        id: `msg-${Date.now()}`,
        role: "assistant",
        content: data.message,
        timestamp: data.timestamp || new Date().toISOString(),
      };
      setChatMessages((prev) => [...prev, assistantMessage]);

      // If the response includes updated HTML, update the preview
      if (data.html && data.html !== generatedHTML) {
        console.log("Updating HTML from edited message response");
        setGeneratedHTML(data.html);
        setFeedback({
          variant: "success",
          message: "HTML updated based on your edited request.",
        });
      }
    } catch (error) {
      const errorMessage = {
        id: `msg-${Date.now()}`,
        role: "system",
        content: `Error: ${error.message || "Failed to send edited message."}`,
        timestamp: new Date().toISOString(),
      };
      setChatMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsSendingChat(false);
      handleCancelEdit();
    }
  }, [editedContent, chatSessionId, lastSketch, sketchCount, handleCancelEdit, generatedHTML]);

  const handleStartVoiceRecording = useCallback(async () => {
    try {
      const constraints = {
        audio: selectedMicrophoneId 
          ? { 
              deviceId: { ideal: selectedMicrophoneId },
              echoCancellation: false,
              autoGainControl: false,
              noiseSuppression: false,
              sampleRate: 44100
            }
          : {
              echoCancellation: false,
              autoGainControl: false,
              noiseSuppression: false,
              sampleRate: 44100
            }
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Check track details
      const tracks = stream.getAudioTracks();
      console.log("Recording - Audio tracks:", tracks.map(t => ({
        id: t.id,
        enabled: t.enabled,
        muted: t.muted,
        readyState: t.readyState
      })));
      
      // Ensure tracks are enabled
      tracks.forEach(track => {
        if (!track.enabled) {
          track.enabled = true;
        }
      });
      
      audioStreamRef.current = stream;
      
      // Set up audio analysis for real-time visualization
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      // Resume audio context if suspended (required for user interaction)
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.0; // No smoothing for immediate response
      analyser.minDecibels = -90;
      analyser.maxDecibels = -10;
      
      const microphone = audioContext.createMediaStreamSource(stream);
      
      // Add a gain node to amplify the signal
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 5.0; // Amplify by 5x
      microphone.connect(gainNode);
      gainNode.connect(analyser);
      
      analyserRef.current = analyser;
      
      // Wait a bit for the stream to start producing data
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Monitor audio levels during recording
      isMonitoringRef.current = true;
      const monitorAudioLevel = () => {
        if (!analyserRef.current || !isMonitoringRef.current) return;
        
        // Use Float32Array for better precision
        const bufferLength = analyserRef.current.fftSize;
        const dataArray = new Float32Array(bufferLength);
        analyserRef.current.getFloatTimeDomainData(dataArray);
        
        // Calculate RMS (Root Mean Square) for audio level
        let sum = 0;
        let maxAmplitude = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const absValue = Math.abs(dataArray[i]);
          sum += dataArray[i] * dataArray[i];
          maxAmplitude = Math.max(maxAmplitude, absValue);
        }
        const rms = Math.sqrt(sum / dataArray.length);
        const normalizedLevel = Math.min(rms * 20, 1); // Amplify for visibility
        
        // Log occasionally during recording
        if (Math.random() < 0.01) { // ~1% of frames
          const nonZeroSamples = Array.from(dataArray).filter(v => Math.abs(v) > 0.001).length;
          console.log(`[Recording] RMS: ${rms.toFixed(6)}, Max: ${maxAmplitude.toFixed(6)}, Non-zero: ${nonZeroSamples}`);
        }
        
        setAudioLevel(normalizedLevel);
        
        if (isMonitoringRef.current) {
          animationFrameRef.current = requestAnimationFrame(monitorAudioLevel);
        }
      };
      
      // Check supported MIME types
      const supportedTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/mp4",
        "audio/mpeg"
      ];
      
      let mimeType = "audio/webm;codecs=opus";
      for (const type of supportedTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          mimeType = type;
          break;
        }
      }
      
      console.log("Using MIME type:", mimeType);
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: mimeType,
      });
      
      audioChunksRef.current = [];
      
      // Add error handling for MediaRecorder
      mediaRecorder.onerror = (event) => {
        console.error("MediaRecorder error:", event);
        setFeedback({
          variant: "error",
          message: `Recording error: ${event.error?.message || "Unknown error"}`,
        });
      };
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        // Stop audio monitoring
        isMonitoringRef.current = false;
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        setAudioLevel(0);
        
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        
        // Convert blob to base64
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64Audio = reader.result.split(",")[1];
          
          setIsProcessingVoice(true);
          try {
            const response = await fetch(`${API_BASE_URL}/api/voice`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                audio: base64Audio,
                format: "webm",
                sessionId: voiceSessionIdRef.current,
                context: {
                  lastSketch: lastSketch?.id || null,
                  sketchCount,
                  currentHTML: generatedHTML, // Include current HTML for modification
                },
              }),
            });
            
            if (!response.ok) {
              const errorBody = await response.json().catch(() => ({}));
              throw new Error(errorBody.error ?? "Failed to process voice.");
            }
            
            const data = await response.json();
            
            // Add transcript and response to chat messages
            if (data.transcript) {
              const transcriptMessage = {
                id: `msg-${Date.now()}`,
                role: "user",
                content: `[Voice] ${data.transcript}`,
                timestamp: new Date().toISOString(),
              };
              setChatMessages((prev) => [...prev, transcriptMessage]);
            }
            
            if (data.message) {
              const assistantMessage = {
                id: `msg-${Date.now()}`,
                role: "assistant",
                content: data.message,
                timestamp: data.timestamp || new Date().toISOString(),
              };
              setChatMessages((prev) => [...prev, assistantMessage]);
            }

            // If the response includes updated HTML, update the preview
            if (data.html && data.html !== generatedHTML) {
              console.log("Updating HTML from voice response");
              setGeneratedHTML(data.html);
              setFeedback({
                variant: "success",
                message: "HTML updated based on your voice request.",
              });
            }
          } catch (error) {
            const errorMessage = {
              id: `msg-${Date.now()}`,
              role: "system",
              content: `Error: ${error.message || "Failed to process voice."}`,
              timestamp: new Date().toISOString(),
            };
            setChatMessages((prev) => [...prev, errorMessage]);
          } finally {
            setIsProcessingVoice(false);
          }
        };
        
        reader.readAsDataURL(audioBlob);
        
        // Stop all tracks to release microphone
        stream.getTracks().forEach((track) => track.stop());
        audioStreamRef.current = null;
        analyserRef.current = null;
      };
      
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
      monitorAudioLevel();
    } catch (error) {
      setMicStatus("error");
      setFeedback({
        variant: "error",
        message: `Failed to start recording: ${error.message}`,
      });
    }
  }, [lastSketch, sketchCount, isRecording, selectedMicrophoneId]);

  const handleStopVoiceRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setAudioLevel(0);
    }
  }, [isRecording]);

  const generateButton = (
    <button
      type="button"
      onClick={handleGenerate}
      disabled={isGenerating || !backendStatus.ready}
      className="pointer-events-auto z-[9999] flex h-12 items-center justify-center rounded-full bg-[#2563eb] px-8 text-xs font-semibold uppercase tracking-[0.3em] text-white shadow-lg transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:bg-[#3f4b6b]"
    >
      {isGenerating ? "Generating..." : "Generate"}
    </button>
  );

  return (
    <div className="flex min-h-screen w-screen items-stretch bg-[#0f0f0f] text-white">
      <div className="relative grid h-screen w-full grid-cols-1 bg-black/40 lg:grid-cols-2">
        {/* Input Pane */}
        {inputMode === "sketch" ? (
          <section className="flex flex-col bg-[#181818] lg:pr-12">
            <header className="flex items-center justify-between px-6 py-6 lg:px-8 lg:py-8">
              <span className="text-2xl font-semibold tracking-tight">
                FrameForge
              </span>
              <div className="flex items-center gap-3">
                <IconButton
                  label="Switch to voice prompt"
                  onClick={() => changeInputMode("speak")}
                >
                  <MicNoneOutlinedIcon />
                </IconButton>
                <IconButton
                  label="Switch to chat"
                  onClick={() => changeInputMode("chat")}
                >
                  <ChatBubbleOutlineIcon />
                </IconButton>
              </div>
            </header>

            <div className="flex flex-1 flex-col px-6 pb-6 lg:px-8 lg:pb-8">
              <div className="flex-1 overflow-hidden rounded-2xl border border-white/10 bg-black">
                <Excalidraw
                  excalidrawAPI={(api) => {
                    excalidrawAPIRef.current = api;
                  }}
                  theme="dark"
                  UIOptions={uiOptions}
                  className="h-full"
                  style={{ height: "100%", width: "100%" }}
                  renderTopRightUI={() => null}
                />
              </div>

              <div className="mt-4 space-y-1 text-sm">
                <p className={getFeedbackClasses(feedback.variant)}>
                  {feedback.message}
                </p>
                <p className="text-xs text-white/50">
                  {backendStatus.message ?? "Waiting for backend status."}
                </p>
                {lastSketch?.updatedAt && (
                  <p className="text-xs text-white/50">
                    Last saved {formatTimestamp(lastSketch.updatedAt)}
                  </p>
                )}
              </div>
            </div>
          </section>
        ) : inputMode === "speak" ? (
          <section className="flex flex-col bg-[#181818] lg:pr-12">
            <header className="flex items-center justify-between px-6 py-6 lg:px-8 lg:py-8">
              <span className="text-2xl font-semibold tracking-tight">
                FrameForge
              </span>
              <div className="flex items-center gap-3">
                <IconButton
                  label="Switch to sketching"
                  onClick={() => changeInputMode("sketch")}
                >
                  <DrawOutlinedIcon />
                </IconButton>
                <IconButton
                  label="Switch to chat"
                  onClick={() => changeInputMode("chat")}
                >
                  <ChatBubbleOutlineIcon />
                </IconButton>
              </div>
            </header>

            <div className="flex flex-1 flex-col px-6 pb-6 lg:px-8 lg:pb-8">
              <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-white/10 bg-black p-8">
                <div className="flex w-full max-w-xl flex-col items-center justify-center gap-6">
                  {/* Mic Status Indicator */}
                  <div className="flex flex-col items-center gap-3 w-full">
                    <div className="flex items-center gap-2">
                      <div className={`h-2.5 w-2.5 rounded-full transition-all ${
                        micStatus === "ready" ? "bg-green-500 animate-pulse shadow-lg shadow-green-500/50" :
                        micStatus === "checking" ? "bg-yellow-500 animate-pulse shadow-lg shadow-yellow-500/50" :
                        micStatus === "error" ? "bg-red-500 shadow-lg shadow-red-500/50" :
                        "bg-gray-500"
                      }`} />
                      <span className="text-xs font-medium text-white/70">
                        {micStatus === "ready" ? "Microphone ready" :
                         micStatus === "checking" ? "Checking microphone..." :
                         micStatus === "error" ? "Microphone error" :
                         "Initializing..."}
                      </span>
                    </div>
                    
                    {/* Microphone Selection Dropdown */}
                    {availableMicrophones.length > 0 && (
                      <div className="w-full max-w-xs">
                        <label className="block text-xs font-medium text-white/70 mb-1.5">
                          Select Microphone
                        </label>
                        <select
                          value={selectedMicrophoneId || ""}
                          onChange={(e) => {
                            setSelectedMicrophoneId(e.target.value);
                            // Re-check microphone access with new device
                            if (micStatus === "ready") {
                              setMicStatus("idle");
                              setTimeout(() => checkMicrophoneAccess(), 100);
                            }
                          }}
                          disabled={isRecording || micStatus === "checking"}
                          className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {availableMicrophones.map((mic) => (
                            <option key={mic.deviceId} value={mic.deviceId} className="bg-[#181818]">
                              {mic.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Audio Level Visualization */}
                  {micStatus === "ready" && (
                    <div className="flex w-full items-end justify-center gap-1 h-16">
                      {Array.from({ length: 20 }).map((_, i) => {
                        // Create a waveform pattern that responds to audio level
                        const center = 10;
                        const distanceFromCenter = Math.abs(i - center);
                        const wavePattern = 1 - (distanceFromCenter / center);
                        
                        const baseHeight = 4;
                        const maxHeight = 56;
                        const barHeight = isRecording
                          ? Math.max(baseHeight, baseHeight + (audioLevel * maxHeight * wavePattern))
                          : baseHeight + (audioLevel * 20 * wavePattern);
                        
                        const opacity = isRecording 
                          ? 0.7 + (audioLevel * 0.3)
                          : 0.4 + (audioLevel * 0.2);
                        
                        return (
                          <div
                            key={i}
                            className={`rounded-full transition-all duration-100 ${
                              isRecording && audioLevel > 0.2 
                                ? "bg-gradient-to-t from-blue-400 to-blue-500" 
                                : "bg-gradient-to-t from-blue-500 to-blue-600"
                            }`}
                            style={{
                              width: "4px",
                              height: `${barHeight}px`,
                              opacity: opacity,
                              boxShadow: isRecording && audioLevel > 0.3 
                                ? "0 0 6px rgba(96, 165, 250, 0.6)" 
                                : "none",
                            }}
                          />
                        );
                      })}
                    </div>
                  )}

                  {/* Main Recording Interface */}
                  {isProcessingVoice ? (
                    <div className="flex flex-col items-center justify-center gap-4">
                      <div className="relative">
                        <div className="h-20 w-20 animate-spin rounded-full border-4 border-white/10 border-t-blue-500" />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <MicNoneOutlinedIcon style={{ fontSize: 28, color: "#3b82f6" }} />
                        </div>
                      </div>
                      <div className="text-center space-y-1">
                        <p className="text-lg font-semibold text-white">Processing your voice...</p>
                        <p className="text-xs text-white/60">Transcribing and analyzing</p>
                      </div>
                    </div>
                  ) : isRecording ? (
                    <div className="flex flex-col items-center justify-center gap-5">
                      <button
                        type="button"
                        onClick={handleStopVoiceRecording}
                        className="group relative flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-red-600 to-red-700 text-white shadow-2xl shadow-red-500/30 transition-all hover:from-red-700 hover:to-red-800 hover:scale-105 active:scale-95"
                      >
                        <div className="h-10 w-10 rounded bg-white transition-transform group-hover:scale-110" />
                        <div className="absolute inset-0 rounded-full bg-red-400/20 animate-ping" />
                      </button>
                      <div className="text-center space-y-2">
                        <p className="text-xl font-semibold text-white">Recording...</p>
                        <p className="text-xs text-white/60">Click the button to stop</p>
                        {audioLevel > 0.1 && (
                          <div className="mt-3 flex items-center justify-center gap-2 rounded-full bg-green-500/20 px-3 py-1.5">
                            <div className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                            <p className="text-xs font-medium text-green-400">Microphone is picking up sound</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-5">
                      <button
                        type="button"
                        onClick={handleStartVoiceRecording}
                        disabled={!backendStatus.ready || micStatus !== "ready"}
                        className={`group relative flex h-28 w-28 items-center justify-center rounded-full text-white shadow-2xl transition-all ${
                          micStatus === "ready" && backendStatus.ready
                            ? "bg-gradient-to-br from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 hover:scale-105 active:scale-95 shadow-blue-500/30"
                            : "bg-gradient-to-br from-gray-600 to-gray-700 cursor-not-allowed opacity-50"
                        }`}
                      >
                        <MicNoneOutlinedIcon style={{ fontSize: 48 }} />
                        {micStatus === "ready" && backendStatus.ready && (
                          <div className="absolute inset-0 rounded-full bg-blue-400/20 animate-pulse" />
                        )}
                      </button>
                      <div className="text-center space-y-2 max-w-sm">
                        <p className="text-lg font-semibold text-white">
                          {micStatus === "ready" && backendStatus.ready
                            ? "Click to start recording"
                            : micStatus === "checking"
                            ? "Checking microphone access..."
                            : micStatus === "error"
                            ? "Microphone access denied"
                            : "Waiting for backend..."}
                        </p>
                        <p className="text-xs text-white/60">
                          {micStatus === "ready" && backendStatus.ready
                            ? "Speak clearly into your microphone"
                            : micStatus === "error"
                            ? "Please allow microphone access in your browser settings"
                            : "Preparing voice recording..."}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 space-y-1 text-sm">
                <p className={getFeedbackClasses(feedback.variant)}>
                  {feedback.message}
                </p>
                <p className="text-xs text-white/50">
                  {backendStatus.message ?? "Waiting for backend status."}
                </p>
                {lastSketch?.updatedAt && (
                  <p className="text-xs text-white/50">
                    Last saved {formatTimestamp(lastSketch.updatedAt)}
                  </p>
                )}
              </div>
            </div>
          </section>
        ) : inputMode === "chat" ? (
          <section className="flex flex-col bg-[#181818] lg:pr-12">
            <header className="flex items-center justify-between px-6 py-6 lg:px-8 lg:py-8">
              <span className="text-2xl font-semibold tracking-tight">
                FrameForge
              </span>
              <div className="flex items-center gap-3">
                <IconButton
                  label="Switch to sketching"
                  onClick={() => changeInputMode("sketch")}
                >
                  <DrawOutlinedIcon />
                </IconButton>
                <IconButton
                  label="Switch to voice prompt"
                  onClick={() => changeInputMode("speak")}
                >
                  <MicNoneOutlinedIcon />
                </IconButton>
              </div>
            </header>

            <div className="flex flex-1 flex-col px-6 pb-6 lg:px-8 lg:pb-8">
              <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-black">
                {/* Chat Messages Area */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {chatMessages.length === 0 ? (
                    <div className="text-sm text-white/50 text-center">
                      Chat with FrameForge to edit your canvas and generation
                    </div>
                  ) : (
                    chatMessages.map((msg) => {
                      const isEditing = editingMessageId === msg.id;
                      const canEdit = msg.role === "assistant" && hasCodeContent(msg.content);
                      
                      return (
                        <div
                          key={msg.id}
                          className={`flex ${
                            msg.role === "user" ? "justify-end" : "justify-start"
                          }`}
                        >
                          <div
                            className={`max-w-[80%] rounded-lg px-4 py-2 relative group ${
                              msg.role === "user"
                                ? "bg-blue-600 text-white"
                                : msg.role === "system"
                                ? "bg-rose-500/20 text-rose-400"
                                : "bg-white/10 text-white"
                            }`}
                          >
                            {isEditing ? (
                              <div className="space-y-2">
                                <textarea
                                  value={editedContent}
                                  onChange={(e) => setEditedContent(e.target.value)}
                                  className="w-full min-h-[200px] rounded-lg bg-black/50 border border-white/20 px-3 py-2 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === "Escape") {
                                      handleCancelEdit();
                                    }
                                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                      e.preventDefault();
                                      handleSaveEdit(msg.id, msg.content);
                                    }
                                  }}
                                />
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleSaveEdit(msg.id, msg.content)}
                                    className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 transition"
                                  >
                                    <CheckIcon style={{ fontSize: 16 }} />
                                    Save & Send
                                  </button>
                                  <button
                                    type="button"
                                    onClick={handleCancelEdit}
                                    className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20 transition"
                                  >
                                    <CloseIcon style={{ fontSize: 16 }} />
                                    Cancel
                                  </button>
                                  <span className="text-xs text-white/50 ml-auto">
                                    Cmd/Ctrl+Enter to save
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <>
                                <p className="text-sm whitespace-pre-wrap font-mono">
                                  {msg.content}
                                </p>
                                <div className="flex items-center justify-between mt-2">
                                  <p className="text-xs opacity-70">
                                    {new Date(msg.timestamp).toLocaleTimeString()}
                                  </p>
                                  {canEdit && (
                                    <button
                                      type="button"
                                      onClick={() => handleStartEdit(msg.id, msg.content)}
                                      className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-xs text-white/70 hover:text-white px-2 py-1 rounded hover:bg-white/10"
                                      title="Edit this message"
                                    >
                                      <EditIcon style={{ fontSize: 14 }} />
                                      Edit
                                    </button>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                  {isSendingChat && (
                    <div className="flex justify-start">
                      <div className="bg-white/10 text-white rounded-lg px-4 py-2">
                        <p className="text-sm">Thinking...</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Chat Input Area */}
                <div className="border-t border-white/10 p-4">
                  <div className="flex gap-2">
                    <input
                      ref={chatInputRef}
                      type="text"
                      placeholder="Type your message..."
                      className="flex-1 rounded-lg bg-white/5 border border-white/10 px-4 py-2 text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSendChatMessage();
                        }
                      }}
                      disabled={isSendingChat || !backendStatus.ready}
                    />
                    <button
                      type="button"
                      onClick={handleSendChatMessage}
                      disabled={isSendingChat || !backendStatus.ready}
                      className="rounded-lg bg-blue-600 px-6 py-2 text-white font-medium hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSendingChat ? "Sending..." : "Send"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-1 text-sm">
                <p className={getFeedbackClasses(feedback.variant)}>
                  {feedback.message}
                </p>
                <p className="text-xs text-white/50">
                  {backendStatus.message ?? "Waiting for backend status."}
                </p>
                {lastSketch?.updatedAt && (
                  <p className="text-xs text-white/50">
                    Last saved {formatTimestamp(lastSketch.updatedAt)}
                  </p>
                )}
              </div>
            </div>
          </section>
        ) : (
          <></>
        )}

        {/* Output Pane */}
        <section className="relative flex flex-col bg-[#d9d9d9] text-neutral-900 lg:border-l lg:border-neutral-400 lg:pl-12">
          <header className="flex items-center justify-between px-6 py-6 lg:px-8 lg:py-8">
            <h2 className="text-2xl font-semibold tracking-tight text-neutral-900">
              Live Preview
            </h2>
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-neutral-400 bg-white text-neutral-700 shadow-sm"
              title="Preview paused"
              disabled
            >
              <PauseOutlinedIcon />
            </button>
          </header>

          <div className="flex flex-1 flex-col px-6 pb-6 lg:px-8 lg:pb-8">
            <div className="flex flex-1 items-center justify-center rounded-2xl bg-white shadow-inner overflow-hidden">
              {generatedHTML ? (
                <iframe
                  srcDoc={generatedHTML}
                  className="w-full h-full border-0"
                  title="Generated UI Preview"
                  sandbox="allow-same-origin allow-scripts"
                />
              ) : (
                <div className="flex flex-col items-center gap-4">
                  <div className="flex items-center gap-3">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-neutral-400" />
                    <span className="h-2 w-2 animate-pulse rounded-full bg-neutral-400 delay-150" />
                    <span className="h-2 w-2 animate-pulse rounded-full bg-neutral-400 delay-300" />
                  </div>
                  <p className="text-sm text-neutral-500 text-center max-w-xs">
                    Draw a sketch and click Generate to create UI
                  </p>
                </div>
              )}
            </div>

            <p className="mt-4 text-sm text-neutral-600">
              {generatedHTML 
                ? "Generated UI preview. Click Generate again to update."
                : `Stored sketches: ${sketchCount}. Draw a sketch and click Generate to create UI.`}
            </p>
          </div>
        </section>

        <div className="pointer-events-none absolute left-1/2 top-1/2 z-[9998] flex -translate-x-1/2 -translate-y-1/2 items-center justify-center">
          {generateButton}
        </div>
      </div>
    </div>
  );
}
