import * as cheerio from 'cheerio';

export interface ParsedPage {
  title: string;
  content: string;
  headings: string[];
}

export class ParserService {
  /**
   * Parse raw HTML into clean text content using Cheerio.
   * Strips navigation, sidebars, footers, scripts, etc.
   */
  static parse(html: string, url: string): ParsedPage {
    const $ = cheerio.load(html);

    // Remove non-content elements
    $(
      'script, style, nav, footer, header, aside, iframe, ' +
      '.sidebar, .navigation, .footer, .header, .nav, .toc, .breadcrumb, ' +
      '#nav, #footer, #header, #sidebar, ' +
      '[role="navigation"], [role="banner"], [role="complementary"], ' +
      'noscript, svg, button, form, input, select, textarea'
    ).remove();

    // Extract title
    const title = $('title').text().trim()
      || $('h1').first().text().trim()
      || url;

    // Extract headings for structured metadata
    const headings: string[] = [];
    $('h1, h2, h3').each((_, el) => {
      const text = $(el).text().trim();
      if (text) headings.push(text);
    });

    // Try to get main content area (most specific first)
    let mainContent = '';
    const contentSelectors = ['main', '[role="main"]', 'article', '.content', '.main-content', '#content', 'body'];

    for (const selector of contentSelectors) {
      const text = $(selector).text();
      if (text && text.trim().length > 100) {
        mainContent = text;
        break;
      }
    }

    // Clean up whitespace
    mainContent = this.cleanContent(mainContent);

    return { title, content: mainContent, headings };
  }

  /**
   * Normalize whitespace, collapse blank lines, trim each line.
   */
  static cleanContent(raw: string): string {
    return raw
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')  // Max 2 consecutive newlines
      .trim();
  }
}
