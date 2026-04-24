/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        sentinel: {
          bg: "#0a0e1a",
          panel: "#0d1424",
          border: "#1a2744",
          accent: "#00d4ff",
          green: "#00ff88",
          red: "#ff3366",
          yellow: "#ffaa00",
          purple: "#7c3aed",
        },
      },
    },
  },
  plugins: [],
};
