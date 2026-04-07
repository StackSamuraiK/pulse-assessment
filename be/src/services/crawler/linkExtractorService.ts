import * as cheerio from 'cheerio';
import { URL } from 'url';
import { logger } from '../../utils/logger';

const ALLOWED_BASE = 'https://docs.slack.dev';

// Extensions to skip
const SKIP_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico',
  '.pdf', '.zip', '.tar', '.gz',
  '.css', '.js', '.json', '.xml',
  '.mp4', '.mp3', '.woff', '.woff2', '.ttf', '.eot',
];

export class LinkExtractorService {
  /**
   * Extract all valid internal links from an HTML page.
   * Normalizes URLs and filters out external/anchor/asset links.
   */
  static extract(html: string, baseUrl: string): string[] {
    const $ = cheerio.load(html);
    const links = new Set<string>();

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;

      const normalized = this.normalizeUrl(href, baseUrl);
      if (normalized && this.isValidInternalUrl(normalized)) {
        links.add(normalized);
      }
    });

    return Array.from(links);
  }

  /**
   * Resolve relative URLs and normalize them.
   */
  static normalizeUrl(href: string, baseUrl: string): string | null {
    try {
      // Skip anchors, mailto, tel, javascript
      if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
        return null;
      }

      const resolved = new URL(href, baseUrl);

      // Remove fragment and query params for dedup
      resolved.hash = '';
      resolved.search = '';

      // Remove trailing slash for consistency (except root)
      let url = resolved.toString();
      if (url.endsWith('/') && url !== `${ALLOWED_BASE}/`) {
        url = url.slice(0, -1);
      }

      return url;
    } catch {
      return null;
    }
  }

  /**
   * Check if URL is a valid internal documentation page.
   */
  static isValidInternalUrl(url: string): boolean {
    // Must be under the allowed base
    if (!url.startsWith(ALLOWED_BASE)) return false;

    // Skip asset files
    const lower = url.toLowerCase();
    for (const ext of SKIP_EXTENSIONS) {
      if (lower.endsWith(ext)) return false;
    }

    return true;
  }
}
