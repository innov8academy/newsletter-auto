import { NextRequest, NextResponse } from 'next/server';

// Web search using Serper API
export async function POST(request: NextRequest) {
  try {
    const { query, num = 5 } = await request.json();
    
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'SERPER_API_KEY not configured' },
        { status: 500 }
      );
    }

    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: query,
        num,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[web-search] Serper error:', error);
      return NextResponse.json(
        { success: false, error: `Search failed: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    
    // Extract relevant results
    const results = [];
    
    // Knowledge graph
    if (data.knowledgeGraph) {
      results.push({
        type: 'knowledge',
        title: data.knowledgeGraph.title,
        description: data.knowledgeGraph.description,
        source: data.knowledgeGraph.website,
      });
    }
    
    // Organic results
    if (data.organic) {
      for (const item of data.organic.slice(0, num)) {
        results.push({
          type: 'organic',
          title: item.title,
          snippet: item.snippet,
          url: item.link,
          date: item.date,
        });
      }
    }
    
    // News results
    if (data.news) {
      for (const item of data.news.slice(0, 3)) {
        results.push({
          type: 'news',
          title: item.title,
          snippet: item.snippet,
          url: item.link,
          source: item.source,
          date: item.date,
        });
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error('[web-search] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Search failed' },
      { status: 500 }
    );
  }
}
