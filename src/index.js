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

const { parse } = require("node-html-parser");

class CoCreateSitemap {
    constructor(crud) {
        this.crud = crud;
    }

    async check(file, host) {
        // Ensure the file is HTML and does not have a sitemap object yet
        if (!file.sitemap && file['content-type'] !== 'text/html')
            return;

        // Ensure the file is public and is not sitemap false
        if (file.sitemap === false || file.sitemap === 'false' || !file.public || file.public === "false")
            return;

        // Check if the file is HTML and contains a noindex meta or title tag
        if (file['content-type'] === 'text/html') {
            if (/<meta\s+name=["']robots["']\s+content=["'][^"']*noindex[^"']*["']/i.test(file.src))
                return;
            if (!(/<title[^>]*>[\s\S]*?<\/title>/i.test(file.src)))
                return;
        }

        // Compare the lastmod date in the sitemap with the modified.on date
        if (file.sitemap && file.sitemap.lastmod && file.modified.on) {
            if (new Date(file.sitemap.lastmod) >= new Date(file.modified.on))
                return;
        }

        // Logic to update the sitemap
        this.updateSitemap(file, host);
    }

    async updateSitemap(file, host) {
        try {
            if (!file.sitemap)
                file.sitemap = {}

            const entry = this.createEntry(file, host);

            let { mainSitemap, sitemap } = await this.getSitemap(file, host);

            if (file.pathname) {
                // Perform regex search starting at the pathname
                const regexPattern = `<url>\\s*<loc>.*?${file.pathname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*?</loc>[\\s\\S]*?</url>`;
                const match = sitemap.src.match(new RegExp(regexPattern));

                if (match) {
                    const position = match.index; // Start position of the <url> block
                    const endPosition = match.index + match[0].length; // End position of the <url> block

                    // Replace the original <url> block with the modified one
                    sitemap.src = sitemap.src.slice(0, position) + entry + sitemap.src.slice(endPosition);
                } else {
                    sitemap.src = sitemap.src.replace('</urlset>', `${entry}</urlset>`);
                }
            } else {
                file.sitemap.pathname = sitemap.pathname
                sitemap.src = sitemap.src.replace('</urlset>', `${entry}</urlset>`);
            }

            this.saveSitemap(mainSitemap, host);
            this.saveSitemap(sitemap, host);
            this.saveSitemap(file, host);

            // console.log('Sitemap updated successfully.');
        } catch (err) {
            console.error('Error updating sitemap:', err);
        }
    }

