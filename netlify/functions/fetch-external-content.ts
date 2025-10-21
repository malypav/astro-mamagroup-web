import type { Handler } from '@netlify/functions';
import * as cheerio from 'cheerio';

export const handler: Handler = async (event, context) => {
    // Handle CORS
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const { url } = event.queryStringParameters || {};
        
        if (!url) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'URL parameter is required' })
            };
        }

        // Fetch the external website
        const response = await fetch(url);
        
        if (!response.ok) {
            return {
                statusCode: response.status,
                headers,
                body: JSON.stringify({ 
                    error: `Failed to fetch content: ${response.status} ${response.statusText}` 
                })
            };
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        // Extract and clean content
        const extractedData = {
            title: $('title').text() || '',
            headings: [] as Array<{ level: string; text: string }>,
            content: [] as Array<{ type: string; content: string; attributes?: any }>,
            links: [] as Array<{ text: string; href: string }>,
            images: [] as Array<{ src: string; alt: string; title?: string }>,
            metadata: {
                description: $('meta[name="description"]').attr('content') || '',
                keywords: $('meta[name="keywords"]').attr('content') || ''
            }
        };

        // Extract headings
        $('h1, h2, h3, h4, h5, h6').each((_, element) => {
            const $el = $(element);
            extractedData.headings.push({
                level: element.tagName.toLowerCase(),
                text: $el.text().trim()
            });
        });

        // Extract main content areas
        const contentSelectors = [
            'main', 
            '.content', 
            '#content', 
            'article', 
            '.main-content',
            'body' // fallback
        ];

        let mainContent = null;
        for (const selector of contentSelectors) {
            const element = $(selector).first();
            if (element.length > 0) {
                mainContent = element;
                break;
            }
        }

        if (mainContent) {
            // Process paragraphs
            mainContent.find('p').each((_, element) => {
                const $p = $(element);
                const text = $p.text().trim();
                if (text) {
                    extractedData.content.push({
                        type: 'paragraph',
                        content: text
                    });
                }
            });

            // Process lists
            mainContent.find('ul, ol').each((_, element) => {
                const $list = $(element);
                const items = $list.find('li').map((_, li) => $(li).text().trim()).get();
                if (items.length > 0) {
                    extractedData.content.push({
                        type: element.tagName.toLowerCase(),
                        content: JSON.stringify(items)
                    });
                }
            });

            // Process tables
            mainContent.find('table').each((_, element) => {
                const $table = $(element);
                const rows: string[][] = [];
                $table.find('tr').each((_, row) => {
                    const cells = $(row).find('td, th').map((_, cell) => $(cell).text().trim()).get();
                    if (cells.length > 0) {
                        rows.push(cells);
                    }
                });
                if (rows.length > 0) {
                    extractedData.content.push({
                        type: 'table',
                        content: JSON.stringify(rows)
                    });
                }
            });

            // Extract links
            mainContent.find('a[href]').each((_, element) => {
                const $a = $(element);
                const href = $a.attr('href');
                const text = $a.text().trim();
                if (href && text) {
                    extractedData.links.push({
                        text,
                        href: href.startsWith('http') ? href : new URL(href, url).href
                    });
                }
            });

            // Extract images
            mainContent.find('img').each((_, element) => {
                const $img = $(element);
                const src = $img.attr('src');
                const alt = $img.attr('alt') || '';
                const title = $img.attr('title');
                if (src) {
                    extractedData.images.push({
                        src: src.startsWith('http') ? src : new URL(src, url).href,
                        alt,
                        title
                    });
                }
            });
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                data: extractedData,
                sourceUrl: url,
                fetchedAt: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('Error fetching external content:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error'
            })
        };
    }
};