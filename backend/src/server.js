import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  getSketch,
  listSketches,
  saveSketch,
  validateScenePayload
} from './sketchStore.js';

// Initialize OpenAI client
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const app = express();
const port = process.env.PORT || 4000;

// CORS configuration
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      console.log('CORS: Request with no origin, allowing');
      return callback(null, true);
    }
    
    const allowedOrigins = [
      process.env.CLIENT_ORIGIN || 'http://localhost:5173',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:3000',
      'http://127.0.0.1:3000'
    ];
    
    console.log(`CORS: Checking origin: ${origin}`);
    
    if (allowedOrigins.includes(origin)) {
      console.log(`CORS: Origin ${origin} allowed`);
      callback(null, true);
    } else {
      console.warn(`CORS: Origin ${origin} not in allowed list:`, allowedOrigins);
      // For development, be more permissive - allow any localhost origin
      if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
        console.log(`CORS: Allowing localhost origin: ${origin}`);
        callback(null, true);
      } else {
        callback(new Error(`Not allowed by CORS. Origin: ${origin}`));
      }
    }
  },
  credentials: false, // Set to false since we're not using credentials
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  exposedHeaders: ['Content-Type'],
  maxAge: 86400 // 24 hours
};

app.use(cors(corsOptions));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  console.log(`  Origin: ${req.headers.origin || 'none'}`);
  console.log(`  Content-Type: ${req.headers['content-type'] || 'none'}`);
  next();
});

// Increase body size limits for large sketch data
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Root route - API information
app.get('/', (_req, res) => {
  res.json({
    service: 'FrameForge API',
    version: '0.1.0',
    status: 'running',
    endpoints: {
      status: 'GET /api/status',
      sketches: {
        list: 'GET /api/sketches',
        get: 'GET /api/sketches/:id',
        create: 'POST /api/sketches'
      },
      mockups: 'POST /api/mockups',
      chat: 'POST /api/chat',
      voice: 'POST /api/voice'
    },
    timestamp: new Date().toISOString()
  });
});

