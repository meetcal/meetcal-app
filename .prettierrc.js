module.exports = {
  // Use the organize attributes plugin for better JSX formatting
  plugins: ["prettier-plugin-organize-attributes"],

  // Don't add semicolons at the end of statements
  semi: false,

  // Add trailing commas where valid in ES5 (objects, arrays, etc.)
  trailingComma: "es5",

  // Use single quotes instead of double quotes
  singleQuote: true,

  // Wrap lines at 80 characters
  printWidth: 80,

  // Use 2 spaces per indentation level
  tabWidth: 2,

  // Indent with spaces instead of tabs
  useTabs: false,

  // Always include parentheses around arrow function parameters
  arrowParens: "always",

  // Print spaces between brackets in object literals
  bracketSpacing: true,

  // Use Unix-style line endings (\n)
  endOfLine: "lf",

  // Use double quotes in JSX attributes
  jsxSingleQuote: false,

  // Put the closing > of JSX elements on a new line
  jsxBracketSameLine: false,

  // Don't wrap markdown text
  proseWrap: "preserve",

  // Break object properties onto separate lines when they don't fit
  bracketSameLine: false,

  // Automatically break JSX attributes onto multiple lines
  attributeGroups: ["^(?!key$).*$"],
};
