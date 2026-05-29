/**
 * WCN Copy Engine — Brand Memory API
 * Vercel serverless function. Secure proxy between the Copy Engine and Notion.
 * The Notion token and shared secret NEVER leave this function.
 *
 * ENV VARS required in Vercel dashboard:
 *   NOTION_TOKEN     — your Notion integration token (secret_xxx...)
 *   NOTION_DB_ID     — the ID of your Brand Memory database in Notion
 *   WCN_API_SECRET   — a strong random string you choose (min 32 chars)
 *
 * Allowed origins: wcnauto.github.io + localhost for testing
 */

const ALLOWED_ORIGINS = [
  'https://wcnauto.github.io',
  'http://localhost',
  'http://127.0.0.1'
];

function setCors(req, res) {
  const origin = req.headers.origin || '';
  const allowed = ALLOWED_ORIGINS.some(o => origin.startsWith(o));
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-wcn-secret');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function auth(req) {
  const secret = req.headers['x-wcn-secret'];
  return secret && secret === process.env.WCN_API_SECRET;
}

async function notionFetch(path, method, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Notion error ${res.status}`);
  return data;
}

// ── GET /api/brand-memory?brand=raj_petro
// Returns last 5 approved examples for a brand
async function getMemory(brand, res) {
  const data = await notionFetch(`/databases/${process.env.NOTION_DB_ID}/query`, 'POST', {
    filter: {
      property: 'Brand',
      title: { equals: brand }
    },
    sorts: [{ property: 'Approved Date', direction: 'descending' }],
    page_size: 5
  });

  const examples = data.results
    .map(page => ({
      platform:   page.properties.Platform?.select?.name || '',
      format:     page.properties.Format?.select?.name || '',
      caption:    page.properties.Caption?.rich_text?.[0]?.plain_text || '',
      slides:     page.properties.Slides?.rich_text?.[0]?.plain_text || '',
      date:       page.properties['Approved Date']?.date?.start || ''
    }))
    .filter(e => e.caption.length > 0);

  return res.status(200).json({ examples });
}

// ── POST /api/brand-memory
// Saves one approved output to Notion
async function saveMemory(body, res) {
  const { brand, platform, format, caption, slides, hashtags, altCaption, notes } = body;
  if (!brand || !caption) {
    return res.status(400).json({ error: 'brand and caption are required' });
  }

  const rt = (text) => text
    ? [{ text: { content: String(text).slice(0, 2000) } }]
    : [];

  const data = await notionFetch('/pages', 'POST', {
    parent: { database_id: process.env.NOTION_DB_ID },
    properties: {
      Brand:           { title:     [{ text: { content: brand } }] },
      Platform:        { select:    { name: platform || 'Unspecified' } },
      Format:          { select:    { name: format || 'Unspecified' } },
      Caption:         { rich_text: rt(caption) },
      Slides:          { rich_text: rt(slides) },
      Hashtags:        { rich_text: rt(hashtags) },
      'Alt Caption':   { rich_text: rt(altCaption) },
      Notes:           { rich_text: rt(notes) },
      'Approved Date': { date: { start: new Date().toISOString().split('T')[0] } }
    }
  });

  return res.status(200).json({ success: true, id: data.id });
}

// ── HANDLER
export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!auth(req)) return res.status(401).json({ error: 'Unauthorised' });

  try {
    if (req.method === 'GET')  return await getMemory(req.query.brand, res);
    if (req.method === 'POST') return await saveMemory(req.body, res);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[brand-memory]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
