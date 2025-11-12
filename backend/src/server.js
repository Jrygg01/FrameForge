import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import {
  getSketch,
  listSketches,
  saveSketch,
  validateScenePayload
} from './sketchStore.js';

const app = express();
const port = process.env.PORT || 4000;

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173'
  })
);
app.use(express.json());

app.get('/api/status', (_req, res) => {
  res.json({
    service: 'FrameForge API',
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

app.post('/api/mockups', (req, res) => {
  const { prompt = '', sketches = [] } = req.body ?? {};

  res.json({
    prompt,
    sketches,
    html: '<section class="p-6">Mockup rendering placeholder</section>',
    metadata: {
      version: '0.1.0',
      notes: 'Integrate with OpenAI APIs in future iterations.'
    }
  });
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

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`FrameForge API listening on http://localhost:${port}`);
});
