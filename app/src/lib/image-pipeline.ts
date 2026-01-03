import * as fs from 'fs';
import * as path from 'path';

const STYLE_REFS_DIR = path.join(process.cwd(), 'public', 'style-refs');

/**
 * Load style reference images as base64 encoded strings
 * Returns array of { base64: string, mimeType: string }
 */
export function loadStyleReferences(): { base64: string; mimeType: string }[] {
    const styleImages: { base64: string; mimeType: string }[] = [];

    try {
        const files = fs.readdirSync(STYLE_REFS_DIR)
            .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
            .slice(0, 5); // Max 5 images

        for (const file of files) {
            const filePath = path.join(STYLE_REFS_DIR, file);
            const buffer = fs.readFileSync(filePath);
            const base64 = buffer.toString('base64');
            const ext = path.extname(file).toLowerCase();
            const mimeType = ext === '.png' ? 'image/png' :
                ext === '.webp' ? 'image/webp' : 'image/jpeg';

            styleImages.push({ base64, mimeType });
        }

        console.log(`Loaded ${styleImages.length} style reference images`);
    } catch (error) {
        console.error('Error loading style references:', error);
    }

    return styleImages;
}

/**
 * Build multimodal content array for Gemini request
 * Combines text prompt with image references
 */
export function buildMultimodalContent(
    prompt: string,
    styleImages: { base64: string; mimeType: string }[]
): unknown[] {
    const content: unknown[] = [];

    // Add style reference images first
    for (const img of styleImages) {
        content.push({
            type: 'image_url',
            image_url: {
                url: `data:${img.mimeType};base64,${img.base64}`
            }
        });
    }

    // Add the text prompt last
    content.push({
        type: 'text',
        text: prompt
    });

    return content;
}

/**
 * Generate a creative prompt using the Art Director approach
 * Uses metaphorical thinking and structured Lo-Fi editorial output
 */
export async function generateCreativePrompt(
    storyText: string,
    apiKey: string
): Promise<string> {
    const artDirectorSystemPrompt = `Role: You are an Avant-Garde Art Director for a modern tech and business newsletter.
Task: Read the provided News Headline/Summary and generate a Stable Diffusion/Midjourney Prompt that creates a conceptual editorial illustration.

Phase 1: Conceptual Analysis (Internal Monologue)
Do not act literally. Think in metaphors.

1. Identify the Core Conflict: What is the tension? (e.g., Man vs. Machine, Privacy vs. Exposure, Growth vs. Decay).

2. Select a Visual Metaphor: Choose an object or scene that represents this concept abstractly.
   - Example: "Data leak" -> Don't show a computer. Show a cracked pipe leaking neon liquid, or a masked face dissolving into pixels.
   - Example: "Economic crash" -> Don't show a generic arrow down. Show a rollercoaster going off the rails, or a burning house made of money.

3. Apply Juxtaposition: Combine two unrelated elements to create a "Collage" feel. (e.g., A classical statue wearing VR goggles).

Phase 2: Construct the Image Prompt
Write a prompt strictly adhering to the "Lo-Fi Digital Grit" style guide below.

Style Guide (Must be applied to every prompt):
- Aesthetic: Lo-Fi Digital Grit, Editorial Collage, Risograph print style, Halftone dot pattern, Photocopy texture.
- Lighting/Color: High contrast, harsh lighting, duotone or tritone color palette (e.g., Deep Blue & Neon Yellow, or Gritty Black & Magenta).
- Effects: Film grain, scanlines, digital noise, glitch artifacts, screen printing errors.
- Composition: Centralized subject, minimalist but textured background, graphic overlays (grid lines, data charts, crosshairs).

Output Format:
Provide ONLY the final prompt string in the following structure:
[Subject/Metaphor Description], [Background Elements], [Style Keywords], [Color Palette], [Lighting]

Do NOT include any explanations, phase breakdowns, or commentary. Output ONLY the single prompt string.`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': 'https://innov8-newsletter.local',
        },
        body: JSON.stringify({
            model: 'anthropic/claude-sonnet-4',
            messages: [
                {
                    role: 'system',
                    content: artDirectorSystemPrompt
                },
                {
                    role: 'user',
                    content: `Generate a conceptual editorial illustration prompt for this news story:\n\n${storyText}`
                }
            ],
            max_tokens: 300
        })
    });

    if (!response.ok) {
        throw new Error('Failed to generate creative prompt');
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || storyText;
}
