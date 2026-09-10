/**
 * MCP Tool Definition for Wordmarks.net Logo Generator
 *
 * This defines the MCP tool that AI agents can use to generate logos.
 * Agents can call this via the MCP protocol or via the REST API.
 */

export const WORDMARKS_LOGO_TOOL = {
  name: 'generate_wordmark_logo',
  description: `Generate a polished brand identity logo for any brand.

This tool creates a distinctive visual symbol paired with a readable custom wordmark, or a pure wordmark when explicitly requested.

The tool follows a full pipeline:
1. Analyzes the brand name and industry
2. Applies the requested style, color, and layout
3. Generates the logo using DALL-E 3
4. Reviews quality (scores 1-10 on simplicity, memorability, scalability, authority, cleverness, timelessness, and "billion dollar feel")
5. Returns the finished logo without exposing internal generation instructions

Style options: minimal, bold, elegant, modern, editorial, playful, classic, avantgarde
Color options: monochrome, navy, slate, blue, green, purple, warm, red
Layout options: horizontal, stacked, icon-word, monogram
Industry options: tech, finance, health, ecommerce, media, education, food, realestate, legal, creative, sports, travel, nonprofit, gaming, consulting`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      brandName: {
        type: 'string',
        description: 'The brand name to use as the wordmark logo. This will be the text in the logo.',
      },
      industry: {
        type: 'string',
        description: 'Industry category for context. Options: tech, finance, health, ecommerce, media, education, food, realestate, legal, creative, sports, travel, nonprofit, gaming, consulting',
      },
      style: {
        type: 'string',
        description: 'Design style direction. Options: minimal, bold, elegant, modern, editorial, playful, classic, avantgarde',
      },
      colorPreference: {
        type: 'string',
        description: 'Color palette preference. Options: monochrome, navy, slate, blue, green, purple, warm, red',
      },
      layout: {
        type: 'string',
        description: 'Logo layout type. Options: horizontal (single line), stacked (multi-line), icon-word (icon in wordmark), monogram (merged letters)',
      },
      customNotes: {
        type: 'string',
        description: 'Additional design notes or requirements',
      },
    },
    required: ['brandName'],
  },
};

/**
 * Example usage for AI agents:
 *
 * // Via MCP Protocol
 * const result = await mcpClient.callTool('generate_wordmark_logo', {
 *   brandName: 'PressWires',
 *   industry: 'media',
 *   style: 'modern',
 *   colorPreference: 'navy',
 *   layout: 'horizontal',
 * });
 *
 * // Via REST API
 * const response = await fetch('https://api.wordmarks.net/api/v1/generate-logo', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({
 *     brandName: 'PressWires',
 *     industry: 'media',
 *     style: 'modern',
 *     colorPreference: 'navy',
 *     layout: 'horizontal',
 *   }),
 * });
 * const { data: { logoUrl, scores } } = await response.json();
 */
