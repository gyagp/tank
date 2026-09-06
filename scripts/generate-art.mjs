import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const key = process.env.GOOGLE_API_KEY;
if (!key) throw new Error('Set GOOGLE_API_KEY in your environment before generating artwork.');
const model = process.env.GOOGLE_IMAGE_MODEL || 'gemini-3.1-flash-image';
const prompts = {
  'hangar-hero':
    'Use case: stylized-concept. Asset type: premium tank video game garage hero background, wide 16:9. A beautiful highly detailed olive green fictional compact battle tank, chunky angular armor, intricate worn metal tracks, long cannon, orange small markings, facing front-left, seen from an elevated three-quarter angle. Tank occupies the center-right 65 percent of the frame and sits on a dusty concrete desert outpost. Warm late-afternoon sun, dramatic atmospheric dust, distant hazy brutalist military structures, cinematic realistic 3D render, finely detailed materials, beautiful ambient occlusion. Left portion mostly soft hazy empty environment, plenty of negative space. Muted sage green, sand, warm charcoal and subtle rust orange palette. Sophisticated AAA indie game key art. No text, no writing, no logos, no watermark. Not an actual historical vehicle.',
  'map-desert':
    'Use case: stylized-concept. Asset type: game level selection card, cinematic wide 16:9. An abandoned desert military outpost seen at an elevated isometric angle, low sun, warm orange sand, battered concrete barriers, steel cargo containers, small ruined watchtower, dust in air. Beautiful realistic miniature 3D diorama, rich detail, atmospheric light, tactical tank arena layout. No text, no watermark, no interface.',
  'map-arctic':
    'Use case: stylized-concept. Asset type: game level selection card, cinematic wide 16:9. An arctic industrial military base seen at an elevated isometric angle at blue hour, powdery snow, ice blue steel containers, warm amber lights on bunkers, mountain silhouettes, mist. Beautiful realistic miniature 3D diorama, rich detail, atmospheric lighting, tactical tank arena layout. No text, no watermark, no interface.',
  'map-forest':
    'Use case: stylized-concept. Asset type: game level selection card, cinematic wide 16:9. Overgrown abandoned military ruins in a lush green valley seen at an elevated isometric angle, moss covered concrete barriers, weathered stone bunker, pines at edges, sunbeams through light mist. Beautiful realistic miniature 3D diorama, rich detail, atmospheric lighting, tactical tank arena layout. No text, no watermark, no interface.',
};
const selected = process.argv.slice(2);
const out = resolve('public/assets');
await mkdir(out, { recursive: true });
for (const [name, prompt] of Object.entries(prompts)) {
  if (selected.length && !selected.includes(name)) continue;
  console.log(`Generating ${name} with ${model}...`);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9' } },
      }),
      signal: AbortSignal.timeout(180000),
    },
  );
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      `Image generation failed (${response.status} / ${data.error?.status || 'unknown'}).`,
    );
  const part = data.candidates?.flatMap((c) => c.content?.parts || []).find((p) => p.inlineData);
  if (!part) throw new Error(`No image returned for ${name}.`);
  await sharp(Buffer.from(part.inlineData.data, 'base64'))
    .resize({ width: name === 'hangar-hero' ? 1920 : 960, withoutEnlargement: true })
    .webp({ quality: 88 })
    .toFile(resolve(out, `${name}.webp`));
  await writeFile(
    resolve(out, `${name}.json`),
    JSON.stringify(
      { provider: 'Google Gemini API', model, prompt, generated: new Date().toISOString() },
      null,
      2,
    ),
  );
  console.log(`Saved public/assets/${name}.webp`);
}
