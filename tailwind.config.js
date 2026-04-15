/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        treasures: { 50: "#fdf4e3", 500: "#b8860b", 700: "#8a6508" },
        ministry: { 50: "#fff0e6", 500: "#d9581f", 700: "#a03d12" },
        living: { 50: "#e6f4ec", 500: "#2f855a", 700: "#1f5a3d" },
      },
    },
  },
  plugins: [],
};
