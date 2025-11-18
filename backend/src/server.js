import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import {
  getSketch,
  listSketches,
  saveSketch,
  validateScenePayload,
} from "./sketchStore.js";

const app = express();
const port = process.env.PORT || 4000;
const openaiApiKey = process.env.OPENAI_API_KEY;
const openaiModel = process.env.OPENAI_RESPONSES_MODEL ?? "gpt-4o-2024-08-06";
const maxOutputTokensEnv = Number.parseInt(
  process.env.OPENAI_RESPONSES_MAX_TOKENS ?? "3200",
  10
);
const maxOutputTokens = Number.isFinite(maxOutputTokensEnv)
  ? Math.max(256, maxOutputTokensEnv)
  : 3200;

const extractJsonObject = (text) => {
  const start = text.indexOf("{");
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];

    if (isEscaped) {
      isEscaped = false;
      // eslint-disable-next-line no-continue
      continue;
    }

    if (char === "\\") {
      isEscaped = true;
      // eslint-disable-next-line no-continue
      continue;
    }

    if (char === '"') {
      inString = !inString;
      // eslint-disable-next-line no-continue
      continue;
    }

    if (inString) {
      // eslint-disable-next-line no-continue
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
};
const openai =
  openaiApiKey && openaiApiKey.trim().length > 0
    ? new OpenAI({
        apiKey: openaiApiKey,
      })
    : null;

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  })
);
app.use(
  express.json({
    limit: "12mb",
  })
);