    createEntry(file) {
        file.sitemap.loc = file.pathname;
        file.sitemap.lastmod = file.modified.on;

        if (file['content-type'] === 'text/html') {
            this.parseHtml(file)

            if (file.sitemap.type !== 'news' && file.sitemap.type !== 'image' && file.sitemap.type !== 'video') {
                if (!file.sitemap.changefreq)
                    file.sitemap.changefreq = 'monthly';

                if (!file.sitemap.priority) {
                    const depth = (file.pathname.match(/\//g) || []).length;
                    file.sitemap.priority = Math.max(0.1, 1.0 - (depth - 1) * 0.1).toFixed(1);
                }
            } else {
                delete file.sitemap.changefreq
                delete file.sitemap.priority
            }
        }

        let entry = `\t<url>\n`;

        for (const key of Object.keys(file.sitemap)) {
            if (key === 'pathname' || key === 'type')
                continue

            let value = file.sitemap[key];

            if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
                if (!Array.isArray(value))
                    value = [value]

                for (let i = 0; i < value.length; i++) {
                    entry += `\t\t<${key}:${key}>\n`;

                    for (const nestedKey of Object.keys(value[i])) {
                        let nestedValue = value[i][nestedKey];
                        // Handle nested objects
                        if (typeof nestedValue === 'object' && nestedValue !== null && !(nestedValue instanceof Date)) {
                            entry += `\t\t\t<${key}:${nestedKey}>\n`;
                            for (const subKey of Object.keys(nestedValue)) {
                                const subValue = nestedValue[subKey];
                                entry += `\t\t\t\t<${key}:${subKey}>${subValue}</${key}:${subKey}>\n`;
                            }
                            entry += `\t\t\t</${key}:${nestedKey}>\n`;
                        } else {
                            if (nestedKey === 'loc') {
                                if (!nestedValue.startsWith('https://') && !nestedValue.startsWith('http://') && !nestedValue.startsWith('{{$host}}')) {
                                    nestedValue = `{{$host}}${nestedValue}`;
                                }
                            } else if (nestedKey === 'publication_date') {
                                nestedValue = new Date(nestedValue).toISOString().split('.')[0] + "Z";
                            } else {
                                nestedValue = this.encodeXML(nestedValue)
                            }

                            entry += `\t\t\t<${key}:${nestedKey}>${nestedValue}</${key}:${nestedKey}>\n`;
                        }
                    }

                    entry += `\t\t</${key}:${key}>\n`;
                }
            } else {
                if (key === 'loc') {
                    if (!value.startsWith('https://') && !value.startsWith('http://')) {
                        value = `{{$host}}${value}`;
                    }
                } else if (key === 'lastmod') {
                    value = new Date(file.modified.on).toISOString().split('.')[0] + "Z";
                } else {
                    value = this.encodeXML(value)
                }

                entry += `\t\t<${key}>${value}</${key}>\n`;
            }
        }

        entry += `\t</url>\n`;

        return entry;
    }

    async getSitemap(file, host) {
        let mainSitemap = {
            host: file.host,
            name: 'sitemap.xml',
            path: '/',
            pathname: '/sitemap.xml',
            directory: '/',
            'content-type': 'application/xml',
            public: true,
            organization_id: file.organization_id
        }

        mainSitemap = await this.readSitemap(mainSitemap, host);
        if (!mainSitemap.src)
            mainSitemap.src = this.createSitemap('main')

        let sitemap = {
            host: file.host,
            path: '/',
            pathname: file.sitemap.pathname,
            directory: '/',
            'content-type': 'application/xml',
            public: true,
            organization_id: file.organization_id
        }

        // Update loc using pathname
        file.sitemap.loc = `${file.pathname}`

        // Query the database for the correct sitemap based on the loc and type
        if (file.sitemap.pathname) {
            sitemap = await this.readSitemap(sitemap, host);
        }

        if (!sitemap.src) {
            let type = 'sitemap';

            // Identify content type to determine sitemap type
            if (file['content-type'].startsWith('image/')) {
                type = 'image';
            } else if (file['content-type'].startsWith('video/')) {
                type = 'video';
            } else if (file.sitemap.type === 'news') {
                type = 'news';
            }

            let name = `sitemap`
            if (type === 'image' || type === 'video' || type === 'news')
                name = `sitemap-${type}`

            // If no existing sitemap found check last index sitemap
            let index = await this.getLastSitemapIndex(mainSitemap, name);
            if (index) {
                sitemap.pathname = `/${name}${index}.xml`
                sitemap = await this.readSitemap(sitemap, host);
            } else {
                index = 1
            }

            // Check if there's room in the last index sitemap
            if (!this.checkSitemap(sitemap.src)) {
                if (sitemap.src)
                    index += 1
                else
                    sitemap.src = this.createSitemap(type);

                sitemap.name = `${name}${index}.xml`
                sitemap.pathname = `/${name}${index}.xml`

            }

        }

        // Create the regex pattern to match the <sitemap> block containing the specific <loc> for the pathname
        const regexPattern = `<sitemap>\\s*<loc>[^<]*${sitemap.pathname}[^<]*</loc>[\\s\\S]*?</sitemap>`;

        // Execute the regex match against the sitemap index source
        const match = mainSitemap.src.match(new RegExp(regexPattern));

        // Check if a match is found
        if (!match) {
            //TODO: if sitemap found but not in index should we add to sitemap pathname to index or should we check the sitmap for the next index available see if room add or create new index. 
            const indexEntry = `\t<sitemap>\n\t\t<loc>{{$host}}${sitemap.pathname}</loc>\n</sitemap>`;
            mainSitemap.src = mainSitemap.src.replace('</sitemapindex>', `${indexEntry}\n</sitemapindex>`);
        }

        return { mainSitemap, sitemap }
    }

    async readSitemap(file, host) {
        let data = {
            method: 'object.read',
            host: host,
            array: 'files',
            $filter: {
                query: {
                    host: { $in: [host, '*'] },
                    pathname: file.pathname
                },
                limit: 1
            },
            organization_id: file.organization_id
        }
        data = await this.crud.send(data)
        if (data.object && data.object.length)
            return data.object[0]
        else
            return file
    }

    createSitemap(type) {
        const xmlDeclaration = `<?xml version="1.0" encoding="UTF-8"?>\n`;
        const sitemapNamespace = 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';

        if (type === 'main') {
            return `${xmlDeclaration}<sitemapindex ${sitemapNamespace}>\n</sitemapindex>`;
        } else {
            const imageNamespace = 'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"';
            const videoNamespace = 'xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"';
            const newsNamespace = 'xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"';

            if (type === 'image') {
                return `${xmlDeclaration}<urlset ${sitemapNamespace} ${imageNamespace}>\n</urlset>`;
            } else if (type === 'video') {
                return `${xmlDeclaration}<urlset ${sitemapNamespace} ${videoNamespace}>\n</urlset>`;
            } else { // For 'news' type or any other types
                return `${xmlDeclaration}<urlset ${sitemapNamespace} ${newsNamespace} ${imageNamespace} ${videoNamespace}>\n</urlset>`;
            }
        }
    }

    async saveSitemap(file, host) {
        let data = {
            method: 'object.update',
            host: host,
            array: 'files',
            object: file,
            upsert: true,
            organization_id: file.organization_id
        }
        if (!file._id)
            data.$filter = {
                query: {
                    host: { $in: [host, '*'] },
                    pathname: file.pathname
                },
                limit: 1
            }

        data = await this.crud.send(data)

    }

    async getLastSitemapIndex(mainSitemap, filename) {
        try {
            // Use regex to match all sitemap entries for the given type
            const regex = new RegExp(`\\/${filename}(\\d*)\\.xml<\\/loc>`, 'g');
            const matches = mainSitemap.src.match(regex);

            return matches ? matches.length : null;
        } catch (err) {
            console.error(`Error determining next sitemap index for ${filename}:`, err);
            return null; // Or some default value or throw an error
        }
    }

    checkSitemap(sitemap) {
        try {
            if (!sitemap)
                return false

            // Count the number of <url> entries
            const urlCount = (sitemap.match(/<url>/g) || []).length;
            if (urlCount >= 50000)
                return false;

            // Get the size of the sitemap string in bytes
            const fileSizeInBytes = Buffer.byteLength(sitemap, 'utf8');
            const fileSizeInMB = fileSizeInBytes / (1024 * 1024);

            // console.log(`Sitemap has ${urlCount} entries and is ${fileSizeInMB.toFixed(2)} MB.`);

            // Check if the file size exceeds either the 50MB limit or the MongoDB 16MB limit
            if (fileSizeInMB >= 50 || fileSizeInMB >= 15)
                return false;

            return true;
        } catch (err) {
            console.error('Error checking sitemap file:', err);
            return false;
        }
    }

    parseHtml(file) {
        const dom = parse(file.src);
        const entries = dom.querySelectorAll('[sitemap="true"]');

        let types = ['image', 'video', 'news']

        const previousEntries = {}
        for (let i = 0; i < types.length; i++) {
            if (!file.sitemap[types[i]])
                continue
            if (Array.isArray(file.sitemap[types[i]]))
                previousEntries[types[i]] = file.sitemap[types[i]]
            else
                previousEntries[types[i]] = [file.sitemap[types[i]]]

            delete file.sitemap[types[i]]
        }

        for (let i = 0; i < entries.length; i++) {
            let type = '', query = '';
            let existingObject
            let entryObject = {};

            if (entries[i].tagName === 'IMG') {  // Corrected to 'IMG' for images
                type = 'image';
                query = 'loc'
                entryObject.loc = entries[i].getAttribute('src');
                entryObject.title = entries[i].getAttribute('sitemap-title') || entries[i].getAttribute('title') || entries[i].getAttribute('alt');
                entryObject.caption = entries[i].getAttribute('sitemap-caption') || entries[i].getAttribute('alt') || entryObject.title;
                entryObject.geo_location = entries[i].getAttribute('sitemap-geo-location');
            } else if (entries[i].tagName === 'VIDEO') {
                type = 'video';
                query = 'content_loc'
                entryObject.content_loc = entries[i].src;
                entryObject.title = entries[i].getAttribute('sitemap-title') || entries[i].getAttribute('title');
                entryObject.description = entries[i].getAttribute('description');  // 'description' if available
                entryObject.thumbnail_loc = entries[i].getAttribute('sitemap-thumbnail') || entries[i].getAttribute('poster');
                entryObject.duration = entries[i].getAttribute('sitemap-duration');
            } else {
                type = 'news';
                file.sitemap.type = 'news';
                query = 'title'
                entryObject.title = entries[i].getAttribute('sitemap-title');
                if (!entryObject.title) {
                    const title = dom.querySelector('title');
                    entryObject.title = title ? title.text : '';
                }

                entryObject.publication = {
                    name: entries[i].getAttribute('sitemap-publication-name'),  // Use proper attribute
                    language: entries[i].getAttribute('sitemap-publication-language')  // Use proper attribute
                };

                if (!entryObject.publication.language) {
                    // Fallback to HTML lang attribute
                    const htmlElement = dom.querySelector('html');
                    entryObject.publication.language = htmlElement ? htmlElement.getAttribute('lang') : null;
                }

                entryObject.publication_date = entries[i].getAttribute('sitemap-publication-date') || file.modified.on;

                entryObject.keywords = entries[i].getAttribute('sitemap-keywords');
                if (!entryObject.keywords) {
                    const keywords = dom.querySelector('meta[name="keywords"]');
                    entryObject.keywords = keywords ? keywords.getAttribute('content') : '';
                }

                entryObject.genres = entries[i].getAttribute('sitemap-genres');
            }

            if (previousEntries[type]) {
                existingObject = previousEntries[type].find(item => item[query] === entryObject[query]);
                entryObject = { ...existingObject, ...entryObject }
            }

            Object.keys(entryObject).forEach(key => {
                if (!entryObject[key])
                    delete entryObject[key]
            });

            if (!file.sitemap[type])
                file.sitemap[type] = []

            file.sitemap[type].push(entryObject)

        }

        if (file.sitemap.type !== 'news' && file.sitemap.type !== 'image' && file.sitemap.type !== 'video') {
            const priorityMeta = dom.querySelector('meta[name="sitemap-priority"]');
            const changefreqMeta = dom.querySelector('meta[name="sitemap-changefreq"]');
            file.sitemap.priority = priorityMeta ? priorityMeta.getAttribute('content') : file.sitemap.priority; // Default priority if not specified
            file.sitemap.changefreq = changefreqMeta ? changefreqMeta.getAttribute('content') : file.sitemap.changefreq || 'monthly'; // Default changefreq if not specified
        }

    }

    encodeXML(str) {
        if (str)
            return str
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&apos;');
    }

}

module.exports = CoCreateSitemap;
