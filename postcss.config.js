module.exports = ctx => ({
  plugins: {
    "postcss-nested": {}
    // Other plugins temporarily disabled for Gatsby v5 compatibility
    // "postcss-easy-media-query": { ... },
    // "postcss-text-remove-gap": { ... },
    // "postcss-cssnext": {} // Deprecated
  }
});

// "postcss-nested": {},
// "postcss-sorting": {
//   order: ["custom-properties", "dollar-variables", "declarations", "at-rules", "rules"],
//   "properties-order": "alphabetical",
//   "unspecified-properties-position": "bottom"
// },
// "postcss-utilities": {},
// "postcss-cssnext": {}
