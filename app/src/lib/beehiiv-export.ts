import type { NewsletterDraft, StoryBlock } from './draft-generator';

export interface BeehiivDraftPayload {
    title: string;
    subtitle?: string;
    body_content: string;
    thumbnail_image_url?: string;
}

export interface BeehiivExportResult {
    payload: BeehiivDraftPayload;
    skippedImages: string[];
}

type ImageMap = Record<string, string | undefined>;

const MAX_TEXT_LENGTH = 100_000;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function asText(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value.trim() : fallback;
}

function asTextArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)
        : [];
}

function validateStory(value: unknown, index: number): StoryBlock {
    if (!isRecord(value)) {
        throw new Error(`Story ${index + 1} is invalid`);
    }

    const title = asText(value.title);
    const hookParagraph = asText(value.hookParagraph);

    if (!title || !hookParagraph) {
        throw new Error(`Story ${index + 1} needs a title and hook paragraph`);
    }

    return {
        studioStoryId: asText(value.studioStoryId) || undefined,
        sourceStoryId: asText(value.sourceStoryId) || undefined,
        emoji: asText(value.emoji),
        title,
        hookParagraph,
        bulletPoints: asTextArray(value.bulletPoints),
        whyItMatters: asText(value.whyItMatters),
        l8rsTake: asText(value.l8rsTake),
        imageUrl: asText(value.imageUrl),
    };
}

export function parseNewsletterDraftInput(value: unknown): NewsletterDraft {
    if (!isRecord(value)) {
        throw new Error('Draft payload is invalid');
    }

    const title = asText(value.title);
    const storiesInput = value.stories;
    if (!title) {
        throw new Error('Draft title is required');
    }
    if (!Array.isArray(storiesInput) || storiesInput.length === 0) {
        throw new Error('Draft must include at least one story');
    }

    const stories = storiesInput.map(validateStory);
    const totalText = JSON.stringify(value).length;
    if (totalText > MAX_TEXT_LENGTH) {
        throw new Error('Draft is too large to export safely');
    }

    return {
        studioDraftId: asText(value.studioDraftId) || undefined,
        storageSchemaVersion: typeof value.storageSchemaVersion === 'number' ? value.storageSchemaVersion : undefined,
        title,
        subtitle: asText(value.subtitle),
        date: asText(value.date),
        memeIdeas: Array.isArray(value.memeIdeas) ? value.memeIdeas as NewsletterDraft['memeIdeas'] : [],
        intro: asText(value.intro),
        toc: asTextArray(value.toc),
        stories,
        quickSummary: asText(value.quickSummary),
        rawMarkdown: asText(value.rawMarkdown),
    };
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function inlineMarkdown(value: string): string {
    const escaped = escapeHtml(value);
    return escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function paragraphs(value: string): string {
    return value
        .split(/\n{2,}/)
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => `<p style="margin:0 0 16px; line-height:1.6;">${inlineMarkdown(part).replace(/\n/g, '<br>')}</p>`)
        .join('\n');
}

function list(items: string[]): string {
    if (items.length === 0) return '';

    return `
<ul style="margin:0 0 18px 22px; padding:0; line-height:1.6;">
${items.map(item => `<li style="margin:0 0 8px;">${inlineMarkdown(item)}</li>`).join('\n')}
</ul>`;
}

function publicImageUrl(value: string | undefined): string | null {
    if (!value) return null;

    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
    } catch {
        return null;
    }
}

function storyHtml(story: StoryBlock, imageUrl: string | null): string {
    return `
<h2 style="margin:32px 0 12px; font-size:26px; line-height:1.25;">${inlineMarkdown(`${story.emoji ? `${story.emoji} ` : ''}${story.title}`)}</h2>
${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(story.title)}" style="display:block; width:100%; max-width:680px; height:auto; margin:0 0 18px; border-radius:8px;">` : ''}
${paragraphs(story.hookParagraph)}
${story.bulletPoints.length ? `<p style="margin:0 0 8px; line-height:1.6;"><strong>The details:</strong></p>${list(story.bulletPoints)}` : ''}
${story.whyItMatters ? `<p style="margin:0 0 8px; line-height:1.6;"><strong>Why it matters:</strong></p>${paragraphs(story.whyItMatters)}` : ''}
${story.l8rsTake ? `<p style="margin:0 0 8px; line-height:1.6;"><strong>L8R's Take:</strong></p>${paragraphs(story.l8rsTake)}` : ''}
<hr style="border:0; border-top:1px solid #e5e7eb; margin:28px 0;">`;
}

export function buildBeehiivDraftPayload(draft: NewsletterDraft, imageUrls: ImageMap = {}): BeehiivExportResult {
    const skippedImages: string[] = [];
    const storyImages = draft.stories.map((story, index) => {
        const candidate = publicImageUrl(imageUrls[String(index)] || story.imageUrl);
        if (!candidate && (imageUrls[String(index)] || story.imageUrl)) {
            skippedImages.push(`Story ${index + 1}: image is not a public http(s) URL`);
        }
        return candidate;
    });

    const intro = draft.intro ? paragraphs(draft.intro) : '';
    const toc = draft.toc?.length
        ? `<p style="margin:22px 0 8px; line-height:1.6;"><strong>In today's post:</strong></p>${list(draft.toc)}`
        : '';
    const stories = draft.stories.map((story, index) => storyHtml(story, storyImages[index])).join('\n');
    const summary = draft.quickSummary
        ? `<h2 style="margin:32px 0 12px; font-size:24px; line-height:1.25;">Quick L8R Summary</h2>${paragraphs(draft.quickSummary)}`
        : '';

    const body_content = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%; border-collapse:collapse;">
  <tbody>
    <tr>
      <td style="font-family:Arial, Helvetica, sans-serif; font-size:16px; color:#111827; line-height:1.6;">
        ${draft.subtitle ? `<p style="margin:0 0 22px; color:#4b5563; line-height:1.5;">${inlineMarkdown(draft.subtitle)}</p>` : ''}
        ${intro}
        ${toc}
        ${stories}
        ${summary}
        <p style="margin:24px 0 0; line-height:1.6;">Ithrollu innathe AI Update.<br>appo adutha l8ril varam.. bie.</p>
      </td>
    </tr>
  </tbody>
</table>`.trim();

    const thumbnail = storyImages.find(Boolean) || undefined;

    return {
        payload: {
            title: draft.title,
            subtitle: draft.subtitle || undefined,
            body_content,
            thumbnail_image_url: thumbnail,
        },
        skippedImages,
    };
}
