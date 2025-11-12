import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Excalidraw, exportToBlob } from '@excalidraw/excalidraw';
import DOMPurify from 'dompurify';
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

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Unable to read sketch image data.'));
      }
    };
    reader.onerror = () => reject(new Error('Unable to read sketch image data.'));
    reader.readAsDataURL(blob);
  });

export default function App() {
  const excalidrawAPIRef = useRef(null);
  const [sketchTitle] = useState('Homepage concept');
  const [feedback, setFeedback] = useState({
    variant: 'idle',
    message: 'Sketch your interface, then click Generate to translate it into HTML.'
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewCount, setPreviewCount] = useState(0);
  const [previewSrcDoc, setPreviewSrcDoc] = useState('');
  const [modelUsed, setModelUsed] = useState('');
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

    const verifyBackend = async () => {
      try {
        const statusRes = await fetch(`${API_BASE_URL}/api/status`);
        if (!statusRes.ok) {
          throw new Error('Backend unavailable');
        }

        if (cancelled) {
          return;
        }

        const data = await statusRes.json();
        setBackendStatus({
          ready: true,
          message: `Backend online - ${data.service ?? 'FrameForge API'}`
        });
      } catch (error) {
        if (!cancelled) {
          setBackendStatus({
            ready: false,
            message: 'Backend unavailable - start the API to enable generation.'
          });
        }
      }
    };

    verifyBackend();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleGenerate = useCallback(async () => {
    const api = excalidrawAPIRef.current;
    if (!api) {
      setFeedback({
        variant: 'error',
        message: 'Canvas is not ready yet. Please wait a moment.'
      });
      return;
    }

    const elements = api.getSceneElements()?.filter((element) => !element.isDeleted) ?? [];

    if (!elements.length) {
      setFeedback({
        variant: 'error',
        message: 'Add at least one shape or stroke before generating.'
      });
      return;
    }

    setIsGenerating(true);
    setFeedback({
      variant: 'pending',
      message: 'Generating HTML preview from your sketch...'
    });

    try {
      const appState = api.getAppState();
      const files = api.getFiles();

      const sketchBlob = await exportToBlob({
        elements,
        appState: {
          ...appState,
          exportBackground: true,
          exportWithDarkMode: false,
          viewBackgroundColor: '#ffffff'
        },
        files,
        mimeType: 'image/png'
      });

      const imageDataUrl = await blobToDataUrl(sketchBlob);

      const response = await fetch(`${API_BASE_URL}/api/generate-ui`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          image: imageDataUrl,
          prompt: `The sketch is titled "${sketchTitle}". Produce semantic, accessible HTML that reflects the layout.`
        })
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.error ?? 'Unable to generate UI.');
      }

      const payload = await response.json();
      const sanitizedHtml = DOMPurify.sanitize(payload.html ?? '', {
        USE_PROFILES: { html: true }
      });
      const sanitizedCss = DOMPurify.sanitize(payload.css ?? '', {
        ALLOWED_TAGS: [],
        ALLOWED_ATTR: []
      });
      const sanitizedJs = DOMPurify.sanitize(payload.js ?? '', {
        ALLOWED_TAGS: [],
        ALLOWED_ATTR: []
      });

      const scriptFragment = sanitizedJs.trim()
        ? `<script type="module">\n${sanitizedJs}\n</script>`
        : '';

      const doc = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /><style>${sanitizedCss}</style></head><body>${sanitizedHtml}${scriptFragment}</body></html>`;

      setPreviewSrcDoc(doc);
      setModelUsed(payload.model ?? '');
      setPreviewCount((count) => count + 1);
      setFeedback({
        variant: 'success',
        message: 'Preview updated with the generated HTML mockup.'
      });
    } catch (error) {
      setFeedback({
        variant: 'error',
        message: error?.message ?? 'Something went wrong while generating the preview.'
      });
    } finally {
      setIsGenerating(false);
    }
  }, [sketchTitle]);

  const generateButton = (
    <button
      type="button"
      onClick={handleGenerate}
      disabled={isGenerating || !backendStatus.ready}
      className="pointer-events-auto z-[9999] flex h-12 items-center justify-center rounded-full bg-[#2563eb] px-8 text-xs font-semibold uppercase tracking-[0.3em] text-white shadow-lg transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:bg-[#3f4b6b]"
    >
      {isGenerating ? 'Generating...' : 'Generate'}
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
            <div className="flex flex-1 overflow-hidden rounded-2xl bg-white shadow-inner">
              {previewSrcDoc ? (
                <iframe
                  title="Generated UI preview"
                  className="h-full w-full border-0"
                  srcDoc={previewSrcDoc}
                  sandbox="allow-scripts allow-forms allow-pointer-lock allow-popups allow-same-origin"
                />
              ) : (
                <div className="flex flex-1 items-center justify-center text-center text-neutral-500">
                  <div className="mx-auto max-w-sm space-y-2">
                    <p className="text-base font-semibold text-neutral-700">No preview yet</p>
                    <p className="text-sm">
                      Sketch a layout on the canvas and press Generate to turn it into HTML.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <p className="mt-4 text-sm text-neutral-600">
              {backendStatus.ready
                ? previewCount
                  ? `Generated previews: ${previewCount}${modelUsed ? ` - Model: ${modelUsed}` : ''}`
                  : 'Ready to generate your first preview.'
                : 'Backend offline. Start the API to enable preview generation.'}
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
