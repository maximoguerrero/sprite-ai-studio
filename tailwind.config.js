/** @type {import('tailwindcss').Config} */
export default {
  corePlugins: { preflight: false },
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        studio: {
          canvas: "#10100f",
          panel: "#171715",
          raised: "#1d1d1a",
          line: "#292925",
          muted: "#8b8b80",
          ink: "#e9e8e2",
          lime: "#c9f36a",
        },
      },
      fontFamily: {
        display: ["Space Grotesk", "sans-serif"],
        mono: ["DM Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