app.get('/api/status', (_req, res) => {
  console.log(`GET /api/status - Origin: ${_req.headers.origin || 'none'}`);
  res.json({
    service: 'FrameForge API',
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

app.post('/api/mockups', async (req, res) => {
  console.log(`POST /api/mockups - Origin: ${req.headers.origin || 'none'}`);
  const { prompt = '', sketches = [] } = req.body ?? {};

  try {
    console.log('Request body received:', {
      promptLength: prompt?.length || 0,
      sketchesCount: sketches?.length || 0,
      firstSketchElements: sketches[0]?.elements?.length || 0
    });

    // Check if OpenAI is configured
    if (!openai) {
      console.warn('OpenAI client not initialized');
      return res.json({
        prompt,
        sketches,
        html: '<section class="p-6"><p class="text-gray-600">OpenAI API key not configured. Please set OPENAI_API_KEY in your .env file.</p></section>',
        metadata: {
          version: '0.1.0',
          warning: 'OpenAI not configured'
        }
      });
    }

    // Extract sketch information
    const sketchInfo = sketches.length > 0 
      ? `Sketch Title: ${sketches[0].title || 'Untitled'}\nNumber of elements: ${sketches[0].elements?.length || 0}`
      : 'No sketch provided';

    // Build prompt for OpenAI
    const systemPrompt = `You are an expert frontend developer specializing in creating modern, responsive HTML/CSS interfaces. 
Generate clean, semantic HTML with Tailwind CSS classes. 
Create complete, standalone HTML documents that are ready to render.
Use modern design principles: clean layouts, proper spacing, good typography, and responsive design.
Include all necessary styles inline or in a <style> tag.`;

    const userPrompt = `${prompt || 'Generate a modern UI interface'}

${sketchInfo}

Please generate a complete HTML document with embedded CSS (using Tailwind CSS CDN or inline styles) that represents a modern, clean interface. 
Make it visually appealing and functional. Include:
- Proper HTML5 structure
- Modern, clean design
- Responsive layout
- Good use of whitespace
- Professional styling

Return ONLY the HTML code, no markdown formatting or code blocks.`;

    // Call OpenAI API
    console.log('Calling OpenAI API...');
    let completion;
    try {
      completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 2000
      });
      console.log('OpenAI API call successful');
    } catch (openaiError) {
      console.error('OpenAI API error:', openaiError);
      throw new Error(`OpenAI API error: ${openaiError.message}`);
    }

    let html = completion.choices[0]?.message?.content || '<section class="p-6"><p>Failed to generate UI.</p></section>';
    
    // Clean up the response (remove markdown code blocks if present)
    html = html.replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();
    
    // Ensure it's a complete HTML document
    if (!html.includes('<!DOCTYPE') && !html.includes('<html')) {
      html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Generated UI</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  </style>
</head>
<body>
${html}
</body>
</html>`;
    }

    res.json({
      prompt,
      sketches,
      html,
      metadata: {
        version: '0.1.0',
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Mockup generation error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      error: 'Failed to generate mockup.',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

app.get('/api/sketches', async (_req, res) => {
  try {
    const sketches = await listSketches();
    res.json({ sketches });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to load sketches.',
      details: error.message
    });
  }
});

app.get('/api/sketches/:id', async (req, res) => {
  try {
    const sketch = await getSketch(req.params.id);
    if (!sketch) {
      return res.status(404).json({ error: 'Sketch not found.' });
    }
    res.json({ sketch });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to load sketch.',
      details: error.message
    });
  }
});

app.post('/api/sketches', async (req, res) => {
  const { title, scene } = req.body ?? {};

  try {
    const sanitizedScene = validateScenePayload(scene);
    const sketch = await saveSketch({
      title,
      scene: sanitizedScene
    });

    res.status(201).json({
      sketch,
      message: 'Sketch saved successfully.'
    });
  } catch (error) {
    if (error.message?.includes('Scene payload')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({
      error: 'Failed to save sketch.',
      details: error.message
    });
  }
});

// Chat endpoint - handles text-based chat messages and HTML modifications
app.post('/api/chat', async (req, res) => {
  const { message, sessionId, context } = req.body ?? {};
  const { currentHTML } = context || {};

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({
      error: 'Message is required and must be a non-empty string.'
    });
  }

  try {
    // Check if OpenAI is configured
    if (!openai) {
      return res.json({
        message: `Received your message: "${message}". OpenAI API key not configured. Please set OPENAI_API_KEY in your .env file.`,
        sessionId: sessionId || `session-${Date.now()}`,
        timestamp: new Date().toISOString(),
        context: context || {},
        warning: 'OpenAI not configured'
      });
    }

    // If we have current HTML, prioritize HTML modifications over Excalidraw
    // Only treat as non-modification if explicitly asking about Excalidraw or sketching
    const isExcalidrawRequest = message.toLowerCase().includes('excalidraw') ||
                                 message.toLowerCase().includes('canvas') ||
                                 message.toLowerCase().includes('sketch') ||
                                 message.toLowerCase().includes('draw');
    
    // If HTML exists and it's not explicitly about Excalidraw, treat as HTML modification request
    const isModificationRequest = currentHTML && !isExcalidrawRequest;

    // Build system prompt for FrameForge context
    let systemPrompt;
    let forceHTMLResponse = false;
    
    if (isModificationRequest && currentHTML) {
      forceHTMLResponse = true;
      systemPrompt = `You are FrameForge, an AI assistant that modifies HTML/CSS interfaces.

USER REQUEST: "${message}"

CRITICAL: You MUST return the complete, updated HTML code. Do NOT provide text explanations or guidance.

REQUIREMENTS:
1. Return ONLY the complete HTML document code
2. NO markdown code blocks (no \`\`\`html or \`\`\`)
3. NO explanatory text before or after the HTML
4. Include the FULL HTML structure (<!DOCTYPE html><html>...</html>)
5. Include Tailwind CSS CDN: <script src="https://cdn.tailwindcss.com"></script>
6. Make the requested changes to the HTML
7. Preserve the overall structure and layout

Current HTML to modify:
${currentHTML.substring(0, 8000)}${currentHTML.length > 8000 ? '... (truncated)' : ''}

Return ONLY the updated HTML code starting with <!DOCTYPE html> or <html>.`;
    } else if (currentHTML && !isExcalidrawRequest) {
      // Even if not explicitly a modification request, if HTML exists, default to HTML context
      forceHTMLResponse = true;
      systemPrompt = `You are FrameForge, an AI assistant that modifies HTML/CSS interfaces.

USER REQUEST: "${message}"

The user has a generated HTML interface. When they request ANY changes (colors, sizes, styles, layout, etc.), you MUST return the complete updated HTML code.

REQUIREMENTS:
1. Return ONLY the complete HTML document code
2. NO markdown code blocks
3. NO explanatory text
4. Include FULL HTML structure
5. Include Tailwind CSS CDN: <script src="https://cdn.tailwindcss.com"></script>
6. Make the requested changes

Current HTML:
${currentHTML.substring(0, 8000)}${currentHTML.length > 8000 ? '... (truncated)' : ''}

Return ONLY the updated HTML code.`;
    } else {
      systemPrompt = `You are FrameForge, an AI assistant that helps users create and edit UI mockups and designs. 
You can help users:
- Modify generated HTML/mockup outputs
- Provide design suggestions and feedback
- Answer questions about the design process

Be concise, helpful, and focused on design-related tasks.`;
    }

    // Call OpenAI API
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ],
      temperature: 0.7,
      max_tokens: forceHTMLResponse ? 4000 : 500
    });

    let aiResponse = completion.choices[0]?.message?.content || 'I apologize, but I could not generate a response.';

    console.log('Chat response type:', forceHTMLResponse ? 'FORCED HTML' : 'TEXT');
    console.log('Response preview:', aiResponse.substring(0, 200));

    // Check if the response looks like HTML
    const looksLikeHTML = aiResponse.trim().startsWith('<!DOCTYPE') || 
                         aiResponse.trim().startsWith('<html') ||
                         (aiResponse.includes('<') && aiResponse.includes('>') && aiResponse.length > 100);

    // If we have HTML context and got HTML back (or it's a modification request), return it
    // Also check if the response contains HTML tags even if it starts with text
    let containsHTML = looksLikeHTML || 
                         (aiResponse.includes('<div') && aiResponse.includes('</div>')) ||
                         (aiResponse.includes('<body') || aiResponse.includes('<section') || aiResponse.includes('<main')) ||
                         (aiResponse.includes('<head') && aiResponse.includes('</head>'));

    // If we're forcing HTML response but didn't get HTML, try to extract it or regenerate
    if (forceHTMLResponse && !containsHTML) {
      console.warn('Expected HTML but got text response. Attempting to extract HTML or regenerate...');
      // Try one more time with even more explicit instructions
      const retryPrompt = `${systemPrompt}\n\nIMPORTANT: The previous response was not HTML. You MUST return HTML code only. Start with <!DOCTYPE html> or <html>.`;
      try {
        const retryCompletion = await openai.chat.completions.create({
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: retryPrompt },
            { role: 'user', content: message }
          ],
          temperature: 0.3, // Lower temperature for more consistent HTML output
          max_tokens: 4000
        });
        const retryResponse = retryCompletion.choices[0]?.message?.content || '';
        if (retryResponse.trim().startsWith('<!DOCTYPE') || retryResponse.trim().startsWith('<html') || 
            (retryResponse.includes('<div') && retryResponse.includes('</div>'))) {
          console.log('Retry successful, got HTML');
          // Use the retry response
          aiResponse = retryResponse.replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();
          containsHTML = true;
        }
      } catch (retryError) {
        console.error('Retry failed:', retryError);
      }
    }

    // If it's a modification request and we got HTML back, return it
    // OR if we have currentHTML and the response contains HTML, treat it as an update
    if ((forceHTMLResponse && containsHTML) || (isModificationRequest && containsHTML) || (currentHTML && containsHTML && !isExcalidrawRequest)) {
      // Clean up the HTML (remove markdown code blocks if present)
      let cleanedHTML = aiResponse.replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();
      
      // Ensure it's a complete HTML document
      if (!cleanedHTML.includes('<!DOCTYPE') && !cleanedHTML.includes('<html')) {
        cleanedHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Updated UI</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  </style>
</head>
<body>
${cleanedHTML}
</body>
</html>`;
      }

      return res.json({
        message: 'HTML has been updated based on your request.',
        html: cleanedHTML,
        sessionId: sessionId || `session-${Date.now()}`,
        timestamp: new Date().toISOString(),
        context: context || {}
      });
    }

    // Otherwise, return the text response
    res.json({
      message: aiResponse,
      sessionId: sessionId || `session-${Date.now()}`,
      timestamp: new Date().toISOString(),
      context: context || {}
    });
  } catch (error) {
    console.error('Chat API error:', error);
    res.status(500).json({
      error: 'Failed to process chat message.',
      details: error.message
    });
  }
});

// Voice endpoint - handles voice recordings (audio data)
app.post('/api/voice', async (req, res) => {
  const { audio, format = 'webm', sessionId, context } = req.body ?? {};
  const { currentHTML } = context || {};

  if (!audio) {
    return res.status(400).json({
      error: 'Audio data is required.'
    });
  }

  try {
    // Check if OpenAI is configured
    if (!openai) {
      return res.json({
        transcript: 'OpenAI API key not configured. Please set OPENAI_API_KEY in your .env file.',
        message: 'Voice processing requires OpenAI API key.',
        sessionId: sessionId || `session-${Date.now()}`,
        timestamp: new Date().toISOString(),
        format,
        context: context || {},
        warning: 'OpenAI not configured'
      });
    }

    // Convert base64 audio to buffer
    const audioBuffer = Buffer.from(audio, 'base64');
    
    // Create a temporary file for the audio (OpenAI Whisper requires a file)
    const tempFilePath = join(tmpdir(), `audio-${Date.now()}.${format}`);
    fs.writeFileSync(tempFilePath, audioBuffer);
    
    try {
      // Create a File object for OpenAI Whisper API
      // In Node.js 18+, File API is available globally
      let audioFile;
      if (typeof File !== 'undefined') {
        // Use native File API if available (Node.js 18+)
        audioFile = new File([audioBuffer], `audio.${format}`, {
          type: `audio/${format}`
        });
      } else {
        // Fallback: use ReadStream with filename
        audioFile = fs.createReadStream(tempFilePath);
        audioFile.name = `audio.${format}`;
      }
      
      // Transcribe audio using OpenAI Whisper
      const transcription = await openai.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-1',
        language: 'en' // Optional: specify language for better accuracy
      });

      const transcript = transcription.text || '';

      // If we have current HTML, prioritize HTML modifications over Excalidraw
      // Only treat as non-modification if explicitly asking about Excalidraw or sketching
      const isExcalidrawRequest = transcript.toLowerCase().includes('excalidraw') ||
                                   transcript.toLowerCase().includes('canvas') ||
                                   transcript.toLowerCase().includes('sketch') ||
                                   transcript.toLowerCase().includes('draw');
      
      // If HTML exists and it's not explicitly about Excalidraw, treat as HTML modification request
      const isModificationRequest = currentHTML && !isExcalidrawRequest;

      // Build system prompt for FrameForge context
      let systemPrompt;
      if (isModificationRequest && currentHTML) {
        systemPrompt = `You are FrameForge, an AI assistant that helps users modify HTML/CSS interfaces.
The user has a generated HTML interface displayed in the preview pane and wants to make changes to it.

CRITICAL INSTRUCTIONS:
- The user is asking you to modify the HTML/CSS interface, NOT the Excalidraw canvas
- You MUST return the complete, updated HTML code
- Do NOT mention Excalidraw, canvas, or sketching
- Do NOT include any markdown code blocks (no \`\`\`html or \`\`\`)
- Return the FULL HTML document with all necessary structure
- Make the requested changes while preserving the overall structure
- Include Tailwind CSS CDN link if not present: <script src="https://cdn.tailwindcss.com"></script>
- Ensure the HTML is valid and complete
- If the user asks a question, you can answer it, but if they request ANY visual change, return updated HTML

Current HTML to modify:
${currentHTML.substring(0, 8000)}${currentHTML.length > 8000 ? '... (truncated)' : ''}

Remember: Return ONLY the HTML code, no explanations before or after the HTML.`;
      } else if (currentHTML && !isExcalidrawRequest) {
        // Even if not explicitly a modification request, if HTML exists, default to HTML context
        systemPrompt = `You are FrameForge, an AI assistant that helps users modify HTML/CSS interfaces.
The user has a generated HTML interface displayed in the preview pane.

When the user requests changes or asks questions about the interface, you should modify the HTML.
If they ask a question, answer it, but if they request visual changes, return the updated HTML code.

Current HTML:
${currentHTML.substring(0, 8000)}${currentHTML.length > 8000 ? '... (truncated)' : ''}`;
      } else {
        systemPrompt = `You are FrameForge, an AI assistant that helps users create and edit UI mockups and designs. 
You can help users:
- Modify generated HTML/mockup outputs
- Provide design suggestions and feedback
- Answer questions about the design process

Be concise, helpful, and focused on design-related tasks.`;
      }

      // Get AI response based on the transcript
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: transcript }
        ],
        temperature: 0.7,
        max_tokens: isModificationRequest ? 4000 : 500
      });

      const aiResponse = completion.choices[0]?.message?.content || 'I apologize, but I could not generate a response.';

      // Check if the response looks like HTML
      const looksLikeHTML = aiResponse.trim().startsWith('<!DOCTYPE') || 
                           aiResponse.trim().startsWith('<html') ||
                           (aiResponse.includes('<') && aiResponse.includes('>') && aiResponse.length > 100);

      // Also check if the response contains HTML tags even if it starts with text
      const containsHTML = looksLikeHTML || 
                           (aiResponse.includes('<div') && aiResponse.includes('</div>')) ||
                           (aiResponse.includes('<body') || aiResponse.includes('<section') || aiResponse.includes('<main'));

      // If it's a modification request and we got HTML back, return it
      // OR if we have currentHTML and the response contains HTML, treat it as an update
      if ((isModificationRequest && containsHTML) || (currentHTML && containsHTML && !isExcalidrawRequest)) {
        // Clean up the HTML (remove markdown code blocks if present)
        let cleanedHTML = aiResponse.replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();
        
        // Ensure it's a complete HTML document
        if (!cleanedHTML.includes('<!DOCTYPE') && !cleanedHTML.includes('<html')) {
          cleanedHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Updated UI</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  </style>
</head>
<body>
${cleanedHTML}
</body>
</html>`;
        }

        return res.json({
          transcript,
          message: 'HTML has been updated based on your voice request.',
          html: cleanedHTML,
          sessionId: sessionId || `session-${Date.now()}`,
          timestamp: new Date().toISOString(),
          format,
          context: context || {}
        });
      }

      res.json({
        transcript,
        message: aiResponse,
        sessionId: sessionId || `session-${Date.now()}`,
        timestamp: new Date().toISOString(),
        format,
        context: context || {}
      });
    } finally {
      // Clean up temporary file
      try {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      } catch (cleanupError) {
        console.error('Failed to clean up temp file:', cleanupError);
      }
    }
  } catch (error) {
    console.error('Voice API error:', error);
    res.status(500).json({
      error: 'Failed to process voice recording.',
      details: error.message
    });
  }
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`FrameForge API listening on http://localhost:${port}`);
});
