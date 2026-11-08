import { NextRequest, NextResponse } from 'next/server';
import { insertNewsletter } from '@/lib/legacy-data';
import * as cheerio from 'cheerio';

export async function POST(req: NextRequest) {
    try {
        const origin = req.headers.get('origin');
        if (origin && origin !== req.nextUrl.origin) {
            return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
        }
        const formData = await req.formData();
        const file = formData.get('file');

        if (!(file instanceof File) || !/\.html?$/i.test(file.name) || file.size > 1_000_000) {
            return NextResponse.json({ error: 'Choose an HTML file under 1 MB.' }, { status: 400 });
        }

        const htmlConfig = await file.text();
        if (!/<(?:html|!doctype html)\b/i.test(htmlConfig)) {
            return NextResponse.json({ error: 'This does not look like an HTML file.' }, { status: 400 });
        }
        const $ = cheerio.load(htmlConfig);

        // CLEANING STRATEGY:
        // We want the clear text to show the AI the *structure* + *tone*
        // We remove scripts, styles, and huge navigation blocks if possible.
        $('script').remove();
        $('style').remove();
        $('link').remove();
        $('meta').remove();

        // Extract text with decent formatting preservation
        // We want to keep some layout cues like headers.
        // Cheerio's .text() flattens everything, so let's try to be a bit smarter or just take the body text.
        // For RAG, raw text is usually "okay" if we just want tone.
        // But let's try to keep meaningful whitespace.
        const textContent = $('body').text().replace(/\s+/g, ' ').trim();

        await insertNewsletter({
            title: file.name.replace('.html', '').replace(/[-_]/g, ' '),
            file_name: file.name,
            content_html: htmlConfig.substring(0, 100000), // Cap just in case
            content_text: textContent.substring(0, 50000), // Cap for token limits later
            imported_at: new Date().toISOString() // Required for RAG ordering
        });

        return NextResponse.json({ success: true, message: 'Newsletter imported into knowledge base.' });

    } catch (e: any) {
        console.error('Upload error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
