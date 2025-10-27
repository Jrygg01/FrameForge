import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Excalidraw, serializeAsJSON } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

const KeyboardIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="h-5 w-5"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M7 10h.01M11 10h.01M15 10h.01M9 14h6" strokeLinecap="round" />
  </svg>
);

const MicIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="h-5 w-5"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <path
      d="M12 15a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3z"
      strokeLinecap="round"
    />
    <path d="M5 11a7 7 0 0 0 14 0" strokeLinecap="round" />
    <path d="M12 19v3" strokeLinecap="round" />
  </svg>
);

const PauseIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="h-5 w-5"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <rect x="8" y="6" width="3" height="12" rx="1" />
    <rect x="13" y="6" width="3" height="12" rx="1" />
  </svg>
);

const IconButton = ({ label, children }) => (
  <button
    type="button"
    className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[#1f1f1f] text-white transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
    aria-label={label}
    title={label}
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
    case 'success':
      return 'text-emerald-400';
    case 'error':
      return 'text-rose-400';
    case 'pending':
      return 'text-sky-400';
    default:
      return 'text-slate-400';
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
  const [sketchTitle] = useState('Homepage concept');
  const [feedback, setFeedback] = useState({
    variant: 'idle',
    message: 'Sketch first, then send it to the backend with Generate.'
  });
  const [isSaving, setIsSaving] = useState(false);
  const [lastSketch, setLastSketch] = useState(null);
  const [sketchCount, setSketchCount] = useState(0);
  const [backendStatus, setBackendStatus] = useState({
    ready: false,
    message: 'Checking backend connection...'
  });

  const uiOptions = useMemo(
    () => ({
      canvasActions: {
        changeViewBackgroundColor: true,
        clearCanvas: true,
        export: false,
        loadScene: false,
        saveAsImage: false,
        saveToActiveFile: false,
        toggleTheme: false
      },
      dockedToolbar: true
    }),
    []
  );

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const [statusRes, sketchesRes] = await Promise.all([
          fetch(`${API_BASE_URL}/api/status`).catch(() => null),
          fetch(`${API_BASE_URL}/api/sketches`).catch(() => null)
        ]);

        if (cancelled) {
          return;
        }

        if (statusRes?.ok) {
          const data = await statusRes.json();
          setBackendStatus({
            ready: true,
            message: `Backend online - ${data.service ?? 'FrameForge API'}`
          });
        } else {
          throw new Error('Backend unavailable');
        }

        if (sketchesRes?.ok) {
          const data = await sketchesRes.json();
          setSketchCount(Array.isArray(data.sketches) ? data.sketches.length : 0);
          if (data.sketches?.length) {
            setLastSketch(data.sketches[0]);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setBackendStatus({
            ready: false,
            message: 'Backend unavailable - start the API to enable saving.'
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
        variant: 'error',
        message: 'Canvas is not ready yet. Please wait a moment.'
      });
      return;
    }

    const elements = excalidrawAPIRef.current.getSceneElements();
    const hasDrawableElement = elements.some((element) => !element.isDeleted);

    if (!hasDrawableElement) {
      setFeedback({
        variant: 'error',
        message: 'Add at least one shape or stroke before generating.'
      });
      return;
    }

    setIsSaving(true);
    setFeedback({
      variant: 'pending',
      message: 'Uploading sketch data to the backend...'
    });

    try {
      const rawAppState = excalidrawAPIRef.current.getAppState();
      const files = excalidrawAPIRef.current.getFiles();
      const serialized = serializeAsJSON(
        elements,
        sanitizeAppState(rawAppState),
        files,
        'database'
      );

      const parsed = JSON.parse(serialized);
      const response = await fetch(`${API_BASE_URL}/api/sketches`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: sketchTitle,
          scene: {
            elements: parsed.elements ?? [],
            appState: parsed.appState ?? {},
            files: parsed.files ?? {}
          }
        })
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.error ?? 'Unable to save sketch.');
      }

      const payload = await response.json();
      setLastSketch(payload.sketch);
      setSketchCount((count) => count + 1);
      setFeedback({
        variant: 'success',
        message: 'Sketch stored! Preview integration will come later.'
      });
    } catch (error) {
      setFeedback({
        variant: 'error',
        message: error.message || 'Something went wrong while saving.'
      });
    } finally {
      setIsSaving(false);
    }
  }, [sketchTitle]);

  const generateButton = (
    <button
      type="button"
      onClick={handleGenerate}
      disabled={isSaving || !backendStatus.ready}
      className="pointer-events-auto z-[9999] flex h-12 items-center justify-center rounded-full bg-[#2563eb] px-8 text-xs font-semibold uppercase tracking-[0.3em] text-white shadow-lg transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:bg-[#3f4b6b]"
    >
      {isSaving ? 'Saving...' : 'Generate'}
    </button>
  );

  return (
    <div className="flex min-h-screen w-screen items-stretch bg-[#0f0f0f] text-white">
      <div className="relative grid h-screen w-full grid-cols-1 bg-black/40 lg:grid-cols-2">
        <section className="flex flex-col bg-[#181818] lg:pr-12">
          <header className="flex items-center justify-between px-6 py-6 lg:px-8 lg:py-8">
            <span className="text-2xl font-semibold tracking-tight">FrameForge</span>
            <div className="flex items-center gap-3">
              <IconButton label="Switch to keyboard prompt">
                <KeyboardIcon />
              </IconButton>
              <IconButton label="Switch to voice prompt">
                <MicIcon />
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
                style={{ height: '100%', width: '100%' }}
                renderTopRightUI={() => null}
              />
            </div>

            <div className="mt-4 space-y-1 text-sm">
              <p className={getFeedbackClasses(feedback.variant)}>{feedback.message}</p>
              <p className="text-xs text-white/50">
                {backendStatus.message ?? 'Waiting for backend status.'}
              </p>
              {lastSketch?.updatedAt && (
                <p className="text-xs text-white/50">
                  Last saved {formatTimestamp(lastSketch.updatedAt)}
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="relative flex flex-col bg-[#d9d9d9] text-neutral-900 lg:border-l lg:border-neutral-400 lg:pl-12">
          <header className="flex items-center justify-between px-6 py-6 lg:px-8 lg:py-8">
            <h2 className="text-2xl font-semibold tracking-tight text-neutral-900">Live Preview</h2>
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-neutral-400 bg-white text-neutral-700 shadow-sm"
              title="Preview paused"
              disabled
            >
              <PauseIcon />
            </button>
          </header>

          <div className="flex flex-1 flex-col px-6 pb-6 lg:px-8 lg:pb-8">
            <div className="flex flex-1 items-center justify-center rounded-2xl bg-white shadow-inner">
              <div className="flex items-center gap-3">
                <span className="h-2 w-2 animate-pulse rounded-full bg-neutral-400" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-neutral-400 delay-150" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-neutral-400 delay-300" />
              </div>
            </div>

            <p className="mt-4 text-sm text-neutral-600">
              Stored sketches: {sketchCount}. Preview rendering is intentionally paused.
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