app.get("/api/status", (_req, res) => {
  res.json({
    service: "FrameForge API",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.post("/api/generate-ui", async (req, res) => {
  if (!openai) {
    return res.status(500).json({
      error: "OpenAI API key is not configured on the server.",
    });
  }

  const { image, prompt = "" } = req.body ?? {};

  if (typeof image !== "string" || image.trim().length === 0) {
    return res.status(400).json({
      error: "Image data is required to generate the UI.",
    });
  }

  try {
    const imagePayload = image.trim();

    const basePrompt = [
      "You are a senior front-end engineer and design interpreter.",
      "Carefully analyze the provided wireframe image or sketch to understand its hierarchy, relationships, visual cues, and overall intent. Your task is to generate HTML, CSS, and JavaScript that render a web page visually and functionally as close as possible to the original design.",
      'Always respond with a single JSON object containing string fields "html", "css", and "js". Do not wrap the JSON in code fences and do not add any extra commentary or explanation.',
      "Your HTML should be semantic and accessible, avoiding <script> tags (except where necessary for required interactions) and not using inline event handlers. It must accurately reflect the spatial arrangement and content of the uploaded image, matching layout and appearance as closely as possible.",
      "Provide comprehensive, production-ready markup and styling—capture layout structure, typographic hierarchy, spacing, and visual accents so the generated page feels polished and complete.",
      "Choose copy that fits the context and purpose of the design (e.g., headings, labels, placeholders) and use ARIA roles only when they add clarity or improve accessibility.",
      "Your CSS should be well-scoped and efficient yet comprehensive enough to accurately recreate alignment, spacing, color, and visual hierarchy based on the image, without using external dependencies or frameworks.",
      "When the sketch includes stylized or non-rectilinear decorative elements (e.g., blobs, badges, lines, icons), represent them with inline SVG vectors rather than complex CSS tricks.",
      'If the sketch shows interactive elements (such as buttons or toggles), include minimal, unobtrusive, and accessible JavaScript in the "js" field; otherwise, leave "js" as an empty string.',
    ].join("\n");

    const promptSummary =
      prompt && prompt.trim().length ? prompt.trim() : "Not provided";
    const userInstructions = [
      "You are given a rough user sketch of a UI. Build a clean, accessible, responsive implementation.",
      "",
      "Inputs",
      "",
      `Sketch: ${promptSummary}`,
      "Purpose (if inferable from the sketch): determine from the sketch (dashboard | marketing | form | app | other).",
      "",
      "Requirements",
      "",
      "Infer purpose & hierarchy",
      "- Determine the interface type and align structure, component naming, and placeholder copy to that purpose.",
      "- Establish a clear information hierarchy and reading order based on sketch grouping and density.",
      "",
      "Semantic structure",
      "- Use semantic landmarks: <header>, <nav>, <main>, <aside>, <footer>.",
      "- Use appropriate elements for controls and content (headings, lists, section, article, form, label, input, button, table only when tabular).",
      "- Preserve relative positioning, sizing, and grouping from the sketch.",
      "",
      "Responsiveness",
      "- Implement a mobile-first layout.",
      "- Use CSS Grid for macro layout and Flexbox for internal alignment.",
      "- Provide at least two breakpoints (e.g., 640px and 1024px) that maintain the layout rhythm.",
      "",
      "Accessibility",
      "- Ensure every interactive element is keyboard accessible with visible focus styles.",
      "- Use label/for and matching id for form controls; apply aria-* attributes where appropriate (tabs, drawers, modals).",
      "- Provide alt text for images and aria-label for icon-only buttons.",
      "- Respect prefers-reduced-motion and prefers-color-scheme user settings.",
      "",
      "Styling system",
      "- No frameworks or external assets; include only authored styles.",
      "- Use CSS variables for tokens: --color-bg, --color-fg, --color-muted, --color-accent, --border, --focus, --space-1…--space-6, --radius, --font-sans, --text-xs…--text-3xl.",
      "- Maintain a calm, professional tone; use placeholders only when clearly implied.",
      "",
      "Class naming",
      "- Use a BEM-like scheme (e.g., card, card__header, btn, btn--primary).",
      "- Avoid generic class names such as box or row.",
      "",
      "Interactions (JS)",
      "- Implement minimal, robust JavaScript for any obvious controls (tabs, accordions, dropdowns, modals, validation, simple chart placeholders).",
      "- Manage ARIA state (aria-expanded) and focus (trap focus in modals).",
      "- Do not use external libraries or CDNs.",
      "",
      "Assumptions",
      "- When ambiguous, choose defaults that fit the inferred purpose.",
      "- Keep copy concise and neutral unless the sketch clearly signals marketing tone.",
      "",
      "Deliverable",
      '- Respond ONLY with valid JSON exactly matching {"html": "...","css": "...","js": "..."}.',
      "- html: document markup (head optional).",
      "- css: styles using the tokens, with responsive rules and focus styles.",
      "- js: plain modern JS wiring implied interactions (empty string if none).",
      "",
      "Validation checklist before returning",
      "- Semantic landmarks present; headings in logical order.",
      "- Keyboard navigation works; focus outline visible.",
      "- Mobile-first with at least two responsive breakpoints.",
      "- Grid and Flex reproduce the sketch grouping.",
      "- Class names descriptive and consistent; CSS variables used.",
      "- No external assets or libraries.",
      "- JSON is valid and contains only html, css, js keys.",
    ].join("\n");

    const combinedPrompt = userInstructions;

    const openAIRequest = {
      model: openaiModel,
      max_output_tokens: maxOutputTokens,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: basePrompt,
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: combinedPrompt,
            },
            {
              type: "input_image",
              image_url: imagePayload,
            },
          ],
        },
      ],
    };

    const response = await openai.responses.create(openAIRequest);

    // eslint-disable-next-line no-console
    console.debug(
      "generate-ui OpenAI response",
      JSON.stringify(response, null, 2)
    );

    if (response.status !== "completed") {
      const reason = response.incomplete_details?.reason;
      if (reason === "max_output_tokens") {
        throw new Error(
          `Model stopped after reaching the max output tokens limit (${maxOutputTokens}). ` +
            "Increase OPENAI_RESPONSES_MAX_TOKENS or choose a more capable model such as gpt-4o-2024-08-06."
        );
      }
      if (response.error?.message) {
        throw new Error(`Model error: ${response.error.message}`);
      }
      throw new Error(
        `Model response incomplete (status: ${response.status}).`
      );
    }

    const fallbackText = Array.isArray(response.output)
      ? response.output
          .flatMap((item) =>
            item?.type === "message" ? item.content ?? [] : []
          )
          .filter(
            (content) =>
              content?.type === "output_text" &&
              typeof content.text === "string"
          )
          .map((content) => content.text)
          .join("")
          .trim()
      : "";

    const rawOutput = (response.output_text ?? "").trim() || fallbackText;

    if (!rawOutput) {
      const refusal = Array.isArray(response.output)
        ? response.output
            .flatMap((item) =>
              item?.type === "message" ? item.content ?? [] : []
            )
            .find((content) => content?.type === "refusal")
        : null;
      if (refusal?.refusal) {
        throw new Error(`Model refusal: ${refusal.refusal}`);
      }
      throw new Error("Model returned an empty response.");
    }

    let candidate = rawOutput;
    if (candidate.includes("```")) {
      candidate = candidate
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();
    }

    let parsed;
    try {
      parsed = JSON.parse(candidate);
    } catch (initialError) {
      const extracted = extractJsonObject(candidate);
      if (!extracted) {
        throw new Error(
          `Unable to parse model response as JSON. ${initialError.message}`
        );
      }
      try {
        parsed = JSON.parse(extracted);
      } catch (fallbackError) {
        throw new Error(
          `Unable to parse model response as JSON. ${fallbackError.message}`
        );
      }
    }

    const { html, css, js = "" } = parsed ?? {};

    if (
      typeof html !== "string" ||
      typeof css !== "string" ||
      typeof js !== "string"
    ) {
      throw new Error(
        "Model response missing expected html/css/js string fields."
      );
    }

    res.json({
      html,
      css,
      js,
      model: openaiModel,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("generate-ui error", error);
    res.status(500).json({
      error: "Failed to generate UI from the provided sketch.",
      details: error.message,
    });
  }
});

app.post("/api/mockups", (req, res) => {
  const { prompt = "", sketches = [] } = req.body ?? {};

  res.json({
    prompt,
    sketches,
    html: '<section class="p-6">Mockup rendering placeholder</section>',
    metadata: {
      version: "0.1.0",
      notes: "Integrate with OpenAI APIs in future iterations.",
    },
  });
});

app.get("/api/sketches", async (_req, res) => {
  try {
    const sketches = await listSketches();
    res.json({ sketches });
  } catch (error) {
    res.status(500).json({
      error: "Failed to load sketches.",
      details: error.message,
    });
  }
});

app.get("/api/sketches/:id", async (req, res) => {
  try {
    const sketch = await getSketch(req.params.id);
    if (!sketch) {
      return res.status(404).json({ error: "Sketch not found." });
    }
    res.json({ sketch });
  } catch (error) {
    res.status(500).json({
      error: "Failed to load sketch.",
      details: error.message,
    });
  }
});

app.post("/api/sketches", async (req, res) => {
  const { title, scene } = req.body ?? {};

  try {
    const sanitizedScene = validateScenePayload(scene);
    const sketch = await saveSketch({
      title,
      scene: sanitizedScene,
    });

    res.status(201).json({
      sketch,
      message: "Sketch saved successfully.",
    });
  } catch (error) {
    if (error.message?.includes("Scene payload")) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({
      error: "Failed to save sketch.",
      details: error.message,
    });
  }
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`FrameForge API listening on http://localhost:${port}`);
});
