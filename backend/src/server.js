import 'dotenv/config';
import express from 'express';
import cors from 'cors';

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

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`FrameForge API listening on http://localhost:${port}`);
});
