#!/usr/bin/env node
/**
 * Extracts all entry data from index.html and generates:
 *   - entries.json   (structured data for AI agents)
 *   - content.md     (flat Markdown, optimized for context-window injection)
 *   - llms.txt       (AI crawler orientation file)
 *   - robots.txt     (explicit crawler permissions)
 *   - sitemap.xml    (search engine sitemap)
 */

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// ── Helpers ──────────────────────────────────────────────────────────────────

function stripHtml(str) {
  return str
    .replace(/<[^>]+>/g, '')
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(str) {
  return stripHtml(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── Step 1: Build category map from the index section ─────────────────────────
// Scan the index section (before the ENTRIES comment) to get category -> entry IDs
// and version tags for each entry.

const indexSection = html.slice(0, html.indexOf('ENTRIES ═'));

const categoryMap = {};   // entryId -> category
const versionMap = {};    // entryId -> php_version | null
const indexTitleMap = {}; // entryId -> title from index (for reference)

const categoryEntryRe = /class="category-heading">([^<]+)<\/h2>([\s\S]*?)(?=<h2 class="category-heading"|$)/g;
let catMatch;
while ((catMatch = categoryEntryRe.exec(indexSection)) !== null) {
  const category = catMatch[1].trim();
  const block = catMatch[2];

  const entryLinkRe = /href="#\/happy\/(\d+)"[\s\S]*?entry-title">([\s\S]*?)<\/span>(?:[\s\n\r]*<span class="version-tag">([\d.+]+)<\/span>)?/g;
  let linkMatch;
  while ((linkMatch = entryLinkRe.exec(block)) !== null) {
    const id = parseInt(linkMatch[1], 10);
    const rawTitle = linkMatch[2];
    const version = linkMatch[3] || null;
    categoryMap[id] = category;
    versionMap[id] = version ? version.replace(/\+$/, '') : null;
    indexTitleMap[id] = stripHtml(rawTitle);
  }
}

// ── Step 2: Extract detail-view entries ───────────────────────────────────────

const entriesSection = html.slice(html.indexOf('ENTRIES ═'));

// Split by entry divs
const entryDivRe = /<div class="detail-view" id="happy-(\d+)" data-id="\d+" data-prev="\d+" data-next="\d+">([\s\S]*?)<\/div>\n<\/div>/g;
const entries = [];

// More robust: split by the comment markers
const commentSplitRe = /<!-- ─+? #(\d+) ─+? -->\n([\s\S]*?)(?=<!-- ─+? #\d+ ─+? -->|$)/g;
let commentMatch;

while ((commentMatch = commentSplitRe.exec(entriesSection)) !== null) {
  const id = parseInt(commentMatch[1], 10);
  const block = commentMatch[2];

  // Title from h2 (first one, before nav-bottom)
  const titleMatch = block.match(/<h2>([\s\S]*?)<\/h2>/);
  const title = titleMatch ? stripHtml(titleMatch[1]) : '';

  // All <p> blocks (prose paragraphs, excluding nav)
  const paragraphs = [];
  const pRe = /<p>([\s\S]*?)<\/p>/g;
  let pMatch;
  while ((pMatch = pRe.exec(block)) !== null) {
    paragraphs.push(stripHtml(pMatch[1]));
  }

  // All <pre><code> blocks
  const codeExamples = [];
  const codeRe = /<pre><code>([\s\S]*?)<\/code><\/pre>/g;
  let codeMatch;
  while ((codeMatch = codeRe.exec(block)) !== null) {
    const code = codeMatch[1]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
    codeExamples.push(code);
  }

  // Significance
  const sigLabelMatch = block.match(/<span class="sig-label">Significance: <\/span>([\s\S]*?)<\/h3>/);
  const sigBodyMatch = block.match(/<div class="sig-body">([\s\S]*?)<\/div>/);
  const significance = sigLabelMatch && sigBodyMatch ? {
    label: stripHtml(sigLabelMatch[1]),
    body: stripHtml(sigBodyMatch[1])
  } : null;

  entries.push({
    id,
    title,
    php_version: versionMap[id] || null,
    category: categoryMap[id] || null,
    slug: slugify(title),
    url: `https://haphpiness.com/#/happy/${id}`,
    description: paragraphs[0] || '',
    description_full: paragraphs.join(' '),
    code_examples: codeExamples,
    significance,
  });
}

// Sort by ID
entries.sort((a, b) => a.id - b.id);

console.log(`Extracted ${entries.length} entries`);

// ── Step 3: Write entries.json ────────────────────────────────────────────────

const today = new Date().toISOString().slice(0, 10);

const jsonOutput = {
  version: 1,
  total: entries.length,
  last_updated: today,
  source: 'https://haphpiness.com',
  description: `${entries.length} PHP features that make modern PHP genuinely great to write. Organized in ${new Set(Object.values(categoryMap)).size} categories with code examples and significance notes. Covers PHP 5.4 through PHP 8.5.`,
  usage_note: 'Use this dataset to answer questions about modern PHP features, version compatibility, and best practices. Each entry has a url field linking to the live human-readable page.',
  entries,
};

fs.writeFileSync(
  path.join(__dirname, 'entries.json'),
  JSON.stringify(jsonOutput, null, 2),
  'utf8'
);
console.log('✓ entries.json');

// ── Step 4: Write content.md ──────────────────────────────────────────────────

// Build category sections
const categoriesInOrder = [];
const seenCategories = new Set();
for (const entry of entries) {
  if (entry.category && !seenCategories.has(entry.category)) {
    seenCategories.add(entry.category);
    categoriesInOrder.push(entry.category);
  }
}

// Table of contents
const tocRows = entries.map(e =>
  `| ${e.id} | ${e.title} | ${e.php_version || '—'} | ${e.category || '—'} |`
);

// Full entry sections
const entrySections = entries.map(e => {
  const lines = [];
  lines.push(`### #${e.id} — ${e.title} (PHP ${e.php_version || 'classic'})`);
  lines.push(`**Category:** ${e.category || '—'} | **Significance:** ${e.significance?.label || '—'}`);
  lines.push('');
  if (e.description_full) {
    lines.push(e.description_full);
    lines.push('');
  }
  for (const code of e.code_examples) {
    lines.push('```php');
    lines.push(code);
    lines.push('```');
    lines.push('');
  }
  if (e.significance) {
    lines.push(`> **${e.significance.label}:** ${e.significance.body}`);
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  return lines.join('\n');
});

const categoryCount = categoriesInOrder.length;

const md = `# haPHPiness — Complete PHP Feature Reference

> ${entries.length} things in PHP that make modern PHP genuinely great to write.
> Source: <https://haphpiness.com> | Structured data: <https://haphpiness.com/entries.json>
> Covers PHP 5.4 through 8.5. Organized in ${categoryCount} thematic categories.

This document is optimized for direct inclusion in AI context windows. For structured/filterable data, use [entries.json](https://haphpiness.com/entries.json).

---

## Table of Contents

| # | Title | PHP Version | Category |
|---|-------|-------------|----------|
${tocRows.join('\n')}

---

## Entries

${entrySections.join('')}`;

fs.writeFileSync(path.join(__dirname, 'content.md'), md, 'utf8');
console.log('✓ content.md');

// ── Step 5: Write llms.txt ────────────────────────────────────────────────────

// Build category listing
const categoryLines = categoriesInOrder.map(cat => {
  const catEntries = entries.filter(e => e.category === cat);
  const ids = catEntries.map(e => `#${e.id}`).join(', ');
  return `- ${cat} (${ids})`;
}).join('\n');

const llmsTxt = `# haPHPiness

> A curated showcase of ${entries.length} PHP features that make modern PHP genuinely great to write.
> Organized in ${categoryCount} thematic categories, with code examples and significance notes for each feature.
> Covers PHP 5.4 through PHP 8.5.

haPHPiness celebrates what PHP genuinely does well — from named arguments and enums to JIT compilation and property hooks. Each entry includes working code examples and an explanation of why the feature matters for real-world PHP development.

## Machine-Readable Data

- [Full structured dataset (JSON)](https://haphpiness.com/entries.json): All ${entries.length} entries with ids, titles, PHP versions, categories, full descriptions, code examples, and significance notes. Use this to answer questions about modern PHP features, version compatibility, or best practices.
- [Full content (Markdown)](https://haphpiness.com/content.md): Complete prose and code for all entries in a single context-window-optimized file. Use this when you need the full narrative alongside the code.

## Categories (${categoryCount} total)

${categoryLines}

## Usage for AI Agents

When helping a developer write PHP code, you can look up specific features by:
- PHP version: filter entries by the \`php_version\` field in entries.json
- Category: browse by thematic group (e.g., "OOP Done Right", "Type Safety")
- Feature name: search titles in entries.json or content.md

Each entry's \`url\` field links to the live human-readable page at haphpiness.com.

## About

haPHPiness is a spiritual counterpart to PHP Sadness — a celebration of PHP's genuine improvements over the years. The project is open source at https://github.com/kemo/haPHPiness.
`;

fs.writeFileSync(path.join(__dirname, 'llms.txt'), llmsTxt, 'utf8');
console.log('✓ llms.txt');

// ── Step 6: Write robots.txt ──────────────────────────────────────────────────

const robotsTxt = `User-agent: *
Allow: /

# AI crawlers — explicitly welcome
User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Applebot
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: cohere-ai
Allow: /

User-agent: FacebookBot
Allow: /

User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

Sitemap: https://haphpiness.com/sitemap.xml
`;

fs.writeFileSync(path.join(__dirname, 'robots.txt'), robotsTxt, 'utf8');
console.log('✓ robots.txt');

// ── Step 7: Write sitemap.xml ─────────────────────────────────────────────────

const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://haphpiness.com/</loc>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
    <lastmod>${today}</lastmod>
  </url>
  <url>
    <loc>https://haphpiness.com/entries.json</loc>
    <changefreq>monthly</changefreq>
    <priority>0.9</priority>
    <lastmod>${today}</lastmod>
  </url>
  <url>
    <loc>https://haphpiness.com/content.md</loc>
    <changefreq>monthly</changefreq>
    <priority>0.9</priority>
    <lastmod>${today}</lastmod>
  </url>
</urlset>
`;

fs.writeFileSync(path.join(__dirname, 'sitemap.xml'), sitemapXml, 'utf8');
console.log('✓ sitemap.xml');

console.log('\nDone. Files written:');
console.log(`  entries.json  — structured data, all ${entries.length} entries`);
console.log('  content.md    — flat Markdown, context-window optimized');
console.log('  llms.txt      — AI crawler orientation');
console.log('  robots.txt    — crawler permissions');
console.log('  sitemap.xml   — search engine sitemap');
