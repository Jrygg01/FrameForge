import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const SKETCHES_DIR = path.resolve(process.cwd(), 'sketches');

const ensureSketchDir = async () => {
  try {
    await fs.mkdir(SKETCHES_DIR, { recursive: true });
  } catch (error) {
    // Ignore existing directory errors.
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
};

const sanitizeTitle = (title) => {
  if (typeof title !== 'string') {
    return 'Untitled Sketch';
  }
  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : 'Untitled Sketch';
};

export const validateScenePayload = (scene = {}) => {
  const { elements, appState, files } = scene;

  if (!Array.isArray(elements)) {
    throw new Error('Scene payload requires an array of elements.');
  }

  if (appState && typeof appState !== 'object') {
    throw new Error('Scene payload appState must be an object if provided.');
  }

  if (files && typeof files !== 'object') {
    throw new Error('Scene payload files must be an object if provided.');
  }

  return {
    elements,
    appState: appState ?? {},
    files: files ?? {}
  };
};

export const saveSketch = async ({ title, scene }) => {
  await ensureSketchDir();

  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const sketch = {
    id,
    title: sanitizeTitle(title),
    createdAt: timestamp,
    updatedAt: timestamp,
    scene: validateScenePayload(scene)
  };

  const filePath = path.join(SKETCHES_DIR, `${id}.json`);
  await fs.writeFile(filePath, JSON.stringify(sketch, null, 2), 'utf8');

  return sketch;
};

export const getSketch = async (id) => {
  await ensureSketchDir();

  const filePath = path.join(SKETCHES_DIR, `${id}.json`);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
};

export const listSketches = async () => {
  await ensureSketchDir();

  const files = await fs.readdir(SKETCHES_DIR, { withFileTypes: true });
  const sketches = [];

  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith('.json')) {
      continue;
    }
    const filePath = path.join(SKETCHES_DIR, file.name);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      sketches.push({
        id: parsed.id ?? file.name.replace(/\.json$/, ''),
        title: parsed.title ?? 'Untitled Sketch',
        createdAt: parsed.createdAt,
        updatedAt: parsed.updatedAt
      });
    } catch (error) {
      // Skip malformed files but continue processing the rest.
      // eslint-disable-next-line no-console
      console.warn(`Skipping invalid sketch file: ${file.name}`, error);
    }
  }

  // Sort by newest first.
  sketches.sort((a, b) => {
    const resolveTimestamp = (value) => {
      const parsed = Date.parse(value ?? '');
      return Number.isNaN(parsed) ? 0 : parsed;
    };
    const bTime = resolveTimestamp(b.updatedAt ?? b.createdAt);
    const aTime = resolveTimestamp(a.updatedAt ?? a.createdAt);
    return bTime - aTime;
  });

  return sketches;
};
