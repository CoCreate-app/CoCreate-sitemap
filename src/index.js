/********************************************************************************
 * Copyright (C) 2023 CoCreate and Contributors.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 ********************************************************************************/

// Commercial Licensing Information:
// For commercial use of this software without the copyleft provisions of the AGPLv3,
// you must obtain a commercial license from CoCreate LLC.
// For details, visit <https://cocreate.app/licenses/> or contact us at sales@cocreate.app.

const fs = require('fs');

class CoCreateSitemap {
    constructor(render) {
        this.render = render;
    }

    async updateUrlInSitemap(urlToFind) {
        try {
            // Path to your sitemap file
            const sitemapPath = '/path/to/your/sitemap.xml';

            // Read and parse the sitemap XML
            let sitemapXml = fs.readFileSync(sitemapPath, 'utf8');

            // Regex pattern to find the entire <url>...</url> block containing the URL
            const regexPattern = `<url>\\s*<loc>${urlToFind}</loc>[\\s\\S]*?</url>`;

            // Perform regex search
            const match = sitemapXml.match(regexPattern);

            if (match) {
                const position = match.index; // Start position of the <url> block
                const endPosition = match.index + match[0].length; // End position of the <url> block
                console.log(`URL ${urlToFind} found in sitemap at position ${position}-${endPosition}.`);

                // Replace the matched <url> block with a modified version (example)
                const modifiedUrlBlock = `<url>
          <loc>${urlToFind}</loc>
          <lastmod>${new Date().toISOString()}</lastmod>
          <priority>1.0</priority>
        </url>`;

                // Replace the original <url> block with the modified one
                sitemapXml = sitemapXml.slice(0, position) + modifiedUrlBlock + sitemapXml.slice(endPosition);

                // Write back the modified sitemap XML to the file (optional)
                fs.writeFileSync(sitemapPath, sitemapXml);

                console.log('Sitemap updated successfully.');
            } else {
                console.log(`URL ${urlToFind} not found in sitemap.`);
            }
        } catch (err) {
            console.error('Error updating sitemap:', err);
        }
    }
}

module.exports = CoCreateSitemap;
