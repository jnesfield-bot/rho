#!/usr/bin/env node

/**
 * Search arXiv papers.
 *
 * Usage:
 *   node search.mjs "deep reinforcement learning" --max 5
 *   node search.mjs "ti:attention is all you need"
 *   node search.mjs "au:mnih AND ti:playing atari" --max 10
 */

const query = process.argv[2];
if (!query) {
  console.error("Usage: node search.mjs <query> [--max N]");
  process.exit(1);
}

const maxIdx = process.argv.indexOf("--max");
const maxResults = maxIdx !== -1 ? parseInt(process.argv[maxIdx + 1], 10) : 5;

const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&start=0&max_results=${maxResults}`;

const resp = await fetch(url);
if (!resp.ok) {
  console.error(`arXiv API error: ${resp.status} ${resp.statusText}`);
  process.exit(1);
}

const xml = await resp.text();

// Parse Atom XML entries
const entries = [];
const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
let match;

while ((match = entryRegex.exec(xml)) !== null) {
  const entry = match[1];

  const get = (tag) => {
    const m = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
    return m ? m[1].trim() : null;
  };

  const id = get("id");
  const arxivId = id?.match(/abs\/(.+?)(?:v\d+)?$/)?.[1] || id;

  // Get all authors
  const authors = [];
  const authorRegex = /<author>\s*<name>([^<]+)<\/name>/g;
  let authorMatch;
  while ((authorMatch = authorRegex.exec(entry)) !== null) {
    authors.push(authorMatch[1].trim());
  }

  // Get categories
  const categories = [];
  const catRegex = /<category[^>]*term="([^"]+)"/g;
  let catMatch;
  while ((catMatch = catRegex.exec(entry)) !== null) {
    categories.push(catMatch[1]);
  }

  entries.push({
    id: arxivId,
    title: get("title")?.replace(/\s+/g, " "),
    authors,
    abstract: get("summary")?.replace(/\s+/g, " "),
    categories,
    published: get("published"),
    updated: get("updated"),
    pdf: `https://arxiv.org/pdf/${arxivId}`,
    source: `https://arxiv.org/e-print/${arxivId}`,
  });
}

console.log(JSON.stringify(entries, null, 2));
