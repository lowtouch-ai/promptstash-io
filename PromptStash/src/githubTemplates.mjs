import jsyaml from "js-yaml";

/**
 * GitHub Repository Configuration
 */
const GITHUB_CONFIG = {
    owner: "uvaist1997",
    repo: "PromptStashTemplates",
    branch: "main",
    apiUrl: "https://api.github.com/repos/uvaist1997/PromptStashTemplates/git/trees/main?recursive=1"
};

/**
 * Cache configuration
 */
const CACHE_KEY = "github_templates_cache";
const CACHE_DURATION = 3600000; // 1 hour in milliseconds

/**
 * Fetch all YAML files from the GitHub repository
 * @returns {Promise<Array>} Array of template objects
 */
export async function fetchGitHubTemplates() {
    try {
        // Check cache first
        const cachedData = await getCachedTemplates();
        if (cachedData) {
            console.log("Using cached GitHub templates");
            return cachedData;
        }

        console.log("Fetching templates from GitHub...");
        
        // Fetch the tree structure from GitHub
        const response = await fetch(GITHUB_CONFIG.apiUrl);
        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        
        // Filter only YAML files
        const yamlFiles = data.tree.filter(item => 
            item.type === "blob" && 
            (item.path.endsWith('.yaml') || item.path.endsWith('.yml'))
        );

        console.log(`Found ${yamlFiles.length} YAML files`);

        // Fetch and parse each YAML file
        const templates = await Promise.all(
            yamlFiles.map(file => fetchAndParseYAML(file))
        );

        // Filter out any failed fetches (null values)
        const validTemplates = templates.filter(t => t !== null);

        // Cache the results
        await cacheTemplates(validTemplates);

        console.log(`Successfully loaded ${validTemplates.length} templates`);
        return validTemplates;

    } catch (error) {
        console.error("Error fetching GitHub templates:", error);
        // Return empty array on error to allow fallback to defaults
        return [];
    }
}

/**
 * Fetch and parse a single YAML file
 * @param {Object} file - File object from GitHub tree
 * @returns {Promise<Object|null>} Parsed template object or null on error
 */
async function fetchAndParseYAML(file) {
    try {
        const rawUrl = `https://raw.githubusercontent.com/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/${GITHUB_CONFIG.branch}/${file.path}`;
        
        const response = await fetch(rawUrl);
        if (!response.ok) {
            console.warn(`Failed to fetch ${file.path}: ${response.status}`);
            return null;
        }

        const yamlContent = await response.text();
        console.log(`Raw YAML content for ${file.path}:`, yamlContent);
        
        let parsed = jsyaml.load(yamlContent);
        console.log(`Parsed YAML for ${file.path}:`, parsed);
        
        // Handle case where YAML is an array (starts with -)
        if (Array.isArray(parsed) && parsed.length > 0) {
            parsed = parsed[0]; // Take first item
            console.log(`YAML was array, using first item:`, parsed);
        }

        // Extract folder path as tags
        const tags = extractTagsFromPath(file.path);

        // Handle tags from YAML - can be array or string
        let yamlTags = "";
        if (parsed.tags) {
            if (Array.isArray(parsed.tags)) {
                yamlTags = parsed.tags.join(", ");
            } else if (typeof parsed.tags === "string") {
                yamlTags = parsed.tags;
            }
        }

        // Combine folder tags with YAML tags
        const combinedTags = [tags, yamlTags].filter(t => t).join(", ");

        // Create template object matching the expected format
        const template = {
            name: parsed.name || extractNameFromPath(file.path),
            tags: combinedTags,
            type: "pre-built", // Always set to pre-built for GitHub templates
            content: parsed.content || "",
            favorite: parsed.favorite || false
        };

        console.log(`Parsed template: ${template.name}`, template);
        return template;

    } catch (error) {
        console.error(`Error parsing ${file.path}:`, error);
        return null;
    }
}

/**
 * Extract tags from file path (folder structure)
 * Example: "sales/sales1/template.yaml" -> "sales, sales1"
 * @param {string} path - File path
 * @returns {string} Comma-separated tags
 */
function extractTagsFromPath(path) {
    const parts = path.split('/');
    // Remove the filename (last part)
    parts.pop();
    
    // If no folders, return empty string
    if (parts.length === 0) {
        return "";
    }
    
    // Join folder names as tags
    return parts.join(', ');
}

/**
 * Extract a readable name from file path if name is not in YAML
 * Example: "sales/email-template.yaml" -> "Email Template"
 * @param {string} path - File path
 * @returns {string} Formatted name
 */
function extractNameFromPath(path) {
    const filename = path.split('/').pop();
    const nameWithoutExt = filename.replace(/\.(yaml|yml)$/, '');
    
    // Convert hyphens/underscores to spaces and capitalize
    return nameWithoutExt
        .replace(/[-_]/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

/**
 * Get cached templates if available and not expired
 * @returns {Promise<Array|null>} Cached templates or null
 */
async function getCachedTemplates() {
    return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get([CACHE_KEY, `${CACHE_KEY}_timestamp`], (result) => {
                const cached = result[CACHE_KEY];
                const timestamp = result[`${CACHE_KEY}_timestamp`];
                
                if (cached && timestamp) {
                    const age = Date.now() - timestamp;
                    if (age < CACHE_DURATION) {
                        resolve(cached);
                        return;
                    }
                }
                resolve(null);
            });
        } else {
            resolve(null);
        }
    });
}

/**
 * Cache templates to Chrome storage
 * @param {Array} templates - Templates to cache
 * @returns {Promise<void>}
 */
async function cacheTemplates(templates) {
    return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({
                [CACHE_KEY]: templates,
                [`${CACHE_KEY}_timestamp`]: Date.now()
            }, () => {
                console.log("Templates cached successfully");
                resolve();
            });
        } else {
            resolve();
        }
    });
}

/**
 * Clear the template cache
 * @returns {Promise<void>}
 */
export async function clearTemplateCache() {
    return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.remove([CACHE_KEY, `${CACHE_KEY}_timestamp`], () => {
                console.log("Template cache cleared");
                resolve();
            });
        } else {
            resolve();
        }
    });
}

/**
 * Filter templates by tag
 * @param {Array} templates - All templates
 * @param {string} tag - Tag to filter by
 * @returns {Array} Filtered templates
 */
export function filterTemplatesByTag(templates, tag) {
    if (!tag || tag.trim() === "") {
        return templates;
    }
    
    const searchTag = tag.toLowerCase().trim();
    return templates.filter(template => {
        const templateTags = template.tags.toLowerCase();
        return templateTags.split(',').some(t => t.trim() === searchTag);
    });
}

/**
 * Get all unique tags from templates
 * @param {Array} templates - All templates
 * @returns {Array} Array of unique tags
 */
export function getAllTags(templates) {
    const tagsSet = new Set();
    
    templates.forEach(template => {
        if (template.tags) {
            const tags = template.tags.split(',').map(t => t.trim()).filter(t => t);
            tags.forEach(tag => tagsSet.add(tag));
        }
    });
    
    return Array.from(tagsSet).sort();
}

export default {
    fetchGitHubTemplates,
    clearTemplateCache,
    filterTemplatesByTag,
    getAllTags
};
