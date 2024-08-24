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

class CoCreateSitemap {
    constructor(crud) {
        this.crud = crud;
    }

    async check(file, host) {
        // Ensure the file is HTML and does not have a sitemap object yet
        if (!file.sitemap && file['content-type'] !== 'text/html')
            return;

        // Ensure the file is public
        if (!file.public || file.public === "false")
            return;

        // Check if the file is HTML and contains a noindex meta tag
        if (file['content-type'] === 'text/html' && file.src.includes('<meta name="robots" content="noindex">'))
            return;

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
            // TODO: need to get info such as host
            const entry = this.createEntry(file);

            let { mainSitemap, sitemap } = await this.getSitemap(file, host);

            if (file.sitemap.pathname) {
                // Perform regex search starting at the pathname
                const regexPattern = `<url>\\s*<loc>.*?${file.sitemap.pathname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*?</loc>[\\s\\S]*?</url>`;
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
        const depth = (file.pathname.match(/\//g) || []).length;
        const priority = Math.max(0.1, 1.0 - (depth - 1) * 0.1).toFixed(1);

        const defaultKeys = {
            loc: file.pathname,
            lastmod: file.modified.on,
            changefreq: 'monthly', // Example default value
            priority: priority,
        };
        // Merge default keys with file.sitemap, prioritizing file.sitemap values
        file.sitemap = { ...defaultKeys, ...file.sitemap };
        file.sitemap.lastmod = file.modified.on;

        let entry = `\t<url>\n`;

        for (const key of Object.keys(file.sitemap)) {
            if (key === 'pathname')
                continue
            const value = file.sitemap[key];

            if (typeof value === 'object' && value !== null) {
                entry += `\t\t<${key}:${key}>\n`;

                for (const nestedKey of Object.keys(value)) {
                    const nestedValue = value[nestedKey];
                    entry += `\t\t\t<${key}:${nestedKey}>${nestedValue}</${key}:${nestedKey}>\n`;
                }

                entry += `\t\t</${key}:${key}>\n`;
            } else {
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
            } else if (file.sitemap.news) {
                // type = 'news';
            }

            let name = `sitemap`
            if (type === 'image' || type === 'video' || type === 'news')
                name = `sitemap-${type}`

            // If no existing sitemap found check last index sitemap
            let index = await this.getLastSitemapIndex(mainSitemap, name);
            if (index) {
                sitemap.pathname = `/${name}${index}.xml`
                sitemap = await this.readSitemap(sitemap, host);
            }

            // Check if there's room in the last index sitemap
            if (!this.checkSitemap(sitemap.src)) {
                if (sitemap.src)
                    index += 1
                sitemap.name = `${name}${index}.xml`
                sitemap.pathname = `/${name}${index}.xml`
                sitemap.src = this.createSitemap(type);

                // Add the new sitemap entry
                const indexEntry = `\n<sitemap>\n\t<loc>{{$host}}/${name}${index}.xml</loc>\n</sitemap>`;
                mainSitemap.src = mainSitemap.src.replace('</sitemapindex>', `${indexEntry}\n</sitemapindex>`);

            }

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
        if (type === 'main')
            return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</sitemapindex>`;
        else if (type === 'image' || type === 'video' || type === 'news')
            return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:${type}="http://www.google.com/schemas/sitemap-${type}/1.1">\n</urlset>`;
        else
            return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>`;
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

            return matches ? matches.length : 0;
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

}

module.exports = CoCreateSitemap;
