import fs from "node:fs";
import path from "node:path";

/**
 * Load a Markdown prompt template from the prompts/ directory.
 * @param {string} rootDir - Plugin root directory
 * @param {string} name - Template name (without .md extension)
 * @returns {string}
 */
export function loadPromptTemplate(rootDir, name) {
  const promptPath = path.join(rootDir, "prompts", `${name}.md`);
  return fs.readFileSync(promptPath, "utf8");
}

/**
 * Interpolate `{{VARIABLE}}` placeholders in a template string.
 * Missing variables are replaced with empty string.
 * @param {string} template
 * @param {Record<string, string>} variables
 * @returns {string}
 */
export function interpolateTemplate(template, variables) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
    return Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : "";
  });
}
