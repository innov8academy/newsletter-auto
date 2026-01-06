import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import * as cheerio from 'cheerio';

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
        }

        const htmlConfig = await file.text();
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

        // Save to Supabase
        const { error } = await supabaseAdmin.from('past_newsletters').insert({
            title: file.name.replace('.html', '').replace(/[-_]/g, ' '),
            file_name: file.name,
            content_html: htmlConfig.substring(0, 100000), // Cap just in case
            content_text: textContent.substring(0, 50000) // Cap for token limits later
        });

        if (error) {
            console.error('Supabase error:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, message: 'Newsletter imported into knowledge base.' });

    } catch (e: any) {
        console.error('Upload error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
